// GET /api/datos[?claves=a,b]          → colecciones con su versión
// PUT /api/datos/:clave {datos, versionBase} → guarda si nadie la cambió desde versionBase (si no, 409 con lo último)
// PUT /api/datos {estado}              → reemplaza todo (respaldo, datos de ejemplo, primera subida)
import type { Config, Context } from "@netlify/functions";
import { CLAVES, MAX_COLECCION, anotarVersiones, autenticar, db, error, esClave, json, leerJSON } from "../../servidor/comun";
import type { ClaveColeccion } from "../../lib/datos/tipos";

type Fila = { clave: string; datos: unknown; version: string | number };

export default async (req: Request, context: Context) => {
  const s = await autenticar(req);
  if (s instanceof Response) return s;
  const clave = context.params?.clave;

  if (req.method === "GET") {
    const pedidas = (new URL(req.url).searchParams.get("claves") ?? "").split(",").filter(esClave);
    const filas = (pedidas.length
      ? await db.sql`SELECT clave, datos, version FROM colecciones WHERE familia_id = ${s.familiaId} AND clave = ANY(${pedidas})`
      : await db.sql`SELECT clave, datos, version FROM colecciones WHERE familia_id = ${s.familiaId}`) as Fila[];
    const colecciones: Record<string, { datos: unknown; version: number }> = {};
    for (const f of filas) colecciones[f.clave] = { datos: f.datos, version: Number(f.version) };
    return json({ colecciones });
  }

  if (req.method !== "PUT") return error("Método no permitido", 405);
  const body = await leerJSON(req);
  if (!body) return error("Pedido inválido", 400);

  if (clave) {
    if (!esClave(clave)) return error("Colección desconocida", 400);
    if (!("datos" in body)) return error("Faltan los datos", 400);
    const texto = JSON.stringify(body.datos);
    if (texto.length > MAX_COLECCION) return error("Es demasiado grande para guardarlo", 413);
    const base = Number(body.versionBase ?? 0);
    let filas = (await db.sql`
      UPDATE colecciones SET datos = ${texto}::jsonb, version = version + 1, actualizado = now()
      WHERE familia_id = ${s.familiaId} AND clave = ${clave} AND version = ${base}
      RETURNING version`) as Fila[];
    if (!filas.length && base === 0) {
      filas = (await db.sql`
        INSERT INTO colecciones (familia_id, clave, datos, version) VALUES (${s.familiaId}, ${clave}, ${texto}::jsonb, 1)
        ON CONFLICT DO NOTHING RETURNING version`) as Fila[];
    }
    if (!filas.length) {
      // Otro equipo la cambió primero: se devuelve lo último para que este equipo rehaga su cambio encima.
      const [actual] = (await db.sql`SELECT datos, version FROM colecciones WHERE familia_id = ${s.familiaId} AND clave = ${clave}`) as Fila[];
      return json({ conflicto: true, datos: actual?.datos ?? null, version: Number(actual?.version ?? 0) }, 409);
    }
    const version = Number(filas[0].version);
    await anotarVersiones(s.familiaId, { [clave]: version });
    return json({ version });
  }

  // Reemplazar todo, en una transacción.
  const estado = body.estado as Record<string, unknown> | undefined;
  if (!estado || typeof estado !== "object") return error("Falta el estado", 400);
  const claves = CLAVES.filter((c) => c in estado);
  for (const c of claves) if (JSON.stringify(estado[c]).length > MAX_COLECCION) return error(`${c}: es demasiado grande`, 413);
  const versiones: Partial<Record<ClaveColeccion, number>> = {};
  const cliente = await db.pool.connect();
  try {
    await cliente.query("BEGIN");
    for (const c of claves) {
      const { rows } = await cliente.query(
        `INSERT INTO colecciones (familia_id, clave, datos, version) VALUES ($1, $2, $3::jsonb, 1)
         ON CONFLICT (familia_id, clave) DO UPDATE SET datos = EXCLUDED.datos, version = colecciones.version + 1, actualizado = now()
         RETURNING version`,
        [s.familiaId, c, JSON.stringify(estado[c])],
      );
      versiones[c] = Number(rows[0].version);
    }
    await cliente.query("COMMIT");
  } catch (e) {
    await cliente.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    cliente.release();
  }
  await anotarVersiones(s.familiaId, versiones);
  return json({ versiones });
};

export const config: Config = { path: ["/api/datos", "/api/datos/:clave"] };
