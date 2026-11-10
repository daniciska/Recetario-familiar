// Revisar y guardar el borrador de una receta dictada (components/VistaRecetas.tsx, EditorReceta), en
// funciones puras que prueba pruebas/recetas/revision.test.ts:
// - lo que se va corrigiendo queda en este equipo (localStorage `calendario-familiar:revision:<id>`), así
//   cerrar a medio revisar no pierde nada. Vale sólo para esa versión del borrador (`actualizado` del
//   dictado): después de «Pedir otra versión» se parte del borrador nuevo;
// - lo que se guarda va sin claves vacías: «estimado» sólo con cantidad, notas y dudas recortadas.

import { normalizarReceta } from "../datos/normalizar";
import type { Ingrediente, Receta } from "../datos/tipos";
import type { DictadoPublico } from "./tipos";

type Almacen = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** localStorage, o null si este navegador no lo deja usar. */
function almacenLocal(): Almacen | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export const claveRevision = (id: string) => `calendario-familiar:revision:${id}`;

/** Lo que se había corregido de este borrador (o null: nada guardado, de otra versión o dañado). */
export function leerRevision(d: Pick<DictadoPublico, "id" | "actualizado">, almacen = almacenLocal()): Receta | null {
  try {
    const x = JSON.parse(almacen?.getItem(claveRevision(d.id)) ?? "null") as { actualizado?: unknown; receta?: unknown } | null;
    if (!x || typeof x !== "object" || x.actualizado !== d.actualizado) return null;
    const r = normalizarReceta(x.receta);
    return r && r.id === `rec_${d.id}` ? r : null;
  } catch {
    return null;
  }
}

/** Guarda lo corregido. false si no se pudo (sin espacio, sin almacenamiento): se revisa igual. */
export function guardarRevision(d: Pick<DictadoPublico, "id" | "actualizado">, r: Receta, almacen = almacenLocal()): boolean {
  try {
    if (!almacen) return false;
    almacen.setItem(claveRevision(d.id), JSON.stringify({ actualizado: d.actualizado, receta: r }));
    return true;
  } catch {
    return false;
  }
}

export function borrarRevision(id: string, almacen = almacenLocal()): void {
  try {
    almacen?.removeItem(claveRevision(id));
  } catch {
    /* nada */
  }
}

/** Un borrador vacío por si el dictado no trae uno (no debería pasar con uno «listo»). */
export function borradorVacio(
  d: Pick<DictadoPublico, "id" | "nombre" | "emoji" | "creado" | "segundos">,
  ingredienteVacio: () => Ingrediente,
): Receta {
  return {
    id: `rec_${d.id}`,
    nombre: d.nombre ?? "Receta dictada",
    emoji: d.emoji ?? "🍲",
    porciones: 4,
    ingredientes: [ingredienteVacio()],
    pasos: [""],
    dictado: { id: d.id, fecha: d.creado, ...(d.segundos ? { segundos: d.segundos } : {}) },
  };
}

/** Un ingrediente como se guarda: nombre recortado, sin claves vacías y «estimado» sólo con cantidad. */
export function limpiarIngrediente({ comoLoDijo, estimado, nota, ...i }: Ingrediente): Ingrediente {
  const como = comoLoDijo?.trim().slice(0, 200);
  const n = nota?.trim().slice(0, 200);
  return {
    ...i,
    nombre: i.nombre.trim(),
    ...(como ? { comoLoDijo: como } : {}),
    ...(estimado && i.cantidad != null ? { estimado: true as const } : {}),
    ...(n ? { nota: n } : {}),
  };
}

/**
 * La receta como se guarda (la foto se resuelve aparte): sin ingredientes sin nombre ni pasos vacíos, nota y
 * dudas recortadas (sin la clave si quedan vacías) y minutos redondeados. Conserva `dictado`.
 */
export function limpiarReceta({ dudas, nota, tiempoMin, ...r }: Receta): Receta {
  const qs = (dudas ?? []).map((q) => q.trim().slice(0, 300)).filter(Boolean).slice(0, 20);
  const n = nota?.trim();
  return {
    ...r,
    nombre: r.nombre.trim(),
    ...(tiempoMin && tiempoMin > 0 ? { tiempoMin: Math.round(tiempoMin) } : {}),
    ingredientes: r.ingredientes.filter((i) => i.nombre.trim()).map(limpiarIngrediente),
    pasos: r.pasos.map((p) => p.trim()).filter(Boolean),
    ...(n ? { nota: n } : {}),
    ...(qs.length ? { dudas: qs } : {}),
  };
}
