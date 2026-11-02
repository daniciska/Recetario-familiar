import type { Repositorio } from "./repositorio";
import type { ClaveColeccion, EstadoApp } from "./tipos";

const PREFIJO = "calendario-familiar:v1:";
const CLAVES: ClaveColeccion[] = [
  "ajustes",
  "miembros",
  "eventos",
  "recetas",
  "plan",
  "compras",
  "tareas",
];

function leer<T>(clave: string): T | undefined {
  try {
    const crudo = localStorage.getItem(PREFIJO + clave);
    return crudo ? (JSON.parse(crudo) as T) : undefined;
  } catch {
    return undefined;
  }
}

function leerTodo(): EstadoApp | null {
  const parcial: Partial<EstadoApp> = { version: 1 };
  let alguno = false;
  for (const c of CLAVES) {
    const v = leer<unknown>(c);
    if (v !== undefined) {
      (parcial as Record<string, unknown>)[c] = v;
      alguno = true;
    }
  }
  return alguno ? (parcial as EstadoApp) : null;
}

/** Guarda en el localStorage del navegador (sólo en este dispositivo). */
export class RepositorioLocal implements Repositorio {
  async cargar() {
    return leerTodo();
  }

  async guardar<K extends ClaveColeccion>(clave: K, valor: EstadoApp[K]) {
    try {
      localStorage.setItem(PREFIJO + clave, JSON.stringify(valor));
    } catch (e) {
      console.error("No se pudo guardar", clave, e);
      throw e;
    }
  }

  async reemplazarTodo(estado: EstadoApp) {
    for (const c of CLAVES) await this.guardar(c, estado[c]);
  }

  suscribir(alCambiar: (estado: EstadoApp) => void) {
    const oyente = (e: StorageEvent) => {
      if (e.key && e.key.startsWith(PREFIJO)) {
        const estado = leerTodo();
        if (estado) alCambiar(estado);
      }
    };
    window.addEventListener("storage", oyente);
    return () => window.removeEventListener("storage", oyente);
  }
}
