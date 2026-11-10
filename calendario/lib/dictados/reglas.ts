// Lo que useDictados decide solo, en funciones puras (sin React ni red) para poder probarlo
// (pruebas/recetas/cliente.test.ts): cuándo volver a pedir «procesar», cuándo mirar de nuevo la lista,
// qué audios del equipo se suben solos y qué dictados sobran porque su receta ya está guardada.

import type { ResumenLocal } from "./pendientes";
import { esReintentable, type DictadoPublico, type EstadoGemini } from "./tipos";

/** Cada cuánto se mira la lista mientras algo está en camino. */
export const CADA_MS = 20_000;
/** Un dictado «subido» hace más que esto: el disparo a la función en segundo plano no llegó; se pide otra vez. */
export const ESPERA_SUBIDO_MS = 30_000;
/** Con audios en el equipo que no se pudieron subir: se reintenta cada tanto (además de al volver internet). */
export const CADA_LOCALES_MS = 60_000;

/**
 * Corridas (`intentos` del servidor) hasta las que la app reintenta sola un «se cortó» o un «ocupado» (y el
 * chip dice «Se reintenta sola»). Pasado esto, «Necesita ayuda»: así la tablet de la pared, que pasa el día
 * abierta, no gasta la cuota de Gemini con un audio que falla siempre.
 */
export const MAX_INTENTOS_SOLOS = { se_corto: 4, ocupado: 8 } as const;

/**
 * ¿La app debería pedir «procesar» sola ahora? useDictados lo pide una vez por cada (id, actualizado).
 * `veces`: cuántas veces lo pidió sola esta pestaña para este dictado (un «subido» que no avanza se vuelve
 * a pedir a los 30 s, 1 min, 2 min… hasta cada 32 min).
 */
export function debeReintentar(
  d: Pick<DictadoPublico, "estado" | "actualizado" | "error" | "intentos">,
  ahora: number,
  gemini: EstadoGemini | null,
  veces = 0,
): boolean {
  if (d.estado === "subido") {
    const desde = Date.parse(d.actualizado);
    return Number.isFinite(desde) && ahora - desde > ESPERA_SUBIDO_MS * 2 ** Math.min(veces, 6);
  }
  if (d.estado !== "error" || !d.error) return false;
  const { codigo, proximo } = d.error;
  if (codigo === "se_corto") return d.intentos < MAX_INTENTOS_SOLOS.se_corto;
  if (codigo === "sin_clave" || codigo === "solo_ai_gateway") return gemini === "ok";
  if (codigo === "ocupado" && d.intentos >= MAX_INTENTOS_SOLOS.ocupado) return false;
  return esReintentable(codigo) && proximo != null && proximo <= ahora;
}

/** Dictados listos cuya receta (rec_<id>) ya está guardada en Recetas: sobran (se ocultan y se limpian). */
export const yaGuardados = <T extends Pick<DictadoPublico, "id" | "estado">>(dictados: T[], recetaIds: Set<string>) =>
  dictados.filter((d) => d.estado === "listo" && recetaIds.has(`rec_${d.id}`));

/** En cuántos ms volver a mirar la lista, o null si no hace falta hasta que pase algo (volver a la app, internet). */
export function proximaRevision(
  dictados: Pick<DictadoPublico, "estado" | "error">[],
  ahora: number,
  o: { subiendo?: boolean; localesPorSubir?: boolean } = {},
): number | null {
  if (o.subiendo || dictados.some((d) => d.estado === "subido" || d.estado === "procesando")) return CADA_MS;
  let ms = o.localesPorSubir ? CADA_LOCALES_MS : Infinity;
  for (const d of dictados) {
    const p = d.estado === "error" ? d.error?.proximo : undefined;
    if (p && p > ahora) ms = Math.min(ms, p - ahora + 1000);
  }
  return Number.isFinite(ms) ? Math.min(ms, 6 * 3600_000) : null;
}

/** ¿Este audio del equipo se sube solo? Los que la nube rechazó, sólo a mano; salvo «lleno», cuando vuelve a haber cupo. */
export const subeSolo = (p: Pick<ResumenLocal, "rechazo">, hayCupo: boolean) => !p.rechazo || (p.rechazo.reintentar && hayCupo);
