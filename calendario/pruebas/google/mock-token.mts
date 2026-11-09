// Simulador local del endpoint de token de Google (https://oauth2.googleapis.com/token), flujo
// "JWT bearer" de una cuenta de servicio. Sirve solo o montado dentro de otro servidor node:http
// (el simulador de la Calendar API lo monta para emitir los tokens que después verifica).
//
// Reproduce lo documentado en developers.google.com/identity/protocols/oauth2/service-account
// (tabla "JWT error codes") y las formas de error observadas al sondear el endpoint real con una
// clave inventada (2026-11-09):
//   400 {"error":"invalid_grant","error_description":"Invalid grant: account not found"}
//   400 {"error":"invalid_grant","error_description":"Invalid JWT Signature."}
//   400 {"error":"invalid_grant","error_description":"Invalid JWT: Token must be a short-lived token (60 minutes) and in a reasonable timeframe. …"}
//   400 {"error":"invalid_scope","error_description":"Invalid OAuth scope or ID token audience provided."}
//   400 {"error":"disabled_client","error_description":"The OAuth client was disabled."}
//   400 {"error":"unsupported_grant_type","error_description":"Invalid grant_type: foo"}
//   400 {"error":"invalid_request","error_description":"Bad Request"}   (aserción que no es JWT)
// Todas las respuestas llevan la cabecera Date con la hora del "servidor" (desfaseSeg incluido).
//
// ─── Firma ─────────────────────────────────────────────────────────────────────────────────────
//   crearMockToken(opciones: OpcionesToken): MockToken
//     mock.atender(req, res, cuerpo?) → Promise<boolean>
//         Atiende el pedido si su ruta es opciones.ruta (por omisión "/token") y devuelve true; si no
//         es suyo devuelve false SIN leer el cuerpo (para que lo atienda el servidor que lo monta).
//         `cuerpo`: el cuerpo ya leído, si quien lo monta lo leyó antes.
//     mock.opciones          las mismas OpcionesToken (se pueden cambiar entre pedidos)
//     mock.pedidos           número de POST recibidos en la ruta (también los que fallaron)
//     mock.emitidos          número de tokens entregados
//     mock.historial         PedidoToken[] de cada POST (encabezado y reclamos del JWT decodificados;
//                            `respuesta` = status enviado, 0 si se cortó, ausente si el cliente se fue antes)
//     mock.verificar(autorizacion) → InfoToken | null
//         Para la API simulada: recibe la cabecera "Bearer …" (o el token solo) y devuelve
//         {token, correo, alcances, vence} si este mock lo emitió y sigue vigente; null si no.
//     mock.revocar(token?)   invalida ese token (o todos): la API debe responder 401 después.
//     mock.vencer(token?)    lo da por vencido (igual que revocar, pero queda en historial como vencido).
//     mock.reiniciar()       contadores, historial y tokens a cero.
//   iniciarMockToken(opciones) → Promise<{ url, mock, server, cerrar() }>
//     Servidor propio en 127.0.0.1, puerto al azar; url = "http://127.0.0.1:<puerto>/token".
//
//   OpcionesToken:
//     cuentas           Map client_email → clave pública registrada (KeyObject o PEM). Obligatorio.
//     ruta              "/token"
//     desfaseSeg        hora del "servidor" − hora real (simula que el reloj local está atrasado o adelantado)
//     toleranciaSeg     cuánto acepta un iat en el futuro (60; no documentado por Google)
//     deshabilitadas    correos → disabled_client
//     borradas          correos → deleted_client
//     alcancesConocidos los alcances que existen (por omisión, los de Calendar documentados)
//     falla5xx          las próximas N respuestas son 503 (se descuenta en cada POST)
//     demoraMs          espera antes de responder (se corta si el cliente se va)
//     expiraSeg         expires_in de los tokens (3599)
//     falla(p)          inyección general, después de decodificar el JWT: devuelve
//                         {status, json?, texto?, cabeceras?}  → se responde eso
//                         "cortar"                             → se corta la conexión sin responder
//                         undefined                            → sigue normal
// ────────────────────────────────────────────────────────────────────────────────────────────────
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createPublicKey, randomBytes, verify, type KeyObject } from "node:crypto";

export const AUD_TOKEN = "https://oauth2.googleapis.com/token";
const A = "https://www.googleapis.com/auth/";
/** Alcances de Calendar documentados (scopes.txt). */
export const ALCANCES_CALENDARIO = [
  "calendar",
  "calendar.readonly",
  "calendar.events",
  "calendar.events.readonly",
  "calendar.events.owned",
  "calendar.events.owned.readonly",
  "calendar.events.public.readonly",
  "calendar.events.freebusy",
  "calendar.acls",
  "calendar.acls.readonly",
  "calendar.calendarlist",
  "calendar.calendarlist.readonly",
  "calendar.calendars",
  "calendar.calendars.readonly",
  "calendar.freebusy",
  "calendar.settings.readonly",
  "calendar.app.created",
].map((s) => A + s);

export type FallaToken = { status: number; json?: unknown; texto?: string; cabeceras?: Record<string, string> } | "cortar";

export interface PedidoToken {
  numero: number; // 1, 2, … (POST recibidos)
  encabezado: Record<string, unknown> | null; // del JWT, si se pudo decodificar
  reclamos: Record<string, unknown> | null;
  correo: string | null; // iss
  alcances: string[]; // scope separado por espacios
  respuesta?: number; // status con que se respondió
}

export interface OpcionesToken {
  cuentas: Map<string, KeyObject | string>;
  ruta?: string;
  desfaseSeg?: number;
  toleranciaSeg?: number;
  deshabilitadas?: Set<string>;
  borradas?: Set<string>;
  alcancesConocidos?: string[];
  falla5xx?: number;
  demoraMs?: number;
  expiraSeg?: number;
  falla?: (p: PedidoToken) => FallaToken | undefined | Promise<FallaToken | undefined>;
}

export interface InfoToken {
  token: string;
  correo: string;
  alcances: string[];
  vence: number; // ms, reloj real
}

export interface MockToken {
  atender(req: IncomingMessage, res: ServerResponse, cuerpo?: string): Promise<boolean>;
  readonly opciones: OpcionesToken;
  readonly pedidos: number;
  readonly emitidos: number;
  readonly historial: PedidoToken[];
  verificar(autorizacion: string | undefined | null): InfoToken | null;
  revocar(token?: string): void;
  vencer(token?: string): void;
  reiniciar(): void;
}

const PLAZO =
  "Invalid JWT: Token must be a short-lived token (60 minutes) and in a reasonable timeframe. Check your 'iat' and 'exp' values and use a clock with skew to account for clock differences between systems.";

const decodificar = (x: string): Record<string, unknown> | null => {
  try {
    const v = JSON.parse(Buffer.from(x, "base64url").toString("utf8"));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

const clavePublica = (k: KeyObject | string): KeyObject => (typeof k === "string" ? createPublicKey(k) : k.type === "private" ? createPublicKey(k) : k);

async function leerCuerpo(req: IncomingMessage): Promise<string> {
  let s = "";
  for await (const c of req) s += c;
  return s;
}

export function crearMockToken(opciones: OpcionesToken): MockToken {
  let pedidos = 0;
  let emitidos = 0;
  const historial: PedidoToken[] = [];
  const tokens = new Map<string, InfoToken>();

  async function atender(req: IncomingMessage, res: ServerResponse, cuerpoLeido?: string): Promise<boolean> {
    const ruta = opciones.ruta ?? "/token";
    const camino = new URL(req.url ?? "/", "http://x").pathname;
    if (camino !== ruta) return false;

    const ahora = () => Math.floor(Date.now() / 1000) + (opciones.desfaseSeg ?? 0);
    let registro: PedidoToken | null = null;
    const responder = (status: number, cuerpo: unknown, cabeceras: Record<string, string> = {}, texto?: string) => {
      if (registro) registro.respuesta = status;
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(status, {
        "content-type": texto !== undefined ? "text/html; charset=utf-8" : "application/json; charset=utf-8",
        date: new Date(ahora() * 1000).toUTCString(),
        "cache-control": "no-cache, no-store, max-age=0, must-revalidate",
        ...cabeceras,
      });
      res.end(texto !== undefined ? texto : JSON.stringify(cuerpo));
    };

    if (req.method !== "POST") {
      responder(404, { error: "not_found" });
      return true;
    }
    pedidos++;
    const cuerpo = cuerpoLeido ?? (await leerCuerpo(req));

    // Decodificar lo que se pueda para el historial y para `falla`.
    const p = new URLSearchParams(cuerpo);
    const partes = (p.get("assertion") ?? "").split(".");
    const encabezado = partes.length === 3 ? decodificar(partes[0]) : null;
    const reclamos = partes.length === 3 ? decodificar(partes[1]) : null;
    registro = {
      numero: pedidos,
      encabezado,
      reclamos,
      correo: typeof reclamos?.iss === "string" ? reclamos.iss : null,
      alcances: typeof reclamos?.scope === "string" ? reclamos.scope.split(" ").filter(Boolean) : [],
    };
    historial.push(registro);

    if (opciones.demoraMs) {
      await new Promise<void>((ok) => {
        const t = setTimeout(ok, opciones.demoraMs);
        res.once("close", () => {
          clearTimeout(t);
          ok();
        });
      });
      if (res.destroyed) return true; // el cliente se fue (abortó por plazo): queda sin `respuesta`
    }

    if ((opciones.falla5xx ?? 0) > 0) {
      opciones.falla5xx = (opciones.falla5xx ?? 0) - 1;
      responder(503, { error: "backend_error", error_description: "Backend Error" });
      return true;
    }
    const inyectada = await opciones.falla?.(registro);
    if (inyectada === "cortar") {
      registro.respuesta = 0;
      req.socket.destroy();
      return true;
    }
    if (inyectada) {
      responder(inyectada.status, inyectada.json ?? {}, inyectada.cabeceras, inyectada.texto);
      return true;
    }

    if (!/^application\/x-www-form-urlencoded/i.test(req.headers["content-type"] ?? "")) {
      responder(400, { error: "invalid_request", error_description: "Bad Request" });
      return true;
    }
    const tipo = p.get("grant_type");
    if (tipo !== "urn:ietf:params:oauth:grant-type:jwt-bearer") {
      responder(400, { error: "unsupported_grant_type", error_description: `Invalid grant_type: ${tipo ?? ""}` });
      return true;
    }
    if (partes.length !== 3 || partes.some((x) => !/^[A-Za-z0-9_-]+$/.test(x)) || !encabezado || !reclamos) {
      responder(400, { error: "invalid_request", error_description: "Bad Request" });
      return true;
    }
    if (encabezado.alg !== "RS256") {
      responder(400, { error: "invalid_grant", error_description: "Invalid JWT Signature." });
      return true;
    }
    if (typeof reclamos.scope !== "string" || !reclamos.scope.trim()) {
      responder(400, { error: "invalid_scope", error_description: "Invalid OAuth scope or ID token audience provided." });
      return true;
    }
    const correo = String(reclamos.iss);
    const registrada = opciones.cuentas.get(correo);
    if (!registrada || opciones.borradas?.has(correo)) {
      if (opciones.borradas?.has(correo)) responder(400, { error: "deleted_client", error_description: "The OAuth client was deleted." });
      else responder(400, { error: "invalid_grant", error_description: "Invalid grant: account not found" });
      return true;
    }
    if (opciones.deshabilitadas?.has(correo)) {
      responder(400, { error: "disabled_client", error_description: "The OAuth client was disabled." });
      return true;
    }
    let firmaOk = false;
    try {
      firmaOk = verify("sha256", Buffer.from(`${partes[0]}.${partes[1]}`), clavePublica(registrada), Buffer.from(partes[2], "base64url"));
    } catch {
      firmaOk = false;
    }
    if (!firmaOk) {
      responder(400, { error: "invalid_grant", error_description: "Invalid JWT Signature." });
      return true;
    }
    if (reclamos.aud !== AUD_TOKEN) {
      responder(400, { error: "invalid_grant", error_description: "Invalid JWT: Failed audience check." }); // texto supuesto
      return true;
    }
    const iat = Number(reclamos.iat);
    const exp = Number(reclamos.exp);
    const tol = opciones.toleranciaSeg ?? 60;
    const t = ahora();
    if (!Number.isInteger(iat) || !Number.isInteger(exp) || exp < iat || exp - iat > 65 * 60 || iat > t + tol || exp <= t) {
      responder(400, { error: "invalid_grant", error_description: PLAZO });
      return true;
    }
    const alcances = registro.alcances;
    const conocidos = opciones.alcancesConocidos ?? ALCANCES_CALENDARIO;
    if (alcances.some((s) => !conocidos.includes(s))) {
      responder(400, { error: "invalid_scope", error_description: "Invalid OAuth scope or ID token audience provided." });
      return true;
    }
    const expira = opciones.expiraSeg ?? 3599;
    const token = `ya29.mock-${++emitidos}-${randomBytes(6).toString("hex")}`;
    tokens.set(token, { token, correo, alcances, vence: Date.now() + expira * 1000 });
    responder(200, { access_token: token, expires_in: expira, token_type: "Bearer" });
    return true;
  }

  const mock: MockToken = {
    atender,
    opciones,
    get pedidos() {
      return pedidos;
    },
    get emitidos() {
      return emitidos;
    },
    historial,
    verificar(autorizacion) {
      const token = (autorizacion ?? "").replace(/^Bearer\s+/i, "").trim();
      const info = tokens.get(token);
      if (!info || info.vence <= Date.now()) return null;
      return info;
    },
    revocar(token) {
      if (token === undefined) tokens.clear();
      else tokens.delete(token);
    },
    vencer(token) {
      for (const [k, v] of tokens) if (token === undefined || k === token) v.vence = 0;
    },
    reiniciar() {
      pedidos = 0;
      emitidos = 0;
      historial.length = 0;
      tokens.clear();
    },
  };
  return mock;
}

/** El mock en un servidor propio (127.0.0.1, puerto al azar). */
export function iniciarMockToken(opciones: OpcionesToken): Promise<{ url: string; mock: MockToken; server: Server; cerrar: () => Promise<void> }> {
  const mock = crearMockToken(opciones);
  const server = createServer(async (req, res) => {
    try {
      if (!(await mock.atender(req, res))) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "not_found" }));
      }
    } catch (e) {
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "mock", detalle: String(e) }));
    }
  });
  return new Promise((ok) =>
    server.listen(0, "127.0.0.1", () => {
      const a = server.address();
      const puerto = typeof a === "object" && a ? a.port : 0;
      ok({
        url: `http://127.0.0.1:${puerto}${opciones.ruta ?? "/token"}`,
        mock,
        server,
        cerrar: () =>
          new Promise<void>((listo) => {
            server.closeAllConnections();
            server.close(() => listo());
          }),
      });
    }),
  );
}
