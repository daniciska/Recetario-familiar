// "🎙️ Dictar receta": subir el audio, pedir (otra vez) la receta, listar, escuchar, guardar y descartar.
// Todo pide la clave del equipo (Bearer). Las rutas y respuestas están en servidor/dictados.ts (manejarApi).
import type { Config } from "@netlify/functions";
import { depsReales, manejarApi } from "../../servidor/dictados";

export default manejarApi(depsReales());

export const config: Config = { path: ["/api/dictados", "/api/dictados/:id", "/api/dictados/:id/:accion"] };
