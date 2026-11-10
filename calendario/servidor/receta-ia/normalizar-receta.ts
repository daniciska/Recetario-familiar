// Valida y repara la respuesta de Gemini antes de mostrarla como borrador. Nunca lanza: lo que no se
// puede arreglar queda marcado en `avisos` (para la familia) o en `revisar` (por ingrediente).
// Mismo estilo que lib/datos/normalizar.ts: los datos que vienen de afuera se revisan campo por campo.
//
// Uso (servidor/dictados.ts, en la corrida en segundo plano):
//   const r = interpretar(texto)                                        // JSON → objeto (o transcripción rescatada)
//   const b = normalizar(r.datos, { adivinarCategoria, nuevoId })        // → BorradorReceta
//   const receta = aRecetaApp(b, { id, fecha, segundos })                // → Receta de lib/datos/tipos.ts (id "rec_<id>")

import { CATEGORIAS, UNIDADES, type CategoriaIA, type UnidadIA } from "./esquema";
import { SINONIMOS_UNIDAD } from "./equivalencias";
import type { Ingrediente, Receta } from "../../lib/datos/tipos";

export interface IngredienteBorrador {
  id: string;
  nombre: string;
  cantidad: number | null;
  unidad: UnidadIA;
  categoria: CategoriaIA;
  comoLoDijo?: string;
  estimado?: boolean; // se muestra con "≈"
  nota?: string;
  revisar?: string; // aviso del servidor para este ingrediente
}

export interface BorradorReceta {
  esReceta: boolean;
  motivo?: string;
  nombre: string;
  emoji: string;
  porciones: number;
  porcionesEstimadas: boolean;
  tiempoMin?: number;
  tiempoEstimado: boolean;
  ingredientes: IngredienteBorrador[];
  pasos: string[];
  secretos: string[];
  nota?: string;
  dudas: string[];
  transcripcion: string;
  avisos: string[];
}

export interface OpcionesNormalizar {
  adivinarCategoria?: (nombre: string) => CategoriaIA; // la de lib/compras.ts
  nuevoId?: (prefijo: string) => string;
}

const UNIDADES_OK = new Set<string>(UNIDADES);
const CATEGORIAS_OK = new Set<string>(CATEGORIAS);
const LIMITES = { ingredientes: 60, pasos: 40, secretos: 15, dudas: 12, largoPaso: 500, largoTexto: 300, transcripcion: 60000 };

type Obj = Record<string, unknown>;
const esObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
export const sinTildes = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁦-⁩]/g;

function linea(x: unknown, max = LIMITES.largoTexto): string {
  if (typeof x !== "string") return "";
  const t = x.normalize("NFC").replace(CONTROL, "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}
const opcional = (x: unknown, max?: number) => linea(x, max) || undefined;

// ---------- 1. Texto → objeto ----------

export type Interpretado = { ok: true; datos: unknown } | { ok: false; error: string; transcripcion?: string };

export function interpretar(texto: string): Interpretado {
  // Sin expresiones que vuelvan atrás sobre todo el texto: /\s*```$/ tardaba O(n²) con un tramo largo de
  // espacios seguido de otra cosa (lo que puede escribir Gemini cuando se enreda).
  let t = texto.trim();
  if (t.startsWith("```")) t = t.replace(/^```(?:json)?/i, "");
  if (t.endsWith("```")) t = t.slice(0, -3);
  t = t.trim();
  try {
    return { ok: true, datos: JSON.parse(t) };
  } catch {
    const a = t.indexOf("{");
    const z = t.lastIndexOf("}");
    if (a >= 0 && z > a) {
      try {
        return { ok: true, datos: JSON.parse(t.slice(a, z + 1)) };
      } catch {
        /* sigue */
      }
    }
    return { ok: false, error: "JSON incompleto o mal formado", transcripcion: rescatarTranscripcion(t) };
  }
}

/** Saca "transcripcion" de un JSON cortado (va primera en el esquema, así que casi siempre está entera). */
export function rescatarTranscripcion(t: string): string | undefined {
  const m = /"transcripcion"\s*:\s*"/.exec(t);
  if (!m) return undefined;
  let i = m.index + m[0].length;
  let crudo = "";
  let cerrada = false;
  for (; i < t.length; i++) {
    const c = t[i];
    if (c === "\\") {
      crudo += t.slice(i, i + 2);
      i++;
      continue;
    }
    if (c === '"') {
      cerrada = true;
      break;
    }
    crudo += c;
  }
  if (!cerrada) crudo = crudo.replace(/\\u[0-9a-fA-F]{0,3}$|\\$/, "");
  try {
    const s = JSON.parse(`"${crudo}"`) as string;
    return cerrada ? s : `${s} […]`;
  } catch {
    return undefined;
  }
}

// ---------- 2. Números ----------

const PALABRAS: Record<string, number> = {
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, quince: 15, veinte: 20, media: 0.5, medio: 0.5, cuarto: 0.25, par: 2,
};
const FRACCIONES: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3 };

/** Número de Gemini o texto ("1/2", "1 1/2", "1,5", "½", "2-3", "dos") → número; `rango` si venía un rango. */
export function numero(x: unknown): { n: number | null; rango?: boolean } {
  if (typeof x === "number") return { n: Number.isFinite(x) ? x : null };
  if (typeof x !== "string") return { n: null };
  let s = sinTildes(x).replace(/[≈~]/g, "").trim();
  for (const [f, v] of Object.entries(FRACCIONES)) s = s.replace(f, ` ${v}`);
  const r = s.match(/^(\d+(?:[.,]\d+)?)\s*(?:-|a|o)\s*(\d+(?:[.,]\d+)?)$/);
  if (r) return { n: Math.max(parseFloat(r[1].replace(",", ".")), parseFloat(r[2].replace(",", "."))), rango: true };
  const mixto = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixto && +mixto[3]) return { n: +mixto[1] + +mixto[2] / +mixto[3] };
  const fr = s.match(/^(\d+)\/(\d+)$/);
  if (fr && +fr[2]) return { n: +fr[1] / +fr[2] };
  const dec = s.match(/^\s*(\d+(?:[.,]\d+)?)\s*(\d?\.\d+)?$/); // "1 0.5" (de "1½")
  if (dec) return { n: parseFloat(dec[1].replace(",", ".")) + (dec[2] ? parseFloat(dec[2]) : 0) };
  if (s in PALABRAS) return { n: PALABRAS[s] };
  return { n: null };
}

const REDONDEO: Partial<Record<UnidadIA, number>> = { g: 1, ml: 1 };
const redondear = (n: number, u: UnidadIA) => {
  const paso = REDONDEO[u];
  return paso ? Math.round(n / paso) * paso : Math.round(n * 100) / 100;
};
const MAXIMO: Record<UnidadIA, number> = {
  g: 10000, kg: 20, ml: 10000, l: 20, unidad: 100, taza: 20, cda: 30, cdta: 30, diente: 40, atado: 10, lata: 20,
  paquete: 20, pizca: 5, "al gusto": 0,
};

function unidad(x: unknown): { u: UnidadIA; factor: number; estimado: boolean; conocida: boolean } {
  if (typeof x === "string") {
    if (UNIDADES_OK.has(x)) return { u: x as UnidadIA, factor: 1, estimado: false, conocida: true };
    const s = sinTildes(x).replace(/\.$/, "");
    if (UNIDADES_OK.has(s)) return { u: s as UnidadIA, factor: 1, estimado: false, conocida: true };
    for (const [re, u, factor, estimado] of SINONIMOS_UNIDAD) if (re.test(s)) return { u, factor, estimado, conocida: true };
  }
  return { u: "unidad", factor: 1, estimado: false, conocida: false };
}

// ---------- 3. Ingredientes ----------

const VAGO = /(punad|chorr|poquit|pizc|ojo|lo que pida|mas o menos|como |unos |unas |harto|vaso|pocillo|tacita|cucharon|nuez de|rango| o (dos|tres|cuatro|\d))/;
const PALABRAS_VACIAS = new Set(["de", "del", "la", "el", "los", "las", "en", "con", "sin", "para", "y", "o", "al", "a"]);

/** ¿Aparece alguna palabra del nombre en la transcripción? (raíz de 4+ letras; detecta ingredientes inventados). */
function apareceEn(nombre: string, transcripcion: string): boolean {
  const t = sinTildes(transcripcion);
  const palabras = sinTildes(nombre).split(/[^a-z0-9ñ]+/).filter((w) => w.length >= 3 && !PALABRAS_VACIAS.has(w));
  if (!palabras.length) return true;
  return palabras.some((w) => t.includes(w.length > 5 ? w.slice(0, w.length - 2) : w.length > 4 ? w.slice(0, -1) : w));
}

function ingrediente(x: unknown, op: Required<OpcionesNormalizar>, transcripcion: string): IngredienteBorrador | null {
  if (!esObj(x)) return null;
  const nombreCrudo = linea(x.nombre ?? x.ingrediente, 80);
  if (!nombreCrudo) return null;
  const nombre = nombreCrudo.charAt(0).toUpperCase() + nombreCrudo.slice(1);
  const comoLoDijo = opcional(x.como_lo_dijo, 120);
  const avisos: string[] = [];

  const un = unidad(x.unidad);
  if (!un.conocida) avisos.push(`Unidad desconocida ("${linea(x.unidad, 20)}")`);
  const num = numero(x.cantidad);
  let cantidad = num.n;
  let u = un.u;
  if (cantidad != null) cantidad *= un.factor;
  if (cantidad != null && (cantidad <= 0 || !Number.isFinite(cantidad))) {
    avisos.push(`La cantidad venía mal (${String(x.cantidad)})`);
    cantidad = null;
  }
  if (cantidad != null && u !== "al gusto") {
    // Menos de 1 kg o 1 l va en g o ml (como pide la instrucción), así no se redondea a 0 kg.
    if ((u === "kg" || u === "l") && cantidad < 1) {
      cantidad *= 1000;
      u = u === "kg" ? "g" : "ml";
    }
    cantidad = redondear(cantidad, u);
    // Tan chica que se redondea a 0: no se inventa otra (antes quedaba en 0,25 de la unidad): se revisa.
    if (cantidad === 0) {
      avisos.push(`La cantidad venía mal (${linea(String(x.cantidad), 20)} ${linea(x.unidad, 20)})`);
      cantidad = null;
    }
  }
  if (u === "al gusto") cantidad = null;
  else if (cantidad == null) {
    if (u === "pizca") cantidad = 1;
    else u = "al gusto";
  }
  if (cantidad != null && cantidad > MAXIMO[u]) avisos.push("Cantidad muy alta");

  let estimado = typeof x.estimado === "boolean" ? x.estimado : comoLoDijo ? VAGO.test(sinTildes(comoLoDijo)) : false;
  if (un.estimado || num.rango) estimado = true;
  if (cantidad == null) estimado = false;

  const categoriaApp = op.adivinarCategoria(nombre);
  const categoria: CategoriaIA =
    categoriaApp !== "Otros" ? categoriaApp : CATEGORIAS_OK.has(x.categoria as string) ? (x.categoria as CategoriaIA) : "Otros";

  if (transcripcion && !apareceEn(nombre, transcripcion)) avisos.push("No aparece en la transcripción: ¿lo dijo?");

  return {
    id: op.nuevoId("ing"),
    nombre,
    cantidad,
    unidad: u,
    categoria,
    comoLoDijo,
    estimado: estimado || undefined,
    nota: opcional(x.nota, 160),
    revisar: avisos.length ? avisos.join(" · ") : undefined,
  };
}

/** Mismo nombre y unidad, con cantidad: se suman (Gemini a veces repite "cebolla" para el pino y para la salsa). */
function juntar(lista: IngredienteBorrador[]): IngredienteBorrador[] {
  const salida: IngredienteBorrador[] = [];
  const clave = (i: IngredienteBorrador) => `${sinTildes(i.nombre).replace(/(es|s)$/, "")}|${i.unidad}`;
  for (const i of lista) {
    const igual = salida.find((o) => clave(o) === clave(i));
    if (!igual) {
      salida.push(i);
      continue;
    }
    if (igual.cantidad != null && i.cantidad != null) {
      igual.cantidad = redondear(igual.cantidad + i.cantidad, igual.unidad);
      igual.estimado = igual.estimado || i.estimado || undefined;
      igual.nota = [igual.nota, i.nota].filter(Boolean).join("; ") || undefined;
      igual.comoLoDijo = [igual.comoLoDijo, i.comoLoDijo].filter(Boolean).join(" + ") || undefined;
    } else if (igual.cantidad == null && i.cantidad == null) {
      igual.nota = [igual.nota, i.nota].filter(Boolean).join("; ") || undefined;
    } else salida.push(i);
  }
  return salida;
}

// ---------- 4. Textos de lista ----------

function listaTextos(x: unknown, max: number, largo = LIMITES.largoPaso): { items: string[]; cortada: boolean } {
  if (!Array.isArray(x)) return { items: [], cortada: false };
  const items: string[] = [];
  for (const y of x) {
    // Quita la numeración ("1.", "2)", "Paso 3:", "4 -") pero no el comienzo de un decimal ("1.5 litros"),
    // una hora ("1:30") ni un rango ("10-15 minutos", "2 – 3 gotas").
    const t = linea(y, largo)
      .replace(/^(paso\s*)?\d{1,2}\s*(?:[.):](?!\d)|[-–](?!\s*\d))\s*/i, "")
      .replace(/^[-•*·–]\s*/, "")
      .trim();
    if (t && items[items.length - 1] !== t) items.push(t);
  }
  return { items: items.slice(0, max), cortada: items.length > max };
}

// ---------- 5. Emoji ----------

const EMOJI_POR_NOMBRE: [RegExp, string][] = [
  [/choclo|humita/, "🌽"], [/empanada/, "🥟"], [/torta|queque|kuchen|bizcocho|pie /, "🍰"], [/leche asada|flan|budin/, "🍮"],
  [/sopaipilla|calzon|picaron|churro/, "🍩"], [/poroto|lenteja|garbanzo/, "🫘"], [/tallarin|fideo|pasta|lasana|ñoqui/, "🍝"],
  [/pescado|jurel|merluza|reineta|salmon|congrio/, "🐟"], [/pollo|ave/, "🍗"], [/ensalada|pebre/, "🥗"], [/pan |pan$|hallulla|marraqueta/, "🍞"],
  [/arroz/, "🍚"], [/cazuela|sopa|caldo|charquican|guiso|carbonada|estofado/, "🍲"], [/jugo|bebida|cola de mono|ponche|mote con huesillo/, "🥤"],
];

function emoji(x: unknown, nombre: string): string {
  if (typeof x === "string" && x.trim()) {
    const seg = new Intl.Segmenter("es", { granularity: "grapheme" });
    for (const { segment } of seg.segment(x.trim())) if (/\p{Extended_Pictographic}/u.test(segment)) return segment;
  }
  const n = ` ${sinTildes(nombre)} `;
  return EMOJI_POR_NOMBRE.find(([re]) => re.test(n))?.[1] ?? "🍲";
}

// ---------- 6. Todo ----------

let contador = 0;
const idPorDefecto = (p: string) => `${p}_ia${Date.now().toString(36)}${(contador++).toString(36)}`;
const mayuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export function normalizar(x: unknown, opciones: OpcionesNormalizar = {}): BorradorReceta {
  const op: Required<OpcionesNormalizar> = {
    adivinarCategoria: opciones.adivinarCategoria ?? (() => "Otros"),
    nuevoId: opciones.nuevoId ?? idPorDefecto,
  };
  const d: Obj = esObj(x) ? x : {};
  const avisos: string[] = [];
  if (!esObj(x)) avisos.push("La respuesta no traía una receta.");

  const transcripcionCruda = typeof d.transcripcion === "string" ? d.transcripcion.normalize("NFC").replace(CONTROL, "").trim() : "";
  const transcripcion = transcripcionCruda.slice(0, LIMITES.transcripcion);

  const ingCrudos = Array.isArray(d.ingredientes) ? d.ingredientes : [];
  let ingredientes = juntar(ingCrudos.map((i) => ingrediente(i, op, transcripcion)).filter((i): i is IngredienteBorrador => i !== null));
  if (ingredientes.length > LIMITES.ingredientes) {
    ingredientes = ingredientes.slice(0, LIMITES.ingredientes);
    avisos.push(`Se dejaron los primeros ${LIMITES.ingredientes} ingredientes.`);
  }
  const pasos = listaTextos(d.pasos, LIMITES.pasos);
  if (pasos.cortada) avisos.push(`Se dejaron los primeros ${LIMITES.pasos} pasos.`);
  const secretos = listaTextos(d.secretos, LIMITES.secretos).items;
  const dudas = listaTextos(d.dudas, LIMITES.dudas).items;

  const hayContenido = ingredientes.length > 0 || pasos.items.length > 0;
  const esReceta = d.es_receta !== false && hayContenido;
  if (d.es_receta === true && !hayContenido) avisos.push("No se encontraron ingredientes ni pasos.");
  if (d.es_receta === false && hayContenido) avisos.push("Gemini dijo que no es una receta, pero trajo ingredientes o pasos: revisa.");

  let nombre = mayuscula(linea(d.nombre, 80));
  if (!nombre) {
    nombre = "Receta sin nombre";
    if (esReceta && !dudas.some((q) => /llama|nombre/i.test(q))) dudas.push("¿Cómo se llama este plato?");
  }

  const p = numero(d.porciones).n;
  let porciones = p != null && p >= 1 ? Math.round(p) : 0;
  let porcionesEstimadas = d.porciones_estimadas === true;
  if (!porciones) {
    porciones = 4;
    porcionesEstimadas = true;
    if (esReceta) avisos.push("No venían las porciones: quedó en 4.");
  } else if (porciones > 100) {
    porciones = 100;
    avisos.push("Porciones muy altas: quedó en 100, revisa.");
  }
  const preguntaPorciones = () => dudas.some((q) => /porci|personas|alcanza|rinde|salen/i.test(q));
  // En la app las porciones son personas (las compras se escalan por personas): muchas porciones suelen ser
  // las unidades que salen ("salen como 40"), que la familia tiene que cambiar por personas.
  if (esReceta && porciones > 12 && !preguntaPorciones())
    dudas.push(`¿Son ${porciones} personas, o son las unidades que salen? Las porciones son personas: con ellas se calculan las compras.`);
  if (esReceta && porcionesEstimadas && !preguntaPorciones()) dudas.push("¿Para cuántas personas alcanza?");

  const t = numero(d.tiempo_min ?? d.tiempoMin).n;
  let tiempoMin: number | undefined = t != null && t >= 1 ? Math.round(t) : undefined;
  if (tiempoMin && tiempoMin > 2880) {
    tiempoMin = undefined;
    avisos.push("Tiempo total imposible: se quitó.");
  }

  return {
    esReceta,
    motivo: esReceta ? undefined : opcional(d.motivo) ?? (hayContenido ? undefined : "No se encontró una receta en el audio."),
    nombre,
    emoji: emoji(d.emoji, nombre),
    porciones,
    porcionesEstimadas,
    tiempoMin,
    tiempoEstimado: tiempoMin != null && d.tiempo_estimado === true,
    ingredientes,
    pasos: pasos.items,
    secretos,
    nota: opcional(d.nota, 600),
    dudas: dudas.slice(0, LIMITES.dudas),
    transcripcion,
    avisos,
  };
}

// ---------- 7. Borrador → Receta de la app ----------

/** Enlace de la receta con su dictado (el audio y lo que se dijo quedan en Blobs). */
export interface EnlaceDictado {
  id: string;
  fecha: string; // ISO: cuándo se subió el audio
  segundos?: number;
}

const corto = (x: string | undefined, max: number) => (x && x.trim() ? x.trim().slice(0, max) : undefined);

/**
 * Borrador → `Receta` de lib/datos/tipos.ts, con los campos opcionales de las recetas dictadas
 * (comoLoDijo, estimado, nota, dudas, dictado). Id fijo `rec_<id del dictado>`: guardar dos veces el mismo
 * borrador no duplica la receta. Las claves sin valor no aparecen (como en las recetas de antes), y los
 * topes son los de lib/datos/normalizar.ts (≤ 200 por texto de ingrediente, ≤ 20 dudas de ≤ 300).
 */
export function aRecetaApp(b: BorradorReceta, dictado: EnlaceDictado): Receta {
  const nota = [b.nota, b.secretos.length ? `Secretos: ${b.secretos.join(" · ")}` : ""].filter(Boolean).join("\n\n");
  const dudas = [...b.dudas];
  if (b.tiempoEstimado && b.tiempoMin && !dudas.some((q) => /tiempo|demora|minutos|rato/i.test(q)))
    dudas.push(`¿Cuánto se demora en total? Puse ≈ ${b.tiempoMin} min.`);
  const listaDudas = dudas.map((q) => corto(q, 300)).filter((q): q is string => !!q).slice(0, 20);
  const ingredientes = b.ingredientes.map((i): Ingrediente => {
    const comoLoDijo = corto(i.comoLoDijo, 200);
    const notaIng = corto(i.nota, 200);
    const cantidad = i.unidad === "al gusto" ? null : i.cantidad;
    return {
      id: i.id,
      nombre: i.nombre,
      cantidad,
      unidad: i.unidad,
      categoria: i.categoria,
      ...(comoLoDijo ? { comoLoDijo } : {}),
      ...(i.estimado === true && cantidad != null ? { estimado: true as const } : {}),
      ...(notaIng ? { nota: notaIng } : {}),
    };
  });
  const segundos = dictado.segundos != null && dictado.segundos > 0 ? Math.round(dictado.segundos) : undefined;
  return {
    id: `rec_${dictado.id}`,
    nombre: b.nombre || "Receta sin nombre",
    emoji: b.emoji || "🍲",
    porciones: b.porciones > 0 ? Math.round(b.porciones) : 4,
    ...(b.tiempoMin && b.tiempoMin > 0 ? { tiempoMin: Math.round(b.tiempoMin) } : {}),
    ingredientes,
    pasos: [...b.pasos],
    ...(nota ? { nota } : {}),
    ...(listaDudas.length ? { dudas: listaDudas } : {}),
    dictado: { id: dictado.id, fecha: dictado.fecha, ...(segundos ? { segundos } : {}) },
  };
}

/**
 * Lo que queda cuando Gemini no alcanzó a ordenar la receta (respuesta cortada o dañada) pero sí se
 * rescató la transcripción: un borrador mínimo para completar a mano.
 */
export const AVISO_RESCATE =
  "Gemini no alcanzó a ordenar la receta: abajo está lo que se dijo. Toca «Pedir otra versión» o complétala a mano.";
export function borradorRescate(transcripcion: string): BorradorReceta {
  return {
    esReceta: true,
    nombre: "Receta dictada",
    emoji: "🍲",
    porciones: 4,
    porcionesEstimadas: true,
    tiempoEstimado: false,
    ingredientes: [],
    pasos: [],
    secretos: [],
    dudas: [],
    transcripcion: transcripcion.normalize("NFC").replace(CONTROL, "").trim().slice(0, LIMITES.transcripcion),
    avisos: [AVISO_RESCATE],
  };
}
