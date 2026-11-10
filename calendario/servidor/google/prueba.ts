// Autoprueba "Probar" de Google Calendar (antes de conectar, o cuando la familia quiera revisar).
// Es diagnóstica: la sincronización NO depende de ella. Mide con la cuenta y el calendario reales lo
// que la documentación de Google no asegura y que el panel maneja con un respaldo:
//   - si acepta un evento con hora de término igual a la de inicio (si no, "sin hora de término");
//   - si acepta las repeticiones que escribe el panel ("el último día del mes": BYSETPOS=-1);
//   - que un cambio sobre una versión vieja da 412 (así nada se pisa);
//   - que la marca de escritura propia (cfh) vuelve igual (marcaEstable);
//   - si un evento borrado deja su id ocupado (lapidaOcupaId).
// Además: que la clave funciona, el permiso con que se compartió el calendario (owner o writer), su
// zona horaria y si el panel puede invitar a otras personas (owner, y que la ACL se pueda leer).
//
// El evento de prueba es del 01-01-2001, con un id que no es del panel (ids.ts idDePrueba: la pared
// nunca lo muestra). Su id queda en Blobs ANTES de crearlo (externos/google/prueba/<familia>): si la
// prueba se corta, la siguiente lo borra al empezar. El resumen de lo medido queda en
// externos/google/capacidades/<familia> (diagnóstico).
//
// API:
//   probar(g, calId, familiaId): Promise<ResultadoPrueba>   {pasos: [{clave, estado, texto}], nombre, zona, rol, terminado, capacidades?}
//   limpiarRestos(g, familiaId): Promise<boolean>            borra el evento de una prueba anterior que se cortó (true si no queda nada)
//   CLAVE_PRUEBA(familiaId), CLAVE_CAPACIDADES(familiaId)
//
// servidor/google/* nunca importa servidor/sincronizar.ts.

import { ErrorCalDAV } from "../caldav";
import { almacen, idAzar } from "../comun";
import { ZONA } from "../../lib/fechas";
import { tokenDeAcceso } from "./cuenta";
import { marcar, type Cuerpo } from "./escritura";
import { idDePrueba } from "./ids";
import { huellaPieza, type EvG } from "./serie";
import { problemaDeRol, rutaCalendario, type GoogleCalendar, type RespuestaGoogle } from "./transporte";

export type EstadoPaso = "ok" | "aviso" | "error";
export type ClavePaso =
  | "token"
  | "permiso"
  | "zona"
  | "compartir"
  | "limpieza"
  | "escritura"
  | "version"
  | "sinHora"
  | "repeticiones"
  | "marca";

export interface PasoPrueba {
  clave: ClavePaso;
  estado: EstadoPaso;
  texto: string;
}

/** Lo medido (null = no se alcanzó a medir). */
export interface Capacidades {
  fecha: string; // ISO
  calId: string;
  rol: string | null;
  zona: string | null;
  puedeInvitar: boolean | null;
  finIgualInicio: boolean | null;
  sinHoraDeTermino: boolean | null; // endTimeUnspecified (el respaldo del panel)
  reglaPanel: boolean | null; // BYMONTHDAY=28,29,30;BYSETPOS=-1
  rechazaVersionVieja: boolean | null;
  marcaEstable: boolean | null;
  lapidaOcupaId: boolean | null;
}

export interface ResultadoPrueba {
  pasos: PasoPrueba[];
  nombre: string | null;
  zona: string | null;
  rol: string | null;
  /** false: no alcanzó el tiempo (se puede tocar Probar de nuevo; lo que quedó se limpia solo). */
  terminado: boolean;
  capacidades?: Capacidades;
}

export const CLAVE_PRUEBA = (familiaId: string) => `externos/google/prueba/${familiaId}`;
export const CLAVE_CAPACIDADES = (familiaId: string) => `externos/google/capacidades/${familiaId}`;

/** Lo mínimo que tiene que quedar del plazo antes de cada paso (si no, se corta y se puede retomar). */
const MINIMO_MS = 700;
const INICIO = "2001-01-01T10:00:00-03:00"; // en Santiago (horario de verano de 2001)
const FIN_MEDIA_HORA = "2001-01-01T10:30:00-03:00";
/** "El día 30 o el último del mes", como la escribe el panel (BYSETPOS=-1). */
const REGLA_PANEL = "RRULE:FREQ=MONTHLY;BYMONTHDAY=28,29,30;BYSETPOS=-1;COUNT=3";
const REGLA_SIMPLE = "RRULE:FREQ=DAILY;COUNT=3";
/** Lo que el panel lee de un evento (para revisar la marca cfh en la respuesta). */
const CAMPOS = "id,etag,status,summary,description,location,start,end,endTimeUnspecified,recurrence,originalStartTime,extendedProperties";
const TITULO = "Prueba del panel (se borra sola)";
const NOTA = "Evento de prueba del panel de la familia («Probar»). Si quedó aquí, se puede borrar.";

interface Restos {
  id: string;
  calId: string;
  desde: string;
}

/** Se acabó el plazo de la función: se corta y se puede retomar. */
class Corte extends Error {}

function cuerpoPrueba(id: string, fin: "igual" | "sinHora" | "media", regla: string): Cuerpo {
  const start = { dateTime: INICIO, timeZone: ZONA };
  const base: Cuerpo = { id, summary: TITULO, description: NOTA, start, recurrence: [regla] };
  if (fin === "sinHora") return marcar({}, { ...base, endTimeUnspecified: true });
  return marcar({}, { ...base, end: { dateTime: fin === "igual" ? INICIO : FIN_MEDIA_HORA, timeZone: ZONA } });
}

/**
 * Borra el evento de una prueba anterior que se cortó (lo anotado en Blobs). true si no queda nada
 * pendiente. No lanza por un 403/404/410 (ya no está o ya no hay acceso: no hay nada más que hacer).
 */
export async function limpiarRestos(g: GoogleCalendar, familiaId: string): Promise<boolean> {
  const store = almacen();
  const r = (await store.get(CLAVE_PRUEBA(familiaId), { type: "json" })) as Restos | null;
  if (!r) return true;
  if (typeof r.id !== "string" || typeof r.calId !== "string") {
    await store.delete(CLAVE_PRUEBA(familiaId));
    return true;
  }
  let ruta: string;
  try {
    ruta = `${rutaCalendario(r.calId)}/events/${encodeURIComponent(r.id)}`;
  } catch {
    await store.delete(CLAVE_PRUEBA(familiaId));
    return true;
  }
  const d = await g.pedirJSON("DELETE", ruta);
  if ([200, 204, 403, 404, 410].includes(d.status)) {
    await store.delete(CLAVE_PRUEBA(familiaId));
    return true;
  }
  throw g.errorDe(d, "borrar el evento de prueba");
}

/** La autoprueba completa (ver el encabezado). Nunca lanza por algo de Google: lo informa en `pasos`. */
export async function probar(g: GoogleCalendar, calId: string, familiaId: string): Promise<ResultadoPrueba> {
  const pasos: PasoPrueba[] = [];
  const res: ResultadoPrueba = { pasos, nombre: null, zona: null, rol: null, terminado: true };
  const cap: Capacidades = {
    fecha: new Date().toISOString(),
    calId,
    rol: null,
    zona: null,
    puedeInvitar: null,
    finIgualInicio: null,
    sinHoraDeTermino: null,
    reglaPanel: null,
    rechazaVersionVieja: null,
    marcaEstable: null,
    lapidaOcupaId: null,
  };
  const paso = (clave: ClavePaso, estado: EstadoPaso, texto: string) => void pasos.push({ clave, estado, texto });
  const alcanza = () => {
    if (g.queda() < MINIMO_MS) throw new Corte();
  };
  const store = almacen();
  const ruta = `${rutaCalendario(calId)}/events`;
  let id: string | null = null; // el evento de prueba, mientras exista en Google
  let anotado: string | null = null; // el id anotado en Blobs (pudo crearse aunque el pedido fallara)
  let actual: ClavePaso = "token"; // el paso en curso (para informar un error inesperado)

  /** Pedido que no puede fallar sin cortar la prueba: el ErrorCalDAV de TIEMPO también corta. */
  const pedir = async (metodo: string, sub: string, op: Parameters<GoogleCalendar["pedirJSON"]>[2] = {}): Promise<RespuestaGoogle> => {
    alcanza();
    return g.pedirJSON(metodo, sub, op);
  };

  try {
    // 1. La clave.
    alcanza();
    try {
      await tokenDeAcceso(g.cuenta, g.hasta);
      paso("token", "ok", "La clave de la cuenta de servicio funciona.");
    } catch (e) {
      if (e instanceof ErrorCalDAV && e.codigo === "TIEMPO") throw new Corte();
      paso("token", "error", e instanceof ErrorCalDAV ? e.message : "No se pudo pedir el permiso a Google.");
      return res;
    }

    // 2. El calendario: permiso y zona horaria.
    alcanza();
    let info: { nombre: string; zona: string | null; rol: string };
    try {
      info = await g.calendario(calId);
    } catch (e) {
      if (e instanceof ErrorCalDAV && e.codigo === "TIEMPO") throw new Corte();
      paso("permiso", "error", e instanceof ErrorCalDAV ? e.message : "No se pudo leer el calendario.");
      return res;
    }
    res.nombre = info.nombre;
    res.zona = cap.zona = info.zona;
    res.rol = cap.rol = info.rol;
    const problema = problemaDeRol(info.rol, info.nombre, g.correo);
    if (problema) {
      paso("permiso", "error", problema);
      return res;
    }
    paso("permiso", "ok", `Puede editar «${info.nombre}».`);
    if (!info.zona || info.zona === ZONA) paso("zona", "ok", "Zona horaria del calendario: Santiago.");
    else {
      paso(
        "zona",
        "aviso",
        `El calendario está en ${info.zona}: en Google Calendar → Configuración del calendario → Zona horaria, elige (GMT-03:00) Santiago.`,
      );
    }

    // 3. ¿Puede invitar? Sólo con «administrar el uso compartido» (owner) y si la ACL se deja leer.
    actual = "compartir";
    const sinInvitar =
      "El panel no puede invitar (se compartió sin «administrar el uso compartido»): las invitaciones se hacen a mano en Google Calendar.";
    if (info.rol === "owner") {
      // Es informativo: si Google no deja revisarlo ahora (límite de uso, falla pasajera), se avisa y la
      // prueba sigue con la escritura.
      let a: RespuestaGoogle | null = null;
      try {
        a = await pedir("GET", `${rutaCalendario(calId)}/acl`, { query: { maxResults: "1", fields: "items(id)" } });
      } catch (e) {
        if (e instanceof Corte || !(e instanceof ErrorCalDAV) || e.codigo === "TIEMPO") throw e;
        paso("compartir", "aviso", `No se pudo revisar si el panel puede invitar a otras personas: ${e.message}`);
      }
      if (a) {
        cap.puedeInvitar = a.status === 200;
        if (a.status === 200) {
          paso(
            "compartir",
            "ok",
            "El panel puede invitar a otras personas. (Con este permiso, quien tuviera la clave del panel podría cambiar con quién se comparte el calendario: por eso la clave va solo en Netlify, como secreta.)",
          );
        } else paso("compartir", "aviso", a.status === 403 ? sinInvitar : `${sinInvitar} (${g.errorDe(a).message})`);
      }
    } else {
      cap.puedeInvitar = false;
      paso("compartir", "aviso", sinInvitar);
    }

    // 4. Lo que haya quedado de una prueba anterior que se cortó.
    actual = "limpieza";
    alcanza();
    try {
      await limpiarRestos(g, familiaId);
    } catch (e) {
      if (e instanceof ErrorCalDAV && e.codigo === "TIEMPO") throw new Corte();
      paso("limpieza", "error", `No se pudo borrar el evento de una prueba anterior: ${(e as Error).message}`);
      return res;
    }

    // 5. Crear el evento de prueba (fin = inicio y la repetición del panel). El id queda anotado antes.
    actual = "escritura";
    const nuevo = idDePrueba(idAzar(20));
    alcanza();
    await store.setJSON(CLAVE_PRUEBA(familiaId), { id: nuevo, calId, desde: new Date().toISOString() } satisfies Restos);
    anotado = nuevo;
    const insertar = (c: Cuerpo) => pedir("POST", ruta, { query: { fields: CAMPOS }, cuerpo: c });
    let creado: RespuestaGoogle | null = null;
    let ultimo: RespuestaGoogle | null = null;
    const intentos: [fin: "igual" | "sinHora" | "media", regla: string][] = [
      ["igual", REGLA_PANEL],
      ["sinHora", REGLA_PANEL],
      ["media", REGLA_PANEL],
      ["media", REGLA_SIMPLE],
    ];
    let usado = -1;
    for (let i = 0; i < intentos.length && !creado; i++) {
      const r = await insertar(cuerpoPrueba(nuevo, intentos[i][0], intentos[i][1]));
      ultimo = r;
      if (r.status === 200 && r.json) {
        creado = r;
        usado = i;
      } else if (r.status !== 400) break; // otro problema: no es por el fin ni por la regla
    }
    if (!creado) {
      const r = ultimo!;
      const texto =
        r.status === 400
          ? `Google no dejó crear un evento de prueba${r.mensaje ? ` (${r.mensaje})` : ""}.`
          : r.status === 409
            ? "Google dijo que el evento de prueba ya existía: toca Probar de nuevo."
            : g.errorDe(r, "crear un evento de prueba").message;
      paso("escritura", "error", texto);
      await store.delete(CLAVE_PRUEBA(familiaId)); // Google respondió que no: no se creó nada
      anotado = null;
      return res;
    }
    id = nuevo;
    let ev = creado.json as unknown as EvG;
    cap.finIgualInicio = usado === 0;
    cap.reglaPanel = usado <= 2;
    if (usado <= 1) cap.sinHoraDeTermino = true;
    else if (usado === 2) cap.sinHoraDeTermino = false;
    else {
      // Con la regla simple no se supo qué pasa con "sin hora de término": se prueba el respaldo con un PATCH.
      const p = await pedir("PATCH", `${ruta}/${encodeURIComponent(nuevo)}`, {
        query: { fields: CAMPOS },
        cuerpo: { ...marcar(ev, { endTimeUnspecified: true }), end: null },
        ...(ev.etag ? { ifMatch: ev.etag } : {}),
      });
      cap.sinHoraDeTermino = p.status === 200;
      if (p.status === 200 && p.json) ev = p.json as unknown as EvG;
    }

    // 6. Un cambio sobre una versión vieja: tiene que dar 412.
    const rutaEv = `${ruta}/${encodeURIComponent(nuevo)}`;
    const viejo = await pedir("PATCH", rutaEv, { query: { fields: CAMPOS }, cuerpo: marcar(ev, { summary: `${TITULO} · versión vieja` }), ifMatch: '"0"' });
    if (viejo.status === 412) cap.rechazaVersionVieja = true;
    else if (viejo.status === 200 && viejo.json) {
      cap.rechazaVersionVieja = false;
      ev = viejo.json as unknown as EvG;
    } else throw g.errorDe(viejo, "cambiar el evento de prueba");

    // 7. Un cambio con la versión vigente: 200, y la marca cfh tiene que volver igual.
    const cambio = await pedir("PATCH", rutaEv, {
      query: { fields: CAMPOS },
      cuerpo: marcar(ev, { summary: `${TITULO} ✓` }),
      ...(ev.etag ? { ifMatch: ev.etag } : {}),
    });
    if (cambio.status !== 200 || !cambio.json) {
      if (cambio.status === 412) throw new ErrorCalDAV("Google rechazó un cambio hecho con la versión vigente del evento de prueba.", 412, "SERVIDOR");
      throw g.errorDe(cambio, "cambiar el evento de prueba");
    }
    ev = cambio.json as unknown as EvG;
    const cfh = ev.extendedProperties?.private?.cfh;
    cap.marcaEstable = typeof cfh === "string" && cfh === huellaPieza(ev);

    // 8. Borrar con la versión vigente: 204.
    const borrado = await pedir("DELETE", rutaEv, ev.etag ? { ifMatch: ev.etag } : {});
    if (borrado.status !== 204 && borrado.status !== 200) {
      if (borrado.status === 412) throw new ErrorCalDAV("Google no dejó borrar el evento de prueba con su versión vigente.", 412, "SERVIDOR");
      throw g.errorDe(borrado, "borrar el evento de prueba");
    }

    // 9. Volver a crear el mismo id: 409 (el borrado lo deja ocupado) o 200 (se borra de nuevo).
    const otra = await pedir("POST", ruta, { query: { fields: "id,etag" }, cuerpo: cuerpoPrueba(nuevo, "media", REGLA_SIMPLE) });
    if (otra.status === 409) {
      cap.lapidaOcupaId = true;
      id = null;
    } else if (otra.status === 200) {
      cap.lapidaOcupaId = false;
      const etag = typeof otra.json?.etag === "string" ? otra.json.etag : undefined;
      const d = await pedir("DELETE", rutaEv, etag ? { ifMatch: etag } : {});
      if ([200, 204, 404, 410].includes(d.status)) id = null;
    } else id = null; // no se creó: no hay nada que borrar (lo medido sigue siendo válido)

    // Listo: lo medido, en palabras.
    paso("escritura", "ok", "Crear, cambiar y borrar un evento de prueba: funciona.");
    if (cap.rechazaVersionVieja) paso("version", "ok", "Google rechaza un cambio hecho sobre una versión vieja (así nada se pisa).");
    else {
      paso(
        "version",
        "error",
        "Google aceptó un cambio hecho sobre una versión vieja: un cambio de la pared podría pisar uno del iPhone. Mejor no conectar todavía.",
      );
    }
    if (cap.sinHoraDeTermino !== false) paso("sinHora", "ok", "Eventos sin hora de término: se pueden.");
    else paso("sinHora", "aviso", "Google no acepta eventos sin hora de término: a esos ponles una.");
    if (cap.reglaPanel) paso("repeticiones", "ok", "Repeticiones del panel (p. ej. «el último día del mes»): se pueden.");
    else {
      paso(
        "repeticiones",
        "aviso",
        "Google no acepta algunas repeticiones del panel (p. ej. «el día 30 o el último del mes»): esas quedan solo en la pared, con un aviso.",
      );
    }
    if (!cap.marcaEstable) {
      paso(
        "marca",
        "aviso",
        "Google cambia un poco lo que guarda el panel: si se cambia lo mismo en la pared y en Google casi a la vez, puede quedar lo de Google.",
      );
    }
    res.capacidades = cap;
    await store.setJSON(CLAVE_CAPACIDADES(familiaId), cap).catch(() => {});
    if (!id) {
      await store.delete(CLAVE_PRUEBA(familiaId));
      anotado = null;
    }
    return res;
  } catch (e) {
    const corte = e instanceof Corte || (e instanceof ErrorCalDAV && e.codigo === "TIEMPO");
    if (corte) {
      res.terminado = false;
      return res; // lo anotado en Blobs se limpia en la próxima prueba
    }
    if (!(e instanceof ErrorCalDAV)) throw e;
    paso(actual, "error", e.message);
    // Se intenta borrar el evento de prueba ahora (si no se puede, lo hace la próxima prueba). También si
    // el pedido que lo creaba falló sin respuesta: pudo haberse creado igual.
    const pendiente = id ?? anotado;
    if (pendiente && g.queda() >= MINIMO_MS) {
      try {
        const d = await g.pedirJSON("DELETE", `${ruta}/${encodeURIComponent(pendiente)}`);
        if ([200, 204, 404, 410].includes(d.status)) await store.delete(CLAVE_PRUEBA(familiaId));
      } catch {
        /* queda anotado para la próxima */
      }
    }
    return res;
  }
}

