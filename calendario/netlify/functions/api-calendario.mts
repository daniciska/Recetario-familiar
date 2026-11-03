// Calendario de iCloud conectado a la familia.
//   GET  /api/calendario                → si el servidor tiene cuenta de iCloud y cómo va cada calendario conectado
//   POST /api/calendario/calendarios    → los calendarios de la cuenta de iCloud (para elegir uno)
//   POST /api/calendario/conectar       {url, subirExistentes} → lo conecta y sincroniza por primera vez
//   POST /api/calendario/sincronizar    {resolver?, codigo?, uids?} → sincroniza ahora (lo piden los equipos al
//                                        guardar un evento); con `resolver`, la respuesta al aviso `codigo` (de los `uids`)
//   POST /api/calendario/desconectar    {id} → lo desconecta (los eventos quedan en el panel)
import type { Config, Context } from "@netlify/functions";
import {
  almacen,
  autenticar,
  cambiarAcceso,
  error,
  guardarColeccion,
  idAzar,
  json,
  leerColeccion,
  leerJSON,
  anotarVersiones,
  type ConexionCalendario,
} from "../../servidor/comun";
import { CalDAV, ErrorCalDAV } from "../../servidor/caldav";
import {
  CLAVE_DUENO_ICLOUD,
  borrarEstado,
  conCandado,
  credencialesICloud,
  guardarEstado,
  leerEstado,
  sincronizar,
  usuarioOculto,
  type Resolver,
} from "../../servidor/sincronizar";
import type { Evento } from "../../lib/datos/tipos";

/** Las funciones normales tienen 10 s (contados desde que llega el pedido): se deja margen para responder. */
const LIMITE_MS = 6500;

// 424 (y no 5xx): los equipos toman cualquier 5xx como "sin conexión" y mostrarían "revisa el wifi".
const errorCalDAV = (e: unknown) =>
  e instanceof ErrorCalDAV
    ? json({ error: e.message, codigo: e.codigo }, e.codigo === "CLAVE" ? 400 : 424)
    : json({ error: "No se pudo hablar con iCloud: " + (e as Error).message }, 424);

/** ¿La cuenta de iCloud del sitio está tomada por otra familia? */
async function deOtraFamilia(familiaId: string) {
  const dueno = (await almacen().get(CLAVE_DUENO_ICLOUD, { type: "json" })) as { familiaId: string } | null;
  return !!dueno && dueno.familiaId !== familiaId;
}

/** Cambia la lista de eventos sin pisar lo que otro equipo guardó entre medio. */
async function cambiarEventos(familiaId: string, fn: (l: Evento[]) => Evento[]) {
  for (let i = 0; i < 6; i++) {
    const col = await leerColeccion(familiaId, "eventos");
    const lista = (Array.isArray(col?.datos) ? col!.datos : []) as Evento[];
    const nuevos = fn(lista);
    if (JSON.stringify(nuevos) === JSON.stringify(lista)) return;
    const r = await guardarColeccion(familiaId, "eventos", nuevos, col?.version ?? 0);
    if (r.ok) return void (await anotarVersiones(familiaId, { eventos: r.version }));
  }
  throw new Error("No se pudieron actualizar los eventos (demasiados cambios simultáneos)");
}

export default async (req: Request, context: Context) => {
  const limite = Date.now() + LIMITE_MS;
  const s = await autenticar(req);
  if (s instanceof Response) return s;
  const accion = context.params?.accion ?? "";
  const cred = credencialesICloud();
  const conexiones = s.acceso.calendarios ?? [];

  if (req.method === "GET" && !accion) {
    const otraFamilia = !conexiones.length && (await deOtraFamilia(s.familiaId));
    const col = await leerColeccion(s.familiaId, "eventos");
    const lista = (Array.isArray(col?.datos) ? col!.datos : []) as Evento[];
    return json({
      servidor: {
        icloud: !!cred,
        // El usuario (aunque oculto) sólo lo ve la familia que usa la cuenta, o cualquiera mientras nadie la usa.
        usuario: cred && !otraFamilia ? usuarioOculto(cred.usuario) : undefined,
        otraFamilia,
      },
      conexiones: await Promise.all(
        conexiones.map(async (c) => {
          const e = await leerEstado(s.familiaId, c.id);
          return {
            id: c.id,
            proveedor: c.proveedor,
            nombre: c.nombre,
            color: c.color,
            creada: c.creada,
            eventos: lista.filter((x) => x.externo?.conexion === c.id).length,
            estado: e
              ? {
                  ultima: e.ultima,
                  intento: e.intento,
                  error: e.error ?? null,
                  resumen: e.resumen,
                  pendiente: !!e.pendiente,
                  avisos: e.avisos ?? [],
                  // Una respuesta a un aviso que espera a que iCloud alcance a responder.
                  respuesta: e.respuesta && e.respuesta.hasta > new Date().toISOString() ? e.respuesta.resolver : null,
                }
              : null,
          };
        }),
      ),
    });
  }

  if (req.method !== "POST") return error("Método no permitido", 405);
  const body = (await leerJSON(req)) ?? {};

  if (accion === "calendarios") {
    if (!cred) return json({ error: "Falta configurar la cuenta de iCloud en el servidor", codigo: "SIN_CUENTA" }, 400);
    if (await deOtraFamilia(s.familiaId)) return error("La cuenta de iCloud del panel ya está conectada a otra familia", 409);
    try {
      const cals = await new CalDAV(cred.usuario, cred.clave, cred.base, 4000, limite).calendarios();
      return json({ calendarios: cals.map(({ url, nombre, color }) => ({ url, nombre, color })) });
    } catch (e) {
      return errorCalDAV(e);
    }
  }

  if (accion === "conectar") {
    if (!cred) return json({ error: "Falta configurar la cuenta de iCloud en el servidor", codigo: "SIN_CUENTA" }, 400);
    if (conexiones.some((c) => c.proveedor === "icloud")) return error("Ya hay un calendario de iCloud conectado", 409);
    const url = typeof body.url === "string" ? body.url : "";
    let elegido;
    try {
      // Sólo se acepta un calendario de la propia cuenta (nunca una dirección cualquiera).
      elegido = (await new CalDAV(cred.usuario, cred.clave, cred.base, 4000, limite).calendarios()).find((c) => c.url === url);
    } catch (e) {
      return errorCalDAV(e);
    }
    if (!elegido) return error("Ese calendario no está en la cuenta de iCloud del panel", 400);

    // La cuenta de iCloud del sitio es de una sola familia.
    const store = almacen();
    const r = await store.setJSON(CLAVE_DUENO_ICLOUD, { familiaId: s.familiaId }, { onlyIfNew: true });
    if (!r.modified && (await deOtraFamilia(s.familiaId))) return error("La cuenta de iCloud del panel ya está conectada a otra familia", 409);

    const conexion: ConexionCalendario = {
      id: idAzar(10),
      proveedor: "icloud",
      nombre: elegido.nombre,
      url: elegido.url,
      color: elegido.color,
      creada: new Date().toISOString(),
    };
    // Si no se quieren subir los eventos que ya están, quedan "sólo en el panel". La elección viaja en el
    // estado de la conexión (anotado antes que la conexión misma) y la aplica la primera sincronización,
    // con el candado: ninguna otra alcanza a subirlos antes, y si algo falla al guardar se reintenta.
    let soloPanelInicial: string[] | undefined;
    if (body.subirExistentes === false) {
      const vivas = new Set(conexiones.map((c) => c.id));
      const col = await leerColeccion(s.familiaId, "eventos");
      soloPanelInicial = ((Array.isArray(col?.datos) ? col!.datos : []) as Evento[])
        .filter((e) => e && typeof e.id === "string" && !e.soloPanel && !(e.externo && vivas.has(e.externo.conexion)))
        .map((e) => e.id);
    }
    // Primero se anota la conexión, revisando dentro de la escritura condicional que no haya otra: dos
    // "conectar" a la vez (dos equipos, un doble toque) no pueden crear dos.
    await guardarEstado(s.familiaId, conexion.id, { recursos: {}, ...(soloPanelInicial?.length ? { soloPanelInicial } : {}) });
    try {
      await cambiarAcceso(s.familiaId, (a) => {
        if (!a) throw new Error("Familia sin acceso");
        // Volver a leer la propia escritura (Blobs reintenta solo si se perdió la respuesta) es un éxito.
        if ((a.calendarios ?? []).some((c) => c.id === conexion.id)) return a;
        if ((a.calendarios ?? []).some((c) => c.proveedor === "icloud")) throw new Error("YA_CONECTADO");
        return { ...a, calendarios: [...(a.calendarios ?? []), conexion] };
      });
    } catch (e) {
      // El estado se borra sólo si de verdad la conexión no quedó (con otro error pudo quedar anotada, y el
      // estado lleva la elección de no subir los eventos que ya estaban).
      if ((e as Error).message === "YA_CONECTADO") {
        await borrarEstado(s.familiaId, conexion.id);
        return error("Ya hay un calendario de iCloud conectado", 409);
      }
      throw e;
    }
    // La primera sincronización, si queda tiempo (iCloud lento): si no, queda pendiente y el equipo la
    // pide enseguida (con su propio plazo), o la hace la programada.
    const resultado =
      limite - Date.now() > 4500 ? await sincronizar(s.familiaId, conexion, { limite }) : { ok: true, pendiente: true };
    return json({ conexion: { id: conexion.id, nombre: conexion.nombre }, resultado });
  }

  if (accion === "sincronizar") {
    if (!conexiones.length) return json({ resultados: [] });
    const resolver = body.resolver === "borrar" || body.resolver === "recuperar" ? (body.resolver as Resolver) : undefined;
    const codigo = typeof body.codigo === "string" ? body.codigo : undefined;
    const uids =
      Array.isArray(body.uids) && body.uids.every((u: unknown) => typeof u === "string") ? (body.uids as string[]).slice(0, 5000) : undefined;
    const resultados = [];
    for (const c of conexiones) resultados.push({ id: c.id, ...(await sincronizar(s.familiaId, c, { limite, resolver, codigo, uids })) });
    return json({ resultados });
  }

  if (accion === "desconectar") {
    const c = conexiones.find((x) => x.id === body.id);
    if (!c) return error("Ese calendario no está conectado", 404);
    // Con el mismo candado que la sincronización: una que esté corriendo termina antes.
    const r = await conCandado(
      s.familiaId,
      c.id,
      async () => {
        await cambiarAcceso(s.familiaId, (a) => {
          if (!a) throw new Error("Familia sin acceso");
          return { ...a, calendarios: (a.calendarios ?? []).filter((x) => x.id !== c.id) };
        });
        // Los eventos quedan en el panel, sin vínculo (si se vuelve a conectar, se reconocen por su id).
        await cambiarEventos(s.familiaId, (l) =>
          l.map((e) => {
            if (e.externo?.conexion !== c.id) return e;
            const { externo: _, ...resto } = e;
            return resto;
          }),
        );
        await borrarEstado(s.familiaId, c.id);
        const store = almacen();
        const dueno = (await store.get(CLAVE_DUENO_ICLOUD, { type: "json" })) as { familiaId: string } | null;
        if (dueno?.familiaId === s.familiaId && c.proveedor === "icloud") await store.delete(CLAVE_DUENO_ICLOUD);
      },
      Math.max(0, limite - Date.now() - 2000),
    );
    if (r === "ocupado") return error("Se está sincronizando con iCloud: inténtalo de nuevo en unos segundos", 409);
    return json({ ok: true });
  }

  return error("No existe", 400);
};

export const config: Config = { path: ["/api/calendario", "/api/calendario/:accion"] };
