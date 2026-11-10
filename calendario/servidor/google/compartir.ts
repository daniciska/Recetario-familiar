// Con quién se comparte el calendario «Familia» de Google, desde el panel (ACL de la Calendar API v3).
//
// El calendario es del Gmail de un adulto (el "dueño"). Si ese adulto lo compartió con la cuenta de
// servicio con «Realizar cambios y administrar el uso compartido» (accessRole owner), el panel puede
// invitar a otros como editor (writer) o solo lectura (reader); Google les manda la invitación por
// correo. Si no (writer), las invitaciones quedan "manuales": la interfaz explica cómo hacerlas.
//
// Guardas (antes de escribir nada en Google):
//   - el correo tiene que verse bien (minúsculas, máx. 254) y nunca es el del dueño ni el del panel;
//   - nunca se toca una regla cuyo rol actual sea owner (se lee la regla antes de escribir), y nunca se
//     da owner: sólo writer o reader;
//   - máximo MAX_PERSONAS personas invitadas.
// Un 403 de la ACL no es error: {puede:false} al leer, {modo:"manual"} al escribir. Los límites de uso
// (429, usageLimits) llegan como SERVIDOR (ver transporte.pedirJSON), nunca como "manual"; como nada
// reintenta solo estos pedidos, su texto para la familia sale de textoSinReintento.
// Google responde el mismo 404 a «esa persona no tiene regla» y a «el panel ya no ve el calendario»:
// antes de decir que alguien ya no estaba (quitar) o que no está (cambiarPermiso), se confirma que el
// calendario se sigue viendo (si no, NO_ENCONTRADO y no se cambia nada en el panel).
//
// API:
//   permisos(g, calId): {puede, reglas}                 reglas de usuario de la ACL (sin la del panel)
//   puedeInvitar(g, calId): boolean                     accessRole === "owner" (para "Probar")
//   invitar(g, calId, correo, permiso, ctx)             → {modo:"panel", regla, igual?} | {modo:"manual"}
//   cambiarPermiso(g, calId, correo, permiso, ctx)      → {modo:"panel", regla, igual?} | {modo:"manual"} | {modo:"noEsta"}
//   quitar(g, calId, correo, ctx)                       → {modo:"panel", yaNoEstaba?} | {modo:"manual"}
//   normalizarCorreo(c), mismaCuenta(a, b), permisoDeRol(rol), ROL_DE_PERMISO, MAX_PERSONAS
//   esLimiteDeUso(e), textoSinReintento(e), sinReintento(e)   el texto de un error para un pedido que nadie reintenta
//   class NoSePuedeCompartir (codigo: CORREO_INVALIDO | ES_PANEL | ES_DUENO | ADMINISTRA | PERMISO_INVALIDO | MAXIMO)
//   `ctx` = {dueno?: correo del dueño, personas?: cuántas OTRAS personas hay guardadas (para el máximo)}

import { ErrorCalDAV } from "../caldav";
import { errorTiempo, rutaCalendario, type GoogleCalendar, type RespuestaGoogle } from "./transporte";

export type PermisoCalendario = "editor" | "lectura";
export const ROL_DE_PERMISO = { editor: "writer", lectura: "reader" } as const;
type RolEscrito = (typeof ROL_DE_PERMISO)[PermisoCalendario];
export const MAX_PERSONAS = 20;
const MAX_PAGINAS = 20;
const CORREO = /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/;

/** El permiso del panel que corresponde a un rol de la ACL (owner y otros: null). */
export const permisoDeRol = (rol: string): PermisoCalendario | null => (rol === "writer" ? "editor" : rol === "reader" ? "lectura" : null);

/** Correo en minúsculas y sin espacios, o null si no se ve bien. */
export function normalizarCorreo(c: unknown): string | null {
  if (typeof c !== "string") return null;
  const x = c.trim().toLowerCase();
  return x.length <= 254 && CORREO.test(x) ? x : null;
}

/** El mismo Gmail aunque se escriba con puntos o con "+algo" (Gmail los ignora). */
export function mismaCuenta(a: string, b: string): boolean {
  const canon = (c: string) => {
    const [local, dominio] = [c.slice(0, c.lastIndexOf("@")), c.slice(c.lastIndexOf("@") + 1)];
    if (dominio !== "gmail.com" && dominio !== "googlemail.com") return c;
    return `${local.split("+")[0].replace(/\./g, "")}@gmail.com`;
  };
  return canon(a) === canon(b);
}

export type MotivoNoCompartir = "CORREO_INVALIDO" | "ES_PANEL" | "ES_DUENO" | "ADMINISTRA" | "PERMISO_INVALIDO" | "MAXIMO";

/** Algo que el panel no hace (antes de escribir en Google). El mensaje es para la familia. */
export class NoSePuedeCompartir extends Error {
  codigo: MotivoNoCompartir;
  constructor(mensaje: string, codigo: MotivoNoCompartir) {
    super(mensaje);
    this.name = "NoSePuedeCompartir";
    this.codigo = codigo;
  }
}

export interface ReglaPersona {
  correo: string;
  /** Rol en la ACL: owner, writer, reader, freeBusyReader, writerWithoutPrivateAccess. */
  rol: string;
}

export interface ContextoCompartir {
  /** Correo del dueño del calendario (su regla nunca se toca). */
  dueno?: string | null;
  /** Cuántas OTRAS personas hay guardadas (sin contar a esta), para el máximo al invitar. */
  personas?: number;
}

export type ResultadoPermisos = { puede: true; reglas: ReglaPersona[] } | { puede: false; reglas?: ReglaPersona[] };
export type ResultadoInvitar = { modo: "panel"; regla: ReglaPersona; igual?: boolean } | { modo: "manual" };
export type ResultadoCambiar = ResultadoInvitar | { modo: "noEsta" };
export type ResultadoQuitar = { modo: "panel"; yaNoEstaba?: boolean } | { modo: "manual" };

const rutaRegla = (calId: string, correo: string) => `${rutaCalendario(calId)}/acl/${encodeURIComponent(`user:${correo}`)}`;
const textoDe = (x: unknown) => (typeof x === "string" ? x : "");
const esObjeto = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

/** Las guardas del correo (sin pedidos). */
function revisar(g: GoogleCalendar, correo: unknown, ctx: ContextoCompartir): string {
  const c = normalizarCorreo(correo);
  if (!c) throw new NoSePuedeCompartir("Ese correo no se ve bien: revisa que esté completo (por ejemplo, nombre@gmail.com).", "CORREO_INVALIDO");
  if (mismaCuenta(c, g.correo.toLowerCase())) throw new NoSePuedeCompartir("Ese es el correo del panel: no hace falta invitarlo.", "ES_PANEL");
  const dueno = normalizarCorreo(ctx.dueno);
  if (dueno && mismaCuenta(c, dueno)) {
    throw new NoSePuedeCompartir("Ese es el Gmail de quien es dueño o dueña del calendario: su acceso no se cambia desde el panel.", "ES_DUENO");
  }
  return c;
}

function rolPedido(permiso: unknown): RolEscrito {
  if (permiso !== "editor" && permiso !== "lectura") throw new NoSePuedeCompartir("El permiso tiene que ser «Editor» o «Solo lectura».", "PERMISO_INVALIDO");
  return ROL_DE_PERMISO[permiso];
}

/** ¿Google pidió esperar (429, o 403 de límite de uso)? */
export const esLimiteDeUso = (e: unknown): e is ErrorCalDAV =>
  e instanceof ErrorCalDAV && e.codigo === "SERVIDOR" && (e.status === 429 || (e.status === 403 && /l[ií]mite de uso/i.test(e.message)));

/**
 * El texto de un error para un pedido que nada reintenta solo (invitar, permiso, quitar, conectar,
 * «Probar»): a un límite de uso se le agrega «vuelve a intentarlo en un minuto» (y se le saca un «se
 * reintenta solo», que sólo vale para la sincronización). El resto, tal cual.
 */
export function textoSinReintento(e: ErrorCalDAV): string {
  if (!esLimiteDeUso(e) || /int[eé]ntalo|intentarlo/i.test(e.message)) return e.message;
  const base = e.message.replace(/[\s:;,.]*se reintenta solo[\s.]*$/i, "").replace(/[\s:;,.]+$/, "");
  return `${base}: vuelve a intentarlo en un minuto.`;
}

/** El mismo error con el texto de textoSinReintento (lo demás igual). */
export const sinReintento = (e: unknown): unknown =>
  e instanceof ErrorCalDAV && esLimiteDeUso(e) ? new ErrorCalDAV(textoSinReintento(e), e.status, e.codigo) : e;

const administra = (c: string) =>
  new NoSePuedeCompartir(`${c} administra el calendario en Google Calendar: su acceso se cambia allá, no desde el panel.`, "ADMINISTRA");

/**
 * Un 404/410 de una regla también es lo que Google responde cuando el panel ya no ve el calendario (se
 * dejó de compartir con la cuenta de servicio, o se borró): se confirma que el calendario se sigue
 * viendo. Si no, lanza NO_ENCONTRADO (g.calendario). Un pedido más, y sólo después de un 404.
 */
async function confirmarCalendario(g: GoogleCalendar, calId: string): Promise<void> {
  await g.calendario(calId);
}

/**
 * La regla de ese correo: {rol}, null si no tiene, o "sinPermiso" si el panel no puede leer la ACL.
 * Con `confirmar`, un 404 sólo es «no tiene» si el calendario se sigue viendo (ver confirmarCalendario).
 */
async function reglaDe(g: GoogleCalendar, calId: string, correo: string, confirmar = false): Promise<{ rol: string } | null | "sinPermiso"> {
  const r = await g.pedirJSON("GET", rutaRegla(calId, correo), { query: { fields: "id,role,scope" } });
  if (r.status === 200) {
    const rol = textoDe(r.json?.role);
    return rol && rol !== "none" ? { rol } : null;
  }
  if (r.status === 404 || r.status === 410) {
    if (confirmar) await confirmarCalendario(g, calId);
    return null;
  }
  if (r.status === 403) return "sinPermiso";
  throw g.errorDe(r, "ver con quién se comparte el calendario");
}

/** PATCH del rol de una regla que existe (y que ya se revisó que no es owner). */
async function parcharRegla(g: GoogleCalendar, calId: string, correo: string, rol: RolEscrito): Promise<ResultadoCambiar> {
  const r = await g.pedirJSON("PATCH", rutaRegla(calId, correo), { query: { fields: "id,role,scope" }, cuerpo: { role: rol } });
  if (r.status === 200) return { modo: "panel", regla: { correo, rol: textoDe(r.json?.role) || rol } };
  if (r.status === 404 || r.status === 410) return { modo: "noEsta" };
  if (r.status === 403) return { modo: "manual" };
  throw g.errorDe(r, "cambiar con quién se comparte el calendario");
}

/**
 * Las reglas de usuario de la ACL (sin la del panel) y si el panel puede invitar. "Puede" sale del rol
 * del panel (owner), no de poder leer la ACL: con «Realizar cambios y ver los detalles» (writer) Google
 * deja leerla pero no cambiarla.
 */
export async function permisos(g: GoogleCalendar, calId: string): Promise<ResultadoPermisos> {
  const reglas: ReglaPersona[] = [];
  const panel = g.correo.toLowerCase();
  let propio: string | null = null;
  let pageToken: string | undefined;
  for (let pagina = 0; ; pagina++) {
    if (pagina >= MAX_PAGINAS) throw new ErrorCalDAV("La lista de personas del calendario es demasiado larga.", 0, "SERVIDOR");
    if (g.queda() < 800) throw errorTiempo();
    const r: RespuestaGoogle = await g.pedirJSON("GET", `${rutaCalendario(calId)}/acl`, {
      query: { maxResults: "250", fields: "items(id,role,scope),nextPageToken", ...(pageToken ? { pageToken } : {}) },
    });
    if (r.status === 403) return { puede: false };
    if (r.status !== 200) throw g.errorDe(r, "ver con quién se comparte el calendario");
    const items = Array.isArray(r.json?.items) ? (r.json!.items as unknown[]).filter(esObjeto) : [];
    for (const x of items) {
      const scope = esObjeto(x.scope) ? x.scope : {};
      const rol = textoDe(x.role);
      const correo = normalizarCorreo(scope.value);
      if (scope.type !== "user" || !correo || !rol || rol === "none") continue;
      if (correo === panel) propio = rol;
      else reglas.push({ correo, rol });
    }
    const sig = textoDe(r.json?.nextPageToken);
    if (!sig) break;
    pageToken = sig;
  }
  // Sin regla propia de usuario (p. ej. compartido con un grupo): el accessRole lo dice.
  const puede = propio !== null ? propio === "owner" : await puedeInvitar(g, calId);
  reglas.sort((a, b) => (a.correo < b.correo ? -1 : a.correo > b.correo ? 1 : 0));
  return puede ? { puede: true, reglas } : { puede: false, reglas };
}

/** ¿El panel administra el uso compartido del calendario? (accessRole owner; 1 pedido) */
export async function puedeInvitar(g: GoogleCalendar, calId: string): Promise<boolean> {
  return (await g.calendario(calId)).rol === "owner";
}

/** Comparte el calendario con ese correo (Google le manda la invitación). */
export async function invitar(g: GoogleCalendar, calId: string, correo: unknown, permiso: unknown, ctx: ContextoCompartir = {}): Promise<ResultadoInvitar> {
  const c = revisar(g, correo, ctx);
  const rol = rolPedido(permiso);
  if ((ctx.personas ?? 0) >= MAX_PERSONAS) throw new NoSePuedeCompartir(`Se puede compartir con ${MAX_PERSONAS} personas como máximo desde el panel.`, "MAXIMO");
  const actual = await reglaDe(g, calId, c);
  if (actual === "sinPermiso") return { modo: "manual" };
  if (actual?.rol === "owner") throw administra(c);
  if (actual) {
    if (actual.rol === rol) return { modo: "panel", regla: { correo: c, rol }, igual: true };
    const r = await parcharRegla(g, calId, c, rol);
    return r.modo === "noEsta" ? insertar(g, calId, c, rol) : r;
  }
  return insertar(g, calId, c, rol);
}

async function insertar(g: GoogleCalendar, calId: string, c: string, rol: RolEscrito): Promise<ResultadoInvitar> {
  const r = await g.pedirJSON("POST", `${rutaCalendario(calId)}/acl`, {
    query: { sendNotifications: "true", fields: "id,role,scope" },
    cuerpo: { role: rol, scope: { type: "user", value: c } },
  });
  if (r.status === 200) return { modo: "panel", regla: { correo: c, rol: textoDe(r.json?.role) || rol } };
  if (r.status === 403) return { modo: "manual" };
  if (r.status === 409) {
    // Alguien la agregó entre medio: se revisa de nuevo (nunca se pisa a quien administra).
    const otra = await reglaDe(g, calId, c);
    if (otra === "sinPermiso") return { modo: "manual" };
    if (otra?.rol === "owner") throw administra(c);
    if (otra?.rol === rol) return { modo: "panel", regla: { correo: c, rol }, igual: true };
    const p = await parcharRegla(g, calId, c, rol);
    if (p.modo === "noEsta") throw new ErrorCalDAV("Google Calendar cambió la lista de personas mientras tanto: inténtalo de nuevo.", 409, "SERVIDOR");
    return p;
  }
  throw g.errorDe(r, "compartir el calendario");
}

/** Cambia el permiso de alguien que ya tiene acceso. */
export async function cambiarPermiso(
  g: GoogleCalendar,
  calId: string,
  correo: unknown,
  permiso: unknown,
  ctx: ContextoCompartir = {},
): Promise<ResultadoCambiar> {
  const c = revisar(g, correo, ctx);
  const rol = rolPedido(permiso);
  const actual = await reglaDe(g, calId, c, true);
  if (actual === "sinPermiso") return { modo: "manual" };
  if (!actual) return { modo: "noEsta" };
  if (actual.rol === "owner") throw administra(c);
  if (actual.rol === rol) return { modo: "panel", regla: { correo: c, rol }, igual: true };
  const r = await parcharRegla(g, calId, c, rol);
  if (r.modo === "noEsta") await confirmarCalendario(g, calId);
  return r;
}

/** Deja de compartir el calendario con ese correo (si ya no estaba, también está bien). */
export async function quitar(g: GoogleCalendar, calId: string, correo: unknown, ctx: ContextoCompartir = {}): Promise<ResultadoQuitar> {
  const c = revisar(g, correo, ctx);
  const actual = await reglaDe(g, calId, c, true);
  if (actual === "sinPermiso") return { modo: "manual" };
  if (!actual) return { modo: "panel", yaNoEstaba: true };
  if (actual.rol === "owner") throw administra(c);
  const r = await g.pedirJSON("DELETE", rutaRegla(calId, c));
  if (r.status === 204 || r.status === 200) return { modo: "panel" };
  if (r.status === 404 || r.status === 410) {
    await confirmarCalendario(g, calId);
    return { modo: "panel", yaNoEstaba: true };
  }
  if (r.status === 403) return { modo: "manual" };
  throw g.errorDe(r, "dejar de compartir el calendario");
}
