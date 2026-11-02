// GET /api/salud — comprueba que la base de datos y Blobs responden (no crea ni cambia nada).
import type { Config } from "@netlify/functions";
import { almacen, db, json } from "../../servidor/comun";

export default async () => {
  const r = { db: false, blobs: false };
  try {
    const filas = (await db.sql`SELECT 1 AS uno`) as { uno: number }[];
    r.db = filas[0]?.uno === 1;
  } catch {
    /* sin base */
  }
  try {
    await almacen().get("salud");
    r.blobs = true;
  } catch {
    /* sin Blobs */
  }
  return json(r, r.db && r.blobs ? 200 : 503);
};

export const config: Config = { path: "/api/salud" };
