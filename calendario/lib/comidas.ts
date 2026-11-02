import type { ComidaPlanificada, Receta, TipoComida } from "./datos/tipos";

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

export function nombreComida(c: ComidaPlanificada, recetas: Map<string, Receta>): string {
  if (c.recetaId) return recetas.get(c.recetaId)?.nombre ?? c.texto ?? "";
  return c.texto ?? "";
}
