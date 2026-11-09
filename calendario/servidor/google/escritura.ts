// Del .ics que arma el motor (escribirRecurso de servidor/ics.ts) a los pedidos de la Calendar API v3.
// Funciones puras: deciden qué mandar (o por qué no se puede) ANTES de que el transporte escriba nada.
//
// El motor parte de la serie proyectada (serie.ts, "A") y cambia sólo lo que cambió en el panel ("B").
// planear compara A con B pieza por pieza y traduce la diferencia a lo que Google sí permite:
// - campos del principal (título, nota, lugar, horas, repetición) → un PATCH del principal;
// - un día borrado → EXDATE en recurrence, o cancelar la excepción de ese día si existe;
// - un día cambiado que se edita → PATCH de esa excepción.
// Lo que Google no deja hacer sin cambiar otra cosa (mover una serie que tiene días cambiados, revivir
// un día cancelado allá, crear o deshacer un día cambiado) lanza NoSePuedeEscribir: el motor deja lo de
// Google y avisa.
//
// API:
//   vista(ics): Record<clave, VistaPieza>          clave "" = principal; si no, claveValor(RECURRENCE-ID)
//   ocurre(principalB, original): boolean          ¿la regla de B (sin EXDATE) genera ese inicio?
//   planear(serie, icsB): Plan                     { maestro?, ops, avisoTitulo } o NoSePuedeEscribir
//   cuerposDeHora(vevent, conRecurrencia)          { start, end } con date/dateTime/timeZone (null = borrar)
//   recurrenciaDe(vevent): string[]                RRULE/EXRULE/RDATE + un EXDATE por valor
//   cuerpoInsert(veventB, uid, gen): Cuerpo        cuerpo de events.insert (con id y marca)
//   planearCreacion(icsB): Creacion                todo lo que necesita crear() (insert + días cambiados)
//   fusionar(base, parche), marcar(base, cuerpo)   mezcla "como PATCH" y marca de escritura propia (cfh)
//   finIgualInicio(cuerpo), sinHoraDeTermino(cuerpo, base)   respaldo para "sin hora de término"
//   tipos VistaPieza, HoraCuerpo, Cuerpo, Op, Plan, DiaNuevo, Creacion
//
// Nunca se mandan sequence, attendees, organizer, reminders, conferenceData, attachments, eventType,
// colorId, visibility, transparency ni guestsCan*: así Google conserva Meet, adjuntos, colores,
// recordatorios e invitados. Cada cuerpo lleva extendedProperties.private.cfh = huellaPieza de lo que
// quedará en Google si lo acepta tal cual (ver serie.ts).

import ICAL from "ical.js";
import { ZONA } from "../../lib/fechas";
import { NoSePuedeEscribir, instancias, parsear } from "../ics";
import { idGoogleDe } from "./ids";
import {
  basicoUTC,
  claveHora,
  claveValor,
  esZonaUTC,
  fechaDeClave,
  huellaPieza,
  normRec,
  proyectar,
  relojEn,
  zonaValida,
  type EvG,
  type HoraG,
  type Serie,
} from "./serie";

export interface VistaPieza {
  summary: string;
  description: string;
  location: string;
  /** "D:AAAA-MM-DD" o "<zona>|T:<ms>" (flotante = America/Santiago). */
  start: string | null;
  end: string | null;
  status: string;
  /** Líneas RRULE, RDATE y EXRULE (toICALString), ordenadas. */
  reglas: string[];
  /** Valores de EXDATE como claves ("D:fecha" o "T:ms"), ordenados. */
  exdate: string[];
}

export interface HoraCuerpo {
  date: string | null;
  dateTime: string | null;
  timeZone: string | null;
}

export type Cuerpo = Record<string, unknown>;

export interface Op {
  tipo: "cambiar" | "cancelar";
  id: string;
  /** Etag JSON de la excepción (con sus comillas), para If-Match. */
  etag?: string;
  cuerpo: Cuerpo;
  /** claveHora(originalStartTime) y su fecha en Santiago (para los avisos). */
  clave: string;
  fecha: string;
  pieza: EvG;
}

export interface Plan {
  /** PATCH del principal (si hay algo que cambiarle). */
  maestro?: Cuerpo;
  /** PATCH de excepciones, en orden: primero las que se cambian, después las que se cancelan. */
  ops: Op[];
  /** SUMMARY de B (para los avisos). */
  avisoTitulo: string;
}

// ---------- Lectura de un .ics ----------

type Valor = { t: ICAL.Time; tzid: string | null };

const tzidDe = (p: ICAL.Property) => (p.getParameter("tzid") as string | undefined) ?? null;

function valorDe(p: ICAL.Property | null): Valor | null {
  if (!p) return null;
  const t = p.getFirstValue();
  return t instanceof ICAL.Time ? { t, tzid: tzidDe(p) } : null;
}

const dd = (n: number, l = 2) => String(n).padStart(l, "0");
const fechaIso = (t: ICAL.Time) => `${dd(t.year, 4)}-${dd(t.month)}-${dd(t.day)}`;
const sumarDiasIso = (f: string, n: number) => new Date(Date.parse(`${f}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Zona en que se manda una hora con TZID: la IANA si Intl la conoce; si no (o flotante), Santiago, como lee ics.ts. */
const zonaDeEnvio = (tzid: string | null) => (zonaValida(tzid) && !esZonaUTC(tzid) ? tzid : ZONA);
const esUtc = (v: Valor) => !v.t.isDate && (v.t.zone === ICAL.Timezone.utcTimezone || esZonaUTC(v.tzid));
const instanteDe = (v: Valor) => Number(claveValor(v.t, v.tzid).slice(2));

/** Hora de reloj de un instante en una zona, como valor del .ics. */
function valorEn(zona: string, ms: number): Valor {
  if (esZonaUTC(zona)) return { t: ICAL.Time.fromJSDate(new Date(ms), true), tzid: null };
  const p = relojEn(zona, ms);
  return { t: ICAL.Time.fromData({ year: p.y, month: p.m, day: p.d, hour: p.h, minute: p.mi, second: p.s, isDate: false }), tzid: zona };
}

/** Fin de un VEVENT: DTEND; si no, DTSTART + DURATION; si no, el día siguiente (día completo) o el mismo inicio. */
function finDe(v: ICAL.Component, ini: Valor): Valor {
  const fin = valorDe(v.getFirstProperty("dtend"));
  if (fin) return fin;
  const dur = v.getFirstPropertyValue("duration");
  if (ini.t.isDate) {
    const dias = dur instanceof ICAL.Duration ? Math.max(1, Math.round(dur.toSeconds() / 86400)) : 1;
    const f = sumarDiasIso(fechaIso(ini.t), dias);
    return { t: ICAL.Time.fromData({ year: +f.slice(0, 4), month: +f.slice(5, 7), day: +f.slice(8, 10), isDate: true }), tzid: null };
  }
  if (!(dur instanceof ICAL.Duration)) return ini;
  const ms = instanteDe(ini) + dur.toSeconds() * 1000;
  return esUtc(ini) ? valorEn("UTC", ms) : valorEn(zonaDeEnvio(ini.tzid), ms);
}

function horaVista(v: Valor): string {
  if (v.t.isDate) return claveValor(v.t, null);
  return `${esUtc(v) ? "UTC" : zonaDeEnvio(v.tzid)}|${claveValor(v.t, v.tzid)}`;
}

const NOMBRES_REGLA = ["rrule", "rdate", "exrule"];
const textoDe = (v: ICAL.Component, n: string) => {
  const x = v.getFirstPropertyValue(n);
  return typeof x === "string" ? x : "";
};

interface Leido {
  vistas: Record<string, VistaPieza>;
  vevents: Map<string, ICAL.Component>;
  /** Valores de EXDATE del principal, tal como están escritos: clave → valor. */
  exdates: Map<string, Valor>;
  uid: string;
  titulo: string;
}

function leer(ics: string): Leido {
  const cal = parsear(ics);
  const vistas: Record<string, VistaPieza> = {};
  const vevents = new Map<string, ICAL.Component>();
  const exdates = new Map<string, Valor>();
  let uid = "";
  for (const v of cal.getAllSubcomponents("vevent")) {
    uid ||= String(v.getFirstPropertyValue("uid") ?? "").trim();
    const ridProp = v.getFirstProperty("recurrence-id");
    let clave = "";
    if (ridProp) {
      const rid = valorDe(ridProp);
      if (!rid) continue;
      clave = claveValor(rid.t, rid.tzid);
    }
    if (vevents.has(clave)) continue;
    const ini = valorDe(v.getFirstProperty("dtstart"));
    const ex = new Set<string>();
    for (const p of v.getAllProperties("exdate")) {
      const tzid = tzidDe(p);
      for (const x of p.getValues()) {
        if (!(x instanceof ICAL.Time)) continue;
        const k = claveValor(x, tzid);
        ex.add(k);
        if (!clave && !exdates.has(k)) exdates.set(k, { t: x, tzid });
      }
    }
    vevents.set(clave, v);
    vistas[clave] = {
      summary: textoDe(v, "summary"),
      description: textoDe(v, "description"),
      location: textoDe(v, "location"),
      start: ini ? horaVista(ini) : null,
      end: ini ? horaVista(finDe(v, ini)) : null,
      status: String(v.getFirstPropertyValue("status") ?? "").toUpperCase(),
      reglas: v
        .getAllProperties()
        .filter((p) => NOMBRES_REGLA.includes(p.name))
        .map((p) => p.toICALString())
        .sort(),
      exdate: [...ex].sort(),
    };
  }
  const principal = vevents.get("") ?? [...vevents.values()][0];
  const titulo = (principal && textoDe(principal, "summary").trim()) || "Sin título";
  return { vistas, vevents, exdates, uid, titulo };
}

/** Vista de un .ics para comparar dos versiones de la misma serie (SEQUENCE, DTSTAMP, LAST-MODIFIED y VTIMEZONE no cuentan). */
export function vista(ics: string): Record<string, VistaPieza> {
  return leer(ics).vistas;
}

// ---------- Repetición ----------

/** ¿La regla de B (RRULE + RDATE, sin EXDATE) genera ese inicio? En la zona de la serie; con tope de vueltas y de tiempo. */
export function ocurre(principalB: ICAL.Component, original: HoraG): boolean {
  const k = claveHora(original);
  if (!k) return false;
  const fecha = fechaDeClave(k);
  return (instancias(principalB, [fecha]).get(fecha) ?? []).some((i) => claveValor(i.t, i.tzid) === k);
}

const DIAS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/** Una RRULE escrita sin lo que ya dice DTSTART (BYDAY = su día, BYMONTHDAY = su fecha, WKST cuando no importa…). */
function reglaCanonica(r: ICAL.Recur, ini: Valor) {
  const partes: Record<string, string> = {};
  for (const [k, v] of Object.entries((r.parts ?? {}) as Record<string, unknown[]>)) {
    if (Array.isArray(v) && v.length) partes[k.toUpperCase()] = v.map(String).sort().join(",");
  }
  const intervalo = r.interval > 1 ? r.interval : 1;
  const t = ini.t;
  const solo = (...k: string[]) => Object.keys(partes).every((x) => k.includes(x));
  if (r.freq === "WEEKLY" && partes.BYDAY === DIAS[t.dayOfWeek() - 1] && solo("BYDAY")) delete partes.BYDAY;
  if (r.freq === "MONTHLY" && partes.BYMONTHDAY === String(t.day) && solo("BYMONTHDAY")) delete partes.BYMONTHDAY;
  if (r.freq === "YEARLY") {
    if (partes.BYMONTH === String(t.month)) delete partes.BYMONTH;
    if (partes.BYMONTHDAY === String(t.day) && solo("BYMONTHDAY")) delete partes.BYMONTHDAY;
  }
  const semana = (r.freq === "WEEKLY" && intervalo > 1) || "BYWEEKNO" in partes;
  const until = r.until ? (r.until.isDate ? claveValor(r.until, null) : claveValor(r.until, r.until.zone === ICAL.Timezone.utcTimezone ? null : ini.tzid)) : null;
  return {
    freq: r.freq,
    intervalo,
    count: r.count ?? null,
    until,
    wkst: semana ? r.wkst || ICAL.Time.MONDAY : null,
    partes: Object.fromEntries(Object.entries(partes).sort(([a], [b]) => (a < b ? -1 : 1))),
  };
}

/** ¿B repite igual que A? Mismo texto, o la misma RRULE salvo lo que ya dice el DTSTART de B. */
function reglasEquivalentes(vA: ICAL.Component, vB: ICAL.Component, a: VistaPieza, b: VistaPieza): boolean {
  if (JSON.stringify(a.reglas) === JSON.stringify(b.reglas)) return true;
  const otras = (v: ICAL.Component) =>
    v
      .getAllProperties()
      .filter((p) => p.name === "rdate" || p.name === "exrule")
      .map((p) => p.toICALString())
      .sort();
  if (JSON.stringify(otras(vA)) !== JSON.stringify(otras(vB))) return false;
  const ra = vA.getAllProperties("rrule");
  const rb = vB.getAllProperties("rrule");
  const ini = valorDe(vB.getFirstProperty("dtstart"));
  if (ra.length !== 1 || rb.length !== 1 || !ini) return false;
  const x = ra[0].getFirstValue();
  const y = rb[0].getFirstValue();
  if (!(x instanceof ICAL.Recur) || !(y instanceof ICAL.Recur)) return false;
  return JSON.stringify(reglaCanonica(x, ini)) === JSON.stringify(reglaCanonica(y, ini));
}

/** Una línea EXDATE para un valor: con TZID IANA, en UTC (Z) o de día completo. */
function lineaExdate(v: Valor): string {
  if (v.t.isDate) return `EXDATE;VALUE=DATE:${fechaIso(v.t).replace(/-/g, "")}`;
  if (esUtc(v)) return `EXDATE:${basicoUTC(instanteDe(v))}`;
  if (zonaValida(v.tzid)) return `EXDATE;TZID=${v.tzid}:${v.t.toICALString()}`;
  const s = valorEn(ZONA, instanteDe(v));
  return `EXDATE;TZID=${ZONA}:${s.t.toICALString()}`;
}

/** recurrence[] de un VEVENT: sus RRULE/EXRULE/RDATE y un EXDATE por valor (ordenados). Sin regla, nada. */
export function recurrenciaDe(v: ICAL.Component): string[] {
  const reglas = v
    .getAllProperties()
    .filter((p) => NOMBRES_REGLA.includes(p.name))
    .map((p) => p.toICALString());
  if (!reglas.some((l) => /^(RRULE|RDATE)[;:]/i.test(l))) return [];
  const ex = new Map<string, Valor>();
  for (const p of v.getAllProperties("exdate")) {
    const tzid = tzidDe(p);
    for (const x of p.getValues()) if (x instanceof ICAL.Time) ex.set(claveValor(x, tzid), { t: x, tzid });
  }
  return [...reglas, ...[...ex.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, x]) => lineaExdate(x))];
}

const mismaRecurrencia = (a: readonly string[], b: readonly string[]) => JSON.stringify(normRec(a)) === JSON.stringify(normRec(b));

// ---------- Cuerpos de hora ----------

/** RFC 3339 con el desfase de esa zona en ese instante (así los cambios de hora de Chile se resuelven como en ics.ts). */
function conDesfase(zona: string, ms: number): string {
  const s = Math.floor(ms / 1000) * 1000;
  const p = relojEn(zona, s);
  const min = Math.round((Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - s) / 60_000);
  const a = Math.abs(min);
  return `${dd(p.y, 4)}-${dd(p.m)}-${dd(p.d)}T${dd(p.h)}:${dd(p.mi)}:${dd(p.s)}${min < 0 ? "-" : "+"}${dd(Math.floor(a / 60))}:${dd(a % 60)}`;
}

function cuerpoHora(v: Valor, conRecurrencia: boolean): HoraCuerpo {
  if (v.t.isDate) return { date: fechaIso(v.t), dateTime: null, timeZone: null };
  const ms = instanteDe(v);
  if (esUtc(v)) return { date: null, dateTime: new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"), timeZone: conRecurrencia ? "UTC" : null };
  const zona = zonaDeEnvio(v.tzid);
  return { date: null, dateTime: conDesfase(zona, ms), timeZone: zona };
}

/**
 * start y end para la API, tomados de DTSTART y DTEND (o DURATION) del VEVENT. Los null van a propósito:
 * PATCH mezcla los objetos anidados, y sin ellos quedarían date y dateTime juntos.
 */
export function cuerposDeHora(v: ICAL.Component, conRecurrencia: boolean): { start: HoraCuerpo; end: HoraCuerpo } {
  const ini = valorDe(v.getFirstProperty("dtstart"));
  if (!ini) throw new NoSePuedeEscribir(`"${textoDe(v, "summary") || "Sin título"}" no tiene fecha de inicio.`);
  return { start: cuerpoHora(ini, conRecurrencia), end: cuerpoHora(finDe(v, ini), conRecurrencia) };
}

const esHora = (x: unknown): x is HoraCuerpo => !!x && typeof x === "object";

/** ¿El cuerpo dice que termina a la misma hora que empieza (evento con hora, sin hora de término)? */
export function finIgualInicio(cuerpo: Cuerpo): boolean {
  const s = cuerpo.start;
  const e = cuerpo.end;
  return esHora(s) && esHora(e) && !!s.dateTime && !!e.dateTime && Date.parse(s.dateTime) === Date.parse(e.dateTime);
}

// ---------- Marca de escritura propia ----------

const esObjeto = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

/** Mezcla "como PATCH": los objetos se mezclan, null borra la clave y los arreglos se reemplazan. */
export function fusionar<T extends object>(base: T, parche: Cuerpo): T {
  const r: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(parche)) {
    if (v === null) delete r[k];
    else if (esObjeto(v)) r[k] = fusionar(esObjeto(r[k]) ? r[k] : {}, v);
    else r[k] = Array.isArray(v) ? structuredClone(v) : v;
  }
  return r as T;
}

/** El cuerpo con extendedProperties.private.cfh = huella de cómo quedará la pieza (`base`) si Google lo acepta tal cual. */
export function marcar(base: EvG | Record<string, never>, cuerpo: Cuerpo): Cuerpo {
  const { extendedProperties: _, ...limpio } = cuerpo;
  const cfh = huellaPieza(fusionar(base as EvG, limpio));
  return { ...limpio, extendedProperties: { private: { cfh } } };
}

/** Respaldo cuando Google no acepta fin = inicio: sin `end` y con endTimeUnspecified (y la marca de nuevo). */
export function sinHoraDeTermino(cuerpo: Cuerpo, base: EvG | Record<string, never> = {}): Cuerpo {
  const { end: _, extendedProperties: __, ...resto } = cuerpo;
  return marcar(base, { ...resto, endTimeUnspecified: true });
}

/** Si la pieza estaba "sin hora de término" y ahora tiene una, hay que decírselo a Google. */
function ajustarFin(cuerpo: Cuerpo, base: EvG) {
  if (base.endTimeUnspecified && "end" in cuerpo && !finIgualInicio(cuerpo)) cuerpo.endTimeUnspecified = false;
  return cuerpo;
}

// ---------- Planear un cambio ----------

const TEXTOS = ["summary", "description", "location"] as const;

/** Campos de una pieza que difieren entre A y B (null si ninguno). */
function diferencia(a: VistaPieza, b: VistaPieza, vB: ICAL.Component, base: EvG, conRecurrencia: boolean): Cuerpo | null {
  const c: Cuerpo = {};
  for (const k of TEXTOS) if (a[k] !== b[k]) c[k] = b[k];
  if (a.start !== b.start || a.end !== b.end) Object.assign(c, cuerposDeHora(vB, conRecurrencia));
  ajustarFin(c, base);
  return Object.keys(c).length ? c : null;
}

const igualesVistas = (a: Record<string, VistaPieza>, b: Record<string, VistaPieza>) => {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return JSON.stringify(ka) === JSON.stringify(kb) && ka.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));
};

function op(tipo: Op["tipo"], pieza: EvG, clave: string, cuerpo: Cuerpo): Op {
  return { tipo, id: pieza.id, etag: pieza.etag, cuerpo: marcar(pieza, cuerpo), clave, fecha: fechaDeClave(clave), pieza };
}

/**
 * Qué pedir a Google para que la serie quede como B (lo que escribió escribirRecurso a partir de
 * serieAIcs(serie)). Lanza NoSePuedeEscribir antes de escribir nada si el cambio no se puede hacer
 * desde la pared. Un plan sin maestro ni ops = no hay nada que mandar.
 */
export function planear(serie: Serie, icsB: string): Plan {
  const B = leer(icsB);
  const T = B.titulo;
  const proy = proyectar(serie);
  const A = leer(proy.ics);
  // Nada que el panel vea cambió (sólo SEQUENCE, DTSTAMP, VTIMEZONE…): no hay nada que mandar.
  if (igualesVistas(A.vistas, B.vistas)) return { ops: [], avisoTitulo: T };
  const principal = serie.principal;
  if (serie.soloLectura || !principal) {
    throw new NoSePuedeEscribir(`"${T}" es una invitación o un evento que solo se puede cambiar en Google Calendar.`);
  }
  const pA = A.vistas[""];
  const vA = A.vevents.get("");
  const pB = B.vistas[""];
  const vB = B.vevents.get("");
  if (!pA || !vA) throw new NoSePuedeEscribir(`"${T}" solo se puede cambiar en Google Calendar.`);
  if (!pB || !vB) throw new NoSePuedeEscribir(`"${T}": no se puede borrar la serie dejando solo sus días cambiados; bórrala entera.`);

  // G1: Google no mueve los días cambiados (originalStartTime no cambia). Se puede alargar o acortar
  // el "hasta" o cambiar la hora de término mientras la regla nueva siga generando esos días.
  const mismasReglas = reglasEquivalentes(vA, vB, pA, pB);
  const cambioHorario = pA.start !== pB.start || pA.end !== pB.end;
  if (cambioHorario || !mismasReglas) {
    for (const x of [...serie.vivas, ...serie.fantasmas]) {
      if (!x.originalStartTime || !ocurre(vB, x.originalStartTime)) {
        throw new NoSePuedeEscribir(`"${T}" tiene días cambiados uno por uno: cambia la hora o la repetición de toda la serie en el iPhone o en Google Calendar.`);
      }
    }
  }

  // Días cambiados.
  const ops: Op[] = [];
  const soloEnA = new Map<string, EvG>();
  for (const [k, x] of proy.porClave) {
    const a = A.vistas[k];
    const b = B.vistas[k];
    if (!a) continue;
    if (!b) {
      soloEnA.set(k, x);
      continue;
    }
    const c = diferencia(a, b, B.vevents.get(k)!, x, false);
    if (c) ops.push(op("cambiar", x, k, c));
  }
  for (const k of Object.keys(B.vistas)) {
    if (k && !proy.porClave.has(k)) throw new NoSePuedeEscribir(`"${T}": no se puede crear un día cambiado desde la pared.`);
  }

  // Días borrados (EXDATE).
  const EA = new Set(pA.exdate);
  const EB = [...new Set(pB.exdate)].sort();
  const cubiertos = new Set<string>();
  const canceladas = new Set<string>();
  for (const v of EB) {
    if (EA.has(v)) continue;
    const f = fechaDeClave(v);
    const kx = soloEnA.has(v) ? v : [...soloEnA.keys()].find((k) => fechaDeClave(k) === f);
    if (kx) {
      // Se borró un día cambiado: se cancela esa excepción (un EXDATE no la ocultaría).
      ops.push(op("cancelar", soloEnA.get(kx)!, kx, { status: "cancelled" }));
      soloEnA.delete(kx);
      cubiertos.add(v);
      continue;
    }
    const libres = serie.fantasmas.filter((y) => !canceladas.has(y.id));
    const fantasma =
      libres.find((y) => claveHora(y.originalStartTime) === v) ?? libres.find((y) => fechaDeClave(claveHora(y.originalStartTime) ?? "D:") === f);
    if (fantasma) {
      canceladas.add(fantasma.id);
      ops.push(op("cancelar", fantasma, claveHora(fantasma.originalStartTime)!, { status: "cancelled" }));
      cubiertos.add(v);
    }
  }
  for (const v of EA) {
    if (EB.includes(v) || !proy.p2.has(v)) continue;
    // Un día cancelado en Google que B ya no excluye. Si la regla de B todavía genera esa misma ocurrencia,
    // la pared la quiere de vuelta y Google no deja revivirla. Si no (la serie se movió de hora o de día),
    // la cancelada queda huérfana en Google y no hay nada que hacer: si ese día sigue excluido con otro
    // valor, ese valor va a recurrence (abajo).
    if (ocurre(vB, proy.p2.get(v)!.originalStartTime!)) {
      throw new NoSePuedeEscribir(`"${T}": ese día se borró en Google Calendar; para recuperarlo, hazlo allá.`);
    }
  }
  if (soloEnA.size) {
    throw new NoSePuedeEscribir(`"${T}": un día cambiado no se puede volver a la normalidad desde la pared; hazlo en el iPhone o en Google Calendar.`);
  }

  // recurrence: las reglas (las de Google tal cual si B repite igual) + los EXDATE que no son de
  // excepciones canceladas ni se resolvieron cancelando una excepción.
  const antes = principal.recurrence ?? [];
  const reglas = mismasReglas
    ? antes.filter((l) => /^(RRULE|EXRULE|RDATE)[;:]/i.test(l.trim()))
    : vB
        .getAllProperties()
        .filter((p) => NOMBRES_REGLA.includes(p.name))
        .map((p) => p.toICALString());
  // Sin RRULE ni RDATE (la serie pasó a ser un evento suelto) los EXDATE no significan nada: recurrence vacía.
  const repite = reglas.some((l) => /^(RRULE|RDATE)[;:]/i.test(l.trim()));
  const recurrenceB = repite ? [...reglas, ...EB.filter((v) => !cubiertos.has(v) && !proy.p2.has(v)).map((v) => lineaExdate(B.exdates.get(v)!))] : [];
  const cambiaRec = !mismaRecurrencia(recurrenceB, antes);
  const conRecurrencia = cambiaRec ? recurrenceB.length > 0 : antes.length > 0;

  const m: Cuerpo = {};
  for (const k of TEXTOS) if (pA[k] !== pB[k]) m[k] = pB[k];
  // Una serie necesita start.timeZone: si pasa a repetirse y estaba en UTC sin zona, se manda la hora de nuevo.
  const faltaZona = cambiaRec && recurrenceB.length > 0 && !!principal.start?.dateTime && !principal.start.timeZone;
  if (cambioHorario || faltaZona) Object.assign(m, cuerposDeHora(vB, conRecurrencia));
  ajustarFin(m, principal);
  if (cambiaRec) m.recurrence = recurrenceB.length ? recurrenceB : null;

  ops.sort((a, b) => (a.tipo !== b.tipo ? (a.tipo === "cambiar" ? -1 : 1) : a.clave < b.clave ? -1 : a.clave > b.clave ? 1 : 0));
  return { maestro: Object.keys(m).length ? marcar(principal, m) : undefined, ops, avisoTitulo: T };
}

// ---------- Crear ----------

/** Cuerpo de events.insert para el VEVENT principal de B, con el id que sale del UID. */
export function cuerpoInsert(veventB: ICAL.Component, uid: string, gen = 0): Cuerpo {
  const recurrence = recurrenciaDe(veventB);
  const h = cuerposDeHora(veventB, recurrence.length > 0);
  const sinNulos = (x: HoraCuerpo) => Object.fromEntries(Object.entries(x).filter(([, v]) => v !== null));
  const c: Cuerpo = { id: idGoogleDe(uid, gen) };
  const resumen = textoDe(veventB, "summary");
  const nota = textoDe(veventB, "description");
  const lugar = textoDe(veventB, "location");
  if (resumen) c.summary = resumen;
  if (nota) c.description = nota;
  if (lugar) c.location = lugar;
  c.start = sinNulos(h.start);
  c.end = sinNulos(h.end);
  if (recurrence.length) c.recurrence = recurrence;
  return marcar({}, c);
}

export interface DiaNuevo {
  /** claveHora del día (RECURRENCE-ID) y su fecha en Santiago (para el aviso). */
  clave: string;
  fecha: string;
  /** originalStartTime con que se busca la instancia ({date} o {dateTime} en UTC). */
  original: HoraG;
  /** timeMin y timeMax para events.instances (RFC 3339), con un día de margen. */
  desde: string;
  hasta: string;
  /** ¿Es esta la instancia del día? (por originalStartTime: instante, o fecha si es de día completo) */
  calza(instancia: EvG): boolean;
  /** PATCH para esa instancia (todos los campos del día, con la marca calculada sobre ella). */
  cuerpo(instancia: EvG): Cuerpo;
}

export interface Creacion {
  uid: string;
  titulo: string;
  principal: ICAL.Component;
  /** Cuerpo del insert para esa generación del id. */
  cuerpo(gen: number): Cuerpo;
  dias: DiaNuevo[];
}

/** Lo que necesita crear(): el insert del principal y, si B trae días cambiados (al recrear), cómo aplicarlos. */
export function planearCreacion(icsB: string): Creacion {
  const B = leer(icsB);
  const principal = B.vevents.get("");
  if (!principal || !B.uid) throw new NoSePuedeEscribir(`"${B.titulo}" no tiene su evento principal: no se puede crear en Google Calendar.`);
  const uid = B.uid;
  const dias: DiaNuevo[] = [];
  for (const [clave, v] of B.vevents) {
    if (!clave) continue;
    const esFecha = clave.startsWith("D:");
    const fecha = fechaDeClave(clave);
    const ms = esFecha ? Date.parse(`${fecha}T00:00:00Z`) : Number(clave.slice(2));
    const iso = (x: number) => new Date(x).toISOString().replace(/\.\d{3}Z$/, "Z");
    dias.push({
      clave,
      fecha,
      original: esFecha ? { date: fecha } : { dateTime: iso(ms) },
      desde: iso(ms - (esFecha ? 2 : 1) * 86_400_000),
      hasta: iso(ms + (esFecha ? 3 : 1) * 86_400_000),
      calza: (i) => claveHora(i.originalStartTime) === clave,
      cuerpo: (i) => {
        const c: Cuerpo = {};
        for (const k of TEXTOS) c[k] = textoDe(v, k);
        Object.assign(c, cuerposDeHora(v, false));
        return marcar(i, ajustarFin(c, i));
      },
    });
  }
  dias.sort((a, b) => (a.clave < b.clave ? -1 : a.clave > b.clave ? 1 : 0));
  return { uid, titulo: B.titulo, principal, cuerpo: (gen) => cuerpoInsert(principal, uid, gen), dias };
}
