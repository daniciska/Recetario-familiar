// POST /api/familia — crea la familia en la nube (sólo la primera; o con CLAVE_CREACION si se configuró).
import type { Config } from "@netlify/functions";
import { cambiarAcceso, db, error, idAzar, json, leerJSON, limpiarNombre, nuevoEquipo } from "../../servidor/comun";

export default async (req: Request) => {
  if (req.method !== "POST") return error("Método no permitido", 405);
  const body = await leerJSON(req);
  if (!body) return error("Pedido inválido", 400);
  const nombre = limpiarNombre(body.nombre, "Mi familia");
  const clave = process.env.CLAVE_CREACION;
  const autorizada = !!clave && req.headers.get("x-clave-creacion") === clave;

  const familiaId = idAzar(12);
  const cliente = await db.pool.connect();
  try {
    await cliente.query("BEGIN");
    // Un candado para que dos pedidos simultáneos no creen dos "primeras" familias.
    await cliente.query("SELECT pg_advisory_xact_lock(424242)");
    const { rows } = await cliente.query("SELECT count(*)::int AS n FROM familias");
    if (rows[0].n > 0 && !autorizada) {
      await cliente.query("ROLLBACK");
      return error("Ya hay una familia creada. Únete con un código de invitación desde un equipo que ya esté conectado.", 409);
    }
    await cliente.query("INSERT INTO familias (id, nombre) VALUES ($1, $2)", [familiaId, nombre]);
    await cliente.query("COMMIT");
  } catch (e) {
    await cliente.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    cliente.release();
  }

  await cambiarAcceso(familiaId, () => ({ familia: { id: familiaId, nombre }, equipos: {}, versiones: {} }));
  const { token, equipoId } = await nuevoEquipo(familiaId, limpiarNombre(body.nombreEquipo));
  return json({ token, equipoId, familia: { id: familiaId, nombre } }, 201);
};

export const config: Config = { path: "/api/familia" };
