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
// - GEMINI_MODELOS (opcional): "gemini-3.8-flash,gemini-3.6-flash" (hasta 4, en orden de preferencia).
// - Modelos por omisión (aistudio.google.com/docs/models, 12 nov 2026): 3.8 Flash (el más nuevo), y de
//   respaldo los «Stable» 3.6 Flash, 3.5 Flash-Lite y 3.1 Flash-Lite (deprecado, se apaga no antes del
//   7 may 2027: si ya no existe, da 404 y se salta). Los cuatro aceptan audio en línea, salida estructurada
//   (responseFormat o responseJsonSchema) y thinkingLevel "low" (docs/thinking: "minimal" da error en 3.8 y
//   "low" no sirve sólo en 3.1 Flash-Lite Image, que no se usa), así que el cuerpo es el mismo para todos. Si
//   un modelo igual rechaza algo (400), se pasa al siguiente (ver pedirReceta).

import { esReintentable, esperaOcupadoMs, type CodigoError, type EstadoGemini } from "../lib/dictados/tipos";
import { ESQUEMA_JSON } from "./receta-ia/esquema";
import { INSTRUCCION_SISTEMA, partesGenerateContent } from "./receta-ia/instruccion";
import { interpretar } from "./receta-ia/normalizar-receta";

export const URL_GOOGLE = "https://generativelanguage.googleapis.com";
export const MODELOS_POR_OMISION = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];
/** Plazo de cada pedido a Gemini (escuchar 15 min de audio y escribir la receta). */
export const TIMEOUT_PEDIDO_MS = 180_000;
/**
 * Pedidos a Gemini por corrida, sumando vueltas y modelos: con 4 modelos, 3 vueltas. Un 503 «high demand»
 * no gasta tokens (Google no atendió el pedido: "503 errors are unrelated to your quota", foro de Google);
 * el plan gratis tiene ≈ 20 pedidos al día por modelo.
 */
export const MAX_PEDIDOS_CORRIDA = 12;
/** Pedidos por modelo y por corrida cuando Google está ocupado (503) o pide esperar (429): con menos modelos vivos
 *  no se insiste más en el mismo (con los 4 vivos, 4 × 3 = el tope de 12). */
export const MAX_PASAJEROS_POR_MODELO = 3;
/** Espera antes de otra vuelta si algún modelo estaba ocupado: ≈ 10 s después de la 1.ª y ≈ 30 s después de las demás (± 20 %). */
export const ESPERAS_VUELTA_MS = [10_000, 30_000] as const;
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

// ---------- Duración (por los bytes, sin decodificar) ----------

/**
 * Segundos de audio según lo que anota el contenedor, o undefined si no se puede saber. Así el tope de 15
 * minutos no depende sólo de lo que dice el equipo (`?segundos=`). Siempre lo que DURA, no dónde termina: un
 * audio puede no partir en 0 (cortado de una transmisión, `ffmpeg -output_ts_offset`), así que se resta el
 * comienzo. Ogg (Opus/Vorbis): la posición del último paquete menos la del primero; WebM: Duration de Info
 * o, en lo que graba MediaRecorder (sin Duration), el último bloque menos el primero; MP4/M4A: lo que dura
 * la pista (mdhd, sin los huecos de la lista de ediciones) o mvhd y, en MP4 fragmentado (Safari), el final
 * del último fragmento menos el comienzo del primero; WAV y AIFF: datos / tasa; FLAC: STREAMINFO; MP3:
 * Xing/Info/VBRI o, si no vienen, la suma de los cuadros (el bitrate del primero engaña en un VBR); AAC: los
 * cuadros ADTS. Un resultado que no calza con el tamaño (menos de 500 bit/s o más de 6 Mbit/s) es una
 * cabecera rota: undefined.
 */
export function duracionAudio(b: Uint8Array): number | undefined {
  let s: number | undefined;
  try {
    s = leerDuracion(b);
  } catch {
    s = undefined;
  }
  if (s == null || !Number.isFinite(s) || s <= 0) return undefined;
  const bps = (b.byteLength * 8) / s;
  return bps >= 500 && bps <= 6_000_000 ? s : undefined;
}

const textoEn = (b: Uint8Array, i: number, n: number) => (i >= 0 && i + n <= b.length ? String.fromCharCode(...b.subarray(i, i + n)) : "");

function leerDuracion(b: Uint8Array): number | undefined {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (textoEn(b, 0, 4) === "OggS") return duracionOgg(b, v);
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return duracionWebm(b, v);
  if (textoEn(b, 4, 4) === "ftyp") return duracionMp4(b, v);
  if (textoEn(b, 0, 4) === "RIFF" && textoEn(b, 8, 4) === "WAVE") return duracionWav(b, v);
  if (textoEn(b, 0, 4) === "fLaC") return duracionFlac(b, v);
  if (textoEn(b, 0, 4) === "FORM" && /^AIF[FC]$/.test(textoEn(b, 8, 4))) return duracionAiff(b, v);
  if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return duracionAdts(b);
  if (textoEn(b, 0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return duracionMp3(b, v);
  return undefined;
}

const SIN_GRANULE = 0xffffffffffffffffn; // ningún paquete termina en esta página

/** Largo total de la página Ogg que empieza en `i` (cabecera + tabla + datos), o 0 si no cabe entera. */
function largoPaginaOgg(b: Uint8Array, i: number): number {
  if (i + 27 > b.length) return 0;
  const segs = b[i + 26];
  if (i + 27 + segs > b.length) return 0;
  let largo = 27 + segs;
  for (let k = 0; k < segs; k++) largo += b[i + 27 + k];
  return i + largo <= b.length ? largo : 0;
}

/**
 * Ogg: (granule de la última página entera del flujo − el del comienzo − pre-skip) / tasa (Opus siempre a
 * 48 kHz). El comienzo es 0 en un archivo normal; si no (cortado de una transmisión, -output_ts_offset), es
 * el granule de la primera página de audio menos las muestras que trae.
 */
function duracionOgg(b: Uint8Array, v: DataView): number | undefined {
  if (b.length < 27 || b[4] !== 0) return undefined;
  const serie = v.getUint32(14, true);
  const ini = 27 + b[26];
  let tasa = 0;
  let salto = 0;
  const opus = textoEn(b, ini, 8) === "OpusHead";
  if (opus && ini + 12 <= b.length) {
    tasa = 48_000;
    salto = v.getUint16(ini + 10, true);
  } else if (textoEn(b, ini, 7) === "\x01vorbis" && ini + 16 <= b.length) tasa = v.getUint32(ini + 12, true);
  if (!tasa) return undefined;
  for (let i = b.length - 27; i > 0; i--) {
    if (b[i] !== 0x4f || b[i + 1] !== 0x67 || b[i + 2] !== 0x67 || b[i + 3] !== 0x53 || b[i + 4] !== 0) continue;
    if (v.getUint32(i + 14, true) !== serie) continue;
    if (!largoPaginaOgg(b, i)) continue; // página cortada: la anterior
    const pos = v.getBigUint64(i + 6, true);
    if (pos === SIN_GRANULE) continue;
    const comienzo = comienzoOgg(b, v, serie, opus);
    return comienzo > Number(pos) ? undefined : (Number(pos) - comienzo - salto) / tasa;
  }
  return undefined;
}

/**
 * Granule donde parte el audio: el de la primera página de audio del flujo (la primera con granule, después
 * de las cabeceras, que tienen 0) menos las muestras de los paquetes que terminan en ella. En Opus se cuentan
 * por el TOC de cada paquete (RFC 6716 §3.1); en Vorbis (o si no se puede) se estima con lo que avanza la
 * página siguiente. Si las páginas no se pueden recorrer desde el principio, 0 (como un archivo normal).
 */
function comienzoOgg(b: Uint8Array, v: DataView, serie: number, opus: boolean): number {
  const audio: number[] = [];
  for (let i = 0, n = 0; n < 256 && audio.length < 2; n++) {
    if (textoEn(b, i, 4) !== "OggS" || b[i + 4] !== 0) break;
    const largo = largoPaginaOgg(b, i);
    if (!largo) break;
    const pos = v.getBigUint64(i + 6, true);
    if (v.getUint32(i + 14, true) === serie && pos !== 0n && pos !== SIN_GRANULE) audio.push(i);
    i += largo;
  }
  if (!audio.length) return 0;
  const primero = Number(v.getBigUint64(audio[0] + 6, true));
  let muestras = opus ? muestrasPaginaOpus(b, audio[0]) : undefined;
  if (muestras == null) {
    if (audio.length < 2) return 0;
    muestras = Number(v.getBigUint64(audio[1] + 6, true)) - primero;
  }
  return Math.max(0, primero - muestras);
}

/** Muestras (a 48 kHz) de los paquetes Opus que terminan en la página `i`; undefined si no se pueden leer. */
function muestrasPaginaOpus(b: Uint8Array, i: number): number | undefined {
  if (b[i + 5] & 1) return undefined; // parte con la continuación de un paquete de la página anterior
  const segs = b[i + 26];
  let p = i + 27 + segs;
  let largo = 0;
  let total = 0;
  for (let k = 0; k < segs; k++) {
    largo += b[i + 27 + k];
    if (b[i + 27 + k] === 255) continue; // el paquete sigue
    if (largo) {
      const toc = b[p];
      const config = toc >> 3;
      const cuadro = config < 12 ? [480, 960, 1920, 2880][config & 3] : config < 16 ? [480, 960][config & 1] : [120, 240, 480, 960][config & 3];
      const cuadros = (toc & 3) === 0 ? 1 : (toc & 3) < 3 ? 2 : largo >= 2 ? b[p + 1] & 0x3f : 0;
      if (!cuadros) return undefined;
      total += cuadros * cuadro;
    }
    p += largo;
    largo = 0;
  }
  return total;
}

/** Número de largo variable de EBML (Matroska/WebM). `id` deja el marcador; el tamaño lo quita. */
function vintEbml(b: Uint8Array, i: number, id: boolean): { largo: number; valor: number; desconocido: boolean } | null {
  const x = b[i];
  if (!x) return null;
  let largo = 1;
  let marca = 0x80;
  while (!(x & marca)) {
    marca >>= 1;
    largo++;
  }
  if (largo > (id ? 4 : 8) || i + largo > b.length) return null;
  let valor = id ? x : x & (marca - 1);
  let unos = !id && valor === marca - 1;
  for (let k = 1; k < largo; k++) {
    valor = valor * 256 + b[i + k];
    if (b[i + k] !== 0xff) unos = false;
  }
  return { largo, valor, desconocido: unos };
}

function uintBE(b: Uint8Array, i: number, n: number): number {
  let x = 0;
  for (let k = 0; k < n && k < 8; k++) x = x * 256 + b[i + k];
  return x;
}

/**
 * WebM: recorre Segment, Info, Cluster y BlockGroup por dentro (también con tamaño desconocido, como los
 * escribe MediaRecorder) y salta lo demás. Cada bloque está en Timecode del Cluster + el relativo del bloque.
 * Sin Duration en Info (MediaRecorder): el último bloque menos el primero. Con Duration: ffmpeg anota ahí
 * dónde termina (no lo que dura), así que si cubre el último bloque se le resta el primero; si no, ya es lo
 * que dura (como dice Matroska).
 */
function duracionWebm(b: Uint8Array, v: DataView): number | undefined {
  const ADENTRO = new Set([0x18538067, 0x1549a966, 0x1f43b675, 0xa0]); // Segment, Info, Cluster, BlockGroup
  let escala = 1_000_000; // TimecodeScale en ns
  let duracion = 0;
  let cluster = 0;
  let ultimo = -1;
  let primero = Infinity;
  let i = 0;
  for (let pasos = 0; i < b.length && pasos < 1_000_000; pasos++) {
    const id = vintEbml(b, i, true);
    const t = id && vintEbml(b, i + id.largo, false);
    if (!id || !t) break;
    const datos = i + id.largo + t.largo;
    if (ADENTRO.has(id.valor)) {
      i = datos;
      continue;
    }
    if (t.desconocido || datos + t.valor > b.length) break;
    if (id.valor === 0x2ad7b1) escala = uintBE(b, datos, t.valor) || escala;
    else if (id.valor === 0x4489) duracion = t.valor === 4 ? v.getFloat32(datos) : t.valor === 8 ? v.getFloat64(datos) : 0;
    else if (id.valor === 0xe7) cluster = uintBE(b, datos, t.valor);
    else if (id.valor === 0xa3 || id.valor === 0xa1) {
      const pista = vintEbml(b, datos, false);
      if (pista && datos + pista.largo + 2 <= b.length) {
        const marca = cluster + v.getInt16(datos + pista.largo);
        ultimo = Math.max(ultimo, marca);
        primero = Math.min(primero, marca);
      }
    }
    i = datos + t.valor;
  }
  const unidad = escala / 1e9;
  // El primer bloque puede venir un poco antes de 0 (el retardo del códec Opus, −7 ms): eso no alarga nada.
  const comienzo = Number.isFinite(primero) ? Math.max(0, primero) : 0;
  if (duracion > 0) return (duracion + 1 / unidad >= ultimo ? duracion - comienzo : duracion) * unidad;
  return ultimo > comienzo ? (ultimo - comienzo) * unidad : undefined;
}

/** Cajas de MP4 entre `desde` y `hasta`; la última se corta en `hasta` si dice ser más larga (archivo cortado). */
function cajasMp4(b: Uint8Array, v: DataView, desde: number, hasta: number, fn: (tipo: string, datos: number, fin: number) => void) {
  for (let i = desde, n = 0; i + 8 <= hasta && n < 100_000; n++) {
    let tam = v.getUint32(i);
    let cab = 8;
    if (tam === 1) {
      if (i + 16 > hasta) return;
      tam = Number(v.getBigUint64(i + 8));
      cab = 16;
    } else if (tam === 0) tam = hasta - i;
    if (tam < cab) return;
    const fin = Math.min(i + tam, hasta);
    fn(textoEn(b, i + 4, 4), i + cab, fin);
    i += tam;
  }
}

/**
 * MP4/M4A, por pista: lo que anota su mdhd y, si hay fragmentos (MP4 fragmentado, Safari), hasta el final del
 * último. Las muestras del moov parten en 0 y los fragmentos siguen después; sin muestras en el moov (mdhd en
 * 0), el audio parte en el tfdt del primer fragmento, que puede no ser 0. La pista manda sobre mvhd, que suma
 * los huecos de la lista de ediciones (un m4a que no parte en 0 trae un hueco inicial: mvhd dice 1260 s y la
 * pista 60 s); mvhd y mehd quedan para cuando no hay pistas que leer.
 */
function duracionMp4(b: Uint8Array, v: DataView): number | undefined {
  const u32 = (i: number) => (i + 4 <= b.length ? v.getUint32(i) : 0);
  const u64 = (i: number) => (i + 8 <= b.length ? Number(v.getBigUint64(i)) : 0);
  /** Duración de mvhd/mdhd/mehd (versión 0 o 1); 0 si no se sabe (todos los bits en 1). */
  const durCaja = (version: number, i: number) =>
    version === 1 ? (u32(i) === 0xffffffff && u32(i + 4) === 0xffffffff ? 0 : u64(i)) : u32(i) === 0xffffffff ? 0 : u32(i);
  let pelicula = 0; // mvhd
  const medios = new Map<number, number>(); // track_ID → duration de mdhd (en su timescale)
  let fragmentada = 0; // mehd
  let escalaPelicula = 0;
  const escalas = new Map<number, number>(); // track_ID → timescale (mdhd)
  const porOmision = new Map<number, number>(); // track_ID → default_sample_duration (trex)
  const fragmentos = new Map<number, { desde: number; hasta: number }>(); // track_ID → tfdt del primero y fin del último (en su timescale)
  cajasMp4(b, v, 0, b.length, (tipo, d, f) => {
    if (tipo === "moov")
      cajasMp4(b, v, d, f, (t2, d2, f2) => {
        if (t2 === "mvhd") {
          const ver = b[d2];
          escalaPelicula = ver === 1 ? u32(d2 + 20) : u32(d2 + 12);
          const dur = durCaja(ver, ver === 1 ? d2 + 24 : d2 + 16);
          if (escalaPelicula && dur) pelicula = dur / escalaPelicula;
        } else if (t2 === "mvex")
          cajasMp4(b, v, d2, f2, (t3, d3) => {
            if (t3 === "mehd") fragmentada = durCaja(b[d3], d3 + 4);
            if (t3 === "trex") porOmision.set(u32(d3 + 4), u32(d3 + 12));
          });
        else if (t2 === "trak") {
          let pista = 0;
          let escala = 0;
          let dur = 0;
          cajasMp4(b, v, d2, f2, (t3, d3, f3) => {
            if (t3 === "tkhd") pista = b[d3] === 1 ? u32(d3 + 20) : u32(d3 + 12);
            if (t3 === "mdia")
              cajasMp4(b, v, d3, f3, (t4, d4) => {
                if (t4 !== "mdhd") return;
                const ver = b[d4];
                escala = ver === 1 ? u32(d4 + 20) : u32(d4 + 12);
                dur = durCaja(ver, ver === 1 ? d4 + 24 : d4 + 16);
              });
          });
          if (escala) {
            escalas.set(pista, escala);
            medios.set(pista, dur);
          }
        }
      });
    else if (tipo === "moof")
      cajasMp4(b, v, d, f, (t2, d2, f2) => {
        if (t2 !== "traf") return;
        let pista = 0;
        let durOmision = 0;
        let base = -1;
        let suma = 0;
        cajasMp4(b, v, d2, f2, (t3, d3) => {
          if (t3 === "tfhd") {
            const flags = u32(d3) & 0xffffff;
            pista = u32(d3 + 4);
            const k = d3 + 8 + (flags & 0x01 ? 8 : 0) + (flags & 0x02 ? 4 : 0);
            durOmision = flags & 0x08 ? u32(k) : (porOmision.get(pista) ?? 0);
          } else if (t3 === "tfdt") base = b[d3] === 1 ? u64(d3 + 4) : u32(d3 + 4);
          else if (t3 === "trun") {
            const flags = u32(d3) & 0xffffff;
            const muestras = u32(d3 + 4);
            if (!(flags & 0x100)) suma += muestras * durOmision;
            else {
              const paso = 4 * [0x100, 0x200, 0x400, 0x800].filter((x) => flags & x).length;
              let k = d3 + 8 + (flags & 0x01 ? 4 : 0) + (flags & 0x04 ? 4 : 0);
              for (let m = 0; m < muestras && k + 4 <= b.length; m++, k += paso) suma += u32(k);
            }
          }
        });
        if (base < 0) return;
        const x = fragmentos.get(pista);
        fragmentos.set(pista, { desde: Math.min(x?.desde ?? base, base), hasta: Math.max(x?.hasta ?? 0, base + suma) });
      });
  });
  let pistas = 0;
  for (const pista of new Set([...escalas.keys(), ...fragmentos.keys()])) {
    const escala = escalas.get(pista) ?? [...escalas.values()][0] ?? 0;
    const enMoov = medios.get(pista) ?? 0;
    const x = fragmentos.get(pista);
    const ticks = x ? Math.max(enMoov, x.hasta) - (enMoov > 0 ? 0 : x.desde) : enMoov;
    if (escala) pistas = Math.max(pistas, ticks / escala);
  }
  if (pistas > 0) return pistas;
  if (pelicula > 0) return pelicula;
  if (fragmentada > 0 && escalaPelicula) return fragmentada / escalaPelicula;
  return undefined;
}

function duracionWav(b: Uint8Array, v: DataView): number | undefined {
  let porSegundo = 0;
  for (let i = 12, n = 0; i + 8 <= b.length && n < 1000; n++) {
    const id = textoEn(b, i, 4);
    const tam = v.getUint32(i + 4, true);
    const d = i + 8;
    if (id === "fmt " && d + 12 <= b.length) porSegundo = v.getUint32(d + 8, true);
    if (id === "data") {
      const datos = tam === 0 || tam === 0xffffffff ? b.length - d : Math.min(tam, b.length - d); // streaming: hasta el final
      return porSegundo ? datos / porSegundo : undefined;
    }
    i = d + tam + (tam & 1);
  }
  return undefined;
}

function duracionFlac(b: Uint8Array, v: DataView): number | undefined {
  if (b.length < 26 || (b[4] & 0x7f) !== 0) return undefined; // el primer bloque es STREAMINFO
  const tasa = (b[18] << 12) | (b[19] << 4) | (b[20] >> 4);
  const muestras = (b[21] & 0x0f) * 2 ** 32 + v.getUint32(22);
  return tasa && muestras ? muestras / tasa : undefined;
}

function duracionAiff(b: Uint8Array, v: DataView): number | undefined {
  for (let i = 12, n = 0; i + 8 <= b.length && n < 1000; n++) {
    const tam = v.getUint32(i + 4);
    const d = i + 8;
    if (textoEn(b, i, 4) === "COMM" && d + 18 <= b.length) {
      const cuadros = v.getUint32(d + 2);
      const exp = ((b[d + 8] & 0x7f) << 8) | b[d + 9]; // sampleRate: flotante extendido de 80 bits
      const tasa = (v.getUint32(d + 10) * 2 ** 32 + v.getUint32(d + 14)) * 2 ** (exp - 16383 - 63);
      return tasa > 0 ? cuadros / tasa : undefined;
    }
    i = d + tam + (tam & 1);
  }
  return undefined;
}

const KBPS_MP3: Record<string, number[]> = {
  "1-1": [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  "1-2": [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  "1-3": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  "2-1": [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  "2-2": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160], // capas II y III
};
const TASAS_MP3: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

interface CuadroMp3 {
  largo: number;
  muestras: number;
  tasa: number;
  mpeg1: boolean;
  clase: number; // versión, capa y tasa: no cambian dentro de un mismo archivo
}

/** La cabecera de cuadro MPEG audio en `i`, o null si no es una válida (sincronía, versión, capa, bitrate, tasa). */
function cuadroMp3(b: Uint8Array, i: number): CuadroMp3 | null {
  if (i + 4 > b.length || b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null;
  const ver = (b[i + 1] >> 3) & 3;
  const capa = 4 - ((b[i + 1] >> 1) & 3); // 1, 2 o 3
  const ib = b[i + 2] >> 4;
  const it = (b[i + 2] >> 2) & 3;
  if (ver === 1 || capa === 4 || ib === 0 || ib === 15 || it === 3) return null;
  const mpeg1 = ver === 3;
  const kbps = KBPS_MP3[mpeg1 ? `1-${capa}` : capa === 1 ? "2-1" : "2-2"][ib];
  const tasa = TASAS_MP3[ver][it];
  const relleno = (b[i + 2] >> 1) & 1;
  const muestras = capa === 1 ? 384 : capa === 2 || mpeg1 ? 1152 : 576;
  const largo = capa === 1 ? (Math.floor((12 * kbps * 1000) / tasa) + relleno) * 4 : Math.floor(((muestras / 8) * kbps * 1000) / tasa) + relleno;
  return largo < 4 ? null : { largo, muestras, tasa, mpeg1, clase: (ver << 4) | (capa << 2) | it };
}

/**
 * MP3: salta el ID3v2, busca un cuadro válido (con otro cuadro donde debe) y usa Xing/Info/VBRI. Sin ellos,
 * suma los cuadros hasta el final: el bitrate del primero sólo sirve en un CBR, y un VBR sin Xing (p. ej.
 * `-write_xing 0`) que parte con un cuadro chico salía con más del doble. Si los cuadros no cubren casi todo
 * el archivo (basura, otro formato), undefined.
 */
function duracionMp3(b: Uint8Array, v: DataView): number | undefined {
  let i = 0;
  if (textoEn(b, 0, 3) === "ID3" && b.length >= 10) i = 10 + (((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f)) + (b[5] & 0x10 ? 10 : 0);
  const tope = Math.min(b.length - 4, i + 65_536);
  for (; i < tope; i++) {
    const c = cuadroMp3(b, i);
    if (!c) continue;
    if (i + c.largo + 1 < b.length && (b[i + c.largo] !== 0xff || (b[i + c.largo + 1] & 0xe0) !== 0xe0)) continue;
    const mono = b[i + 3] >> 6 === 3;
    const x = i + 4 + (c.mpeg1 ? (mono ? 17 : 32) : mono ? 9 : 17);
    const marca = textoEn(b, x, 4);
    if ((marca === "Xing" || marca === "Info") && x + 12 <= b.length && v.getUint32(x + 4) & 1) return (v.getUint32(x + 8) * c.muestras) / c.tasa;
    if (textoEn(b, i + 36, 4) === "VBRI" && i + 54 <= b.length) return (v.getUint32(i + 50) * c.muestras) / c.tasa;
    return sumaCuadrosMp3(b, i, c);
  }
  return undefined;
}

function sumaCuadrosMp3(b: Uint8Array, desde: number, primero: CuadroMp3): number | undefined {
  const fin = b.length - (textoEn(b, b.length - 128, 3) === "TAG" ? 128 : 0); // ID3v1 al final
  const igual = (c: CuadroMp3 | null): c is CuadroMp3 => !!c && c.clase === primero.clase;
  let muestras = 0;
  let enCuadros = 0;
  let ultimo = desde; // fin del último cuadro contado
  let enSincronia = true; // después de un cuadro entero, el siguiente va pegado
  for (let i = desde; i + 4 <= fin; ) {
    const c = cuadroMp3(b, i);
    // Fuera de sincronía (basura en medio, un tag), un cuadro sólo vale si otro igual viene donde debe.
    if (igual(c) && i + c.largo <= fin && (enSincronia || i + c.largo === fin || igual(cuadroMp3(b, i + c.largo)))) {
      muestras += c.muestras;
      enCuadros += c.largo;
      i += c.largo;
      ultimo = i;
      enSincronia = true;
    } else {
      i++;
      enSincronia = false;
    }
  }
  // La cobertura se mide hasta el último cuadro, no hasta el final del archivo: así una etiqueta grande al
  // final (APEv2, ID3v2 con pie, Lyrics3, una carátula) no deja el audio sin duración. La basura con sólo un
  // par de cuadros válidos da una duración mínima, y la regla de los 6 Mbit/s de duracionAudio la descarta.
  return muestras && enCuadros >= 0.9 * (ultimo - desde) ? muestras / primero.tasa : undefined;
}

const TASAS_AAC = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

/** AAC en ADTS: suma los cuadros; si se cortan antes del final (basura), estima el resto por el tamaño. */
function duracionAdts(b: Uint8Array): number | undefined {
  let i = 0;
  let muestras = 0;
  let tasa = 0;
  while (i + 7 <= b.length && b[i] === 0xff && (b[i + 1] & 0xf6) === 0xf0) {
    const t = TASAS_AAC[(b[i + 2] >> 2) & 0xf];
    const largo = ((b[i + 3] & 3) << 11) | (b[i + 4] << 3) | (b[i + 5] >> 5);
    if (!t || largo < 7) break;
    tasa = t;
    muestras += 1024 * ((b[i + 6] & 3) + 1);
    i += largo;
  }
  if (!tasa || !muestras) return undefined;
  return (muestras / tasa) * Math.max(1, b.length / Math.min(i, b.length));
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
 * Cuerpo de generateContent, el mismo para los cuatro modelos por omisión. "low" sirve en 3.8 Flash, 3.6
 * Flash y 3.5/3.1 Flash-Lite ("minimal" da error en 3.8). Sin
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
  /** Qué corrida es (`intentos` del dictado, desde 1): fija cuándo se reintenta un «ocupado» (esperaOcupadoMs). */
  corrida?: number;
  reloj?: Reloj;
  log?: (linea: string) => void;
}

export type ResultadoPedido =
  | { tipo: "ok"; modelo: string; ms: number; datos: Record<string, unknown>; tokens: Tokens; pedidos: number; mime: string }
  | { tipo: "rescate"; transcripcion: string; modelo: string; pedidos: number }
  | { tipo: "error"; codigo: CodigoError; reintentable: boolean; proximo?: number; detalle: string; pedidos: number };

const acotar = (x: number, min: number, max: number) => Math.min(max, Math.max(min, x));

/** Por qué un modelo quedó fuera de la corrida: no existe (404), sin cuota del día o rechazó el pedido (400). */
type Fuera = "no_existe" | "cuota_dia" | "rechazo";
const FUERA: Record<Fuera, string> = { no_existe: "no existe", cuota_dia: "sin cuota del día", rechazo: "rechazó el pedido" };

/** Lo que se anota de cada pedido fallido en el resumen del registro: "ocupado 503", "modelo 404", "plazo agotado"… (corto: el resumen entero cabe en los 500 de sanear). */
const etiqueta = (f: Fallo) =>
  f.http ? `${f.codigo} ${f.http}` : f.codigo === "ocupado" ? (/plazo/.test(f.detalle) ? "plazo agotado" : "sin conexión") : f.codigo;

/**
 * Pide la receta con reintentos dentro del presupuesto `hasta` (y de MAX_PEDIDOS_CORRIDA). Nunca lanza.
 * Da vueltas por los modelos en orden de preferencia:
 * - Ocupado (503 «high demand», 500, 504, 408, 499, red o plazo) o 429 por minuto: el siguiente modelo de
 *   inmediato (la saturación y el cupo por minuto son de cada modelo). Recién después de probarlos todos,
 *   otra vuelta: si alguno estaba ocupado, después de ≈ 10 s (y ≈ 30 s en las siguientes); un 429 por
 *   minuto, nunca antes de lo que dijo Google (RetryInfo, 2–60 s, un poco más).
 * - Fuera de la corrida: 404 (no existe), cuota del día (su retryDelay engaña) y un 400 que no se entiende
 *   (p. ej. un modelo que no acepta algún campo): se sigue con los demás. Si ya no queda ninguno: cuota_dia
 *   hasta la medianoche del Pacífico si alguno se quedó sin cuota; si no, "interno" (todos dieron 404 o 400).
 * - 400 por responseFormat: se pasa a responseJsonSchema para todos (es la API la que no conoce el campo) y
 *   se repite; si vuelve, ese modelo queda fuera. Formato: una vez con el MIME alterno. Respuesta cortada:
 *   una vez con 32.768 tokens. JSON dañado: una vez más. Si no, se rescata la transcripción o queda
 *   "incompleta". Si después de un corte la corrida termina por algo pasajero, no se rescata: queda ocupado
 *   o cuota_dia (se reintenta solo).
 * - Clave, verificación, región, saldo, permiso, bloqueo y pedido demasiado grande: sin reintento.
 * - Se acabó el presupuesto o los pedidos con algún modelo ocupado: "ocupado", con `proximo` según la corrida
 *   (esperaOcupadoMs: 3 min después de la primera, después 10, 20 y 30).
 * El registro anota cada pedido fallido y, al final, un resumen con lo que pasó con cada modelo (saneado).
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
  let pasajero = false;
  let incompleta = false;
  let rescate: { transcripcion: string; modelo: string } | undefined;
  let detalle = "";
  const modelos = new Map(cfg.modelos.map((m) => [m, { fuera: undefined as Fuera | undefined, noAntesDe: 0, pasajeros: 0, pasos: [] as string[] }]));
  const vivo = (m: { fuera?: Fuera; pasajeros: number }) => !m.fuera && m.pasajeros < MAX_PASAJEROS_POR_MODELO;
  // Un 400 genérico con el mismo mensaje en dos modelos es un pedido mal armado (audio dañado, error del panel):
  // no se recorren los demás.
  let ultimoRechazo: string | undefined;
  const resumen = () =>
    [...modelos].map(([m, x]) => `${m}: ${x.pasos.join(", ") || "sin probar"}${x.fuera ? ` → fuera (${FUERA[x.fuera]})` : ""}`).join(" · ");
  /** Lo que se devuelve, con una línea de registro que dice qué pasó con cada modelo (si no salió al primer pedido). */
  const terminar = (r: ResultadoPedido): ResultadoPedido => {
    const como = r.tipo === "error" ? r.codigo : `${r.tipo} con ${r.modelo}`;
    const linea = sanear(`resumen (${pedidos} pedido${pedidos === 1 ? "" : "s"} → ${como}): ${resumen()}`, cfg.clave);
    if (r.tipo !== "ok" || pedidos > 1) log(`gemini ${linea}`);
    return r.tipo === "error" ? { ...r, detalle: linea } : r;
  };
  const error = (codigo: CodigoError, proximo?: number): ResultadoPedido =>
    terminar({ tipo: "error", codigo, reintentable: esReintentable(codigo), ...(proximo ? { proximo } : {}), detalle, pedidos });

  try {
    todo: for (let vuelta = 1; ; vuelta++) {
      let algunoOcupado = false;
      for (const [modelo, m] of modelos) {
        if (!vivo(m)) continue;
        // Mismo modelo otra vez sólo por el pedido (otra forma de salida, el MIME alterno, más tokens, JSON
        // dañado); por Google ocupado, se pasa al siguiente.
        for (;;) {
          if (pedidos >= MAX_PEDIDOS_CORRIDA || reloj.ahora() > op.hasta - MARGEN_MS) {
            pasajero = true;
            break todo;
          }
          pedidos++;
          const t0 = reloj.ahora();
          const parts = partesGenerateContent([{ datos: base64, mime, nombreArchivo: audio.archivo }], { fecha: audio.fecha });
          const plazo = Math.min(cfg.timeoutMs, Math.max(1_000, op.hasta - t0));
          const r = await intento(cfg, modelo, cuerpoPedido(parts, forma, maxTokens), plazo);
          if (r.tipo === "ok") {
            m.pasos.push("ok");
            return terminar({ tipo: "ok", modelo, ms: reloj.ahora() - t0, datos: r.datos, tokens: r.tokens, pedidos, mime });
          }
          if (r.tipo === "corte" || r.tipo === "json") {
            detalle = sanear(`${modelo}: ${r.detalle}`, cfg.clave);
            m.pasos.push(r.tipo);
            log(sanear(`gemini ${modelo} (vuelta ${vuelta}): ${r.tipo} (${r.detalle})`, cfg.clave));
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
            break todo;
          }
          const f = r.fallo;
          detalle = sanear(`${modelo}: ${f.codigo} ${f.detalle}`, cfg.clave);
          m.pasos.push(etiqueta(f));
          log(sanear(`gemini ${modelo} (vuelta ${vuelta}): ${f.codigo} ${f.detalle}`, cfg.clave));
          switch (f.codigo) {
            case "campo":
              if (forma === "responseFormat") {
                forma = "responseJsonSchema";
                continue;
              }
              m.fuera = "rechazo";
              break;
            case "formato":
              if (audio.mimeAlterno && !alternoUsado) {
                alternoUsado = true;
                mime = audio.mimeAlterno;
                continue;
              }
              return error("formato");
            case "ocupado":
              pasajero = true;
              algunoOcupado = true;
              m.pasajeros++;
              break;
            case "cuota_minuto":
              pasajero = true;
              m.pasajeros++;
              // Nunca antes de lo que dijo Google (y un poco más, para no llegar justo).
              m.noAntesDe = reloj.ahora() + Math.round(acotar(f.esperaMs ?? 20_000, 2_000, 60_000) * (1 + Math.random() * 0.2));
              break;
            case "cuota_dia":
              m.fuera = "cuota_dia";
              break;
            case "modelo":
              m.fuera = "no_existe";
              break;
            case "peticion":
              if (ultimoRechazo !== undefined && ultimoRechazo === f.detalle) return error("interno");
              ultimoRechazo = f.detalle;
              m.fuera = "rechazo";
              break;
            case "bloqueo":
              return error("bloqueado");
            case "clave_invalida":
            case "verificacion":
            case "region":
            case "permiso":
              return error(f.codigo);
            case "pago":
              return error("sin_saldo");
            default: // grande: el mismo pedido no cabe en ningún modelo (error del panel)
              return error("interno");
          }
          break; // al siguiente modelo
        }
      }
      // Se probaron todos los que quedan: otra vuelta, si hay a quién y alcanza.
      const quedan = [...modelos.values()].filter(vivo);
      if (!quedan.length) break;
      const ahora = reloj.ahora();
      const espera = Math.max(
        algunoOcupado ? jitter(ESPERAS_VUELTA_MS[Math.min(vuelta, ESPERAS_VUELTA_MS.length) - 1]) : 0,
        ...quedan.map((m) => m.noAntesDe - ahora),
      );
      if (pedidos >= MAX_PEDIDOS_CORRIDA || ahora + espera + MARGEN_MS >= op.hasta) {
        pasajero = true;
        break;
      }
      log(`gemini vuelta ${vuelta}: ${quedan.length === 1 ? "el modelo que queda no respondió" : `ninguno de los ${quedan.length} modelos que quedan respondió`}; otra vuelta en ${Math.round(Math.max(0, espera) / 1000)} s`);
      if (espera > 0) await reloj.dormir(espera);
    }
  } catch (e) {
    detalle = sanear(`falla inesperada: ${String((e as Error)?.message ?? e)}`, cfg.clave);
    log(`gemini ${detalle}`);
    return error("interno");
  }
  // El rescate (borrador sin ingredientes ni pasos) es sólo para cuando Gemini cortó o dañó la respuesta las
  // veces que se le pidió. Si la corrida terminó por algo pasajero (ocupado, cuota, presupuesto), queda el
  // error y la app reintenta sola: la próxima vez puede salir la receta entera.
  if (rescate && incompleta) return terminar({ tipo: "rescate", transcripcion: rescate.transcripcion, modelo: rescate.modelo, pedidos });
  if (incompleta) return error("incompleta");
  const fuera = [...modelos.values()].map((m) => m.fuera);
  // Quedan modelos: se cortó por el presupuesto o el tope de pedidos con ellos ocupados (o con cupo por minuto).
  if (pasajero && fuera.some((x) => !x)) return error("ocupado", reloj.ahora() + esperaOcupadoMs(op.corrida ?? 1));
  if (fuera.includes("cuota_dia")) return error("cuota_dia", reinicioCuota(reloj.ahora()));
  return error("interno"); // todos dieron 404 o 400: GEMINI_MODELOS mal escrito, modelos retirados o un pedido mal armado
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
