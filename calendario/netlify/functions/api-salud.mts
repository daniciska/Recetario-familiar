// GET /api/salud — comprueba que Blobs responde (no crea ni cambia nada).
import type { Config } from "@netlify/functions";
import { almacen, json } from "../../servidor/comun";

export default async () => {
  try {
    await almacen().get("registro/primera");
    return json({ blobs: true });
  } catch {
    return json({ blobs: false }, 503);
  }
};

export const config: Config = { path: "/api/salud" };
