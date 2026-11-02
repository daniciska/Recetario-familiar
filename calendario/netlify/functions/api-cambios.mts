// GET /api/cambios — versiones de cada colección. Lo consultan los equipos cada pocos segundos;
// sólo lee Blobs, así la base de datos puede dormir mientras nadie cambia nada.
import type { Config } from "@netlify/functions";
import { autenticar, error, json } from "../../servidor/comun";

export default async (req: Request) => {
  if (req.method !== "GET") return error("Método no permitido", 405);
  const s = await autenticar(req);
  if (s instanceof Response) return s;
  return json({ versiones: s.acceso.versiones, familia: s.acceso.familia });
};

export const config: Config = { path: "/api/cambios" };
