// POST /api/invitar — un código de un solo uso (24 h) para que otro equipo se una a la familia.
import type { Config } from "@netlify/functions";
import { almacen, autenticar, codigoInvitacion, error, huella, json } from "../../servidor/comun";

const DURACION = 24 * 60 * 60_000;

export default async (req: Request) => {
  if (req.method !== "POST") return error("Método no permitido", 405);
  const s = await autenticar(req);
  if (s instanceof Response) return s;
  for (let i = 0; i < 5; i++) {
    const codigo = codigoInvitacion();
    const expira = new Date(Date.now() + DURACION).toISOString();
    const r = await almacen().setJSON(`invitaciones/${huella(codigo)}`, { familiaId: s.familiaId, expira, usada: false }, { onlyIfNew: true });
    if (r.modified) return json({ codigo, expira }, 201);
  }
  return error("No se pudo crear la invitación", 500);
};

export const config: Config = { path: "/api/invitar" };
