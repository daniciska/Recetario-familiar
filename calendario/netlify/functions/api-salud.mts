// GET /api/salud — comprueba que Blobs responde (no crea ni cambia nada) y si hay clave de Gemini
// utilizable ("ok" | "sin_clave" | "solo_ai_gateway"; nunca su valor).
import type { Config } from "@netlify/functions";
import type { Salud } from "../../lib/dictados/tipos";
import { almacen, json } from "../../servidor/comun";
import { estadoGemini } from "../../servidor/gemini";

export default async () => {
  const gemini = estadoGemini(process.env);
  try {
    await almacen().get("registro/primera");
    return json({ blobs: true, gemini } satisfies Salud);
  } catch {
    return json({ blobs: false, gemini } satisfies Salud, 503);
  }
};

export const config: Config = { path: "/api/salud" };
