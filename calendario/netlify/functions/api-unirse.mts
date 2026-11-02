// GET  /api/unirse?codigo=…  → nombre de la familia (para confirmar antes de unirse)
// POST /api/unirse {codigo, nombreEquipo} → clave de este equipo (la invitación se gasta)
import type { Config } from "@netlify/functions";
import { almacen, error, huella, json, leerAcceso, leerJSON, limpiarNombre, normalizarCodigo, nuevoEquipo } from "../../servidor/comun";

interface Invitacion {
  familiaId: string;
  expira: string;
  usada: boolean;
}

const NO_VALE = "Ese código no sirve: puede estar mal escrito, ya usado o vencido (duran 24 horas). Pide uno nuevo.";

export default async (req: Request) => {
  const url = new URL(req.url);
  const body = req.method === "POST" ? await leerJSON(req) : null;
  const codigo = normalizarCodigo(String((req.method === "POST" ? body?.codigo : url.searchParams.get("codigo")) ?? ""));
  if (codigo.length !== 8) return error(NO_VALE, 404);
  const clave = `invitaciones/${huella(codigo)}`;
  const store = almacen();
  const inv = await store.getWithMetadata(clave, { type: "json" });
  const datos = inv?.data as Invitacion | undefined;
  if (!inv || !datos || datos.usada || Date.parse(datos.expira) < Date.now()) return error(NO_VALE, 404);
  const acceso = await leerAcceso(datos.familiaId);
  if (!acceso) return error(NO_VALE, 404);

  if (req.method === "GET") return json({ familia: { nombre: acceso.familia.nombre } });
  if (req.method !== "POST") return error("Método no permitido", 405);

  // Se marca usada con escritura condicional: si dos equipos usan el mismo código a la vez, sólo uno entra.
  const r = inv.etag
    ? await store.setJSON(clave, { ...datos, usada: true }, { onlyIfMatch: inv.etag })
    : await store.setJSON(clave, { ...datos, usada: true }); // simulador local: sin ETag
  if (!r.modified) return error(NO_VALE, 404);
  const { token, equipoId } = await nuevoEquipo(datos.familiaId, limpiarNombre(body?.nombreEquipo));
  await store.delete(clave).catch(() => {});
  return json({ token, equipoId, familia: acceso.familia }, 201);
};

export const config: Config = { path: "/api/unirse" };
