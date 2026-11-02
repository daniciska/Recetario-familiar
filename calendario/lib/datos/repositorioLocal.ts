import type { Repositorio } from "./repositorio";
import type { ClaveColeccion, EstadoApp } from "./tipos";

export const PREFIJO = "calendario-familiar:v1:";
const CLAVES: ClaveColeccion[] = ["ajustes", "miembros", "eventos", "recetas", "plan", "compras", "tareas", "premios", "estrellas"];

function leer(clave: string): unknown {
  const crudo = localStorage.getItem(PREFIJO + clave); // si el navegador bloquea el almacenamiento, esto lanza
  if (!crudo) return undefined;
  try {
    return JSON.parse(crudo);
  } catch {
    return undefined; // dañado: se reemplaza por el valor por defecto al normalizar
  }
}

/** Devuelve lo guardado tal cual (sin validar: eso lo hace `normalizarGuardado`). */
function leerTodo(): EstadoApp | null {
  const parcial: Record<string, unknown> = { version: 1 };
  let alguno = false;
  for (const c of CLAVES) {
    const v = leer(c);
    if (v !== undefined) {
      parcial[c] = v;
      alguno = true;
    }
  }
  return alguno ? (parcial as unknown as EstadoApp) : null;
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

  /** Todo o nada: si una clave no cabe, se deshace lo ya escrito y queda como estaba. */
  async reemplazarTodo(estado: EstadoApp) {
    const nuevos = CLAVES.map((c) => [c, JSON.stringify(estado[c])] as const);
    const previos = new Map(CLAVES.map((c) => [c, localStorage.getItem(PREFIJO + c)]));
    // Primero lo más grande (recetas con fotos): si algo no cabe, falla antes de tocar lo demás.
    nuevos.sort((a, b) => b[1].length - a[1].length);
    const escritas: ClaveColeccion[] = [];
    try {
      for (const [c, txt] of nuevos) {
        localStorage.setItem(PREFIJO + c, txt);
        escritas.push(c);
      }
    } catch (e) {
      // Borrar lo escrito libera espacio; después se repone lo anterior, que ya cabía.
      for (const c of escritas) localStorage.removeItem(PREFIJO + c);
      for (const c of escritas) {
        const v = previos.get(c);
        if (v != null) localStorage.setItem(PREFIJO + c, v);
      }
      console.error("No se pudo reemplazar todo", e);
      throw e;
    }
  }

  suscribir(alCambiar: (estado: EstadoApp) => void) {
    const oyente = (e: StorageEvent) => {
      if (e.key && e.key.startsWith(PREFIJO)) {
        try {
          const estado = leerTodo();
          if (estado) alCambiar(estado);
        } catch {
          /* almacenamiento bloqueado */
        }
      }
    };
    window.addEventListener("storage", oyente);
    return () => window.removeEventListener("storage", oyente);
  }
}
