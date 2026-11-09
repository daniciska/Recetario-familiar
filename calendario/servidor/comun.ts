// Piezas compartidas por las funciones de la API (/api/*). Corren en Netlify Functions y guardan
// todo en Netlify Blobs (lectura con consistencia fuerte y escrituras condicionales con ETag):
//
// Almacén "calendario":
//   registro/primera           → la primera familia creada en el sitio (sólo se puede crear una)
//   acceso/<familia>           → la familia, sus equipos (huella de su clave) y la versión de cada colección
//   datos/<familia>/<colección> → {datos, version}: un cambio sólo se acepta si parte de la última versión
//   invitaciones/<huella>      → códigos de un uso (24 h)
// Almacén "fotos": las fotos de las recetas.

import { getStore } from "@netlify/blobs";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { CLAVES } from "../lib/datos/claves";
import type { ClaveColeccion } from "../lib/datos/tipos";

export const almacen = () => getStore({ name: "calendario", consistency: "strong" });
export const almacenFotos = () => getStore({ name: "fotos" });

export const esClave = (c: string): c is ClaveColeccion => (CLAVES as string[]).includes(c);
export { CLAVES };

/** Tamaño máximo de una colección guardada (las fotos van aparte, en Blobs). */
export const MAX_COLECCION = 2_000_000;

// ---------- Respuestas ----------

export const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
export const error = (mensaje: string, status: number) => json({ error: mensaje }, status);

// ---------- Identificadores y claves ----------

const ALFABETO = "abcdefghijkmnopqrstuvwxyz23456789";
export function idAzar(largo = 16): string {
  const b = randomBytes(largo);
  let s = "";
  for (const x of b) s += ALFABETO[x % ALFABETO.length];
  return s;
}

/** Código de invitación fácil de dictar o tipear: 8 caracteres sin 0/O, 1/I/L. */
const ALFABETO_CODIGO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function codigoInvitacion(): string {
  const b = randomBytes(8);
  let s = "";
  for (const x of b) s += ALFABETO_CODIGO[x % ALFABETO_CODIGO.length];
  return s;
}
export const normalizarCodigo = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, "");

export const huella = (texto: string) => createHash("sha256").update(texto).digest("hex");

function iguales(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// ---------- Acceso de la familia (Blobs) ----------

export interface Equipo {
  nombre: string;
  huella: string; // sha256 del secreto
  creado: string; // ISO
}

export interface Acceso {
  familia: { id: string; nombre: string };
  equipos: Record<string, Equipo>;
  versiones: Partial<Record<ClaveColeccion, number>>;
  /** Calendarios de afuera conectados (iCloud o Google). El estado de la sincronización va aparte. */
  calendarios?: ConexionCalendario[];
}

/** Rol de un adulto de la familia (en pantalla: «Madre», «Padre», «Otro adulto»). */
export type RolAdulto = "madre" | "padre" | "adulto";

/** Alguien con quien se compartió el calendario de Google desde el panel. */
export interface PersonaCalendario {
  correo: string; // en minúsculas, validado
  nombre: string; // máx. 60
  rol: RolAdulto;
  permiso: "editor" | "lectura";
  miembroId?: string; // si corresponde a un integrante del panel
  invitada: string; // ISO
  modo: "panel" | "manual"; // "manual" = el panel no pudo compartir y hay que hacerlo en Google Calendar
}

export interface ConexionCalendario {
  id: string;
  proveedor: "icloud" | "google";
  nombre: string; // nombre del calendario ("Familia")
  url: string; // en icloud, la dirección CalDAV del calendario; en google, url = ID del calendario
  color?: string;
  creada: string;
  /** Sólo google: el adulto dueño del calendario (es un calendario de su Gmail). */
  dueno?: { nombre: string; correo: string; rol: RolAdulto; miembroId?: string };
  /** Sólo google: con quién más se compartió (máx. 20). */
  personas?: PersonaCalendario[];
}

/** Lo que ven los equipos de cada calendario conectado. */
export const calendariosPublicos = (a: Acceso) =>
  (a.calendarios ?? []).map((c) => ({ id: c.id, proveedor: c.proveedor, nombre: c.nombre }));

const claveAcceso = (familiaId: string) => `acceso/${familiaId}`;

/**
 * Exclusión mutua con un blob "sólo si no existe". Sirve cuando no hay ETag para la escritura
 * condicional (el simulador local de Blobs no lo entrega al leer); en producción no se usa.
 */
async function conCandado<T>(clave: string, fn: () => Promise<T>): Promise<T> {
  const store = almacen();
  const k = `candados/${clave}`;
  for (let i = 0; i < 80; i++) {
    const r = await store.setJSON(k, { desde: Date.now() }, { onlyIfNew: true });
    if (r.modified) {
      try {
        return await fn();
      } finally {
        await store.delete(k).catch(() => {});
      }
    }
    const c = (await store.get(k, { type: "json" })) as { desde: number } | null;
    if (c && Date.now() - c.desde > 10_000) await store.delete(k).catch(() => {}); // abandonado
    await new Promise((ok) => setTimeout(ok, 50 + Math.random() * 100));
  }
  throw new Error("Ocupado: demasiados cambios simultáneos");
}

export async function leerAcceso(familiaId: string): Promise<Acceso | null> {
  return (await almacen().get(claveAcceso(familiaId), { type: "json" })) as Acceso | null;
}

/**
 * Cambia el acceso de una familia sin pisar cambios simultáneos (escritura condicional con ETag;
 * si otro pedido escribió entre medio, se vuelve a leer y aplicar).
 */
export async function cambiarAcceso(familiaId: string, fn: (a: Acceso | null) => Acceso): Promise<Acceso> {
  const store = almacen();
  for (let i = 0; i < 8; i++) {
    const actual = await store.getWithMetadata(claveAcceso(familiaId), { type: "json" });
    const nuevo = fn((actual?.data as Acceso | undefined) ?? null);
    if (actual && !actual.etag) {
      // Sin ETag (simulador local): leer y escribir dentro de un candado.
      return conCandado(claveAcceso(familiaId), async () => {
        const ahora = (await store.get(claveAcceso(familiaId), { type: "json" })) as Acceso | null;
        const n = fn(ahora);
        await store.setJSON(claveAcceso(familiaId), n);
        return n;
      });
    }
    const r = actual?.etag
      ? await store.setJSON(claveAcceso(familiaId), nuevo, { onlyIfMatch: actual.etag })
      : await store.setJSON(claveAcceso(familiaId), nuevo, { onlyIfNew: true });
    if (r.modified) return nuevo;
  }
  throw new Error("No se pudo actualizar el acceso (demasiados cambios simultáneos)");
}

/** Anota versiones nuevas (nunca baja una versión: los pedidos pueden terminar en otro orden). */
export async function anotarVersiones(familiaId: string, versiones: Partial<Record<ClaveColeccion, number>>) {
  await cambiarAcceso(familiaId, (a) => {
    if (!a) throw new Error("Familia sin acceso");
    const v = { ...a.versiones };
    for (const [c, n] of Object.entries(versiones) as [ClaveColeccion, number][]) v[c] = Math.max(v[c] ?? 0, n);
    return { ...a, versiones: v };
  });
}

// ---------- Colecciones (Blobs) ----------

export interface Coleccion {
  datos: unknown;
  version: number;
}

const claveDatos = (familiaId: string, clave: ClaveColeccion) => `datos/${familiaId}/${clave}`;

export async function leerColeccion(familiaId: string, clave: ClaveColeccion): Promise<Coleccion | null> {
  return (await almacen().get(claveDatos(familiaId, clave), { type: "json" })) as Coleccion | null;
}

/**
 * Guarda una colección sólo si la versión guardada es `base` (escritura condicional con ETag: si
 * otro equipo escribió entre medio, no se pisa). Si no, devuelve lo último que hay.
 */
export async function guardarColeccion(
  familiaId: string,
  clave: ClaveColeccion,
  datos: unknown,
  base: number,
): Promise<{ ok: true; version: number } | { ok: false; actual: Coleccion }> {
  const store = almacen();
  const k = claveDatos(familiaId, clave);
  const actual = await store.getWithMetadata(k, { type: "json" });
  if (actual && !actual.etag) {
    // Sin ETag (simulador local): comparar la versión y escribir dentro de un candado.
    return conCandado(k, async () => {
      const ahora = (await store.get(k, { type: "json" })) as Coleccion | null;
      const v = ahora?.version ?? 0;
      if (v !== base) return { ok: false as const, actual: ahora ?? { datos: null, version: 0 } };
      await store.setJSON(k, { datos, version: v + 1 });
      return { ok: true as const, version: v + 1 };
    });
  }
  const previa = (actual?.data as Coleccion | undefined) ?? null;
  const v = previa?.version ?? 0;
  if (v !== base) return { ok: false, actual: previa ?? { datos: null, version: 0 } };
  const nuevo: Coleccion = { datos, version: v + 1 };
  const r = actual?.etag
    ? await store.setJSON(k, nuevo, { onlyIfMatch: actual.etag })
    : await store.setJSON(k, nuevo, { onlyIfNew: true });
  if (!r.modified) return { ok: false, actual: (await leerColeccion(familiaId, clave)) ?? { datos: null, version: 0 } };
  return { ok: true, version: v + 1 };
}

/** Reemplaza una colección (restaurar un respaldo): sube la versión sin mirar la anterior. */
export async function reemplazarColeccion(familiaId: string, clave: ClaveColeccion, datos: unknown): Promise<number> {
  for (let i = 0; i < 8; i++) {
    const actual = await leerColeccion(familiaId, clave);
    const r = await guardarColeccion(familiaId, clave, datos, actual?.version ?? 0);
    if (r.ok) return r.version;
  }
  throw new Error("No se pudo reemplazar (demasiados cambios simultáneos)");
}

// ---------- Autenticación ----------

/** Clave del equipo: `familiaId.equipoId.secreto` (el secreto sólo existe en el equipo). */
export function armarToken(familiaId: string, equipoId: string, secreto: string) {
  return `${familiaId}.${equipoId}.${secreto}`;
}

export interface Sesion {
  familiaId: string;
  equipoId: string;
  acceso: Acceso;
}

export async function autenticar(req: Request): Promise<Sesion | Response> {
  const m = /^Bearer ([a-z0-9]+)\.([a-z0-9]+)\.([A-Za-z0-9_-]+)$/.exec(req.headers.get("authorization") ?? "");
  if (!m) return error("Falta la clave del equipo", 401);
  const [, familiaId, equipoId, secreto] = m;
  const acceso = await leerAcceso(familiaId);
  const equipo = acceso?.equipos[equipoId];
  if (!acceso || !equipo || !iguales(equipo.huella, huella(secreto))) {
    return error("Este equipo ya no tiene acceso a la familia", 401);
  }
  return { familiaId, equipoId, acceso };
}

/** Crea un equipo nuevo en la familia y devuelve su clave (la única vez que se ve). */
export async function nuevoEquipo(familiaId: string, nombre: string): Promise<{ token: string; equipoId: string }> {
  const equipoId = idAzar(12);
  const secreto = randomBytes(32).toString("base64url");
  await cambiarAcceso(familiaId, (a) => {
    if (!a) throw new Error("Familia sin acceso");
    return {
      ...a,
      equipos: { ...a.equipos, [equipoId]: { nombre: limpiarNombre(nombre), huella: huella(secreto), creado: new Date().toISOString() } },
    };
  });
  return { token: armarToken(familiaId, equipoId, secreto), equipoId };
}

export const limpiarNombre = (n: unknown, def = "Equipo") =>
  (typeof n === "string" && n.trim() ? n.trim() : def).slice(0, 60);

export async function leerJSON(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const v = await req.json();
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
