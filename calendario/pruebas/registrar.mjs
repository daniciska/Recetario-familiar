// Se carga con --import ./pruebas/registrar.mjs (ver pruebas/README.md).
import { register } from "node:module";
register("./hooks.mjs", import.meta.url);
