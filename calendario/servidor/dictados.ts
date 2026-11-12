// "🎙️ Dictar receta" en el servidor: el audio se guarda en la nube ANTES de pedirle nada a Gemini, una
// función en segundo plano (hasta 15 min) le pide la receta, y el borrador queda para que la familia lo
// revise. La API (netlify/functions/api-dictados.mts) y la corrida (dictados-proceso-background.mts) son
// sólo `manejarApi(depsReales())` y `manejarProceso(depsReales())`: las pruebas usan otro reloj, otro env y
// otro disparo (pruebas/recetas/dictados.test.ts).
//
// Blobs:
//   almacén "calendario" (comun.ts)   dictados/<familia>/<id>  → Dictado; existe sólo hasta que se guarda o descarta
//   almacén "audios" (consistencia fuerte)
//                                     <familia>/<id>           → los bytes, metadata {mime, mimeReproducir, sha256, segundos, equipo, subido}
//                                     <familia>/<id>.texto     → {transcripcion, modelo, fecha, segundos, recetaId}: se escribe al guardar
//                                                                 (sólo si la receta ya está en la colección «recetas»; si el
//                                                                 POST /guardado no llegó, lo completa DELETE ?borrador=1)
//
// Duración: el tope de 15 minutos sale de los bytes del audio cuando se puede (gemini.ts, duracionAudio); si
// no, de `?segundos=` del equipo; y si no hay ninguna, el audio no puede pasar de MAX_AUDIO_SIN_DURACION.
// Si el equipo mandó `?segundos=`, los bytes son sólo un tope de seguridad, con más margen (TOLERANCIA_CON_EQUIPO).
//
// «Pedir otra versión»: el borrador, la transcripción y lo demás quedan en `anterior` mientras Gemini vuelve
// a escuchar. Si la corrida termina bien, se reemplazan; si falla, vuelven (estado listo, con el `error`).
//
// Concurrencia: los cambios al registro son de lectura-cambio-escritura con ETag (cambiarDictado). La corrida
// "toma" el dictado con un turno y un plazo (cerca): sólo el dueño del turno escribe el resultado, así que dos
// disparos a la vez hacen un solo pedido, y un dictado descartado mientras Gemini escucha no revive.
//
// Errores: los problemas de Gemini nunca salen como 401 (desconectaría el equipo) ni 5xx (la app lo toma
// como "sin conexión"): quedan en `dictado.error`. "No existe" es 410 (en netlify dev un 404 cae a index.html).

import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";
import { adivinarCategoria } from "../lib/compras";
import {
  ID_DICTADO,
  MAX_AUDIO,
  MAX_AUDIO_SIN_DURACION,
  MAX_PENDIENTES,
  MAX_SEGUNDOS,
  RECETA_NO_GUARDADA,
  type CodigoError,
  type DictadoPublico,
  type ErrorDictado,
  type ListaDictados,
  type MotivoRechazo,
  type RespuestaDescartar,
  type RespuestaProbar,
  type TextoDictado,
} from "../lib/dictados/tipos";
import { almacen, autenticar, conCandado, error, idAzar, json, leerColeccion, leerJSON, type Sesion } from "./comun";
import { configGemini, detectarAudio, duracionAudio, estadoGemini, pedirReceta, probarClave, relojReal, sanear, type Reloj } from "./gemini";
import { aRecetaApp, borradorRescate, normalizar, type BorradorReceta } from "./receta-ia/normalizar-receta";

export { ID_DICTADO, MAX_AUDIO, MAX_AUDIO_SIN_DURACION, MAX_PENDIENTES, MAX_SEGUNDOS };
/** Margen sobre MAX_SEGUNDOS para la duración que se lee de los bytes (la grabadora corta justo en 900 s). */
export const TOLERANCIA_SEGUNDOS = 10;
/**
 * Con `?segundos=` del equipo (que ya pasó el tope de 900), los bytes sólo atajan un audio claramente más largo:
 * 900 s + 10 %. Así una lectura del contenedor que se pasa un poco no rechaza un audio bueno con un 413 sin
 * reintento.
 */
export const TOLERANCIA_CON_EQUIPO = 90;
/** La corrida es dueña del dictado hasta aquí (la función en segundo plano dura hasta 15 min). */
export const PLAZO_CORRIDA_MS = 14 * 60_000;
/** Tiempo total para hablar con Gemini en una corrida (reintentos y esperas incluidos). */
export const PRESUPUESTO_MS = 12 * 60_000;

export const almacenAudios = () => getStore({ name: "audios", consistency: "strong" });
export const claveDictado = (f: string, id: string) => `dictados/${f}/${id}`;
const prefijoDictados = (f: string) => `dictados/${f}/`;
export const claveAudio = (f: string, id: string) => `${f}/${id}`;
export const claveTexto = (f: string, id: string) => `${f}/${id}.texto`;

/** Lo que trae una corrida que terminó bien (y lo que «Pedir otra versión» guarda en `anterior`). */
const CAMPOS_VERSION = ["borrador", "avisos", "revisar", "transcripcion", "esReceta", "motivo", "modelo", "ms", "rescate"] as const;
export type VersionDictado = Pick<DictadoPublico, (typeof CAMPOS_VERSION)[number]>;

/** Lo guardado en Blobs. Lo que no está en DictadoPublico nunca sale a los equipos (ver vista()). */
export interface Dictado extends Omit<DictadoPublico, "nombre" | "emoji"> {
  familiaId: string;
  sha256: string;
  mimeAlterno?: string; // si Gemini rechaza `mime` (audio/m4a → audio/mp4, audio/ogg → audio/opus)
  mimeReproducir: string; // content-type para escucharlo en el equipo
  turno?: string; // corrida dueña (cerca)
  plazo?: number; // epoch ms: hasta cuándo es dueña
  anterior?: VersionDictado; // el borrador de antes de «Pedir otra versión», hasta que llegue el nuevo
}

const sinVersion = Object.fromEntries(CAMPOS_VERSION.map((k) => [k, undefined])) as Record<(typeof CAMPOS_VERSION)[number], undefined>;
const versionDe = (d: Dictado): VersionDictado => Object.fromEntries(CAMPOS_VERSION.map((k) => [k, d[k]])) as VersionDictado;

/**
 * El dictado con este error. Si venía de «Pedir otra versión» (hay `anterior`), vuelve el borrador de antes
 * (estado listo) y el error queda como aviso: un fallo de Gemini no borra lo que ya se tenía.
 */
function conError(d: Dictado, err: ErrorDictado, cuando: string): Dictado {
  const n: Dictado = { ...d, estado: "error", error: err, turno: undefined, plazo: undefined, actualizado: cuando };
  return d.anterior ? { ...n, ...d.anterior, estado: "listo", anterior: undefined } : n;
}

export interface DepsDictados {
  reloj: Reloj;
  env: Record<string, string | undefined>;
  /** Dispara la función en segundo plano (POST {base}/api/dictados-proceso con el mismo token). true si respondió 202. */
  disparar: (base: string, auth: string, id: string) => Promise<boolean>;
  log?: (linea: string) => void;
}

const iso = (ms: number) => new Date(ms).toISOString();
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

// ---------- Registro (lectura y escritura condicional) ----------

export async function leerDictado(f: string, id: string): Promise<{ d: Dictado; etag?: string } | null> {
  const r = await almacen().getWithMetadata(claveDictado(f, id), { type: "json" });
  return r ? { d: r.data as Dictado, etag: r.etag } : null;
}

/**
 * Cambia un registro sin pisar otro cambio: lee con ETag, aplica `fn` (null = no cambiar; recibe null si no
 * existe) y escribe sólo si nadie escribió entre medio (onlyIfMatch, u onlyIfNew si no existía). Hasta 5
 * intentos. Sin ETag (el simulador local de Netlify no lo entrega) lo hace dentro de conCandado.
 * Devuelve lo que quedó: `escrito` y el registro nuevo, o el que había si `fn` dijo que no.
 */
export async function cambiarDictado(
  f: string,
  id: string,
  fn: (d: Dictado | null) => Dictado | null,
): Promise<{ escrito: boolean; d: Dictado | null }> {
  const store = almacen();
  const k = claveDictado(f, id);
  for (let i = 0; i < 5; i++) {
    const actual = await store.getWithMetadata(k, { type: "json" });
    const previo = (actual?.data as Dictado | undefined) ?? null;
    if (actual && !actual.etag) {
      return conCandado(k, async () => {
        const ahora = (await store.get(k, { type: "json" })) as Dictado | null;
        const n = fn(ahora);
        if (!n) return { escrito: false, d: ahora };
        await store.setJSON(k, n);
        return { escrito: true, d: n };
      });
    }
    const n = fn(previo);
    if (!n) return { escrito: false, d: previo };
    const r = actual?.etag ? await store.setJSON(k, n, { onlyIfMatch: actual.etag }) : await store.setJSON(k, n, { onlyIfNew: true });
    if (r.modified) return { escrito: true, d: n };
  }
  throw new Error("No se pudo actualizar el dictado (demasiados cambios simultáneos)");
}

/** Borra el registro (dentro del candado si no hay ETag, para que una corrida no lo reviva). */
async function borrarRegistro(f: string, id: string) {
  const store = almacen();
  const k = claveDictado(f, id);
  const m = await store.getMetadata(k);
  if (m && !m.etag) return conCandado(k, () => store.delete(k));
  await store.delete(k);
}

// ---------- Lo que ven los equipos ----------

/**
 * Nunca entrega turno, plazo, sha256 ni familiaId. Un "procesando" con el plazo vencido se muestra como
 * error se_corto (sin escribir nada). `completo` agrega borrador, avisos, revisar y transcripción.
 */
export function vista(d: Dictado, ahora: number, completo: boolean): DictadoPublico {
  const v: DictadoPublico = {
    id: d.id,
    estado: d.estado,
    creado: d.creado,
    actualizado: d.actualizado,
    equipoId: d.equipoId,
    mime: d.mime,
    bytes: d.bytes,
    segundos: d.segundos,
    archivo: d.archivo,
    origen: d.origen,
    intentos: d.intentos,
    modelo: d.modelo,
    ms: d.ms,
    nombre: d.borrador?.nombre ?? d.anterior?.borrador?.nombre,
    emoji: d.borrador?.emoji ?? d.anterior?.borrador?.emoji,
    esReceta: d.esReceta,
    motivo: d.motivo,
    rescate: d.rescate === true ? true : undefined,
    error: d.error,
  };
  if (d.estado === "procesando" && (d.plazo ?? 0) < ahora) {
    v.estado = "error";
    v.error = { codigo: "se_corto", reintentable: true };
  }
  if (completo) {
    v.borrador = d.borrador;
    v.avisos = d.avisos;
    v.revisar = d.revisar;
    v.transcripcion = d.transcripcion;
  }
  return JSON.parse(JSON.stringify(v)) as DictadoPublico; // sin claves undefined
}

const noExiste = () => json({ error: "Esta receta dictada ya no existe.", existe: false }, 410);
/** 409 de la subida, con `motivo` para que el equipo sepa qué hacer con su copia (ver MotivoRechazo). */
const rechazo = (mensaje: string, motivo: MotivoRechazo) => json({ error: mensaje, motivo }, 409);
const OTRO_AUDIO = "Ese identificador ya se usó para otro audio.";
const MENSAJE_GRANDE = "El audio es muy grande: el máximo son 4 MB (unos 15 minutos grabando aquí). Graba uno más corto o divídelo en dos.";
const MENSAJE_LARGO = "El audio dura más de 15 minutos. Graba uno más corto o divídelo en dos.";
const MENSAJE_SIN_DURACION =
  "No se pudo saber cuánto dura este audio y pesa más de 1,8 MB, así que podría pasar de 15 minutos. Prueba con un m4a o mp3, o graba uno más corto aquí en el panel.";

const limpiarArchivo = (x: string | null) =>
  (x ?? "")
    .replace(/[\u0000-\u001f\u007f<>\\/]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || undefined;

/** "9 de noviembre de 2026" (pista para Gemini). */
function fechaLarga(isoFecha: string): string | undefined {
  const t = Date.parse(isoFecha);
  if (!Number.isFinite(t)) return undefined;
  return new Date(t).toLocaleDateString("es-CL", { timeZone: "America/Santiago", day: "numeric", month: "long", year: "numeric" });
}

// ---------- API: /api/dictados ----------

/**
 * PUT    /api/dictados/:id?segundos=&archivo=&origen=   cuerpo = bytes del audio      → 201 {dictado} (200 si ya estaba; 409 {error, motivo})
 * POST   /api/dictados/:id/procesar {otraVez?}          "Intentar de nuevo" / "Pedir otra versión" → 202 {dictado}
 * GET    /api/dictados                                  → {dictados, gemini}
 * GET    /api/dictados/:id                              → {dictado} completo
 * GET    /api/dictados/:id/audio                        → los bytes (content-type para reproducir)
 * GET    /api/dictados/:id/texto                        → {transcripcion, modelo, fecha, segundos}
 * POST   /api/dictados/:id/guardado {recetaId}          ya se guardó la receta: queda el texto y el audio
 *                                                       (409 {codigo: RECETA_NO_GUARDADA} si la colección «recetas» no la tiene aún)
 * DELETE /api/dictados/:id?borrador=1                   descartar un borrador; si la receta ya se guardó (.texto, o rec_<id>
 *                                                       en la colección «recetas») → {ok, guardada: true} sin borrar el audio
 *                                                       ni lo que se dijo
 * DELETE /api/dictados/:id                              quitar el audio de una receta guardada o borrarla: borra registro, audio y texto
 * POST   /api/dictados/probar                           → {gemini: "ok", modelo} | {gemini: código} (no gasta cuota)
 */
export function manejarApi(deps: DepsDictados) {
  const log = deps.log ?? ((l: string) => console.log(l));
  return async (req: Request, context?: { site?: { url?: string } }): Promise<Response> => {
    try {
      return await atender(req, context, deps);
    } catch (e) {
      log(`api-dictados: ${sanear(String((e as Error)?.message ?? e), deps.env.GEMINI_API_KEY)}`);
      return error("No se pudo completar el pedido en la nube. Inténtalo de nuevo.", 503);
    }
  };
}

async function atender(req: Request, context: { site?: { url?: string } } | undefined, deps: DepsDictados): Promise<Response> {
  const s = await autenticar(req);
  if (s instanceof Response) return s;
  const ahora = deps.reloj.ahora();
  const partes = new URL(req.url).pathname.replace(/\/+$/, "").split("/").slice(3); // "", "api", "dictados", …
  const [id, accion, ...sobra] = partes;
  const base = (deps.env.URL || context?.site?.url || "").replace(/\/+$/, "");
  const auth = req.headers.get("authorization") ?? "";
  const disparar = async (idDictado: string) => {
    if (!base) return false;
    try {
      return await deps.disparar(base, auth, idDictado);
    } catch {
      return false;
    }
  };

  if (!id) {
    if (req.method !== "GET") return error("Método no permitido", 405);
    return listar(s.familiaId, ahora, deps);
  }
  if (id === "probar" && !accion) {
    if (req.method !== "POST") return error("Método no permitido", 405);
    const r = await probarClave(configGemini(deps.env));
    const cuerpo: RespuestaProbar = r.ok ? { gemini: "ok", modelo: r.modelo } : { gemini: r.codigo as Exclude<CodigoError, "se_corto" | "audio_perdido"> };
    return json(cuerpo);
  }
  if (!ID_DICTADO.test(id) || sobra.length) return error("Pedido inválido", 400);

  if (req.method === "PUT" && !accion) return subir(req, s, id, ahora, deps, disparar);
  if (req.method === "POST" && accion === "procesar") return procesar(req, s.familiaId, id, ahora, deps, disparar);
  if (req.method === "GET" && !accion) {
    const leido = await leerDictado(s.familiaId, id);
    return leido ? json({ dictado: vista(leido.d, ahora, true) }) : noExiste();
  }
  if (req.method === "GET" && accion === "audio") return audio(s.familiaId, id);
  if (req.method === "GET" && accion === "texto") return texto(s.familiaId, id);
  if (req.method === "POST" && accion === "guardado") return guardado(req, s.familiaId, id);
  if (req.method === "DELETE" && !accion) return descartar(s.familiaId, id, new URL(req.url).searchParams.get("borrador") === "1");
  return error("Método no permitido", 405);
}

async function listar(f: string, ahora: number, deps: DepsDictados) {
  const { blobs } = await almacen().list({ prefix: prefijoDictados(f) });
  const todos = await Promise.all(blobs.map((b) => almacen().get(b.key, { type: "json" }) as Promise<Dictado | null>));
  const dictados = todos
    .filter((d): d is Dictado => !!d && typeof d === "object" && typeof d.id === "string")
    .map((d) => vista(d, ahora, false))
    .sort((a, b) => b.creado.localeCompare(a.creado) || b.id.localeCompare(a.id));
  const cuerpo: ListaDictados = { dictados, gemini: estadoGemini(deps.env) };
  return json(cuerpo);
}

async function subir(req: Request, s: Sesion, id: string, ahora: number, deps: DepsDictados, disparar: (id: string) => Promise<boolean>) {
  const f = s.familiaId;
  const q = new URL(req.url).searchParams;
  const seg = Number(q.get("segundos"));
  const segundosEquipo = Number.isFinite(seg) && seg > 0 ? Math.round(seg) : undefined;
  if (Number(req.headers.get("content-length")) > MAX_AUDIO) return error(MENSAJE_GRANDE, 413);
  const crudo = await req.arrayBuffer();
  const bytes = new Uint8Array(crudo);
  if (!bytes.byteLength) return error("Llegó un audio vacío", 400);
  if (bytes.byteLength > MAX_AUDIO) return error(MENSAJE_GRANDE, 413);
  if (segundosEquipo && segundosEquipo > MAX_SEGUNDOS) return error(MENSAJE_LARGO, 413);
  const tipo = detectarAudio(bytes.subarray(0, 64));
  if (!tipo.ok) return error(tipo.mensaje, 415);
  // Los bytes atajan lo que el equipo no sabe o dice mal (WebM de MediaRecorder, .opus en un navegador que no
  // lo lee): sin ?segundos= mandan ellos (900 s + 10 s); con ?segundos=, sólo atajan un audio claramente más
  // largo (900 s + 10 %), por si la lectura del contenedor se pasa un poco. Sin ninguna de las dos, un tope por tamaño.
  const segundosAudio = duracionAudio(bytes);
  const tope = MAX_SEGUNDOS + (segundosEquipo != null ? TOLERANCIA_CON_EQUIPO : TOLERANCIA_SEGUNDOS);
  if (segundosAudio != null && segundosAudio > tope) return error(MENSAJE_LARGO, 413);
  if (segundosAudio == null && segundosEquipo == null && bytes.byteLength > MAX_AUDIO_SIN_DURACION) return error(MENSAJE_SIN_DURACION, 413);
  const segundos = segundosEquipo ?? (segundosAudio != null ? Math.max(1, Math.round(segundosAudio)) : undefined);
  const huella = sha256(bytes);
  const mismo = (d: Dictado) => d.sha256 === huella && d.bytes === bytes.byteLength;
  const archivo = limpiarArchivo(q.get("archivo"));
  const origen: Dictado["origen"] = q.get("origen") === "archivo" || (q.get("origen") !== "grabacion" && !!archivo) ? "archivo" : "grabacion";

  // Subida idempotente: el id lo genera el equipo, así que un reintento no duplica.
  const previo = await leerDictado(f, id);
  if (previo) return mismo(previo.d) ? json({ dictado: vista(previo.d, ahora, false) }) : rechazo(OTRO_AUDIO, "otro_audio");
  if (await almacenAudios().getMetadata(claveTexto(f, id))) return rechazo("Esta receta dictada ya se guardó en Recetas.", "ya_guardada");
  const { blobs } = await almacen().list({ prefix: prefijoDictados(f) });
  if (blobs.length >= MAX_PENDIENTES)
    return rechazo(`Hay ${MAX_PENDIENTES} recetas dictadas sin revisar. Revisa o descarta algunas en Recetas → 🎙️ Dictadas.`, "lleno");

  // Primero el audio: si algo falla después, lo grabado no se pierde.
  const cuando = iso(ahora);
  await almacenAudios().set(claveAudio(f, id), crudo, {
    metadata: { mime: tipo.mime, mimeReproducir: tipo.reproducir, sha256: huella, segundos: segundos ?? 0, equipo: s.equipoId, subido: cuando },
  });
  const cfg = configGemini(deps.env);
  const nuevo: Dictado = {
    id,
    familiaId: f,
    estado: cfg.ok ? "subido" : "error",
    creado: cuando,
    actualizado: cuando,
    equipoId: s.equipoId,
    mime: tipo.mime,
    ...(tipo.alterno ? { mimeAlterno: tipo.alterno } : {}),
    mimeReproducir: tipo.reproducir,
    bytes: bytes.byteLength,
    sha256: huella,
    ...(segundos ? { segundos } : {}),
    ...(archivo ? { archivo } : {}),
    origen,
    intentos: 0,
    ...(cfg.ok ? {} : { error: { codigo: cfg.motivo, reintentable: true } }),
  };
  const r = await cambiarDictado(f, id, (d) => (d ? null : nuevo));
  if (!r.escrito) {
    // Otro pedido con el mismo id ganó la carrera.
    return r.d && mismo(r.d) ? json({ dictado: vista(r.d, ahora, false) }) : rechazo(OTRO_AUDIO, "otro_audio");
  }
  if (nuevo.estado === "subido") await disparar(id);
  return json({ dictado: vista(nuevo, ahora, false) }, 201);
}

async function procesar(req: Request, f: string, id: string, ahora: number, deps: DepsDictados, disparar: (id: string) => Promise<boolean>) {
  const otraVez = (await leerJSON(req))?.otraVez === true;
  const leido = await leerDictado(f, id);
  if (!leido) return noExiste();
  const enCurso = (d: Dictado) => d.estado === "procesando" && (d.plazo ?? 0) > ahora;
  if (leido.d.estado === "listo" && !otraVez) return json({ dictado: vista(leido.d, ahora, true) });
  if (enCurso(leido.d)) return json({ dictado: vista(leido.d, ahora, true) }, 202);

  const cfg = configGemini(deps.env);
  if (!cfg.ok) {
    const err: ErrorDictado = { codigo: cfg.motivo, reintentable: true };
    // Un borrador listo no se pierde por pedir otra versión sin clave: sólo se avisa.
    if (leido.d.estado === "listo") return json({ dictado: { ...vista(leido.d, ahora, true), error: err } });
    const r = await cambiarDictado(f, id, (d) => (d && !enCurso(d) && d.estado !== "listo" ? conError(d, err, iso(ahora)) : null));
    return r.d ? json({ dictado: vista(r.d, ahora, true) }) : noExiste();
  }

  const r = await cambiarDictado(f, id, (d) => {
    if (!d || enCurso(d) || (d.estado === "listo" && !otraVez)) return null;
    const enCola: Dictado = { ...d, estado: "subido", error: undefined, turno: undefined, plazo: undefined, actualizado: iso(ahora) };
    // «Pedir otra versión» de un borrador: queda guardado en `anterior` hasta que llegue el nuevo.
    if (otraVez && d.estado === "listo") return { ...enCola, ...sinVersion, anterior: versionDe(d) };
    return enCola; // reintento: si había un `anterior` (otra versión que se cortó), sigue ahí
  });
  if (!r.d) return noExiste();
  if (!r.escrito) return json({ dictado: vista(r.d, ahora, true) }, enCurso(r.d) ? 202 : 200);
  await disparar(id);
  return json({ dictado: vista(r.d, ahora, true) }, 202);
}

async function audio(f: string, id: string) {
  const a = await almacenAudios().getWithMetadata(claveAudio(f, id), { type: "arrayBuffer" });
  if (!a) return json({ error: "El audio se borró", existe: false }, 410);
  const tipo = String(a.metadata?.mimeReproducir ?? "");
  return new Response(a.data, {
    status: 200,
    headers: {
      "content-type": /^audio\/[a-z0-9.+-]+$/.test(tipo) ? tipo : "application/octet-stream",
      "content-length": String(a.data.byteLength),
      "cache-control": "private, max-age=86400",
    },
  });
}

async function texto(f: string, id: string) {
  const t = (await almacenAudios().get(claveTexto(f, id), { type: "json" })) as TextoDictado | null;
  if (t) return json(t);
  const leido = await leerDictado(f, id);
  const d = leido?.d;
  const v = d?.transcripcion ? d : d?.anterior; // mientras se pide otra versión, lo que se dijo sigue disponible
  if (!d || !v?.transcripcion) return noExiste();
  const cuerpo: TextoDictado = { transcripcion: v.transcripcion, modelo: v.modelo, fecha: d.creado, segundos: d.segundos };
  return json(cuerpo);
}

/** ¿La colección «recetas» de la familia ya tiene esta receta? (el PUT de la colección pudo no llegar todavía). */
async function recetaGuardada(f: string, recetaId: string): Promise<boolean> {
  const c = await leerColeccion(f, "recetas");
  return Array.isArray(c?.datos) && c.datos.some((r) => !!r && typeof r === "object" && (r as { id?: unknown }).id === recetaId);
}

/**
 * Lo que hace POST /guardado una vez que la receta está en la colección: queda el .texto (lo que se dijo, para
 * la receta) y se borra el registro. Mientras se pide otra versión, lo que se dijo está en `anterior`.
 */
async function completarGuardado(f: string, id: string, d: Dictado, recetaId: string) {
  const v = d.transcripcion ? d : (d.anterior ?? d);
  const t: TextoDictado = { transcripcion: v.transcripcion ?? "", modelo: v.modelo, fecha: d.creado, segundos: d.segundos, recetaId };
  await almacenAudios().setJSON(claveTexto(f, id), t);
  await borrarRegistro(f, id);
}

/**
 * DELETE. `borrador`: el equipo descarta un BORRADOR (la revisión, la lista, la pantalla de dictar). Si la
 * receta ya se guardó, no se borran ni su audio ni lo que se dijo: sólo el registro que sobra, y se responde
 * `guardada: true`. Guardada es que haya .texto (quizás desde otro equipo que el de la revisión vieja no vio)
 * o que la colección «recetas» ya tenga rec_<id> aunque el POST /guardado no haya llegado (falló o se cortó
 * la red justo después del PUT de la colección): entonces se completa aquí ese guardado.
 * Sin `borrador` (quitar el audio de una receta guardada, borrar la receta) se borra todo.
 */
async function descartar(f: string, id: string, borrador: boolean) {
  const guardada = () => json({ ok: true, guardada: true } satisfies RespuestaDescartar);
  if (borrador) {
    if (await almacenAudios().getMetadata(claveTexto(f, id))) {
      await borrarRegistro(f, id);
      return guardada();
    }
    const recetaId = `rec_${id}`;
    if (await recetaGuardada(f, recetaId)) {
      const leido = await leerDictado(f, id);
      if (leido) await completarGuardado(f, id, leido.d, recetaId);
      return guardada();
    }
  }
  await borrarRegistro(f, id);
  await Promise.all([almacenAudios().delete(claveAudio(f, id)), almacenAudios().delete(claveTexto(f, id))]);
  const cuerpo: RespuestaDescartar = { ok: true };
  return json(cuerpo);
}

async function guardado(req: Request, f: string, id: string) {
  const b = await leerJSON(req);
  const recetaId = typeof b?.recetaId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(b.recetaId) ? b.recetaId : null;
  if (!recetaId) return error("Pedido inválido", 400);
  const leido = await leerDictado(f, id);
  if (!leido) return json({ ok: true }); // ya se guardó (o se descartó): idempotente
  const d = leido.d;
  if (d.estado !== "listo") return error("Todavía no está listo", 409);
  // Sólo con la receta de verdad en la nube: si el PUT de la colección falló y este POST llegó, borrar el
  // registro dejaría la revisión sin camino de vuelta. El equipo lo vuelve a intentar más tarde.
  if (!(await recetaGuardada(f, recetaId))) return json({ error: "La receta todavía no está guardada en Recetas.", codigo: RECETA_NO_GUARDADA }, 409);
  await completarGuardado(f, id, d, recetaId);
  return json({ ok: true });
}

// ---------- Corrida en segundo plano ----------

export type ResultadoCorrida = "listo" | "error" | "nada" | "perdio" | "descartado";

/**
 * Toma el dictado (turno + plazo con ETag), le pide la receta a Gemini y escribe el resultado sólo si el
 * turno sigue siendo suyo. Nunca lanza: lo inesperado termina en error "interno" (reintentable).
 *   nada: no existe, ya está listo o con error, o hay otra corrida vigente · perdio: otra corrida lo tomó ·
 *   descartado: lo borraron mientras Gemini escuchaba.
 */
export async function correrDictado(f: string, id: string, deps: DepsDictados): Promise<ResultadoCorrida> {
  const log = deps.log ?? ((l: string) => console.log(l));
  const clave = deps.env.GEMINI_API_KEY;
  let turno: string | undefined;
  try {
    const leido = await leerDictado(f, id);
    const libre = (d: Dictado) => d.estado === "subido" || (d.estado === "procesando" && (d.plazo ?? 0) <= deps.reloj.ahora());
    if (!leido || !libre(leido.d)) return "nada";
    const mio = idAzar(16);
    const tomado = await cambiarDictado(f, id, (d) =>
      d && libre(d)
        ? {
            ...d,
            estado: "procesando",
            turno: mio,
            plazo: deps.reloj.ahora() + PLAZO_CORRIDA_MS,
            intentos: (d.intentos ?? 0) + 1,
            error: undefined,
            actualizado: iso(deps.reloj.ahora()),
          }
        : null,
    );
    if (!tomado.escrito || !tomado.d) return "perdio";
    turno = mio;
    const cambios = await pedirYOrdenar(tomado.d, deps, log);
    const r = await terminar(f, id, mio, cambios, deps);
    log(`dictado ${id}: ${r === "listo" || r === "error" ? `${cambios.estado}${cambios.error ? ` ${cambios.error.codigo}` : ""}${cambios.modelo ? ` (${cambios.modelo}, ${cambios.ms ?? 0} ms)` : ""}` : r}`);
    return r;
  } catch (e) {
    log(`dictado ${id}: falla inesperada: ${sanear(String((e as Error)?.message ?? e), clave)}`);
    if (turno) {
      try {
        return await terminar(f, id, turno, { estado: "error", error: { codigo: "interno", reintentable: true } }, deps);
      } catch {
        /* Blobs caído: la vista lo mostrará como se_corto cuando venza el plazo */
      }
    }
    return "error";
  }
}

type Cambios = Partial<Dictado> & { estado: Dictado["estado"] };

async function pedirYOrdenar(d: Dictado, deps: DepsDictados, log: (l: string) => void): Promise<Cambios> {
  const cfg = configGemini(deps.env);
  if (!cfg.ok) return { estado: "error", error: { codigo: cfg.motivo, reintentable: true } };
  const crudo = await almacenAudios().get(claveAudio(d.familiaId, d.id), { type: "arrayBuffer" });
  if (!crudo) return { estado: "error", error: { codigo: "audio_perdido", reintentable: false } };
  const datos = new Uint8Array(crudo);
  if (sha256(datos) !== d.sha256) {
    log(`dictado ${d.id}: el audio guardado no calza con su huella`);
    return { estado: "error", error: { codigo: "audio_perdido", reintentable: false } };
  }
  const r = await pedirReceta(
    cfg,
    { datos, mime: d.mime, mimeAlterno: d.mimeAlterno, archivo: d.archivo, fecha: fechaLarga(d.creado) },
    { hasta: deps.reloj.ahora() + PRESUPUESTO_MS, corrida: d.intentos, reloj: deps.reloj, log: (l) => log(`dictado ${d.id}: ${l}`) },
  );
  const enlace = { id: d.id, fecha: d.creado, segundos: d.segundos };
  const listo = (b: BorradorReceta, modelo: string, ms?: number, rescate?: true): Cambios => {
    const revisar = Object.fromEntries(b.ingredientes.filter((i) => i.revisar).map((i) => [i.id, i.revisar as string]));
    return {
      estado: "listo",
      borrador: aRecetaApp(b, enlace),
      avisos: b.avisos,
      revisar: Object.keys(revisar).length ? revisar : undefined,
      esReceta: b.esReceta,
      motivo: b.motivo,
      transcripcion: b.transcripcion,
      modelo,
      ms,
      rescate, // undefined en una versión completa: borra la marca de un rescate anterior
      error: undefined,
    };
  };
  if (r.tipo === "ok") return listo(normalizar(r.datos, { adivinarCategoria, nuevoId: (p) => `${p}_${idAzar(10)}` }), r.modelo, r.ms);
  if (r.tipo === "rescate") return listo(borradorRescate(r.transcripcion), r.modelo, undefined, true);
  return { estado: "error", error: { codigo: r.codigo, reintentable: r.reintentable, ...(r.proximo ? { proximo: r.proximo } : {}) } };
}

/**
 * Escribe el resultado sólo si el dictado sigue existiendo y el turno es el de esta corrida. Con un error,
 * si había un borrador de antes de «Pedir otra versión», vuelve ése (conError).
 */
async function terminar(f: string, id: string, turno: string, cambios: Cambios, deps: DepsDictados): Promise<ResultadoCorrida> {
  const cuando = iso(deps.reloj.ahora());
  const r = await cambiarDictado(f, id, (d) => {
    if (!d || d.turno !== turno) return null;
    if (cambios.estado !== "listo" && cambios.error) return conError({ ...d, ...cambios }, cambios.error, cuando);
    return { ...d, ...cambios, turno: undefined, plazo: undefined, actualizado: cuando, anterior: undefined };
  });
  if (r.escrito) return cambios.estado === "listo" ? "listo" : "error";
  return r.d ? "perdio" : "descartado";
}

/** POST /api/dictados-proceso (función en segundo plano): {id} con el Bearer del equipo. No responde nada útil. */
export function manejarProceso(deps: DepsDictados) {
  return async (req: Request): Promise<void> => {
    try {
      const s = await autenticar(req);
      if (s instanceof Response) return;
      const b = await leerJSON(req);
      const id = typeof b?.id === "string" ? b.id : "";
      if (ID_DICTADO.test(id)) await correrDictado(s.familiaId, id, deps);
    } catch (e) {
      console.error("dictados-proceso", sanear(String((e as Error)?.message ?? e), deps.env.GEMINI_API_KEY));
    }
  };
}

// ---------- Dependencias reales ----------

export async function dispararReal(base: string, auth: string, id: string): Promise<boolean> {
  try {
    const r = await fetch(`${base}/api/dictados-proceso`, {
      method: "POST",
      headers: { authorization: auth, "content-type": "application/json" },
      body: JSON.stringify({ id }),
      signal: AbortSignal.timeout(5_000),
    });
    await r.body?.cancel().catch(() => {});
    return r.status === 202;
  } catch {
    return false; // la app vuelve a pedir "procesar" a los 30 s
  }
}

export const depsReales = (): DepsDictados => ({ reloj: relojReal, env: process.env, disparar: dispararReal });
