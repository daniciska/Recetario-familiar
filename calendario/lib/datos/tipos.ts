// Modelo de datos del calendario familiar.
// Las fechas se guardan como texto "AAAA-MM-DD" y las horas como "HH:mm",
// siempre entendidas en la zona horaria America/Santiago.

export type Id = string;

export interface Miembro {
  id: Id;
  nombre: string;
  color: string; // hex, p. ej. "#E76F51"
  emoji: string;
}

export type Repeticion = "nunca" | "diaria" | "semanal" | "mensual" | "anual";

export interface Evento {
  id: Id;
  titulo: string;
  miembros: Id[]; // uno o varios (evento compartido)
  fecha: string; // AAAA-MM-DD (primera ocurrencia; si dura varios días, el día en que empieza)
  fechaFin?: string; // AAAA-MM-DD: último día, si dura varios días (vacaciones, viajes)
  todoElDia: boolean;
  horaInicio?: string; // HH:mm
  horaFin?: string; // HH:mm (si dura varios días, la hora en que termina el último día)
  repeticion: Repeticion;
  intervalo?: number; // cada N días/semanas/meses/años (sin valor: cada 1)
  diasSemana?: number[]; // semanal: 0 = lunes … 6 = domingo (sin valor: el día de `fecha`)
  repetirHasta?: string; // AAAA-MM-DD, opcional
  nota?: string;
  lugar?: string;
  excepciones?: string[]; // fechas en que NO empieza (borrado "sólo este día")
  /**
   * Repeticiones que vienen de un calendario conectado y no se pueden escribir con las opciones de
   * arriba (p. ej. "el segundo martes de cada mes"): las fechas en que empieza, ya calculadas.
   */
  fechas?: string[];
  cuentaRegresiva?: boolean; // se muestra arriba "⏳ … en N días" (cumpleaños, viajes)
  /** Vínculo con un calendario conectado (iCloud). `recurrencia`: el día de la serie que se cambió sólo ese día. */
  externo?: { conexion: string; uid: string; recurrencia?: string };
  soloPanel?: boolean; // no se sube a los calendarios conectados
  actualizado?: string; // ISO: último cambio hecho en el panel (para decidir choques con iCloud)
}

/** Una ocurrencia concreta de un evento (los repetidos se expanden). */
export interface Ocurrencia {
  evento: Evento;
  fecha: string;
  inicio: string; // día en que empezó esta ocurrencia (distinto de `fecha` si dura varios días)
}

export type Unidad =
  | "g"
  | "kg"
  | "ml"
  | "l"
  | "unidad"
  | "taza"
  | "cda"
  | "cdta"
  | "diente"
  | "atado"
  | "lata"
  | "paquete"
  | "pizca"
  | "al gusto";

export type CategoriaCompra =
  | "Verduras y frutas"
  | "Carnes y pescados"
  | "Lácteos y huevos"
  | "Panadería"
  | "Despensa"
  | "Condimentos y especias"
  | "Congelados"
  | "Bebidas"
  | "Aseo y hogar"
  | "Otros";

export interface Ingrediente {
  id: Id;
  nombre: string;
  cantidad: number | null; // null = "al gusto"
  unidad: Unidad;
  categoria: CategoriaCompra;
  // Recetas dictadas (Gemini). Opcionales: las recetas de antes no los tienen.
  comoLoDijo?: string; // cómo se dijo la cantidad ("un puñadito"), ≤ 200
  estimado?: true; // sólo con cantidad != null: se calculó a partir de una medida vaga ("≈")
  nota?: string; // preparación o envase ("picada en cubitos", "tarro de 397 g"), ≤ 200
}

export interface Receta {
  id: Id;
  nombre: string;
  emoji: string;
  foto?: string; // URL o data URL (reducida)
  porciones: number;
  tiempoMin?: number;
  ingredientes: Ingrediente[];
  pasos: string[];
  nota?: string;
  dudas?: string[]; // preguntas pendientes de Gemini (≤ 20, de ≤ 300)
  /** Receta dictada: el audio y lo que se dijo quedan en Blobs (almacén "audios"), no en la receta. */
  dictado?: { id: string; fecha: string; segundos?: number };
}

export type TipoComida = "desayuno" | "colacion" | "almuerzo" | "once" | "cena";

/** Lo que va en un espacio de una comida (ver ESPACIOS_COMIDA en lib/comidas.ts). */
export interface ItemComida {
  recetaId?: Id; // receta de la biblioteca
  texto?: string; // o algo libre: "Sobras", "Fruta", "Comemos donde la abuela"
}

/**
 * Una comida de un día, con sus espacios (desayuno 4, colación 3, almuerzo: proteína, carbohidrato,
 * verduras y postre…). El primer espacio va en `recetaId` / `texto`, como cuando cada comida era un
 * solo ítem (así la siguen viendo los equipos con la versión anterior), y los demás en `mas`.
 */
export interface ComidaPlanificada extends ItemComida {
  porciones: number; // para toda la comida
  /** Espacios del segundo en adelante, en orden; null = vacío. Sin valor: sólo el primero. */
  mas?: (ItemComida | null)[];
}

/** Clave: `${fecha}|${tipo}` */
export type PlanComidas = Record<string, ComidaPlanificada>;

export interface ItemCompra {
  id: Id;
  nombre: string;
  cantidad: number | null;
  unidad: Unidad;
  categoria: CategoriaCompra;
  comprado: boolean;
  origen: "manual" | "menu";
  semana?: string; // lunes de la semana del menú que lo generó
  detalle?: string; // "Pastel de choclo, Cazuela"
  oculto?: boolean; // comprado y sacado de la vista; se guarda para descontarlo si se regenera la lista
}

/** Franja del día de un quehacer (rutina de mañana, tarde o noche). */
export type Momento = "manana" | "tarde" | "noche";

export interface Tarea {
  id: Id;
  titulo: string;
  miembroId?: Id; // sin persona = "Quien pueda": al marcarla se elige quién la hizo
  hecha: boolean; // tareas que no se repiten
  creada: string; // ISO
  /** "nunca": una sola vez · "diaria": todos los días · "dias": los días de `dias`. */
  repetir?: "nunca" | "diaria" | "dias";
  dias?: number[]; // 0 = lunes … 6 = domingo
  hechas?: string[]; // fechas AAAA-MM-DD en que se completó (tareas que se repiten; sólo las recientes)
  estrellas?: number; // 0–5 que gana quien la hace
  momento?: Momento;
}

export interface Premio {
  id: Id;
  titulo: string;
  emoji: string;
  costo: number; // estrellas
  miembroId?: Id; // para quién; sin persona = para cualquiera
}

/** Movimiento de estrellas: el saldo de cada persona es la suma de los suyos. */
export interface MovimientoEstrellas {
  id: Id;
  miembroId: Id;
  cantidad: number; // + gana, − canjea o se descuenta
  motivo: string;
  fecha: string; // ISO
  ref?: string; // quehacer que lo generó (`tareaId` o `tareaId|AAAA-MM-DD`), para deshacerlo al desmarcar
}

export type Tema = "auto" | "claro" | "noche";

export interface Ajustes {
  nombreFamilia: string;
  ciudad: string;
  latitud: number;
  longitud: number;
  tema: Tema;
  nocheDesde: string; // HH:mm
  nocheHasta: string; // HH:mm
  pin?: string; // huella del PIN de 4 dígitos para hacer cambios en la pantalla de la pared
}

export interface EstadoApp {
  version: 1;
  ajustes: Ajustes;
  miembros: Miembro[];
  eventos: Evento[];
  recetas: Receta[];
  plan: PlanComidas;
  compras: ItemCompra[];
  tareas: Tarea[];
  premios: Premio[];
  estrellas: MovimientoEstrellas[];
}

export type ClaveColeccion = Exclude<keyof EstadoApp, "version">;
