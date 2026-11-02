// GET    /api/equipos      → equipos con acceso a la familia
// DELETE /api/equipos/:id  → quitarle el acceso a un equipo (un teléfono perdido, o desconectar este)
// PATCH  /api/equipos/:id {nombre} → cambiarle el nombre
import type { Config, Context } from "@netlify/functions";
import { autenticar, cambiarAcceso, error, json, leerJSON, limpiarNombre } from "../../servidor/comun";

export default async (req: Request, context: Context) => {
  const s = await autenticar(req);
  if (s instanceof Response) return s;
  const id = context.params?.id;

  if (req.method === "GET") {
    const equipos = Object.entries(s.acceso.equipos)
      .map(([eid, e]) => ({ id: eid, nombre: e.nombre, creado: e.creado, esEste: eid === s.equipoId }))
      .sort((a, b) => a.creado.localeCompare(b.creado));
    return json({ equipos, familia: s.acceso.familia });
  }
  if (!id) return error("Falta el equipo", 400);
  if (!s.acceso.equipos[id]) return error("Ese equipo no existe", 404);

  if (req.method === "DELETE") {
    await cambiarAcceso(s.familiaId, (a) => {
      if (!a) throw new Error("Familia sin acceso");
      const equipos = { ...a.equipos };
      delete equipos[id];
      return { ...a, equipos };
    });
    return json({ ok: true });
  }
  if (req.method === "PATCH") {
    const body = await leerJSON(req);
    const nombre = limpiarNombre(body?.nombre);
    await cambiarAcceso(s.familiaId, (a) => {
      if (!a?.equipos[id]) throw new Error("Ese equipo no existe");
      return { ...a, equipos: { ...a.equipos, [id]: { ...a.equipos[id], nombre } } };
    });
    return json({ ok: true });
  }
  return error("Método no permitido", 405);
};

export const config: Config = { path: ["/api/equipos", "/api/equipos/:id"] };
