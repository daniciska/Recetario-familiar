import type { ClaveColeccion, EstadoApp } from "./tipos";

/**
 * Capa de datos abstracta. La app sólo habla con esta interfaz.
 *
 * Hoy se usa `RepositorioLocal` (localStorage del navegador). Para conectar una
 * base de datos (Supabase, Firebase, una API propia…), crea otra clase que
 * implemente esta interfaz y cámbiala en `lib/datos/index.ts`.
 */
export interface Repositorio {
  /** Carga todo el estado. Devuelve null si todavía no hay nada guardado. */
  cargar(): Promise<EstadoApp | null>;
  /** Guarda una parte del estado (se llama cada vez que esa parte cambia). */
  guardar<K extends ClaveColeccion>(clave: K, valor: EstadoApp[K]): Promise<void>;
  /** Reemplaza todo (importar respaldo, restablecer datos de ejemplo). */
  reemplazarTodo(estado: EstadoApp): Promise<void>;
  /**
   * Avisa cuando los datos cambian desde fuera (otra pestaña, otro dispositivo).
   * Devuelve una función para dejar de escuchar.
   */
  suscribir(alCambiar: (estado: EstadoApp) => void): () => void;
}
