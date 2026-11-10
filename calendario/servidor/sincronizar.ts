// Sincronización en ambos sentidos entre la colección "eventos" de una familia y un calendario
// conectado: iCloud (CalDAV) o Google Calendar. El motor sólo conoce el contrato `Transporte` de
// servidor/proveedores.ts (recursos .ics con su etag y escrituras condicionales).
//
// Para cada recurso (serie) se guarda en Blobs su ETag y la "huella" de cómo quedó la última vez
// que el panel y el calendario coincidieron. Así se sabe qué lado cambió:
//   - cambió sólo el calendario (ETag distinto)  → se trae al panel
//   - cambió sólo el panel (huella distinta)      → se sube (PUT con If-Match: nunca pisa a ciegas)
//   - cambiaron los dos                           → gana el cambio más reciente (LAST-MODIFIED vs `actualizado`)
//   - se borró en un lado sin cambios en el otro   → se borra en el otro; si el otro sí cambió, gana el cambio
// Eventos nuevos del panel se crean con UID `<id>@calendario-familiar` (If-None-Match: *), así un
// reintento nunca duplica. Si de una vez se borraría mucho, se detiene y pregunta (ver `resolver`).

import { ErrorCalDAV } from "./caldav";
import { nombreProveedor, textoSinCuenta, transporteDe, type Transporte } from "./proveedores";
import { LimiteDeUso } from "./google/transporte";
import {
  NoSePuedeEscribir,
  SUFIJO_UID,
  enCalendario,
  escribirRecurso,
  huellaGrupo,
  idDe,
  idPropioDe,
  leerRecurso,
  uidDe,
  ventanaDe,
  type Contexto,
} from "./ics";
import {
  almacen,
  anotarVersiones,
  guardarColeccion,
  huella,
  idAzar,
  leerAcceso,
  leerColeccion,
  type ConexionCalendario,
} from "./comun";
import { canonico } from "../lib/eventos";
import { normalizarEvento } from "../lib/datos/normalizar";
import { ahoraEnSantiago } from "../lib/fechas";
import type { Evento, Miembro } from "../lib/datos/tipos";
import { createHash } from "node:crypto";

export type Conexion = ConexionCalendario;

type Externo = NonNullable<Evento["externo"]>;

interface Recurso {
  href: string;
  etag: string | null; // null: hay que volver a leerlo (no se supo después de escribir, o cambió el año)
  huella: string;
  /** Eventos del panel de esta serie: [id, día cambiado?]. Para volver a vincularlos si pierden `externo`. */
  ids?: [string, string?][];
}

export interface EstadoSync {
  recursos: Record<string, Recurso>; // por UID (o "~<href>" si no tiene eventos: tareas, etc.)
  ctag?: string | null;
  versionEventos?: number;
  huellaMiembros?: string;
  ventana?: string;
  pendiente?: boolean; // quedó trabajo para la próxima vuelta
  ultima?: string; // ISO: última vez que terminó bien
  intento?: string; // ISO: último intento
  /** `uids`: los eventos que mostraba un aviso de borrado masivo (la respuesta vale sólo para esos). */
  error?: { mensaje: string; codigo?: string; cuando: string; cuantos?: number; uids?: string[] } | null;
  resumen?: Resumen;
  avisos?: string[];
  /**
   * La familia aceptó borrar muchos de una vez: vale sólo para esos (`uids`, de uno o de los dos avisos)
   * y un rato, mientras se terminan de borrar. Otro borrado masivo vuelve a preguntar.
   */
  decision?: { hasta: string; uids?: string[] };
  /**
   * La respuesta a un aviso de borrado masivo, anotada hasta que una vuelta alcance a listar el
   * calendario (iCloud lento, o se tomó el candado al final del plazo). Vale sólo para los eventos que
   * mostró el aviso (`uids`).
   */
  respuesta?: { resolver: Resolver; codigo: string; uids?: string[]; hasta: string };
  /**
   * Al conectar se eligió no subir los eventos que ya estaban: sus ids. La primera vuelta (con el
   * candado) los deja "sólo en el panel"; se borra cuando quedó guardado.
   */
  soloPanelInicial?: string[];
}

export interface Resumen {
  traidos: number;
  subidos: number;
  borradosAqui: number;
  borradosAlla: number;
}

export type Resolver = "borrar" | "recuperar";

export interface Resultado {
  ok: boolean;
  ocupado?: boolean;
  resumen?: Resumen;
  error?: EstadoSync["error"];
  pendiente?: boolean;
  /**
   * Qué pasó con la respuesta a un aviso: se aplicó, quedó anotada (sigue sola), mientras tanto se
   * borraron otros (no se aplicó) o ese aviso ya no estaba.
   */
  respuesta?: "aplicada" | "anotada" | "vieja" | "sinAviso";
}

// ---------- Credenciales y almacenamiento ----------

/** Apple ID y contraseña de app del panel (ahora vive en proveedores.ts; se re-exporta para las funciones). */
export { credencialesICloud } from "./proveedores";

export const usuarioOculto = (u: string) =>
  u.includes("@") ? u.replace(/^(.{1,2}).*(@.*)$/, "$1…$2") : u.length > 4 ? `${u.slice(0, 2)}…${u.slice(-2)}` : "…";

const claveEstado = (familiaId: string, conexionId: string) => `externos/estado/${familiaId}/${conexionId}`;
/** Una respuesta a un aviso que llegó mientras otra sincronización tenía el candado (la toma la siguiente). */
const claveEnEspera = (familiaId: string, conexionId: string) => `externos/respuesta/${familiaId}/${conexionId}`;
interface EnEspera {
  resolver: Resolver;
  codigo?: string;
  uids?: string[];
  hasta: string;
}
/** Qué familia usa la cuenta de iCloud del sitio (sólo puede ser una). */
export const CLAVE_DUENO_ICLOUD = "externos/icloud";

export async function leerEstado(familiaId: string, conexionId: string): Promise<EstadoSync | null> {
  return (await almacen().get(claveEstado(familiaId, conexionId), { type: "json" })) as EstadoSync | null;
}

export async function guardarEstado(familiaId: string, conexionId: string, e: EstadoSync) {
  await almacen().setJSON(claveEstado(familiaId, conexionId), e);
}

export async function borrarEstado(familiaId: string, conexionId: string) {
  await almacen().delete(claveEstado(familiaId, conexionId));
  await almacen().delete(claveEnEspera(familiaId, conexionId));
}

/**
 * Una sola cosa a la vez por calendario (sincronizar, desconectar). Si está ocupado, espera hasta
 * `esperar` ms; un candado de más de 60 s es de una función que se cortó y se descarta.
 */
export async function conCandado<T>(familiaId: string, conexionId: string, fn: () => Promise<T>, esperar = 0): Promise<T | "ocupado"> {
  const store = almacen();
  const k = `candados/sync/${familiaId}-${conexionId}`;
  const hasta = Date.now() + esperar;
  for (;;) {
    const r = await store.setJSON(k, { desde: Date.now() }, { onlyIfNew: true });
    if (r.modified) {
      try {
        return await fn();
      } finally {
        await store.delete(k).catch(() => {});
      }
    }
    const c = (await store.get(k, { type: "json" })) as { desde: number } | null;
    if (c && Date.now() - c.desde > 60_000) {
      await store.delete(k).catch(() => {});
      continue;
    }
    if (Date.now() >= hasta) return "ocupado";
    await new Promise((ok) => setTimeout(ok, 400));
  }
}

// ---------- Cambios en la colección ----------

type Op =
  | { tipo: "limpiar"; vivas: string[] } // quita el vínculo de calendarios que ya no están conectados
  | { tipo: "vincular"; id: string; externo: Externo }
  | { tipo: "grupo"; uid: string; ids: string[]; eventos: Evento[]; base: string }
  | { tipo: "desvincular"; uid: string; soloPanel?: boolean }
  | { tipo: "soloPanel"; id: string };

function sinExterno(e: Evento): Evento {
  const { externo: _, ...resto } = e;
  return resto;
}

const idsDe = (eventos: Evento[]): [string, string?][] =>
  eventos.map((e) => (e.externo?.recurrencia ? [e.id, e.externo.recurrencia] : [e.id]));

/** Huella de todo lo del panel (incluido lo que no se sube), para saber si alguien lo tocó entre medio. */
const huellaLocal = (eventos: Evento[]) =>
  createHash("sha256")
    .update(JSON.stringify(eventos.map(canonico).sort((a, b) => a.id.localeCompare(b.id))))
    .digest("hex");

function selector(conexion: string, uid: string, ids: string[]) {
  const set = new Set(ids);
  return (e: Evento) => (e.externo?.conexion === conexion && e.externo.uid === uid) || (!e.externo && set.has(e.id));
}

function aplicar(lista: Evento[], ops: Op[], conexion: string): { eventos: Evento[]; omitidos: Set<string> } {
  let r = [...lista];
  const omitidos = new Set<string>();
  for (const op of ops) {
    if (op.tipo === "grupo") {
      const sel = selector(conexion, op.uid, op.ids);
      const actuales = r.filter(sel);
      // Alguien cambió esos eventos en el panel mientras se sincronizaba: se deja para la próxima vuelta.
      if (huellaLocal(actuales) !== op.base) {
        omitidos.add(op.uid);
        continue;
      }
      const i = r.findIndex(sel);
      r = r.filter((e) => !sel(e));
      r.splice(i < 0 ? r.length : i, 0, ...op.eventos);
    } else if (op.tipo === "vincular") {
      r = r.map((e) => (e.id === op.id && !e.externo ? { ...e, externo: op.externo } : e));
    } else if (op.tipo === "limpiar") {
      r = r.map((e) => (e.externo && !op.vivas.includes(e.externo.conexion) ? sinExterno(e) : e));
    } else if (op.tipo === "soloPanel") {
      r = r.map((e) => (e.id === op.id ? { ...e, soloPanel: true } : e));
    } else {
      // Al sacar una serie del calendario quedan sólo en el panel también sus días cambiados (si no,
      // volverían a subir como eventos sueltos).
      r = r.map((e) =>
        e.externo?.conexion !== conexion || e.externo.uid !== op.uid ? e : { ...sinExterno(e), ...(op.soloPanel ? { soloPanel: true } : {}) },
      );
    }
  }
  return { eventos: r, omitidos };
}

function miembrosDe(datos: unknown): Miembro[] {
  if (!Array.isArray(datos)) return [];
  return datos.filter(
    (m): m is Miembro => !!m && typeof m.id === "string" && typeof m.nombre === "string" && typeof m.emoji === "string",
  );
}

const nombreRecurso = (href: string) => decodeURIComponent(href.split("/").filter(Boolean).pop() ?? "");
const nombreSeguro = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 120);

// ---------- La sincronización ----------

interface Opciones {
  /** Hasta cuándo (Date.now()) se puede trabajar; lo que no alcance queda para la próxima vuelta. */
  limite: number;
  resolver?: Resolver;
  /** El aviso que se estaba mostrando cuando se respondió (si ya cambió, la respuesta no vale). */
  codigo?: string;
  /** Los eventos de ese aviso (`error.uids`): si mientras tanto se borraron otros, no se aceptan a ciegas. */
  uids?: string[];
}

/** Lo que una vuelta le pasa a la siguiente de la misma llamada (interno). */
interface OpcionesVuelta extends Opciones {
  /** Los avisos que guardaron las vueltas anteriores de esta llamada (se conservan: ver juntarAvisos). */
  avisosAntes?: string[];
}

/** Cuántos avisos se guardan a la vez (los primeros). */
export const MAX_AVISOS = 5;

/**
 * Los avisos que quedan a la vista: los de las vueltas anteriores de la misma llamada y después los de
 * ésta que no estaban ya, hasta MAX_AVISOS (undefined si no hay). Así no se pierde el aviso de una vuelta
 * cuando la siguiente resuelve lo que avisó (p. ej. un evento que iCloud no deja borrar y que la vuelta
 * siguiente trae de vuelta a la pared), y otra vuelta que avisa lo mismo no lo repite. Con una sola vuelta
 * (`antes` vacío) queda igual que siempre: los primeros MAX_AVISOS de esa vuelta.
 */
export function juntarAvisos(antes: readonly string[], nuevos: readonly string[]): string[] | undefined {
  const todos = [...antes, ...nuevos.filter((a) => !antes.includes(a))].slice(0, MAX_AVISOS);
  return todos.length ? todos : undefined;
}

/**
 * El texto de un error para la familia. Un límite de uso de Google se reintenta solo (la vuelta siguiente,
 * o la programada en unos minutos, vuelve a pedir): se dice aquí y no en el transporte, porque invitar,
 * quitar o "Probar" no reintentan.
 */
const textoError = (e: ErrorCalDAV) => (e instanceof LimiteDeUso ? `${e.message} Se reintenta solo.` : e.message);

export async function sincronizar(familiaId: string, conexion: Conexion, op: Opciones): Promise<Resultado> {
  // Con una respuesta de la familia (borrar / traer de vuelta) se espera a que termine la que esté
  // corriendo: si no, la respuesta se perdería.
  const esperar = op.resolver ? Math.max(0, op.limite - Date.now() - 3500) : 0;
  const r = await conCandado(familiaId, conexion.id, async () => {
    let resultado: Resultado = { ok: true };
    let respuesta: Resultado["respuesta"];
    let avisosAntes: string[] = [];
    // Si quedó trabajo o mientras tanto cambió algo en el panel, se da otra vuelta (hasta 3, si alcanza el tiempo).
    for (let vuelta = 0; vuelta < 3; vuelta++) {
      const { avisos, ...esta } = await unaVuelta(familiaId, conexion, { ...op, resolver: vuelta ? undefined : op.resolver, avisosAntes });
      resultado = esta;
      // Los avisos de esta llamada siguen a la vista aunque la vuelta siguiente no tenga nada que avisar.
      if (avisos) avisosAntes = avisos;
      // Una respuesta anotada se aplica en una vuelta siguiente (de ésta o de la programada).
      if (resultado.respuesta && respuesta !== "aplicada") respuesta = resultado.respuesta;
      if (!resultado.ok || op.limite - Date.now() < 4000) break;
      const estado = await leerEstado(familiaId, conexion.id);
      const col = await leerColeccion(familiaId, "eventos");
      if (!estado || (!estado.pendiente && estado.versionEventos === (col?.version ?? 0))) break;
    }
    return respuesta ? { ...resultado, respuesta } : resultado;
  }, esperar);
  if (r !== "ocupado") return r;
  if (!op.resolver) return { ok: true, ocupado: true };
  // La que está corriendo no alcanzó a terminar: la respuesta queda en espera (fuera del estado, que es
  // de la que tiene el candado) y la toma la próxima vuelta.
  const enEspera: EnEspera = { resolver: op.resolver, codigo: op.codigo, uids: op.uids, hasta: new Date(Date.now() + 30 * 60_000).toISOString() };
  await almacen().setJSON(claveEnEspera(familiaId, conexion.id), enEspera);
  return { ok: true, ocupado: true, respuesta: "anotada" };
}

const MARGEN_BLOBS = 1500; // lo que se reserva al final para guardar en Blobs

/** `avisos`: los que quedaron guardados en el estado al terminar la vuelta (si llegó a guardarlos). */
async function unaVuelta(familiaId: string, conexion: Conexion, op: OpcionesVuelta): Promise<Resultado & { avisos?: string[] }> {
  const ahora = new Date().toISOString();
  const [leido, enEspera] = await Promise.all([
    leerEstado(familiaId, conexion.id),
    op.resolver ? null : (almacen().get(claveEnEspera(familiaId, conexion.id), { type: "json" }) as Promise<EnEspera | null>),
  ]);
  const estado: EstadoSync = leido ?? { recursos: {} };
  estado.intento = ahora;
  if (estado.decision && estado.decision.hasta < ahora) delete estado.decision;
  if (estado.respuesta && estado.respuesta.hasta < ahora) delete estado.respuesta;
  // La respuesta vale sólo para el aviso que se respondió (si sigue siendo el que está a la vista) y para
  // su lista. Queda anotada en el estado: si esta vuelta no alcanza a listar el calendario, la aplica la
  // próxima que sí alcance (la programada, por ejemplo).
  let respuesta: Resultado["respuesta"];
  const pedida = op.resolver ? { ...op, resolver: op.resolver } : enEspera && enEspera.hasta > ahora ? enEspera : null;
  if (pedida && estado.error?.codigo?.startsWith("MUCHOS_BORRADOS_") && (!pedida.codigo || pedida.codigo === estado.error.codigo)) {
    const hasta = new Date(Date.now() + 30 * 60_000).toISOString();
    estado.respuesta = { resolver: pedida.resolver, codigo: estado.error.codigo, uids: pedida.uids ?? estado.error.uids, hasta };
    respuesta = "anotada";
  } else if (op.resolver) respuesta = "sinAviso";
  if (enEspera) {
    // Primero queda en el estado y recién después se borra la espera (si la función se corta, no se pierde).
    if (estado.respuesta) await guardarEstado(familiaId, conexion.id, estado);
    await almacen().delete(claveEnEspera(familiaId, conexion.id));
  }
  const fallar = async (mensaje: string, codigo?: string, cuantos?: number, uids?: string[]): Promise<Resultado> => {
    estado.error = { mensaje, codigo, cuando: ahora, cuantos, ...(uids ? { uids } : {}) };
    await guardarEstado(familiaId, conexion.id, estado);
    return { ok: false, error: estado.error, respuesta };
  };

  const hasta = op.limite - MARGEN_BLOBS;
  const queda = () => hasta - Date.now();
  const cal = transporteDe(conexion, 8000, hasta);
  if (!cal) return fallar(textoSinCuenta(conexion.proveedor), "SIN_CUENTA");
  /** "iCloud" o "Google Calendar", para los textos (los códigos no cambian). */
  const nombreProv = nombreProveedor(conexion.proveedor);

  try {
    const [colEventos, colMiembros, acceso] = await Promise.all([
      leerColeccion(familiaId, "eventos"),
      leerColeccion(familiaId, "miembros"),
      leerAcceso(familiaId),
    ]);
    const vivas = (acceso?.calendarios ?? []).map((c) => c.id);
    if (!vivas.includes(conexion.id)) return { ok: true }; // se desconectó: no queda nada que hacer
    const version = colEventos?.version ?? 0;
    const ops: Op[] = [];
    let eventos = (Array.isArray(colEventos?.datos) ? colEventos!.datos : [])
      .map(normalizarEvento)
      .filter((e): e is Evento => !!e);
    // Vínculos con calendarios que ya no están conectados no cuentan (p. ej. de una sincronización que
    // terminó justo después de desconectar).
    if (eventos.some((e) => e.externo && !vivas.includes(e.externo.conexion))) {
      ops.push({ tipo: "limpiar", vivas });
      eventos = eventos.map((e) => (e.externo && !vivas.includes(e.externo.conexion) ? sinExterno(e) : e));
    }
    const miembros = miembrosDe(colMiembros?.datos);
    const hoy = ahoraEnSantiago().fecha;
    const ctx: Contexto = { conexion: conexion.id, miembros, hoy };
    const ventana = JSON.stringify(ventanaDe(hoy));
    const huellaMiembros = huella(JSON.stringify(miembros.map((m) => [m.id, m.nombre, m.emoji])));
    // Cambió el año: cada serie se vuelve a leer una vez (para recalcular sus fechas sueltas). Queda
    // anotado en el estado, así una vuelta que no alcanza a todas sigue en la próxima.
    if (estado.ventana !== ventana) {
      if (estado.ventana !== undefined) for (const r of Object.values(estado.recursos)) r.etag = null;
      estado.ventana = ventana;
    }
    const porReleer = Object.values(estado.recursos).some((r) => r.etag === null);

    // Atajo: nada cambió en el panel ni en el calendario (un solo pedido liviano a iCloud).
    if (
      !op.resolver &&
      !estado.respuesta &&
      !estado.soloPanelInicial?.length &&
      !estado.pendiente &&
      !estado.error &&
      !porReleer &&
      !ops.length &&
      estado.ctag &&
      estado.versionEventos === version &&
      estado.huellaMiembros === huellaMiembros
    ) {
      const ctag = await cal.ctag(conexion.url);
      if (ctag === estado.ctag) {
        estado.ultima = ahora;
        await guardarEstado(familiaId, conexion.id, estado);
        return { ok: true, resumen: { traidos: 0, subidos: 0, borradosAqui: 0, borradosAlla: 0 } };
      }
    }

    const lista = await cal.listar(conexion.url);

    // Eventos del panel que perdieron su vínculo (un formulario abierto desde antes de vincularse, un
    // respaldo cargado) pero siguen siendo de una serie conocida: se vuelven a vincular, no se suben de nuevo.
    const porId = new Map<string, Externo>();
    for (const [uid, r] of Object.entries(estado.recursos)) {
      if (uid.startsWith("~")) continue;
      for (const [id, rec] of r.ids ?? []) porId.set(id, rec ? { conexion: conexion.id, uid, recurrencia: rec } : { conexion: conexion.id, uid });
      const propio = idPropioDe(uid);
      if (propio && !porId.has(propio)) porId.set(propio, { conexion: conexion.id, uid });
    }
    const idsVinculados = new Set(eventos.filter((e) => e.externo).map((e) => e.id));
    eventos = eventos.map((e) => {
      const ext = e.externo ? undefined : porId.get(e.id);
      if (!ext || idsVinculados.has(e.id)) return e;
      ops.push({ tipo: "vincular", id: e.id, externo: ext });
      return { ...e, externo: ext };
    });
    // Al conectar se eligió que los eventos que ya estaban queden sólo en el panel (se marca aquí, con
    // el candado: así ninguna otra sincronización alcanza a subirlos antes). Mientras no se haya leído
    // todo el calendario la marca vale sólo en memoria (ver `faltaLeer`): los que tienen par en iCloud se
    // vinculan, y la pared no muestra "sólo en el panel" algo que después se sube.
    const inicial = new Set(estado.soloPanelInicial ?? []);
    const marcasInicial = new Set<Op>();
    if (inicial.size)
      eventos = eventos.map((e) => {
        if (!inicial.has(e.id) || e.soloPanel || e.externo) return e;
        const m: Op = { tipo: "soloPanel", id: e.id };
        marcasInicial.add(m);
        ops.push(m);
        return { ...e, soloPanel: true };
      });

    const grupos = new Map<string, Evento[]>();
    for (const e of eventos) {
      if (e.externo?.conexion !== conexion.id) continue;
      grupos.set(e.externo.uid, [...(grupos.get(e.externo.uid) ?? []), e]);
    }
    const uidPorHref = new Map(Object.entries(estado.recursos).map(([uid, r]) => [r.href, uid]));

    const parches = new Map<string, Recurso | null>(); // uid → recurso nuevo (null: sacarlo del estado)
    const traer: string[] = []; // uid conocidos que cambiaron en el calendario
    const subir: string[] = []; // uid que cambiaron en el panel
    const conflicto: string[] = []; // cambiaron en los dos lados
    const borrarAlla: string[] = [];
    const borrarAqui: string[] = [];
    const recrearAlla: string[] = [];
    const nuevosRemotos: string[] = []; // href desconocidos

    for (const [uid, rec] of Object.entries(estado.recursos)) {
      const local = grupos.get(uid) ?? [];
      if (!rec.ids && local.length) rec.ids = idsDe(local);
      const cambioLocal = huellaGrupo(local, miembros) !== rec.huella;
      const etag = lista.recursos.get(rec.href);
      if (uid.startsWith("~")) {
        if (etag === undefined) delete estado.recursos[uid];
        else if (etag !== rec.etag) nuevosRemotos.push(rec.href);
        continue;
      }
      if (etag === undefined) {
        // Ya no está en el calendario. Si en el panel la serie quedó "sólo en el panel", se respeta (no se
        // borra aquí); si no cambió aquí, se borra aquí; si cambió aquí, se vuelve a crear allá.
        if (!enCalendario(local).length) {
          if (local.length) ops.push({ tipo: "desvincular", uid, soloPanel: true });
          parches.set(uid, null);
        } else if (!cambioLocal) borrarAqui.push(uid);
        else recrearAlla.push(uid);
        continue;
      }
      const cambioRemoto = rec.etag === null || etag !== rec.etag;
      if (!cambioLocal && !cambioRemoto) continue;
      if (cambioLocal && cambioRemoto) conflicto.push(uid);
      else if (cambioRemoto) traer.push(uid);
      else if (!enCalendario(local).length) borrarAlla.push(uid);
      else subir.push(uid);
    }
    for (const href of lista.recursos.keys()) if (!uidPorHref.has(href)) nuevosRemotos.push(href);

    // Lo que la familia eligió cuando se iba a borrar mucho de una vez. Cada respuesta toca sólo la lista
    // de su aviso ("panel": los borrados aquí que se borrarían en iCloud; "iCloud": los que desaparecieron
    // allá y se borrarían aquí), y sólo a los eventos que mostró el aviso: lo borrado después pasa por el
    // seguro como siempre.
    const resp = estado.respuesta;
    if (resp) {
      delete estado.respuesta; // se aplica ahora o ya no vale
      const panel = resp.codigo === "MUCHOS_BORRADOS_PANEL";
      const l = panel ? borrarAlla : borrarAqui;
      const vistos = new Set(resp.uids ?? l);
      if (resp.resolver === "recuperar") {
        // Traerlos de vuelta no borra nada: vale para los del aviso que todavía se borrarían (lo borrado
        // después pasa por el seguro como siempre).
        respuesta = "aplicada";
        const esos = l.filter((u) => vistos.has(u));
        if (panel) {
          for (const uid of esos) estado.recursos[uid].etag = null; // se vuelve a traer desde iCloud
          traer.push(...esos);
        } else {
          for (const uid of esos) estado.recursos[uid].huella = ""; // se vuelve a subir a iCloud
          recrearAlla.push(...esos);
        }
        const quedan = l.filter((u) => !vistos.has(u));
        l.splice(0, l.length, ...quedan);
      } else if (l.some((u) => !vistos.has(u))) respuesta = "vieja"; // se borraron otros: el seguro decide de nuevo
      else {
        respuesta = "aplicada";
        // Se suma a lo ya aceptado (con los dos avisos a la vez, una respuesta no deshace la otra). Queda
        // anotado en el estado, así vale también para lo que no alcance en esta vuelta.
        const uids = [...new Set([...(estado.decision?.uids ?? []), ...l])];
        estado.decision = { hasta: new Date(Date.now() + 30 * 60_000).toISOString(), uids };
      }
    }
    // Seguro: si de una vez se borraría mucho, se pregunta antes (p. ej. al restaurar un respaldo viejo).
    // Lo que la familia ya aceptó no cuenta.
    const total = Object.keys(estado.recursos).length;
    const muchos = (n: number) => n >= 5 && n > total * 0.3;
    const aceptados = new Set(estado.decision?.uids ?? []);
    const sinAceptar = (l: string[]) => l.filter((u) => !aceptados.has(u)).length;
    if (muchos(sinAceptar(borrarAlla)))
      return fallar(
        `Se borraron del panel ${borrarAlla.length} eventos que están en ${nombreProv}. ¿Se borran también de los iPhone?`,
        "MUCHOS_BORRADOS_PANEL",
        borrarAlla.length,
        [...borrarAlla],
      );
    if (muchos(sinAceptar(borrarAqui)))
      return fallar(
        `Desaparecieron de ${nombreProv} ${borrarAqui.length} eventos. ¿Se borran también del panel?`,
        "MUCHOS_BORRADOS_ICLOUD",
        borrarAqui.length,
        [...borrarAqui],
      );

    const yaVistos = new Set<string>(); // eventos del panel ya resueltos con una serie del calendario
    const resumen: Resumen = { traidos: 0, subidos: 0, borradosAqui: 0, borradosAlla: 0 };
    const avisos: string[] = [];
    let pendiente = false;
    // El primer error de iCloud al escribir detiene las escrituras siguientes, pero lo ya hecho se guarda.
    let falla: ErrorCalDAV | null = null;
    let detenido = false;
    const puedeEscribir = () => {
      if (detenido || queda() < 1200) {
        pendiente = true;
        return false;
      }
      return true;
    };
    const alFallar = (e: unknown) => {
      if (!(e instanceof ErrorCalDAV)) throw e;
      detenido = true;
      pendiente = true;
      if (e.codigo !== "TIEMPO") falla ??= e;
    };

    const sel = (uid: string, ids: string[]) => eventos.filter(selector(conexion.id, uid, ids));
    const ponerGrupo = (uid: string, nuevos: Evento[], ids: string[] = []) => {
      const todos = [...new Set([...ids, ...nuevos.map((e) => e.id)])];
      ops.push({ tipo: "grupo", uid, ids: todos, eventos: nuevos, base: huellaLocal(sel(uid, todos)) });
    };
    const conFechas = (l: Evento[]) => l.some((e) => e.fechas?.length);
    const masReciente = (local: Evento[]) => enCalendario(local).map((e) => e.actualizado ?? "").sort().pop() ?? "";

    // 1. Leer del calendario lo que hace falta (de a tandas, mientras alcance el tiempo).
    const porLeer = new Map<string, string>(); // href → uid conocido ("" si es nuevo)
    for (const uid of [...traer, ...subir, ...conflicto]) porLeer.set(estado.recursos[uid].href, uid);
    for (const href of nuevosRemotos) porLeer.set(href, uidPorHref.get(href) ?? "");
    const procesados = new Set<string>(); // href ya leídos y resueltos en esta vuelta

    const subirGrupo = async (uid: string, href: string, etag: string, ics: string, local: Evento[], remoto: Evento[]) => {
      const h = huellaGrupo(local, miembros);
      if (h === huellaGrupo(remoto, miembros)) return void parches.set(uid, { href, etag, huella: h, ids: idsDe(local) });
      if (!puedeEscribir()) return;
      let nuevo: string;
      try {
        nuevo = escribirRecurso(local, ctx, uid, ics);
      } catch (e) {
        if (e instanceof NoSePuedeEscribir) {
          // Un cambio que el panel no sabe escribir sin cambiar otra cosa en los iPhone: manda lo de iCloud.
          ponerGrupo(uid, remoto, local.map((x) => x.id));
          parches.set(uid, { href, etag, huella: huellaGrupo(remoto, miembros), ids: idsDe(remoto) });
          avisos.push(e.message);
          return;
        }
        console.error("no se pudo escribir", uid, e);
        avisos.push(`"${local[0]?.titulo ?? ""}" no se pudo pasar a ${nombreProv}.`);
        return;
      }
      try {
        const r = await cal.actualizar(conexion.url, href, nuevo, etag);
        if (r === "conflicto") pendiente = true; // alguien lo cambió recién: se resuelve en la próxima vuelta
        else if (r === "noExiste") parches.set(uid, null);
        else {
          // Una serie de afuera (con fechas sueltas) se vuelve a leer en la próxima vuelta: al cambiarle la
          // hora pueden cambiar sus días en la pared (otra zona), y su huella no los incluye.
          parches.set(uid, { href, etag: conFechas(local) ? null : r.etag, huella: h, ids: idsDe(local) });
          resumen.subidos++;
        }
      } catch (e) {
        if (e instanceof NoSePuedeEscribir) {
          // El calendario no acepta ese cambio (p. ej. una invitación de Google): manda lo de allá, con aviso.
          // (CalDAV nunca lo lanza.)
          ponerGrupo(uid, remoto, local.map((x) => x.id));
          parches.set(uid, { href, etag, huella: huellaGrupo(remoto, miembros), ids: idsDe(remoto) });
          avisos.push(e.message);
        } else if (e instanceof ErrorCalDAV && e.codigo === "PERMISO") {
          // Calendario de sólo lectura: manda lo de iCloud.
          ponerGrupo(uid, remoto, local.map((x) => x.id));
          parches.set(uid, { href, etag, huella: huellaGrupo(remoto, miembros), ids: idsDe(remoto) });
          avisos.push(`"${local[0]?.titulo ?? ""}": el calendario no deja cambiarlo desde el panel.`);
        } else alFallar(e);
      }
    };

    const procesar = async (href: string, etag: string, ics: string) => {
      const conocido = porLeer.get(href) ?? "";
      let previo: ReturnType<typeof leerRecurso> = null;
      try {
        previo = leerRecurso(ics, ctx);
      } catch (e) {
        console.error("ics ilegible", href, e);
      }
      if (!previo) {
        // Nada del panel se borra por un .ics que no se entiende: queda como estaba, con un aviso.
        if (conocido && !conocido.startsWith("~") && grupos.get(conocido)?.length) {
          avisos.push(`"${grupos.get(conocido)![0].titulo}": ${nombreProv} lo devolvió de una forma que no se pudo leer; quedó como estaba.`);
          parches.set(conocido, { ...estado.recursos[conocido], etag });
          grupos.delete(conocido);
          return;
        }
        if (conocido) parches.set(conocido, null);
        parches.set(`~${href}`, { href, etag, huella: "" });
        return;
      }
      const uid = previo.uid;
      if (conocido && conocido !== uid) parches.set(conocido, null); // el recurso cambió de UID (raro)
      const idsRemotos = previo.eventos.map((e) => e.id);
      const existentes = sel(uid, idsRemotos);
      // Los que habían perdido el vínculo (o se desconectó y se volvió a conectar) toman el de su par
      // remoto. Ya están en el calendario, así que la marca "sólo en el panel" que puso "conectar" no
      // les aplica (y así gana el cambio más reciente, también si se cambió en la pared entre medio).
      const extDe = new Map(previo.eventos.map((e) => [e.id, e.externo!]));
      const vinculados = existentes.map((e) => {
        if (e.externo) return e;
        const { soloPanel: _, ...x } = e;
        return { ...x, externo: extDe.get(e.id) ?? { conexion: conexion.id, uid } };
      });
      const g = leerRecurso(ics, ctx, vinculados)!;
      // Un id que ya usa otro evento del panel (p. ej. una copia en otro calendario): se le da otro.
      const otrosIds = new Set(eventos.filter((e) => !existentes.includes(e)).map((e) => e.id));
      const remoto = g.eventos.map((e) =>
        otrosIds.has(e.id) && !existentes.some((x) => x.id === e.id) ? { ...e, id: idDe(`${uid}|${e.externo?.recurrencia ?? ""}|${conexion.id}`) } : e,
      );
      const rec = estado.recursos[uid];
      const cambioLocal = rec
        ? huellaGrupo(vinculados, miembros) !== rec.huella
        : existentes.length > 0 && huellaGrupo(vinculados, miembros) !== huellaGrupo(remoto, miembros);
      const cambioRemoto = !rec || rec.etag === null || rec.etag !== etag;

      // Cambió sólo el panel: se sube. Cambió en los dos lados (o es una serie que el panel ya tenía, al
      // volver a conectar): gana el cambio más reciente.
      const ganaPanel =
        cambioLocal && enCalendario(vinculados).length > 0 && (!cambioRemoto || masReciente(vinculados) > (g.modificado ?? ""));
      if (ganaPanel) {
        if (existentes.some((e) => !e.externo)) ponerGrupo(uid, vinculados, idsRemotos);
        await subirGrupo(uid, href, etag, ics, vinculados, remoto);
      } else {
        if (huellaLocal(existentes) !== huellaLocal(remoto)) {
          ponerGrupo(uid, remoto, idsRemotos);
          resumen.traidos++;
        }
        parches.set(uid, { href, etag, huella: huellaGrupo(remoto, miembros), ids: idsDe(remoto) });
      }
      grupos.delete(uid);
      for (const e of existentes) yaVistos.add(e.id);
    };

    // De a una tanda por pedido; cada tanda se procesa apenas llega, mirando el reloj (leer una serie
    // repetida cuesta CPU). Lo que no alcance queda sin tocar para la próxima vuelta.
    const hrefsPorLeer = [...porLeer.keys()];
    let duracionTanda = 0;
    leer: for (let i = 0; i < hrefsPorLeer.length; i += 40) {
      const tanda = hrefsPorLeer.slice(i, i + 40);
      const t0 = Date.now();
      let t: Awaited<ReturnType<Transporte["traer"]>>;
      try {
        t = await cal.traer(conexion.url, tanda, 2500 + duracionTanda);
      } catch (e) {
        if (!(e instanceof ErrorCalDAV) || e.codigo !== "TIEMPO") throw e;
        break;
      }
      for (const { href, etag, ics } of t.leidos) {
        if (queda() < 1200) break leer;
        await procesar(href, etag, ics);
        procesados.add(href);
      }
      if (!t.completo) break;
      for (const h of tanda) procesados.add(h); // los que no vinieron ya no están
      duracionTanda = Date.now() - t0;
    }
    if (hrefsPorLeer.some((h) => !procesados.has(h))) pendiente = true;
    // Hrefs nuevos que no se alcanzaron a leer: pueden ser una serie conocida que cambió de dirección o
    // el par de un evento del panel sin vínculo. Mientras queden, no se crea ni se borra nada por
    // ausencia (se duplicaría o se borraría algo que sí está).
    const faltaLeer = nuevosRemotos.some((h) => !procesados.has(h));
    if (faltaLeer && marcasInicial.size) {
      for (let i = ops.length - 1; i >= 0; i--) if (marcasInicial.has(ops[i])) ops.splice(i, 1);
    }
    /** ¿La serie que ya no está en su href se resolvió (o se puede estar resolviendo) en otro? */
    const enOtroHref = (uid: string) => {
      if (parches.get(uid)) return true; // el paso 1 la encontró en otro href: cambió de dirección
      if (faltaLeer) return void (pendiente = true), true;
      return false;
    };

    /**
     * Lee una serie conocida y la procesa como en el paso 1 (con su etag en null, lo de allá vuelve a la
     * pared). false si no se alcanzó o no se pudo leer: entonces la trae la vuelta siguiente.
     */
    const traerDeVuelta = async (uid: string, href: string): Promise<boolean> => {
      if (queda() < 1200) return false;
      let t: Awaited<ReturnType<Transporte["traer"]>>;
      try {
        t = await cal.traer(conexion.url, [href]);
      } catch (e) {
        if (e instanceof ErrorCalDAV) return false;
        throw e;
      }
      const x = t.leidos.find((l) => l.href === href);
      if (!x) return false;
      porLeer.set(href, uid);
      await procesar(x.href, x.etag, x.ics);
      procesados.add(href);
      return true;
    };

    // 2. Borrar en el calendario lo que se borró aquí (o se dejó "sólo en el panel").
    for (const uid of borrarAlla) {
      if (!puedeEscribir()) break;
      const rec = estado.recursos[uid];
      try {
        const r = await cal.borrar(conexion.url, rec.href, lista.recursos.get(rec.href) ?? rec.etag!);
        if (r === "conflicto") {
          pendiente = true;
          continue;
        }
        parches.set(uid, null);
        if (grupos.get(uid)?.length) ops.push({ tipo: "desvincular", uid, soloPanel: true });
        resumen.borradosAlla++;
      } catch (e) {
        if (e instanceof NoSePuedeEscribir) {
          // Ese evento no se puede borrar desde el panel (p. ej. una invitación de Google): vuelve a la
          // pared en esta misma vuelta, junto con el aviso (así se ve por qué volvió, aunque no alcance otra
          // vuelta). Si no se puede leer ahora, la vuelta siguiente lo trae. (CalDAV nunca lo lanza.)
          rec.etag = null;
          avisos.push(e.message);
          if (!(await traerDeVuelta(uid, rec.href))) pendiente = true;
        } else if (e instanceof ErrorCalDAV && e.codigo === "PERMISO") {
          // Calendario de sólo lectura: no se puede borrar allá, así que se vuelve a traer desde iCloud.
          rec.etag = null;
          pendiente = true;
          avisos.push(`El calendario «${conexion.nombre}» no deja borrar eventos desde el panel: se trajo de vuelta.`);
        } else alFallar(e);
      }
    }

    // 3. Borrar en el panel lo que se borró en el calendario.
    for (const uid of borrarAqui) {
      if (enOtroHref(uid)) continue;
      ponerGrupo(uid, []);
      parches.set(uid, null);
      resumen.borradosAqui++;
    }

    // 4. Crear en el calendario: series que se borraron allá pero cambiaron aquí, series vinculadas sin
    //    estado y eventos nuevos del panel.
    const rutasListadas = [...lista.recursos.keys()];
    const crear = async (uid: string, nombre: string, local: Evento[], vincular?: Evento) => {
      for (let intento = 0; intento < 2; intento++) {
        if (!puedeEscribir()) return;
        const conExterno = vincular ? [{ ...vincular, externo: { conexion: conexion.id, uid } }] : local;
        if (!enCalendario(conExterno).length) return; // nunca un recurso vacío
        let r: Awaited<ReturnType<Transporte["crear"]>>;
        // (Fuera del try: un error al armar el .ics se trata como antes, no como un rechazo del calendario.)
        const ics = escribirRecurso(conExterno, ctx, uid, null);
        try {
          r = await cal.crear(conexion.url, nombre, ics);
        } catch (e) {
          if (e instanceof NoSePuedeEscribir) {
            // El calendario no acepta ese evento (p. ej. Google rechaza la repetición): queda sólo en el
            // panel, con aviso, como con un calendario de sólo lectura. (CalDAV nunca lo lanza.)
            if (vincular) ops.push({ tipo: "soloPanel", id: vincular.id });
            else {
              ops.push({ tipo: "desvincular", uid, soloPanel: true });
              parches.set(uid, null);
            }
            avisos.push(e.message);
            return;
          }
          if (e instanceof ErrorCalDAV && e.codigo === "PERMISO") {
            // Calendario de sólo lectura: lo nuevo queda sólo en el panel (si no, se reintentaría siempre).
            if (vincular) ops.push({ tipo: "soloPanel", id: vincular.id });
            else {
              ops.push({ tipo: "desvincular", uid, soloPanel: true });
              parches.set(uid, null);
            }
            avisos.push(`El calendario «${conexion.nombre}» no deja agregar eventos desde el panel.`);
            return;
          }
          return alFallar(e);
        }
        if (r !== "existe") {
          const etag = conFechas(conExterno) ? null : r.etag; // (ver subirGrupo)
          parches.set(uid, { href: r.href, etag, huella: huellaGrupo(conExterno, miembros), ids: idsDe(conExterno) });
          if (vincular) ops.push({ tipo: "vincular", id: vincular.id, externo: { conexion: conexion.id, uid } });
          resumen.subidos++;
          return;
        }
        // 412: o ya hay algo con ese nombre (lo creó una vuelta anterior: la próxima lista lo vincula), o
        // ese UID ya existe en otro calendario de la cuenta.
        let hay = rutasListadas.some((h) => h.endsWith(`/${encodeURIComponent(nombre)}`));
        if (!hay) {
          try {
            hay = await cal.existe(conexion.url, nombre);
          } catch (e) {
            return alFallar(e);
          }
        }
        if (hay) return void (pendiente = true);
        if (!vincular) {
          // Una serie que en el iPhone se movió a otro calendario: queda sólo en el panel.
          ops.push({ tipo: "desvincular", uid, soloPanel: true });
          parches.set(uid, null);
          avisos.push(`"${local[0]?.titulo ?? ""}" se movió a otro calendario en el iPhone: quedó sólo en el panel.`);
          return;
        }
        const otro = `${vincular.id}.${idAzar(6)}`;
        uid = `${otro}${SUFIJO_UID}`;
        nombre = `${nombreSeguro(otro)}.ics`;
      }
      pendiente = true;
    };
    for (const uid of recrearAlla) {
      if (enOtroHref(uid)) continue;
      await crear(uid, nombreRecurso(estado.recursos[uid].href), grupos.get(uid) ?? []);
    }
    for (const [uid, local] of grupos) {
      if (estado.recursos[uid] || parches.has(uid) || !enCalendario(local).length || enOtroHref(uid)) continue;
      await crear(uid, `${nombreSeguro(uid)}.ics`, local);
    }
    // Los eventos nuevos del panel se suben de a 3 a la vez (al conectar pueden ser varios). Si quedó
    // algo nuevo del calendario sin leer, esperan: puede ser su par (al volver a conectar).
    const nuevosPanel = faltaLeer ? [] : eventos.filter((e) => !e.externo && !e.soloPanel && !yaVistos.has(e.id));
    if (faltaLeer && eventos.some((e) => !e.externo && !e.soloPanel && !yaVistos.has(e.id))) pendiente = true;
    const trabajos = await Promise.allSettled(
      Array.from({ length: 3 }, async () => {
        for (let e = nuevosPanel.shift(); e; e = nuevosPanel.shift()) await crear(uidDe(e), `${nombreSeguro(e.id)}.ics`, [], e);
      }),
    );
    const rechazo = trabajos.find((t): t is PromiseRejectedResult => t.status === "rejected");

    // 5. Guardar los cambios en la colección (sin pisar lo que otro equipo guardó entre medio). Si
    //    mientras tanto se desconectó el calendario, no se guarda nada.
    if (!(await leerAcceso(familiaId))?.calendarios?.some((c) => c.id === conexion.id)) return { ok: true };
    let versionFinal = version;
    let base = (Array.isArray(colEventos?.datos) ? colEventos!.datos : []).map(normalizarEvento).filter((e): e is Evento => !!e);
    let baseVersion = version;
    let guardado = !ops.length;
    for (let intento = 0; ops.length && intento < 6; intento++) {
      const { eventos: nuevos, omitidos } = aplicar(base, ops, conexion.id);
      for (const uid of omitidos) {
        parches.delete(uid);
        pendiente = true;
      }
      if (JSON.stringify(nuevos) === JSON.stringify(base)) {
        guardado = true;
        break;
      }
      const g = await guardarColeccion(familiaId, "eventos", nuevos, baseVersion);
      if (g.ok) {
        guardado = true;
        versionFinal = g.version;
        await anotarVersiones(familiaId, { eventos: g.version });
        break;
      }
      pendiente = true; // otro equipo guardó: se rehace encima y se revisa de nuevo en la próxima vuelta
      base = (Array.isArray(g.actual.datos) ? g.actual.datos : []).map(normalizarEvento).filter((e): e is Evento => !!e);
      baseVersion = g.actual.version;
    }

    // Si el panel no quedó guardado, el estado tampoco cambia: lo escrito en iCloud en esta vuelta se
    // reconoce en la próxima (si no, un evento nuevo del iPhone quedaría "conocido" sin estar en el
    // panel, y la vuelta siguiente lo borraría de iCloud).
    if (guardado) {
      for (const [uid, rec] of parches) {
        if (rec) estado.recursos[uid] = rec;
        else delete estado.recursos[uid];
      }
      if (!faltaLeer) delete estado.soloPanelInicial;
    }
    estado.ctag = pendiente ? null : lista.ctag;
    estado.versionEventos = versionFinal;
    estado.huellaMiembros = huellaMiembros;
    estado.pendiente = pendiente;
    // La decisión de borrar muchos sirve mientras queden borrados por terminar.
    if (!pendiente) delete estado.decision;
    estado.ultima = ahora;
    const fallo = falla as ErrorCalDAV | null; // (se asigna dentro de alFallar)
    estado.error = fallo ? { mensaje: textoError(fallo), codigo: fallo.codigo, cuando: ahora } : null;
    estado.resumen = resumen;
    avisos.push(...(cal.avisos?.() ?? [])); // los del transporte (Google), después de los del motor
    estado.avisos = juntarAvisos(op.avisosAntes ?? [], avisos);
    await guardarEstado(familiaId, conexion.id, estado);
    if (rechazo) throw rechazo.reason;
    return { ok: !fallo, resumen, pendiente, error: estado.error, respuesta, avisos: estado.avisos ?? [] };
  } catch (e) {
    if (e instanceof ErrorCalDAV && e.codigo === "TIEMPO") {
      // No alcanzó el tiempo (p. ej. iCloud lento al listar): no es un error, sigue la próxima vuelta.
      estado.pendiente = true;
      estado.ctag = null;
      await guardarEstado(familiaId, conexion.id, estado);
      return { ok: true, pendiente: true, respuesta };
    }
    if (e instanceof ErrorCalDAV) return fallar(textoError(e), e.codigo);
    console.error("sincronizar", e);
    return fallar(`Algo falló al sincronizar con ${nombreProv}: ` + (e as Error).message, "INTERNO");
  }
}
