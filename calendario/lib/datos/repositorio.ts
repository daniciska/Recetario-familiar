import type { ClaveColeccion, EstadoApp } from "./tipos";

/**
 * Capa de datos abstracta. La app sólo habla con esta interfaz.
 *
 * Hoy se usa `RepositorioLocal` (localStorage del navegador). Para conectar una
 * base de datos (Supabase, Firebase, una API propia…), crea otra clase que
 * implemente esta interfaz y cámbiala en `lib/datos/index.ts`.
 *
 * Si varios equipos van a escribir a la vez (tablet y teléfono), conviene que la
 * implementación compartida mezcle los cambios por elemento (id) en vez de
 * reemplazar la colección completa, para que no se pisen.
 */
export interface Repositorio {
  /**
   * Carga todo el estado. Devuelve null si todavía no hay nada guardado.
   * Puede devolver datos sin validar: el store los repara con `normalizarGuardado`.
   * Lanza un error si el almacenamiento no está disponible.
   */
  cargar(): Promise<EstadoApp | null>;
  /** Guarda una parte del estado (se llama cada vez que esa parte cambia). */
  guardar<K extends ClaveColeccion>(clave: K, valor: EstadoApp[K]): Promise<void>;
  /** Reemplaza todo (importar respaldo, restablecer datos de ejemplo). Todo o nada: si falla, queda como estaba. */
  reemplazarTodo(estado: EstadoApp): Promise<void>;
  /**
   * Avisa cuando los datos cambian desde fuera (otra pestaña, otro dispositivo).
   * Devuelve una función para dejar de escuchar.
   */
  suscribir(alCambiar: (estado: EstadoApp) => void): () => void;
}
