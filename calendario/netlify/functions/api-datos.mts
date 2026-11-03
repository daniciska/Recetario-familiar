// GET /api/datos[?claves=a,b]          → colecciones con su versión
// PUT /api/datos/:clave {datos, versionBase} → guarda si nadie la cambió desde versionBase (si no, 409 con lo último)
// PUT /api/datos {estado}              → reemplaza todo (respaldo, datos de ejemplo, primera subida)
import type { Config, Context } from "@netlify/functions";
import {
  CLAVES,
  MAX_COLECCION,
  anotarVersiones,
  autenticar,
  calendariosPublicos,
  error,
  esClave,
  guardarColeccion,
  json,
  leerColeccion,
  leerJSON,
  reemplazarColeccion,
  type Coleccion,
} from "../../servidor/comun";
import type { ClaveColeccion } from "../../lib/datos/tipos";

export default async (req: Request, context: Context) => {
  const s = await autenticar(req);
  if (s instanceof Response) return s;
  const clave = context.params?.clave;

  if (req.method === "GET") {
    const pedidas = (new URL(req.url).searchParams.get("claves") ?? "").split(",").filter(esClave);
    const claves = pedidas.length ? pedidas : CLAVES;
    const leidas = await Promise.all(claves.map(async (c) => [c, await leerColeccion(s.familiaId, c)] as const));
    const colecciones: Record<string, Coleccion> = {};
    for (const [c, v] of leidas) if (v) colecciones[c] = v;
    return json({ colecciones, calendarios: calendariosPublicos(s.acceso) });
  }

  if (req.method !== "PUT") return error("Método no permitido", 405);
  const body = await leerJSON(req);
  if (!body) return error("Pedido inválido", 400);

  if (clave) {
    if (!esClave(clave)) return error("Colección desconocida", 400);
    if (!("datos" in body)) return error("Faltan los datos", 400);
    if (JSON.stringify(body.datos).length > MAX_COLECCION) return error("Es demasiado grande para guardarlo", 413);
    const r = await guardarColeccion(s.familiaId, clave, body.datos, Number(body.versionBase ?? 0));
    // Otro equipo la cambió primero: se devuelve lo último para que este equipo rehaga su cambio encima.
    if (!r.ok) return json({ conflicto: true, datos: r.actual.datos, version: r.actual.version }, 409);
    await anotarVersiones(s.familiaId, { [clave]: r.version });
    return json({ version: r.version });
  }

  // Reemplazar todo.
  const estado = body.estado as Record<string, unknown> | undefined;
  if (!estado || typeof estado !== "object") return error("Falta el estado", 400);
  const claves = CLAVES.filter((c) => c in estado);
  for (const c of claves) if (JSON.stringify(estado[c]).length > MAX_COLECCION) return error(`${c}: es demasiado grande`, 413);
  const versiones: Partial<Record<ClaveColeccion, number>> = {};
  for (const c of claves) versiones[c] = await reemplazarColeccion(s.familiaId, c, estado[c]);
  await anotarVersiones(s.familiaId, versiones);
  return json({ versiones });
};

export const config: Config = { path: ["/api/datos", "/api/datos/:clave"] };
