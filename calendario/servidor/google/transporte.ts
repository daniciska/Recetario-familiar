// Transporte de Google Calendar (Calendar API v3 con una cuenta de servicio) con el mismo contrato que
// el cliente CalDAV de iCloud (servidor/caldav.ts): el motor (servidor/sincronizar.ts) ve "recursos" .ics
// con su etag, aunque Google guarde eventos JSON. Cada recurso es una serie (serie.ts) y cada cambio se
// traduce a pedidos de la API (escritura.ts).
//
// - Una vuelta del motor = una instancia: el listado completo se pide UNA vez (memo) y sirve para ctag,
//   listar y traer (traer no hace pedidos). El ctag sale del mismo listado: el atajo del motor cuesta 1
//   pedido y listar no pide nada más.
// - El listado es completo o error: nunca se devuelve una parte (lo que falta, el motor lo borraría).
//   Exige accessRole owner o writer.
// - Escrituras condicionales: PATCH y DELETE con If-Match (412 = "conflicto"); crear usa un id que sale
//   del UID (ids.ts), así un reintento da 409 en vez de un duplicado.
// - Después de escribir, crear y actualizar devuelven el etag que tendrá la serie en el próximo listado
//   (calculado con los etag que devolvió Google, igual que el ETag de iCloud), o null si algo no salió
//   como se planeó (entonces el motor la relee). Con null siempre, un borrado en la pared justo después de
//   subir se tomaba como "cambió en los dos lados" y el evento volvía a aparecer.
// - Tabla de errores por motivo: un límite de uso (403 usageLimits o 429) es SERVIDOR (se reintenta),
//   NUNCA PERMISO (PERMISO revierte la pared). Un 403 desconocido es SERVIDOR.
// - El token sólo va a la base aceptada (Google o, para pruebas, http://127.0.0.1 / localhost) y no se
//   siguen redirecciones (redirect: "error").
//
// API:
//   class GoogleCalendar implements Transporte
//     constructor(cuenta, base = baseApiGoogle(), espera = 8000, hasta = Infinity)
//     ctag, listar, traer, existe, crear, actualizar, borrar, avisos   (contrato del motor)
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
//   errorTiempo(), NO_EDITABLE
//
// servidor/google/* nunca importa servidor/sincronizar.ts.

import { createHash } from "node:crypto";
import { ErrorCalDAV } from "../caldav";
import { NoSePuedeEscribir } from "../ics";
import { ZONA } from "../../lib/fechas";
import type { Transporte } from "../proveedores";
import { descartarToken, localhost, tokenDeAcceso, type CuentaServicio } from "./cuenta";
import { finIgualInicio, fusionar, planear, planearCreacion, seVeIgual, sinHoraDeTermino, type Cuerpo } from "./escritura";
import { agrupar, hrefSerie, normRec, serieAIcs, type EvG, type Serie } from "./serie";

export const URL_API_GOOGLE = "https://www.googleapis.com/calendar/v3/";
/** Adónde van los pedidos: Google, o GOOGLE_API_URL si es de esta máquina (pruebas). */
export const baseApiGoogle = () => localhost(process.env.GOOGLE_API_URL) ?? URL_API_GOOGLE;

const MAX_PAGINAS = 20;
const CAMPOS_LISTADO =
  "accessRole,timeZone,summary,nextPageToken,items(id,etag,status,summary,description,location,start,end,endTimeUnspecified,recurrence,recurringEventId,originalStartTime,iCalUID,created,updated,sequence,eventType,locked,privateCopy,organizer,attendees(email),extendedProperties)";
const CAMPOS_INSTANCIAS =
  "items(id,etag,status,summary,description,location,start,end,endTimeUnspecified,recurringEventId,originalStartTime,extendedProperties)";
const CAMPOS_PATCH = "id,etag,recurrence,updated";

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

const tituloDe = (s: Serie) => s.principal?.summary?.trim() || s.vivas[0]?.summary?.trim() || "Sin título";
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
      if (status === 429 || (status === 403 && a.limite)) {
        throw new ErrorCalDAV("Google Calendar pidió esperar (límite de uso): se reintenta solo.", status, "SERVIDOR");
      }
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
    const lineas = [...series.values()].map((s) => `${s.href}=${s.etag}`).sort();
    const ctag = "g1:" + createHash("sha256").update(`${cabecera.rol}|${cabecera.zona ?? ""}|${lineas.join("\n")}`).digest("base64url");
    return { ctag, series, ...cabecera };
  }

  // ---------- Contrato del motor ----------

  async ctag(url: string): Promise<string | null> {
    return (await this.listado(url)).ctag;
  }

  async listar(url: string): Promise<{ ctag: string | null; recursos: Map<string, string> }> {
    const l = await this.listado(url);
    return { ctag: l.ctag, recursos: new Map([...l.series].map(([href, s]) => [href, s.etag])) };
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
   * PATCH de una pieza con If-Match. `primero`: nada se escribió todavía en esta operación (los
   * errores se pueden informar como NoSePuedeEscribir); si no, un rechazo sólo deja un aviso.
   */
  private async parche(
    calId: string,
    pieza: EvG,
    cuerpo: Cuerpo,
    T: string,
    primero: boolean,
  ): Promise<{ json: Record<string, unknown>; enviado: Cuerpo; sinFin: boolean } | "conflicto" | "noExiste" | "rechazado"> {
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
    if (r.status === 404 || r.status === 410) return primero ? "noExiste" : "conflicto";
    const rechazo = r.status === 400 || (r.status === 403 && NO_EDITABLE.has(r.motivo));
    if (!rechazo) throw this.errorDe(r, "cambiar el calendario");
    if (!primero) {
      this.avisar(`Google Calendar no aceptó parte del cambio de "${T}".`);
      return "rechazado";
    }
    if (r.status === 403) throw new NoSePuedeEscribir(noEditableTexto(T));
    if (sinFin) throw new NoSePuedeEscribir(sinHoraDeTerminoTexto(T));
    throw new NoSePuedeEscribir(`Google Calendar no aceptó "${T}"${r.mensaje ? `: ${r.mensaje}` : ""}.`);
  }

  async actualizar(url: string, href: string, ics: string, etag: string): Promise<{ etag: string | null } | "conflicto" | "noExiste"> {
    const l = await this.listado(url);
    const serie = l.series.get(href);
    if (!serie) return "noExiste";
    if (serie.etag !== etag) return "conflicto";
    const plan = planear(serie, ics); // NoSePuedeEscribir antes de escribir nada
    const n = (plan.maestro ? 1 : 0) + plan.ops.length;
    if (!n) return { etag: null };
    // Sin tiempo para todo, no se empieza (el motor lo deja pendiente sin contarlo como falla).
    if (this.queda() < 400 + 700 * n) throw errorTiempo();
    const T = plan.avisoTitulo;
    let escritos = 0;
    // Cómo queda cada pieza según lo que respondió Google (para el etag del próximo listado).
    let principal = serie.principal!;
    const piezas = new Map([...serie.vivas, ...serie.fantasmas, ...serie.canceladas].map((x) => [x.id, x]));
    let previsible = !plan.releer; // (planear ya sabe que lo que quede no se leerá igual que la pared)
    const despues = (pieza: EvG, r: { json: Record<string, unknown>; enviado: Cuerpo; sinFin: boolean }): EvG => {
      const etag = texto(r.json.etag);
      // Borrar `end` con un PATCH (el respaldo "sin hora de término") no está documentado: lo que quedó se
      // relee en vez de suponerlo.
      if (!etag || r.sinFin) previsible = false;
      return { ...fusionar(pieza, r.enviado), etag };
    };
    if (plan.maestro) {
      const r = await this.parche(url, serie.principal!, plan.maestro, T, true);
      if (r === "conflicto" || r === "noExiste") return r;
      if (r === "rechazado") previsible = false;
      else {
        escritos++;
        principal = despues(principal, r);
        if ("recurrence" in plan.maestro) {
          const enviada = Array.isArray(plan.maestro.recurrence) ? (plan.maestro.recurrence as string[]) : [];
          const recibida = Array.isArray(r.json.recurrence) ? (r.json.recurrence as unknown[]).filter((x): x is string => typeof x === "string") : [];
          if (JSON.stringify(normRec(recibida)) !== JSON.stringify(normRec(enviada))) {
            previsible = false;
            this.avisar(`Google Calendar no aceptó cambiar la repetición de "${T}"; quedó como está allá.`);
          }
        }
      }
    }
    for (const op of plan.ops) {
      const r = await this.parche(url, op.pieza, op.cuerpo, T, escritos === 0);
      if (r === "noExiste") return "noExiste"; // (sólo si es el primer pedido)
      if (r === "conflicto") return "conflicto";
      if (r === "rechazado") previsible = false;
      else {
        escritos++;
        piezas.set(op.pieza.id, despues(op.pieza, r));
      }
    }
    // Si algo no salió como se planeó, null: la vuelta siguiente relee (gratis, del listado) y la pared
    // queda igual a lo que Google guardó.
    return { etag: previsible ? await this.etagPrevisto(url, [principal, ...piezas.values()], serie.uid, ics) : null };
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
    if (this.queda() < 400 + 700 * (1 + 2 * k)) throw errorTiempo();
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
    // La serie la acabamos de crear nosotros, así que va sin If-Match. Lo que falle queda como día normal.
    for (let i = 0; i < c.dias.length; i++) {
      const d = c.dias[i];
      const avisoDia = () => this.avisar(`"${T}": el día ${fechaLegible(d.fecha)} ya no es parte de la serie en Google Calendar; quedó como un día normal.`);
      try {
        const r = await this.pedirJSON("GET", `${ruta}/${encodeURIComponent(id)}/instances`, {
          query: { timeMin: d.desde, timeMax: d.hasta, maxResults: "50", fields: CAMPOS_INSTANCIAS },
        });
        const lista = r.status === 200 && Array.isArray(r.json?.items) ? (r.json!.items as unknown[]).filter(esObjeto) : [];
        const inst = lista.find((x) => typeof x.id === "string" && d.calza(x as unknown as EvG)) as unknown as EvG | undefined;
        if (!inst) {
          avisoDia();
          continue;
        }
        const pedir = (x: Cuerpo) => this.pedirJSON("PATCH", `${ruta}/${encodeURIComponent(inst.id)}`, { query: { fields: "id,etag" }, cuerpo: x });
        const cuerpo = d.cuerpo(inst);
        let p = await pedir(cuerpo);
        if (p.status === 400 && finIgualInicio(cuerpo)) p = await pedir({ ...sinHoraDeTermino(cuerpo, inst), end: null });
        if (p.status !== 200) avisoDia();
      } catch (e) {
        if (!(e instanceof ErrorCalDAV) && !(e instanceof NoSePuedeEscribir)) throw e;
        avisoDia();
        if (e instanceof ErrorCalDAV && e.codigo === "TIEMPO") {
          for (const x of c.dias.slice(i + 1)) this.avisar(`"${T}": el día ${fechaLegible(x.fecha)} ya no es parte de la serie en Google Calendar; quedó como un día normal.`);
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
