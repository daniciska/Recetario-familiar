// Sincronización en ambos sentidos entre la colección "eventos" de una familia y un calendario de
// iCloud (CalDAV).
//
// Para cada recurso (serie) se guarda en Blobs su ETag y la "huella" de cómo quedó la última vez
// que el panel y el calendario coincidieron. Así se sabe qué lado cambió:
//   - cambió sólo el calendario (ETag distinto)  → se trae al panel
//   - cambió sólo el panel (huella distinta)      → se sube (PUT con If-Match: nunca pisa a ciegas)
//   - cambiaron los dos                           → gana el cambio más reciente (LAST-MODIFIED vs `actualizado`)
//   - se borró en un lado sin cambios en el otro   → se borra en el otro; si el otro sí cambió, gana el cambio
// Eventos nuevos del panel se crean con UID `<id>@calendario-familiar` (If-None-Match: *), así un
// reintento nunca duplica. Si de una vez se borraría mucho, se detiene y pregunta (ver `resolver`).

import { CalDAV, ErrorCalDAV, URL_ICLOUD } from "./caldav";
import { SUFIJO_UID, enCalendario, escribirRecurso, huellaGrupo, leerRecurso, uidDe, ventanaDe, type Contexto } from "./ics";
import { almacen, anotarVersiones, guardarColeccion, huella, idAzar, leerColeccion, type ConexionCalendario } from "./comun";
import { canonico } from "../lib/eventos";
import { normalizarEvento } from "../lib/datos/normalizar";
import { ahoraEnSantiago } from "../lib/fechas";
import type { Evento, Miembro } from "../lib/datos/tipos";
import { createHash } from "node:crypto";

export type Conexion = ConexionCalendario;

interface Recurso {
  href: string;
  etag: string | null; // null: no se supo después de escribir (se vuelve a leer)
  huella: string;
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
  error?: { mensaje: string; codigo?: string; cuando: string; cuantos?: number } | null;
  resumen?: Resumen;
  avisos?: string[];
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
}

// ---------- Credenciales y almacenamiento ----------

/** Apple ID y contraseña de app del panel (variables de entorno del sitio, nunca en el repositorio). */
export function credencialesICloud(): { usuario: string; clave: string; base: string } | null {
  const usuario = process.env.ICLOUD_USUARIO?.trim();
  const clave = process.env.ICLOUD_CLAVE_APP?.replace(/\s+/g, "");
  if (!usuario || !clave) return null;
  // ICLOUD_CALDAV_URL sólo sirve para probar con un servidor CalDAV local.
  return { usuario, clave, base: process.env.ICLOUD_CALDAV_URL?.trim() || URL_ICLOUD };
}

export const usuarioOculto = (u: string) => u.replace(/^(.{2}).*(@.*)$/, "$1…$2");

const claveEstado = (familiaId: string, conexionId: string) => `externos/estado/${familiaId}/${conexionId}`;
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
}

/** Una sola sincronización a la vez por calendario. */
async function conCandado<T>(clave: string, fn: () => Promise<T>): Promise<T | "ocupado"> {
  const store = almacen();
  const k = `candados/sync/${clave}`;
  for (let i = 0; i < 2; i++) {
    const r = await store.setJSON(k, { desde: Date.now() }, { onlyIfNew: true });
    if (r.modified) {
      try {
        return await fn();
      } finally {
        await store.delete(k).catch(() => {});
      }
    }
    const c = (await store.get(k, { type: "json" })) as { desde: number } | null;
    if (c && Date.now() - c.desde < 60_000) return "ocupado";
    await store.delete(k).catch(() => {}); // quedó de una sincronización que se cortó
  }
  return "ocupado";
}

// ---------- Cambios en la colección ----------

type Op =
  | { tipo: "grupo"; uid: string; ids: string[]; eventos: Evento[]; base: string }
  | { tipo: "vincular"; id: string; externo: NonNullable<Evento["externo"]> }
  | { tipo: "desvincular"; uid: string };

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
    } else {
      r = r.map((e) => {
        if (e.externo?.conexion !== conexion || e.externo.uid !== op.uid) return e;
        const { externo: _, ...resto } = e;
        return resto;
      });
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
}

export async function sincronizar(familiaId: string, conexion: Conexion, op: Opciones): Promise<Resultado> {
  const r = await conCandado(`${familiaId}-${conexion.id}`, async () => {
    let resultado: Resultado = { ok: true };
    // Si mientras tanto cambió algo en el panel, se da otra vuelta (hasta 3, si alcanza el tiempo).
    for (let vuelta = 0; vuelta < 3; vuelta++) {
      resultado = await unaVuelta(familiaId, conexion, { ...op, resolver: vuelta ? undefined : op.resolver });
      if (!resultado.ok || op.limite - Date.now() < 3000) break;
      const estado = await leerEstado(familiaId, conexion.id);
      const col = await leerColeccion(familiaId, "eventos");
      if (!estado?.pendiente && estado?.versionEventos === (col?.version ?? 0)) break;
    }
    return resultado;
  });
  return r === "ocupado" ? { ok: true, ocupado: true } : r;
}

async function unaVuelta(familiaId: string, conexion: Conexion, op: Opciones): Promise<Resultado> {
  const ahora = new Date().toISOString();
  const estado: EstadoSync = (await leerEstado(familiaId, conexion.id)) ?? { recursos: {} };
  estado.intento = ahora;
  const fallar = async (mensaje: string, codigo?: string, cuantos?: number): Promise<Resultado> => {
    estado.error = { mensaje, codigo, cuando: ahora, cuantos };
    await guardarEstado(familiaId, conexion.id, estado);
    return { ok: false, error: estado.error };
  };

  const cred = credencialesICloud();
  if (!cred) return fallar("Falta configurar la cuenta de iCloud en el servidor (ICLOUD_USUARIO e ICLOUD_CLAVE_APP).", "SIN_CUENTA");
  const queda = () => op.limite - Date.now();
  const cal = new CalDAV(cred.usuario, cred.clave, cred.base, Math.max(2000, Math.min(8000, queda() - 500)));

  try {
    const [colEventos, colMiembros] = await Promise.all([leerColeccion(familiaId, "eventos"), leerColeccion(familiaId, "miembros")]);
    const version = colEventos?.version ?? 0;
    const eventos = (Array.isArray(colEventos?.datos) ? colEventos!.datos : [])
      .map(normalizarEvento)
      .filter((e): e is Evento => !!e);
    const miembros = miembrosDe(colMiembros?.datos);
    const hoy = ahoraEnSantiago().fecha;
    const ctx: Contexto = { conexion: conexion.id, miembros, hoy };
    const ventana = JSON.stringify(ventanaDe(hoy));
    const huellaMiembros = huella(JSON.stringify(miembros.map((m) => [m.id, m.nombre, m.emoji])));

    // Atajo: nada cambió en el panel ni en el calendario (un solo pedido liviano a iCloud).
    if (
      !op.resolver &&
      !estado.pendiente &&
      !estado.error &&
      estado.ctag &&
      estado.versionEventos === version &&
      estado.huellaMiembros === huellaMiembros &&
      estado.ventana === ventana
    ) {
      const ctag = await cal.ctag(conexion.url);
      if (ctag === estado.ctag) {
        estado.ultima = ahora;
        await guardarEstado(familiaId, conexion.id, estado);
        return { ok: true, resumen: { traidos: 0, subidos: 0, borradosAqui: 0, borradosAlla: 0 } };
      }
    }

    const lista = await cal.listar(conexion.url);
    const forzarTraer = estado.ventana !== undefined && estado.ventana !== ventana; // cambió el año: recalcular fechas sueltas

    const grupos = new Map<string, Evento[]>();
    for (const e of eventos) {
      if (e.externo?.conexion !== conexion.id) continue;
      grupos.set(e.externo.uid, [...(grupos.get(e.externo.uid) ?? []), e]);
    }
    const uidPorHref = new Map(Object.entries(estado.recursos).map(([uid, r]) => [r.href, uid]));

    const traer: string[] = []; // uid conocidos que cambiaron en el calendario
    const subir: string[] = []; // uid que cambiaron en el panel
    const conflicto: string[] = []; // cambiaron en los dos lados
    const borrarAlla: string[] = [];
    const borrarAqui: string[] = [];
    const recrearAlla: string[] = [];
    const nuevosRemotos: string[] = []; // href desconocidos

    for (const [uid, rec] of Object.entries(estado.recursos)) {
      const local = grupos.get(uid) ?? [];
      const cambioLocal = huellaGrupo(local, miembros) !== rec.huella;
      const etag = lista.recursos.get(rec.href);
      if (uid.startsWith("~")) {
        if (etag === undefined) delete estado.recursos[uid];
        else if (etag !== rec.etag) nuevosRemotos.push(rec.href);
        continue;
      }
      if (etag === undefined) {
        if (!cambioLocal || !enCalendario(local).length) {
          if (local.length) borrarAqui.push(uid);
          else delete estado.recursos[uid];
        } else recrearAlla.push(uid);
        continue;
      }
      const cambioRemoto = forzarTraer || rec.etag === null || etag !== rec.etag;
      if (!cambioLocal && !cambioRemoto) continue;
      if (cambioLocal && cambioRemoto) conflicto.push(uid);
      else if (cambioRemoto) traer.push(uid);
      else if (!enCalendario(local).length) borrarAlla.push(uid);
      else subir.push(uid);
    }
    for (const href of lista.recursos.keys()) if (!uidPorHref.has(href)) nuevosRemotos.push(href);

    // Seguro: si de una vez se borraría mucho, se pregunta antes (p. ej. al restaurar un respaldo viejo).
    const total = Object.keys(estado.recursos).length;
    const muchos = (n: number) => n >= 5 && n > total * 0.3;
    if (!op.resolver && muchos(borrarAlla.length))
      return fallar(
        `Se borraron del panel ${borrarAlla.length} eventos que están en iCloud. ¿Se borran también de los iPhone?`,
        "MUCHOS_BORRADOS_PANEL",
        borrarAlla.length,
      );
    if (!op.resolver && muchos(borrarAqui.length))
      return fallar(
        `Desaparecieron de iCloud ${borrarAqui.length} eventos. ¿Se borran también del panel?`,
        "MUCHOS_BORRADOS_ICLOUD",
        borrarAqui.length,
      );
    if (op.resolver === "recuperar") {
      traer.push(...borrarAlla.splice(0)); // vuelven al panel desde iCloud
      recrearAlla.push(...borrarAqui.splice(0)); // vuelven a iCloud desde el panel
    }

    const ops: Op[] = [];
    const yaVinculados = new Set<string>(); // eventos del panel sin vínculo que resultaron ser de una serie de iCloud
    const parches = new Map<string, Recurso | null>(); // uid → recurso nuevo (null: sacarlo del estado)
    const resumen: Resumen = { traidos: 0, subidos: 0, borradosAqui: 0, borradosAlla: 0 };
    const avisos: string[] = [];
    let pendiente = false;

    const sel = (uid: string, ids: string[]) => eventos.filter(selector(conexion.id, uid, ids));
    const ponerGrupo = (uid: string, nuevos: Evento[], ids: string[] = []) => {
      const todos = [...new Set([...ids, ...nuevos.map((e) => e.id)])];
      ops.push({ tipo: "grupo", uid, ids: todos, eventos: nuevos, base: huellaLocal(sel(uid, todos)) });
    };
    const masReciente = (local: Evento[]) => enCalendario(local).map((e) => e.actualizado ?? "").sort().pop() ?? "";

    // 1. Traer lo que hace falta leer del calendario.
    const porLeer = new Map<string, string>(); // href → uid conocido ("" si es nuevo)
    for (const uid of [...traer, ...subir, ...conflicto]) porLeer.set(estado.recursos[uid].href, uid);
    for (const href of nuevosRemotos) porLeer.set(href, uidPorHref.get(href) ?? "");
    const leidos = porLeer.size && queda() > 2500 ? await cal.traer(conexion.url, [...porLeer.keys()]) : [];
    if (porLeer.size && !leidos.length && queda() <= 2500) pendiente = true;

    const subirGrupo = async (uid: string, href: string, etag: string, ics: string, local: Evento[], remoto: Evento[]) => {
      const h = huellaGrupo(local, miembros);
      if (h === huellaGrupo(remoto, miembros)) return void parches.set(uid, { href, etag, huella: h });
      if (queda() < 1500) return void (pendiente = true);
      let nuevo: string;
      try {
        nuevo = escribirRecurso(local, ctx, uid, ics);
      } catch (e) {
        console.error("no se pudo escribir", uid, e);
        avisos.push(`"${local[0]?.titulo ?? ""}" no se pudo pasar a iCloud.`);
        return;
      }
      try {
        const r = await cal.actualizar(conexion.url, href, nuevo, etag);
        if (r === "conflicto") pendiente = true; // alguien lo cambió recién: se resuelve en la próxima vuelta
        else if (r === "noExiste") parches.set(uid, null);
        else {
          parches.set(uid, { href, etag: r.etag, huella: h });
          resumen.subidos++;
        }
      } catch (e) {
        if (e instanceof ErrorCalDAV && e.codigo === "PERMISO") {
          // Calendario de sólo lectura: manda lo de iCloud.
          ponerGrupo(uid, remoto);
          parches.set(uid, { href, etag, huella: huellaGrupo(remoto, miembros) });
          avisos.push(`"${local[0]?.titulo ?? ""}": el calendario no deja cambiarlo desde el panel.`);
        } else throw e;
      }
    };

    for (const { href, etag, ics } of leidos) {
      const conocido = porLeer.get(href) ?? "";
      let previo: ReturnType<typeof leerRecurso>;
      try {
        previo = leerRecurso(ics, ctx);
      } catch (e) {
        console.error("ics ilegible", href, e);
        avisos.push("Un evento de iCloud no se pudo leer y se dejó tal cual.");
        previo = null;
      }
      if (!previo) {
        if (conocido) {
          if (grupos.has(conocido)) ponerGrupo(conocido, []);
          parches.set(conocido, null);
        }
        parches.set(`~${href}`, { href, etag, huella: "" });
        continue;
      }
      const uid = previo.uid;
      if (conocido && conocido !== uid) parches.set(conocido, null); // el recurso cambió de UID (raro)
      const ids = previo.eventos.map((e) => e.id);
      const existentes = sel(uid, ids);
      const g = leerRecurso(ics, ctx, existentes)!;
      const remoto = g.eventos;
      const vinculados = existentes.filter((e) => e.externo);
      const rec = estado.recursos[uid];
      const cambioLocal = rec ? huellaGrupo(vinculados, miembros) !== rec.huella : vinculados.length > 0;
      const cambioRemoto = !rec || rec.etag === null || rec.etag !== etag || forzarTraer;

      let gana: "calendario" | "panel" = "calendario";
      if (cambioLocal && enCalendario(vinculados).length) {
        // Cambió sólo el panel: se sube. Cambió en los dos lados (o el panel tenía la serie sin
        // estado): gana el cambio más reciente.
        if (!cambioRemoto || masReciente(vinculados) > (g.modificado ?? "")) gana = "panel";
      }
      if (gana === "panel") await subirGrupo(uid, href, etag, ics, vinculados, remoto);
      else {
        if (huellaLocal(existentes) !== huellaLocal(remoto)) {
          ponerGrupo(uid, remoto, ids);
          resumen.traidos++;
        }
        parches.set(uid, { href, etag, huella: huellaGrupo(remoto, miembros) });
      }
      grupos.delete(uid); // ya resuelto
      for (const e of existentes) if (!e.externo) yaVinculados.add(e.id);
    }

    // 2. Borrar en el calendario lo que se borró (o se dejó "sólo en el panel") aquí.
    for (const uid of borrarAlla) {
      if (queda() < 1500) {
        pendiente = true;
        break;
      }
      const rec = estado.recursos[uid];
      const r = await cal.borrar(conexion.url, rec.href, lista.recursos.get(rec.href) ?? rec.etag!);
      if (r === "conflicto") {
        pendiente = true;
        continue;
      }
      parches.set(uid, null);
      if (grupos.get(uid)?.length) ops.push({ tipo: "desvincular", uid });
      resumen.borradosAlla++;
    }

    // 3. Borrar en el panel lo que se borró en el calendario.
    for (const uid of borrarAqui) {
      ponerGrupo(uid, []);
      parches.set(uid, null);
      resumen.borradosAqui++;
    }

    // 4. Crear en el calendario: series que se borraron allá pero cambiaron aquí, series vinculadas sin
    //    estado y eventos nuevos del panel.
    const rutasListadas = new Set(lista.recursos.keys());
    const crear = async (uid: string, nombre: string, local: Evento[], vincular?: Evento) => {
      for (let intento = 0; intento < 2; intento++) {
        if (queda() < 1500) return void (pendiente = true);
        const conExterno = vincular ? [{ ...vincular, externo: { conexion: conexion.id, uid } }] : local;
        const r = await cal.crear(conexion.url, nombre, escribirRecurso(conExterno, ctx, uid, null));
        if (r !== "existe") {
          parches.set(uid, { href: r.href, etag: r.etag, huella: huellaGrupo(conExterno, miembros) });
          if (vincular) ops.push({ tipo: "vincular", id: vincular.id, externo: { conexion: conexion.id, uid } });
          resumen.subidos++;
          return;
        }
        // Si el nombre ya estaba en la lista, la próxima vuelta lo encuentra y lo vincula. Si no, el
        // UID ya existe en otro calendario de la cuenta: un evento nuevo del panel prueba con otro UID.
        if (!vincular || [...rutasListadas].some((h) => h.endsWith(`/${encodeURIComponent(nombre)}`))) return void (pendiente = true);
        const otro = `${vincular.id}.${idAzar(6)}`;
        uid = `${otro}${SUFIJO_UID}`;
        nombre = `${nombreSeguro(otro)}.ics`;
      }
      pendiente = true;
    };
    for (const uid of recrearAlla) await crear(uid, nombreRecurso(estado.recursos[uid].href), grupos.get(uid) ?? []);
    for (const [uid, local] of grupos) {
      if (estado.recursos[uid] || parches.has(uid) || !enCalendario(local).length) continue;
      await crear(uid, `${nombreSeguro(uid)}.ics`, local);
    }
    // Los eventos nuevos del panel se suben de a 3 a la vez (al conectar pueden ser varios).
    const nuevosPanel = eventos.filter((e) => !e.externo && !e.soloPanel && !yaVinculados.has(e.id));
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        for (let e = nuevosPanel.shift(); e; e = nuevosPanel.shift()) await crear(uidDe(e), `${nombreSeguro(e.id)}.ics`, [], e);
      }),
    );

    // 5. Guardar los cambios en la colección (sin pisar lo que otro equipo guardó entre medio).
    let versionFinal = version;
    let base = eventos;
    let baseVersion = version;
    for (let intento = 0; ops.length && intento < 6; intento++) {
      const { eventos: nuevos, omitidos } = aplicar(base, ops, conexion.id);
      for (const uid of omitidos) {
        parches.delete(uid);
        pendiente = true;
      }
      if (JSON.stringify(nuevos) === JSON.stringify(base)) break;
      const g = await guardarColeccion(familiaId, "eventos", nuevos, baseVersion);
      if (g.ok) {
        versionFinal = g.version;
        await anotarVersiones(familiaId, { eventos: g.version });
        break;
      }
      pendiente = true; // otro equipo guardó: se rehace encima y se revisa de nuevo en la próxima vuelta
      base = (Array.isArray(g.actual.datos) ? g.actual.datos : []).map(normalizarEvento).filter((e): e is Evento => !!e);
      baseVersion = g.actual.version;
    }

    for (const [uid, rec] of parches) {
      if (rec) estado.recursos[uid] = rec;
      else delete estado.recursos[uid];
    }
    estado.ctag = pendiente ? null : lista.ctag;
    estado.versionEventos = versionFinal;
    estado.huellaMiembros = huellaMiembros;
    estado.ventana = ventana;
    estado.pendiente = pendiente;
    estado.ultima = ahora;
    estado.error = null;
    estado.resumen = resumen;
    estado.avisos = avisos.length ? avisos.slice(0, 5) : undefined;
    await guardarEstado(familiaId, conexion.id, estado);
    return { ok: true, resumen, pendiente };
  } catch (e) {
    if (e instanceof ErrorCalDAV) return fallar(e.message, e.codigo);
    console.error("sincronizar", e);
    return fallar("Algo falló al sincronizar con iCloud: " + (e as Error).message, "INTERNO");
  }
}

