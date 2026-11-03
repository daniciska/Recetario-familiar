import type { Evento, Ocurrencia } from "./datos/tipos";
import { diaSemana, diferenciaDias, horaAMinutos, partes, sumarDias } from "./fechas";

/** ¿Se repite? (las repeticiones que vienen de iCloud con fechas sueltas también cuentan). */
export const seRepite = (ev: Evento) => ev.repeticion !== "nunca" || !!ev.fechas;

/** Días que dura cada ocurrencia (1 si empieza y termina el mismo día). */
export function duracionDias(ev: Evento): number {
  return ev.fechaFin && ev.fechaFin > ev.fecha ? diferenciaDias(ev.fecha, ev.fechaFin) + 1 : 1;
}

/** Días de la semana de una repetición semanal (0 = lunes). */
export const diasDeLaSemana = (ev: Evento): number[] => (ev.diasSemana?.length ? ev.diasSemana : [diaSemana(ev.fecha)]);

/** Número de día (días desde 1970-01-01) de una fecha AAAA-MM-DD. */
const numeroDeDia = (f: string) => Date.UTC(+f.slice(0, 4), +f.slice(5, 7) - 1, +f.slice(8, 10)) / 86_400_000;
/** Día de la semana (0 = lunes) de un número de día (el 1970-01-01 fue jueves). */
const diaDeSemana = (n: number) => (((n + 3) % 7) + 7) % 7;
const finDeMes = (anio: number, mes: number) => new Date(Date.UTC(anio, mes, 0)).getUTCDate();

/**
 * `empiezaEn` para un evento fijo: lo que no depende de la fecha se calcula una vez (para recorrer
 * muchos días seguidos).
 */
export function probadorDeInicio(ev: Evento): (f: string) => boolean {
  const n = Math.max(1, ev.intervalo ?? 1);
  const i = partes(ev.fecha);
  const ni = numeroDeDia(ev.fecha);
  const lunesInicio = ni - diaDeSemana(ni);
  const dias = diasDeLaSemana(ev);
  return (f) => {
    if (f < ev.fecha) return false;
    if (ev.excepciones?.includes(f)) return false;
    if (ev.fechas) return ev.fechas.includes(f);
    if (ev.repetirHasta && f > ev.repetirHasta) return false;
    switch (ev.repeticion) {
      case "nunca":
        return f === ev.fecha;
      case "diaria":
        return (numeroDeDia(f) - ni) % n === 0;
      case "semanal": {
        const nf = numeroDeDia(f);
        const ds = diaDeSemana(nf);
        return ((nf - ds - lunesInicio) / 7) % n === 0 && dias.includes(ds);
      }
      case "mensual": {
        const a = partes(f);
        if (((a.anio - i.anio) * 12 + a.mes - i.mes) % n !== 0) return false;
        // Si el mes no tiene ese día (p. ej. 31 en abril), se muestra el último día del mes.
        const ultimo = finDeMes(a.anio, a.mes);
        return a.dia === i.dia || (i.dia > ultimo && a.dia === ultimo);
      }
      case "anual": {
        // Un 29 de febrero se muestra el 28 en los años no bisiestos.
        const a = partes(f);
        if (a.mes !== i.mes || (a.anio - i.anio) % n !== 0) return false;
        const ultimo = finDeMes(a.anio, a.mes);
        return a.dia === i.dia || (i.dia > ultimo && a.dia === ultimo);
      }
    }
  };
}

/** ¿Empieza una ocurrencia del evento en la fecha dada? */
export function empiezaEn(ev: Evento, f: string): boolean {
  return probadorDeInicio(ev)(f);
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
  // Un día cambiado de una serie de iCloud es un evento de una vez (su repetición es la de la serie).
  if (r.externo?.recurrencia) {
    r.repeticion = "nunca";
    delete r.fechas;
  }
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
      // La serie empieza el primer día elegido desde la fecha (si dura varios días, el último se mueve igual).
      const dur = r.fechaFin && r.fechaFin > r.fecha ? diferenciaDias(r.fecha, r.fechaFin) : 0;
      for (let i = 0; i < 7 && !dias.includes(diaSemana(r.fecha)); i++) r.fecha = sumarDias(r.fecha, 1);
      if (dur) r.fechaFin = sumarDias(r.fecha, dur);
    }
    if (!dias.length || (dias.length === 1 && dias[0] === diaSemana(r.fecha))) delete r.diasSemana;
    else r.diasSemana = dias;
  }
  if (r.fechaFin !== undefined && !(r.fechaFin > r.fecha)) delete r.fechaFin;
  // Varios días "hasta las 23:59" es lo mismo que sin hora de término: hasta el final del último día.
  if (r.fechaFin && !r.todoElDia && r.horaFin === "23:59") delete r.horaFin;
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

/** Minutos que dura cada ocurrencia (sin hora de término: un día, 0; varios días, hasta el final del último). */
export function duracionMinutos(ev: Evento): number {
  const dias = duracionDias(ev);
  if (ev.todoElDia) return dias * 1440;
  const ini = horaAMinutos(ev.horaInicio ?? "09:00");
  const fin = ev.horaFin ? horaAMinutos(ev.horaFin) : dias > 1 ? 1440 : ini;
  return (dias - 1) * 1440 + fin - ini;
}

/**
 * ¿Una ocurrencia dura más que el tiempo hasta la siguiente? (entonces se pisan, y "borrar sólo este
 * día" no se notaría). Que una termine justo cuando empieza la otra (turno de noche diario, de lunes a
 * lunes) no es pisarse. En una semanal con varios días, cuenta el menor salto entre los días elegidos.
 */
export function seSolapa(ev: Evento): boolean {
  if (ev.repeticion === "nunca" || ev.fechas) return false;
  const n = Math.max(1, ev.intervalo ?? 1);
  let dias: number;
  if (ev.repeticion === "diaria") dias = n;
  else if (ev.repeticion === "semanal") {
    const d = [...diasDeLaSemana(ev)].sort((a, b) => a - b);
    dias = 7 * n - (d[d.length - 1] - d[0]); // de la última de una semana a la primera de la que toca
    for (let i = 1; i < d.length; i++) dias = Math.min(dias, d[i] - d[i - 1]);
  } else dias = (ev.repeticion === "mensual" ? 28 : 365) * n; // el mes (o año) más corto
  return duracionMinutos(ev) > dias * 1440;
}

/** Campos de "cuándo": si se cambió uno en el formulario, van todos juntos (si no, podría quedar un horario que no calza). */
const CUANDO = ["fecha", "fechaFin", "todoElDia", "horaInicio", "horaFin", "repeticion", "intervalo", "diasSemana", "repetirHasta"] as const;
/** En una repetición del iPhone (fechas sueltas) el formulario sólo cambia la hora. */
const CUANDO_AFUERA = ["todoElDia", "horaInicio", "horaFin"] as const;
/** Lo que no se edita en el formulario: siempre como está ahora en la lista (lo pone la sincronización o "borrar sólo este día"). */
const NO_EDITABLES = new Set<string>(["id", "externo", "fechas", "excepciones", "actualizado"]);

/**
 * Lo que se cambió en el formulario (de `antes` a `despues`, los dos ya limpios) aplicado sobre el
 * evento como está ahora en la lista (`actual`). Así no se pisa lo que llegó del iPhone mientras el
 * formulario estaba abierto (un día borrado, otra hora, otro título).
 */
export function aplicarCambios(antes: Evento, despues: Evento, actual: Evento): Evento {
  const igual = (k: keyof Evento) => JSON.stringify(antes[k] ?? null) === JSON.stringify(despues[k] ?? null);
  const r: Record<string, unknown> = { ...actual };
  const cuando: readonly (keyof Evento)[] = antes.fechas ? CUANDO_AFUERA : CUANDO;
  if (cuando.some((k) => !igual(k))) for (const k of cuando) r[k] = despues[k];
  const claves = new Set([...Object.keys(antes), ...Object.keys(despues)] as (keyof Evento)[]);
  for (const k of claves) {
    if (NO_EDITABLES.has(k) || (CUANDO as readonly string[]).includes(k) || igual(k)) continue;
    r[k] = despues[k];
  }
  return canonico(r as unknown as Evento);
}
