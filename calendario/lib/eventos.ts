import type { Evento, Ocurrencia } from "./datos/tipos";
import { diaSemana, diferenciaDias, partes, sumarDias, ultimoDiaDelMes } from "./fechas";

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
    case "mensual": {
      // Si el mes no tiene ese día (p. ej. 31 en abril), se muestra el último día del mes.
      const dia = partes(f).dia;
      const inicio = partes(ev.fecha).dia;
      const ultimo = ultimoDiaDelMes(f);
      return dia === inicio || (inicio > ultimo && dia === ultimo);
    }
    case "anual": {
      // Un 29 de febrero se muestra el 28 en los años no bisiestos.
      const a = partes(f);
      const i = partes(ev.fecha);
      if (a.mes !== i.mes) return false;
      return a.dia === i.dia || (i.dia > ultimoDiaDelMes(f) && a.dia === ultimoDiaDelMes(f));
    }
  }
}

/** Próxima vez (desde `hoy`, incluido) que ocurre el evento, buscando hasta un año y un día adelante. */
export function proximaOcurrencia(ev: Evento, hoy: string): string | null {
  const desde = ev.fecha > hoy ? ev.fecha : hoy;
  for (let i = 0; i <= 366; i++) {
    const f = sumarDias(desde, i);
    if (ev.repetirHasta && f > ev.repetirHasta) return null;
    if (ocurreEn(ev, f)) return f;
    if (ev.repeticion === "nunca") return null;
  }
  return null;
}

export interface CuentaRegresiva {
  evento: Evento;
  fecha: string;
  dias: number;
}

/** Eventos marcados como cuenta regresiva, de la más cercana a la más lejana (hasta `maxDias`). */
export function cuentasRegresivas(eventos: Evento[], hoy: string, maxDias = 366): CuentaRegresiva[] {
  return eventos
    .filter((e) => e.cuentaRegresiva)
    .map((evento) => {
      const fecha = proximaOcurrencia(evento, hoy);
      return fecha ? { evento, fecha, dias: diferenciaDias(hoy, fecha) } : null;
    })
    .filter((c): c is CuentaRegresiva => !!c && c.dias <= maxDias)
    .sort((a, b) => a.dias - b.dias || a.evento.titulo.localeCompare(b.evento.titulo, "es"));
}

/** "¡Hoy!", "mañana", "en 5 días". */
export function textoFaltan(dias: number): string {
  return dias === 0 ? "¡hoy!" : dias === 1 ? "mañana" : `en ${dias} días`;
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
  anual: "Cada año",
};
