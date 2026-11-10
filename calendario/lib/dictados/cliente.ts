// Cliente de /api/dictados (servidor/dictados.ts) para «🎙️ Dictar receta». Usa api() de lib/datos/nube.ts,
// que convierte «sin red / 5xx / demoró demasiado» en SinConexion y un 401 en AccesoRevocado; los dos pasan
// tal cual. Un 4xx con {error} se lanza como RechazoDictado, con el mensaje listo para mostrar.
// «No existe» es 410 (ver servidor/dictados.ts): aquí da null (o "borrado" en bajarAudio).
//
// La subida (subirPendiente) vive fuera de React: sigue aunque se cierre la ventana de dictar, y borra la
// copia del equipo (pendientes.ts) apenas la nube confirma.

import { AccesoRevocado, SinConexion, api, leerSesion } from "../datos/nube";
import * as pendientes from "./pendientes";
import type { PendienteLocal } from "./pendientes";
import {
  ALFABETO_ID,
  type DictadoPublico,
  type ListaDictados,
  type MotivoRechazo,
  type RespuestaProbar,
  type Salud,
  type TextoDictado,
} from "./tipos";

/** Este equipo no está conectado a la familia en la nube (sin nube no hay dictados). */
export class SinNube extends SinConexion {}

/** La nube dijo que no; `message` viene en español para mostrarlo tal cual. */
export class RechazoDictado extends Error {
  status: number;
  constructor(mensaje: string, status: number) {
    super(mensaje);
    this.status = status;
  }
}

const token = () => {
  const s = leerSesion();
  if (!s) throw new SinNube();
  return s.token;
};
export const hayNube = () => leerSesion() !== null;

const dormir = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

function rechazo(status: number, datos: { error?: unknown }, porOmision = "No se pudo completar el pedido en la nube."): never {
  throw new RechazoDictado(typeof datos.error === "string" && datos.error ? datos.error : porOmision, status);
}

// ---------- Ids y copias locales ----------

/** 24 caracteres del alfabeto de idAzar() (servidor/comun.ts): el id del dictado lo pone el equipo. */
export function nuevoIdDictado(): string {
  const b = crypto.getRandomValues(new Uint8Array(24));
  let s = "";
  for (const x of b) s += ALFABETO_ID[x % ALFABETO_ID.length];
  return s;
}

/** Safari deja `file.type` vacío con .opus y otros: se deduce del nombre (el servidor igual mira los bytes). */
export function tipoDeArchivo(nombre: string, tipo: string): string {
  if (tipo) return tipo.split(";")[0].trim().toLowerCase();
  const ext = /\.([a-z0-9]+)$/i.exec(nombre)?.[1]?.toLowerCase() ?? "";
  const tipos: Record<string, string> = {
    opus: "audio/ogg",
    ogg: "audio/ogg",
    oga: "audio/ogg",
    m4a: "audio/mp4",
    mp4: "audio/mp4",
    aac: "audio/aac",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    webm: "audio/webm",
    flac: "audio/flac",
    aiff: "audio/aiff",
    aif: "audio/aiff",
  };
  return tipos[ext] ?? "application/octet-stream";
}

/** Arma la copia local de una grabación o de un archivo elegido (todavía sin guardar). */
export function nuevoPendiente(
  blob: Blob,
  meta: { origen: "grabacion" | "archivo"; segundos?: number; archivo?: string; mime?: string },
  ahora = new Date(),
): PendienteLocal {
  const segundos = meta.segundos && meta.segundos > 0 ? Math.round(meta.segundos) : undefined;
  const archivo = meta.archivo?.trim().slice(0, 120) || undefined;
  return {
    id: nuevoIdDictado(),
    blob,
    mime: meta.mime || tipoDeArchivo(archivo ?? "", blob.type),
    ...(segundos ? { segundos } : {}),
    ...(archivo ? { archivo } : {}),
    origen: meta.origen,
    creado: ahora.toISOString(),
  };
}

// ---------- Subida ----------

export type ResultadoSubida =
  | { ok: true; dictado: DictadoPublico }
  /** Sin internet (o la nube no respondió) después de 3 intentos: la copia sigue en el equipo. */
  | { ok: false; motivo: "sin_conexion" }
  /**
   * La nube no lo aceptó. "ya_guardada": ya lo tiene y la receta está en Recetas (la copia se borró: no
   * ofrecer «Descartar», que borraría el audio de esa receta). "lleno": hay 20 sin revisar (la copia queda
   * y se reintenta sola con cupo). "rechazado": muy grande, formato, etc. (la copia queda; se sube o
   * descarta a mano).
   */
  | { ok: false; motivo: "ya_guardada" | "lleno" | "rechazado"; mensaje: string };

const PORQUE: Record<number, string> = {
  413: "El audio es muy grande (máximo 4 MB).",
  415: "Ese archivo no es un audio que sirva. Sirven notas de voz de WhatsApp (.opus), m4a, mp3, ogg, webm o wav.",
};

const subidas = new Map<string, Promise<ResultadoSubida>>();

/** ¿Se está subiendo ahora este audio desde esta pestaña? */
export const subiendo = (id: string) => subidas.has(id);

/**
 * Sube un audio con PUT /api/dictados/:id (idempotente: un reintento con el mismo id no duplica). Hasta 3
 * intentos ante SinConexion (esperando 2 s y 5 s). Con 200/201 borra la copia del equipo. Si ya se está
 * subiendo desde esta pestaña, devuelve esa misma subida. AccesoRevocado pasa tal cual.
 */
export function subirPendiente(p: PendienteLocal, op: { esperas?: number[] } = {}): Promise<ResultadoSubida> {
  const ya = subidas.get(p.id);
  if (ya) return ya;
  const s = subirUnaVez(p, op.esperas ?? [2000, 5000]).finally(() => subidas.delete(p.id));
  subidas.set(p.id, s);
  return s;
}

async function subirUnaVez(p: PendienteLocal, esperas: number[]): Promise<ResultadoSubida> {
  const sesion = leerSesion();
  if (!sesion) return { ok: false, motivo: "sin_conexion" };
  const q = new URLSearchParams();
  if (p.segundos) q.set("segundos", String(Math.round(p.segundos)));
  if (p.archivo) q.set("archivo", p.archivo);
  q.set("origen", p.origen);
  for (let intento = 0; ; intento++) {
    try {
      const { status, datos } = await api<{ dictado?: DictadoPublico; error?: string; motivo?: MotivoRechazo }>(`/api/dictados/${p.id}?${q}`, {
        metodo: "PUT",
        cuerpo: p.blob,
        tipo: "application/octet-stream", // el servidor detecta el formato por los bytes
        token: sesion.token,
        espera: 90_000, // 4 MB con mala señal
      });
      if ((status === 200 || status === 201) && datos.dictado) {
        await pendientes.borrar(p.id);
        return { ok: true, dictado: datos.dictado };
      }
      if (status >= 400 && status < 500) {
        const mensaje = typeof datos.error === "string" && datos.error ? datos.error : (PORQUE[status] ?? "La nube no aceptó este audio.");
        if (status === 409 && datos.motivo === "ya_guardada") {
          await pendientes.borrar(p.id);
          return { ok: false, motivo: "ya_guardada", mensaje };
        }
        const lleno = status === 409 && datos.motivo === "lleno";
        await pendientes.anotarRechazo(p.id, { mensaje, reintentar: lleno });
        return { ok: false, motivo: lleno ? "lleno" : "rechazado", mensaje };
      }
      throw new SinConexion(); // otra cosa (p. ej. una página en vez de la API): como si no hubiera respondido
    } catch (e) {
      if (e instanceof AccesoRevocado || !(e instanceof SinConexion)) throw e;
      if (intento >= esperas.length) return { ok: false, motivo: "sin_conexion" };
      await dormir(esperas[intento]);
    }
  }
}

// ---------- Lo demás de la API ----------

type ConDictado = { dictado?: DictadoPublico; error?: string };

/** «Intentar de nuevo» u (otraVez) «Pedir otra versión». null: el dictado ya no existe. */
export async function procesarDictado(id: string, otraVez = false): Promise<DictadoPublico | null> {
  const { status, datos } = await api<ConDictado>(`/api/dictados/${id}/procesar`, { metodo: "POST", cuerpo: otraVez ? { otraVez: true } : {}, token: token() });
  if (status === 410) return null;
  if ((status === 200 || status === 202) && datos.dictado) return datos.dictado;
  return rechazo(status, datos);
}

/** El dictado completo (con borrador, avisos, revisar y transcripción). null: ya no existe. */
export async function leerDictado(id: string): Promise<DictadoPublico | null> {
  const { status, datos } = await api<ConDictado>(`/api/dictados/${id}`, { token: token() });
  if (status === 410) return null;
  if (status === 200 && datos.dictado) return datos.dictado;
  return rechazo(status, datos);
}

/** Los dictados de la familia (del más nuevo al más viejo, sin borrador) y si Gemini tiene clave. */
export async function listarDictados(): Promise<ListaDictados> {
  const { status, datos } = await api<Partial<ListaDictados> & { error?: string }>("/api/dictados", { token: token() });
  if (status === 200 && Array.isArray(datos.dictados) && datos.gemini) return { dictados: datos.dictados, gemini: datos.gemini };
  return rechazo(status, datos);
}

/** La receta ya se guardó en Recetas: el dictado sale de la lista (el audio y lo que se dijo quedan). */
export async function marcarGuardado(id: string, recetaId: string): Promise<void> {
  const { status, datos } = await api<{ ok?: boolean; error?: string }>(`/api/dictados/${id}/guardado`, { metodo: "POST", cuerpo: { recetaId }, token: token() });
  if (status !== 200) rechazo(status, datos);
}

/**
 * Descartar: borra la copia de este equipo y, en la nube, el registro, el audio y lo que se dijo
 * (idempotente). Sin nube sólo borra la copia. Si la nube no responde lanza SinConexion (la copia ya se
 * borró: si el audio nunca llegó a la nube, ya está descartado).
 */
export async function descartarDictado(id: string): Promise<void> {
  await pendientes.borrar(id);
  if (!hayNube()) return;
  const { status, datos } = await api<{ ok?: boolean; error?: string }>(`/api/dictados/${id}`, { metodo: "DELETE", token: token() });
  if (status !== 200) rechazo(status, datos);
}

/** Lo que se dijo (transcripción). null: ya no está. */
export async function leerTexto(id: string): Promise<TextoDictado | null> {
  const { status, datos } = await api<Partial<TextoDictado> & { error?: string }>(`/api/dictados/${id}/texto`, { token: token() });
  if (status === 410) return null;
  if (status === 200 && typeof datos.transcripcion === "string") return datos as TextoDictado;
  return rechazo(status, datos);
}

/** «Probar conexión» (GET del modelo en Google: no gasta cuota). */
export async function probarGemini(): Promise<RespuestaProbar> {
  const { status, datos } = await api<RespuestaProbar & { error?: string }>("/api/dictados/probar", { metodo: "POST", cuerpo: {}, token: token(), espera: 30_000 });
  if (status === 200 && typeof datos.gemini === "string") return datos;
  return rechazo(status, datos);
}

/** GET /api/salud (no pide clave). null si la nube no respondió. Con Blobs caído responde 503 con {blobs:false}. */
export async function salud(espera = 10_000): Promise<Salud | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), espera);
  try {
    const r = await fetch("/api/salud", { cache: "no-store", signal: ctrl.signal });
    const d = (await r.json().catch(() => null)) as Partial<Salud> | null;
    return d && typeof d.blobs === "boolean" && typeof d.gemini === "string" ? { blobs: d.blobs, gemini: d.gemini } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * El audio como dirección blob: para un <audio> (hay que liberarla con URL.revokeObjectURL). Con fetch se
 * puede mandar la clave del equipo, que un <audio src> no manda. "borrado": ya no está en la nube.
 */
export async function bajarAudio(id: string, espera = 60_000): Promise<string | "borrado"> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), espera);
  let r: Response;
  try {
    r = await fetch(`/api/dictados/${id}/audio`, { headers: { authorization: `Bearer ${token()}` }, cache: "no-store", signal: ctrl.signal });
  } catch (e) {
    clearTimeout(t);
    if (e instanceof SinNube) throw e;
    throw new SinConexion();
  }
  try {
    if (r.status >= 500) throw new SinConexion();
    if (r.status === 410) return "borrado";
    if (r.status === 401) throw new AccesoRevocado(((await r.json().catch(() => ({}))) as { error?: string }).error);
    if (!r.ok) return rechazo(r.status, (await r.json().catch(() => ({}))) as { error?: string }, "No se encontró el audio.");
    const b = await r.blob();
    return URL.createObjectURL(b);
  } catch (e) {
    if (e instanceof SinConexion || e instanceof AccesoRevocado || e instanceof RechazoDictado) throw e;
    throw new SinConexion(); // se cortó a medio bajar
  } finally {
    clearTimeout(t);
  }
}
