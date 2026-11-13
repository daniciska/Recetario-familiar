import type { ComidaPlanificada, ItemComida, PlanComidas, Receta, TipoComida } from "./datos/tipos";
import { sumarDias } from "./fechas";

export const TIPOS_COMIDA: { id: TipoComida; nombre: string; emoji: string }[] = [
  { id: "desayuno", nombre: "Desayuno", emoji: "☕" },
  // La del colegio o la pega, a media mañana.
  { id: "colacion", nombre: "Colación", emoji: "🍎" },
  { id: "almuerzo", nombre: "Almuerzo", emoji: "🍲" },
  { id: "once", nombre: "Once", emoji: "🫖" },
  { id: "cena", nombre: "Cena", emoji: "🌙" },
];

/** Atajo de la colación que deja el día vacío a propósito: no es algo que "se cocina". */
export const SIN_COLACION = "Sin colación";

/** Un espacio para llenar en una comida (con una receta o con texto libre). */
export interface Espacio {
  /** Nombre fijo ("Proteína"). Sin nombre: espacio libre, donde va cualquier cosa. */
  nombre?: string;
  /** Ejemplo que se ve en el espacio vacío. */
  ejemplo: string;
  /** Textos para llenarlo de un toque. */
  atajos: string[];
}

const ATAJOS_DESAYUNO = ["Pan con palta", "Pan con mantequilla", "Tostadas", "Fruta", "Yogur", "Leche", "Té", "Café"];
const ATAJOS_COLACION = ["Fruta", "Yogur", "Sándwich", "Barra de cereal", "Galletas"];
const PROTEINA: Espacio = { nombre: "Proteína", ejemplo: "Pollo, carne, legumbres…", atajos: ["Pollo", "Carne", "Pescado", "Huevo"] };
const CARBOHIDRATO: Espacio = { nombre: "Carbohidrato", ejemplo: "Arroz, papas, fideos…", atajos: ["Arroz", "Papas", "Puré", "Fideos"] };
const VERDURAS: Espacio = { nombre: "Verduras", ejemplo: "Ensalada, verduras salteadas…", atajos: ["Ensalada", "Ensalada chilena", "Verduras salteadas"] };

/**
 * Los espacios de cada comida, como los pidió la familia (nov 2026): «En colación siempre ponemos 3
 * items, por ej 2 frutas y 1 carbo… En almuerzo, 1 proteína, 1 carbo, verduras, y postre. En cena, 1
 * proteína, carbo, verduras. En desayuno en general hay más cosas disponibles, unos 4 items.» De la
 * once no dijeron nada: queda con un espacio libre, como antes.
 *
 * Se puede cambiar aquí sin tocar lo guardado: una comida con más ítems que espacios los muestra
 * todos, y a una con menos le quedan espacios vacíos. Cambiar el orden sí cambia qué espacio es cuál
 * (el primero es el que ven los equipos con la versión anterior a los espacios).
 */
export const ESPACIOS_COMIDA: Record<TipoComida, Espacio[]> = {
  desayuno: [
    { ejemplo: "Pan", atajos: ATAJOS_DESAYUNO },
    { ejemplo: "Fruta", atajos: ATAJOS_DESAYUNO },
    { ejemplo: "Lácteo", atajos: ATAJOS_DESAYUNO },
    { ejemplo: "Bebida", atajos: ATAJOS_DESAYUNO },
  ],
  colacion: [
    { ejemplo: "Fruta", atajos: ATAJOS_COLACION },
    { ejemplo: "Fruta", atajos: ATAJOS_COLACION },
    { ejemplo: "Carbohidrato", atajos: ATAJOS_COLACION },
  ],
  almuerzo: [PROTEINA, CARBOHIDRATO, VERDURAS, { nombre: "Postre", ejemplo: "Fruta, jalea…", atajos: ["Fruta", "Jalea", "Yogur", "Helado"] }],
  once: [{ ejemplo: "Pan con palta", atajos: ["Pan con palta", "Pan con queso", "Té", "Café", "Leche"] }],
  cena: [PROTEINA, CARBOHIDRATO, VERDURAS],
};

/** Atajos para la comida entera: queda sólo eso (en el primer espacio) y los demás se vacían. */
export function atajosComida(tipo: TipoComida): string[] {
  return tipo === "colacion" ? [SIN_COLACION] : ["Sobras", "Comemos fuera", "Delivery", "Cada uno se las arregla"];
}

export function claveComida(fecha: string, tipo: string) {
  return `${fecha}|${tipo}`;
}

// ---------- Ítems de una comida ----------

const lleno = (x: ItemComida | null | undefined): x is ItemComida => !!x && !!(x.recetaId || x.texto);

/** Sólo lo del ítem (sin las porciones ni los demás espacios de la comida). */
function soloItem(x: ItemComida): ItemComida {
  return { ...(x.recetaId ? { recetaId: x.recetaId } : {}), ...(x.texto ? { texto: x.texto } : {}) };
}

/**
 * Los ítems de una comida, uno por espacio (null = vacío): nunca menos que los espacios de su tipo,
 * más si la comida trae más. Lo guardado antes de los espacios (un ítem por comida) queda en el primero.
 */
export function itemsDe(c: ComidaPlanificada | undefined, tipo: TipoComida): (ItemComida | null)[] {
  const n = ESPACIOS_COMIDA[tipo].length;
  const r = (c ? [c, ...(c.mas ?? [])] : []).map((x) => (lleno(x) ? soloItem(x) : null));
  while (r.length > n && !r[r.length - 1]) r.pop();
  while (r.length < n) r.push(null);
  return r;
}

/** Como `itemsDe`, pero una receta que ya no está en la biblioteca (y sin texto) cuenta como vacío. */
export function itemsVisibles(
  c: ComidaPlanificada | undefined,
  tipo: TipoComida,
  recetas: Map<string, Receta>,
): (ItemComida | null)[] {
  return itemsDe(c, tipo).map((x) => (x && nombreItem(x, recetas) ? x : null));
}

/** Los ítems llenos de una comida, en orden (para la lista de compras). */
export function itemsLlenos(c: ComidaPlanificada | undefined): ItemComida[] {
  return c ? [c, ...(c.mas ?? [])].filter(lleno).map(soloItem) : [];
}

/** Arma la comida con sus ítems: el primero en la raíz y los demás en `mas`. null si quedó vacía. */
export function armarComida(items: (ItemComida | null)[], porciones: number): ComidaPlanificada | null {
  const limpios = items.map((x) => (lleno(x) ? soloItem(x) : null));
  while (limpios.length && !limpios[limpios.length - 1]) limpios.pop();
  if (!limpios.length) return null;
  const [primero, ...mas] = limpios;
  return { ...(primero ?? {}), porciones, ...(mas.length ? { mas } : {}) };
}

/** Pone (o vacía, con null) el ítem del espacio `i` de una comida, sin tocar los otros espacios. */
export function ponerItem(
  plan: PlanComidas,
  clave: string,
  tipo: TipoComida,
  i: number,
  item: ItemComida | null,
  porciones: number,
): PlanComidas {
  const items = itemsDe(plan[clave], tipo);
  while (items.length <= i) items.push(null);
  items[i] = item;
  return ponerComida(plan, clave, armarComida(items, porciones));
}

/** Reemplaza la comida entera (null la quita). */
export function ponerComida(plan: PlanComidas, clave: string, c: ComidaPlanificada | null): PlanComidas {
  const n = { ...plan };
  if (c) n[clave] = c;
  else delete n[clave];
  return n;
}

/** Copia de una comida que no comparte nada con el original. */
export function copiarComida(c: ComidaPlanificada): ComidaPlanificada {
  return { ...c, ...(c.mas ? { mas: c.mas.map((x) => (x ? { ...x } : null)) } : {}) };
}

/**
 * "Repetir semana": copia cada comida de la semana anterior a los días de `dias` que la tienen vacía.
 * `copias` son exactamente las comidas que se pusieron (clave → comida), para poder deshacerlo.
 */
export function repetirSemana(plan: PlanComidas, dias: string[]): { plan: PlanComidas; copiadas: number; copias: PlanComidas } {
  const nuevo = { ...plan };
  const copias: PlanComidas = {};
  let copiadas = 0;
  for (const f of dias)
    for (const t of TIPOS_COMIDA) {
      const prev = plan[claveComida(sumarDias(f, -7), t.id)];
      const k = claveComida(f, t.id);
      if (prev && !nuevo[k]) {
        nuevo[k] = copiarComida(prev);
        copias[k] = copiarComida(prev);
        copiadas++;
      }
    }
  return { plan: nuevo, copiadas, copias };
}

/** La comida en un texto que no depende del orden de las claves ni de las que valen undefined. */
function huellaComida(c: unknown): string {
  return JSON.stringify(c, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v,
  );
}

/**
 * Deshace "Repetir semana": quita del plan las comidas de `copias` (lo que devolvió `repetirSemana`)
 * que siguen exactamente como se copiaron. Las que alguien cambió o quitó entretanto (en este equipo o
 * en otro) no se tocan, y tampoco ninguna otra comida.
 */
export function deshacerRepetir(plan: PlanComidas, copias: PlanComidas): { plan: PlanComidas; quitadas: number; cambiadas: number } {
  const nuevo = { ...plan };
  let quitadas = 0;
  let cambiadas = 0;
  for (const [k, c] of Object.entries(copias)) {
    if (!nuevo[k]) continue;
    if (huellaComida(nuevo[k]) === huellaComida(c)) {
      delete nuevo[k];
      quitadas++;
    } else cambiadas++;
  }
  return { plan: nuevo, quitadas, cambiadas };
}

/**
 * Operaciones que se hacen de a una: cada `poner(op)` empieza cuando terminó la anterior (aunque haya
 * fallado) y devuelve lo que devuelve `op`. Con la fila vacía, `op` empieza en el acto (en el mismo toque).
 * `ocupada()` dice si queda alguna sin terminar.
 *
 * El menú la usa para «Repetir» y «Deshacer»: los guardados de una misma colección salen en paralelo con
 * la misma versión y el servidor los puede recibir al revés. Entonces el primero recibe un conflicto y
 * `actualizar` lo vuelve a aplicar encima del segundo: «Repetir» volvería a copiar lo que «Deshacer» quitó.
 */
export function crearFila() {
  let ultima: Promise<unknown> = Promise.resolve();
  let pendientes = 0;
  return {
    ocupada: () => pendientes > 0,
    poner<T>(op: () => Promise<T>): Promise<T> {
      const correr = (): Promise<T> => {
        try {
          return Promise.resolve(op());
        } catch (e) {
          return Promise.reject(e);
        }
      };
      const libre = pendientes === 0;
      pendientes++;
      const p = (libre ? correr() : ultima.then(correr)).finally(() => {
        pendientes--;
      });
      ultima = p.catch(() => {});
      return p;
    },
  };
}

/** Saca una receta (que se borró) de todos los espacios del plan; la comida que queda vacía se quita. */
export function quitarRecetaDelPlan(plan: PlanComidas, recetaId: string): PlanComidas {
  const n: PlanComidas = {};
  for (const [k, c] of Object.entries(plan)) {
    const items = [c, ...(c.mas ?? [])];
    if (!items.some((x) => x?.recetaId === recetaId)) {
      n[k] = c;
      continue;
    }
    const r = armarComida(
      items.map((x) => (x?.recetaId === recetaId ? null : x)),
      c.porciones,
    );
    if (r) n[k] = r;
  }
  return n;
}

// ---------- Para mostrar ----------

export function nombreItem(x: ItemComida, recetas: Map<string, Receta>): string {
  if (x.recetaId) return recetas.get(x.recetaId)?.nombre ?? x.texto ?? "";
  return x.texto ?? "";
}

/** Los nombres de lo que hay en la comida, en orden (sin los vacíos ni las recetas borradas). */
export function nombresComida(c: ComidaPlanificada, recetas: Map<string, Receta>): string[] {
  return itemsLlenos(c)
    .map((x) => nombreItem(x, recetas))
    .filter(Boolean);
}

/** Todo lo de la comida en una línea: "Charquicán · Ensalada · Fruta". */
export function nombreComida(c: ComidaPlanificada, recetas: Map<string, Receta>): string {
  return nombresComida(c, recetas).join(" · ");
}

const comparable = (s: string) => s.trim().replace(/\s+/g, " ").toLocaleLowerCase("es");

/**
 * La comida es uno de los atajos para la comida entera («Sin colación», «Comemos fuera», «Delivery»):
 * sólo ese texto, en el primer espacio y sin receta. Se muestra sin espacios por llenar, y el editor
 * la abre en el primer espacio. Con `recetas`, una receta borrada en otro espacio cuenta como vacío.
 */
export function esComidaEntera(c: ComidaPlanificada | undefined, tipo: TipoComida, recetas?: Map<string, Receta>): boolean {
  const [primero, ...resto] = recetas ? itemsVisibles(c, tipo, recetas) : itemsDe(c, tipo);
  if (!primero || primero.recetaId || !primero.texto || resto.some(Boolean)) return false;
  const texto = comparable(primero.texto);
  return atajosComida(tipo).some((a) => comparable(a) === texto);
}

/** El emoji de la primera receta de la comida (undefined si no tiene recetas de la biblioteca). */
export function emojiComida(c: ComidaPlanificada | undefined, recetas: Map<string, Receta>): string | undefined {
  for (const x of itemsLlenos(c)) {
    const r = x.recetaId ? recetas.get(x.recetaId) : undefined;
    if (r) return r.emoji || "🍽️";
  }
  return undefined;
}

// ---------- Equipos con la versión anterior ----------

type Obj = Record<string, unknown>;
const esObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const conTexto = (x: unknown) => typeof x === "string" && x.trim() !== "";

/**
 * Para el servidor, al guardar el plan que manda un equipo con la versión anterior a los espacios (no
 * manda `esquema`). Ese equipo sólo conoce el primer espacio de cada comida: su normalizar descarta
 * `mas` y las comidas que tienen vacío el primero, y como guarda el plan entero, los borraría. Aquí
 * se reponen desde `previo` (lo guardado, la versión de la que partió ese equipo): el equipo viejo
 * cambia sólo el primer espacio y las porciones, y los demás espacios quedan como estaban, también
 * si quitó la comida (la ve vacía) o le puso otra cosa.
 * No cambia `previo` ni `entrante`; si alguno no es un objeto, devuelve `entrante` tal cual.
 */
export function conservarItemsPlan(previo: unknown, entrante: unknown): unknown {
  if (!esObj(previo) || !esObj(entrante)) return entrante;
  const r: Obj = { ...entrante };
  for (const [k, p] of Object.entries(previo)) {
    if (!esObj(p) || !Array.isArray(p.mas) || !p.mas.some((x) => esObj(x) && (conTexto(x.recetaId) || conTexto(x.texto)))) continue;
    const e = r[k];
    if (esObj(e)) {
      if (!Array.isArray(e.mas)) r[k] = { ...e, mas: p.mas };
    } else r[k] = { porciones: p.porciones, mas: p.mas };
  }
  return r;
}
