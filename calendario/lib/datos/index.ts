import type { Repositorio } from "./repositorio";
import { RepositorioLocal } from "./repositorioLocal";

/** Punto único donde se elige el almacenamiento. Cambia esta línea para usar una base de datos. */
export function crearRepositorio(): Repositorio {
  return new RepositorioLocal();
}

export type { Repositorio } from "./repositorio";
export * from "./tipos";
