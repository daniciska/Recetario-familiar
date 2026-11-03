// POST /api/familia — crea la familia en la nube (sólo la primera; o con CLAVE_CREACION si se configuró).
import type { Config } from "@netlify/functions";
import { almacen, cambiarAcceso, error, idAzar, json, leerJSON, limpiarNombre, nuevoEquipo } from "../../servidor/comun";

export default async (req: Request) => {
  if (req.method !== "POST") return error("Método no permitido", 405);
  const body = await leerJSON(req);
  if (!body) return error("Pedido inválido", 400);
  const nombre = limpiarNombre(body.nombre, "Mi familia");
  const clave = process.env.CLAVE_CREACION;
  const autorizada = !!clave && req.headers.get("x-clave-creacion") === clave;

  const familiaId = idAzar(12);
  if (!autorizada) {
    // Escritura "sólo si no existe": aunque dos equipos toquen Crear a la vez, sólo uno queda como la familia.
    const r = await almacen().setJSON("registro/primera", { familiaId, creada: new Date().toISOString() }, { onlyIfNew: true });
    if (!r.modified) {
      return error("Ya hay una familia creada. Únete con un código de invitación desde un equipo que ya esté conectado.", 409);
    }
  }
  await cambiarAcceso(familiaId, () => ({ familia: { id: familiaId, nombre }, equipos: {}, versiones: {} }));
  const { token, equipoId } = await nuevoEquipo(familiaId, limpiarNombre(body.nombreEquipo));
  return json({ token, equipoId, familia: { id: familiaId, nombre } }, 201);
};

export const config: Config = { path: "/api/familia" };
