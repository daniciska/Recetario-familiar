import type { Repositorio } from "./repositorio";
import { RepositorioLocal } from "./repositorioLocal";
import { RepositorioNube } from "./repositorioNube";
import { leerSesion } from "./nube";

/**
 * Punto único donde se elige el almacenamiento: si este equipo está conectado a una familia en la
 * nube (Familia → Compartir entre equipos), los datos son los de la familia; si no, viven sólo aquí.
 */
export function crearRepositorio(): Repositorio {
  const sesion = typeof window !== "undefined" ? leerSesion() : null;
  return sesion ? new RepositorioNube(sesion) : new RepositorioLocal();
}

export type { Repositorio } from "./repositorio";
export { ConflictoVersion } from "./repositorio";
export * from "./tipos";
