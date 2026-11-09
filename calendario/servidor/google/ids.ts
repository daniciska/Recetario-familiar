// Id de Google Calendar reversible a partir del UID del panel.
//
// Google deja elegir el id de un evento al crearlo (5 a 1024 caracteres de base32hex: 0-9 y a-v) y lo
// rechaza con 409 si ya existe. El panel usa como id el UID codificado, así:
// - crear es idempotente (un reintento da 409 en vez de un duplicado);
// - al leer, el UID del panel se recupera del id (al volver a conectar no se duplica nada);
// - si el id quedó ocupado por un evento borrado (lápida), se usa la "generación" siguiente.
//
// API:
//   idGoogleDe(uid, gen = 0): string        "cf" + base32hex(UTF-8(gen ? `${uid}\n${gen}` : uid)).
//                                            Lanza NoSePuedeEscribir si pasa de 1024 caracteres.
//   uidDesdeId(id): { uid, gen } | null     al revés; null si el id no es nuestro (ver uidDesdeId).
//   idDePrueba(azar): string                id de un evento de la autoprueba ("Probar"): nunca se
//   esIdDePrueba(id): boolean                confunde con uno nuestro y el listado lo ignora.
//   PREFIJO_ID, SUFIJO_GOOGLE, SUFIJO_PRUEBA, GEN_MAX

import { NoSePuedeEscribir, SUFIJO_UID } from "../ics";

const B32 = "0123456789abcdefghijklmnopqrstuv";
export const PREFIJO_ID = "cf";
/** UID que el panel les da a los eventos que vienen de Google (ver serie.ts): `${id}@google.com`. */
export const SUFIJO_GOOGLE = "@google.com";
/** UID (codificado en el id) de los eventos de prueba de "Probar". */
export const SUFIJO_PRUEBA = "@prueba.calendario-familiar";
export const GEN_MAX = 9;
const MAX_ID = 1024;

function codificar(bytes: Uint8Array): string {
  let v = 0;
  let n = 0;
  let s = "";
  for (const b of bytes) {
    v = ((v << 8) | b) & 0xffff;
    n += 8;
    while (n >= 5) {
      n -= 5;
      s += B32[(v >>> n) & 31];
    }
  }
  if (n) s += B32[(v << (5 - n)) & 31];
  return s;
}

function decodificar(s: string): Uint8Array {
  const r: number[] = [];
  let v = 0;
  let n = 0;
  for (const c of s) {
    v = ((v << 5) | B32.indexOf(c)) & 0xffff;
    n += 5;
    if (n >= 8) {
      n -= 8;
      r.push((v >>> n) & 255);
    }
  }
  return new Uint8Array(r);
}

const utf8 = new TextEncoder();
const deUtf8 = new TextDecoder("utf-8", { fatal: true });

export function idGoogleDe(uid: string, gen = 0): string {
  if (!Number.isInteger(gen) || gen < 0 || gen > GEN_MAX) throw new RangeError(`generación inválida: ${gen}`);
  const id = PREFIJO_ID + codificar(utf8.encode(gen ? `${uid}\n${gen}` : uid));
  if (id.length > MAX_ID) throw new NoSePuedeEscribir("El identificador de este evento es demasiado largo para Google Calendar.");
  return id;
}

/** Decodifica cualquier id "cf…" bien formado (sin mirar el sufijo del UID). */
function decodificarId(id: string): { uid: string; gen: number } | null {
  if (id.length > MAX_ID || !/^cf[0-9a-v]+$/.test(id)) return null;
  let texto: string;
  try {
    texto = deUtf8.decode(decodificar(id.slice(PREFIJO_ID.length)));
  } catch {
    return null;
  }
  const partes = texto.split("\n");
  if (partes.length > 2) return null;
  const [uid, g] = partes;
  if (!/^[\x21-\x7e]+$/.test(uid) || !uid.includes("@")) return null;
  if (g !== undefined && !/^[1-9]$/.test(g)) return null;
  const gen = g === undefined ? 0 : Number(g);
  // Sólo la forma canónica (sin bits de relleno ni caracteres de más).
  if (PREFIJO_ID + codificar(utf8.encode(gen ? `${uid}\n${gen}` : uid)) !== id) return null;
  return { uid, gen };
}

/**
 * UID del panel guardado en un id de Google, o null si el id no es nuestro. Se aceptan sólo UID del
 * panel ("…@calendario-familiar") y los que el panel les da a los eventos de Google ("…@google.com"):
 * una serie de Google que se borró allá y se volvió a crear desde la pared se recrea con su mismo UID,
 * y tiene que leerse de vuelta con ese UID (si no, la pared la duplicaría).
 */
export function uidDesdeId(id: string): { uid: string; gen: number } | null {
  const r = decodificarId(id);
  if (!r || !(r.uid.endsWith(SUFIJO_UID) || r.uid.endsWith(SUFIJO_GOOGLE))) return null;
  return r;
}

/**
 * Id de un evento de prueba de "Probar": base32hex válido para Google (no lleva "w"–"z"), con un UID
 * que no es del panel. `azar`: letras y números (p. ej. 20 caracteres al azar).
 */
export function idDePrueba(azar: string): string {
  return idGoogleDe(`${azar}${SUFIJO_PRUEBA}`);
}

export function esIdDePrueba(id: string): boolean {
  const r = decodificarId(id);
  return !!r && r.uid.endsWith(SUFIJO_PRUEBA);
}
