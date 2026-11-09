// Ganchos de resolución de módulos para correr el código del servidor con Node, sin compilar:
//   - "@netlify/blobs" → pruebas/blobs-mock.mjs (Blobs en memoria, compartido por todo el proceso);
//   - "@/…"            → la raíz de calendario/ (como "paths" de tsconfig.json);
//   - imports sin extensión ("./caldav", "../lib/fechas") prueban .ts, .tsx, .mts y /index.ts.
// Todas las rutas salen de import.meta.url: no hay rutas absolutas de esta máquina.
import { existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const MOCK = new URL("./blobs-mock.mjs", import.meta.url).href;
const RAIZ = new URL("../", import.meta.url); // calendario/
const EXTENSIONES = [".ts", ".tsx", ".mts", "/index.ts"];

const esArchivo = (r) => {
  try {
    return statSync(r).isFile();
  } catch {
    return false;
  }
};

/** Ruta en disco que representa `spec`, o null si no es una ruta local (paquete, node:, data:…). */
function rutaLocal(spec, padre) {
  if (spec.startsWith("@/")) return fileURLToPath(new URL(spec.slice(2), RAIZ));
  if (spec.startsWith("file:")) return fileURLToPath(spec);
  if (spec.startsWith("/")) return spec;
  if ((spec.startsWith("./") || spec.startsWith("../")) && padre?.startsWith("file:")) return fileURLToPath(new URL(spec, padre));
  return null;
}

export async function resolve(spec, ctx, next) {
  if (spec === "@netlify/blobs") return { url: MOCK, shortCircuit: true };
  const ruta = rutaLocal(spec, ctx.parentURL);
  if (ruta !== null) {
    if (!/\.[cm]?[jt]sx?$/.test(ruta) && !ruta.endsWith(".json") && !esArchivo(ruta)) {
      for (const ext of EXTENSIONES) if (existsSync(ruta + ext)) return next(pathToFileURL(ruta + ext).href, ctx);
    }
    if (spec.startsWith("@/")) return next(pathToFileURL(ruta).href, ctx);
  }
  return next(spec, ctx);
}
