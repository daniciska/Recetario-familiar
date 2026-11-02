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

export type Repeticion = "nunca" | "diaria" | "semanal" | "mensual";

export interface Evento {
  id: Id;
  titulo: string;
  miembros: Id[]; // uno o varios (evento compartido)
  fecha: string; // AAAA-MM-DD (primera ocurrencia)
  todoElDia: boolean;
  horaInicio?: string; // HH:mm
  horaFin?: string; // HH:mm
  repeticion: Repeticion;
  repetirHasta?: string; // AAAA-MM-DD, opcional
  nota?: string;
  excepciones?: string[]; // fechas en que NO ocurre (borrado "sólo este día")
}

/** Una ocurrencia concreta de un evento (los repetidos se expanden). */
export interface Ocurrencia {
  evento: Evento;
  fecha: string;
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
}

export type TipoComida = "desayuno" | "almuerzo" | "once" | "cena";

export interface ComidaPlanificada {
  recetaId?: Id; // receta de la biblioteca
  texto?: string; // o algo libre: "Sobras", "Comemos donde la abuela"
  porciones: number;
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
}

export interface Tarea {
  id: Id;
  titulo: string;
  miembroId?: Id;
  hecha: boolean;
  creada: string; // ISO
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
}

export type ClaveColeccion = Exclude<keyof EstadoApp, "version">;
