// Piezas compartidas por las funciones de la API (/api/*). Corren en Netlify Functions.
//
// - Netlify Database (Postgres): familias y colecciones (con versión).
// - Netlify Blobs, almacén "calendario": por familia, los equipos con acceso (huella de su clave),
//   las versiones de cada colección (para que los equipos sepan si hay cambios sin despertar la
//   base) y las invitaciones. Almacén "fotos": las fotos de las recetas.

import { getDatabase } from "@netlify/database";
import { getStore } from "@netlify/blobs";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { CLAVES } from "../lib/datos/claves";
import type { ClaveColeccion } from "../lib/datos/tipos";

// Una sola conexión por instancia (nunca una por pedido).
export const db = getDatabase();

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
}

const claveAcceso = (familiaId: string) => `acceso/${familiaId}`;

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
    const r = actual?.etag
      ? await store.setJSON(claveAcceso(familiaId), nuevo, { onlyIfMatch: actual.etag })
      : actual
        ? // Sin ETag (el simulador local de Blobs no lo entrega al leer): escritura simple.
          await store.setJSON(claveAcceso(familiaId), nuevo)
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
