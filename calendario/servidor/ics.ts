// Traducción entre un recurso de calendario (.ics, como lo guardan iCloud y el iPhone) y los eventos
// del panel. Un recurso es una "serie": el evento principal (con su repetición) y los días que se
// cambiaron sólo esa vez (RECURRENCE-ID). En el panel queda como un evento principal + un evento
// por cada día cambiado, todos con `externo.uid` igual al UID del recurso.
//
// Reglas:
// - Horas: el panel trabaja en America/Santiago. Lo que viene en otra zona se convierte.
// - Personas: al subir, el título lleva adelante los emojis de las personas ("🦄 Dentista"); si es
//   para todos, no lleva nada. Al traer: emojis al inicio → esas personas; si no, nombres en el
//   título o "@Nombre" en la nota; si no, para todos.
// - Repeticiones: las que el panel sabe escribir (cada N días/semanas/meses/años, días de la
//   semana, hasta) se traducen tal cual; las demás ("el segundo martes") quedan como fechas sueltas
//   (`fechas`) y su repetición sólo se cambia en el iPhone.
// - Al actualizar un recurso que ya existe se cambia sólo lo que el panel maneja: alertas, invitados,
//   adjuntos y lo demás que puso el iPhone se conservan.

import ICAL from "ical.js";
import { createHash } from "node:crypto";
import type { Evento, Miembro } from "../lib/datos/tipos";
import { canonico, diasDeLaSemana, probadorDeInicio } from "../lib/eventos";
import { ZONA, diferenciaDias, partes, sumarDias } from "../lib/fechas";
import { normalizarEvento } from "../lib/datos/normalizar";

export const SUFIJO_UID = "@calendario-familiar";
const PRODID = "-//Calendario familiar//Panel de la pared//ES";

/** Zona horaria de Chile continental (reglas vigentes desde 2023: DST del 1.er domingo de septiembre desde el 2 al de abril). */
const VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  `TZID:${ZONA}`,
  "BEGIN:DAYLIGHT",
  "DTSTART:20230903T000000",
  "RRULE:FREQ=YEARLY;BYMONTH=9;BYMONTHDAY=2,3,4,5,6,7,8;BYDAY=SU",
  "TZOFFSETFROM:-0400",
  "TZOFFSETTO:-0300",
  "TZNAME:-03",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "DTSTART:20230402T000000",
  "RRULE:FREQ=YEARLY;BYMONTH=4;BYMONTHDAY=2,3,4,5,6,7,8;BYDAY=SU",
  "TZOFFSETFROM:-0300",
  "TZOFFSETTO:-0400",
  "TZNAME:-04",
  "END:STANDARD",
  "END:VTIMEZONE",
].join("\r\n");

export interface Contexto {
  conexion: string; // id de la conexión (va en `externo.conexion`)
  miembros: Miembro[];
  hoy: string; // AAAA-MM-DD en Santiago
}

export interface Grupo {
  uid: string;
  eventos: Evento[];
  /** Último cambio en el calendario (LAST-MODIFIED o DTSTAMP), ISO. */
  modificado: string | null;
}

// ---------- Fechas y zonas ----------

const zonasValidas = new Map<string, boolean>();
function zonaIANA(z: string | null | undefined): z is string {
  if (!z) return false;
  let ok = zonasValidas.get(z);
  if (ok === undefined) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: z });
      ok = true;
    } catch {
      ok = false;
    }
    zonasValidas.set(z, ok);
  }
  return ok;
}

const formatos = new Map<string, Intl.DateTimeFormat>();
function enZona(zona: string, instante: number) {
  let f = formatos.get(zona);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: zona,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatos.set(zona, f);
  }
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(new Date(instante))) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day, h: p.hour === "24" ? 0 : +p.hour, mi: +p.minute, s: +p.second };
}

/** Instante (ms) de una hora "de reloj" en una zona IANA. */
function instanteLocal(zona: string, y: number, m: number, d: number, h: number, mi: number, s = 0): number {
  const reloj = Date.UTC(y, m - 1, d, h, mi, s);
  const desfase = (t: number) => {
    const p = enZona(zona, t);
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(t / 1000) * 1000;
  };
  // El desfase de un día antes y uno después: si son iguales, no hay cambio de hora cerca.
  const antes = desfase(reloj - 86_400_000);
  const despues = desfase(reloj + 86_400_000);
  const ta = reloj - antes;
  if (antes === despues) return ta;
  const td = reloj - despues;
  const va = desfase(ta) === antes;
  const vd = desfase(td) === despues;
  // Hora repetida (cuando se atrasa el reloj): la primera vez, como pide RFC 5545.
  if (va && vd) return Math.min(ta, td);
  if (vd && !va) return td;
  // Hora que no existe (adelanto): con el desfase de antes del salto, que la corre hacia adelante en
  // cualquier zona (Santiago 00:30 → 01:30, Madrid 02:30 → 03:30), como pide RFC 5545.
  return ta;
}

const dosDig = (n: number) => String(n).padStart(2, "0");
const fechaDe = (y: number, m: number, d: number) => `${y}-${dosDig(m)}-${dosDig(d)}`;

interface EnPanel {
  fecha: string;
  hora?: string; // sin hora: día completo
  instante?: number;
}

/** Un valor de fecha/hora del .ics, pasado a la hora de Santiago. */
function aPanel(t: ICAL.Time, tzid: string | null): EnPanel {
  if (t.isDate) return { fecha: fechaDe(t.year, t.month, t.day) };
  let instante: number;
  if (t.zone === ICAL.Timezone.utcTimezone) instante = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
  else if (zonaIANA(tzid)) instante = instanteLocal(tzid, t.year, t.month, t.day, t.hour, t.minute, t.second);
  else if (tzid && t.zone && t.zone !== ICAL.Timezone.localTimezone) instante = t.toJSDate().getTime(); // VTIMEZONE propia (p. ej. Outlook)
  else instante = instanteLocal(ZONA, t.year, t.month, t.day, t.hour, t.minute, t.second); // "flotante": hora de Santiago
  const p = enZona(ZONA, instante);
  return { fecha: fechaDe(p.y, p.m, p.d), hora: `${dosDig(p.h)}:${dosDig(p.mi)}`, instante };
}

/**
 * Sólo la fecha en Santiago. Si el valor ya está en hora de Santiago (o es de día completo, o
 * flotante) es la fecha del reloj, sin convertir: así recorrer una serie larga es barato. (El adelanto
 * de hora de Chile es a medianoche y corre la hora a la 1:00 del mismo día: la fecha no cambia).
 */
function fechaEnPanel(t: ICAL.Time, tzid: string | null): string {
  if (t.isDate || (t.zone !== ICAL.Timezone.utcTimezone && (tzid === ZONA || !tzid))) return fechaDe(t.year, t.month, t.day);
  return aPanel(t, tzid).fecha;
}

/** Hora de reloj como número (para sumar segundos sin pasar por zonas). */
const relojMs = (t: ICAL.Time) => Date.UTC(t.year, t.month - 1, t.day, t.isDate ? 0 : t.hour, t.isDate ? 0 : t.minute, t.isDate ? 0 : t.second);

function deRelojMs(ms: number, zona: ICAL.Timezone | null | undefined, esFecha = false): ICAL.Time {
  const d = new Date(ms);
  const datos = esFecha
    ? { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), isDate: true }
    : { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds(), isDate: false };
  return ICAL.Time.fromData(datos, esFecha ? undefined : (zona ?? undefined));
}

const clonar = (v: ICAL.Component) => new ICAL.Component(JSON.parse(JSON.stringify(v.toJSON())));

function valorDe(prop: ICAL.Property | null): { t: ICAL.Time; tzid: string | null } | null {
  if (!prop) return null;
  const t = prop.getFirstValue();
  if (!(t instanceof ICAL.Time)) return null;
  return { t, tzid: (prop.getParameter("tzid") as string | undefined) ?? null };
}

function fechasDe(v: ICAL.Component, nombre: string): string[] {
  const r: string[] = [];
  for (const p of v.getAllProperties(nombre)) {
    const tzid = (p.getParameter("tzid") as string | undefined) ?? null;
    for (const x of p.getValues()) if (x instanceof ICAL.Time) r.push(aPanel(x, tzid).fecha);
  }
  return r;
}

function horaReloj(fecha: string, hora: string, esFecha = false): ICAL.Time {
  const p = partes(fecha);
  if (esFecha) return ICAL.Time.fromData({ year: p.anio, month: p.mes, day: p.dia, isDate: true });
  const [h, mi] = hora.split(":").map(Number);
  return ICAL.Time.fromData({ year: p.anio, month: p.mes, day: p.dia, hour: h, minute: mi, second: 0, isDate: false });
}

function propFecha(nombre: string, fecha: string, hora?: string): ICAL.Property {
  const p = new ICAL.Property(nombre);
  if (hora === undefined) p.setValue(horaReloj(fecha, "00:00", true));
  else {
    p.setValue(horaReloj(fecha, hora));
    p.setParameter("tzid", ZONA);
  }
  return p;
}

const ahoraUTC = () => ICAL.Time.fromJSDate(new Date(), true);

/** Ventana de fechas sueltas para repeticiones que el panel no sabe escribir: del año pasado al subsiguiente. */
export function ventanaDe(hoy: string): { desde: string; hasta: string } {
  const a = partes(hoy).anio;
  return { desde: `${a - 1}-01-01`, hasta: `${a + 2}-12-31` };
}

// ---------- Personas en el título ----------

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const segmentador = new Intl.Segmenter("es", { granularity: "grapheme" });
const sinVariacion = (s: string) => s.replace(/️/g, "");

/** Título como se ve en el iPhone: con los emojis de las personas adelante (para todos: sin nada). */
export function tituloExterno(ev: Evento, miembros: Miembro[]): string {
  const ids = new Set(ev.miembros);
  const elegidos = miembros.filter((m) => ids.has(m.id));
  if (!elegidos.length || elegidos.length === miembros.length) return ev.titulo;
  const emojis = [...new Set(elegidos.map((m) => m.emoji))].join("");
  return `${emojis} ${ev.titulo}`;
}

/** Al revés: separa las personas del título (y de "@Nombre" en la nota). */
export function personasDesde(titulo: string, nota: string | undefined, miembros: Miembro[]): { titulo: string; miembros: string[] } {
  const todos = miembros.map((m) => m.id);
  const porEmoji = new Map<string, string[]>();
  for (const m of miembros) {
    const k = sinVariacion(m.emoji);
    porEmoji.set(k, [...(porEmoji.get(k) ?? []), m.id]);
  }
  const elegidos = new Set<string>();
  let resto = titulo;
  let i = 0;
  const graf = [...segmentador.segment(titulo)].map((s) => s.segment);
  for (; i < graf.length; i++) {
    const g = graf[i];
    if (g.trim() === "") continue;
    const ids = porEmoji.get(sinVariacion(g));
    if (!ids) break;
    ids.forEach((x) => elegidos.add(x));
  }
  if (elegidos.size) {
    resto = graf.slice(i).join("").trim();
    if (resto) return { titulo: resto, miembros: todos.filter((x) => elegidos.has(x)) };
  }
  const t = ` ${sinTildes(titulo).replace(/[^\p{L}\p{N}]+/gu, " ")} `;
  const n = sinTildes(nota ?? "");
  for (const m of miembros) {
    const nombre = sinTildes(m.nombre).trim();
    if (!nombre) continue;
    const enTitulo = t.includes(` ${nombre.replace(/[^\p{L}\p{N}]+/gu, " ")} `);
    const etiqueta = new RegExp(`(^|[^\\p{L}\\p{N}])@${nombre.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "u").test(n);
    if (enTitulo || etiqueta) elegidos.add(m.id);
  }
  return { titulo: titulo.trim() || "Sin título", miembros: elegidos.size ? todos.filter((x) => elegidos.has(x)) : todos };
}

// ---------- Huella: lo que se ve en el calendario ----------

/** Lo que el panel sube de un evento (sin lo que es sólo del panel: cuenta regresiva, id…). */
function visible(ev: Evento, miembros: Miembro[]) {
  return {
    s: tituloExterno(ev, miembros),
    f: ev.fecha,
    ff: ev.fechaFin,
    td: ev.todoElDia,
    hi: ev.todoElDia ? undefined : ev.horaInicio,
    hf: ev.todoElDia ? undefined : ev.horaFin,
    r: ev.fechas ? "afuera" : ev.repeticion,
    n: ev.fechas ? undefined : ev.intervalo,
    ds: ev.fechas ? undefined : ev.diasSemana,
    h: ev.fechas ? undefined : ev.repetirHasta,
    ex: ev.excepciones,
    no: ev.nota,
    lu: ev.lugar,
    rc: ev.externo?.recurrencia,
  };
}

/**
 * Eventos de una serie que van al calendario: todos, salvo que el principal sea "sólo panel" (entonces
 * ninguno). Un día cambiado no se puede dejar sólo en el panel por separado (el editor no lo ofrece).
 */
export function enCalendario(grupo: Evento[]): Evento[] {
  const principal = grupo.find((e) => !e.externo?.recurrencia);
  if (principal ? principal.soloPanel : grupo.length === 1 && grupo[0].soloPanel) return [];
  return grupo;
}

export function huellaGrupo(grupo: Evento[], miembros: Miembro[]): string {
  const v = enCalendario(grupo)
    .map((e) => visible(canonico(e), miembros))
    .sort((a, b) => (a.rc ?? "").localeCompare(b.rc ?? ""));
  return createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 32);
}

export const idDe = (texto: string) => `ic_${createHash("sha256").update(texto).digest("hex").slice(0, 16)}`;

/** UID que se usa en el calendario para un evento creado en el panel. */
export const uidDe = (ev: Evento) => `${ev.id}${SUFIJO_UID}`;

// ---------- Leer ----------

const DIAS_ICAL = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

interface Horario {
  fecha: string;
  fechaFin?: string;
  todoElDia: boolean;
  horaInicio?: string;
  horaFin?: string;
}

function horarioDe(v: ICAL.Component): (Horario & { tzid: string | null; inicio: ICAL.Time }) | null {
  const ini = valorDe(v.getFirstProperty("dtstart"));
  if (!ini) return null;
  const a = aPanel(ini.t, ini.tzid);
  const fin = valorDe(v.getFirstProperty("dtend"));
  const dur = v.getFirstPropertyValue("duration");
  if (ini.t.isDate) {
    let ultimo = a.fecha;
    if (fin?.t.isDate) ultimo = sumarDias(fechaDe(fin.t.year, fin.t.month, fin.t.day), -1);
    else if (dur instanceof ICAL.Duration) ultimo = sumarDias(a.fecha, Math.max(1, Math.round(dur.toSeconds() / 86400)) - 1);
    return { fecha: a.fecha, fechaFin: ultimo > a.fecha ? ultimo : undefined, todoElDia: true, tzid: ini.tzid, inicio: ini.t };
  }
  let b: EnPanel | null = null;
  if (fin && !fin.t.isDate) b = aPanel(fin.t, fin.tzid ?? ini.tzid);
  else if (dur instanceof ICAL.Duration && a.instante !== undefined) {
    const fin = a.instante + dur.toSeconds() * 1000;
    const p = enZona(ZONA, fin);
    b = { fecha: fechaDe(p.y, p.m, p.d), hora: `${dosDig(p.h)}:${dosDig(p.mi)}`, instante: fin };
  }
  const h: Horario & { tzid: string | null; inicio: ICAL.Time } = { fecha: a.fecha, todoElDia: false, horaInicio: a.hora, tzid: ini.tzid, inicio: ini.t };
  // Termina en el primer instante de un día (00:00, o 01:00 el día del adelanto de hora): medianoche.
  if (b && b.instante !== undefined && b.fecha > a.fecha) {
    const p = partes(b.fecha);
    if (b.instante === instanteLocal(ZONA, p.anio, p.mes, p.dia, 0, 0)) b.hora = "00:00";
  }
  if (b && (b.fecha > a.fecha || (b.fecha === a.fecha && b.hora! > a.hora!))) {
    if (b.hora === "00:00" && b.fecha > a.fecha) {
      // Termina a medianoche: en el panel, "hasta las 23:59" del día anterior.
      const ultimo = sumarDias(b.fecha, -1);
      h.horaFin = "23:59";
      if (ultimo > a.fecha) h.fechaFin = ultimo;
    } else {
      h.horaFin = b.hora;
      if (b.fecha > a.fecha) h.fechaFin = b.fecha;
    }
  }
  return h;
}

// Recorrer una serie cuesta por cada ocurrencia desde su inicio (ical.js no sabe saltar), así que:
// - las diarias y semanales (y por horas) se adelantan hasta poco antes de lo que se busca;
// - las por horas o minutos se recorren día por día (sólo importa qué días tienen alguna);
// - y hay un tope de vueltas y de tiempo para reglas absurdas (no se corta la función de 10 s).
const TOPE_VUELTAS = 100_000;
const TOPE_MS = 400;
const SEGUNDOS: Record<string, number> = { SECONDLY: 1, MINUTELY: 60, HOURLY: 3600 };

const unaRegla = (v: ICAL.Component): ICAL.Recur | null => {
  const rr = v.getAllProperties("rrule");
  return rr.length === 1 ? (rr[0].getFirstValue() as ICAL.Recur) : null;
};
const tieneFiltros = (r: ICAL.Recur) => Object.keys(r.parts ?? {}).length > 0;

/** Un valor de fecha/hora como hora de reloj (flotante) en la zona IANA `tzid`. */
function relojFlotante(t: ICAL.Time, tzidValor: string | null, tzid: string): ICAL.Time {
  if (t.isDate) return t;
  let instante: number | null = null;
  if (t.zone === ICAL.Timezone.utcTimezone) instante = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
  else if (tzidValor && tzidValor !== tzid) instante = aPanel(t, tzidValor).instante ?? null;
  if (instante === null) return deRelojMs(relojMs(t), null);
  const p = enZona(tzid, instante);
  return ICAL.Time.fromData({ year: p.y, month: p.m, day: p.d, hour: p.h, minute: p.mi, second: p.s, isDate: false });
}

/**
 * Copia de una serie con TZID (IANA) en hora flotante: las mismas horas de reloj, pero ical.js no tiene
 * que calcular el desfase de la zona en cada paso (es lo más caro de recorrerla). UNTIL, EXDATE y RDATE
 * se pasan a la hora de reloj de esa zona. Las ocurrencias salen con la hora de reloj de la serie.
 */
function flotante(v: ICAL.Component): ICAL.Component {
  const ini = valorDe(v.getFirstProperty("dtstart"));
  if (!ini || ini.t.isDate || !ini.tzid || ini.t.zone === ICAL.Timezone.utcTimezone || !zonaIANA(ini.tzid)) return v;
  const tzid = ini.tzid;
  const copia = clonar(v);
  const dt = copia.getFirstProperty("dtstart")!;
  dt.removeParameter("tzid");
  dt.setValue(deRelojMs(relojMs(ini.t), null));
  for (const k of ["dtend", "duration"]) copia.removeAllProperties(k);
  for (const nombre of ["exdate", "rdate"]) {
    for (const p of copia.getAllProperties(nombre)) {
      const valores = p.getValues();
      if (!valores.every((x) => x instanceof ICAL.Time)) continue;
      const tz = (p.getParameter("tzid") as string | undefined) ?? null;
      p.removeParameter("tzid");
      p.setValues(valores.map((x) => relojFlotante(x as ICAL.Time, tz, tzid)));
    }
  }
  for (const p of copia.getAllProperties("rrule")) {
    const r = p.getFirstValue() as ICAL.Recur;
    if (r.until && !r.until.isDate) {
      const nr = r.clone();
      nr.until = relojFlotante(r.until, null, tzid);
      p.setValue(nr);
    }
  }
  return copia;
}

/**
 * Copia de la serie con el inicio adelantado un número entero de períodos, hasta unos días antes de
 * `desde`: desde ahí tiene exactamente las mismas ocurrencias (la primera, el inicio adelantado, queda
 * antes de lo que se busca). Sólo para una regla diaria, semanal o por horas, sin COUNT (o sin filtros:
 * entonces se descuenta del COUNT). Si no se puede o no hace falta, la misma serie.
 */
function adelantar(v: ICAL.Component, desde: string): ICAL.Component {
  const r = unaRegla(v);
  const ini = valorDe(v.getFirstProperty("dtstart"));
  if (!r || !ini) return v;
  if (r.count && tieneFiltros(r)) return v;
  const n = Math.max(1, r.interval || 1);
  const periodo = r.freq === "DAILY" ? n * 86400 : r.freq === "WEEKLY" ? n * 7 * 86400 : SEGUNDOS[r.freq] ? n * SEGUNDOS[r.freq] : 0;
  if (!periodo) return v;
  const p = partes(desde);
  // Margen de 3 días: la zona de la serie y Santiago difieren en menos de uno.
  const meta = Date.UTC(p.anio, p.mes - 1, p.dia) - 3 * 86_400_000;
  const k = Math.floor((meta - relojMs(ini.t)) / (periodo * 1000));
  if (k <= 1) return v;
  if (r.count && r.count - k < 1) return v;
  const copia = clonar(v);
  const prop = copia.getFirstProperty("dtstart")!;
  const tzid = prop.getParameter("tzid") as string | undefined;
  prop.setValue(deRelojMs(relojMs(ini.t) + k * periodo * 1000, ini.t.zone, ini.t.isDate));
  if (tzid) prop.setParameter("tzid", tzid);
  for (const x of ["dtend", "duration"]) copia.removeAllProperties(x);
  if (r.count) {
    const nr = r.clone();
    nr.count = r.count - k;
    copia.getFirstProperty("rrule")!.setValue(nr);
  }
  return copia;
}

interface PorDias {
  diaria: ICAL.Component;
  paso: number; // segundos entre ocurrencias
  ini: ICAL.Time;
  /** Última ocurrencia posible (UNTIL, o la que da el COUNT). */
  ultima: ICAL.Time | null;
}

/**
 * Regla por horas o minutos: la misma serie como diaria (con los filtros de día), para recorrerla día
 * por día. null si tiene filtros de hora (BYHOUR…) o es cada más de 12 horas (son pocas por día).
 */
function porDias(v: ICAL.Component): PorDias | null {
  const r = unaRegla(v);
  const ini = valorDe(v.getFirstProperty("dtstart"));
  if (!r || !ini || ini.t.isDate || v.getAllProperties("rdate").length || !SEGUNDOS[r.freq]) return null;
  const paso = Math.max(1, r.interval || 1) * SEGUNDOS[r.freq];
  if (paso > 12 * 3600) return null;
  const p = r.parts ?? {};
  if (["BYHOUR", "BYMINUTE", "BYSECOND", "BYSETPOS", "BYYEARDAY", "BYWEEKNO"].some((k) => k in p)) return null;
  let ultima: ICAL.Time | null = r.until ?? null;
  if (r.count) {
    if (tieneFiltros(r)) return null;
    ultima = deRelojMs(relojMs(ini.t) + (r.count - 1) * paso * 1000, ini.t.zone);
  }
  const diaria = clonar(v);
  diaria.removeAllProperties("exdate"); // un EXDATE es de una hora: no saca el día entero
  const nr = r.clone();
  nr.freq = "DAILY";
  nr.interval = 1;
  nr.count = null;
  nr.until = null;
  diaria.getFirstProperty("rrule")!.setValue(nr);
  return { diaria, paso, ini: ini.t, ultima };
}

interface Expansion {
  fechas: string[];
  /** false si se cortó por el tope (regla absurda): las fechas pueden estar incompletas. */
  completo: boolean;
}

/** Fechas (en Santiago) en que empieza la serie dentro de la ventana, según el .ics (con sus EXDATE). */
function expandir(v: ICAL.Component, tzid: string | null, desde: string, hasta: string): Expansion {
  const r: string[] = [];
  const limite = performance.now() + TOPE_MS;
  const anioDesde = Number(desde.slice(0, 4)) - 1;
  const base = flotante(v);
  const pd = porDias(base);
  let completo = true;
  if (pd) {
    // Cada día que pasa los filtros: la primera y la última ocurrencia de ese día (en la zona de la serie).
    // Los EXDATE no se miran: en el panel quedan como excepciones (ver leerRecurso).
    const it = new ICAL.Event(adelantar(pd.diaria, desde)).iterator();
    const t0 = relojMs(pd.ini);
    for (let i = 0, n: ICAL.Time | null; (n = it.next()); i++) {
      if (i >= TOPE_VUELTAS || ((i & 255) === 0 && performance.now() > limite)) {
        completo = false;
        break;
      }
      const dia = Date.UTC(n.year, n.month - 1, n.day);
      const desdeIni = Math.max(dia, t0);
      const primera = desdeIni + ((pd.paso * 1000 - ((desdeIni - t0) % (pd.paso * 1000))) % (pd.paso * 1000));
      if (primera >= dia + 86_400_000) continue;
      const a = deRelojMs(primera, pd.ini.zone);
      if (pd.ultima && a.compare(pd.ultima) > 0) break;
      let ultima = primera + Math.floor((dia + 86_400_000 - 1 - primera) / (pd.paso * 1000)) * pd.paso * 1000;
      let b = deRelojMs(ultima, pd.ini.zone);
      while (pd.ultima && ultima > primera && b.compare(pd.ultima) > 0) b = deRelojMs((ultima -= pd.paso * 1000), pd.ini.zone);
      const fa = fechaEnPanel(a, tzid);
      if (fa > hasta) break;
      for (const f of [fa, fechaEnPanel(b, tzid)]) if (f >= desde && f <= hasta) r.push(f);
    }
    return { fechas: [...new Set(r)].sort(), completo };
  }
  const it = new ICAL.Event(adelantar(base, desde)).iterator();
  for (let i = 0, n: ICAL.Time | null; (n = it.next()); i++) {
    if (i >= TOPE_VUELTAS || ((i & 255) === 0 && performance.now() > limite)) {
      completo = false;
      break;
    }
    if (n.year < anioDesde) continue;
    const f = fechaEnPanel(n, tzid);
    if (f > hasta) break;
    if (f >= desde) r.push(f);
  }
  return { fechas: [...new Set(r)], completo };
}

interface Instancia {
  t: ICAL.Time;
  tzid: string | null;
}

/**
 * Inicio exacto (en la zona de la serie) de las ocurrencias que empiezan en cada fecha del panel, sin
 * mirar los EXDATE. Sirve para escribir EXDATE y RECURRENCE-ID que calcen con la serie aunque esté en
 * UTC o en otra zona. Casi siempre es una por fecha; en una serie por horas, todas las de ese día.
 */
function instancias(v: ICAL.Component, fechas: Iterable<string>): Map<string, Instancia[]> {
  const buscadas = new Set(fechas);
  const r = new Map<string, Instancia[]>();
  if (!buscadas.size) return r;
  const ini = valorDe(v.getFirstProperty("dtstart"));
  if (!ini) return r;
  let copia = flotante(v);
  if (copia === v) copia = clonar(v);
  copia.removeAllProperties("exdate");
  if (!copia.getFirstProperty("rrule") && !copia.getFirstProperty("rdate")) {
    const f = fechaEnPanel(ini.t, ini.tzid);
    if (buscadas.has(f)) r.set(f, [{ t: ini.t.clone(), tzid: ini.tzid }]);
    return r;
  }
  const orden = [...buscadas].sort();
  // Por horas: se busca cada fecha por separado (de una a otra pueden ser miles de ocurrencias).
  const tramos = SEGUNDOS[unaRegla(copia)?.freq ?? ""] ? orden.map((f) => [f, f]) : [[orden[0], orden[orden.length - 1]]];
  const limite = performance.now() + TOPE_MS;
  for (const [desde, hasta] of tramos) {
    const anioDesde = Number(desde.slice(0, 4)) - 1;
    const it = new ICAL.Event(adelantar(copia, desde)).iterator();
    for (let i = 0, n: ICAL.Time | null; (n = it.next()); i++) {
      if (i >= TOPE_VUELTAS || ((i & 255) === 0 && performance.now() > limite)) return r;
      if (n.year < anioDesde) continue;
      const f = fechaEnPanel(n, ini.tzid);
      if (f > hasta) break;
      if (buscadas.has(f)) r.set(f, [...(r.get(f) ?? []), { t: n.clone(), tzid: ini.tzid }]);
    }
  }
  return r;
}

function propInstancia(nombre: string, i: Instancia): ICAL.Property {
  const p = new ICAL.Property(nombre);
  p.setValue(i.t.clone());
  if (!i.t.isDate && i.tzid && i.t.zone !== ICAL.Timezone.utcTimezone) p.setParameter("tzid", i.tzid);
  return p;
}

type Repeticion = Pick<Evento, "repeticion" | "intervalo" | "diasSemana" | "repetirHasta"> & {
  /** Patrón "último día" con BYSETPOS: ical.js no lo expande bien, así que no se compara día por día. */
  sinComparar?: boolean;
};

/** Intenta escribir la regla con las opciones del panel (si no se puede, null). */
function reglaSimple(v: ICAL.Component, h: Horario & { tzid: string | null }): Repeticion | null {
  const rrules = v.getAllProperties("rrule");
  if (rrules.length !== 1 || v.getAllProperties("rdate").length) return null;
  const r = rrules[0].getFirstValue() as ICAL.Recur;
  const frecuencias: Record<string, Evento["repeticion"]> = { DAILY: "diaria", WEEKLY: "semanal", MONTHLY: "mensual", YEARLY: "anual" };
  const repeticion = frecuencias[r.freq];
  if (!repeticion) return null;
  const p = (r.parts ?? {}) as Record<string, (string | number)[]>;
  const inicio = partes(h.fecha);
  const solo = (k: string, valores: (string | number)[]) =>
    !p[k] || (p[k].length === valores.length && p[k].every((x) => valores.map(String).includes(String(x))));
  const otras = Object.keys(p).filter((k) => !["BYDAY", "BYMONTHDAY", "BYMONTH", "BYSETPOS"].includes(k));
  if (otras.length) return null;
  const res: Repeticion = { repeticion, intervalo: r.interval > 1 ? r.interval : undefined };
  if (repeticion === "semanal") {
    if (p.BYMONTHDAY || p.BYMONTH || p.BYSETPOS) return null;
    if (p.BYDAY) {
      const dias = p.BYDAY.map((d) => DIAS_ICAL.indexOf(String(d)));
      if (dias.some((d) => d < 0)) return null; // "1MO" y similares
      res.diasSemana = dias;
    }
  } else if (p.BYDAY) return null;
  if (repeticion === "mensual") {
    // "El día 30 o el último del mes" (como lo escribe el panel) o el mismo día de la fecha.
    const ultimoDia = inicio.dia > 28 && inicio.dia < 31 && !!p.BYSETPOS && solo("BYSETPOS", [-1]) &&
      solo("BYMONTHDAY", Array.from({ length: inicio.dia - 27 }, (_, k) => 28 + k));
    const dia31 = inicio.dia === 31 && !p.BYSETPOS && !!p.BYMONTHDAY && solo("BYMONTHDAY", [-1]);
    if (ultimoDia) res.sinComparar = true;
    else if (!dia31 && (p.BYSETPOS || !solo("BYMONTHDAY", [inicio.dia]))) return null;
    if (p.BYMONTH) return null;
  }
  if (repeticion === "anual") {
    const bisiesto = inicio.mes === 2 && inicio.dia === 29 && !!p.BYSETPOS && solo("BYSETPOS", [-1]) && solo("BYMONTHDAY", [28, 29]);
    if (bisiesto) res.sinComparar = true;
    else if (p.BYSETPOS || !solo("BYMONTHDAY", [inicio.dia])) return null;
    if (!solo("BYMONTH", [inicio.mes])) return null;
  }
  if (repeticion === "diaria" && (p.BYMONTHDAY || p.BYMONTH || p.BYSETPOS)) return null;
  if (r.until) res.repetirHasta = aPanel(r.until, r.until.zone === ICAL.Timezone.utcTimezone ? null : h.tzid).fecha;
  else if (r.count) {
    const { fechas, completo } = expandir(v, h.tzid, h.fecha, "9999-12-31");
    if (!completo) return null;
    res.repetirHasta = fechas[fechas.length - 1] ?? h.fecha;
  }
  return res;
}

function texto(v: ICAL.Component, nombre: string): string | undefined {
  const x = v.getFirstPropertyValue(nombre);
  return typeof x === "string" && x.trim() ? x.trim() : undefined;
}

function modificadoDe(v: ICAL.Component): string | null {
  const t = v.getFirstPropertyValue("last-modified") ?? v.getFirstPropertyValue("dtstamp");
  return t instanceof ICAL.Time ? t.toJSDate().toISOString() : null;
}

function cancelado(v: ICAL.Component) {
  return String(v.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED";
}

export function parsear(ics: string): ICAL.Component {
  const cal = new ICAL.Component(ICAL.parse(ics));
  for (const tz of cal.getAllSubcomponents("vtimezone")) {
    const id = tz.getFirstPropertyValue("tzid");
    if (typeof id === "string" && !ICAL.TimezoneService.has(id)) ICAL.TimezoneService.register(new ICAL.Timezone(tz));
  }
  return cal;
}

/**
 * Id del panel en un UID que escribió el panel ("<id>@calendario-familiar"). Si al crearlo el UID ya
 * existía en otro calendario de la cuenta se le agregó ".xxxxxx" (6 letras al azar): se saca.
 * null si el UID no es del panel.
 */
export function idPropioDe(uid: string): string | null {
  if (!uid.endsWith(SUFIJO_UID)) return null;
  return uid.slice(0, -SUFIJO_UID.length).replace(/\.[a-km-z2-9]{6}$/, "") || null;
}

type RepeticionLeida = { regla: Omit<Repeticion, "sinComparar"> } | { fechas: string[] };

const memo = new Map<string, RepeticionLeida>();
function recordado(clave: string, calcular: () => RepeticionLeida): RepeticionLeida {
  const r = memo.get(clave);
  if (r) {
    memo.delete(clave);
    memo.set(clave, r);
    return r;
  }
  const nuevo = calcular();
  memo.set(clave, nuevo);
  if (memo.size > 300) memo.delete(memo.keys().next().value!);
  return nuevo;
}

/** Repetición del evento principal: con las opciones del panel si da exactamente los mismos días; si no, fechas sueltas. */
function repeticionDe(
  principal: ICAL.Component,
  h: Horario & { tzid: string | null; inicio: ICAL.Time },
  ev: Evento,
  excluidas: string[],
  fechasCambiadas: string[],
  canceladas: string[],
  ventana: { desde: string; hasta: string },
): RepeticionLeida {
  // Sólo una serie en hora de Santiago (o de día completo, o flotante) se traduce a las opciones del
  // panel: en UTC u otra zona la hora local cambia con el horario de verano y los días pueden correrse.
  const enSantiago = h.inicio.isDate || h.tzid === ZONA || (!h.tzid && h.inicio.zone !== ICAL.Timezone.utcTimezone);
  const simple = enSantiago ? reglaSimple(principal, h) : null;
  if (simple) {
    const { sinComparar, ...regla } = simple;
    if (sinComparar) return { regla };
    const candidato = canonico({ ...ev, ...regla, excepciones: excluidas });
    // Se comprueba que el panel muestre exactamente los mismos días que el iPhone.
    const desde = h.fecha > ventana.desde ? h.fecha : ventana.desde;
    const segun = expandir(principal, h.tzid, desde, ventana.hasta);
    if (segun.completo) {
      const ical = new Set(segun.fechas);
      const fuera = new Set([...fechasCambiadas, ...canceladas]);
      const empieza = probadorDeInicio(candidato);
      let iguales = true;
      for (let f = desde; f <= ventana.hasta && iguales; f = sumarDias(f, 1)) {
        if ((ical.has(f) && !fuera.has(f)) !== empieza(f)) iguales = false;
      }
      if (iguales) return { regla };
    }
  }
  return { fechas: expandir(principal, h.tzid, ventana.desde, ventana.hasta).fechas };
}

/**
 * Un recurso .ics → eventos del panel. `existentes`: los eventos del panel que ya están vinculados
 * a esta serie (se conservan sus id y lo que es sólo del panel). null si no tiene eventos (tareas…).
 */
export function leerRecurso(ics: string, ctx: Contexto, existentes: Evento[] = []): Grupo | null {
  const cal = parsear(ics);
  const vevents = cal.getAllSubcomponents("vevent");
  if (!vevents.length) return null;
  const uid = String(vevents[0].getFirstPropertyValue("uid") ?? "").trim();
  if (!uid) return null;
  const principal = vevents.find((v) => !v.getFirstProperty("recurrence-id"));
  const cambiados = vevents.filter((v) => v.getFirstProperty("recurrence-id"));
  const modificado = vevents.map(modificadoDe).filter((x): x is string => !!x).sort().pop() ?? null;
  const ventana = ventanaDe(ctx.hoy);

  const previoPrincipal = existentes.find((e) => !e.externo?.recurrencia);
  const previoCambiado = new Map(existentes.filter((e) => e.externo?.recurrencia).map((e) => [e.externo!.recurrencia!, e]));
  const idPropio = idPropioDe(uid);

  const base = (v: ICAL.Component, previo: Evento | undefined, id: string, recurrencia?: string): Evento | null => {
    const h = horarioDe(v);
    if (!h) return null;
    const nota = texto(v, "description");
    const resumen = texto(v, "summary") ?? "Sin título";
    // Si el título es el mismo que el panel escribió, se conservan sus personas (la detección por emoji
    // o nombre es sólo para lo que se escribió en el iPhone: "Cumpleaños de Sofía" puede ser de todos).
    // Un día que se acaba de mover en el iPhone trae el título de la serie: se compara con la serie.
    const ref = previo ?? (recurrencia ? previoPrincipal : undefined);
    const p =
      ref && resumen === tituloExterno(ref, ctx.miembros)
        ? { titulo: ref.titulo, miembros: ref.miembros }
        : personasDesde(resumen, nota, ctx.miembros);
    const ev: Evento = {
      id,
      titulo: p.titulo,
      miembros: p.miembros,
      fecha: h.fecha,
      fechaFin: h.fechaFin,
      todoElDia: h.todoElDia,
      horaInicio: h.horaInicio,
      horaFin: h.horaFin,
      repeticion: "nunca",
      nota,
      lugar: texto(v, "location"),
      externo: recurrencia ? { conexion: ctx.conexion, uid, recurrencia } : { conexion: ctx.conexion, uid },
      cuentaRegresiva: previo?.cuentaRegresiva,
      actualizado: previo?.actualizado,
    };
    return ev;
  };

  const eventos: Evento[] = [];
  const fechasCambiadas: string[] = [];
  const canceladas: string[] = [];
  for (const v of cambiados) {
    const rid = valorDe(v.getFirstProperty("recurrence-id"));
    if (!rid) continue;
    const rec = aPanel(rid.t, rid.tzid).fecha;
    if (cancelado(v)) {
      canceladas.push(rec);
      continue;
    }
    const previo = previoCambiado.get(rec);
    const ev = base(v, previo, previo?.id ?? idDe(`${uid}|${rec}`), rec);
    if (ev) {
      eventos.push(ev);
      fechasCambiadas.push(rec);
    }
  }

  if (principal && !cancelado(principal)) {
    const id = previoPrincipal?.id ?? idPropio ?? idDe(uid);
    const ev = base(principal, previoPrincipal, id);
    const h = horarioDe(principal);
    if (ev && h) {
      const excluidas = [...fechasDe(principal, "exdate"), ...fechasCambiadas, ...canceladas];
      if (principal.getFirstProperty("rrule") || principal.getFirstProperty("rdate")) {
        // Lo caro (recorrer la serie) no depende de lo que ya hay en el panel: se recuerda por recurso,
        // así leerlo dos veces en la misma sincronización (y al escribirlo) cuesta una sola vez.
        const clave = `${ctx.hoy}|${createHash("sha1").update(ics).digest("base64")}`;
        const rep = recordado(clave, () => repeticionDe(principal, h, ev, excluidas, fechasCambiadas, canceladas, ventana));
        if ("regla" in rep) Object.assign(ev, rep.regla, rep.regla.diasSemana ? { diasSemana: [...rep.regla.diasSemana] } : {});
        else ev.fechas = [...rep.fechas];
        // Todas las excluidas (también los EXDATE del iPhone) quedan como excepciones, así al escribir de
        // vuelta no se pierde ninguna.
        ev.excepciones = excluidas;
      }
      eventos.unshift(ev);
    }
  }

  return { uid, eventos: eventos.map((e) => normalizarEvento(e)).filter((e): e is Evento => !!e), modificado };
}

// ---------- Escribir ----------

function regla(ev: Evento): string | null {
  if (ev.repeticion === "nunca") return null;
  const frec = { diaria: "DAILY", semanal: "WEEKLY", mensual: "MONTHLY", anual: "YEARLY" }[ev.repeticion];
  const partesRegla = [`FREQ=${frec}`];
  if (ev.intervalo && ev.intervalo > 1) partesRegla.push(`INTERVAL=${ev.intervalo}`);
  const ini = partes(ev.fecha);
  if (ev.repeticion === "semanal") {
    if (ev.diasSemana?.length) partesRegla.push(`BYDAY=${diasDeLaSemana(ev).map((d) => DIAS_ICAL[d]).join(",")}`);
    if (ev.intervalo && ev.intervalo > 1) partesRegla.push("WKST=MO");
  }
  // "El 30 (o el último día si el mes es más corto)": el último de los días 28…30 que existan.
  if (ev.repeticion === "mensual" && ini.dia === 31) partesRegla.push("BYMONTHDAY=-1");
  else if (ev.repeticion === "mensual" && ini.dia > 28) {
    partesRegla.push(`BYMONTHDAY=${Array.from({ length: ini.dia - 27 }, (_, k) => 28 + k).join(",")}`, "BYSETPOS=-1");
  }
  if (ev.repeticion === "anual" && ini.mes === 2 && ini.dia === 29) partesRegla.push("BYMONTH=2", "BYMONTHDAY=28,29", "BYSETPOS=-1");
  if (ev.repetirHasta) {
    if (ev.todoElDia) partesRegla.push(`UNTIL=${ev.repetirHasta.replace(/-/g, "")}`);
    else {
      // Hasta el final de ese día en Santiago, escrito en UTC (así lo pide el estándar).
      const p = partes(ev.repetirHasta);
      const t = instanteLocal(ZONA, p.anio, p.mes, p.dia, 23, 59, 59);
      partesRegla.push(`UNTIL=${new Date(t).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`);
    }
  }
  return partesRegla.join(";");
}

function ponerTexto(v: ICAL.Component, nombre: string, valor: string | undefined) {
  v.removeAllProperties(nombre);
  if (valor) v.addPropertyWithValue(nombre, valor);
}

function ponerHorario(v: ICAL.Component, ev: Evento) {
  for (const k of ["dtstart", "dtend", "duration"]) v.removeAllProperties(k);
  if (ev.todoElDia) {
    v.addProperty(propFecha("dtstart", ev.fecha));
    v.addProperty(propFecha("dtend", sumarDias(ev.fechaFin ?? ev.fecha, 1)));
  } else {
    const ini = ev.horaInicio ?? "09:00";
    v.addProperty(propFecha("dtstart", ev.fecha, ini));
    const ultimo = ev.fechaFin ?? ev.fecha;
    // "Hasta las 23:59" (o varios días sin hora de término) = hasta la medianoche.
    if (ev.horaFin === "23:59" || (ev.fechaFin && !ev.horaFin)) v.addProperty(propFecha("dtend", sumarDias(ultimo, 1), "00:00"));
    else v.addProperty(propFecha("dtend", ultimo, ev.horaFin ?? ini)); // sin término: dura 0 minutos
  }
}

/**
 * EXDATE de la serie = excepciones del panel (menos los días que tienen su propio VEVENT). Los que ya
 * estaban se dejan tal cual; los nuevos (o todos, si cambió el inicio de la serie) se escriben con el
 * inicio exacto de esa ocurrencia en la zona de la serie, para que calcen aunque esté en UTC.
 */
/**
 * `antes` (la serie como estaba, sólo en las que el panel no sabe escribir): si un día que estaba
 * borrado ya no calza con la serie nueva, no se escribe nada (en el iPhone volvería a aparecer).
 */
function ponerExcepciones(v: ICAL.Component, ev: Evento, cambiadas: Set<string>, rehacer: boolean, antes?: ICAL.Component) {
  const faltan = new Set((ev.excepciones ?? []).filter((f) => !cambiadas.has(f)));
  const previas: Instancia[] = [];
  for (const p of v.getAllProperties("exdate")) {
    const tzid = (p.getParameter("tzid") as string | undefined) ?? null;
    for (const x of p.getValues()) if (x instanceof ICAL.Time) previas.push({ t: x, tzid });
  }
  v.removeAllProperties("exdate");
  if (!rehacer) {
    const puestas = new Set<string>();
    for (const i of previas) {
      const f = aPanel(i.t, i.tzid).fecha;
      if (!faltan.has(f)) continue;
      v.addProperty(propInstancia("exdate", i));
      puestas.add(f);
    }
    for (const f of puestas) faltan.delete(f);
  }
  const nuevas = instancias(v, faltan);
  for (const lista of nuevas.values()) for (const i of lista) v.addProperty(propInstancia("exdate", i));
  if (antes && [...instancias(antes, faltan).keys()].some((f) => !nuevas.has(f))) {
    throw new NoSePuedeEscribir(`"${ev.titulo}": con ese cambio volverían a aparecer en el iPhone los días que se borraron de la repetición. Cámbialo en el iPhone.`);
  }
}

/** Un cambio que el panel no puede escribir sin cambiar algo más de lo que se ve en el iPhone. El mensaje es para el aviso. */
export class NoSePuedeEscribir extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "NoSePuedeEscribir";
  }
}

type ZonaSerie = { utc: true } | { tzid: string; tz?: ICAL.Timezone };

/** Zona en que está escrita una serie, si no es Santiago (ni de día completo, ni flotante). */
function zonaDe(ini: { t: ICAL.Time; tzid: string | null }): ZonaSerie | null {
  if (ini.t.isDate) return null;
  if (ini.t.zone === ICAL.Timezone.utcTimezone) return { utc: true };
  if (!ini.tzid || ini.tzid === ZONA) return null;
  if (zonaIANA(ini.tzid)) return { tzid: ini.tzid };
  if (ini.t.zone && ini.t.zone !== ICAL.Timezone.localTimezone) return { tzid: ini.tzid, tz: ini.t.zone };
  return null; // zona desconocida: se lee como hora de Santiago (ver aPanel)
}

/** Hora de reloj de un instante en esa zona. */
function relojEn(z: ZonaSerie, instante: number): ICAL.Time {
  if ("utc" in z) return ICAL.Time.fromJSDate(new Date(instante), true);
  if (z.tz) {
    const t = ICAL.Time.fromJSDate(new Date(instante), true).convertToZone(z.tz);
    return ICAL.Time.fromData({ year: t.year, month: t.month, day: t.day, hour: t.hour, minute: t.minute, second: t.second, isDate: false }, z.tz);
  }
  const p = enZona(z.tzid, instante);
  const tz = ICAL.TimezoneService.get(z.tzid) ?? undefined;
  return ICAL.Time.fromData({ year: p.y, month: p.m, day: p.d, hour: p.h, minute: p.mi, second: p.s, isDate: false }, tz);
}

function propEn(nombre: string, z: ZonaSerie, t: ICAL.Time): ICAL.Property {
  const p = new ICAL.Property(nombre);
  p.setValue(t);
  if (!("utc" in z)) p.setParameter("tzid", z.tzid);
  return p;
}

const instanteSantiago = (fecha: string, hora: string) => {
  const p = partes(fecha);
  const [h, mi] = hora.split(":").map(Number);
  return instanteLocal(ZONA, p.anio, p.mes, p.dia, h, mi);
};

/**
 * Horario nuevo de una serie que el panel no sabe escribir (fechas sueltas): se cambian DTSTART y DTEND
 * y la regla queda como está. Si la serie está en UTC u otra zona, se escribe en esa zona: su regla
 * (BYDAY…) se cuenta en esa zona. Si con la hora nueva el día de inicio en esa zona se corre, se corren
 * también los días de la semana de la regla; si la regla no es de ese tipo, no se escribe nada.
 */
function moverSerieDeAfuera(v: ICAL.Component, ev: Evento) {
  const ini = valorDe(v.getFirstProperty("dtstart"));
  const z = ini ? zonaDe(ini) : null;
  if (!ini || !z || ev.todoElDia) ponerHorario(v, ev);
  else {
    const hi = ev.horaInicio ?? "09:00";
    const ultimo = ev.fechaFin ?? ev.fecha;
    const fin =
      ev.horaFin === "23:59" || (ev.fechaFin && !ev.horaFin) ? instanteSantiago(sumarDias(ultimo, 1), "00:00") : instanteSantiago(ultimo, ev.horaFin ?? hi);
    for (const k of ["dtstart", "dtend", "duration"]) v.removeAllProperties(k);
    v.addProperty(propEn("dtstart", z, relojEn(z, instanteSantiago(ev.fecha, hi))));
    v.addProperty(propEn("dtend", z, relojEn(z, fin)));
  }
  if (!ini) return;
  const nuevo = valorDe(v.getFirstProperty("dtstart"))!.t;
  const delta = diferenciaDias(fechaDe(ini.t.year, ini.t.month, ini.t.day), fechaDe(nuevo.year, nuevo.month, nuevo.day));
  const horaDelDia = (t: ICAL.Time) => ((relojMs(t) % 86_400_000) + 86_400_000) % 86_400_000;
  const cambioHora = ini.t.isDate !== nuevo.isDate || (!nuevo.isDate && horaDelDia(ini.t) !== horaDelDia(nuevo));
  const no = (porque: string) => {
    throw new NoSePuedeEscribir(`"${ev.titulo}": ${porque} Cámbialo en el iPhone.`);
  };
  if (delta && v.getAllProperties("rdate").length) no("con esa hora la repetición se correría de día.");
  for (const prop of v.getAllProperties("rrule")) {
    const r = (prop.getFirstValue() as ICAL.Recur).clone();
    const p = (r.parts ?? {}) as Record<string, (string | number)[]>;
    if (cambioHora && ("BYHOUR" in p || "BYMINUTE" in p || "BYSECOND" in p)) no("su repetición tiene horas fijas.");
    if (delta) {
      const dias = (p.BYDAY ?? []).map(String);
      const porDiasDeSemana = r.freq === "DAILY" || r.freq === "WEEKLY" || !!SEGUNDOS[r.freq];
      if (!porDiasDeSemana || Object.keys(p).some((k) => k !== "BYDAY") || dias.some((d) => !DIAS_ICAL.includes(d))) {
        no("con esa hora la repetición se correría de día.");
      }
      const mover = (d: string) => DIAS_ICAL[(((DIAS_ICAL.indexOf(d) + delta) % 7) + 7) % 7];
      if (dias.length) r.parts.BYDAY = dias.map(mover);
      // Cada 2 semanas o más: la semana también empieza un día corrido, para que no cambie cuáles tocan.
      if (r.freq === "WEEKLY" && r.interval > 1) {
        r.wkst = ICAL.Recur.icalDayToNumericDay(mover(ICAL.Recur.numericDayToIcalDay(r.wkst || ICAL.Time.MONDAY))) as typeof r.wkst;
      }
      if (r.until) {
        const u = r.until.clone();
        u.adjust(delta, 0, 0, 0);
        r.until = u;
      }
    }
    // UNTIL tiene que ser del mismo tipo que DTSTART (RFC 5545 §3.3.10).
    if (r.until && r.until.isDate !== nuevo.isDate) {
      r.until = nuevo.isDate
        ? horaReloj(aPanel(r.until, null).fecha, "00:00", true)
        : ICAL.Time.fromJSDate(new Date(instanteLocal(ZONA, r.until.year, r.until.month, r.until.day, 23, 59, 59)), true);
    }
    prop.setValue(r);
  }
}

function tocar(v: ICAL.Component, nuevo: boolean) {
  const ahora = ahoraUTC();
  v.updatePropertyWithValue("dtstamp", ahora);
  v.updatePropertyWithValue("last-modified", ahora);
  if (nuevo) v.updatePropertyWithValue("created", ahora);
  const seq = Number(v.getFirstPropertyValue("sequence") ?? -1);
  v.updatePropertyWithValue("sequence", Number.isFinite(seq) ? seq + 1 : 0);
}

const mismo = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Eventos del panel → recurso .ics. Con `anterior` (lo que hay hoy en el calendario) se parte de
 * ahí y se cambia sólo lo que cambió en el panel.
 */
export function escribirRecurso(grupo: Evento[], ctx: Contexto, uid: string, anterior?: string | null): string {
  const eventos = enCalendario(grupo).map(canonico);
  const principal = eventos.find((e) => !e.externo?.recurrencia);
  const cambiados = eventos.filter((e) => e.externo?.recurrencia);
  const cal = anterior ? parsear(anterior) : new ICAL.Component(["vcalendar", [], []]);
  if (!anterior) {
    cal.updatePropertyWithValue("version", "2.0");
    cal.updatePropertyWithValue("prodid", PRODID);
    cal.updatePropertyWithValue("calscale", "GREGORIAN");
  }
  // Leído con el grupo del panel: así un título que el panel escribió se reconoce igual (ver leerRecurso).
  const previo = anterior ? leerRecurso(anterior, ctx, grupo) : null;
  const previoDe = (rec?: string) => previo?.eventos.find((e) => (e.externo?.recurrencia ?? "") === (rec ?? ""));
  const vevents = cal.getAllSubcomponents("vevent");
  const vDe = (rec?: string) =>
    vevents.find((v) => {
      const rid = valorDe(v.getFirstProperty("recurrence-id"));
      return rec ? !!rid && aPanel(rid.t, rid.tzid).fecha === rec : !rid;
    });
  const fechasCambiadas = new Set(cambiados.map((e) => e.externo!.recurrencia!));
  const cambiadasAntes = new Set<string>();
  for (const v of vevents) {
    const rid = valorDe(v.getFirstProperty("recurrence-id"));
    if (rid) cambiadasAntes.add(aPanel(rid.t, rid.tzid).fecha);
  }
  const usados = new Set<ICAL.Component>();
  /** La serie como estaba (sólo si el panel no sabe escribir su repetición): para no perder días borrados. */
  let serieAntes: ICAL.Component | undefined;
  // Los días cancelados en el iPhone (RECURRENCE-ID con STATUS:CANCELLED) quedan tal cual.
  for (const v of vevents) {
    const rid = valorDe(v.getFirstProperty("recurrence-id"));
    if (rid && cancelado(v)) {
      usados.add(v);
      fechasCambiadas.add(aPanel(rid.t, rid.tzid).fecha);
    }
  }

  const escribir = (ev: Evento, rec?: string): boolean => {
    let v = vDe(rec);
    const nuevo = !v;
    if (!v) {
      v = new ICAL.Component("vevent");
      v.updatePropertyWithValue("uid", uid);
      cal.addSubcomponent(v);
    }
    usados.add(v);
    const antes = nuevo ? undefined : previoDe(rec);
    let cambio = nuevo;
    const titulo = tituloExterno(ev, ctx.miembros);
    if (!antes || titulo !== tituloExterno(antes, ctx.miembros)) {
      ponerTexto(v, "summary", titulo);
      cambio = true;
    }
    if (!antes || !mismo(ev.nota, antes.nota)) {
      ponerTexto(v, "description", ev.nota);
      cambio = true;
    }
    if (!antes || !mismo(ev.lugar, antes.lugar)) {
      ponerTexto(v, "location", ev.lugar);
      cambio = true;
    }
    const horario = (e: Evento) => [e.fecha, e.fechaFin, e.todoElDia, e.horaInicio, e.horaFin];
    const cambioHorario = !antes || !mismo(horario(ev), horario(antes));
    // Repetición que el panel no sabe escribir: su regla se conserva tal cual (ver moverSerieDeAfuera).
    const deAfuera = !rec && !!ev.fechas && !!antes;
    if (deAfuera) serieAntes = clonar(v);
    if (cambioHorario) {
      if (deAfuera) moverSerieDeAfuera(v, ev);
      else ponerHorario(v, ev);
      cambio = true;
    }
    if (!rec) {
      const rep = (e: Evento) => [e.repeticion, e.intervalo, e.diasSemana, e.repetirHasta];
      if (!ev.fechas && (!antes || antes.fechas || !mismo(rep(ev), rep(antes)) || cambioHorario)) {
        v.removeAllProperties("rrule");
        v.removeAllProperties("rdate");
        const r = regla(ev);
        if (r) v.addPropertyWithValue("rrule", ICAL.Recur.fromString(r));
        cambio = true;
      }
      if (!antes || cambioHorario || !mismo(ev.excepciones, antes.excepciones) || !mismo([...fechasCambiadas].sort(), [...cambiadasAntes].sort())) {
        ponerExcepciones(v, ev, fechasCambiadas, !antes || cambioHorario, deAfuera && cambioHorario ? serieAntes : undefined);
        cambio = true;
      }
    } else if (nuevo) {
      const vp = vDe();
      const i = vp ? instancias(vp, [rec]).get(rec)?.[0] : undefined;
      v.addProperty(i ? propInstancia("recurrence-id", i) : propFecha("recurrence-id", rec, principal?.todoElDia || !principal ? undefined : (principal.horaInicio ?? "09:00")));
    }
    if (cambio) tocar(v, nuevo);
    return cambioHorario;
  };

  const cambioSerie = principal ? escribir(principal) : false;
  for (const c of cambiados) escribir(c, c.externo!.recurrencia);
  // Si cambió el inicio de la serie, los días cambiados (y cancelados) siguen apuntando a su día, con
  // el inicio nuevo de esa ocurrencia.
  const vPrincipal = principal ? vDe() : undefined;
  if (vPrincipal && previo && cambioSerie) {
    const otros = vevents.filter((v) => v !== vPrincipal && v.getFirstProperty("recurrence-id"));
    const diaDe = (v: ICAL.Component) => {
      const rid = valorDe(v.getFirstProperty("recurrence-id"))!;
      return aPanel(rid.t, rid.tzid).fecha;
    };
    const nuevas = instancias(vPrincipal, otros.map(diaDe));
    const viejas = serieAntes ? instancias(serieAntes, otros.map(diaDe)) : null;
    for (const v of otros) {
      const i = nuevas.get(diaDe(v))?.[0];
      if (!i) {
        // Era un día de la serie y con el cambio ya no lo es: quedaría suelto en el iPhone.
        if (viejas?.has(diaDe(v))) {
          throw new NoSePuedeEscribir(`"${principal!.titulo}": con ese cambio, los días que se cambiaron sólo una vez quedarían sueltos en el iPhone. Cámbialo en el iPhone.`);
        }
        continue;
      }
      v.removeAllProperties("recurrence-id");
      v.addProperty(propInstancia("recurrence-id", i));
      tocar(v, false);
    }
  }
  // Lo que se borró en el panel (un día cambiado, o la serie): fuera del recurso.
  for (const v of cal.getAllSubcomponents("vevent")) if (!usados.has(v)) cal.removeSubcomponent(v);

  // La zona de Santiago, si algún valor la usa.
  const usaZona = /TZID=America\/Santiago/.test(cal.toString());
  const tieneZona = cal.getAllSubcomponents("vtimezone").some((tz) => tz.getFirstPropertyValue("tzid") === ZONA);
  if (usaZona && !tieneZona) {
    const tz = new ICAL.Component(ICAL.parse(`BEGIN:VCALENDAR\r\n${VTIMEZONE}\r\nEND:VCALENDAR`)).getFirstSubcomponent("vtimezone")!;
    const evs = cal.getAllSubcomponents("vevent");
    evs.forEach((v) => cal.removeSubcomponent(v));
    cal.addSubcomponent(tz);
    evs.forEach((v) => cal.addSubcomponent(v));
  }
  return cal.toString() + "\r\n";
}

