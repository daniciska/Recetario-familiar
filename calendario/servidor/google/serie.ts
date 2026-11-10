// Del listado de Google Calendar (events.list con singleEvents=false) a "series" y de cada serie a un
// recurso .ics, que el motor (servidor/sincronizar.ts) lee con leerRecurso de servidor/ics.ts igual que
// uno de iCloud. Funciones puras: no hacen pedidos ni miran la hora actual.
//
// Una serie es un evento principal (suelto o con repetición) con sus excepciones (los días que se
// cambiaron o se borraron sólo esa vez), agrupadas por recurringEventId:
// - canceladas → EXDATE en el principal (y se recuerda cuál vino de cuál: `p2`), salvo las huérfanas
//   (la serie se movió de hora y ya no calzan con ninguna ocurrencia: en Google no ocultan nada);
// - vivas      → un VEVENT con RECURRENCE-ID;
// - fantasmas  → excepciones idénticas a la serie (Google a veces las materializa), o "rezagadas" (que
//                quedaron atrás de un cambio del panel; marca cfv del principal): no se muestran.
//
// API:
//   agrupar(items, calId, zonaCal): Map<href, Serie>
//   esFantasma(x, p), esRezagada(x, p)            (una rezagada está en serie.fantasmas pero no es esFantasma)
//   marcaFantasmas(antes, despues, fantasmas, ahora, vivas?)   la marca cfv para el PATCH del principal (MARCA_FANTASMAS)
//   excluirDeMarca(p, ids)                        la marca de p con esas rezagadas excluidas (Google no las acepta)
//   hrefSerie(calId, id): string                  el href de una serie (el mismo que arma agrupar)
//   proyectar(serie): { ics, p2, porClave }        (con memo por serie; determinista)
//   serieAIcs(serie): string                       = proyectar(serie).ics
//   etagSerie(serie): string                       (ya viene puesto en serie.etag)
//   huellaPieza(e), esPropia(e)                    marca de escritura propia (extendedProperties.private.cfh)
//   textoPlano(s), inst(t), normRec(lineas)
//   claveHora(t), claveValor(t, tzid), fechaDeClave(k), instanteDeHora(t)
//   relojEn(zona, ms), zonaValida(z), esZonaUTC(z), basicoUTC(ms)
//   tipos EvG, HoraG, Serie, Proyeccion; constantes PRODID_GOOGLE, VERSION_PROYECCION
//
// servidor/google/* nunca importa servidor/sincronizar.ts.

import ICAL from "ical.js";
import { createHash } from "node:crypto";
import { ZONA } from "../../lib/fechas";
import { instancias, instanteLocal } from "../ics";
import { SUFIJO_GOOGLE, esIdDePrueba, uidDesdeId } from "./ids";

export const PRODID_GOOGLE = "-//Calendario familiar//Google//ES";
/** Se sube si cambia la forma de proyectar: cambia el etag de todas las series y el motor las relee. */
export const VERSION_PROYECCION = "v1";

/** Hora de un evento en la API (start, end, originalStartTime). */
export interface HoraG {
  date?: string | null; // AAAA-MM-DD (día completo; end es excluyente)
  dateTime?: string | null; // RFC 3339 con desfase
  timeZone?: string | null; // IANA
}

/** Un evento como lo devuelve events.list con los `fields` del transporte. */
export interface EvG {
  id: string;
  etag?: string;
  status?: string; // confirmed | tentative | cancelled
  summary?: string;
  description?: string;
  location?: string;
  start?: HoraG;
  end?: HoraG;
  endTimeUnspecified?: boolean;
  recurrence?: string[];
  recurringEventId?: string;
  originalStartTime?: HoraG;
  iCalUID?: string;
  created?: string;
  updated?: string;
  sequence?: number;
  eventType?: string;
  locked?: boolean;
  privateCopy?: boolean;
  organizer?: { email?: string; self?: boolean; displayName?: string };
  attendees?: { email?: string }[];
  extendedProperties?: { private?: Record<string, string>; shared?: Record<string, string> };
}

export interface Serie {
  /** `/calendar/v3/calendars/<calId>/events/<id>`: el "href" que ve el motor. */
  href: string;
  /** Id del principal o, si no hay principal, el recurringEventId de sus excepciones. */
  id: string;
  uid: string;
  /** Generación del id si el UID salió del id (ver ids.ts); null si el UID es `${id}@google.com`. */
  gen: number | null;
  etag: string;
  /** Invitación de otra persona, evento bloqueado, copia privada, sin principal o repetición ilegible. */
  soloLectura: boolean;
  /** Zona de la serie: principal.start.timeZone ?? zona del calendario ?? America/Santiago. */
  zona: string;
  calId: string;
  principal?: EvG;
  vivas: EvG[];
  fantasmas: EvG[];
  canceladas: EvG[];
}

export interface Proyeccion {
  ics: string;
  /** Procedencia de los EXDATE puestos por excepciones canceladas: claveHora(originalStartTime) → cancelada. */
  p2: Map<string, EvG>;
  /** Excepciones vivas que salieron como VEVENT con RECURRENCE-ID: claveHora(originalStartTime) → excepción. */
  porClave: Map<string, EvG>;
}

// ---------- Horas ----------

const zonas = new Map<string, boolean>();
/** ¿Intl conoce la zona? */
export function zonaValida(z: string | null | undefined): z is string {
  if (!z) return false;
  let ok = zonas.get(z);
  if (ok === undefined) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: z });
      ok = true;
    } catch {
      ok = false;
    }
    zonas.set(z, ok);
  }
  return ok;
}

export const esZonaUTC = (z: string | null | undefined) => z === "UTC" || z === "Etc/UTC";

const formatos = new Map<string, Intl.DateTimeFormat>();
/** Hora de reloj de un instante en una zona IANA válida. */
export function relojEn(zona: string, ms: number) {
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
  for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day, h: p.hour === "24" ? 0 : +p.hour, mi: +p.minute, s: +p.second };
}

const dd = (n: number, l = 2) => String(n).padStart(l, "0");
const basico = (p: { y: number; m: number; d: number; h: number; mi: number; s: number }) =>
  `${dd(p.y, 4)}${dd(p.m)}${dd(p.d)}T${dd(p.h)}${dd(p.mi)}${dd(p.s)}`;
/** AAAAMMDDTHHMMSSZ (truncado a segundos). */
export const basicoUTC = (ms: number) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Instante (ms) de una hora de la API: date → medianoche UTC de esa fecha. NaN si no se entiende. */
export function instanteDeHora(t: HoraG | undefined | null): number {
  if (!t) return NaN;
  if (t.date) return /^\d{4}-\d{2}-\d{2}$/.test(t.date) ? Date.parse(`${t.date}T00:00:00Z`) : NaN;
  return t.dateTime ? Date.parse(t.dateTime) : NaN;
}

/**
 * Clave de una ocurrencia (para comparar RECURRENCE-ID, EXDATE y originalStartTime sin importar en qué
 * zona estén escritos): "D:AAAA-MM-DD" (día completo) o "T:<ms>". null si no se entiende.
 */
export function claveHora(t: HoraG | undefined | null): string | null {
  if (!t) return null;
  if (t.date) return /^\d{4}-\d{2}-\d{2}$/.test(t.date) ? `D:${t.date}` : null;
  const ms = t.dateTime ? Date.parse(t.dateTime) : NaN;
  return Number.isFinite(ms) ? `T:${ms}` : null;
}

/** La misma clave para un valor del .ics (TZID IANA; flotante o zona desconocida = hora de Santiago, como ics.ts). */
export function claveValor(t: ICAL.Time, tzid: string | null): string {
  if (t.isDate) return `D:${dd(t.year, 4)}-${dd(t.month)}-${dd(t.day)}`;
  if (t.zone === ICAL.Timezone.utcTimezone) return `T:${Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second)}`;
  if (zonaValida(tzid)) return `T:${instanteLocal(tzid, t.year, t.month, t.day, t.hour, t.minute, t.second)}`;
  if (tzid && t.zone && t.zone !== ICAL.Timezone.localTimezone && t.zone.tzid !== "floating") return `T:${t.toJSDate().getTime()}`;
  return `T:${instanteLocal(ZONA, t.year, t.month, t.day, t.hour, t.minute, t.second)}`;
}

/** Fecha (AAAA-MM-DD) en Santiago de una clave. */
export function fechaDeClave(k: string): string {
  if (k.startsWith("D:")) return k.slice(2);
  const p = relojEn(ZONA, Number(k.slice(2)));
  return `${dd(p.y, 4)}-${dd(p.m)}-${dd(p.d)}`;
}

/** Línea del .ics para una hora de la API. `forzar`: usar `zDef` aunque la hora traiga su propia zona. */
function horaIcs(nombre: string, t: HoraG, zDef: string, forzar = false): string | null {
  if (t.date) return /^\d{4}-\d{2}-\d{2}$/.test(t.date) ? `${nombre};VALUE=DATE:${t.date.replace(/-/g, "")}` : null;
  const ms = t.dateTime ? Date.parse(t.dateTime) : NaN;
  if (!Number.isFinite(ms)) return null;
  const zona = forzar ? zDef : (t.timeZone ?? zDef);
  if (esZonaUTC(zona) || !zonaValida(zona)) return `${nombre}:${basicoUTC(ms)}`;
  return `${nombre};TZID=${zona}:${basico(relojEn(zona, ms))}`;
}

// ---------- Textos ----------

const PARECE_HTML = /<\/?(br|p|div|b|i|u|a|ul|ol|li|span)\b|&(amp|lt|gt|quot|nbsp|#\d+);/i;
const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Descripción en HTML (como la deja Google Calendar web) → texto. Si no parece HTML, queda igual. */
export function textoPlano(s: string): string {
  if (!PARECE_HTML.test(s)) return s;
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (todo, e: string) => {
      if (e[0] === "#") {
        const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : todo;
      }
      return ENTIDADES[e.toLowerCase()] ?? todo;
    })
    .trim();
}

// ---------- Huella de una pieza (marca de escritura propia) ----------

/** {date} → "D:AAAA-MM-DD"; {dateTime, timeZone} → "T:<ms>|<zona>"; sin hora → "". */
export function inst(t: HoraG | undefined | null): string {
  if (!t) return "";
  if (t.date) return `D:${t.date}`;
  if (t.dateTime) return `T:${Date.parse(t.dateTime)}|${t.timeZone ?? ""}`;
  return "";
}

/** Un valor de EXDATE/RDATE/UNTIL en texto → "D:AAAA-MM-DD" o "T:<ms>" (si no se entiende, tal cual). */
function valorTexto(v: string, tzid: string | null): string {
  const s = v.trim().toUpperCase();
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return `D:${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(s);
  if (!m) return s;
  const [y, mo, d, h, mi, se] = m.slice(1, 7).map(Number);
  if (m[7]) return `T:${Date.UTC(y, mo - 1, d, h, mi, se)}`;
  if (tzid === null) return `L:${s}`; // UNTIL flotante: depende de la serie, se compara como texto
  return `T:${instanteLocal(zonaValida(tzid) ? tzid : ZONA, y, mo, d, h, mi, se)}`;
}

/**
 * recurrence[] normalizada para comparar: RRULE/EXRULE con sus partes (y las listas) ordenadas, sin
 * los valores por omisión WKST=MO e INTERVAL=1, y UNTIL como instante; cada valor de EXDATE/RDATE en
 * su propia entrada como "D:fecha" o "T:ms" (los TZID pasados a instante). Todo ordenado.
 */
export function normRec(lineas: readonly string[]): string[] {
  const r: string[] = [];
  for (const linea of lineas) {
    const m = /^([A-Za-z-]+)((?:;[^:]*)?):([\s\S]*)$/.exec(linea.trim());
    if (!m) {
      r.push(linea.trim());
      continue;
    }
    const nombre = m[1].toUpperCase();
    const params = new Map<string, string>();
    for (const p of m[2].split(";").filter(Boolean)) {
      const i = p.indexOf("=");
      if (i > 0) params.set(p.slice(0, i).toUpperCase(), p.slice(i + 1).replace(/^"|"$/g, ""));
    }
    if (nombre === "RRULE" || nombre === "EXRULE") {
      const partes: string[] = [];
      for (const p of m[3].split(";").filter(Boolean)) {
        const i = p.indexOf("=");
        const k = (i < 0 ? p : p.slice(0, i)).trim().toUpperCase();
        let v = i < 0 ? "" : p.slice(i + 1).trim().toUpperCase();
        if ((k === "WKST" && v === "MO") || (k === "INTERVAL" && v === "1")) continue;
        if (k === "UNTIL") v = valorTexto(v, null);
        else if (k.startsWith("BY")) v = v.split(",").map((x) => x.trim()).sort().join(",");
        partes.push(`${k}=${v}`);
      }
      r.push(`${nombre}:${partes.sort().join(";")}`);
    } else if (nombre === "EXDATE" || nombre === "RDATE") {
      const tzid = params.get("TZID") ?? "";
      for (const v of m[3].split(",")) r.push(`${nombre}:${v.includes("/") ? v.trim().toUpperCase() : valorTexto(v, tzid || ZONA)}`);
    } else r.push(linea.trim());
  }
  return r.sort();
}

const sha256 = (s: string) => createHash("sha256").update(s).digest();

/**
 * Huella de lo que el panel lee de una pieza (los primeros 16 caracteres hex de un sha256). De una
 * excepción cancelada el panel sólo lee qué ocurrencia quitó (y Google la devuelve con pocos campos).
 */
export function huellaPieza(e: EvG): string {
  if (e.status === "cancelled" && e.recurringEventId) {
    return sha256(JSON.stringify(["cancelled", claveHora(e.originalStartTime) ?? ""])).toString("hex").slice(0, 16);
  }
  const datos = [
    (e.summary ?? "").trim(),
    textoPlano(e.description ?? "").trim(),
    (e.location ?? "").trim(),
    e.status ?? "confirmed",
    inst(e.start),
    e.endTimeUnspecified ? "~" : inst(e.end),
    normRec(e.recurrence ?? []),
    inst(e.originalStartTime),
  ];
  return sha256(JSON.stringify(datos)).toString("hex").slice(0, 16);
}

/**
 * ¿La escribió el panel y nadie la cambió después? Sólo si lo que lee el panel es idéntico a lo que
 * escribió: si Google normaliza algo o alguien borra la marca, cuenta como ajena (lo seguro).
 */
export function esPropia(e: EvG): boolean {
  const cfh = e.extendedProperties?.private?.cfh;
  return typeof cfh === "string" && cfh === huellaPieza(e);
}

// ---------- Agrupar el listado ----------

/** El "href" de una serie para el motor (el transporte arma el mismo al crear). */
export const hrefSerie = (calId: string, id: string) => `/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(id)}`;

const recorte = (s: string | undefined | null) => (s ?? "").trim();
const duracion = (e: EvG) => (e.endTimeUnspecified ? "~" : String(instanteDeHora(e.end) - instanteDeHora(e.start)));
const tipoHora = (t: HoraG | undefined) => (t?.date ? "date" : t?.dateTime ? "dateTime" : "");

/** Excepción idéntica a la serie en lo que ve el panel (Google a veces las materializa sin cambios). */
export function esFantasma(x: EvG, p: EvG): boolean {
  return (
    recorte(x.summary) === recorte(p.summary) &&
    recorte(textoPlano(x.description ?? "")) === recorte(textoPlano(p.description ?? "")) &&
    recorte(x.location) === recorte(p.location) &&
    (x.status ?? "confirmed") === (p.status ?? "confirmed") &&
    !!x.start &&
    !!x.originalStartTime &&
    instanteDeHora(x.start) === instanteDeHora(x.originalStartTime) &&
    tipoHora(x.start) === tipoHora(p.start) &&
    tipoHora(x.start) === tipoHora(x.originalStartTime) &&
    duracion(x) === duracion(p)
  );
}

// ---------- Fantasmas rezagadas (marca cfv del principal) ----------
//
// Cuando el panel cambia una serie, a sus fantasmas les manda lo mismo (escritura.ts), pero puede que no
// alcance a hacerlo en la misma vuelta (el plazo, o un corte): las que faltan quedan con el valor de antes
// y se verían como días cambiados que nadie hizo. Por eso el PATCH del principal lleva, en
// extendedProperties.private.cfv, por cada campo que cambia (s título, d nota, l lugar, h duración) la
// huella del valor de antes y cuándo se cambió. Una excepción que difiere de la serie sólo en valores de
// antes de esa lista, y que nadie tocó desde ese cambio (su `updated` no es posterior), es una fantasma
// "rezagada": no se muestra (cuenta como fantasma) y el transporte la pone al día cuando puede. Si alguien
// la cambió después (o el iPhone borró la marca), es un día cambiado como cualquier otro.
//
// Un cambio posterior de la serie vuelve a anotar las entradas que todavía explican una rezagada, con el
// "hasta" del cambio nuevo: al aplicar ese PATCH Google puede tocarlas (pasarles el título) y su `updated`
// quedaría después del hasta viejo. No se extiende si así pasaría a cubrir un día cambiado de verdad (con
// ese valor y tocado después del hasta viejo, p. ej. alguien que volvió un día al lugar de antes).
// Una rezagada que Google no deja poner al día (400, evento no editable) se anota como excluida
// (x.<huella del id>): no se reintenta ni se vuelve a avisar, y la pared la muestra como día cambiado,
// igual que Google.

/** Clave de la marca en extendedProperties.private del principal. */
export const MARCA_FANTASMAS = "cfv";
/** Cuántas entradas guarda la marca (las más recientes; Google acepta hasta 1024 caracteres por valor). */
const MAX_MARCA = 24;
/** Cuántas excepciones excluidas guarda la marca (dentro de MAX_MARCA). */
const MAX_EXCLUIDAS = 8;
/**
 * Margen del "cuándo se cambió": al aplicar el cambio del principal, Google puede tocar las excepciones
 * (pasarles el título) y su `updated` queda un poco después de la hora de este servidor.
 */
const MARGEN_MARCA = 120_000;

interface Rezago {
  campo: string;
  huella: string;
  /** ms (segundos enteros): hasta cuándo una excepción con ese valor sigue siendo "de antes del cambio". */
  hasta: number;
}

const CAMPOS_FANTASMA: [string, (e: EvG) => string][] = [
  ["s", (e) => recorte(e.summary)],
  ["d", (e) => recorte(textoPlano(e.description ?? ""))],
  ["l", (e) => recorte(e.location)],
  ["h", duracion],
];
const huellaValor = (v: string) => sha256(v).toString("hex").slice(0, 12);

interface Marca {
  entradas: Rezago[];
  /** Huellas (huellaValor) de los id de las excepciones excluidas: nunca son rezagadas. */
  excluidas: string[];
}

function leerMarca(p: EvG | undefined): Marca {
  const r: Marca = { entradas: [], excluidas: [] };
  const t = p?.extendedProperties?.private?.[MARCA_FANTASMAS];
  if (typeof t !== "string") return r;
  for (const x of t.split(",")) {
    const m = /^([sdlh])\.([0-9a-f]{12})\.([0-9a-z]{1,9})$/.exec(x.trim());
    if (m) r.entradas.push({ campo: m[1], huella: m[2], hasta: parseInt(m[3], 36) * 1000 });
    const e = /^x\.([0-9a-f]{12})$/.exec(x.trim());
    if (e && !r.excluidas.includes(e[1])) r.excluidas.push(e[1]);
  }
  return r;
}

/** La marca como texto: las entradas más recientes primero y al final las excluidas (las últimas anotadas). */
function escribirMarca(entradas: readonly Rezago[], excluidas: readonly string[]): string {
  const x = excluidas.slice(-MAX_EXCLUIDAS);
  return [
    ...[...entradas]
      .sort((a, b) => b.hasta - a.hasta)
      .slice(0, MAX_MARCA - x.length)
      .map((e) => `${e.campo}.${e.huella}.${(e.hasta / 1000).toString(36)}`),
    ...x.map((h) => `x.${h}`),
  ].join(",");
}

/** Las entradas de la marca que explican a `x` como rezagada de `p`, o null si no lo es (ver arriba). */
function rezagadaCon(x: EvG, p: EvG, marca: Marca): Rezago[] | null {
  if (!marca.entradas.length || !p.start || !x.start || !x.originalStartTime) return null;
  if (marca.excluidas.includes(huellaValor(x.id))) return null;
  if ((x.status ?? "confirmed") !== (p.status ?? "confirmed")) return null;
  if (instanteDeHora(x.start) !== instanteDeHora(x.originalStartTime)) return null;
  if (tipoHora(x.start) !== tipoHora(p.start) || tipoHora(x.start) !== tipoHora(x.originalStartTime)) return null;
  const t = Date.parse(x.updated ?? "");
  if (!Number.isFinite(t)) return null;
  const usa: Rezago[] = [];
  for (const [campo, valor] of CAMPOS_FANTASMA) {
    const v = valor(x);
    if (v === valor(p)) continue;
    const h = huellaValor(v);
    const e = marca.entradas.find((y) => y.campo === campo && y.huella === h && t <= y.hasta);
    if (!e) return null;
    usa.push(e);
  }
  return usa.length ? usa : null;
}

/** ¿Una fantasma que quedó atrás de un cambio de la serie hecho desde el panel? (ver arriba) */
export function esRezagada(x: EvG, p: EvG): boolean {
  return !!rezagadaCon(x, p, leerMarca(p));
}

/**
 * La marca cfv que tiene que llevar el PATCH del principal que pasa de `antes` a `despues`. `fantasmas`
 * son las de la serie que siguen ahí después del cambio (normales y rezagadas, sin las que se cancelan):
 * sin ninguna, no hace falta. Por cada campo que cambia, la huella del valor de `antes` (hasta `ahora` más
 * MARGEN_MARCA), y las entradas de la marca de antes que todavía explican alguna rezagada, con ese mismo
 * hasta salvo que así cubrirían a una de `vivas` (los días cambiados de la serie; ver arriba). Las
 * excluidas siguen mientras la marca tenga entradas. undefined: no hay que mandar nada (queda la que
 * está); null: hay que borrarla.
 */
export function marcaFantasmas(antes: EvG, despues: EvG, fantasmas: readonly EvG[], ahora: number, vivas: readonly EvG[] = []): string | null | undefined {
  const r: Rezago[] = [];
  const poner = (e: Rezago) => {
    const y = r.find((z) => z.campo === e.campo && z.huella === e.huella);
    if (!y) r.push({ ...e });
    else y.hasta = Math.max(y.hasta, e.hasta);
  };
  const vieja = leerMarca(antes);
  if (fantasmas.length) {
    const hasta = Math.ceil((ahora + MARGEN_MARCA) / 1000) * 1000;
    for (const [campo, valor] of CAMPOS_FANTASMA) if (valor(antes) !== valor(despues)) poner({ campo, huella: huellaValor(valor(antes)), hasta });
    const valorDe = new Map(CAMPOS_FANTASMA);
    for (const x of fantasmas) {
      for (const e of rezagadaCon(x, antes, vieja) ?? []) {
        const valor = valorDe.get(e.campo)!;
        const cubriria = vivas.some((v) => huellaValor(valor(v)) === e.huella && Date.parse(v.updated ?? "") > e.hasta);
        poner(cubriria ? e : { ...e, hasta: Math.max(e.hasta, hasta) });
      }
    }
  }
  const previa = antes.extendedProperties?.private?.[MARCA_FANTASMAS];
  if (!r.length) return previa === undefined ? undefined : null;
  const texto = escribirMarca(r, vieja.excluidas);
  return texto === previa ? undefined : texto;
}

/**
 * La marca de `p` con esas excepciones (id) excluidas: Google no las deja poner al día, así que dejan de
 * ser rezagadas (no se reintentan y la pared las muestra como días cambiados). undefined si no cambia
 * nada (ya estaban, o la marca no tiene entradas: entonces no hay rezagadas).
 */
export function excluirDeMarca(p: EvG, ids: readonly string[]): string | undefined {
  const m = leerMarca(p);
  const nuevas = [...new Set(ids.map(huellaValor))].filter((h) => !m.excluidas.includes(h));
  if (!nuevas.length || !m.entradas.length) return undefined;
  return escribirMarca(m.entradas, [...m.excluidas, ...nuevas]);
}

const NOMBRES_REC = new Set(["rrule", "exrule", "rdate", "exdate"]);
/** Una línea de recurrence[] como propiedad del .ics, o null si ical.js no la entiende. */
function leerLinea(linea: string): ICAL.Property | null {
  try {
    const p = ICAL.Property.fromString(linea.trim());
    if (!NOMBRES_REC.has(p.name)) return null;
    if ((p.name === "rrule" || p.name === "exrule") && !(p.getFirstValue() instanceof ICAL.Recur)) return null;
    return p;
  } catch {
    return null;
  }
}

/** Organizador que no es este calendario: una invitación de otra persona. */
const ajeno = (o: EvG["organizer"], calId: string) =>
  !!o && o.self !== true && (o.email ?? "").toLowerCase() !== calId.toLowerCase();

function ordenar(l: EvG[]): EvG[] {
  const k = (e: EvG) => {
    const t = instanteDeHora(e.originalStartTime);
    return Number.isFinite(t) ? t : Infinity;
  };
  return l.sort((a, b) => k(a) - k(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Listado completo → series por href. Se descartan los eventos especiales (eventType distinto de
 * "default": cumpleaños, de Gmail, fuera de la oficina…), los de "Probar" y los principales borrados,
 * con sus excepciones. Un grupo sin principal y sin excepciones vivas no se expone.
 */
export function agrupar(items: readonly EvG[], calId: string, zonaCal: string | null): Map<string, Serie> {
  // Un mismo id dos veces (páginas que se solapan): el más reciente.
  const porId = new Map<string, EvG>();
  for (const e of items) {
    if (!e || typeof e.id !== "string" || !e.id) continue;
    const previo = porId.get(e.id);
    if (!previo || (e.updated ?? "") >= (previo.updated ?? "")) porId.set(e.id, e);
  }
  interface Bruto {
    principal?: EvG;
    excepciones: EvG[];
    descartar: boolean;
  }
  const brutos = new Map<string, Bruto>();
  for (const e of porId.values()) {
    const raiz = e.recurringEventId && e.recurringEventId !== e.id ? e.recurringEventId : e.id;
    let g = brutos.get(raiz);
    if (!g) brutos.set(raiz, (g = { excepciones: [], descartar: esIdDePrueba(raiz) }));
    if (e.eventType && e.eventType !== "default") g.descartar = true;
    if (raiz !== e.id) g.excepciones.push(e);
    else if (e.status === "cancelled") g.descartar = true;
    else g.principal = e;
  }

  const series: Serie[] = [];
  for (const [raiz, g] of brutos) {
    if (g.descartar) continue;
    const p = g.principal;
    const vivas: EvG[] = [];
    const fantasmas: EvG[] = [];
    const canceladas: EvG[] = [];
    const marca = leerMarca(p);
    for (const x of g.excepciones) {
      if (x.status === "cancelled") canceladas.push(x);
      else if (p && (esFantasma(x, p) || rezagadaCon(x, p, marca))) fantasmas.push(x);
      else vivas.push(x);
    }
    if (!p && !vivas.length) continue;
    const soloLectura =
      !p || !!p.locked || !!p.privateCopy || ajeno(p.organizer, calId) || (p.recurrence ?? []).some((l) => !leerLinea(l));
    series.push({
      href: hrefSerie(calId, raiz),
      id: raiz,
      uid: "",
      gen: null,
      etag: "",
      soloLectura,
      zona: p?.start?.timeZone || zonaCal || ZONA,
      calId,
      principal: p,
      vivas: ordenar(vivas),
      fantasmas: ordenar(fantasmas),
      canceladas: ordenar(canceladas),
    });
  }

  // UID: el del panel (sacado del id) o `${id}@google.com`. Si dos series dan el mismo (una lápida que
  // alguien restauró desde la papelera), lo conserva la de menor (gen, id) y las demás toman otro.
  const candidatos = series.map((s) => {
    const d = uidDesdeId(s.id);
    return { s, d, uid: d?.uid ?? `${s.id}${SUFIJO_GOOGLE}` };
  });
  const orden = (a: (typeof candidatos)[number], b: (typeof candidatos)[number]) =>
    (a.d ? 0 : 1) - (b.d ? 0 : 1) || (a.d?.gen ?? 0) - (b.d?.gen ?? 0) || (a.s.id < b.s.id ? -1 : a.s.id > b.s.id ? 1 : 0);
  const usados = new Set<string>();
  const perdedores: (typeof candidatos)[number][] = [];
  for (const c of [...candidatos].sort(orden)) {
    if (usados.has(c.uid)) perdedores.push(c);
    else {
      usados.add(c.uid);
      c.s.uid = c.uid;
      c.s.gen = c.d ? c.d.gen : null;
    }
  }
  for (const c of perdedores) {
    let uid = `${c.s.id}${SUFIJO_GOOGLE}`;
    for (let n = 2; usados.has(uid); n++) uid = `${c.s.id}.${n}${SUFIJO_GOOGLE}`;
    usados.add(uid);
    c.s.uid = uid;
    c.s.gen = null;
  }

  const r = new Map<string, Serie>();
  for (const s of series) {
    s.etag = etagSerie(s);
    r.set(s.href, s);
  }
  return r;
}

/**
 * Etag de la serie: cambia si cambia cualquier pieza (también una cancelada o una fantasma), si pasa
 * a ser de sólo lectura, si cambia su zona o su UID, o si cambia la forma de proyectar.
 */
export function etagSerie(s: Serie): string {
  const piezas = [...s.vivas, ...s.fantasmas, ...s.canceladas].map((x) => `${x.id}:${x.etag ?? ""}:${x.status ?? ""}`).sort();
  const datos = [VERSION_PROYECCION, s.soloLectura ? "ro" : "rw", s.zona, s.uid, s.principal?.etag ?? "-", ...piezas].join("|");
  return "g1" + sha256(datos).toString("base64url").slice(0, 26);
}

// ---------- Serie → .ics ----------

const memo = new WeakMap<Serie, Proyeccion>();

/** La serie como .ics (más la procedencia de EXDATE y RECURRENCE-ID). Determinista; con memo por serie. */
export function proyectar(serie: Serie): Proyeccion {
  let r = memo.get(serie);
  if (!r) memo.set(serie, (r = armar(serie)));
  return r;
}

export const serieAIcs = (serie: Serie): string => proyectar(serie).ics;

/** LAST-MODIFIED: el `updated` más alto de las piezas que no escribió el panel (null si todas son propias). */
function modificado(piezas: EvG[]): number | null {
  let max: number | null = null;
  for (const x of piezas) {
    if (!x.updated || esPropia(x)) continue;
    const t = Date.parse(x.updated);
    if (Number.isFinite(t) && (max === null || t > max)) max = t;
  }
  return max === null ? null : Math.floor(max / 1000) * 1000;
}

/**
 * Claves de las canceladas huérfanas: las que caen en un día en que la regla de ahora sí tiene una
 * ocurrencia, pero a otra hora (la serie se movió de hora después de que se borró ese día). Google sólo
 * oculta la ocurrencia cuyo inicio original calza con la cancelada, así que ésas no ocultan nada (si el
 * día sigue borrado es por un EXDATE en recurrence, como lo escribe planear). Proyectadas como EXDATE, ese
 * día no calzaría con la regla y ics.ts leería la serie como fechas sueltas. Si ese día no tiene ninguna
 * ocurrencia, o no se alcanzó a revisar, la cancelada se proyecta igual que siempre (un EXDATE en un día
 * sin ocurrencia no cambia lo que se ve).
 */
function canceladasHuerfanas(p: EvG, reglas: ICAL.Property[], canceladas: EvG[], z: string): Set<string> {
  const r = new Set<string>();
  const generan = reglas.filter((x) => x.name === "rrule" || x.name === "rdate");
  // (Por horas o minutos ics.ts ya la lee como fechas sueltas, y la cuenta podría cortarse a mitad de un día.)
  const porHoras = generan.some((x) => x.name === "rrule" && ["SECONDLY", "MINUTELY", "HOURLY"].includes((x.getFirstValue() as ICAL.Recur).freq));
  const ini = canceladas.length && generan.length && !porHoras && p.start ? horaIcs("DTSTART", p.start, z) : null;
  if (!ini) return r;
  const claves = canceladas.map((c) => claveHora(c.originalStartTime)).filter((k): k is string => !!k);
  try {
    const v = new ICAL.Component("vevent");
    v.addProperty(ICAL.Property.fromString(ini));
    for (const x of generan) v.addProperty(ICAL.Property.fromString(x.toICALString()));
    const hay = instancias(v, new Set(claves.map(fechaDeClave)));
    for (const k of claves) {
      const ese = hay.get(fechaDeClave(k)) ?? [];
      if (ese.length && !ese.some((i) => claveValor(i.t, i.tzid) === k)) r.add(k);
    }
  } catch {
    // (una regla que ical.js no entiende: se proyecta como siempre)
  }
  return r;
}

function armar(serie: Serie): Proyeccion {
  const z = serie.zona;
  const p2 = new Map<string, EvG>();
  const porClave = new Map<string, EvG>();
  const cal = new ICAL.Component(["vcalendar", [], []]);
  cal.updatePropertyWithValue("version", "2.0");
  cal.updatePropertyWithValue("prodid", PRODID_GOOGLE);
  cal.updatePropertyWithValue("calscale", "GREGORIAN");

  const vevent = (e: EvG, rid: string | null, extra: ICAL.Property[], lm: number | null): boolean => {
    const ini = e.start ? horaIcs("DTSTART", e.start, z) : null;
    const fin = e.end && !e.endTimeUnspecified ? horaIcs("DTEND", e.end, z) : e.start ? horaIcs("DTEND", e.start, z) : null;
    if (!ini || !fin) return false;
    const v = new ICAL.Component("vevent");
    v.addPropertyWithValue("uid", serie.uid);
    if (lm !== null) {
      const t = ICAL.Time.fromJSDate(new Date(lm), true);
      v.addPropertyWithValue("dtstamp", t);
      v.addPropertyWithValue("last-modified", t);
    }
    const creado = e.created ? Date.parse(e.created) : NaN;
    if (Number.isFinite(creado)) v.addPropertyWithValue("created", ICAL.Time.fromJSDate(new Date(Math.floor(creado / 1000) * 1000), true));
    if (typeof e.sequence === "number" && Number.isInteger(e.sequence) && e.sequence >= 0) v.addPropertyWithValue("sequence", e.sequence);
    if (rid) v.addProperty(ICAL.Property.fromString(rid));
    const resumen = e.summary ?? "";
    const nota = textoPlano(e.description ?? "");
    const lugar = e.location ?? "";
    if (resumen.trim()) v.addPropertyWithValue("summary", resumen);
    if (nota.trim()) v.addPropertyWithValue("description", nota);
    if (lugar.trim()) v.addPropertyWithValue("location", lugar);
    v.addProperty(ICAL.Property.fromString(ini));
    v.addProperty(ICAL.Property.fromString(fin));
    for (const x of extra) v.addProperty(x);
    if (e.status === "tentative") v.addPropertyWithValue("status", "TENTATIVE");
    cal.addSubcomponent(v);
    return true;
  };

  const p = serie.principal;
  if (p) {
    const extra: ICAL.Property[] = [];
    const yaExcluidas = new Set<string>();
    for (const linea of p.recurrence ?? []) {
      const prop = leerLinea(linea);
      if (!prop) continue;
      extra.push(prop);
      if (prop.name === "exdate") {
        const tzid = (prop.getParameter("tzid") as string | undefined) ?? null;
        for (const x of prop.getValues()) if (x instanceof ICAL.Time) yaExcluidas.add(claveValor(x, tzid));
      }
    }
    const huerfanas = canceladasHuerfanas(p, extra, serie.canceladas, z);
    for (const c of serie.canceladas) {
      const k = claveHora(c.originalStartTime);
      if (!k || p2.has(k)) continue;
      p2.set(k, c);
      if (yaExcluidas.has(k) || huerfanas.has(k)) continue;
      const linea = horaIcs("EXDATE", c.originalStartTime!, z, true);
      if (!linea) continue;
      yaExcluidas.add(k);
      extra.push(ICAL.Property.fromString(linea));
    }
    vevent(p, null, extra, modificado([p, ...serie.canceladas]));
  }
  for (const x of serie.vivas) {
    const k = claveHora(x.originalStartTime);
    if (!k || porClave.has(k)) continue;
    const rid = horaIcs("RECURRENCE-ID", x.originalStartTime!, z, true);
    if (rid && vevent(x, rid, [], modificado([x]))) porClave.set(k, x);
  }
  return { ics: cal.toString() + "\r\n", p2, porClave };
}
