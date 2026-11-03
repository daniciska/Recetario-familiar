// Cliente CalDAV mínimo (RFC 4791) para un calendario de iCloud: descubrir los calendarios de la
// cuenta, listar los recursos con su ETag, traerlos (calendar-multiget) y crear/cambiar/borrar con
// escrituras condicionales (If-Match / If-None-Match). Usa el Apple ID y una contraseña de app.

import { XMLParser } from "fast-xml-parser";

export const URL_ICLOUD = "https://caldav.icloud.com/";

export class ErrorCalDAV extends Error {
  constructor(
    mensaje: string,
    public status: number,
    public codigo: "CLAVE" | "RED" | "SERVIDOR" | "NO_ENCONTRADO" | "PERMISO" | "TIEMPO" = "SERVIDOR",
  ) {
    super(mensaje);
  }
}

export interface CalendarioRemoto {
  url: string;
  nombre: string;
  color?: string;
  ctag?: string | null;
}

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  parseTagValue: false,
  parseAttributeValue: false,
  // Referencias numéricas (&#13;, &#241;): un calendar-data que no venga en CDATA las trae.
  htmlEntities: true,
  trimValues: true,
  isArray: (nombre) => ["response", "propstat", "comp", "href"].includes(nombre),
});

type Nodo = Record<string, unknown>;

/**
 * Ruta de un recurso, normalizada (RFC 3986): iCloud a veces responde con la dirección en
 * caldav.icloud.com y otras en su servidor pXX, y no siempre codifica igual. Se compara por ruta.
 */
export function ruta(href: string, base: string): string {
  const p = new URL(href, base).pathname;
  return p.replace(/%([0-9A-Fa-f]{2})/g, (m, h: string) => {
    const c = String.fromCharCode(parseInt(h, 16));
    return /[A-Za-z0-9\-._~@!$&'()*+,;=:]/.test(c) ? c : `%${h.toUpperCase()}`;
  });
}
const comoArreglo = <T>(x: T | T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x]);
const textoDe = (x: unknown): string => {
  if (typeof x === "string") return x;
  if (x && typeof x === "object" && "#text" in (x as Nodo)) return String((x as Nodo)["#text"]);
  return "";
};

interface Respuesta {
  href: string; // ruta normalizada (ver `ruta`)
  status: number; // del recurso (no de la propiedad)
  props: Nodo; // propiedades con 200
}

const XML = '<?xml version="1.0" encoding="utf-8"?>';
const NS = 'xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:ic="http://apple.com/ns/ical/"';

export class CalDAV {
  /**
   * @param espera máximo por pedido (ms)
   * @param hasta  plazo total (Date.now()): ningún pedido pasa de ahí (las funciones de Netlify se cortan)
   */
  constructor(
    private usuario: string,
    private clave: string,
    private base = URL_ICLOUD,
    private espera = 9000,
    private hasta = Infinity,
  ) {}

  /** Cuánto queda del plazo total. */
  queda() {
    return this.hasta - Date.now();
  }

  /** Una dirección que devolvió el servidor sólo se usa si es del mismo sitio (la clave no sale de ahí). */
  private propia(url: string): string {
    if (!mismoSitio(new URL(url), new URL(this.base))) throw new ErrorCalDAV("iCloud devolvió una dirección de otro sitio", 0);
    return url;
  }

  private async pedir(
    metodo: string,
    url: string,
    { cuerpo, cabeceras = {}, profundidad }: { cuerpo?: string; cabeceras?: Record<string, string>; profundidad?: "0" | "1" } = {},
  ): Promise<Response> {
    let actual = url;
    for (let saltos = 0; saltos < 5; saltos++) {
      const espera = Math.min(this.espera, this.queda() - 300);
      if (espera <= 0) throw new ErrorCalDAV("Se acabó el tiempo para hablar con iCloud", 0, "TIEMPO");
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), espera);
      let r: Response;
      try {
        r = await fetch(actual, {
          method: metodo,
          redirect: "manual",
          signal: ctrl.signal,
          headers: {
            authorization: "Basic " + Buffer.from(`${this.usuario}:${this.clave}`).toString("base64"),
            "user-agent": "CalendarioFamiliar/1.0 (panel de la pared)",
            // fetch manda "accept-language: *" si no se dice nada, y a iCloud eso le ha caído mal.
            "accept-language": "es-CL,es;q=0.9,en;q=0.8",
            ...(cuerpo !== undefined ? { "content-type": cabeceras["content-type"] ?? "application/xml; charset=utf-8" } : {}),
            ...(profundidad !== undefined ? { depth: profundidad } : {}),
            ...cabeceras,
          },
          body: cuerpo,
        });
      } catch (e) {
        throw new ErrorCalDAV(
          (e as Error).name === "AbortError" ? "iCloud no respondió a tiempo" : "No se pudo conectar con iCloud",
          0,
          "RED",
        );
      } finally {
        clearTimeout(t);
      }
      // Las redirecciones se siguen a mano (fetch borra la autorización al cambiar de servidor), pero
      // sólo dentro del mismo dominio: la clave nunca se manda a otro sitio.
      if ([301, 302, 307, 308].includes(r.status) && r.headers.get("location")) {
        const destino = new URL(r.headers.get("location")!, actual);
        if (!mismoSitio(destino, new URL(this.base))) throw new ErrorCalDAV("iCloud redirigió a otro sitio", r.status);
        actual = destino.toString();
        continue;
      }
      if (r.status === 401) throw new ErrorCalDAV("iCloud no aceptó el usuario o la contraseña de app", 401, "CLAVE");
      if (r.status === 429 || r.status >= 500) throw new ErrorCalDAV(`iCloud respondió ${r.status}: inténtalo en unos minutos`, r.status, "SERVIDOR");
      return r;
    }
    throw new ErrorCalDAV("Demasiadas redirecciones", 0, "SERVIDOR");
  }

  private async multistatus(metodo: string, url: string, cuerpo: string, profundidad: "0" | "1"): Promise<Respuesta[]> {
    const r = await this.pedir(metodo, url, { cuerpo, profundidad });
    if (r.status === 404) throw new ErrorCalDAV("No se encontró el calendario en iCloud", 404, "NO_ENCONTRADO");
    if (r.status === 403) throw new ErrorCalDAV("iCloud no dio permiso para leer el calendario", 403, "PERMISO");
    if (r.status !== 207) throw new ErrorCalDAV(`Respuesta inesperada de iCloud (${r.status})`, r.status);
    const xml = parser.parse(await r.text()) as Nodo;
    const ms = (xml.multistatus ?? {}) as Nodo;
    return comoArreglo(ms.response as Nodo[]).map((resp) => {
      const href = ruta(textoDe(comoArreglo(resp.href as unknown[])[0]), url);
      const props: Nodo = {};
      let status = 200;
      if (resp.status) status = Number(/\s(\d{3})\s?/.exec(textoDe(resp.status))?.[1] ?? 200);
      for (const ps of comoArreglo(resp.propstat as Nodo[])) {
        const st = Number(/\s(\d{3})\s?/.exec(textoDe(ps.status))?.[1] ?? 200);
        if (st >= 200 && st < 300) Object.assign(props, (ps.prop ?? {}) as Nodo);
      }
      return { href, status, props };
    });
  }

  private hrefProp(props: Nodo, nombre: string): string | null {
    const p = props[nombre] as Nodo | undefined;
    if (!p) return null;
    const h = comoArreglo(p.href as unknown[])[0];
    return h ? textoDe(h) : null;
  }

  /** Los calendarios de eventos de la cuenta. */
  async calendarios(): Promise<CalendarioRemoto[]> {
    const raiz = await this.multistatus(
      "PROPFIND",
      this.base,
      `${XML}<d:propfind ${NS}><d:prop><d:current-user-principal/></d:prop></d:propfind>`,
      "0",
    );
    const principal = raiz.map((x) => this.hrefProp(x.props, "current-user-principal")).find(Boolean);
    if (!principal) throw new ErrorCalDAV("iCloud no dijo cuál es la cuenta", 0);
    const urlPrincipal = this.propia(new URL(principal, this.base).toString());
    const p = await this.multistatus(
      "PROPFIND",
      urlPrincipal,
      `${XML}<d:propfind ${NS}><d:prop><c:calendar-home-set/></d:prop></d:propfind>`,
      "0",
    );
    const casa = p.map((x) => this.hrefProp(x.props, "calendar-home-set")).find(Boolean);
    if (!casa) throw new ErrorCalDAV("iCloud no dijo dónde están los calendarios", 0);
    const urlCasa = this.propia(new URL(casa, urlPrincipal).toString());
    const lista = await this.multistatus(
      "PROPFIND",
      urlCasa,
      `${XML}<d:propfind ${NS}><d:prop><d:displayname/><d:resourcetype/><cs:getctag/><c:supported-calendar-component-set/><ic:calendar-color/></d:prop></d:propfind>`,
      "1",
    );
    return lista
      .filter((x) => {
        const tipo = x.props.resourcetype as Nodo | undefined;
        if (!tipo || typeof tipo !== "object" || !("calendar" in tipo)) return false;
        const comps = comoArreglo(((x.props["supported-calendar-component-set"] ?? {}) as Nodo).comp as Nodo[]);
        return !comps.length || comps.some((c) => String(c["@name"]).toUpperCase() === "VEVENT");
      })
      .map((x) => ({
        url: this.propia(new URL(x.href, urlCasa).toString()),
        nombre: textoDe(x.props.displayname) || "Sin nombre",
        color: textoDe(x.props["calendar-color"]).slice(0, 7) || undefined,
        ctag: textoDe(x.props.getctag) || null,
      }));
  }

  /** CTag del calendario (cambia cuando cambia cualquier evento). */
  async ctag(url: string): Promise<string | null> {
    const r = await this.multistatus(
      "PROPFIND",
      url,
      `${XML}<d:propfind ${NS}><d:prop><cs:getctag/></d:prop></d:propfind>`,
      "0",
    );
    return textoDe(r[0]?.props.getctag) || null;
  }

  /** Recursos del calendario: ruta → ETag (con sync-collection, confirmado en iCloud; si no, PROPFIND). */
  async listar(url: string): Promise<{ ctag: string | null; recursos: Map<string, string> }> {
    const propio = ruta(url, url).replace(/\/?$/, "/");
    // El CTag se lee ANTES de listar: si algo cambia entre medio, el CTag guardado es el viejo y la
    // próxima vuelta lo ve (al revés, el cambio quedaría escondido detrás del atajo).
    const ctag = await this.ctag(url).catch((e) => {
      if (e instanceof ErrorCalDAV && (e.codigo === "CLAVE" || e.codigo === "TIEMPO")) throw e;
      return null;
    });
    let r: Respuesta[];
    try {
      r = await this.multistatus(
        "REPORT",
        url,
        `${XML}<d:sync-collection ${NS}><d:sync-token/><d:sync-level>1</d:sync-level><d:prop><d:getetag/></d:prop></d:sync-collection>`,
        "1",
      );
    } catch (e) {
      if (!(e instanceof ErrorCalDAV) || ![400, 403, 405, 501].includes(e.status)) throw e;
      r = await this.multistatus(
        "PROPFIND",
        url,
        `${XML}<d:propfind ${NS}><d:prop><d:getetag/><d:resourcetype/></d:prop></d:propfind>`,
        "1",
      );
    }
    const recursos = new Map<string, string>();
    for (const x of r) {
      if (x.href.replace(/\/?$/, "/") === propio) continue; // la colección misma
      const tipo = x.props.resourcetype as Nodo | undefined;
      if (tipo && typeof tipo === "object" && "collection" in tipo) continue;
      const etag = textoDe(x.props.getetag);
      if (etag && x.status < 300) recursos.set(x.href, etag);
    }
    return { ctag, recursos };
  }

  /**
   * Trae varios recursos (de a 40 por pedido). Si el plazo se acaba entre tandas, devuelve lo que alcanzó
   * (`completo: false`); lo demás queda para la próxima vuelta.
   */
  async traer(
    url: string,
    hrefs: string[],
    margen = 2500,
  ): Promise<{ leidos: { href: string; etag: string; ics: string }[]; completo: boolean }> {
    const r: { href: string; etag: string; ics: string }[] = [];
    for (let i = 0; i < hrefs.length; i += 40) {
      if (this.queda() < margen) return { leidos: r, completo: false };
      const grupo = hrefs.slice(i, i + 40);
      const cuerpo = `${XML}<c:calendar-multiget ${NS}><d:prop><d:getetag/><c:calendar-data/></d:prop>${grupo
        .map((h) => `<d:href>${escaparXML(ruta(h, url))}</d:href>`)
        .join("")}</c:calendar-multiget>`;
      const resp = await this.multistatus("REPORT", url, cuerpo, "1");
      for (const x of resp) {
        const ics = textoDe(x.props["calendar-data"]);
        const etag = textoDe(x.props.getetag);
        if (ics && x.status < 300) r.push({ href: x.href, etag, ics });
      }
    }
    return { leidos: r, completo: true };
  }

  /** ¿Hay un recurso con ese nombre en el calendario? */
  async existe(url: string, nombre: string): Promise<boolean> {
    const r = await this.pedir("PROPFIND", new URL(encodeURIComponent(nombre), url.replace(/\/?$/, "/")).toString(), {
      cuerpo: `${XML}<d:propfind ${NS}><d:prop><d:getetag/></d:prop></d:propfind>`,
      profundidad: "0",
    });
    return r.status === 207 || r.status === 200;
  }

  private etagDe(r: Response): string | null {
    return r.headers.get("etag");
  }

  /**
   * Crea un recurso nuevo. "existe": ya hay algo con ese nombre, o (iCloud) con ese UID en otro
   * calendario de la cuenta: los UID son únicos en toda la cuenta.
   */
  async crear(url: string, nombre: string, ics: string): Promise<{ href: string; etag: string | null } | "existe"> {
    const destino = new URL(encodeURIComponent(nombre), url.replace(/\/?$/, "/")).toString();
    const r = await this.pedir("PUT", destino, {
      cuerpo: ics,
      cabeceras: { "content-type": "text/calendar; charset=utf-8", "if-none-match": "*" },
    });
    if (r.status === 412 || r.status === 409) return "existe";
    await this.revisarEscritura(r);
    return { href: ruta(destino, url), etag: this.etagDe(r) };
  }

  /** Cambia un recurso sólo si nadie lo cambió desde `etag` (nunca "If-Match: *": iCloud lo entiende al revés). */
  async actualizar(url: string, href: string, ics: string, etag: string): Promise<{ etag: string | null } | "conflicto" | "noExiste"> {
    const r = await this.pedir("PUT", new URL(href, url).toString(), {
      cuerpo: ics,
      cabeceras: { "content-type": "text/calendar; charset=utf-8", "if-match": etag },
    });
    if (r.status === 412) return "conflicto";
    if (r.status === 404) return "noExiste";
    await this.revisarEscritura(r);
    return { etag: this.etagDe(r) };
  }

  async borrar(url: string, href: string, etag: string): Promise<"ok" | "conflicto" | "noExiste"> {
    const r = await this.pedir("DELETE", new URL(href, url).toString(), { cabeceras: { "if-match": etag } });
    if (r.status === 412) return "conflicto";
    if (r.status === 404 || r.status === 410) return "noExiste";
    await this.revisarEscritura(r);
    return "ok";
  }

  private async revisarEscritura(r: Response) {
    if (r.status >= 200 && r.status < 300) return;
    const detalle = (await r.text().catch(() => "")).slice(0, 200);
    if (r.status === 403) throw new ErrorCalDAV("iCloud no dio permiso para cambiar el calendario", 403, "PERMISO");
    throw new ErrorCalDAV(`iCloud no aceptó el cambio (${r.status}) ${detalle}`.trim(), r.status);
  }
}

/** ¿Mismo servidor, o ambos bajo icloud.com (caldav.icloud.com → p52-caldav.icloud.com)? */
function mismoSitio(a: URL, b: URL): boolean {
  // Nunca de https a http; de http (sólo pruebas locales) a https, sí.
  if (a.protocol !== b.protocol && !(a.protocol === "https:" && b.protocol === "http:")) return false;
  if (a.host === b.host) return true;
  const dominio = (h: string) => h.split(".").slice(-2).join(".");
  return dominio(a.hostname) === "icloud.com" && dominio(b.hostname) === "icloud.com";
}

function escaparXML(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
