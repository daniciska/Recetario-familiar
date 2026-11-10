// Arnés de las pruebas de punta a punta del motor con Google Calendar (plan de pruebas §A y C4):
// motor real (servidor/sincronizar.ts) + transporte real (servidor/google/transporte.ts) + simulador de
// la API (google/mock-google.mts, con su /token) + Blobs en memoria (blobs-mock.mjs). Sin red: todo va a
// 127.0.0.1 y la clave es de prueba (google/clave-prueba.ts).
//
//   import * as h from "../h.ts";
//   const sim = await h.arrancar();                  // simulador + clave + GOOGLE_* (una vez por proceso)
//   const cal = h.nuevoCalendario();                 // "c_…@group.calendar.google.com", la cuenta de servicio como owner
//   const fam = await h.familia([h.ev("a1"), h.ev("a2", { repeticion: "semanal" })]);
//   const con = h.conexionGoogle(cal);
//   const r = await h.sync(fam, con);                // la primera vez anota la conexión en acceso.calendarios
//   h.ok("subió todo", r.ok && h.vivos(cal).length === 2, r);
//   await h.terminar();                              // cierra el simulador, imprime el resumen y sale (1 si hubo MAL)
//
// API:
//   arrancar(op?) → Simulador          OpcionesSimulador extra (semilla, interruptores, paginacion…). Se puede
//                                       volver a llamar después de cerrar() (p. ej. una semilla nueva en el fuzz).
//   simulador(), clave, SA              el simulador en uso, la clave de prueba y el correo de la cuenta de servicio
//   cerrar()                            cierra el simulador
//   nuevoCalendario({zona?, rol?, resumen?, dueno?}) → calId
//   familia(eventos, miembros?) → familiaId   (acceso, eventos y miembros en Blobs)
//   conexionGoogle(calId, id?) / conexionICloud(url, id?) → ConexionCalendario
//   registrarConexion(fam, con)         la anota en acceso.calendarios (el motor la exige)
//   desconectar(fam, con)               lo mismo que POST /desconectar: saca la conexión, quita los vínculos y borra el estado
//   conectarSinSubir(fam, con)          lo mismo que /conectar con subirExistentes:false (estado.soloPanelInicial)
//   sync(fam, con, ms?, resolver?, extra?) → Resultado   S.sincronizar con límite Date.now() + ms (6500: la función normal)
//   estado(fam, con), leerEventos(fam), guardarEventos(fam, fn), cambiarEvento(fam, id, cambios | fn)
//   hookFetch(g)                        g(metodo, url, init) → Response (se usa en vez de la red) | número (ms de
//                                       demora antes de pasar, respeta el signal) | nada
//   log                                 "METODO ruta" de cada fetch (token incluido)
//   ev(id, extra?), miembros, gid(idPanel, gen?), uidPanel(idPanel)
//   contar() → {api, escrituras, porTipo}   del simulador desde el último reiniciarContadores()
//   vivos(calId)                        eventos vivos guardados en el simulador (sin lápidas)
//   proyeccion(fam, con) → Map<uid, Evento[]>  lo que Google tiene, leído con leerRecurso (como lo vería el motor)
//   comparar(fam, con) → string[]       diferencias entre la pared y la proyección (vacío = coinciden)
//   ok(nombre, cond, detalle?), seccion(t), caso(nombre, fn), terminar()
import { iniciarSimulador, type OpcionesSimulador, type Rol, type Simulador } from "./google/mock-google.mts";
import { clavePrueba, usarClave } from "./google/clave-prueba.ts";
import * as S from "../servidor/sincronizar.ts";
import * as C from "../servidor/comun.ts";
import { huellaGrupo, leerRecurso, type Contexto } from "../servidor/ics.ts";
import { olvidarTokens } from "../servidor/google/cuenta.ts";
import { idGoogleDe } from "../servidor/google/ids.ts";
import { agrupar, serieAIcs, type EvG } from "../servidor/google/serie.ts";
import { ahoraEnSantiago } from "../lib/fechas.ts";
import type { Evento, Miembro } from "../lib/datos/tipos.ts";
import type { ConexionCalendario } from "../servidor/comun.ts";

export { S, C };

// ---------- Resultados ----------

let buenas = 0;
let malas = 0;
export const ok = (nombre: string, cond: unknown, detalle: unknown = "") => {
  if (cond) buenas++;
  else malas++;
  const d = detalle === "" ? "" : ` · ${(typeof detalle === "string" ? detalle : JSON.stringify(detalle)).slice(0, 900)}`;
  console.log(`${cond ? "OK " : "MAL"} ${nombre}${cond ? "" : d}`);
};
export const seccion = (t: string) => console.log(`\n# ${t}`);
export const cuantas = () => ({ buenas, malas });
/** Corre un caso; si lanza, cuenta como MAL (con la pila) y sigue con el siguiente. */
export async function caso(nombre: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    ok(`${nombre} (lanzó)`, false, `${(e as Error)?.name}: ${(e as Error)?.message}\n${(e as Error)?.stack?.split("\n").slice(1, 5).join("\n")}`);
  }
}

// ---------- Simulador y clave ----------

export const clave = clavePrueba();
export const SA = clave.correo;
let actual: Simulador | null = null;
const zonas = new Map<string, string>();

export async function arrancar(op: OpcionesSimulador = {}): Promise<Simulador> {
  if (actual) await actual.cerrar();
  actual = await iniciarSimulador({ ...op, cuentas: new Map([[SA, clave.publica], ...(op.cuentas ?? [])]) });
  process.env.GOOGLE_API_URL = actual.apiUrl;
  process.env.GOOGLE_TOKEN_URL = actual.tokenUrl;
  usarClave(clave);
  olvidarTokens(); // los tokens de un simulador anterior no le sirven a éste
  return actual;
}

export function simulador(): Simulador {
  if (!actual) throw new Error("h.ts: falta arrancar()");
  return actual;
}

export async function cerrar() {
  if (actual) await actual.cerrar();
  actual = null;
}

export async function terminar() {
  await cerrar();
  console.log(`\n${buenas} OK, ${malas} MAL`);
  process.exit(malas ? 1 : 0);
}

let nCal = 0;
export function nuevoCalendario(op: { zona?: string; rol?: Rol; resumen?: string; dueno?: string } = {}): string {
  const id = `c_${Date.now().toString(36)}${(++nCal).toString(36)}${Math.random().toString(36).slice(2, 6)}@group.calendar.google.com`;
  const zona = op.zona ?? "America/Santiago";
  simulador().crearCalendario(id, { zona, resumen: op.resumen ?? "Familia", dueno: op.dueno ?? "mama@gmail.com" });
  simulador().compartir(id, SA, op.rol ?? "owner");
  zonas.set(id, zona);
  return id;
}

// ---------- Familia, conexión y sincronización ----------

export const miembros: Miembro[] = [
  { id: "sofi", nombre: "Sofía", emoji: "🦄", color: "#F4B6C2" },
  { id: "tomi", nombre: "Tomás", emoji: "⚽", color: "#B5D8F0" },
  { id: "mama", nombre: "Mamá", emoji: "🌸", color: "#D7C4F0" },
] as Miembro[];

export const ev = (id: string, extra: Partial<Evento> = {}): Evento => ({
  id,
  titulo: "Evento " + id,
  miembros: ["sofi"],
  fecha: "2026-11-20",
  todoElDia: false,
  horaInicio: "10:00",
  horaFin: "11:00",
  repeticion: "nunca",
  ...extra,
});

export const uidPanel = (idPanel: string) => `${idPanel}@calendario-familiar`;
/** Id de Google del evento que el panel crea para `idPanel` (gen = generación tras una lápida). */
export const gid = (idPanel: string, gen = 0) => idGoogleDe(uidPanel(idPanel), gen);

export async function familia(eventos: Evento[], mbs: Miembro[] = miembros): Promise<string> {
  const fam = "f" + Math.random().toString(36).slice(2, 10);
  const st = C.almacen();
  await st.setJSON(`acceso/${fam}`, { familia: { id: fam, nombre: "Familia de prueba" }, equipos: {}, versiones: {} });
  await st.setJSON(`datos/${fam}/eventos`, { datos: eventos, version: 1 });
  await st.setJSON(`datos/${fam}/miembros`, { datos: mbs, version: 1 });
  return fam;
}

export function conexionGoogle(calId: string, id = "con1"): ConexionCalendario {
  return { id, proveedor: "google", nombre: "Familia", url: calId, creada: new Date().toISOString() } as ConexionCalendario;
}
export function conexionICloud(url: string, id = "con1"): ConexionCalendario {
  return { id, proveedor: "icloud", nombre: "Familia", url, creada: new Date().toISOString() } as ConexionCalendario;
}

export async function registrarConexion(fam: string, con: ConexionCalendario) {
  await C.cambiarAcceso(fam, (a) => ({ ...a!, calendarios: [...(a!.calendarios ?? []).filter((c) => c.id !== con.id), con] }));
}

const registradas = new Set<string>();
export async function sync(fam: string, con: ConexionCalendario, ms = 6500, resolver?: S.Resolver, extra: { codigo?: string; uids?: string[] } = {}) {
  if (!registradas.has(`${fam}|${con.id}`)) {
    registradas.add(`${fam}|${con.id}`);
    await registrarConexion(fam, con);
  }
  return S.sincronizar(fam, con, { limite: Date.now() + ms, resolver, ...extra });
}

/** Lo mismo que /desconectar: saca la conexión, deja los eventos sin vínculo y borra el estado. */
export async function desconectar(fam: string, con: ConexionCalendario) {
  await C.cambiarAcceso(fam, (a) => ({ ...a!, calendarios: (a!.calendarios ?? []).filter((c) => c.id !== con.id) }));
  await guardarEventos(fam, (l) =>
    l.map((e) => {
      if (e.externo?.conexion !== con.id) return e;
      const { externo: _, ...resto } = e;
      return resto as Evento;
    }),
  );
  await S.borrarEstado(fam, con.id);
  registradas.delete(`${fam}|${con.id}`);
}

/** Lo mismo que /conectar con subirExistentes:false: los eventos que ya están quedan sólo en la pared. */
export async function conectarSinSubir(fam: string, con: ConexionCalendario) {
  const l = await leerEventos(fam);
  const ids = l.filter((e) => !e.soloPanel && !e.externo).map((e) => e.id);
  await S.guardarEstado(fam, con.id, { recursos: {}, ...(ids.length ? { soloPanelInicial: ids } : {}) });
  await registrarConexion(fam, con);
  registradas.add(`${fam}|${con.id}`);
}

export const estado = (fam: string, con: ConexionCalendario) => S.leerEstado(fam, con.id);

export async function leerEventos(fam: string): Promise<Evento[]> {
  return ((await C.leerColeccion(fam, "eventos"))?.datos ?? []) as Evento[];
}

export async function guardarEventos(fam: string, fn: (l: Evento[]) => Evento[]) {
  for (let i = 0; i < 6; i++) {
    const c = await C.leerColeccion(fam, "eventos");
    const g = await C.guardarColeccion(fam, "eventos", fn((c?.datos ?? []) as Evento[]), c?.version ?? 0);
    if (g.ok) {
      await C.anotarVersiones(fam, { eventos: g.version });
      return g.version;
    }
  }
  throw new Error("h.ts: no se pudo guardar");
}

/** Cambia un evento como lo haría la pared (con `actualizado` = ahora, salvo que el cambio traiga otro). */
export async function cambiarEvento(fam: string, id: string, cambios: Partial<Evento> | ((e: Evento) => Evento)) {
  let visto = false;
  await guardarEventos(fam, (l) =>
    l.map((e) => {
      if (e.id !== id) return e;
      visto = true;
      return typeof cambios === "function" ? cambios(e) : { ...e, actualizado: new Date().toISOString(), ...cambios };
    }),
  );
  if (!visto) throw new Error(`h.ts: no hay un evento ${id} en la pared`);
}

// ---------- fetch con gancho ----------

type Gancho = (metodo: string, url: string, init: RequestInit) => Promise<Response | number | void> | Response | number | void;
let gancho: Gancho | null = null;
export const hookFetch = (g: Gancho | null) => void (gancho = g);
export const log: string[] = [];
const fetchReal = globalThis.fetch;
export const urlsVistas: string[] = [];
globalThis.fetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
  const u = String(url instanceof Request ? url.url : url);
  const m = (init.method ?? "GET").toUpperCase();
  urlsVistas.push(u);
  log.push(`${m} ${u.replace(/^http:\/\/127\.0\.0\.1:\d+/, "")}`);
  if (log.length > 5000) log.splice(0, 1000);
  if (gancho) {
    const r = await gancho(m, u, init);
    if (r instanceof Response) return r;
    if (typeof r === "number")
      await new Promise<void>((listo, falla) => {
        const t = setTimeout(listo, r);
        init.signal?.addEventListener("abort", () => {
          clearTimeout(t);
          const e = new Error("This operation was aborted");
          e.name = "AbortError";
          falla(e);
        });
      });
  }
  return fetchReal(url, init);
}) as typeof fetch;

// ---------- Mirar el simulador ----------

export function contar() {
  const c = simulador().contadores;
  return { api: c.api, escrituras: c.escrituras, porTipo: { ...c.porTipo } };
}

export const vivos = (calId: string) => simulador().eventos(calId, { lapidas: false });

/** Lo que Google tiene de ese calendario, armado como lo vería el motor (agrupar + serieAIcs + leerRecurso). */
export async function proyeccion(fam: string, con: ConexionCalendario): Promise<Map<string, Evento[]>> {
  const mbs = ((await C.leerColeccion(fam, "miembros"))?.datos ?? []) as Miembro[];
  const ctx: Contexto = { conexion: con.id, miembros: mbs, hoy: ahoraEnSantiago().fecha };
  const series = agrupar(simulador().eventos(con.url) as EvG[], con.url, zonas.get(con.url) ?? "America/Santiago");
  const r = new Map<string, Evento[]>();
  for (const s of series.values()) {
    const g = leerRecurso(serieAIcs(s), ctx);
    if (g) r.set(g.uid, [...(r.get(g.uid) ?? []), ...g.eventos]);
  }
  return r;
}

/**
 * Diferencias entre la pared y Google (vacío = coinciden): cada serie de Google tiene en la pared un grupo
 * con la misma huella (lo que el motor compara), no hay vínculos a series que no existen, ni eventos sin
 * vínculo que no sean "sólo en la pared", ni el mismo día dos veces.
 */
export async function comparar(fam: string, con: ConexionCalendario): Promise<string[]> {
  const mbs = ((await C.leerColeccion(fam, "miembros"))?.datos ?? []) as Miembro[];
  const pared = await leerEventos(fam);
  const remoto = await proyeccion(fam, con);
  const dif: string[] = [];
  const grupos = new Map<string, Evento[]>();
  for (const e of pared) {
    if (e.externo?.conexion !== con.id) continue;
    grupos.set(e.externo.uid, [...(grupos.get(e.externo.uid) ?? []), e]);
  }
  for (const [uid, rem] of remoto) {
    const loc = grupos.get(uid) ?? [];
    if (huellaGrupo(loc, mbs) !== huellaGrupo(rem, mbs)) {
      dif.push(`${uid}: pared ${JSON.stringify(loc.map(resumen))} ≠ Google ${JSON.stringify(rem.map(resumen))}`);
    }
  }
  for (const [uid, loc] of grupos) {
    if (!remoto.has(uid) && loc.some((e) => !e.soloPanel)) dif.push(`${uid}: vinculado en la pared pero no está en Google`);
  }
  for (const e of pared) if (!e.externo && !e.soloPanel) dif.push(`${e.id}: sin vínculo y sin "sólo en la pared"`);
  const dias = new Set<string>();
  for (const e of pared) {
    if (!e.externo) continue;
    const k = `${e.externo.uid}|${e.externo.recurrencia ?? ""}`;
    if (dias.has(k)) dif.push(`${k}: dos veces en la pared`);
    dias.add(k);
  }
  return dif;
}

/** Un evento en pocas palabras (para los detalles de un MAL). */
export function resumen(e: Evento) {
  return [
    e.titulo,
    e.miembros.join("+"),
    e.fecha + (e.fechaFin ? `..${e.fechaFin}` : ""),
    e.todoElDia ? "día" : `${e.horaInicio ?? ""}-${e.horaFin ?? ""}`,
    e.repeticion + (e.intervalo ? `/${e.intervalo}` : "") + (e.diasSemana ? `[${e.diasSemana}]` : "") + (e.repetirHasta ? `→${e.repetirHasta}` : ""),
    e.excepciones?.length ? `sin ${e.excepciones.join(",")}` : "",
    e.fechas?.length ? `fechas ${e.fechas.length}` : "",
    e.externo?.recurrencia ? `día ${e.externo.recurrencia}` : "",
    e.lugar ?? "",
    e.soloPanel ? "soloPanel" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export const dormir = (ms: number) => new Promise((listo) => setTimeout(listo, ms));
