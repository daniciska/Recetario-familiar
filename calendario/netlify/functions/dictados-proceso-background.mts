// Función en segundo plano (hasta 15 min): Gemini escucha el audio de un dictado y deja el borrador.
// La dispara api-dictados con POST /api/dictados-proceso {id} y el mismo Bearer del equipo; Netlify contesta
// 202 al tiro y esto sigue corriendo. Nunca lanza (si lanzara, Netlify la reintenta a los 1 y 2 min; igual
// sería inofensivo por el turno de servidor/dictados.ts). El nombre termina en "-background" y además va
// `background: true`: las dos formas que documenta Netlify.
import type { Config } from "@netlify/functions";
import { depsReales, manejarProceso } from "../../servidor/dictados";

export default manejarProceso(depsReales());

export const config: Config = { path: "/api/dictados-proceso", method: "POST", background: true };
