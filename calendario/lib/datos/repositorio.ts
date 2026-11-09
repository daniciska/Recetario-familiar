import type { ClaveColeccion, EstadoApp } from "./tipos";

/**
 * Otro equipo cambió esta colección antes: `datos` es lo último que hay. El store vuelve a aplicar
 * su cambio sobre eso y guarda de nuevo.
 */
export class ConflictoVersion extends Error {
  constructor(
    public clave: ClaveColeccion,
    public datos: unknown,
  ) {
    super(`Conflicto al guardar ${clave}`);
  }
}

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
  /** (Opcional) avisa si se puede hablar con la nube o no. */
  alCambiarConexion?(f: (conectado: boolean) => void): () => void;
  /** (Opcional) la familia en la nube a la que está conectado este equipo. */
  readonly familia?: { id: string; nombre: string };
  /** (Opcional) avisa qué calendarios externos (iCloud o Google) tiene conectados la familia. */
  alCambiarCalendarios?(f: (calendarios: CalendarioConectado[]) => void): () => void;
  /** (Opcional) revisa ya si hubo cambios (p. ej. después de conectar un calendario). */
  revisar?(): void;
}

/** Rol de un adulto de la familia (en pantalla: «Madre», «Padre», «Otro adulto»). */
export type RolAdulto = "madre" | "padre" | "adulto";

/** Alguien con quien se compartió el calendario de Google desde el panel. */
export interface PersonaCalendario {
  correo: string; // en minúsculas
  nombre: string;
  rol: RolAdulto;
  permiso: "editor" | "lectura";
  miembroId?: string; // si corresponde a un integrante del panel
  invitada: string; // ISO
  modo: "panel" | "manual"; // "manual" = el panel no pudo compartir y hay que hacerlo en Google Calendar
}

/** Un calendario de afuera (iCloud o Google) que la familia conectó al panel. */
export interface CalendarioConectado {
  id: string;
  proveedor: "icloud" | "google";
  nombre: string;
  /** Sólo google, si el servidor lo manda: el adulto dueño del calendario. */
  dueno?: { nombre: string; correo: string; rol: RolAdulto; miembroId?: string };
  /** Sólo google, si el servidor lo manda: con quién más se compartió. */
  personas?: PersonaCalendario[];
}
