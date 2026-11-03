import type { Evento, Ocurrencia } from "./datos/tipos";
import { diaSemana, diferenciaDias, lunesDe, partes, sumarDias, ultimoDiaDelMes } from "./fechas";

/** ¿Se repite? (las repeticiones que vienen de iCloud con fechas sueltas también cuentan). */
export const seRepite = (ev: Evento) => ev.repeticion !== "nunca" || !!ev.fechas;

/** Días que dura cada ocurrencia (1 si empieza y termina el mismo día). */
export function duracionDias(ev: Evento): number {
  return ev.fechaFin && ev.fechaFin > ev.fecha ? diferenciaDias(ev.fecha, ev.fechaFin) + 1 : 1;
}

/** Días de la semana de una repetición semanal (0 = lunes). */
export const diasDeLaSemana = (ev: Evento): number[] => (ev.diasSemana?.length ? ev.diasSemana : [diaSemana(ev.fecha)]);

/** ¿Empieza una ocurrencia del evento en la fecha dada? */
export function empiezaEn(ev: Evento, f: string): boolean {
  if (f < ev.fecha) return false;
  if (ev.excepciones?.includes(f)) return false;
  if (ev.fechas) return ev.fechas.includes(f);
  if (ev.repetirHasta && f > ev.repetirHasta) return false;
  const n = Math.max(1, ev.intervalo ?? 1);
  switch (ev.repeticion) {
    case "nunca":
      return f === ev.fecha;
    case "diaria":
      return diferenciaDias(ev.fecha, f) % n === 0;
    case "semanal":
      return (diferenciaDias(lunesDe(ev.fecha), lunesDe(f)) / 7) % n === 0 && diasDeLaSemana(ev).includes(diaSemana(f));
    case "mensual": {
      const a = partes(f);
      const i = partes(ev.fecha);
      if (((a.anio - i.anio) * 12 + a.mes - i.mes) % n !== 0) return false;
      // Si el mes no tiene ese día (p. ej. 31 en abril), se muestra el último día del mes.
      const ultimo = ultimoDiaDelMes(f);
      return a.dia === i.dia || (i.dia > ultimo && a.dia === ultimo);
    }
    case "anual": {
      // Un 29 de febrero se muestra el 28 en los años no bisiestos.
      const a = partes(f);
      const i = partes(ev.fecha);
      if (a.mes !== i.mes || (a.anio - i.anio) % n !== 0) return false;
      return a.dia === i.dia || (i.dia > ultimoDiaDelMes(f) && a.dia === ultimoDiaDelMes(f));
    }
  }
}

/** Día en que empezó la ocurrencia que cubre `f` (o null si ese día no hay). */
export function inicioDeOcurrencia(ev: Evento, f: string): string | null {
  const d = duracionDias(ev);
  for (let k = 0; k < d; k++) {
    const s = k ? sumarDias(f, -k) : f;
    if (empiezaEn(ev, s)) return s;
  }
  return null;
}

/** ¿Ocurre el evento en la fecha dada? (si dura varios días, cualquiera de ellos). */
export const ocurreEn = (ev: Evento, f: string) => inicioDeOcurrencia(ev, f) !== null;

/** Próxima vez (desde `hoy`, incluido) que empieza el evento, buscando hasta un año y un día adelante. */
export function proximaOcurrencia(ev: Evento, hoy: string): string | null {
  const desde = ev.fecha > hoy ? ev.fecha : hoy;
  for (let i = 0; i <= 366; i++) {
    const f = sumarDias(desde, i);
    if (!ev.fechas && ev.repetirHasta && f > ev.repetirHasta) return null;
    if (empiezaEn(ev, f)) return f;
    if (!seRepite(ev)) return null;
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

/** ¿Se muestra como "todo el día" en esta fecha? (los días del medio de un evento largo también). */
function todoElDiaEn(oc: Ocurrencia): boolean {
  const ev = oc.evento;
  if (ev.todoElDia) return true;
  if (duracionDias(ev) === 1 || oc.fecha === oc.inicio) return false;
  return oc.fecha !== sumarDias(oc.inicio, duracionDias(ev) - 1) || !ev.horaFin;
}

function porHora(a: Ocurrencia, b: Ocurrencia) {
  const ta = todoElDiaEn(a);
  const tb = todoElDiaEn(b);
  if (ta !== tb) return ta ? -1 : 1;
  const ha = a.fecha === a.inicio ? (a.evento.horaInicio ?? "") : "00:00";
  const hb = b.fecha === b.inicio ? (b.evento.horaInicio ?? "") : "00:00";
  return ha.localeCompare(hb);
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
      const inicio = inicioDeOcurrencia(ev, f);
      if (inicio) mapa.get(f)!.push({ evento: ev, fecha: f, inicio });
    }
  }
  for (const lista of mapa.values()) lista.sort(porHora);
  return mapa;
}

/**
 * Horario para mostrar. Con la ocurrencia, un evento de varios días dice "Desde 18:00" el primer
 * día, "Hasta 12:00" el último y "Todo el día" los del medio.
 */
export function textoHora(ev: Evento, oc?: Pick<Ocurrencia, "fecha" | "inicio">): string {
  if (ev.todoElDia) return "Todo el día";
  if (oc && duracionDias(ev) > 1) {
    if (oc.fecha === oc.inicio) return ev.horaInicio ? `Desde ${ev.horaInicio}` : "Todo el día";
    if (oc.fecha === sumarDias(oc.inicio, duracionDias(ev) - 1) && ev.horaFin) return `Hasta ${ev.horaFin}`;
    return "Todo el día";
  }
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

const UNIDAD: Record<Exclude<Evento["repeticion"], "nunca">, [string, string]> = {
  diaria: ["día", "días"],
  semanal: ["semana", "semanas"],
  mensual: ["mes", "meses"],
  anual: ["año", "años"],
};

export const DIAS_CORTOS = ["lu", "ma", "mi", "ju", "vi", "sá", "do"];

/** "Cada 2 semanas: lu, mi", "Cada mes", "Se repite (como en el iPhone)". */
export function textoRepeticion(ev: Evento): string {
  if (ev.fechas) return "Se repite como en el calendario del iPhone";
  if (ev.repeticion === "nunca") return NOMBRE_REPETICION.nunca;
  const n = ev.intervalo ?? 1;
  const base = n > 1 ? `Cada ${n} ${UNIDAD[ev.repeticion][1]}` : NOMBRE_REPETICION[ev.repeticion];
  if (ev.repeticion === "semanal" && ev.diasSemana && ev.diasSemana.length > 0) {
    const dias = diasDeLaSemana(ev);
    if (dias.length > 1 || dias[0] !== diaSemana(ev.fecha)) return `${base}: ${dias.map((d) => DIAS_CORTOS[d]).join(", ")}`;
  }
  return base;
}

export const unidadRepeticion = (r: Exclude<Evento["repeticion"], "nunca">, n: number) => UNIDAD[r][n === 1 ? 0 : 1];

/**
 * Forma única de escribir la misma repetición (para comparar sin falsos cambios): sin "cada 1", sin
 * días de la semana que sean sólo el de la fecha, y la fecha movida al primer día elegido.
 */
export function canonico(ev: Evento): Evento {
  const r: Evento = { ...ev };
  if (r.fechas) {
    r.repeticion = "nunca";
    delete r.intervalo;
    delete r.diasSemana;
    delete r.repetirHasta;
  }
  if (r.repeticion === "nunca") {
    delete r.intervalo;
    delete r.diasSemana;
    delete r.repetirHasta;
    if (!r.fechas) delete r.excepciones;
  }
  if (r.intervalo !== undefined && (!Number.isInteger(r.intervalo) || r.intervalo <= 1)) delete r.intervalo;
  if (r.repeticion !== "semanal") delete r.diasSemana;
  if (r.diasSemana) {
    const dias = [...new Set(r.diasSemana)].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort((a, b) => a - b);
    if (dias.length) {
      // La serie empieza el primer día elegido desde la fecha.
      for (let i = 0; i < 7 && !dias.includes(diaSemana(r.fecha)); i++) r.fecha = sumarDias(r.fecha, 1);
    }
    if (!dias.length || (dias.length === 1 && dias[0] === diaSemana(r.fecha))) delete r.diasSemana;
    else r.diasSemana = dias;
  }
  if (r.fechaFin !== undefined && !(r.fechaFin > r.fecha)) delete r.fechaFin;
  if (r.repetirHasta && r.repetirHasta < r.fecha) r.repetirHasta = r.fecha;
  if (r.excepciones) {
    const ex = [...new Set(r.excepciones)].filter((x) => x >= r.fecha && (!r.repetirHasta || x <= r.repetirHasta)).sort();
    if (ex.length) r.excepciones = ex;
    else delete r.excepciones;
  }
  if (r.fechas) r.fechas = [...new Set(r.fechas)].sort();
  for (const k of Object.keys(r) as (keyof Evento)[]) if (r[k] === undefined) delete r[k];
  return r;
}
