// Conexión de este equipo con la familia en la nube (Netlify Functions + Netlify Database).

import type { ClaveColeccion } from "./tipos";

const CLAVE_SESION = "calendario-familiar:nube";
const CLAVE_AVISO = "calendario-familiar:nube:aviso";

export interface SesionNube {
  token: string;
  equipoId: string;
  familia: { id: string; nombre: string };
  /** Recién creada: falta subir los datos que ya había en este equipo. */
  pendienteSubir?: boolean;
  versiones?: Partial<Record<ClaveColeccion, number>>;
}

export function leerSesion(): SesionNube | null {
  try {
    const s = JSON.parse(localStorage.getItem(CLAVE_SESION) ?? "null");
    return s && typeof s.token === "string" && s.familia ? (s as SesionNube) : null;
  } catch {
    return null;
  }
}

export function guardarSesion(s: SesionNube) {
  localStorage.setItem(CLAVE_SESION, JSON.stringify(s));
}

export function borrarSesion() {
  try {
    localStorage.removeItem(CLAVE_SESION);
  } catch {
    /* nada */
  }
}

/** Mensaje para mostrar después de recargar (p. ej. "este equipo se desconectó"). */
export function dejarAviso(texto: string) {
  try {
    localStorage.setItem(CLAVE_AVISO, texto);
  } catch {
    /* nada */
  }
}
export function tomarAviso(): string | null {
  try {
    const t = localStorage.getItem(CLAVE_AVISO);
    localStorage.removeItem(CLAVE_AVISO);
    return t;
  } catch {
    return null;
  }
}

/** No se pudo hablar con la nube (sin internet, servidor caído o demoró demasiado). */
export class SinConexion extends Error {
  constructor() {
    super("Sin conexión con la nube");
  }
}

/** La familia le quitó el acceso a este equipo. */
export class AccesoRevocado extends Error {
  constructor(mensaje = "Este equipo ya no tiene acceso a la familia") {
    super(mensaje);
  }
}

export async function api<T = Record<string, unknown>>(
  ruta: string,
  { metodo = "GET", cuerpo, token, tipo, espera = 15_000 }: { metodo?: string; cuerpo?: unknown; token?: string; tipo?: string; espera?: number } = {},
): Promise<{ status: number; datos: T }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), espera);
  let r: Response;
  try {
    r = await fetch(ruta, {
      method: metodo,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(cuerpo !== undefined ? { "content-type": tipo ?? "application/json" } : {}),
      },
      body: cuerpo === undefined ? undefined : tipo ? (cuerpo as BodyInit) : JSON.stringify(cuerpo),
      cache: "no-store",
      signal: ctrl.signal,
    });
  } catch {
    throw new SinConexion();
  } finally {
    clearTimeout(t);
  }
  if (r.status >= 500) throw new SinConexion();
  const datos = (await r.json().catch(() => ({}))) as T;
  if (r.status === 401) throw new AccesoRevocado((datos as { error?: string }).error);
  return { status: r.status, datos };
}

/** Nombre para reconocer este equipo en la lista ("iPad", "iPhone", "Fire"…). */
export function nombreDeEsteEquipo(): string {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "iPad";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/Silk|KF[A-Z]{2,4}/.test(ua)) return "Tablet Fire";
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? "Teléfono Android" : "Tablet Android";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Computador";
  return "Equipo";
}

/** Pasa una foto (data URL) a la nube y devuelve su dirección. Sin nube, la deja como está. */
export async function subirFoto(dataUrl: string, token?: string): Promise<string> {
  const sesion = token ? { token } : leerSesion();
  if (!sesion || !dataUrl.startsWith("data:")) return dataUrl;
  const m = /^data:([^;,]+);base64,(.*)$/.exec(dataUrl);
  if (!m) return dataUrl;
  const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  const { status, datos } = await api<{ url?: string; error?: string }>("/api/fotos", {
    metodo: "POST",
    cuerpo: new Blob([bytes], { type: m[1] }),
    tipo: m[1],
    token: sesion.token,
    espera: 30_000,
  });
  if (status !== 201 || !datos.url) throw new Error(datos.error ?? "No se pudo subir la foto");
  return datos.url;
}
