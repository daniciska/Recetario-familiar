// Cuenta de servicio de Google: lee la clave de la variable secreta GOOGLE_CUENTA_SERVICIO y consigue
// tokens de acceso con el flujo "JWT bearer" (RFC 7523), sin bibliotecas de Google:
// https://developers.google.com/identity/protocols/oauth2/service-account#httprest
//
// - La variable trae el JSON descargado de Google Cloud, tal cual o en base64. Nunca se escribe en
//   registros, en Blobs ni en el repositorio, y ningún texto de error la incluye.
// - El token ("ya29…") vive sólo en la memoria de esta instancia y se renueva cuando le quedan menos
//   de 5 minutos. No se guarda en Blobs: es una credencial al portador.
// - Si Google dice que el JWT está fuera de plazo (reloj del servidor desfasado), se reintenta una
//   vez con la hora de la cabecera Date de la respuesta.
// - El token_uri del JSON se ignora: la aserción firmada sirve para sacar tokens durante 1 hora y
//   sólo se manda a Google, o a un simulador en esta máquina (GOOGLE_TOKEN_URL, sólo para pruebas).

import { createHash, createPrivateKey, createPublicKey, sign, type KeyObject } from "node:crypto";
import { ErrorCalDAV } from "../caldav";

export const URL_TOKEN = "https://oauth2.googleapis.com/token";
/** Eventos (leer y escribir) y uso compartido del calendario (invitar desde el panel). */
export const ALCANCE = "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.acls";

const RENOVAR_ANTES_MS = 5 * 60_000; // como DEFAULT_EAGER_REFRESH_THRESHOLD_MILLIS de google-auth-library
const ESPERA_TOKEN_MS = 3000; // máximo por pedido de token
const MARGEN_MS = 300; // lo que se deja libre antes del plazo total (como en caldav.ts)

export interface CuentaServicio {
  correo: string; // client_email: con este correo se comparte el calendario
  idClave?: string; // private_key_id (va como "kid" en el JWT)
  clave: KeyObject;
}

/**
 * Una dirección de prueba sólo se acepta si es de esta misma máquina (como ICLOUD_CALDAV_URL, pero
 * más estricto: la aserción y el token nunca deben salir hacia otro sitio). Si no, null.
 */
export function localhost(valor: string | undefined): string | null {
  const v = valor?.trim();
  return v && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(v) ? v : null;
}

/** Adónde se pide el token: Google, o GOOGLE_TOKEN_URL si es local (pruebas). */
export const urlTokenGoogle = () => localhost(process.env.GOOGLE_TOKEN_URL) ?? URL_TOKEN;

// ---------- Lectura de la clave ----------

/** PEM de la clave privada armado de nuevo (sirve aunque se haya pegado con "\n" literales o en una línea). */
function normalizarPem(pem: string): { pem: string } | { problema: string } {
  const texto = pem.replace(/\\r/g, "").replace(/\\n/g, "\n");
  const m = /-----BEGIN ((?:RSA )?PRIVATE KEY)-----([\s\S]*?)-----END \1-----/.exec(texto);
  if (!m) {
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(texto) && !/-----END [A-Z ]*PRIVATE KEY-----/.test(texto))
      return { problema: "la clave privada está incompleta (¿se copió solo una parte?)" };
    if (/ENCRYPTED PRIVATE KEY/.test(texto)) return { problema: "la clave privada está protegida con contraseña (hay que usar la que entrega Google Cloud)" };
    return { problema: "la clave privada está dañada" };
  }
  const cuerpo = m[2].replace(/\s+/g, "");
  if (!cuerpo || !/^[A-Za-z0-9+/]+={0,2}$/.test(cuerpo)) return { problema: "la clave privada está dañada" };
  const lineas = cuerpo.match(/.{1,64}/g) ?? [];
  return { pem: `-----BEGIN ${m[1]}-----\n${lineas.join("\n")}\n-----END ${m[1]}-----\n` };
}

/**
 * Lee y valida el valor de GOOGLE_CUENTA_SERVICIO (el JSON de la cuenta de servicio, tal cual o en
 * base64). Los textos de `problema` nunca incluyen la clave ni partes del valor.
 */
export function leerCuentaServicio(valor: string): { cuenta: CuentaServicio } | { problema: string } {
  const texto = valor.trim();
  const crudo = texto.startsWith("{") ? texto : Buffer.from(texto.replace(/\s+/g, ""), "base64").toString("utf8").trim();
  let json: unknown;
  try {
    json = JSON.parse(crudo);
  } catch {
    // (El mensaje de JSON.parse cita parte del texto: nunca se muestra.)
    return crudo.startsWith("{")
      ? { problema: "el JSON está incompleto o dañado (¿se copió solo una parte?)" }
      : { problema: "no es el JSON de una cuenta de servicio (ni tal cual ni en base64)" };
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) return { problema: "no es el JSON de una cuenta de servicio" };
  const j = json as Record<string, unknown>;
  if (j.type !== "service_account") {
    if (j.installed || j.web) return { problema: "es el JSON de un cliente OAuth, no el de una cuenta de servicio" };
    if (j.type === "authorized_user") return { problema: "es la credencial de una persona, no la de una cuenta de servicio" };
    return { problema: "no es el JSON de una cuenta de servicio (falta \"type\": \"service_account\")" };
  }
  const correo = typeof j.client_email === "string" ? j.client_email.trim() : "";
  if (!/^[^\s@]+@[^\s@]+$/.test(correo)) return { problema: "falta el correo de la cuenta de servicio (client_email)" };
  if (typeof j.private_key !== "string" || !j.private_key.includes("PRIVATE KEY")) return { problema: "falta la clave privada (private_key)" };
  const pem = normalizarPem(j.private_key);
  if ("problema" in pem) return pem;
  let clave: KeyObject;
  try {
    clave = createPrivateKey(pem.pem);
  } catch {
    return { problema: "la clave privada está dañada o incompleta (¿se copió solo una parte?)" };
  }
  if (clave.asymmetricKeyType !== "rsa") return { problema: "la clave privada no es RSA" };
  const idClave = typeof j.private_key_id === "string" && j.private_key_id.trim() ? j.private_key_id.trim() : undefined;
  // token_uri se ignora a propósito (ver arriba).
  return { cuenta: { correo, ...(idClave ? { idClave } : {}), clave } };
}

let memo: { valor: string; r: { cuenta: CuentaServicio } | { problema: string } } | null = null;

/**
 * La cuenta de servicio configurada en GOOGLE_CUENTA_SERVICIO; null si la variable está vacía.
 * Se lee una sola vez por valor: mientras no cambie, devuelve el mismo objeto.
 */
export function cuentaGoogle(): { cuenta: CuentaServicio } | { problema: string } | null {
  const valor = process.env.GOOGLE_CUENTA_SERVICIO ?? "";
  if (!valor.trim()) return null;
  if (memo?.valor !== valor) memo = { valor, r: leerCuentaServicio(valor) };
  return memo.r;
}

// ---------- JWT ----------

const b64u = (x: string | Buffer) => Buffer.from(x).toString("base64url"); // RFC 4648 §5, sin "="

/** JWT RS256 de la aserción: encabezado, reclamos y firma, cada parte en base64url. */
export function firmarAsercion(c: CuentaServicio, iat: number): string {
  const encabezado = { alg: "RS256", typ: "JWT", ...(c.idClave ? { kid: c.idClave } : {}) };
  const reclamos = { iss: c.correo, scope: ALCANCE, aud: URL_TOKEN, iat, exp: iat + 3600 };
  const entrada = `${b64u(JSON.stringify(encabezado))}.${b64u(JSON.stringify(reclamos))}`;
  // RSASSA-PKCS1-v1_5 con SHA-256 ("SHA256withRSA"): es el relleno por omisión de crypto.sign con RSA.
  return `${entrada}.${b64u(sign("sha256", Buffer.from(entrada, "utf8"), c.clave))}`;
}

// ---------- Tokens ----------

interface TokenGuardado {
  token: string;
  vence: number; // ms, reloj local
}
const cache = new Map<string, TokenGuardado>();
const enCurso = new Map<string, Promise<TokenGuardado>>();
let desfaseMs = 0; // hora de Google − hora local, aprendido de un rechazo por plazo

/**
 * Llave de la caché: el correo y la huella de la clave. Si la familia cambia la clave (p. ej. borró
 * la anterior en Google Cloud), se pide un token nuevo en vez de seguir con el de la clave vieja.
 */
const llaves = new WeakMap<CuentaServicio, string>();
function llaveDe(c: CuentaServicio): string {
  let l = llaves.get(c);
  if (!l) {
    const publica = createPublicKey(c.clave).export({ type: "spki", format: "der" });
    l = `${c.correo}|${createHash("sha256").update(publica).digest("hex").slice(0, 16)}`;
    llaves.set(c, l);
  }
  return l;
}

const tiempo = () => new ErrorCalDAV("Se acabó el tiempo para hablar con Google", 0, "TIEMPO");

/**
 * Token de acceso válido por al menos 5 minutos más. `hasta` es el plazo total (Date.now()): el pedido
 * a Google nunca pasa de ahí. Los pedidos simultáneos (p. ej. tres "crear" en paralelo) comparten un
 * solo POST. Errores: ErrorCalDAV CLAVE, SERVIDOR, TIEMPO o RED.
 */
export async function tokenDeAcceso(c: CuentaServicio, hasta: number): Promise<string> {
  const llave = llaveDe(c);
  const g = cache.get(llave);
  if (g && g.vence - Date.now() > RENOVAR_ANTES_MS) return g.token;
  if (hasta - Date.now() - MARGEN_MS <= 0) throw tiempo();
  const actual = enCurso.get(llave);
  if (actual) return (await conPlazo(actual, hasta)).token;
  const p = pedirToken(c, hasta)
    .then((n) => {
      cache.set(llave, n);
      return n;
    })
    .finally(() => enCurso.delete(llave));
  enCurso.set(llave, p);
  return (await p).token;
}

/** Espera un pedido que empezó otro, pero sin pasar del plazo propio. */
function conPlazo<T>(p: Promise<T>, hasta: number): Promise<T> {
  const espera = hasta - Date.now() - MARGEN_MS;
  if (espera <= 0) return Promise.reject(tiempo());
  return new Promise<T>((ok, mal) => {
    const t = setTimeout(() => mal(tiempo()), espera);
    (t as { unref?: () => void }).unref?.();
    p.then(
      (x) => {
        clearTimeout(t);
        ok(x);
      },
      (e) => {
        clearTimeout(t);
        mal(e);
      },
    );
  });
}

/** Tras un 401 de la Calendar API: el token guardado ya no sirve (p. ej. se deshabilitó la cuenta). */
export function descartarToken(c: CuentaServicio): void {
  cache.delete(llaveDe(c));
}

/** Para pruebas: olvida tokens, pedidos en curso y el desfase aprendido. */
export function olvidarTokens(): void {
  cache.clear();
  enCurso.clear();
  desfaseMs = 0;
}

const CLAVE_NO_ACEPTADA = new Set(["invalid_grant", "invalid_client", "unauthorized_client", "disabled_client", "deleted_client"]);

/** Texto de Google, limpio y corto, para mostrarlo entre paréntesis (nunca trae secretos). */
const limpio = (s: string) =>
  s
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim()
    .slice(0, 200)
    .replace(/[.\s]+$/, "");

async function pedirToken(c: CuentaServicio, hasta: number): Promise<TokenGuardado> {
  for (let intento = 0; ; intento++) {
    const espera = Math.min(ESPERA_TOKEN_MS, hasta - Date.now() - MARGEN_MS);
    if (espera <= 0) throw tiempo();
    const porPlazo = espera < ESPERA_TOKEN_MS;
    const local = Date.now();
    const iat = Math.floor((local + desfaseMs) / 1000);
    const cuerpo = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: firmarAsercion(c, iat),
    }).toString();
    const ctrl = new AbortController();
    // El plazo cubre también la lectura del cuerpo.
    const t = setTimeout(() => ctrl.abort(), espera);
    (t as { unref?: () => void }).unref?.();
    let r: Response;
    let texto: string;
    try {
      r = await fetch(urlTokenGoogle(), {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
          "user-agent": "CalendarioFamiliar/1.0",
        },
        body: cuerpo,
        signal: ctrl.signal,
        redirect: "error",
      });
      texto = await r.text();
    } catch {
      if (ctrl.signal.aborted && porPlazo) throw tiempo();
      throw new ErrorCalDAV(ctrl.signal.aborted ? "Google no respondió a tiempo" : "No se pudo conectar con Google", 0, "RED");
    } finally {
      clearTimeout(t);
    }
    let datos: Record<string, unknown> = {};
    try {
      const x = JSON.parse(texto) as unknown;
      if (x && typeof x === "object" && !Array.isArray(x)) datos = x as Record<string, unknown>;
    } catch {
      /* cuerpo vacío o que no es JSON (p. ej. un 502 de un proxy) */
    }
    if (r.ok && typeof datos.access_token === "string" && datos.access_token) {
      const segundos = typeof datos.expires_in === "number" && datos.expires_in > 0 ? datos.expires_in : 3600;
      // Se cuenta desde antes de firmar (como gtoken): queda del lado seguro.
      return { token: datos.access_token, vence: local + segundos * 1000 };
    }
    const error = typeof datos.error === "string" ? datos.error : "";
    const descripcion = typeof datos.error_description === "string" ? limpio(datos.error_description) : "";
    // Reloj desfasado: "Invalid JWT: Token must be a short-lived token (60 minutes) and in a reasonable timeframe…"
    if (error === "invalid_grant" && /timeframe|short-lived/i.test(descripcion)) {
      const fecha = Date.parse(r.headers.get("date") ?? "");
      if (intento === 0 && Number.isFinite(fecha)) {
        desfaseMs = fecha - Date.now();
        continue;
      }
      throw new ErrorCalDAV("Google rechazó la clave por la hora del servidor.", r.status, "CLAVE");
    }
    if (r.status === 429 || r.status >= 500) throw new ErrorCalDAV(`Google respondió ${r.status}: inténtalo en unos minutos`, r.status, "SERVIDOR");
    if (CLAVE_NO_ACEPTADA.has(error)) {
      throw new ErrorCalDAV(
        `Google no aceptó la clave de la cuenta de servicio${descripcion ? ` (${descripcion})` : ""}. ¿Se borró o deshabilitó en Google Cloud?`,
        r.status,
        "CLAVE",
      );
    }
    if (error === "invalid_scope") throw new ErrorCalDAV("Google no aceptó los permisos pedidos (alcance)", r.status, "SERVIDOR");
    throw new ErrorCalDAV(`Google no entregó el token (${r.status})`, r.status, "SERVIDOR");
  }
}
