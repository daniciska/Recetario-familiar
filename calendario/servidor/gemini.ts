// Gemini por REST (sin SDK) para "🎙️ Dictar receta": configuración, tipo de audio, errores y el pedido
// de la receta con sus reintentos. Lo usa la función en segundo plano (servidor/dictados.ts).
//
// - API: POST {base}/v1beta/models/{modelo}:generateContent con la cabecera x-goog-api-key (nunca ?key=,
//   que queda en registros) y redirect "error" (la clave no sigue redirecciones). generateContent es "legacy"
//   pero sigue soportado, no guarda nada y acepta "audio/*" en línea (≤ 20 MB por pedido; aquí ≤ ≈ 5,4 MB).
// - La clave sale sólo de GEMINI_API_KEY (variable secreta de Netlify). No se escribe en Blobs, registros ni
//   respuestas: todo texto que viene de Google pasa por sanear() antes de anotarse.
// - GEMINI_API_URL sólo se acepta si es http://127.0.0.1 o http://localhost (simulador de pruebas), como
//   GOOGLE_TOKEN_URL en servidor/google/: una variable mal puesta no puede mandar la clave a otro sitio.
//   Sólo entonces vale GEMINI_TIMEOUT_MS (200–180.000 ms por pedido).
// - Netlify AI Gateway: si la familia NO define GEMINI_API_KEY, Netlify inyecta su propia clave y
//   GOOGLE_GEMINI_BASE_URL (cobra créditos, sin tope). Eso se detecta y no se usa salvo GEMINI_USAR_AI_GATEWAY=1.
// - GEMINI_MODELOS (opcional): "gemini-3.8-flash,gemini-3.5-flash-lite" (hasta 4, en orden de preferencia).

import { esReintentable, type CodigoError, type EstadoGemini } from "../lib/dictados/tipos";
import { ESQUEMA_JSON } from "./receta-ia/esquema";
import { INSTRUCCION_SISTEMA, partesGenerateContent } from "./receta-ia/instruccion";
import { interpretar } from "./receta-ia/normalizar-receta";

export const URL_GOOGLE = "https://generativelanguage.googleapis.com";
export const MODELOS_POR_OMISION = ["gemini-3.8-flash", "gemini-3.5-flash-lite"];
/** Plazo de cada pedido a Gemini (escuchar 15 min de audio y escribir la receta). */
export const TIMEOUT_PEDIDO_MS = 180_000;
/** Pedidos a Gemini por corrida, sumando reintentos y modelos (el plan gratis tiene ≈ 20 por día). */
export const MAX_PEDIDOS_CORRIDA = 8;
const MAX_TOKENS = 16_384; // incluye el pensamiento ("max_output_tokens … including thought tokens")
const MAX_TOKENS_LARGO = 32_768;
const MARGEN_MS = 20_000; // no se empieza un pedido si quedan menos de esto del presupuesto

type Env = Record<string, string | undefined>;

// ---------- Configuración ----------

export type ConfigGemini =
  | { ok: true; clave: string; base: string; via: "google" | "local" | "ai_gateway"; modelos: string[]; timeoutMs: number }
  | { ok: false; motivo: "sin_clave" | "solo_ai_gateway" };
export type ConfigLista = Extract<ConfigGemini, { ok: true }>;

const MODELO_VALIDO = /^gemini-[a-z0-9][a-z0-9.-]{0,60}$/;
const URL_LOCAL = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/;
const URL_HTTPS = /^https:\/\/[^\s/?#]+(\/[^\s?#]*)?$/;

export function configGemini(env: Env = process.env): ConfigGemini {
  const clave = (env.GEMINI_API_KEY ?? "").trim();
  if (!clave) return { ok: false, motivo: "sin_clave" };
  const nombres = (env.GEMINI_MODELOS ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter((m) => MODELO_VALIDO.test(m));
  const modelos = nombres.length ? [...new Set(nombres)].slice(0, 4) : [...MODELOS_POR_OMISION];

  // Primero el AI Gateway: si Netlify puso su clave, no se usa aunque haya otra configuración.
  const baseGateway = (env.GOOGLE_GEMINI_BASE_URL ?? "").trim();
  const claveGateway = (env.NETLIFY_AI_GATEWAY_KEY ?? "").trim();
  if (baseGateway || (claveGateway && claveGateway === clave)) {
    if (env.GEMINI_USAR_AI_GATEWAY === "1" && URL_HTTPS.test(baseGateway))
      return { ok: true, clave, base: baseGateway.replace(/\/+$/, ""), via: "ai_gateway", modelos, timeoutMs: TIMEOUT_PEDIDO_MS };
    return { ok: false, motivo: "solo_ai_gateway" };
  }
  const local = (env.GEMINI_API_URL ?? "").trim();
  if (URL_LOCAL.test(local)) {
    const t = Number(env.GEMINI_TIMEOUT_MS);
    const timeoutMs = Number.isFinite(t) && t >= 200 && t <= TIMEOUT_PEDIDO_MS ? Math.round(t) : TIMEOUT_PEDIDO_MS;
    return { ok: true, clave, base: local.replace(/\/+$/, ""), via: "local", modelos, timeoutMs };
  }
  return { ok: true, clave, base: URL_GOOGLE, via: "google", modelos, timeoutMs: TIMEOUT_PEDIDO_MS };
}

/** Para /api/salud y la lista de dictados: si hay clave utilizable (nunca su valor). */
export function estadoGemini(env: Env = process.env): EstadoGemini {
  const c = configGemini(env);
  return c.ok ? "ok" : c.motivo;
}

// Forma de las claves de Google ("AI" + "za…"), escrita en dos partes para que `grep -rn` de claves pegadas
// por error en el repositorio no marque este archivo.
const FORMA_CLAVE_GOOGLE = new RegExp("AI" + "za[0-9A-Za-z_-]{20,}", "g");

/** Quita la clave (y cualquier cosa con forma de clave de Google) de un texto antes de anotarlo. Máx. 500. */
export function sanear(texto: unknown, clave?: string): string {
  let t = String(texto ?? "");
  if (clave && clave.length >= 8) t = t.split(clave).join("[clave]");
  return t
    .replace(FORMA_CLAVE_GOOGLE, "[clave]")
    .replace(/(x-goog-api-key|key)("?\s*[:=]\s*"?)[^\s&"',;}]+/gi, "$1$2[clave]")
    .slice(0, 500);
}

// ---------- Tipo de audio (por los bytes, no por lo que dice el navegador) ----------

export type AudioDetectado =
  | { ok: true; mime: string; alterno?: string; reproducir: string; formato: string }
  | { ok: false; formato: string; mensaje: string };

/**
 * Mira los primeros bytes. Safari puede dejar file.type vacío para .opus, Chrome etiqueta webm como
 * video/webm y `file` llama video/mp4 a los .m4a: por eso manda el contenido. `mime` va a Gemini (lista de
 * aistudio.google.com/docs/audio; audio/mp4 no está, así que el MP4/AAC de Safari va como audio/m4a y
 * audio/mp4 queda de alterno), `reproducir` es el content-type para escucharlo en el equipo.
 */
export function detectarAudio(cabeza: Uint8Array): AudioDetectado {
  const b = cabeza;
  const ascii = (i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));
  if (b.length < 12) return { ok: false, formato: "?", mensaje: "El archivo está vacío o incompleto." };
  if (ascii(0, 4) === "OggS") return { ok: true, mime: "audio/ogg", alterno: "audio/opus", reproducir: "audio/ogg", formato: "ogg" };
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { ok: true, mime: "audio/webm", reproducir: "audio/webm", formato: "webm" };
  if (ascii(4, 4) === "ftyp") {
    const marca = ascii(8, 4).trim();
    return { ok: true, mime: "audio/m4a", alterno: "audio/mp4", reproducir: "audio/mp4", formato: marca === "qt" ? "mov" : marca || "mp4" };
  }
  if (ascii(0, 4) === "caff")
    return { ok: false, formato: "caf", mensaje: "Ese formato (CAF del iPhone) no sirve. Compártelo como m4a desde la app Notas de Voz." };
  if (ascii(0, 5) === "#!AMR") return { ok: false, formato: "amr", mensaje: "Ese formato (AMR) no sirve. Graba de nuevo desde el panel." };
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") return { ok: true, mime: "audio/wav", reproducir: "audio/wav", formato: "wav" };
  if (ascii(0, 4) === "fLaC") return { ok: true, mime: "audio/flac", reproducir: "audio/flac", formato: "flac" };
  if (ascii(0, 4) === "FORM" && /^AIF[FC]$/.test(ascii(8, 4))) return { ok: true, mime: "audio/aiff", reproducir: "audio/aiff", formato: "aiff" };
  if (ascii(0, 3) === "ID3") return { ok: true, mime: "audio/mp3", alterno: "audio/mpeg", reproducir: "audio/mpeg", formato: "mp3" };
  if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return { ok: true, mime: "audio/aac", reproducir: "audio/aac", formato: "aac" }; // ADTS (FF F1/F9)
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return { ok: true, mime: "audio/mp3", alterno: "audio/mpeg", reproducir: "audio/mpeg", formato: "mp3" };
  if (ascii(0, 4) === "%PDF" || (b[0] === 0xff && b[1] === 0xd8) || ascii(1, 3) === "PNG")
    return { ok: false, formato: "no_audio", mensaje: "Ese archivo no es un audio." };
  return {
    ok: false,
    formato: "desconocido",
    mensaje: "No reconozco ese formato de audio. Sirven notas de voz de WhatsApp (.opus), m4a, mp3, ogg, webm o wav.",
  };
}

// ---------- Errores de Google ----------

export type CodigoFallo =
  | "clave_invalida" // 400 API_KEY_INVALID, 401, 403 sin clave o con clave filtrada
  | "verificacion" // 403 FREE_TIER_VERIFICATION_REQUIRED
  | "region" // 400 FAILED_PRECONDITION (plan gratis no disponible)
  | "pago" // 402 (prepago agotado)
  | "permiso" // otros 403
  | "cuota_minuto" // 429 por minuto (con la espera de RetryInfo)
  | "cuota_dia" // 429 con quotaId …PerDay…
  | "ocupado" // 5xx, 408, 499, red o plazo
  | "modelo" // 404: modelo inexistente o retirado
  | "campo" // 400 por un campo que la API no conoce (responseFormat): se usa la otra forma
  | "formato" // 400 por el audio o su MIME
  | "grande" // 400/413 pedido demasiado grande
  | "peticion" // otros 400 (error del panel)
  | "bloqueo"; // SAFETY, PROHIBITED_CONTENT, blockReason…

export interface Fallo {
  codigo: CodigoFallo;
  http?: number;
  detalle: string; // ya saneado; sólo para registros
  esperaMs?: number;
}

const enMs = (s: unknown): number | null => {
  const m = typeof s === "string" ? /^([\d.]+)s$/.exec(s.trim()) : null;
  return m ? Math.ceil(parseFloat(m[1]) * 1000) : null;
};

/**
 * Lee el error de Google en sus tres formas: {error:{code,status,details}}, [{error:…}] (lo que contesta
 * /v1beta/interactions) y la de Interactions {error:{code:"rate_limit_exceeded"}}.
 */
export function interpretarError(http: number, cuerpo: unknown, clave?: string): Fallo {
  const raiz = Array.isArray(cuerpo) ? cuerpo[0] : cuerpo;
  const e = ((raiz as { error?: Record<string, unknown> } | null)?.error ?? {}) as Record<string, unknown>;
  const msg = String(e.message ?? `HTTP ${http}`);
  const status = String(e.status ?? (typeof e.code === "string" ? e.code : ""));
  const detalles = (Array.isArray(e.details) ? e.details : []).filter((d): d is Record<string, unknown> => !!d && typeof d === "object");
  const razones = detalles.map((d) => String(d.reason ?? "")).join(" ");
  const quotaIds = detalles
    .flatMap((d) => (Array.isArray(d.violations) ? (d.violations as Record<string, unknown>[]) : []))
    .map((v) => String(v?.quotaId ?? ""))
    .join(" ");
  const retry = enMs(detalles.find((d) => String(d["@type"] ?? "").endsWith("RetryInfo"))?.retryDelay);
  const enTexto = /retry in ([\d.]+)\s*s/i.exec(msg);
  const espera = retry ?? (enTexto ? Math.ceil(parseFloat(enTexto[1]) * 1000) : null);
  const detalle = sanear(`${http} ${status} ${razones} ${msg}`.replace(/\s+/g, " ").trim(), clave);
  const f = (codigo: CodigoFallo, esperaMs?: number): Fallo => ({ codigo, http, detalle, ...(esperaMs != null ? { esperaMs } : {}) });

  if (/API_KEY_INVALID|API_KEY_SERVICE_BLOCKED/.test(razones) || http === 401 || (http === 403 && /leaked|api key|API_KEY/i.test(msg + razones)))
    return f("clave_invalida");
  if (/FREE_TIER_VERIFICATION_REQUIRED|must be verified/i.test(`${razones} ${msg}`)) return f("verificacion");
  if (http === 400 && /Unknown name|Cannot find field|responseFormat/i.test(msg)) return f("campo");
  if (http === 402) return f("pago");
  if (http === 429) {
    if (/PerDay/i.test(quotaIds) || /per day|daily/i.test(msg) || status === "quota_exceeded") return f("cuota_dia");
    return f("cuota_minuto", Math.min(Math.max(espera ?? 20_000, 1_000), 60_000));
  }
  if (http === 404 || status === "NOT_FOUND" || status === "model_not_found") return f("modelo");
  if (http === 413 || /request (payload|entity)? ?(size|too large)|exceeds the maximum|payload size exceeds/i.test(msg)) return f("grande");
  if (/FAILED_PRECONDITION/i.test(status) && /country|region|billing|location/i.test(msg)) return f("region");
  if (http === 403) return f("permiso");
  if (http >= 500 || http === 408 || http === 499) return f("ocupado", espera ?? undefined);
  if (http === 400 && /mime|audio|media|unsupported|could not (process|decode)|invalid (file|argument).*(audio|blob)/i.test(msg)) return f("formato");
  return f("peticion");
}

// ---------- Reloj (falso en las pruebas) ----------

export interface Reloj {
  ahora(): number;
  dormir(ms: number): Promise<void>;
}
export const relojReal: Reloj = { ahora: () => Date.now(), dormir: (ms) => new Promise((ok) => setTimeout(ok, ms)) };

/** ms · (0,8 … 1,2): que dos corridas no reintenten al mismo tiempo. */
export const jitter = (ms: number) => Math.round(ms * (0.8 + Math.random() * 0.4));

/**
 * Próxima medianoche del Pacífico (ahí se reinicia la cuota diaria del plan gratis: "RPD quotas reset at
 * midnight Pacific time") + 5 min. Corrige los días de 23 y 25 horas del cambio de hora.
 */
export function reinicioCuota(ahora: number): number {
  const minutosDelDia = (t: number) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit" })
        .formatToParts(t)
        .map((x) => [x.type, x.value]),
    );
    return ((Number(p.hour) % 24) * 3600 + Number(p.minute) * 60 + Number(p.second)) * 1000 + (t % 1000);
  };
  let medianoche = ahora + (86_400_000 - minutosDelDia(ahora));
  const desfase = minutosDelDia(medianoche); // 0 salvo en el cambio de hora (±1 h)
  if (desfase) medianoche += desfase > 43_200_000 ? 86_400_000 - desfase : -desfase;
  return medianoche + 5 * 60_000;
}

// ---------- Pedido ----------

export type FormaSalida = "responseFormat" | "responseJsonSchema";

/**
 * Cuerpo de generateContent. "low" sirve en 3.8 Flash y en Flash-Lite ("minimal" da error en 3.8). Sin
 * temperature/topP/topK ni thinkingBudget: desde 3.6 se ignoran y "a futuro" darán 400. La forma nueva de la
 * salida estructurada es responseFormat.text; si la API no la conoce (400 "Unknown name"), se usa
 * responseMimeType + responseJsonSchema.
 */
export function cuerpoPedido(parts: Record<string, unknown>[], forma: FormaSalida, maxTokens: number) {
  return {
    systemInstruction: { parts: [{ text: INSTRUCCION_SISTEMA }] },
    contents: [{ role: "user", parts }],
    generationConfig: {
      maxOutputTokens: maxTokens,
      thinkingConfig: { thinkingLevel: "low" },
      ...(forma === "responseFormat"
        ? { responseFormat: { text: { mimeType: "APPLICATION_JSON", schema: ESQUEMA_JSON } } }
        : { responseMimeType: "application/json", responseJsonSchema: ESQUEMA_JSON }),
    },
  };
}

export interface Tokens {
  audio?: number;
  entrada?: number;
  salida?: number;
  pensamiento?: number;
}

type Respuesta = { ok: true; json: unknown } | { ok: false; fallo: Fallo };

async function pedir(cfg: ConfigLista, ruta: string, init: { method: string; body?: string }, plazoMs: number): Promise<Respuesta> {
  let r: Response;
  try {
    r = await fetch(`${cfg.base}${ruta}`, {
      method: init.method,
      body: init.body,
      headers: { ...(init.body ? { "content-type": "application/json" } : {}), "x-goog-api-key": cfg.clave },
      redirect: "error",
      signal: AbortSignal.timeout(Math.max(200, plazoMs)),
    });
  } catch (e) {
    const nombre = (e as { name?: string })?.name ?? "";
    return { ok: false, fallo: { codigo: "ocupado", detalle: nombre === "TimeoutError" ? "plazo agotado" : "sin conexión con Gemini" } };
  }
  let texto = "";
  try {
    texto = await r.text();
  } catch {
    return { ok: false, fallo: { codigo: "ocupado", http: r.status, detalle: "se cortó la respuesta de Gemini" } };
  }
  let json: unknown = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    /* un proxy o una página de error */
  }
  if (!r.ok) return { ok: false, fallo: interpretarError(r.status, json, cfg.clave) };
  return { ok: true, json };
}

type Intento =
  | { tipo: "ok"; datos: Record<string, unknown>; tokens: Tokens; finishReason?: string }
  | { tipo: "corte"; transcripcion?: string; detalle: string }
  | { tipo: "json"; transcripcion?: string; detalle: string }
  | { tipo: "fallo"; fallo: Fallo };

/** Una llamada a generateContent y la lectura de su respuesta. */
async function intento(cfg: ConfigLista, modelo: string, cuerpo: unknown, plazoMs: number): Promise<Intento> {
  const r = await pedir(cfg, `/v1beta/models/${encodeURIComponent(modelo)}:generateContent`, { method: "POST", body: JSON.stringify(cuerpo) }, plazoMs);
  if (!r.ok) return { tipo: "fallo", fallo: r.fallo };
  type Parte = { text?: unknown; thought?: unknown };
  const j = (r.json ?? {}) as {
    candidates?: { finishReason?: string; content?: { parts?: Parte[] } }[];
    promptFeedback?: { blockReason?: string };
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      thoughtsTokenCount?: number;
      promptTokensDetails?: { modality?: string; tokenCount?: number }[];
    };
  };
  if (j.promptFeedback?.blockReason) return { tipo: "fallo", fallo: { codigo: "bloqueo", detalle: sanear(j.promptFeedback.blockReason, cfg.clave) } };
  const c = Array.isArray(j.candidates) ? j.candidates[0] : undefined;
  const texto = (Array.isArray(c?.content?.parts) ? c.content.parts : [])
    .filter((p) => p && p.thought !== true && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("");
  const u = j.usageMetadata;
  const tokens: Tokens = {
    audio: u?.promptTokensDetails?.find?.((d) => d?.modality === "AUDIO")?.tokenCount,
    entrada: u?.promptTokenCount,
    salida: u?.candidatesTokenCount,
    pensamiento: u?.thoughtsTokenCount,
  };
  if (c?.finishReason === "MAX_TOKENS") {
    const i = interpretar(texto);
    return { tipo: "corte", transcripcion: i.ok ? undefined : i.transcripcion, detalle: "MAX_TOKENS" };
  }
  if (c?.finishReason && c.finishReason !== "STOP") return { tipo: "fallo", fallo: { codigo: "bloqueo", detalle: sanear(c.finishReason, cfg.clave) } };
  const i = interpretar(texto);
  if (!i.ok) return { tipo: "json", transcripcion: i.transcripcion, detalle: texto.trim() ? i.error : "respuesta vacía" };
  if (!i.datos || typeof i.datos !== "object" || Array.isArray(i.datos)) return { tipo: "json", detalle: "la respuesta no es un objeto" };
  return { tipo: "ok", datos: i.datos as Record<string, unknown>, tokens, finishReason: c?.finishReason };
}

export interface AudioPedido {
  datos: Uint8Array;
  mime: string; // de detectarAudio
  mimeAlterno?: string;
  archivo?: string; // nombre del archivo (pista para Gemini)
  fecha?: string; // "9 de noviembre de 2026"
}

export interface OpcionesPedido {
  /** epoch ms (del reloj): no se empieza un pedido después de hasta − 20 s. */
  hasta: number;
  reloj?: Reloj;
  log?: (linea: string) => void;
}

export type ResultadoPedido =
  | { tipo: "ok"; modelo: string; ms: number; datos: Record<string, unknown>; tokens: Tokens; pedidos: number; mime: string }
  | { tipo: "rescate"; transcripcion: string; modelo: string; pedidos: number }
  | { tipo: "error"; codigo: CodigoError; reintentable: boolean; proximo?: number; detalle: string; pedidos: number };

const acotar = (x: number, min: number, max: number) => Math.min(max, Math.max(min, x));

/**
 * Pide la receta con reintentos dentro del presupuesto `hasta`. Nunca lanza.
 * - 429 por minuto: espera lo que dice RetryInfo (2–60 s, un poco más) y repite; a la 3.ª, el otro modelo.
 * - 5xx, red o plazo: espera ≈ 10 s y ≈ 30 s; a la 3.ª, el otro modelo.
 * - Cuota del día: el otro modelo de inmediato (su retryDelay engaña); si se agotaron todos, cuota_dia
 *   hasta la medianoche del Pacífico.
 * - 404: el otro modelo. 400 por responseFormat: una vez con responseJsonSchema. Formato: una vez con el
 *   MIME alterno. Respuesta cortada: una vez con 32.768 tokens. JSON dañado: una vez más. Si no, se rescata
 *   la transcripción o queda "incompleta".
 * - Clave, verificación, región, saldo, permiso y bloqueo: sin reintento (la familia tiene que hacer algo).
 */
export async function pedirReceta(cfg: ConfigLista, audio: AudioPedido, op: OpcionesPedido): Promise<ResultadoPedido> {
  const reloj = op.reloj ?? relojReal;
  const log = op.log ?? (() => {});
  const base64 = Buffer.from(audio.datos.buffer, audio.datos.byteOffset, audio.datos.byteLength).toString("base64");
  let mime = audio.mime;
  let forma: FormaSalida = "responseFormat";
  let maxTokens = MAX_TOKENS;
  let jsonReintentado = false;
  let alternoUsado = false;
  let pedidos = 0;
  let dia = 0;
  let sinModelo = 0;
  let pasajero = false;
  let incompleta = false;
  let rescate: { transcripcion: string; modelo: string } | undefined;
  let detalle = "";
  const error = (codigo: CodigoError, proximo?: number): ResultadoPedido => ({
    tipo: "error",
    codigo,
    reintentable: esReintentable(codigo),
    ...(proximo ? { proximo } : {}),
    detalle,
    pedidos,
  });

  try {
    todos: for (const modelo of cfg.modelos) {
      let pasajeros = 0;
      for (;;) {
        if (pedidos >= MAX_PEDIDOS_CORRIDA || reloj.ahora() > op.hasta - MARGEN_MS) {
          pasajero = true;
          break todos;
        }
        pedidos++;
        const t0 = reloj.ahora();
        const parts = partesGenerateContent([{ datos: base64, mime, nombreArchivo: audio.archivo }], { fecha: audio.fecha });
        const plazo = Math.min(cfg.timeoutMs, Math.max(1_000, op.hasta - t0));
        const r = await intento(cfg, modelo, cuerpoPedido(parts, forma, maxTokens), plazo);
        if (r.tipo === "ok") return { tipo: "ok", modelo, ms: reloj.ahora() - t0, datos: r.datos, tokens: r.tokens, pedidos, mime };
        if (r.tipo === "corte" || r.tipo === "json") {
          detalle = `${modelo}: ${r.detalle}`;
          log(`gemini ${modelo}: ${r.tipo} (${r.detalle})`);
          if (r.transcripcion && !rescate) rescate = { transcripcion: r.transcripcion, modelo };
          if (r.tipo === "corte" && maxTokens === MAX_TOKENS) {
            maxTokens = MAX_TOKENS_LARGO;
            continue;
          }
          if (r.tipo === "json" && !jsonReintentado) {
            jsonReintentado = true;
            continue;
          }
          incompleta = true;
          break todos;
        }
        const f = r.fallo;
        detalle = sanear(`${modelo}: ${f.codigo} ${f.detalle}`, cfg.clave);
        log(`gemini ${detalle}`);
        switch (f.codigo) {
          case "campo":
            if (forma === "responseFormat") {
              forma = "responseJsonSchema";
              continue;
            }
            return error("interno");
          case "formato":
            if (audio.mimeAlterno && !alternoUsado) {
              alternoUsado = true;
              mime = audio.mimeAlterno;
              continue;
            }
            return error("formato");
          case "cuota_minuto":
          case "ocupado": {
            pasajero = true;
            pasajeros++;
            const espera =
              f.codigo === "cuota_minuto"
                ? Math.round(acotar(f.esperaMs ?? 20_000, 2_000, 60_000) * (1 + Math.random() * 0.2)) // nunca antes de lo que dijo Google
                : jitter(pasajeros === 1 ? 10_000 : 30_000);
            if (pasajeros < 3 && reloj.ahora() + espera + MARGEN_MS < op.hasta) {
              await reloj.dormir(espera);
              continue;
            }
            continue todos;
          }
          case "cuota_dia":
            dia++;
            continue todos;
          case "modelo":
            sinModelo++;
            continue todos;
          case "bloqueo":
            return error("bloqueado");
          case "clave_invalida":
          case "verificacion":
          case "region":
          case "permiso":
            return error(f.codigo);
          case "pago":
            return error("sin_saldo");
          default: // peticion, grande: error del panel
            return error("interno");
        }
      }
    }
  } catch (e) {
    detalle = sanear(`falla inesperada: ${String((e as Error)?.message ?? e)}`, cfg.clave);
    log(`gemini ${detalle}`);
    return error("interno");
  }
  if (rescate) return { tipo: "rescate", transcripcion: rescate.transcripcion, modelo: rescate.modelo, pedidos };
  if (incompleta) return error("incompleta");
  if (dia && dia + sinModelo >= cfg.modelos.length) return error("cuota_dia", reinicioCuota(reloj.ahora()));
  if (pasajero || dia) return error("ocupado", reloj.ahora() + 10 * 60_000);
  return error("interno"); // todos los modelos dieron 404: GEMINI_MODELOS mal escrito o modelos retirados
}

/** Prueba la clave sin gastar cuota de generación (GET /v1beta/models/{modelo}). */
export async function probarClave(cfg: ConfigGemini): Promise<{ ok: true; modelo: string } | { ok: false; codigo: CodigoError }> {
  if (!cfg.ok) return { ok: false, codigo: cfg.motivo };
  let ultimo: CodigoFallo = "modelo";
  for (const m of cfg.modelos) {
    const r = await pedir(cfg, `/v1beta/models/${encodeURIComponent(m)}`, { method: "GET" }, Math.min(cfg.timeoutMs, 8_000));
    if (r.ok) return { ok: true, modelo: m };
    ultimo = r.fallo.codigo;
    if (ultimo !== "modelo") break;
  }
  const codigos: Partial<Record<CodigoFallo, CodigoError>> = {
    clave_invalida: "clave_invalida",
    verificacion: "verificacion",
    region: "region",
    permiso: "permiso",
    pago: "sin_saldo",
    cuota_minuto: "ocupado",
    cuota_dia: "cuota_dia",
    ocupado: "ocupado",
  };
  return { ok: false, codigo: codigos[ultimo] ?? "interno" };
}
