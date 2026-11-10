// Calendario conectado a la familia: iCloud (CalDAV) o Google Calendar (API v3 con una cuenta de
// servicio). Hay UNA conexión a la vez por familia, de cualquiera de los dos.
//   GET  /api/calendario                → qué cuentas tiene el servidor y cómo va cada calendario conectado
//   POST /api/calendario/calendarios    → (iCloud) los calendarios de la cuenta de iCloud (para elegir uno)
//   POST /api/calendario/probar         {calendarioId} → (Google) autoprueba con el calendario real
//   POST /api/calendario/conectar       iCloud: {url, subirExistentes}; Google: {proveedor: "google",
//                                        calendarioId, dueno: {nombre, correo, rol, miembroId?}, subirExistentes}
//                                        → lo conecta y sincroniza por primera vez
//   POST /api/calendario/sincronizar    {resolver?, codigo?, uids?} → sincroniza ahora (lo piden los equipos al
//                                        guardar un evento); con `resolver`, la respuesta al aviso `codigo` (de los `uids`)
//   POST /api/calendario/desconectar    {id} → lo desconecta (los eventos quedan en el panel)
// Sólo Google (el calendario es del Gmail de un adulto, el "dueño"; el panel invita a otros):
//   GET  /api/calendario/personas       → {puedeInvitar, dueno, personas}: lo guardado junto con la ACL real
//   POST /api/calendario/invitar        {nombre, correo, rol, permiso, miembroId?} → Google le manda la invitación
//   POST /api/calendario/permiso        {correo, permiso} → editor o solo lectura
//   POST /api/calendario/quitar         {correo} → deja de compartirlo con esa persona
//   POST /api/calendario/dueno          {nombre, correo, rol, miembroId?} → corrige quién es el dueño (sólo el dato)
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
  type PersonaCalendario,
  type RolAdulto,
} from "../../servidor/comun";
import { CalDAV, ErrorCalDAV } from "../../servidor/caldav";
import { CLAVE_DUENO_GOOGLE, credencialesICloud, nombreProveedor, textoSinCuenta } from "../../servidor/proveedores";
import {
  CLAVE_DUENO_ICLOUD,
  borrarEstado,
  conCandado,
  guardarEstado,
  leerEstado,
  sincronizar,
  usuarioOculto,
  type Resolver,
} from "../../servidor/sincronizar";
import { cuentaGoogle, type CuentaServicio } from "../../servidor/google/cuenta";
import { GoogleCalendar, baseApiGoogle, normalizarIdCalendario, problemaDeRol } from "../../servidor/google/transporte";
import {
  NoSePuedeCompartir,
  cambiarPermiso,
  invitar,
  mismaCuenta,
  normalizarCorreo,
  permisoDeRol,
  permisos,
  quitar,
  sinReintento,
  textoSinReintento,
  MAX_PERSONAS,
  type ReglaPersona,
} from "../../servidor/google/compartir";
import { probar } from "../../servidor/google/prueba";
import type { Evento } from "../../lib/datos/tipos";

/** Las funciones normales tienen 10 s (contados desde que llega el pedido): se deja margen para responder. */
const LIMITE_MS = 6500;

const ID_INVALIDO =
  "Ese ID de calendario no se ve bien. Se copia en Google Calendar → Configuración del calendario → Integrar el calendario → ID de calendario.";
const ID_ES_PANEL =
  "Ese es el correo del panel (la cuenta de servicio), no el ID del calendario. Pega el ID del calendario de la familia: en Google Calendar → Configuración del calendario → Integrar el calendario → ID de calendario (suele terminar en @group.calendar.google.com).";
const OTRA_FAMILIA_GOOGLE = "La cuenta de servicio de Google del panel ya está conectada a otra familia";
const SIN_GOOGLE = "No hay un calendario de Google Calendar conectado";
const ROLES: readonly RolAdulto[] = ["madre", "padre", "adulto"];

// 424 (y no 5xx): los equipos toman cualquier 5xx como "sin conexión" y mostrarían "revisa el wifi".
const errorCalDAV = (e: unknown, proveedor = "iCloud") =>
  e instanceof ErrorCalDAV
    ? json({ error: e.message, codigo: e.codigo }, e.codigo === "CLAVE" || e.codigo === "CONFIGURACION" ? 400 : 424)
    : json({ error: `No se pudo hablar con ${proveedor}: ` + (e as Error).message }, 424);

/**
 * ¿Pegaron el correo de la cuenta de servicio (la del panel o cualquier *.gserviceaccount.com) como ID
 * del calendario? Para Google es el calendario principal de esa cuenta: «Probar» saldría bien y se
 * conectaría a un calendario que la familia no ve.
 */
const esCorreoDeServicio = (id: string, correoPanel: string) =>
  mismaCuenta(id.toLowerCase(), correoPanel.toLowerCase()) || /(^|[@.])gserviceaccount\.com$/i.test(id);

const esGoogle = (c: ConexionCalendario) => c.proveedor === "google";
/** Las conexiones guardadas antes de Google no traen otro proveedor que "icloud": todo lo que no es google es iCloud. */
const esICloud = (c: ConexionCalendario) => c.proveedor !== "google";

/** ¿La cuenta del sitio (la de esa clave de dueño) está tomada por otra familia? */
async function deOtraFamilia(clave: string, familiaId: string) {
  const dueno = (await almacen().get(clave, { type: "json" })) as { familiaId: string } | null;
  return !!dueno && dueno.familiaId !== familiaId;
}

/** Texto cuando ya hay un calendario conectado (de cualquier proveedor). */
const yaConectado = (c: ConexionCalendario) =>
  esICloud(c) ? "Ya hay un calendario de iCloud conectado" : `Ya hay un calendario conectado («${c.nombre}»). Desconéctalo primero.`;

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

// ---------- Personas (sólo Google) ----------

type Adulto = NonNullable<ConexionCalendario["dueno"]>;

const textoCorto = (x: unknown, max = 60) => (typeof x === "string" ? x.trim().replace(/\s+/g, " ").slice(0, max) : "");
const idMiembro = (x: unknown) => (typeof x === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(x) ? x : undefined);

/** {nombre, correo, rol, miembroId?} validado, o el texto del problema. */
function leerAdulto(x: unknown, correoPanel: string): Adulto | string {
  if (!x || typeof x !== "object") return "Falta decir de quién es el calendario (nombre, Gmail y si es Madre, Padre u Otro adulto).";
  const o = x as Record<string, unknown>;
  const nombre = textoCorto(o.nombre);
  if (!nombre) return "Falta el nombre.";
  const correo = normalizarCorreo(o.correo);
  if (!correo) return "Ese correo no se ve bien: revisa que esté completo (por ejemplo, nombre@gmail.com).";
  if (mismaCuenta(correo, correoPanel.toLowerCase())) return "Ese es el correo del panel, no el de una persona.";
  if (!ROLES.includes(o.rol as RolAdulto)) return "Elige si es Madre, Padre u Otro adulto.";
  const miembroId = idMiembro(o.miembroId);
  return { nombre, correo, rol: o.rol as RolAdulto, ...(miembroId ? { miembroId } : {}) };
}

/** Cambia la conexión de Google de la familia (dueño o personas), atómico. null si ya no está conectada. */
async function cambiarConexion(familiaId: string, id: string, fn: (c: ConexionCalendario) => ConexionCalendario): Promise<ConexionCalendario | null> {
  const caja: { nueva: ConexionCalendario | null } = { nueva: null };
  await cambiarAcceso(familiaId, (a) => {
    if (!a) throw new Error("Familia sin acceso");
    caja.nueva = null;
    const calendarios = (a.calendarios ?? []).map((c) => (c.id === id ? (caja.nueva = fn(c)) : c));
    return caja.nueva ? { ...a, calendarios } : a;
  });
  return caja.nueva;
}

/**
 * Tope duro de personas guardadas. El máximo (MAX_PERSONAS) se revisa antes de invitar, con lo guardado al
 * empezar el pedido: invitaciones simultáneas pueden pasarse por tantas como pedidos haya, y a esas ya se
 * les escribió en Google, así que no se recortan (lo guardado tiene que calzar con la ACL). Esto sólo
 * acota el tamaño.
 */
const TOPE_GUARDADAS = 2 * MAX_PERSONAS;

const cambiarPersonas = (familiaId: string, id: string, fn: (l: PersonaCalendario[]) => PersonaCalendario[]) =>
  cambiarConexion(familiaId, id, (c) => ({ ...c, personas: fn(c.personas ?? []).slice(0, TOPE_GUARDADAS) }));

/** Cómo se ve cada persona: lo guardado en el panel junto con lo que dice la ACL de Google. */
export interface PersonaVista {
  correo: string;
  nombre: string | null;
  rol: RolAdulto | null;
  miembroId?: string;
  /** El permiso real en Google si se pudo leer; si no, el guardado. null: un rol que no es editor ni lectura. */
  permiso: "editor" | "lectura" | null;
  /** El rol en la ACL (owner, writer, reader, freeBusyReader…), si se pudo leer. */
  rolGoogle: string | null;
  /**
   * ok: tiene acceso · sinAcceso: se invitó desde el panel y ya no está en Google · pendiente: guardada en
   * modo manual, le falta el acceso pedido (sin regla, o con una de otro permiso: rolGoogle trae el real) y
   * hay que compartirlo a mano (el panel no puede invitar) · sinInvitar: lo mismo, pero el panel YA puede
   * invitar («Invitar ahora» → POST /invitar con lo guardado) · google: compartido en Google Calendar, no
   * desde el panel.
   * En pendiente y sinInvitar, `permiso` es el pedido (el guardado), no el real.
   */
  estado: "ok" | "sinAcceso" | "pendiente" | "sinInvitar" | "google";
  guardada: boolean;
  modo?: "panel" | "manual";
  invitada?: string;
}

/**
 * `puede`: el panel puede invitar (permisos().puede). Una persona guardada en modo manual a la que le falta
 * el acceso pedido queda «pendiente» (pasos a mano) o, si el panel ya puede, «sinInvitar».
 */
function mezclar(guardadas: PersonaCalendario[], reglas: ReglaPersona[] | null, dueno: Adulto | null, puede: boolean): PersonaVista[] {
  const out: PersonaVista[] = [];
  const usadas = new Set<string>();
  const falta = puede ? "sinInvitar" : "pendiente";
  for (const p of guardadas) {
    const r = reglas?.find((x) => mismaCuenta(x.correo, p.correo));
    if (r) usadas.add(r.correo);
    const base = { correo: p.correo, nombre: p.nombre, rol: p.rol, ...(p.miembroId ? { miembroId: p.miembroId } : {}), guardada: true, modo: p.modo, invitada: p.invitada };
    if (!reglas) out.push({ ...base, permiso: p.permiso, rolGoogle: null, estado: p.modo === "manual" ? "pendiente" : "ok" });
    else if (!r) out.push({ ...base, permiso: p.permiso, rolGoogle: null, estado: p.modo === "manual" ? falta : "sinAcceso" });
    // Manual con una regla de otro permiso (p. ej. disponible/ocupado, o lectura cuando se pidió editor):
    // todavía falta lo pedido. Quien administra (owner) ya tiene más que eso.
    else if (p.modo === "manual" && r.rol !== "owner" && permisoDeRol(r.rol) !== p.permiso) out.push({ ...base, permiso: p.permiso, rolGoogle: r.rol, estado: falta });
    else out.push({ ...base, permiso: permisoDeRol(r.rol), rolGoogle: r.rol, estado: "ok" });
  }
  for (const r of reglas ?? []) {
    if (usadas.has(r.correo) || (dueno && mismaCuenta(r.correo, dueno.correo))) continue;
    out.push({ correo: r.correo, nombre: null, rol: null, permiso: permisoDeRol(r.rol), rolGoogle: r.rol, estado: "google", guardada: false });
  }
  return out;
}

// Nada reintenta solo estos pedidos: un límite de uso dice «vuelve a intentarlo en un minuto».
const respuestaCompartir = (e: unknown) =>
  e instanceof NoSePuedeCompartir ? json({ error: e.message, codigo: e.codigo }, 400) : errorCalDAV(sinReintento(e), "Google Calendar");

export default async (req: Request, context: Context) => {
  const limite = Date.now() + LIMITE_MS;
  const s = await autenticar(req);
  if (s instanceof Response) return s;
  const accion = context.params?.accion ?? "";
  const cred = credencialesICloud();
  const conexiones = s.acceso.calendarios ?? [];
  const leida = cuentaGoogle();
  const cuenta: CuentaServicio | null = leida && "cuenta" in leida ? leida.cuenta : null;
  const sinCuentaGoogle = () => json({ error: textoSinCuenta("google"), codigo: "SIN_CUENTA" }, 400);
  const google = () => new GoogleCalendar(cuenta!, baseApiGoogle(), 4000, limite);

  if (req.method === "GET" && !accion) {
    const otraFamilia = !conexiones.some(esICloud) && (await deOtraFamilia(CLAVE_DUENO_ICLOUD, s.familiaId));
    const otraFamiliaGoogle = !!cuenta && !conexiones.some(esGoogle) && (await deOtraFamilia(CLAVE_DUENO_GOOGLE, s.familiaId));
    const col = await leerColeccion(s.familiaId, "eventos");
    const lista = (Array.isArray(col?.datos) ? col!.datos : []) as Evento[];
    return json({
      servidor: {
        icloud: !!cred,
        // El usuario (aunque oculto) sólo lo ve la familia que usa la cuenta, o cualquiera mientras nadie la usa.
        usuario: cred && !otraFamilia ? usuarioOculto(cred.usuario) : undefined,
        otraFamilia,
        google: {
          configurado: !!cuenta,
          // El correo de la cuenta de servicio no es secreto (con él se comparte el calendario), pero sólo lo ve
          // la familia que la usa, o cualquiera mientras nadie la usa.
          correo: cuenta && !otraFamiliaGoogle ? cuenta.correo : undefined,
          problema: leida && "problema" in leida ? leida.problema : undefined,
          otraFamilia: otraFamiliaGoogle,
        },
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
            ...(esGoogle(c) ? { calendarioId: c.url, dueno: c.dueno ?? null } : {}),
            eventos: lista.filter((x) => x.externo?.conexion === c.id).length,
            estado: e
              ? {
                  ultima: e.ultima,
                  intento: e.intento,
                  error: e.error ?? null,
                  resumen: e.resumen,
                  pendiente: !!e.pendiente,
                  avisos: e.avisos ?? [],
                  // Una respuesta a un aviso que espera a que el calendario alcance a responder.
                  respuesta: e.respuesta && e.respuesta.hasta > new Date().toISOString() ? e.respuesta.resolver : null,
                }
              : null,
          };
        }),
      ),
    });
  }

  const conexionGoogle = conexiones.find(esGoogle);
  const PERSONAS = ["personas", "invitar", "permiso", "quitar", "dueno"];
  if (PERSONAS.includes(accion)) {
    if (!conexionGoogle) return error(SIN_GOOGLE, 404);
    if (accion !== "dueno" && !cuenta) return sinCuentaGoogle();
  }

  if (req.method === "GET" && accion === "personas") {
    const c = conexionGoogle!;
    const g = google();
    let reglas: ReglaPersona[] | null = null;
    let puedeInvitar = false;
    let aviso: string | undefined;
    try {
      const p = await permisos(g, c.url);
      puedeInvitar = p.puede;
      reglas = p.reglas ?? null;
    } catch (e) {
      aviso = e instanceof ErrorCalDAV ? textoSinReintento(e) : "No se pudo ver con quién se comparte en Google Calendar.";
    }
    const dueno = c.dueno ?? null;
    return json({
      puedeInvitar,
      correoPanel: g.correo,
      dueno,
      // ¿El Gmail anotado como dueño aparece como dueño en Google? (null: no se pudo leer la lista)
      duenoEnGoogle: dueno && reglas ? reglas.some((r) => r.rol === "owner" && mismaCuenta(r.correo, dueno.correo)) : null,
      personas: mezclar(c.personas ?? [], reglas, dueno, puedeInvitar),
      ...(aviso ? { aviso } : {}),
    });
  }

  if (req.method !== "POST") return error("Método no permitido", 405);
  const body = (await leerJSON(req)) ?? {};

  if (accion === "calendarios") {
    if (!cred) return json({ error: "Falta configurar la cuenta de iCloud en el servidor", codigo: "SIN_CUENTA" }, 400);
    if (await deOtraFamilia(CLAVE_DUENO_ICLOUD, s.familiaId)) return error("La cuenta de iCloud del panel ya está conectada a otra familia", 409);
    try {
      const cals = await new CalDAV(cred.usuario, cred.clave, cred.base, 4000, limite).calendarios();
      return json({ calendarios: cals.map(({ url, nombre, color }) => ({ url, nombre, color })) });
    } catch (e) {
      return errorCalDAV(e);
    }
  }

  if (accion === "probar") {
    if (!cuenta) return sinCuentaGoogle();
    if (await deOtraFamilia(CLAVE_DUENO_GOOGLE, s.familiaId)) return error(OTRA_FAMILIA_GOOGLE, 409);
    const id = normalizarIdCalendario(body.calendarioId);
    if (!id) return error(ID_INVALIDO, 400);
    if (esCorreoDeServicio(id, cuenta.correo)) return json({ error: ID_ES_PANEL, codigo: "ES_PANEL" }, 400);
    try {
      return json(await probar(google(), id, s.familiaId));
    } catch (e) {
      return errorCalDAV(sinReintento(e), "Google Calendar");
    }
  }

  if (accion === "conectar") {
    const proveedor: ConexionCalendario["proveedor"] = body.proveedor === "google" ? "google" : "icloud";
    let conexion: ConexionCalendario;
    if (proveedor === "icloud") {
      if (!cred) return json({ error: "Falta configurar la cuenta de iCloud en el servidor", codigo: "SIN_CUENTA" }, 400);
      if (conexiones.length) return error(yaConectado(conexiones[0]), 409);
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
      if (!r.modified && (await deOtraFamilia(CLAVE_DUENO_ICLOUD, s.familiaId))) return error("La cuenta de iCloud del panel ya está conectada a otra familia", 409);

      conexion = {
        id: idAzar(10),
        proveedor: "icloud",
        nombre: elegido.nombre,
        url: elegido.url,
        color: elegido.color,
        creada: new Date().toISOString(),
      };
    } else {
      if (!cuenta) return sinCuentaGoogle();
      if (conexiones.length) return error(yaConectado(conexiones[0]), 409);
      const dueno = leerAdulto(body.dueno, cuenta.correo);
      if (typeof dueno === "string") return error(dueno, 400);
      const id = normalizarIdCalendario(body.calendarioId);
      if (!id) return error(ID_INVALIDO, 400);
      if (esCorreoDeServicio(id, cuenta.correo)) return json({ error: ID_ES_PANEL, codigo: "ES_PANEL" }, 400);
      if (await deOtraFamilia(CLAVE_DUENO_GOOGLE, s.familiaId)) return error(OTRA_FAMILIA_GOOGLE, 409);
      const g = google();
      let info: { nombre: string; zona: string | null; rol: string };
      try {
        info = await g.calendario(id);
      } catch (e) {
        return errorCalDAV(sinReintento(e), "Google Calendar");
      }
      // Sólo ver o disponible/ocupado: no sirve para sincronizar (se rechaza antes de que dispare borrados).
      const problema = problemaDeRol(info.rol, info.nombre, g.correo);
      if (problema) return json({ error: problema, codigo: "PERMISO" }, 400);

      // La cuenta de servicio del sitio es de una sola familia.
      const store = almacen();
      const r = await store.setJSON(CLAVE_DUENO_GOOGLE, { familiaId: s.familiaId }, { onlyIfNew: true });
      if (!r.modified && (await deOtraFamilia(CLAVE_DUENO_GOOGLE, s.familiaId))) return error(OTRA_FAMILIA_GOOGLE, 409);

      conexion = { id: idAzar(10), proveedor: "google", nombre: info.nombre, url: id, creada: new Date().toISOString(), dueno };
    }

    // Si no se quieren subir los eventos que ya están, quedan "sólo en el panel". La elección viaja en el
    // estado de la conexión (anotado antes que la conexión misma) y la aplica la primera sincronización,
    // con el candado: ninguna otra alcanza a subirlos antes, y si algo falla al guardar se reintenta.
    // En Google, además, las repeticiones con fechas sueltas (las que vienen de otro calendario y el panel
    // no sabe escribir) quedan siempre sólo en el panel: subirlas las aplanaría en un evento de un día.
    let soloPanelInicial: string[] | undefined;
    const avisos: string[] = [];
    if (body.subirExistentes === false || proveedor === "google") {
      const vivas = new Set(conexiones.map((c) => c.id));
      const col = await leerColeccion(s.familiaId, "eventos");
      const libres = ((Array.isArray(col?.datos) ? col!.datos : []) as Evento[]).filter(
        (e) => e && typeof e.id === "string" && !e.soloPanel && !(e.externo && vivas.has(e.externo.conexion)),
      );
      if (body.subirExistentes === false) soloPanelInicial = libres.map((e) => e.id);
      else {
        soloPanelInicial = libres.filter((e) => Array.isArray(e.fechas) && e.fechas.length > 0).map((e) => e.id);
        const n = soloPanelInicial.length;
        if (n) avisos.push(n === 1 ? "1 evento con fechas sueltas quedó solo en la pared." : `${n} eventos con fechas sueltas quedaron solo en la pared.`);
      }
    }
    // Primero se anota la conexión, revisando dentro de la escritura condicional que no haya otra: dos
    // "conectar" a la vez (dos equipos, un doble toque) no pueden crear dos.
    await guardarEstado(s.familiaId, conexion.id, { recursos: {}, ...(soloPanelInicial?.length ? { soloPanelInicial } : {}) });
    let otra: ConexionCalendario | undefined;
    try {
      await cambiarAcceso(s.familiaId, (a) => {
        if (!a) throw new Error("Familia sin acceso");
        // Volver a leer la propia escritura (Blobs reintenta solo si se perdió la respuesta) es un éxito.
        if ((a.calendarios ?? []).some((c) => c.id === conexion.id)) return a;
        otra = (a.calendarios ?? [])[0];
        if (otra) throw new Error("YA_CONECTADO");
        return { ...a, calendarios: [...(a.calendarios ?? []), conexion] };
      });
    } catch (e) {
      // El estado se borra sólo si de verdad la conexión no quedó (con otro error pudo quedar anotada, y el
      // estado lleva la elección de no subir los eventos que ya estaban).
      if ((e as Error).message === "YA_CONECTADO") {
        await borrarEstado(s.familiaId, conexion.id);
        return error(otra ? yaConectado(otra) : "Ya hay un calendario conectado", 409);
      }
      throw e;
    }
    // La primera sincronización, si queda tiempo (calendario lento): si no, queda pendiente y el equipo la
    // pide enseguida (con su propio plazo), o la hace la programada.
    const resultado =
      limite - Date.now() > 4500 ? await sincronizar(s.familiaId, conexion, { limite }) : { ok: true, pendiente: true };
    return json({ conexion: { id: conexion.id, nombre: conexion.nombre }, resultado, ...(avisos.length ? { avisos } : {}) });
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
        // La cuenta del sitio de ese proveedor queda libre.
        const store = almacen();
        const clave = esGoogle(c) ? CLAVE_DUENO_GOOGLE : CLAVE_DUENO_ICLOUD;
        const dueno = (await store.get(clave, { type: "json" })) as { familiaId: string } | null;
        if (dueno?.familiaId === s.familiaId) await store.delete(clave);
      },
      Math.max(0, limite - Date.now() - 2000),
    );
    if (r === "ocupado") return error(`Se está sincronizando con ${nombreProveedor(c.proveedor)}: inténtalo de nuevo en unos segundos`, 409);
    return json({ ok: true });
  }

  // ---------- Personas (Google) ----------

  if (accion === "invitar") {
    const c = conexionGoogle!;
    const nombre = textoCorto(body.nombre);
    if (!nombre) return error("Falta el nombre de la persona.", 400);
    if (!ROLES.includes(body.rol as RolAdulto)) return error("Elige si es Madre, Padre u Otro adulto.", 400);
    const correo = normalizarCorreo(body.correo);
    // El máximo es para agregar personas: volver a invitar a una ya guardada («Invitar ahora», otro permiso)
    // no agrega a nadie, aunque invitaciones simultáneas hayan dejado la lista sobre el máximo (TOPE_GUARDADAS).
    const ya = (c.personas ?? []).some((p) => p.correo === correo);
    const ctx = { dueno: c.dueno?.correo, personas: ya ? 0 : (c.personas ?? []).length };
    let r;
    try {
      r = await invitar(google(), c.url, body.correo, body.permiso, ctx);
    } catch (e) {
      return respuestaCompartir(e);
    }
    const miembroId = idMiembro(body.miembroId);
    const modo = r.modo;
    const nueva = (previa?: PersonaCalendario): PersonaCalendario => {
      // Un correo ya guardado conserva su miembroId si no viene otro.
      const mid = miembroId ?? previa?.miembroId;
      return {
        correo: correo!, // invitar() ya lo validó
        nombre,
        rol: body.rol as RolAdulto,
        permiso: body.permiso === "editor" ? "editor" : "lectura",
        ...(mid ? { miembroId: mid } : {}),
        invitada: new Date().toISOString(),
        modo,
      };
    };
    let persona = nueva();
    // Atómico: un correo ya guardado se actualiza en su lugar (no se duplica); uno nuevo va al final y no
    // se recorta aunque invitaciones simultáneas pasen del máximo (ya se le escribió en Google).
    const guardada = await cambiarConexion(s.familiaId, c.id, (x) => {
      const l = x.personas ?? [];
      const previa = l.find((p) => p.correo === correo);
      persona = nueva(previa);
      const personas = previa ? l.map((p) => (p.correo === correo ? persona : p)) : [...l.slice(0, TOPE_GUARDADAS - 1), persona];
      return { ...x, personas };
    });
    if (!guardada) return error(SIN_GOOGLE, 404);
    return json({ modo: r.modo, persona, igual: r.modo === "panel" && r.igual === true, dueno: c.dueno ?? null });
  }

  if (accion === "permiso") {
    const c = conexionGoogle!;
    let r;
    try {
      r = await cambiarPermiso(google(), c.url, body.correo, body.permiso, { dueno: c.dueno?.correo });
    } catch (e) {
      return respuestaCompartir(e);
    }
    const correo = normalizarCorreo(body.correo)!;
    if (r.modo === "noEsta") {
      return json({ error: "Esa persona ya no tiene acceso al calendario en Google Calendar: invítala de nuevo.", codigo: "NO_ESTA" }, 404);
    }
    // Si el panel no pudo (modo manual), lo guardado no cambia: la lista muestra el permiso real de Google.
    if (r.modo === "panel") {
      const permiso = body.permiso === "editor" ? "editor" : "lectura";
      await cambiarPersonas(s.familiaId, c.id, (l) => l.map((p) => (p.correo === correo ? { ...p, permiso, modo: "panel" } : p)));
    }
    return json({ modo: r.modo, dueno: c.dueno ?? null });
  }

  if (accion === "quitar") {
    const c = conexionGoogle!;
    let r;
    try {
      r = await quitar(google(), c.url, body.correo, { dueno: c.dueno?.correo });
    } catch (e) {
      return respuestaCompartir(e);
    }
    const correo = normalizarCorreo(body.correo)!;
    // Aunque el panel no pueda quitarle el acceso (modo manual), sale de la lista del panel: si sigue en
    // Google, la lista la muestra como «compartido en Google Calendar».
    await cambiarPersonas(s.familiaId, c.id, (l) => l.filter((p) => p.correo !== correo));
    return json({ modo: r.modo, yaNoEstaba: r.modo === "panel" && r.yaNoEstaba === true, dueno: c.dueno ?? null });
  }

  if (accion === "dueno") {
    const c = conexionGoogle!;
    const dueno = leerAdulto(body, cuenta?.correo ?? "");
    if (typeof dueno === "string") return error(dueno, 400);
    // Sólo el dato del panel: en Google el dueño no cambia. Si estaba en la lista de personas, sale de ahí.
    const nueva = await cambiarConexion(s.familiaId, c.id, (x) => ({
      ...x,
      dueno,
      personas: (x.personas ?? []).filter((p) => !mismaCuenta(p.correo, dueno.correo)),
    }));
    if (!nueva) return error(SIN_GOOGLE, 404);
    return json({ dueno });
  }

  return error("No existe", 400);
};

export const config: Config = { path: ["/api/calendario", "/api/calendario/:accion"] };
