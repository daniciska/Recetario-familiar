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
import { canonico, diasDeLaSemana, empiezaEn } from "../lib/eventos";
import { ZONA, partes, sumarDias } from "../lib/fechas";
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
  let t = reloj - desfase(reloj);
  const d2 = desfase(t);
  if (reloj - d2 !== t) t = reloj - d2;
  return t;
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

/** Eventos de una serie que van al calendario (si el principal es "sólo panel", la serie no va). */
export function enCalendario(grupo: Evento[]): Evento[] {
  const principal = grupo.find((e) => !e.externo?.recurrencia);
  if (principal?.soloPanel) return [];
  return grupo.filter((e) => !e.soloPanel);
}

export function huellaGrupo(grupo: Evento[], miembros: Miembro[]): string {
  const v = enCalendario(grupo)
    .map((e) => visible(canonico(e), miembros))
    .sort((a, b) => (a.rc ?? "").localeCompare(b.rc ?? ""));
  return createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 32);
}

const idDe = (texto: string) => `ic_${createHash("sha256").update(texto).digest("hex").slice(0, 16)}`;

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
    const p = enZona(ZONA, a.instante + dur.toSeconds() * 1000);
    b = { fecha: fechaDe(p.y, p.m, p.d), hora: `${dosDig(p.h)}:${dosDig(p.mi)}` };
  }
  const h: Horario & { tzid: string | null; inicio: ICAL.Time } = { fecha: a.fecha, todoElDia: false, horaInicio: a.hora, tzid: ini.tzid, inicio: ini.t };
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

/** Fechas (en Santiago) en que empieza la serie dentro de la ventana, según el .ics. */
function expandir(v: ICAL.Component, tzid: string | null, desde: string, hasta: string): string[] {
  const it = new ICAL.Event(v).iterator();
  const r: string[] = [];
  for (let i = 0, n: ICAL.Time | null; i < 6000 && (n = it.next()); i++) {
    const f = aPanel(n, tzid).fecha;
    if (f > hasta) break;
    if (f >= desde) r.push(f);
  }
  return [...new Set(r)];
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
    const fechas = expandir(v, h.tzid, h.fecha, "9999-12-31");
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
  const idPropio = uid.endsWith(SUFIJO_UID) ? uid.slice(0, -SUFIJO_UID.length) : null;

  const base = (v: ICAL.Component, previo: Evento | undefined, id: string, recurrencia?: string): Evento | null => {
    const h = horarioDe(v);
    if (!h) return null;
    const nota = texto(v, "description");
    const p = personasDesde(texto(v, "summary") ?? "Sin título", nota, ctx.miembros);
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
        const simple = reglaSimple(principal, h);
        let usada = false;
        if (simple) {
          const { sinComparar, ...regla } = simple;
          const candidato = canonico({ ...ev, ...regla, excepciones: excluidas });
          // Se comprueba que el panel muestre exactamente los mismos días que el iPhone.
          const desde = h.fecha > ventana.desde ? h.fecha : ventana.desde;
          const segun = new Set(expandir(principal, h.tzid, desde, ventana.hasta));
          let iguales = true;
          for (let f = desde; !sinComparar && f <= ventana.hasta && iguales; f = sumarDias(f, 1)) {
            const ical = segun.has(f) && !fechasCambiadas.includes(f) && !canceladas.includes(f);
            if (ical !== empiezaEn(candidato, f)) iguales = false;
          }
          if (iguales) {
            Object.assign(ev, regla, { excepciones: excluidas });
            usada = true;
          }
        }
        if (!usada) {
          ev.fechas = expandir(principal, h.tzid, ventana.desde, ventana.hasta);
          ev.excepciones = [...fechasCambiadas, ...canceladas];
        }
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

function ponerExcepciones(v: ICAL.Component, ev: Evento, cambiadas: Set<string>) {
  v.removeAllProperties("exdate");
  for (const f of ev.excepciones ?? []) {
    if (cambiadas.has(f)) continue; // ese día está en su propio VEVENT (RECURRENCE-ID, cambiado o cancelado)
    v.addProperty(propFecha("exdate", f, ev.todoElDia ? undefined : (ev.horaInicio ?? "09:00")));
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
  const previo = anterior ? leerRecurso(anterior, ctx) : null;
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
  // Los días cancelados en el iPhone (RECURRENCE-ID con STATUS:CANCELLED) quedan tal cual.
  for (const v of vevents) {
    const rid = valorDe(v.getFirstProperty("recurrence-id"));
    if (rid && cancelado(v)) {
      usados.add(v);
      fechasCambiadas.add(aPanel(rid.t, rid.tzid).fecha);
    }
  }

  const escribir = (ev: Evento, rec?: string) => {
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
    if (cambioHorario) {
      ponerHorario(v, ev);
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
        ponerExcepciones(v, ev, fechasCambiadas);
        cambio = true;
      }
    } else if (nuevo) {
      v.addProperty(propFecha("recurrence-id", rec, principal?.todoElDia || !principal ? undefined : (principal.horaInicio ?? "09:00")));
    }
    if (cambio) tocar(v, nuevo);
  };

  if (principal) escribir(principal);
  for (const c of cambiados) escribir(c, c.externo!.recurrencia);
  // Si cambió la hora de la serie, los días cambiados siguen apuntando a su día con la hora nueva.
  const vPrincipal = principal ? vDe() : undefined;
  if (principal && vPrincipal && previo && !mismo(previoDe()?.horaInicio, principal.horaInicio)) {
    for (const v of vevents) {
      if (v === vPrincipal || !v.getFirstProperty("recurrence-id")) continue;
      const rid = valorDe(v.getFirstProperty("recurrence-id"))!;
      const rec = aPanel(rid.t, rid.tzid).fecha;
      v.removeAllProperties("recurrence-id");
      v.addProperty(propFecha("recurrence-id", rec, principal.todoElDia ? undefined : (principal.horaInicio ?? "09:00")));
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

