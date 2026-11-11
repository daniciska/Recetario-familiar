// Transporte de Google Calendar (Calendar API v3 con una cuenta de servicio) con el mismo contrato que
// el cliente CalDAV de iCloud (servidor/caldav.ts): el motor (servidor/sincronizar.ts) ve "recursos" .ics
// con su etag, aunque Google guarde eventos JSON. Cada recurso es una serie (serie.ts) y cada cambio se
// traduce a pedidos de la API (escritura.ts).
//
// - Una vuelta del motor = una instancia: el listado completo se pide UNA vez (memo) y sirve para ctag,
//   listar y traer (traer no hace pedidos). El ctag sale del mismo listado: el atajo del motor cuesta 1
//   pedido y listar no pide nada más. Mientras queden fantasmas rezagadas por poner al día, listar
//   devuelve ctag null: así la sincronización siguiente no toma el atajo y las vuelve a intentar (una que
//   falló por un 5xx o la red no queda olvidada hasta que cambie otra cosa).
// - El listado es completo o error: nunca se devuelve una parte (lo que falta, el motor lo borraría).
//   Exige accessRole owner o writer.
// - Escrituras condicionales: PATCH y DELETE con If-Match (412 = "conflicto"); crear usa un id que sale
//   del UID (ids.ts), así un reintento da 409 en vez de un duplicado.
// - Después de escribir, crear y actualizar devuelven el etag que tendrá la serie en el próximo listado
//   (calculado como en agrupar, con los etag que devolvió Google, igual que el ETag de iCloud), o null si algo no salió
//   como se planeó (entonces el motor la relee). Con null siempre, un borrado en la pared justo después de
//   subir se tomaba como "cambió en los dos lados" y el evento volvía a aparecer.
// - Tabla de errores por motivo: un límite de uso (403 usageLimits o 429) es SERVIDOR (LimiteDeUso, con
//   un texto neutro: el motor le agrega que se reintenta solo; invitar, quitar y "Probar" no reintentan),
//   NUNCA PERMISO (PERMISO revierte la pared). Un 403 desconocido es SERVIDOR.
// - Orden al cambiar una serie: primero las excepciones (días cambiados que se editan o se borran), después
//   el principal y al final las "fantasmas" (para que sigan iguales a la serie). Así un cambio del principal
//   que Google pase a las excepciones no deja viejo el If-Match de una excepción, y si algo se corta a
//   medias lo escrito es "propio" (marca cfh) y la vuelta siguiente termina el cambio en vez de revertirlo.
//   Las fantasmas van después del principal (si él no se escribe, no se tocan); si Google ya les pasó el
//   cambio (412), se releen y se les manda sólo lo que les falte. Sin plazo para las excepciones y el
//   principal, no se empieza (TiempoSinEmpezar: el motor sigue con lo demás). Las fantasmas no esperan al
//   plazo: pocas (MAX_EN_LINEA) y si caben, ahí mismo; si no, al final de la vuelta (pendientes(), después
//   de lo que escriba el motor) o en otra. Mientras tanto la marca cfv del principal (serie.ts) hace que
//   las que faltan no se vean como días cambiados, y como el etag de la serie no cuenta las fantasmas, el
//   etag se prevé igual. Una que falla (5xx, red) se salta y la reintenta otra vuelta (ver el ctag); con
//   un límite de uso se deja para la vuelta siguiente. Una que Google rechaza (400, no editable) se avisa
//   y se anota como rechazada en la marca (sigue sin verse en la pared y no se reintenta mientras nadie la
//   toque). Ese PATCH del principal no cambia lo que ve la pared ni, si el principal está como lo dejó el
//   panel, el etag de la serie (serie.ts); si no, actualizar devuelve el etag nuevo y pendientes() la
//   anota sólo si alcanza para que la vuelta siguiente relea el calendario.
// - Si Google rechaza una parte de un cambio (400) después de escribir otra, el aviso lleva su motivo y la
//   vuelta siguiente de la misma sincronización relee la serie (pendientes() → true): la pared vuelve a lo
//   que Google guardó junto con el aviso. Para que esa vuelta alcance, desde ahí se reserva RESERVA_RELEER:
//   lo que no alcance a empezar (TiempoSinEmpezar) y las rezagadas quedan para esa vuelta o para otra.
// - El token sólo va a la base aceptada (Google o, para pruebas, http://127.0.0.1 / localhost) y no se
//   siguen redirecciones (redirect: "error").
//
// API:
//   class GoogleCalendar implements Transporte
//     constructor(cuenta, base = baseApiGoogle(), espera = 8000, hasta = Infinity)
//     ctag, listar, traer, existe, crear, actualizar, borrar, avisos, pendientes   (contrato del motor)
//     calendario(calId): {nombre, zona, rol}       GET events?maxResults=1 (para conectar y "Probar")
//     pedirJSON(metodo, ruta, {query, cuerpo, ifMatch}): RespuestaGoogle
//                                                   para compartir.ts y la autoprueba: token, plazos,
//                                                   401, límites de uso, API deshabilitada, 5xx; lo demás
//                                                   vuelve como respuesta (status, json, motivo, mensaje)
//     errorDe(r, que?): ErrorCalDAV                 el resto de la tabla de errores para una respuesta
//     correo, queda()
//   baseApiGoogle(), URL_API_GOOGLE
//   ID_CALENDARIO, idCalendarioValido(id), normalizarIdCalendario(entrada), rutaCalendario(calId)
//   problemaDeRol(rol, nombre, correo): string | null   texto de PERMISO según el accessRole
//   errorTiempo(), NO_EDITABLE, class LimiteDeUso (ErrorCalDAV SERVIDOR de un 429 / 403 usageLimits)
//   class TiempoSinEmpezar (ErrorCalDAV TIEMPO: no había plazo para empezar un cambio; nada se escribió)
//
// servidor/google/* nunca importa servidor/sincronizar.ts.

import { createHash } from "node:crypto";
import { ErrorCalDAV } from "../caldav";
import { NoSePuedeEscribir } from "../ics";
import { ZONA } from "../../lib/fechas";
import type { Transporte } from "../proveedores";
import { descartarToken, localhost, tokenDeAcceso, type CuentaServicio } from "./cuenta";
import { alcanzarSerie, finIgualInicio, fusionar, marcar, planear, planearCreacion, seVeIgual, sinHoraDeTermino, type Cuerpo, type Op } from "./escritura";
import {
  MARCA_FANTASMAS,
  agrupar,
  esFantasma,
  esPropia,
  hrefSerie,
  instanteDeHora,
  marcaConRechazadas,
  marcaFantasmas,
  noReintentar,
  normRec,
  serieAIcs,
  textoPlano,
  type EvG,
  type HoraG,
  type Serie,
} from "./serie";

export const URL_API_GOOGLE = "https://www.googleapis.com/calendar/v3/";
/** Adónde van los pedidos: Google, o GOOGLE_API_URL si es de esta máquina (pruebas). */
export const baseApiGoogle = () => localhost(process.env.GOOGLE_API_URL) ?? URL_API_GOOGLE;

const MAX_PAGINAS = 20;
const CAMPOS_LISTADO =
  "accessRole,timeZone,summary,nextPageToken,items(id,etag,status,summary,description,location,start,end,endTimeUnspecified,recurrence,recurringEventId,originalStartTime,iCalUID,created,updated,sequence,eventType,locked,privateCopy,organizer,attendees(email),extendedProperties)";
const CAMPOS_INSTANCIAS =
  "items(id,etag,status,summary,description,location,start,end,endTimeUnspecified,recurringEventId,originalStartTime,extendedProperties)";
const CAMPOS_PATCH = "id,etag,recurrence,updated";
/** Una excepción leída de nuevo (alDia): los mismos campos que trae el listado. */
const CAMPOS_PIEZA = CAMPOS_LISTADO.slice(CAMPOS_LISTADO.indexOf("items(") + 6, -1);

// ---------- Calendario ----------

/** ID de un calendario de Google ("c_…@group.calendar.google.com", "alguien@gmail.com"). */
export const ID_CALENDARIO = /^[^\s/?#@]{1,250}@[^\s/?#@]{1,250}$/;
export const idCalendarioValido = (id: string) => ID_CALENDARIO.test(id);

/**
 * Lo que pega la familia → ID del calendario, o null si no se ve bien. Acepta el ID tal cual, el código
 * de "Integrar el calendario" (…/embed?src=<id>), el enlace para compartir (…?cid=<id en base64>) y la
 * dirección iCal (…/ical/<id>/…).
 */
export function normalizarIdCalendario(entrada: unknown): string | null {
  if (typeof entrada !== "string") return null;
  let t = entrada.trim().replace(/^["'<]+|["'>]+$/g, "");
  const iframe = /\bsrc="([^"]+)"/.exec(t);
  if (iframe) t = iframe[1];
  if (/^https?:\/\//i.test(t)) {
    let u: URL;
    try {
      u = new URL(t.replace(/&amp;/g, "&"));
    } catch {
      return null;
    }
    const src = u.searchParams.get("src");
    const cid = u.searchParams.get("cid");
    const ical = /\/ical\/([^/]+)\//.exec(u.pathname);
    if (src) t = src;
    else if (cid) {
      const d = /@/.test(cid) ? cid : Buffer.from(cid.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
      t = d;
    } else if (ical) {
      try {
        t = decodeURIComponent(ical[1]);
      } catch {
        return null;
      }
    } else return null;
  }
  t = t.trim();
  return idCalendarioValido(t) ? t : null;
}

/** "calendars/<id codificado>": la parte de la ruta del calendario (lanza si el ID no se ve bien). */
export function rutaCalendario(calId: string): string {
  if (typeof calId !== "string" || !idCalendarioValido(calId)) throw new ErrorCalDAV("ID de calendario inválido", 0, "SERVIDOR");
  return `calendars/${encodeURIComponent(calId)}`;
}

/** Texto de PERMISO para un accessRole que no deja sincronizar; null si es owner o writer. */
export function problemaDeRol(rol: string, nombre: string, correo: string): string | null {
  if (rol === "owner" || rol === "writer") return null;
  const recomendado = "«Realizar cambios y administrar el uso compartido» (o al menos «Realizar cambios y ver los detalles del evento»)";
  if (rol === "freeBusyReader" || rol === "reader") return `«${nombre}» está compartido solo para ver: compártelo con ${correo} con ${recomendado}.`;
  if (rol === "writerWithoutPrivateAccess") {
    return `«${nombre}» está compartido con «Realizar cambios (ver eventos privados como disponible/ocupado)»: cámbialo a ${recomendado}.`;
  }
  return `«${nombre}» no está compartido con ${correo}: compártelo con ${recomendado}.`;
}

// ---------- Errores ----------

export const errorTiempo = () => new ErrorCalDAV("Se acabó el tiempo para hablar con Google Calendar", 0, "TIEMPO");

/**
 * TIEMPO antes de escribir nada: no queda plazo para empezar ese cambio (crear o actualizar). El motor lo
 * deja pendiente sin detener la vuelta: lo demás que quepa (algo más corto) sigue.
 */
export class TiempoSinEmpezar extends ErrorCalDAV {
  constructor() {
    super("Se acabó el tiempo para hablar con Google Calendar", 0, "TIEMPO");
  }
}

/**
 * Google pidió esperar (429, o 403 con un motivo de límite de uso): SERVIDOR, nunca PERMISO. El texto es
 * neutro porque sale también donde nadie reintenta (invitar, quitar, "Probar"); la sincronización, que
 * sí reintenta, le agrega «Se reintenta solo.» (servidor/sincronizar.ts).
 */
export class LimiteDeUso extends ErrorCalDAV {
  constructor(status: number) {
    super("Google Calendar pidió esperar un momento (límite de uso).", status, "SERVIDOR");
  }
}

const LIMITES = new Set(["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded", "dailyLimitExceeded"]);
const SIN_PERMISO = new Set(["requiredAccessLevel", "insufficientPermissions", "forbidden"]);
/** 403 de un evento que la cuenta de servicio no puede cambiar (invitación ajena, tipo especial…). */
export const NO_EDITABLE = new Set(["forbiddenForNonOrganizer", "forbiddenForServiceAccounts", "eventTypeRestriction"]);

/** Lo que vuelve de pedirJSON (lo que no se resolvió como error general). */
export interface RespuestaGoogle {
  status: number;
  /** El cuerpo JSON (objeto), o null si vino vacío o no era JSON. */
  json: Record<string, unknown> | null;
  /** error.errors[0].reason (o error.status). */
  motivo: string;
  /** error.message, limpio y corto (para los avisos). */
  mensaje: string;
}

export interface OpcionesPedido {
  query?: Record<string, string>;
  cuerpo?: unknown;
  /** Etag JSON (con sus comillas) para If-Match. */
  ifMatch?: string;
}

const esObjeto = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const texto = (x: unknown) => (typeof x === "string" ? x : "");
/** Texto de Google, limpio y corto (nunca trae secretos). */
const limpio = (s: string) =>
  s
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim()
    .slice(0, 200)
    .replace(/[.\s]+$/, "");

interface Analisis {
  motivo: string;
  mensaje: string;
  /** "Google Calendar API" no está habilitada en el proyecto (accessNotConfigured / SERVICE_DISABLED). */
  deshabilitada: boolean;
  /** Límite de uso (rateLimitExceeded…, dominio usageLimits). */
  limite: boolean;
}

function analizar(json: Record<string, unknown> | null): Analisis {
  const e = json?.error;
  if (!esObjeto(e)) return { motivo: "", mensaje: "", deshabilitada: false, limite: false };
  const errores = Array.isArray(e.errors) ? e.errors.filter(esObjeto) : [];
  const detalles = Array.isArray(e.details) ? e.details.filter(esObjeto) : [];
  const razones = errores.map((x) => texto(x.reason));
  // Ojo: accessNotConfigured viene con domain "usageLimits", pero no es un límite de uso.
  const deshabilitada = razones.includes("accessNotConfigured") || detalles.some((d) => d.reason === "SERVICE_DISABLED");
  const limite =
    !deshabilitada &&
    (razones.some((r) => LIMITES.has(r)) || errores.some((x) => x.domain === "usageLimits") || detalles.some((d) => d.reason === "RATE_LIMIT_EXCEEDED"));
  return {
    motivo: razones.find(Boolean) ?? texto(e.status),
    mensaje: limpio(texto(e.message) || texto(errores[0]?.message)),
    deshabilitada,
    limite,
  };
}

// ---------- El transporte ----------

interface Listado {
  ctag: string;
  series: Map<string, Serie>;
  rol: string;
  zona: string | null;
  nombre: string;
}

/** Cuántas fantasmas se ponen al día en la misma pasada que el principal (más, al final de la vuelta). */
const MAX_EN_LINEA = 3;
/**
 * Lo que necesita anotar en la marca cfv las rezagadas que Google rechazó (un PATCH del principal por
 * serie). Cabe después de un PATCH rechazado (se empezó con 1200 ms o más) y se reserva para las que ya
 * esperan: así el aviso sale una sola vez.
 */
const PLAZO_MARCA = 700;
/**
 * Lo que se reserva, cuando hay una serie que releer (Google no la dejó como se le mandó), para que la
 * vuelta siguiente de la misma sincronización alcance a hacerlo: el motor da otra vuelta si le quedan 4 s
 * (2,5 s de este plazo) después de guardar. Lo que no alcance a empezar queda para esa vuelta.
 */
const RESERVA_RELEER = 3000;

/** Una fantasma que quedó para el final de la vuelta (pendientes()), con el principal como quedó. */
interface Pendiente {
  calId: string;
  op: Op;
  T: string;
  principal: EvG;
}

/** Lo que devuelve seguirUna (ver ahí). */
type Seguida =
  | { pieza: EvG; r?: { json: Record<string, unknown>; enviado: Cuerpo; sinFin: boolean }; rechazo?: NoSePuedeEscribir }
  | "corte"
  | "otro"
  | ErrorCalDAV;

/** Primero las de hoy en adelante (las más próximas antes), después las pasadas (las más recientes antes). */
function prioridad(ops: readonly Op[]): Op[] {
  const desde = Date.now() - 86_400_000;
  const t = (o: Op) => {
    const x = instanteDeHora(o.pieza.originalStartTime);
    return Number.isFinite(x) ? x : -Infinity;
  };
  return [...ops].sort((a, b) => {
    const ta = t(a);
    const tb = t(b);
    const fa = ta >= desde;
    const fb = tb >= desde;
    if (fa !== fb) return fa ? -1 : 1;
    return fa ? ta - tb : tb - ta;
  });
}

const tituloDe = (s: Serie) => s.principal?.summary?.trim() || s.vivas[0]?.summary?.trim() || "Sin título";

/**
 * Las fantasmas rezagadas del listado (ver serie.ts) con lo que les falta para quedar como su serie, sin
 * las de las series de `saltar` (las que esta vuelta escribió o borró) ni las que Google ya rechazó tal
 * como están. Las de sólo lectura no se tocan.
 */
function rezagadasDe(l: Listado, calId: string, saltar?: ReadonlySet<string>): Pendiente[] {
  const r: Pendiente[] = [];
  for (const s of l.series.values()) {
    if (saltar?.has(s.id) || s.soloLectura || !s.principal) continue;
    for (const f of s.fantasmas) {
      if (esFantasma(f, s.principal) || noReintentar(f, s.principal)) continue;
      const op = alcanzarSerie(f, s.principal);
      if (op) r.push({ calId, op, T: tituloDe(s), principal: s.principal });
    }
  }
  return r;
}
const fechaLegible = (f: string) => (/^\d{4}-\d{2}-\d{2}$/.test(f) ? `${f.slice(8, 10)}-${f.slice(5, 7)}-${f.slice(0, 4)}` : f);
const sinHoraDeTerminoTexto = (t: string) => `"${t}": Google Calendar no acepta eventos sin hora de término; ponle una en la pared.`;
const noEditableTexto = (t: string) => `"${t}" es una invitación o un evento que solo se puede cambiar en Google Calendar.`;

export class GoogleCalendar implements Transporte {
  readonly cuenta: CuentaServicio;
  readonly base: string;
  readonly espera: number;
  readonly hasta: number;
  private listados = new Map<string, Promise<Listado>>();
  private memoExiste = new Map<string, boolean>();
  private pendientesAviso: string[] = [];
  /** Fantasmas que no alcanzaron a seguir un cambio de esta vuelta (las pone al día pendientes()). */
  private cola: Pendiente[] = [];
  /** Fantasmas que Google no aceptó en línea y que no se alcanzaron a anotar en la marca: las anota pendientes(). */
  private rechazadas: { calId: string; pieza: EvG; principal: EvG }[] = [];
  /** Cómo quedó el principal (id → pieza) después de anotar rechazadas en su marca en esta vuelta. */
  private marcadoEn = new Map<string, EvG>();
  /** Series (id) que esta vuelta empezó a escribir o borró: sus rezagadas del listado ya no valen. */
  private tocadas = new Set<string>();
  /** Calendarios con una serie que Google no dejó como se le mandó: la vuelta siguiente la relee. */
  private releer = new Set<string>();

  /**
   * @param base   la API (por omisión baseApiGoogle()); cualquier otra que no sea Google ni local se ignora
   * @param espera máximo por pedido (ms)
   * @param hasta  plazo total (Date.now()): ningún pedido pasa de ahí (las funciones de Netlify se cortan)
   */
  constructor(cuenta: CuentaServicio, base: string = baseApiGoogle(), espera = 8000, hasta = Infinity) {
    this.cuenta = cuenta;
    const b = base.endsWith("/") ? base : `${base}/`;
    this.base = b === URL_API_GOOGLE || localhost(b) ? b : URL_API_GOOGLE;
    this.espera = espera;
    this.hasta = hasta;
  }

  /** Correo de la cuenta de servicio (con él se comparte el calendario). */
  get correo(): string {
    return this.cuenta.correo;
  }

  /** Cuánto queda del plazo total. */
  queda() {
    return this.hasta - Date.now();
  }

  /** ¿No queda plazo para empezar algo de `n` pedidos? Si hay una serie que releer, además se reserva RESERVA_RELEER. */
  private sinPlazo(n: number) {
    return this.queda() < 400 + 700 * n + (this.releer.size ? RESERVA_RELEER : 0);
  }

  private avisar(t: string) {
    if (!this.pendientesAviso.includes(t)) this.pendientesAviso.push(t);
  }

  /** Avisos para la familia acumulados en esta vuelta (se vacían al leerlos). */
  avisos(): string[] {
    const r = this.pendientesAviso;
    this.pendientesAviso = [];
    return r;
  }

  // ---------- Pedidos ----------

  /**
   * Un pedido a la API. `ruta` es relativa a la base y empieza con "calendars/" (ver rutaCalendario).
   * Resuelve aquí: token (con su propio límite), plazos (TIEMPO / RED), 401 (descarta el token y
   * reintenta UNA vez; si sigue → CLAVE), API deshabilitada (CONFIGURACION), límites de uso y 429
   * (SERVIDOR) y 5xx (SERVIDOR). Todo lo demás vuelve como respuesta, para que cada uso decida.
   */
  async pedirJSON(metodo: string, ruta: string, op: OpcionesPedido = {}): Promise<RespuestaGoogle> {
    if (!/^calendars\/[^?#\s\\]+$/.test(ruta) || ruta.split("/").some((s) => s === "" || s === "." || s === "..")) {
      throw new ErrorCalDAV("Ruta inválida para Google Calendar", 0, "SERVIDOR");
    }
    const qs = op.query && Object.keys(op.query).length ? `?${new URLSearchParams(op.query).toString()}` : "";
    const url = this.base + ruta + qs;
    for (let intento = 0; ; intento++) {
      if (Math.min(this.espera, this.queda() - 300) <= 0) throw errorTiempo();
      const token = await tokenDeAcceso(this.cuenta, this.hasta);
      const espera = Math.min(this.espera, this.queda() - 300);
      if (espera <= 0) throw errorTiempo();
      const porPlazo = espera < this.espera;
      const ctrl = new AbortController();
      // El plazo sigue corriendo mientras se lee el cuerpo.
      const t = setTimeout(() => ctrl.abort(), espera);
      (t as { unref?: () => void }).unref?.();
      let status: number;
      let crudo: string;
      try {
        const r = await fetch(url, {
          method: metodo,
          redirect: "error",
          signal: ctrl.signal,
          headers: {
            authorization: `Bearer ${token}`,
            accept: "application/json",
            "user-agent": "CalendarioFamiliar/1.0 (gzip)",
            ...(op.cuerpo !== undefined ? { "content-type": "application/json" } : {}),
            ...(op.ifMatch ? { "if-match": op.ifMatch } : {}),
          },
          body: op.cuerpo === undefined ? undefined : JSON.stringify(op.cuerpo),
        });
        status = r.status;
        crudo = await r.text();
      } catch {
        // Cortado porque se acababa el plazo total (no porque Google esté caído): sigue la próxima vuelta.
        if (ctrl.signal.aborted && porPlazo) throw errorTiempo();
        throw new ErrorCalDAV(ctrl.signal.aborted ? "Google Calendar no respondió a tiempo" : "No se pudo conectar con Google Calendar", 0, "RED");
      } finally {
        clearTimeout(t);
      }
      let json: Record<string, unknown> | null = null;
      try {
        const x = crudo ? (JSON.parse(crudo) as unknown) : null;
        if (esObjeto(x)) json = x;
      } catch {
        /* no es JSON (p. ej. un 502 de un proxy) */
      }
      if (status === 401) {
        descartarToken(this.cuenta);
        if (intento === 0) continue;
        throw new ErrorCalDAV("Google Calendar no aceptó el token de la cuenta de servicio. ¿Se borró o deshabilitó la clave en Google Cloud?", 401, "CLAVE");
      }
      const a = analizar(json);
      if (status === 403 && a.deshabilitada) {
        throw new ErrorCalDAV("Falta habilitar «Google Calendar API» en el proyecto de Google Cloud de la cuenta de servicio.", 403, "CONFIGURACION");
      }
      if (status === 429 || (status === 403 && a.limite)) throw new LimiteDeUso(status);
      if (status >= 500) throw new ErrorCalDAV(`Google Calendar respondió ${status}: inténtalo en unos minutos`, status, "SERVIDOR");
      return { status, json, motivo: a.motivo, mensaje: a.mensaje };
    }
  }

  /** El resto de la tabla de errores: una respuesta que no se esperaba → ErrorCalDAV. */
  errorDe(r: RespuestaGoogle, que?: string): ErrorCalDAV {
    const detalle = r.mensaje ? ` (${r.mensaje})` : "";
    if (r.status === 404) return new ErrorCalDAV(`No encontramos el calendario o no está compartido con ${this.correo}.`, 404, "NO_ENCONTRADO");
    if (r.status === 403) {
      if (SIN_PERMISO.has(r.motivo)) {
        return new ErrorCalDAV(
          `Google Calendar no dio permiso${que ? ` para ${que}` : ""}: comparte el calendario con ${this.correo} con «Realizar cambios y administrar el uso compartido» (o «Realizar cambios y ver los detalles del evento»).`,
          403,
          "PERMISO",
        );
      }
      if (NO_EDITABLE.has(r.motivo)) return new ErrorCalDAV(`Google Calendar no deja cambiar ese evento desde el panel${detalle}.`, 403, "SERVIDOR");
      return new ErrorCalDAV(`Google Calendar no aceptó el pedido (403${r.motivo ? ` ${r.motivo}` : ""})${detalle}.`, 403, "SERVIDOR");
    }
    if (r.status === 400) return new ErrorCalDAV(`Google Calendar no aceptó el pedido${que ? ` para ${que}` : ""}${detalle}.`, 400, "SERVIDOR");
    return new ErrorCalDAV(`Respuesta inesperada de Google Calendar (${r.status})${detalle}.`, r.status, "SERVIDOR");
  }

  private raro(que: string) {
    return new ErrorCalDAV(`Google Calendar devolvió ${que} de una forma que no se entiende.`, 0, "SERVIDOR");
  }

  // ---------- Calendario y listado ----------

  /** Nombre, zona y accessRole del calendario (1 pedido). Para conectar y para "Probar". */
  async calendario(calId: string): Promise<{ nombre: string; zona: string | null; rol: string }> {
    const r = await this.pedirJSON("GET", `${rutaCalendario(calId)}/events`, { query: { maxResults: "1", fields: "accessRole,summary,timeZone" } });
    if (r.status !== 200) throw this.errorDe(r, "leer el calendario");
    if (!r.json || typeof r.json.accessRole !== "string") throw this.raro("el calendario");
    return { nombre: texto(r.json.summary).trim() || "Google Calendar", zona: texto(r.json.timeZone) || null, rol: r.json.accessRole };
  }

  private listado(url: string): Promise<Listado> {
    rutaCalendario(url); // valida el ID
    let p = this.listados.get(url);
    if (!p) {
      const nuevo = this.leerListado(url);
      this.listados.set(url, nuevo);
      // Si falla, otro intento con esta instancia vuelve a pedirlo.
      nuevo.catch(() => {
        if (this.listados.get(url) === nuevo) this.listados.delete(url);
      });
      p = nuevo;
    }
    return p;
  }

  /** El calendario completo (todas las páginas) o un error: nunca una parte. */
  private async leerListado(calId: string): Promise<Listado> {
    const items: EvG[] = [];
    let cabecera: { rol: string; zona: string | null; nombre: string } | null = null;
    let pageToken: string | undefined;
    for (let pagina = 0; ; pagina++) {
      if (pagina >= MAX_PAGINAS) throw new ErrorCalDAV("El calendario es demasiado grande para leerlo de una vez.", 0, "SERVIDOR");
      if (this.queda() < 800) throw errorTiempo();
      const r = await this.pedirJSON("GET", `${rutaCalendario(calId)}/events`, {
        query: { singleEvents: "false", maxResults: "2500", timeZone: ZONA, fields: CAMPOS_LISTADO, ...(pageToken ? { pageToken } : {}) },
      });
      if (r.status !== 200) throw this.errorDe(r, "leer el calendario");
      const j = r.json;
      if (!j || (j.items !== undefined && !Array.isArray(j.items))) throw this.raro("el listado");
      if (!cabecera) {
        // Un listado que no sirve (sólo ver, disponible/ocupado) se rechaza antes de que dispare borrados.
        const rol = texto(j.accessRole);
        if (!rol) throw this.raro("el listado");
        const nombre = texto(j.summary).trim() || "Google Calendar";
        const problema = problemaDeRol(rol, nombre, this.correo);
        if (problema) throw new ErrorCalDAV(problema, 403, "PERMISO");
        cabecera = { rol, zona: texto(j.timeZone) || null, nombre };
      }
      for (const x of (j.items as unknown[] | undefined) ?? []) if (esObjeto(x) && typeof x.id === "string") items.push(x as unknown as EvG);
      const sig = texto(j.nextPageToken);
      if (!sig) break;
      pageToken = sig;
    }
    const series = agrupar(items, calId, cabecera.zona);
    // Las fantasmas no cuentan en el etag de su serie (la pared no las ve), pero sí en el ctag: cualquier
    // cambio en Google hace que la sincronización siguiente liste.
    const lineas = [...series.values()].flatMap((s) => [`${s.href}=${s.etag}`, ...s.fantasmas.map((f) => `${s.href}#${f.id}=${f.etag ?? ""}`)]).sort();
    const ctag = "g1:" + createHash("sha256").update(`${cabecera.rol}|${cabecera.zona ?? ""}|${lineas.join("\n")}`).digest("base64url");
    return { ctag, series, ...cabecera };
  }

  // ---------- Contrato del motor ----------

  async ctag(url: string): Promise<string | null> {
    return (await this.listado(url)).ctag;
  }

  /**
   * Con rezagadas por poner al día, ctag null: el motor guarda ese ctag, así la sincronización siguiente
   * no toma el atajo y pendientes() las vuelve a intentar (cuesta lo mismo: el atajo también lista).
   */
  async listar(url: string): Promise<{ ctag: string | null; recursos: Map<string, string> }> {
    const l = await this.listado(url);
    return { ctag: rezagadasDe(l, url).length ? null : l.ctag, recursos: new Map([...l.series].map(([href, s]) => [href, s.etag])) };
  }

  /** Sale del listado (0 pedidos): los href tal como se pidieron, de los que existen. */
  async traer(url: string, hrefs: string[], _margen?: number): Promise<{ leidos: { href: string; etag: string; ics: string }[]; completo: boolean }> {
    const l = await this.listado(url);
    const leidos: { href: string; etag: string; ics: string }[] = [];
    for (const href of hrefs) {
      const s = l.series.get(href);
      if (!s) continue;
      let ics: string;
      try {
        ics = serieAIcs(s);
      } catch (e) {
        // El motor lo trata como "no se pudo leer": nada del panel se borra por esto.
        console.error("google: no se pudo proyectar", s.id, e);
        ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n";
      }
      leidos.push({ href, etag: s.etag, ics });
    }
    return { leidos, completo: true };
  }

  /** Sólo lo llama el motor después de que crear dijo "existe" (en esta misma instancia). */
  async existe(_url: string, nombre: string): Promise<boolean> {
    return this.memoExiste.get(nombre) ?? false;
  }

  /**
   * PATCH de una pieza con If-Match. Un rechazo de Google (400, 403 de un evento no editable) vuelve como
   * NoSePuedeEscribir (sin lanzarlo), con el motivo de Google: quien llama decide si es todo el cambio o
   * sólo una parte. `dia` (AAAA-MM-DD): es una excepción, para el texto.
   */
  private async parche(
    calId: string,
    pieza: EvG,
    cuerpo: Cuerpo,
    T: string,
    dia?: string,
  ): Promise<{ json: Record<string, unknown>; enviado: Cuerpo; sinFin: boolean } | "conflicto" | "noExiste" | NoSePuedeEscribir> {
    const ruta = `${rutaCalendario(calId)}/events/${encodeURIComponent(pieza.id)}`;
    const pedir = (c: Cuerpo) => this.pedirJSON("PATCH", ruta, { query: { fields: CAMPOS_PATCH }, cuerpo: c, ...(pieza.etag ? { ifMatch: pieza.etag } : {}) });
    let enviado = cuerpo;
    let r = await pedir(enviado);
    let sinFin = false;
    if (r.status === 400 && finIgualInicio(cuerpo)) {
      // Google no aceptó fin = inicio: el mismo cambio "sin hora de término". `end: null`, porque PATCH
      // mezcla: sin él quedaría el fin que ya estaba guardado (y el iPhone lo mostraría).
      sinFin = true;
      r = await pedir((enviado = { ...sinHoraDeTermino(cuerpo, pieza), end: null }));
    }
    if (r.status === 200) {
      if (!r.json) throw this.raro("el cambio");
      return { json: r.json, enviado, sinFin };
    }
    if (r.status === 412 || r.status === 409) return "conflicto";
    if (r.status === 404 || r.status === 410) return "noExiste";
    const rechazo = r.status === 400 || (r.status === 403 && NO_EDITABLE.has(r.motivo));
    if (!rechazo) throw this.errorDe(r, "cambiar el calendario");
    if (r.status === 403) return new NoSePuedeEscribir(noEditableTexto(T));
    if (sinFin) return new NoSePuedeEscribir(sinHoraDeTerminoTexto(T));
    const motivo = r.mensaje ? `: ${r.mensaje}` : "";
    return new NoSePuedeEscribir(dia ? `Google Calendar no aceptó el cambio del día ${fechaLegible(dia)} de "${T}"${motivo}.` : `Google Calendar no aceptó "${T}"${motivo}.`);
  }

  /**
   * Una fantasma que dio 412 al ponerla al día, leída de nuevo. Lo que ya tiene el valor que se le mandaba
   * no se vuelve a mandar (Google se lo pasó desde el principal); lo que falta se manda sólo si sigue como
   * estaba en el listado (si no, alguien la cambió y no se pisa: null). También null si ya no está o se
   * canceló. Sin `cuerpo`: ya tiene todo.
   */
  private async alDia(calId: string, op: Op): Promise<{ pieza: EvG; cuerpo?: Cuerpo } | null> {
    const r = await this.pedirJSON("GET", `${rutaCalendario(calId)}/events/${encodeURIComponent(op.pieza.id)}`, { query: { fields: CAMPOS_PIEZA } });
    if (r.status !== 200 || !r.json || typeof r.json.etag !== "string") return null;
    // (Sin mezclar con lo del listado: un campo que Google dejó vacío no viene en la respuesta.)
    const fresca = r.json as unknown as EvG;
    if (fresca.id !== op.pieza.id) return null;
    if (fresca.status === "cancelled") return null;
    const valor = (x: object, k: string): string => {
      const v = (x as Record<string, unknown>)[k];
      if (k === "start" || k === "end") {
        const t = v as HoraG | null | undefined;
        return t?.date ? `D:${t.date}` : t?.dateTime ? `T:${Date.parse(t.dateTime)}` : "";
      }
      if (k === "endTimeUnspecified") return v ? "sí" : "";
      const s = typeof v === "string" ? v : "";
      return (k === "description" ? textoPlano(s) : s).trim();
    };
    const campos = Object.keys(op.cuerpo).filter((k) => k !== "extendedProperties");
    const faltan = campos.filter((k) => valor(fresca, k) !== valor(op.cuerpo, k));
    if (!faltan.length) return { pieza: fresca };
    if (faltan.some((k) => valor(fresca, k) !== valor(op.pieza, k))) return null;
    const cuerpo: Cuerpo = {};
    for (const k of faltan) cuerpo[k] = op.cuerpo[k];
    // La hora va completa (inicio y término): así sirve el respaldo "sin hora de término" de parche.
    if (("start" in cuerpo || "end" in cuerpo) && "start" in op.cuerpo && "end" in op.cuerpo) Object.assign(cuerpo, { start: op.cuerpo.start, end: op.cuerpo.end });
    return { pieza: fresca, cuerpo: marcar(fresca, cuerpo) };
  }

  /**
   * Pone al día una fantasma (lo de `op`), después del principal o al final de la vuelta. Un 412 es que
   * Google le cambió algo después del principal (le pasó el cambio, o sólo una parte, con lo que su If-Match
   * quedó viejo) o que alguien la tocó: se vuelve a leer y se le manda sólo lo que le falte, si eso sigue
   * como estaba en el listado (ver alDia); si no, no se pisa ("otro"). "corte": se acabó el plazo (no
   * alcanza `reserva` para releerla, o TIEMPO). Otro error de Google vuelve como ErrorCalDAV (sin
   * lanzarlo). En los dos casos queda para después (es una rezagada: ver serie.ts). Si Google la rechaza,
   * `rechazo`, con la pieza tal como la rechazó (su etag va a la marca).
   */
  private async seguirUna(calId: string, op: Op, T: string, reserva: number): Promise<Seguida> {
    const corte = (e: unknown) => {
      if (e instanceof ErrorCalDAV) return e.codigo === "TIEMPO" ? ("corte" as const) : e;
      throw e;
    };
    let pieza = op.pieza;
    let r = await this.parche(calId, pieza, op.cuerpo, T, op.fecha).catch(corte);
    if (r === "conflicto") {
      if (this.queda() < reserva) return "corte";
      const d = await this.alDia(calId, op).catch(corte);
      if (d === "corte" || d instanceof ErrorCalDAV) return d;
      if (!d) return "otro";
      if (!d.cuerpo) return { pieza: d.pieza }; // Google ya le pasó todo
      if (this.queda() < reserva) return "corte";
      pieza = d.pieza;
      r = await this.parche(calId, pieza, d.cuerpo, T, op.fecha).catch(corte);
    }
    if (r === "corte" || r instanceof ErrorCalDAV) return r;
    if (r instanceof NoSePuedeEscribir) return { pieza, rechazo: r };
    if (r === "conflicto" || r === "noExiste") return "otro";
    return { pieza, r };
  }

  async actualizar(url: string, href: string, ics: string, etag: string): Promise<{ etag: string | null } | "conflicto" | "noExiste"> {
    const l = await this.listado(url);
    const serie = l.series.get(href);
    if (!serie) return "noExiste";
    if (serie.etag !== etag) return "conflicto";
    const plan = planear(serie, ics); // NoSePuedeEscribir antes de escribir nada
    // (Las rezagadas que Google ya rechazó tal como están no se reintentan: ver serie.ts.)
    const seguir = plan.seguir.filter((o) => !noReintentar(o.pieza, serie.principal!));
    const n = plan.ops.length + (plan.maestro ? 1 : 0);
    if (!n && !seguir.length) return { etag: null };
    // Sin tiempo para las excepciones y el principal, no se empieza: el motor lo deja pendiente (sin
    // contarlo como falla) y sigue con lo demás que quepa; lo hace una vuelta con más plazo. Las fantasmas no
    // cuentan aquí: si no alcanzan, quedan para el final de la vuelta (pendientes()) o para otra.
    if (this.sinPlazo(Math.max(n, 1))) throw new TiempoSinEmpezar();
    this.tocadas.add(serie.id);
    const T = plan.avisoTitulo;
    let escritos = 0;
    // Cómo queda cada pieza según lo que respondió Google (para el etag del próximo listado).
    let principal = serie.principal!;
    const piezas = new Map([...serie.vivas, ...serie.fantasmas, ...serie.canceladas].map((x) => [x.id, x]));
    let previsible = !plan.releer; // (planear ya sabe que lo que quede no se leerá igual que la pared)
    const despues = (pieza: EvG, r: { json: Record<string, unknown>; enviado: Cuerpo; sinFin: boolean }): EvG => {
      const etag = texto(r.json.etag);
      const updated = texto(r.json.updated);
      // Borrar `end` con un PATCH (el respaldo "sin hora de término") no está documentado: lo que quedó se
      // relee en vez de suponerlo.
      if (!etag || r.sinFin) previsible = false;
      return { ...fusionar(pieza, r.enviado), etag, ...(updated ? { updated } : {}) };
    };
    // Lo que Google rechaza (400, evento no editable) no se reintenta: se sigue con lo demás. Si al final no
    // se escribió nada, es NoSePuedeEscribir (el motor deja lo de Google, con el aviso de Google); si algo
    // sí, queda el aviso (con el motivo de Google) y la vuelta siguiente de la misma sincronización relee
    // lo que quedó (pendientes() dice que queda trabajo), así la pared vuelve atrás junto con el aviso.
    const rechazos: NoSePuedeEscribir[] = [];
    const rechazada = (e: NoSePuedeEscribir) => {
      rechazos.push(e);
      previsible = false;
    };
    // 1. Las excepciones, antes que el principal: si Google pasa a las excepciones un título nuevo del
    //    principal, su If-Match (del listado) ya no serviría y ese cambio del día se perdería. Una excepción
    //    que ya no está o que cambió es "conflicto" (nunca "noExiste": la serie sigue ahí); la vuelta
    //    siguiente la relee.
    for (const op of plan.ops) {
      const r = await this.parche(url, op.pieza, op.cuerpo, T, op.fecha);
      if (r === "conflicto" || r === "noExiste") return "conflicto";
      if (r instanceof NoSePuedeEscribir) rechazada(r);
      else {
        escritos++;
        piezas.set(op.pieza.id, despues(op.pieza, r));
      }
    }
    // 2. El principal ("noExiste" sólo si no se escribió nada antes: la serie ya no está). Si la serie
    //    tiene fantasmas, lleva la marca cfv (serie.ts): las que no alcancen a seguir el cambio no se verán
    //    como días cambiados.
    let principalEscrito = false;
    if (plan.maestro) {
      let maestro = plan.maestro;
      const cancelan = new Set(plan.ops.filter((o) => o.tipo === "cancelar").map((o) => o.id));
      const marca = marcaFantasmas(principal, fusionar(principal, maestro), serie.fantasmas.filter((f) => !cancelan.has(f.id)), Date.now());
      if (marca !== undefined) maestro = marcar(principal, { ...maestro, extendedProperties: { private: { [MARCA_FANTASMAS]: marca } } });
      const r = await this.parche(url, serie.principal!, maestro, T);
      if (r === "conflicto") return r;
      if (r === "noExiste") return escritos ? "conflicto" : "noExiste";
      if (r instanceof NoSePuedeEscribir) rechazada(r);
      else {
        escritos++;
        principalEscrito = true;
        principal = despues(principal, r);
        if ("recurrence" in plan.maestro) {
          const enviada = Array.isArray(plan.maestro.recurrence) ? (plan.maestro.recurrence as string[]) : [];
          const recibida = Array.isArray(r.json.recurrence) ? (r.json.recurrence as unknown[]).filter((x): x is string => typeof x === "string") : [];
          if (JSON.stringify(normRec(recibida)) !== JSON.stringify(normRec(enviada))) {
            previsible = false;
            this.releer.add(url);
            this.avisar(`Google Calendar no aceptó cambiar la repetición de "${T}"; quedó como está allá.`);
          }
        }
      }
    }
    if (rechazos.length && !escritos) throw rechazos[0];
    if (rechazos.length) {
      for (const e of rechazos) this.avisar(e.message);
      this.releer.add(url);
    }
    // 3. Las fantasmas, después del principal y sólo si se escribió (o si no había que cambiarlo: entonces
    //    son rezagadas de un cambio anterior). Antes, una fantasma cambiada sería un día distinto de la
    //    serie vieja que la pared no tiene, y si el principal no se pudiera escribir quedaría así. Pocas y si
    //    caben: aquí mismo. Si no, quedan para el final de la vuelta (pendientes(), después de lo demás que
    //    tenga que escribir el motor) o para otra: con la marca cfv son rezagadas, no días cambiados, y el
    //    etag de la serie no las cuenta, así que se prevé igual (un borrado en la pared justo después no
    //    hace volver el evento). Una que Google rechaza sigue siendo rezagada (la pared no ve nada distinto).
    let marcado = false;
    if ((principalEscrito || !plan.maestro) && seguir.length) {
      const cola = prioridad(seguir);
      let i = 0;
      const rechazadas: EvG[] = [];
      if (cola.length <= MAX_EN_LINEA && !this.sinPlazo(cola.length)) {
        for (; i < cola.length; i++) {
          const r = await this.seguirUna(url, cola[i], T, 400 + 700 * (cola.length - i));
          if (r === "corte" || r instanceof ErrorCalDAV) break;
          if (r === "otro") previsible = false;
          else if (r.rechazo) {
            this.avisar(r.rechazo.message);
            rechazadas.push(r.pieza);
            piezas.set(r.pieza.id, r.pieza);
          } else piezas.set(r.pieza.id, r.r ? despues(r.pieza, r.r) : r.pieza);
        }
      }
      // Las que Google rechazó, anotadas en la marca enseguida (así no se reintentan ni se vuelve a avisar):
      // el etag que se devuelve ya cuenta ese PATCH. Si no alcanza o falla, al final de la vuelta.
      if (rechazadas.length) {
        const m = await this.marcarRechazadas(url, principal, rechazadas);
        if (m) {
          marcado = true;
          principal = m;
          if (!m.etag) previsible = false;
        } else if (m === false) for (const pieza of rechazadas) this.rechazadas.push({ calId: url, pieza, principal });
      }
      for (const op of cola.slice(i)) this.cola.push({ calId: url, op, T, principal });
    } else if (seguir.length) previsible = false;
    // Si algo no salió como se planeó, null: la vuelta siguiente relee (gratis, del listado) y la pared
    // queda igual a lo que Google guardó.
    const nuevo = previsible ? await this.etagPrevisto(url, [principal, ...piezas.values()], serie.uid, ics) : null;
    // (Con la marca escrita y sin poder prever el etag, la relee la vuelta siguiente de esta misma sincronización.)
    if (marcado && !nuevo) this.releer.add(url);
    return { etag: nuevo };
  }

  /**
   * Al final de la vuelta, con el tiempo que quede (después de lo que escribió el motor): las fantasmas
   * que no alcanzaron a seguir un cambio de esta vuelta y las rezagadas de otras (ver serie.ts), primero las
   * de hoy en adelante. true si queda trabajo para la vuelta siguiente: rezagadas que no alcanzaron por el
   * plazo o por un límite de uso, o una serie que releer (Google no la dejó como se le mandó: así la pared
   * vuelve atrás en la misma sincronización, con su aviso; para eso se reserva RESERVA_RELEER). Una
   * rezagada que falla por otra cosa (un 5xx, la red) se salta sin dejar la sincronización pendiente: la
   * reintenta la sincronización siguiente (listar deja el ctag sin calzar mientras queden rezagadas). Una
   * que Google rechaza (400, no editable) se avisa y se anota como rechazada en la marca de su serie (un
   * PATCH del principal por serie, al final, con su plazo reservado: PLAZO_MARCA): no se reintenta ni se
   * vuelve a avisar mientras nadie la toque, y la pared no ve nada distinto. Si el principal está como lo
   * dejó el panel, tampoco cambia el etag de la serie (serie.ts). Si no (o si la marca no cabe y se borra),
   * sí cambia y el motor ya tiene el de antes (un borrado en la pared antes de releerla haría volver el
   * evento): entonces se anota sólo si alcanza para que la vuelta siguiente de esta sincronización relea
   * el calendario (RESERVA_RELEER); si no, la reintenta (y avisa) otra sincronización. Nunca lanza un ErrorCalDAV.
   */
  async pendientes(url: string): Promise<boolean> {
    const trabajo = this.cola.filter((x) => x.calId === url);
    this.cola = this.cola.filter((x) => x.calId !== url);
    const porMarcar = new Map<string, { principal: EvG; piezas: EvG[] }>(); // id del principal → rezagadas que Google rechazó
    const rechazar = (principal: EvG, pieza: EvG) => {
      const g = porMarcar.get(principal.id) ?? { principal, piezas: [] };
      g.piezas.push(pieza);
      porMarcar.set(principal.id, g);
    };
    for (const x of this.rechazadas.filter((y) => y.calId === url)) rechazar(x.principal, x.pieza);
    this.rechazadas = this.rechazadas.filter((x) => x.calId !== url);
    const l = await this.listados.get(url)?.catch(() => null);
    if (l) trabajo.push(...rezagadasDe(l, url, this.tocadas));
    let releer = this.releer.has(url);
    this.releer.delete(url);
    const reserva = 1200 + (releer ? RESERVA_RELEER : 0);
    const orden = new Map(prioridad(trabajo.map((x) => x.op)).map((op, i) => [op, i]));
    trabajo.sort((a, b) => orden.get(a.op)! - orden.get(b.op)!);
    let faltan = false;
    for (const x of trabajo) {
      // Lo que se necesita para ella y para anotar después las que Google ya rechazó.
      const necesita = reserva + PLAZO_MARCA * porMarcar.size;
      const r = this.queda() < necesita ? "corte" : await this.seguirUna(url, x.op, x.T, necesita);
      if (r === "corte" || r instanceof LimiteDeUso) {
        faltan = true;
        break;
      }
      if (typeof r === "object" && !(r instanceof ErrorCalDAV) && r.rechazo) {
        this.avisar(r.rechazo.message);
        rechazar(x.principal, r.pieza);
      }
    }
    for (const g of porMarcar.values()) {
      const p = this.marcadoEn.get(g.principal.id) ?? g.principal;
      const cambiaEtag = !esPropia(p) || marcaConRechazadas(p, g.piezas) === null;
      if (cambiaEtag && this.queda() < PLAZO_MARCA + RESERVA_RELEER) continue;
      // (Un PATCH que falló pudo haber quedado hecho: también se relee.)
      if ((await this.marcarRechazadas(url, p, g.piezas)) !== null && cambiaEtag) releer = true;
    }
    return faltan || releer;
  }

  /**
   * Anota en la marca cfv del principal `p` (como quedó en esta vuelta) esas rezagadas que Google rechazó,
   * con su etag: un PATCH sólo de la marca, con If-Match (si no caben, la marca se borra: ver serie.ts). El
   * principal como quedó (con el etag nuevo, si Google lo devolvió); null si no hacía falta (ya estaban,
   * o la marca no explica a nadie); false si no se pudo (sin plazo, el principal cambió, Google falló):
   * otra vuelta la vuelve a intentar.
   */
  private async marcarRechazadas(url: string, p: EvG, rechazadas: readonly EvG[]): Promise<EvG | null | false> {
    const principal = this.marcadoEn.get(p.id) ?? p;
    const cfv = marcaConRechazadas(principal, rechazadas);
    if (cfv === undefined) return null;
    if (this.queda() < PLAZO_MARCA) return false;
    // Con las otras claves privadas que ya tiene (cfh): así no depende de que Google las mezcle.
    const cuerpo = { extendedProperties: { private: { ...(principal.extendedProperties?.private ?? {}), [MARCA_FANTASMAS]: cfv } } };
    const r = await this.pedirJSON("PATCH", `${rutaCalendario(url)}/events/${encodeURIComponent(principal.id)}`, {
      query: { fields: CAMPOS_PATCH },
      cuerpo,
      ...(principal.etag ? { ifMatch: principal.etag } : {}),
    }).catch((e) => {
      if (e instanceof ErrorCalDAV) return null;
      throw e;
    });
    if (r?.status !== 200 || !r.json) return false;
    const updated = texto(r.json.updated);
    const nuevo: EvG = { ...fusionar(principal, cuerpo), etag: texto(r.json.etag), ...(updated ? { updated } : {}) };
    this.marcadoEn.set(principal.id, nuevo);
    return nuevo;
  }

  /**
   * El etag que tendrá la serie (estas piezas) en el próximo listado, con las mismas cuentas que agrupar
   * y la zona del calendario de este listado; null si no se puede saber. Si Google cambió algo más (o
   * alguien la tocó entre medio), el listado trae otro etag y el motor la relee: nunca es peor que null.
   * Además, lo que quedó tiene que verse igual que lo que mandó el motor (`ics`): si un cambio del
   * principal hace que una excepción que no se tocó se vea distinta (una "fantasma" con el título viejo,
   * una cancelada que quedó a otra hora), el etag sería el mismo del listado pero la pared no mostraría lo
   * que hay en Google; con null, la vuelta siguiente lo relee.
   */
  private async etagPrevisto(calId: string, piezas: EvG[], uid: string, ics: string): Promise<string | null> {
    const l = await this.listados.get(calId)?.catch(() => null);
    if (!l || !piezas.length) return null;
    const s = agrupar(piezas, calId, l.zona).get(hrefSerie(calId, piezas[0].id));
    return s && s.uid === uid && seVeIgual(s, ics) ? s.etag : null;
  }

  /** Crea la serie (el UID sale del .ics; `nombre` sólo sirve para existe()). */
  async crear(url: string, nombre: string, ics: string): Promise<{ href: string; etag: string | null } | "existe"> {
    const ruta = `${rutaCalendario(url)}/events`;
    const c = planearCreacion(ics); // NoSePuedeEscribir si no hay evento principal
    const k = c.dias.length;
    if (this.sinPlazo(1 + 2 * k)) throw new TiempoSinEmpezar();
    const T = c.titulo;
    let sinFin = false;
    let id: string | null = null;
    let creado: EvG | null = null; // lo que quedó guardado, según lo que se mandó y el etag de la respuesta
    for (let gen = 0; gen <= 3 && !id; gen++) {
      let cuerpo = c.cuerpo(gen);
      if (sinFin) cuerpo = sinHoraDeTermino(cuerpo);
      const insertar = (x: Cuerpo) => this.pedirJSON("POST", ruta, { query: { fields: "id,etag" }, cuerpo: x });
      let r = await insertar(cuerpo);
      if (r.status === 400 && !sinFin && finIgualInicio(cuerpo)) {
        sinFin = true;
        r = await insertar((cuerpo = sinHoraDeTermino(cuerpo)));
      }
      if (r.status === 200) {
        id = texto(r.json?.id) || String(cuerpo.id);
        const etag = texto(r.json?.etag);
        if (etag) creado = { ...(cuerpo as unknown as EvG), id, etag };
        break;
      }
      if (r.status === 409) {
        // El id ya está ocupado: o es nuestro (un intento anterior que sí llegó) o es una lápida.
        const g = await this.pedirJSON("GET", `${ruta}/${encodeURIComponent(String(cuerpo.id))}`, { query: { fields: "id,status" } });
        if (g.status === 200 && g.json?.status !== "cancelled") {
          this.memoExiste.set(nombre, true);
          return "existe"; // la vuelta siguiente lo vincula por el UID que sale del id
        }
        if (g.status === 200 || g.status === 404 || g.status === 410) continue; // lápida: la generación siguiente
        throw this.errorDe(g, "crear el evento");
      }
      if (r.status === 400) throw new NoSePuedeEscribir(sinFin ? sinHoraDeTerminoTexto(T) : `Google Calendar no aceptó "${T}"${r.mensaje ? `: ${r.mensaje}` : ""}.`);
      if (r.status === 403 && NO_EDITABLE.has(r.motivo)) throw new NoSePuedeEscribir(noEditableTexto(T));
      throw this.errorDe(r, "agregar eventos");
    }
    if (!id) throw new NoSePuedeEscribir(`"${T}" no se pudo volver a crear en Google Calendar: quedó solo en la pared.`);

    // Sin días cambiados, el etag del próximo listado ya se sabe (con ellos, null: el motor relee).
    if (!c.dias.length) return { href: hrefSerie(url, id), etag: creado ? await this.etagPrevisto(url, [creado], c.uid, ics) : null };

    // Días cambiados (sólo al recrear una serie que los tenía): cada uno es un PATCH de su instancia.
    // La serie la acabamos de crear nosotros, así que va sin If-Match. Un 5xx, un límite de uso o un corte
    // de red se reintenta una vez si queda plazo; lo que igual falle queda como un día normal (con un aviso
    // que dice por qué). Ojo: ese día no se vuelve a intentar en otra vuelta (el motor ve la serie igual a
    // lo que mandó); la familia lo puede volver a cambiar en la pared.
    const avisoDia = (fecha: string, porque: "rechazo" | "falla" | "noEsta") =>
      this.avisar(
        porque === "rechazo"
          ? `"${T}": Google Calendar no aceptó el cambio del día ${fechaLegible(fecha)}; quedó como un día normal.`
          : porque === "falla"
            ? `"${T}": no se alcanzó a pasar a Google Calendar el cambio del día ${fechaLegible(fecha)}; quedó como un día normal.`
            : `"${T}": el cambio del día ${fechaLegible(fecha)} no se pudo pasar a Google Calendar (no se encontró ese día en la serie).`,
      );
    /** Un pedido de un día, con un reintento ante una falla pasajera (SERVIDOR o RED) si queda plazo. */
    const conReintento = async (f: () => Promise<RespuestaGoogle>): Promise<RespuestaGoogle> => {
      try {
        return await f();
      } catch (e) {
        if (!(e instanceof ErrorCalDAV) || (e.codigo !== "SERVIDOR" && e.codigo !== "RED") || this.queda() < 1500) throw e;
        await new Promise((listo) => setTimeout(listo, 300));
        return f();
      }
    };
    for (let i = 0; i < c.dias.length; i++) {
      const d = c.dias[i];
      try {
        const r = await conReintento(() =>
          this.pedirJSON("GET", `${ruta}/${encodeURIComponent(id!)}/instances`, {
            query: { timeMin: d.desde, timeMax: d.hasta, maxResults: "50", fields: CAMPOS_INSTANCIAS },
          }),
        );
        const lista = r.status === 200 && Array.isArray(r.json?.items) ? (r.json!.items as unknown[]).filter(esObjeto) : [];
        const inst = lista.find((x) => typeof x.id === "string" && d.calza(x as unknown as EvG)) as unknown as EvG | undefined;
        if (!inst) {
          avisoDia(d.fecha, r.status === 200 ? "noEsta" : "rechazo");
          continue;
        }
        const pedir = (x: Cuerpo) => conReintento(() => this.pedirJSON("PATCH", `${ruta}/${encodeURIComponent(inst.id)}`, { query: { fields: "id,etag" }, cuerpo: x }));
        const cuerpo = d.cuerpo(inst);
        let p = await pedir(cuerpo);
        if (p.status === 400 && finIgualInicio(cuerpo)) p = await pedir({ ...sinHoraDeTermino(cuerpo, inst), end: null });
        if (p.status !== 200) avisoDia(d.fecha, "rechazo");
      } catch (e) {
        if (!(e instanceof ErrorCalDAV) && !(e instanceof NoSePuedeEscribir)) throw e;
        avisoDia(d.fecha, e instanceof NoSePuedeEscribir ? "rechazo" : "falla");
        if (e instanceof ErrorCalDAV && e.codigo === "TIEMPO") {
          for (const x of c.dias.slice(i + 1)) avisoDia(x.fecha, "falla");
          break;
        }
      }
    }
    return { href: hrefSerie(url, id), etag: null };
  }

  async borrar(url: string, href: string, etag: string): Promise<"ok" | "conflicto" | "noExiste"> {
    const l = await this.listado(url);
    const serie = l.series.get(href);
    if (!serie) return "noExiste";
    if (serie.etag !== etag) return "conflicto";
    const T = tituloDe(serie);
    if (serie.soloLectura || !serie.principal) throw new NoSePuedeEscribir(`"${T}" solo se puede borrar en Google Calendar.`);
    // (Con una serie que releer, también se respeta su reserva: ver RESERVA_RELEER.)
    if (this.releer.size && this.sinPlazo(1)) throw new TiempoSinEmpezar();
    this.tocadas.add(serie.id);
    const r = await this.pedirJSON("DELETE", `${rutaCalendario(url)}/events/${encodeURIComponent(serie.principal.id)}`, {
      ...(serie.principal.etag ? { ifMatch: serie.principal.etag } : {}),
    });
    if (r.status === 204 || r.status === 200) return "ok";
    if (r.status === 412) return "conflicto";
    if (r.status === 404 || r.status === 410) return "noExiste";
    if (r.status === 403 && NO_EDITABLE.has(r.motivo)) throw new NoSePuedeEscribir(`"${T}" solo se puede borrar en Google Calendar.`);
    throw this.errorDe(r, "borrar eventos");
  }
}
