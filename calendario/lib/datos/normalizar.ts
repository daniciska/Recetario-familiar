// Revisa y repara datos que vienen de afuera (localStorage o un respaldo), para que un archivo
// mal formado o de otra versión nunca deje la app caída.

import { CATEGORIAS, UNIDADES } from "../compras";
import type {
  Ajustes,
  CategoriaCompra,
  ComidaPlanificada,
  EstadoApp,
  Evento,
  Ingrediente,
  ItemCompra,
  Miembro,
  PlanComidas,
  Receta,
  Repeticion,
  Tarea,
  Unidad,
} from "./tipos";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const CLAVE_PLAN = /^\d{4}-\d{2}-\d{2}\|(desayuno|colacion|almuerzo|once|cena)$/;
const REPETICIONES: Repeticion[] = ["nunca", "diaria", "semanal", "mensual"];
const UNIDADES_OK = new Set<string>(UNIDADES.map((u) => u.valor));
const CATEGORIAS_OK = new Set<string>(CATEGORIAS.map((c) => c.nombre));

type Obj = Record<string, unknown>;
const esObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const txt = (x: unknown, def = ""): string => (typeof x === "string" ? x : def);
const txtOpc = (x: unknown): string | undefined => (typeof x === "string" && x.trim() ? x : undefined);
const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const fecha = (x: unknown): string | undefined => (typeof x === "string" && FECHA.test(x) ? x : undefined);
const hora = (x: unknown): string | undefined => (typeof x === "string" && HORA.test(x) ? x : undefined);

let contador = 0;
const idNuevo = (p: string) => `${p}_r${Date.now().toString(36)}${(contador++).toString(36)}`;
const id = (x: unknown, p: string) => (typeof x === "string" && x ? x : idNuevo(p));

function lista<T>(x: unknown, f: (y: unknown) => T | null): T[] {
  return Array.isArray(x) ? x.map(f).filter((y): y is T => y !== null) : [];
}

function ajustes(x: unknown, base: Ajustes): Ajustes {
  if (!esObj(x)) return base;
  const lat = num(x.latitud);
  const lon = num(x.longitud);
  const coordOk = lat != null && lon != null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  return {
    nombreFamilia: txt(x.nombreFamilia, base.nombreFamilia),
    ciudad: coordOk ? txt(x.ciudad, base.ciudad) : base.ciudad,
    latitud: coordOk ? lat : base.latitud,
    longitud: coordOk ? lon : base.longitud,
    tema: x.tema === "auto" || x.tema === "claro" || x.tema === "noche" ? x.tema : base.tema,
    nocheDesde: hora(x.nocheDesde) ?? base.nocheDesde,
    nocheHasta: hora(x.nocheHasta) ?? base.nocheHasta,
  };
}

function miembro(x: unknown): Miembro | null {
  if (!esObj(x) || typeof x.id !== "string") return null;
  return {
    id: x.id,
    nombre: txt(x.nombre, "Sin nombre"),
    color: /^#[0-9a-f]{6}$/i.test(txt(x.color)) ? (x.color as string) : "#999999",
    emoji: txt(x.emoji, "🙂") || "🙂",
  };
}

function evento(x: unknown): Evento | null {
  if (!esObj(x)) return null;
  const f = fecha(x.fecha);
  if (!f) return null;
  const repeticion = REPETICIONES.includes(x.repeticion as Repeticion) ? (x.repeticion as Repeticion) : "nunca";
  const todoElDia = x.todoElDia === true;
  let repetirHasta = repeticion === "nunca" ? undefined : fecha(x.repetirHasta);
  // Un "hasta" anterior al inicio dejaría el evento invisible: se deja en una sola vez.
  if (repetirHasta && repetirHasta < f) repetirHasta = f;
  // Un evento que no se repite no lleva excepciones (una sobre su única fecha lo haría invisible).
  const excepciones = repeticion === "nunca" ? [] : lista(x.excepciones, (e) => fecha(e) ?? null);
  return {
    id: id(x.id, "ev"),
    titulo: txt(x.titulo, "Sin título"),
    miembros: lista(x.miembros, (m) => (typeof m === "string" ? m : null)),
    fecha: f,
    todoElDia,
    horaInicio: todoElDia ? undefined : (hora(x.horaInicio) ?? "09:00"),
    horaFin: todoElDia ? undefined : hora(x.horaFin),
    repeticion,
    repetirHasta,
    nota: txtOpc(x.nota),
    excepciones: excepciones.length ? excepciones : undefined,
  };
}

function ingrediente(x: unknown): Ingrediente | null {
  if (!esObj(x)) return null;
  const unidad = UNIDADES_OK.has(x.unidad as string) ? (x.unidad as Unidad) : "unidad";
  const c = num(x.cantidad);
  return {
    id: id(x.id, "ing"),
    nombre: txt(x.nombre),
    cantidad: unidad === "al gusto" || c == null || c < 0 ? null : c,
    unidad,
    categoria: CATEGORIAS_OK.has(x.categoria as string) ? (x.categoria as CategoriaCompra) : "Otros",
  };
}

function receta(x: unknown): Receta | null {
  if (!esObj(x)) return null;
  const porciones = num(x.porciones);
  const tiempo = num(x.tiempoMin);
  const foto = txt(x.foto);
  return {
    id: id(x.id, "rec"),
    nombre: txt(x.nombre, "Receta sin nombre"),
    emoji: txt(x.emoji, "🍲") || "🍲",
    foto: /^(data:image\/|https?:\/\/|\/)/.test(foto) ? foto : undefined,
    porciones: porciones && porciones > 0 ? Math.round(porciones) : 4,
    tiempoMin: tiempo && tiempo > 0 ? Math.round(tiempo) : undefined,
    ingredientes: lista(x.ingredientes, ingrediente),
    pasos: lista(x.pasos, (p) => (typeof p === "string" ? p : null)),
    nota: txtOpc(x.nota),
  };
}

function plan(x: unknown): PlanComidas {
  const p: PlanComidas = {};
  if (!esObj(x)) return p;
  for (const [k, v] of Object.entries(x)) {
    if (!CLAVE_PLAN.test(k) || !esObj(v)) continue;
    const c: ComidaPlanificada = {
      recetaId: txtOpc(v.recetaId),
      texto: txtOpc(v.texto),
      porciones: Math.max(1, Math.round(num(v.porciones) ?? 4)),
    };
    if (c.recetaId || c.texto) p[k] = c;
  }
  return p;
}

function itemCompra(x: unknown): ItemCompra | null {
  if (!esObj(x) || typeof x.nombre !== "string" || !x.nombre.trim()) return null;
  const unidad = UNIDADES_OK.has(x.unidad as string) ? (x.unidad as Unidad) : "unidad";
  return {
    id: id(x.id, "com"),
    nombre: x.nombre,
    cantidad: num(x.cantidad),
    unidad,
    categoria: CATEGORIAS_OK.has(x.categoria as string) ? (x.categoria as CategoriaCompra) : "Otros",
    comprado: x.comprado === true,
    origen: x.origen === "menu" ? "menu" : "manual",
    semana: fecha(x.semana),
    detalle: txtOpc(x.detalle),
    oculto: x.oculto === true ? true : undefined,
  };
}

function tarea(x: unknown): Tarea | null {
  if (!esObj(x) || typeof x.titulo !== "string") return null;
  return {
    id: id(x.id, "tar"),
    titulo: x.titulo,
    miembroId: txtOpc(x.miembroId),
    hecha: x.hecha === true,
    creada: txt(x.creada, new Date().toISOString()),
  };
}

/**
 * Lo que está guardado en este equipo, reparado elemento por elemento. Una colección que falte o
 * esté dañada queda vacía (nunca se mezcla con los datos de ejemplo); los ajustes toman los valores
 * por defecto que falten.
 */
export function normalizarGuardado(crudo: Partial<Record<keyof EstadoApp, unknown>>, ajustesBase: Ajustes): EstadoApp {
  return {
    version: 1,
    ajustes: ajustes(crudo.ajustes, ajustesBase),
    miembros: lista(crudo.miembros, miembro),
    eventos: lista(crudo.eventos, evento),
    recetas: lista(crudo.recetas, receta),
    plan: plan(crudo.plan),
    compras: lista(crudo.compras, itemCompra),
    tareas: lista(crudo.tareas, tarea),
  };
}

/** Un respaldo descargado de esta app. Lo que no traiga queda vacío (no se mezcla con los ejemplos). */
export function normalizarRespaldo(crudo: unknown, ajustesBase: Ajustes): { estado: EstadoApp } | { error: string } {
  if (!esObj(crudo)) return { error: "Ese archivo no parece un respaldo de esta app." };
  if (typeof crudo.version === "number" && crudo.version > 1)
    return { error: "Ese respaldo es de una versión más nueva de la app. Actualiza la página e inténtalo de nuevo." };
  if (!Array.isArray(crudo.miembros) || !Array.isArray(crudo.eventos) || !Array.isArray(crudo.recetas))
    return { error: "Ese archivo no parece un respaldo de esta app." };
  return {
    estado: {
      version: 1,
      ajustes: ajustes(crudo.ajustes, ajustesBase),
      miembros: lista(crudo.miembros, miembro),
      eventos: lista(crudo.eventos, evento),
      recetas: lista(crudo.recetas, receta),
      plan: plan(crudo.plan),
      compras: lista(crudo.compras, itemCompra),
      tareas: lista(crudo.tareas, tarea),
    },
  };
}
