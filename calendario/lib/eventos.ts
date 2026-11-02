import type { Evento, Ocurrencia } from "./datos/tipos";
import { diaSemana, diferenciaDias, partes, sumarDias } from "./fechas";

/** ¿Ocurre el evento en la fecha dada? */
export function ocurreEn(ev: Evento, f: string): boolean {
  if (f < ev.fecha) return false;
  if (ev.repetirHasta && f > ev.repetirHasta) return false;
  if (ev.excepciones?.includes(f)) return false;
  switch (ev.repeticion) {
    case "nunca":
      return f === ev.fecha;
    case "diaria":
      return true;
    case "semanal":
      return diaSemana(f) === diaSemana(ev.fecha);
    case "mensual":
      // Si el mes no tiene ese día (p. ej. 31), no ocurre ese mes.
      return partes(f).dia === partes(ev.fecha).dia;
  }
}

function porHora(a: Ocurrencia, b: Ocurrencia) {
  if (a.evento.todoElDia !== b.evento.todoElDia) return a.evento.todoElDia ? -1 : 1;
  return (a.evento.horaInicio ?? "").localeCompare(b.evento.horaInicio ?? "");
}

/** Ocurrencias entre `desde` y `hasta` (ambas incluidas), agrupadas por fecha. */
export function ocurrenciasEnRango(
  eventos: Evento[],
  desde: string,
  hasta: string,
  filtroMiembros?: Set<string>,
): Map<string, Ocurrencia[]> {
  const mapa = new Map<string, Ocurrencia[]>();
  const n = diferenciaDias(desde, hasta);
  for (let i = 0; i <= n; i++) mapa.set(sumarDias(desde, i), []);
  for (const ev of eventos) {
    if (filtroMiembros && filtroMiembros.size > 0 && !ev.miembros.some((m) => filtroMiembros.has(m)))
      continue;
    if (ev.fecha > hasta) continue;
    for (const f of mapa.keys()) {
      if (ocurreEn(ev, f)) mapa.get(f)!.push({ evento: ev, fecha: f });
    }
  }
  for (const lista of mapa.values()) lista.sort(porHora);
  return mapa;
}

export function textoHora(ev: Evento): string {
  if (ev.todoElDia) return "Todo el día";
  if (ev.horaInicio && ev.horaFin) return `${ev.horaInicio}–${ev.horaFin}`;
  return ev.horaInicio ?? "";
}

export const NOMBRE_REPETICION: Record<Evento["repeticion"], string> = {
  nunca: "No se repite",
  diaria: "Todos los días",
  semanal: "Cada semana",
  mensual: "Cada mes",
};
