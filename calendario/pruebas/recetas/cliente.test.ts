// La parte de la app de «🎙️ Dictar receta» (lib/dictados/cliente.ts, pendientes.ts, reglas.ts y motor.ts)
// contra el servidor de verdad en el mismo proceso: fetch apunta a manejarApi (servidor/dictados.ts), a
// api-salud.mts y a api-datos.mts (para RepositorioNube), con Blobs en memoria, IndexedDB falsa
// (idb-falso.ts), el simulador de Gemini en 127.0.0.1 y la corrida en segundo plano disparada como en
// Netlify. Sin red ni clave real.
//   node --experimental-transform-types --no-warnings --import ./pruebas/registrar.mjs pruebas/recetas/cliente.test.ts
import { resolveObjectURL } from "node:buffer";
import { reiniciarBlobs } from "@netlify/blobs";
import * as C from "../../servidor/comun.ts";
import { manejarApi, manejarProceso, type DepsDictados } from "../../servidor/dictados.ts";
import { AccesoRevocado, SinConexion } from "../../lib/datos/nube.ts";
import * as cliente from "../../lib/dictados/cliente.ts";
import { RechazoDictado, SinNube } from "../../lib/dictados/cliente.ts";
import * as pendientes from "../../lib/dictados/pendientes.ts";
import { CADA_LOCALES_MS, CADA_MS, ESPERA_SUBIDO_MS, MAX_INTENTOS_SOLOS, debeReintentar, porLimpiar, proximaRevision, recetasConfirmadas, subeSolo, yaGuardados } from "../../lib/dictados/reglas.ts";
import { crearMotor } from "../../lib/dictados/motor.ts";
import { RepositorioNube } from "../../lib/datos/repositorioNube.ts";
import type { Receta } from "../../lib/datos/tipos.ts";
import { ID_DICTADO, MAX_PENDIENTES, MAX_SEGUNDOS, type CodigoError, type DictadoPublico } from "../../lib/dictados/tipos.ts";
import { simuladorGemini } from "./mock-gemini.mts";
import { cabecera, grabadoChrome } from "./audios.ts";
import { instalarIDBFalso } from "./idb-falso.ts";
import { caso, ok, seccion, terminar } from "./arnes.ts";

type O = Record<string, any>;
const igual = (n: string, a: unknown, b: unknown) => ok(n, JSON.stringify(a) === JSON.stringify(b), { obtenido: a, esperado: b });
const CLAVE = `${"AI" + "za"}SyPRUEBA-cliente-no-es-real_0123456`;
const BASE = "calendario-familiar-dictados";

// ---------- El servidor en el mismo proceso ----------
const errores: string[] = [];
console.error = (...a: unknown[]) => void errores.push(a.map(String).join(" "));
const sim = await simuladorGemini({ clave: CLAVE });
const env: Record<string, string | undefined> = { GEMINI_API_KEY: CLAVE, GEMINI_API_URL: sim.url, URL: "http://sitio.test" };
let desfase = 0;
const reloj = { ahora: () => Date.now() + desfase, dormir: async (ms: number) => void (desfase += ms) };
const corridas: Promise<unknown>[] = [];
let dispararActivo = true;
const deps: DepsDictados = {
  reloj,
  env,
  log: () => {},
  disparar: async (base, auth, id) => {
    if (!dispararActivo) return false;
    corridas.push(proceso(new Request(`${base}/api/dictados-proceso`, { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify({ id }) })));
    return true;
  },
};
const api = manejarApi(deps);
const proceso = manejarProceso(deps);
const salud = (await import("../../netlify/functions/api-salud.mts")).default as unknown as () => Promise<Response>;
const apiDatos = (await import("../../netlify/functions/api-datos.mts")).default as unknown as (req: Request, ctx: unknown) => Promise<Response>;
async function esperar() {
  while (corridas.length) await corridas.shift();
}

// fetch de la app → el handler. `cortes`: los próximos N pedidos fallan como sin red; `caida`: responde 503;
// `falsa`: si devuelve una respuesta, esa va en vez de la del servidor (para lo que el servidor de esta
// versión todavía no hace o no se puede provocar).
const pedidos: { metodo: string; ruta: string; busqueda: string; status: number; auth: boolean }[] = [];
let cortes = 0;
let caida = 0;
let falsa: ((metodo: string, url: URL) => Response | undefined) | undefined;
let enVuelo = 0;
const fetchReal = globalThis.fetch;
globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(entrada), "http://sitio.test");
  if (url.host !== "sitio.test") return fetchReal(entrada, init); // el servidor hablando con el simulador de Gemini
  if (cortes > 0) {
    cortes--;
    throw new TypeError("fetch failed");
  }
  const req = new Request(url, init);
  let r: Response;
  const clave = /^\/api\/datos(?:\/([^/]+))?$/.exec(url.pathname);
  enVuelo++;
  try {
  if (falsa?.(req.method, url)) {
    r = falsa(req.method, url)!;
  } else if (caida > 0) {
    caida--;
    r = new Response("Bad gateway", { status: 503 });
  } else if (url.pathname === "/api/salud") {
    const antes = process.env.GEMINI_API_KEY;
    if (env.GEMINI_API_KEY) process.env.GEMINI_API_KEY = env.GEMINI_API_KEY;
    else delete process.env.GEMINI_API_KEY;
    try {
      r = await salud();
    } finally {
      if (antes === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = antes;
    }
  } else if (clave) r = await apiDatos(req, { params: clave[1] ? { clave: clave[1] } : {} });
  else r = await api(req);
  } finally {
    enVuelo--;
  }
  pedidos.push({ metodo: req.method, ruta: url.pathname, busqueda: url.search, status: r.status, auth: !!req.headers.get("authorization") });
  return r;
}) as typeof fetch;

// localStorage con la sesión de la nube (lib/datos/nube.ts → leerSesion).
const memoria = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => memoria.get(k) ?? null,
    setItem: (k: string, v: string) => void memoria.set(k, String(v)),
    removeItem: (k: string) => void memoria.delete(k),
  },
});
const conectar = (token: string, equipoId: string) => memoria.set("calendario-familiar:nube", JSON.stringify({ token, equipoId, familia: { id: "fcli", nombre: "Familia" } }));
const desconectar = () => memoria.delete("calendario-familiar:nube");

reiniciarBlobs();
await C.almacen().setJSON("acceso/fcli", { familia: { id: "fcli", nombre: "Familia" }, equipos: {}, versiones: {} });
const equipo = await C.nuevoEquipo("fcli", "iPhone");
const WEBM = grabadoChrome();
const blobDe = (b: Uint8Array, tipo = "audio/webm") => new Blob([b], { type: tipo });
const SIN_ESPERAS = { esperas: [0, 0] };
const dormir = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
/** Espera a que no quede nada en vuelo (pedidos, subidas, IndexedDB falsa, corridas de Gemini). */
async function calma() {
  for (let i = 0; i < 400; i++) {
    await dormir(5);
    if (enVuelo === 0 && !cliente.subiendoAhora().length) {
      await dormir(15);
      if (enVuelo === 0 && !cliente.subiendoAhora().length) return esperar();
    }
  }
}
/** Pone recetas rec_<id> en la colección de la familia en la nube (como si un equipo las hubiera guardado). */
async function recetaEnNube(...ids: string[]) {
  const actual = (await C.leerColeccion("fcli", "recetas")) as { datos: O[]; version: number } | null;
  const datos = [...(actual?.datos ?? []), ...ids.map((id) => ({ id: `rec_${id}`, nombre: "Receta dictada", emoji: "🍲", porciones: 4, ingredientes: [], pasos: [] }))];
  await C.guardarColeccion("fcli", "recetas", datos, actual?.version ?? 0);
}

// ---------------------------------------------------------------------------------------------
seccion("Ids y copias locales");
await caso("ids", () => {
  const ids = new Set(Array.from({ length: 2000 }, () => cliente.nuevoIdDictado()));
  ok("2000 ids distintos y todos válidos para el servidor (ID_DICTADO)", ids.size === 2000 && [...ids].every((x) => ID_DICTADO.test(x)));
  igual(
    "tipoDeArchivo deduce el tipo cuando Safari lo deja vacío",
    ["PTT-20261109-WA0001.opus", "nota.M4A", "x.mp3", "x.wav", "raro.xyz", "sin-extension"].map((n) => cliente.tipoDeArchivo(n, "")),
    ["audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "application/octet-stream", "application/octet-stream"],
  );
  igual("tipoDeArchivo respeta el tipo que viene (sin parámetros)", cliente.tipoDeArchivo("x.opus", "audio/webm;codecs=opus"), "audio/webm");
  const p = cliente.nuevoPendiente(blobDe(WEBM, ""), { origen: "archivo", archivo: "  PTT-20261109-WA0001.opus ", segundos: 20.4 }, new Date("2026-11-09T17:05:00Z"));
  ok(
    "nuevoPendiente arma la copia con id, tipo, nombre, segundos y fecha",
    ID_DICTADO.test(p.id) && p.mime === "audio/ogg" && p.archivo === "PTT-20261109-WA0001.opus" && p.segundos === 20 && p.creado === "2026-11-09T17:05:00.000Z" && p.origen === "archivo",
    { ...p, blob: undefined },
  );
  const g = cliente.nuevoPendiente(blobDe(WEBM), { origen: "grabacion", segundos: 0, mime: "audio/webm" });
  ok("una grabación sin segundos ni archivo no lleva esas claves", !("segundos" in g) && !("archivo" in g) && g.mime === "audio/webm");
});

seccion("Sin IndexedDB (modo privado, navegador viejo) nada se cae");
await caso("sin idb", async () => {
  const p = cliente.nuevoPendiente(blobDe(WEBM), { origen: "grabacion" });
  ok("guardar da false", (await pendientes.guardar(p)) === false);
  igual("listar, resumenes y leer dan vacío", [await pendientes.listar(), await pendientes.resumenes(), await pendientes.leer(p.id)], [[], [], null]);
  await pendientes.borrar(p.id);
  await pendientes.anotarRechazo(p.id, { mensaje: "x", reintentar: false });
  ok("borrar y anotarRechazo no lanzan", true);
});

const idb = instalarIDBFalso();
seccion("Copia en el equipo (IndexedDB)");
await caso("idb", async () => {
  idb.fallar(true);
  ok("si IndexedDB no abre, guardar da false", (await pendientes.guardar(cliente.nuevoPendiente(blobDe(WEBM), { origen: "grabacion" }))) === false);
  idb.fallar(false);
  const a = cliente.nuevoPendiente(blobDe(WEBM), { origen: "grabacion", segundos: 6 }, new Date("2026-11-09T17:05:00Z"));
  const b = cliente.nuevoPendiente(blobDe(cabecera("ogg", 3000), "audio/ogg"), { origen: "archivo", archivo: "PTT.opus" }, new Date("2026-11-09T17:00:00Z"));
  ok("guardar da true", (await pendientes.guardar(a)) && (await pendientes.guardar(b)));
  const filas = idb.filas(BASE, "audios") as O[];
  ok("los bytes se guardan como ArrayBuffer (no como Blob)", filas.every((f) => f.datos instanceof ArrayBuffer && !("blob" in f)), filas.map((f) => Object.keys(f)));
  const rs = await pendientes.resumenes();
  igual("resumenes: sin bytes, con el tamaño, del más viejo al más nuevo", rs.map((r) => [r.id, r.bytes, "datos" in r, "blob" in r]), [
    [b.id, 3000, false, false],
    [a.id, WEBM.byteLength, false, false],
  ]);
  const l = await pendientes.leer(a.id);
  ok("leer devuelve el audio con los mismos bytes y su tipo", !!l && l.blob.type === "audio/webm" && Buffer.from(await l.blob.arrayBuffer()).equals(Buffer.from(WEBM)) && l.segundos === 6);
  igual("listar trae los dos con sus bytes", (await pendientes.listar()).map((x) => [x.id, x.blob.size]), [
    [b.id, 3000],
    [a.id, WEBM.byteLength],
  ]);
  await pendientes.anotarRechazo(b.id, { mensaje: "Muy grande", reintentar: false });
  igual("anotarRechazo queda en los dos almacenes", [(await pendientes.leer(b.id))?.rechazo, (await pendientes.resumenes())[0].rechazo], [
    { mensaje: "Muy grande", reintentar: false },
    { mensaje: "Muy grande", reintentar: false },
  ]);
  await pendientes.anotarRechazo(b.id, undefined);
  ok("…y se puede quitar", !("rechazo" in (await pendientes.resumenes())[0]));
  await pendientes.anotarRechazo("noexiste", { mensaje: "x", reintentar: true });
  ok("anotarRechazo de uno que no está no lo crea", (await pendientes.resumenes()).length === 2);
  idb.fallarEscritura(true);
  ok("con el equipo lleno, guardar da false", (await pendientes.guardar(cliente.nuevoPendiente(blobDe(WEBM), { origen: "grabacion" }))) === false);
  idb.fallarEscritura(false);
  await pendientes.borrar(a.id);
  await pendientes.borrar(b.id);
  igual("borrar quita de los dos almacenes", [idb.filas(BASE, "audios").length, idb.filas(BASE, "resumen").length], [0, 0]);
});

// ---------------------------------------------------------------------------------------------
seccion("Sin nube");
await caso("sin nube", async () => {
  desconectar();
  ok("hayNube() es false", !cliente.hayNube());
  let e: unknown;
  await cliente.listarDictados().catch((x) => (e = x));
  ok("listarDictados lanza SinNube (que también es SinConexion)", e instanceof SinNube && e instanceof SinConexion);
  const p = cliente.nuevoPendiente(blobDe(WEBM), { origen: "grabacion" });
  await pendientes.guardar(p);
  igual("subirPendiente sin nube: sin_conexion, sin pedir nada", [await cliente.subirPendiente(p, SIN_ESPERAS), pedidos.length], [{ ok: false, motivo: "sin_conexion" }, 0]);
  ok("…y la copia queda", (await pendientes.leer(p.id)) !== null);
  ok("descartarBorrador sin nube → descartado", (await cliente.descartarBorrador(p.id)) === "descartado");
  ok("…borra la copia del equipo y no pide nada", (await pendientes.leer(p.id)) === null && pedidos.length === 0);
});

conectar(equipo.token, equipo.equipoId);
seccion("Subir, Gemini, revisar, guardar");
let idListo = "";
await caso("flujo", async () => {
  ok("hayNube() es true", cliente.hayNube());
  igual("salud", await cliente.salud(), { blobs: true, gemini: "ok" });
  const p = cliente.nuevoPendiente(blobDe(WEBM), { origen: "grabacion", segundos: 95 });
  ok("se guarda en el equipo antes de subir", await pendientes.guardar(p));
  const s1 = cliente.subirPendiente(p, SIN_ESPERAS);
  const s2 = cliente.subirPendiente(p, SIN_ESPERAS);
  ok("dos subidas del mismo audio en la pestaña son la misma (subiendo() lo dice)", s1 === s2 && cliente.subiendo(p.id));
  const r = await s1;
  ok("subirPendiente → ok con el dictado", r.ok && r.dictado.id === p.id && r.dictado.segundos === 95 && r.dictado.origen === "grabacion", r);
  ok("un solo PUT", pedidos.filter((x) => x.metodo === "PUT").length === 1);
  ok("la copia del equipo se borró al confirmar la nube", (await pendientes.leer(p.id)) === null && !cliente.subiendo(p.id));
  const otra = await cliente.subirPendiente(p, SIN_ESPERAS);
  ok("volver a subir el mismo id → ok (200, idempotente)", otra.ok && pedidos.at(-1)?.status === 200);
  await esperar();
  const d = await cliente.leerDictado(p.id);
  ok("Gemini lo dejó listo con borrador", d?.estado === "listo" && d.borrador?.id === `rec_${p.id}` && !!d.transcripcion, d?.estado);
  const l = await cliente.listarDictados();
  ok("listarDictados: está, sin borrador, y gemini ok", l.gemini === "ok" && l.dictados.length === 1 && l.dictados[0].id === p.id && !("borrador" in l.dictados[0]) && l.dictados[0].nombre === d?.borrador?.nombre);
  const t = await cliente.leerTexto(p.id);
  ok("leerTexto mientras está pendiente (sale del registro)", t?.transcripcion === d?.transcripcion && t?.segundos === 95);
  const url = await cliente.bajarAudio(p.id);
  const b = typeof url === "string" && url !== "borrado" ? resolveObjectURL(url) : undefined;
  ok("bajarAudio da una dirección blob: con los mismos bytes y su tipo", url.startsWith("blob:") && !!b && b.type === "audio/webm" && Buffer.from(await b.arrayBuffer()).equals(Buffer.from(WEBM)), url);
  if (url.startsWith("blob:")) URL.revokeObjectURL(url);
  ok("bajarAudio manda la clave del equipo", pedidos.at(-1)?.ruta.endsWith("/audio") && pedidos.at(-1)?.auth);
  const igualito = await cliente.procesarDictado(p.id);
  ok("procesar uno listo → lo devuelve tal cual (200)", igualito?.estado === "listo" && igualito.borrador?.nombre === d?.borrador?.nombre);
  const otraVersion = await cliente.procesarDictado(p.id, true);
  ok("pedir otra versión → vuelve a la cola sin borrador (202)", otraVersion?.estado === "subido" && !otraVersion.borrador && pedidos.at(-1)?.status === 202, otraVersion);
  await esperar();
  ok("…y queda lista otra vez", (await cliente.leerDictado(p.id))?.estado === "listo");
  await recetaEnNube(p.id); // la receta llegó a Recetas en la nube
  ok("marcarGuardado → true", (await cliente.marcarGuardado(p.id, `rec_${p.id}`)) === true);
  ok("…y sale de la lista", (await cliente.leerDictado(p.id)) === null && (await cliente.listarDictados()).dictados.length === 0);
  ok("marcarGuardado otra vez → true (idempotente)", (await cliente.marcarGuardado(p.id, `rec_${p.id}`)) === true && pedidos.at(-1)?.status === 200);
  const t2 = await cliente.leerTexto(p.id);
  ok("lo que se dijo queda en la nube con la receta", t2?.transcripcion === d?.transcripcion && t2?.recetaId === `rec_${p.id}`);
  ok("y el audio también", (await cliente.bajarAudio(p.id)).startsWith("blob:"));
  await pendientes.guardar(p);
  const ya = await cliente.subirPendiente(p, SIN_ESPERAS);
  ok("subir de nuevo uno ya guardado → ya_guardada, y la copia sobrante se borra", !ya.ok && ya.motivo === "ya_guardada" && /ya se guardó/.test(ya.mensaje) && (await pendientes.leer(p.id)) === null, ya);
  idListo = p.id;
});

seccion("Descartar un borrador o quitar el audio de una receta guardada");
await caso("descartar", async () => {
  await cliente.quitarAudio(idListo);
  ok("quitarAudio de uno guardado manda DELETE sin ?borrador", pedidos.at(-1)?.metodo === "DELETE" && pedidos.at(-1)?.busqueda === "", pedidos.at(-1));
  ok("…y borra el audio y lo que se dijo", (await cliente.bajarAudio(idListo)) === "borrado" && (await cliente.leerTexto(idListo)) === null);
  await cliente.quitarAudio(idListo);
  ok("quitarAudio otra vez → ok (idempotente)", pedidos.at(-1)?.status === 200);
  ok("descartarDictado (lo de antes) es quitarAudio mientras las pantallas se cambian", cliente.descartarDictado === cliente.quitarAudio);
  const p = cliente.nuevoPendiente(blobDe(WEBM), { origen: "grabacion" });
  await pendientes.guardar(p);
  dispararActivo = false;
  ok("sube", (await cliente.subirPendiente(p, SIN_ESPERAS)).ok);
  await pendientes.guardar(p); // como si la copia no se hubiera alcanzado a borrar
  ok("descartarBorrador de uno en cola → descartado", (await cliente.descartarBorrador(p.id)) === "descartado");
  ok("…con DELETE ?borrador=1", pedidos.at(-1)?.metodo === "DELETE" && pedidos.at(-1)?.busqueda === "?borrador=1", pedidos.at(-1));
  ok("…no existe más, ni el audio, ni la copia", (await cliente.leerDictado(p.id)) === null && (await cliente.bajarAudio(p.id)) === "borrado" && (await pendientes.leer(p.id)) === null);
  ok("procesar uno que ya no existe → null", (await cliente.procesarDictado(p.id)) === null);
  const q = cliente.nuevoPendiente(blobDe(WEBM), { origen: "grabacion" });
  await pendientes.guardar(q);
  cortes = 1;
  let e: unknown;
  await cliente.descartarBorrador(q.id).catch((x) => (e = x));
  ok("sin red al descartar: SinConexion, pero la copia del equipo ya se borró", e instanceof SinConexion && (await pendientes.leer(q.id)) === null);
  dispararActivo = true;
  // Otro equipo ya guardó la receta y la revisión vieja de este la descarta (hallazgos 2 y 6): la nube no
  // borra nada y lo dice.
  const g = cliente.nuevoPendiente(blobDe(WEBM), { origen: "grabacion" });
  await pendientes.guardar(g);
  ok("sube", (await cliente.subirPendiente(g, SIN_ESPERAS)).ok);
  await esperar();
  await recetaEnNube(g.id);
  ok("el otro equipo la guarda", (await cliente.marcarGuardado(g.id, `rec_${g.id}`)) === true);
  await pendientes.guardar(g); // una copia que sobró en este equipo
  ok("descartarBorrador de una receta que ya se guardó → «guardada»", (await cliente.descartarBorrador(g.id)) === "guardada", pedidos.at(-1));
  const audio = await cliente.bajarAudio(g.id);
  ok("…el audio y lo que se dijo siguen en la nube", audio.startsWith("blob:") && (await cliente.leerTexto(g.id))?.recetaId === `rec_${g.id}`);
  if (audio.startsWith("blob:")) URL.revokeObjectURL(audio);
  ok("…y la copia sobrante del equipo se borró", (await pendientes.leer(g.id)) === null);
  await cliente.quitarAudio(g.id);
  ok("quitarAudio sí lo borra", (await cliente.bajarAudio(g.id)) === "borrado");
});

seccion("Los segundos de una grabación nunca pasan de 900 (hallazgo 14)");
await caso("segundos", async () => {
  ok("nuevoPendiente de una grabación de 900,6 s → 900", cliente.nuevoPendiente(blobDe(WEBM), { origen: "grabacion", segundos: 900.6 }).segundos === MAX_SEGUNDOS);
  ok("un archivo no se acota (la pantalla ya rechazó los largos)", cliente.nuevoPendiente(blobDe(WEBM), { origen: "archivo", segundos: 901 }).segundos === 901);
  // Una copia guardada por la versión anterior con segundos = 901: antes el servidor la rechazaba siempre (413).
  const vieja = { ...cliente.nuevoPendiente(blobDe(WEBM), { origen: "grabacion" }), segundos: 901 };
  await pendientes.guardar(vieja);
  dispararActivo = false;
  const r = await cliente.subirPendiente(vieja, SIN_ESPERAS);
  ok("una copia vieja con 901 s sube (manda 900)", r.ok && r.dictado.segundos === MAX_SEGUNDOS && pedidos.at(-1)?.busqueda.includes("segundos=900"), r);
  await cliente.descartarBorrador(vieja.id);
  dispararActivo = true;
});

seccion("Sin red y la nube caída");
await caso("red", async () => {
  const p = cliente.nuevoPendiente(blobDe(WEBM), { origen: "grabacion" });
  await pendientes.guardar(p);
  const antes = pedidos.length;
  cortes = 2;
  const r = await cliente.subirPendiente(p, SIN_ESPERAS);
  ok("2 cortes y al tercer intento sube", r.ok && pedidos.length === antes + 1, r);
  ok("…y la copia se borró", (await pendientes.leer(p.id)) === null);
  const q = cliente.nuevoPendiente(blobDe(WEBM), { origen: "grabacion" });
  await pendientes.guardar(q);
  cortes = 3;
  igual("3 cortes → sin_conexion", await cliente.subirPendiente(q, SIN_ESPERAS), { ok: false, motivo: "sin_conexion" });
  ok("…la copia sigue en el equipo, sin marca de rechazo", !!(await pendientes.leer(q.id)) && !(await pendientes.leer(q.id))?.rechazo);
  caida = 3;
  igual("la nube responde 503 tres veces → sin_conexion (no es un rechazo)", await cliente.subirPendiente(q, SIN_ESPERAS), { ok: false, motivo: "sin_conexion" });
  caida = 1;
  const r2 = await cliente.subirPendiente(q, SIN_ESPERAS);
  ok("un 503 y después sube", r2.ok);
  const t0 = Date.now();
  cortes = 1;
  const r3 = await cliente.subirPendiente(cliente.nuevoPendiente(blobDe(WEBM), { origen: "grabacion" }), { esperas: [30] });
  ok("espera entre intentos (esperas)", r3.ok && Date.now() - t0 >= 25);
  caida = 1;
  let e: unknown;
  await cliente.listarDictados().catch((x) => (e = x));
  ok("listarDictados con la nube caída → SinConexion", e instanceof SinConexion);
  cortes = 1;
  ok("salud sin red → null", (await cliente.salud()) === null);
  await esperar();
  for (const d of (await cliente.listarDictados()).dictados) await cliente.descartarBorrador(d.id);
});

seccion("Rechazos");
await caso("rechazos", async () => {
  const caf = cliente.nuevoPendiente(blobDe(cabecera("caf"), ""), { origen: "archivo", archivo: "nota.caf" });
  await pendientes.guardar(caf);
  const r = await cliente.subirPendiente(caf, SIN_ESPERAS);
  ok("CAF → rechazado con el texto del servidor", !r.ok && r.motivo === "rechazado" && r.mensaje === "Ese formato (CAF del iPhone) no sirve. Compártelo como m4a desde la app Notas de Voz.", r);
  igual("…la copia queda, marcada para no subirse sola", (await pendientes.leer(caf.id))?.rechazo, { mensaje: "Ese formato (CAF del iPhone) no sirve. Compártelo como m4a desde la app Notas de Voz.", reintentar: false });
  const grande = cliente.nuevoPendiente(blobDe(cabecera("ogg", 4_000_001)), { origen: "archivo" });
  await pendientes.guardar(grande);
  const r2 = await cliente.subirPendiente(grande, SIN_ESPERAS);
  ok("4.000.001 bytes → rechazado «máximo son 4 MB»", !r2.ok && r2.motivo === "rechazado" && /máximo son 4 MB/.test(r2.mensaje));
  await cliente.descartarBorrador(caf.id);
  await cliente.descartarBorrador(grande.id);
  // 20 sin revisar: el 21 queda «lleno» y se reintenta sola cuando haya cupo.
  dispararActivo = false;
  for (let n = 0; n < MAX_PENDIENTES; n++) await cliente.subirPendiente(cliente.nuevoPendiente(blobDe(cabecera("ogg", 200, n)), { origen: "grabacion" }), SIN_ESPERAS);
  const p21 = cliente.nuevoPendiente(blobDe(cabecera("ogg", 200, 99)), { origen: "grabacion" });
  await pendientes.guardar(p21);
  const r3 = await cliente.subirPendiente(p21, SIN_ESPERAS);
  ok("el 21 → lleno, con el texto del servidor", !r3.ok && r3.motivo === "lleno" && /Hay 20 recetas dictadas sin revisar/.test(r3.mensaje), r3);
  igual("…marcado para reintentar con cupo", (await pendientes.leer(p21.id))?.rechazo?.reintentar, true);
  const lista = (await cliente.listarDictados()).dictados;
  await cliente.descartarBorrador(lista[0].id);
  const r4 = await cliente.subirPendiente((await pendientes.leer(p21.id))!, SIN_ESPERAS);
  ok("con cupo sube y la copia se borra", r4.ok && (await pendientes.leer(p21.id)) === null);
  for (const d of (await cliente.listarDictados()).dictados) await cliente.descartarBorrador(d.id);
  dispararActivo = true;
  let e: unknown;
  await cliente.procesarDictado("MAL").catch((x) => (e = x));
  ok("un 400 → RechazoDictado con el mensaje y el status", e instanceof RechazoDictado && e.message === "Pedido inválido" && e.status === 400);
  const q = cliente.nuevoPendiente(blobDe(WEBM), { origen: "grabacion" });
  await pendientes.guardar(q);
  dispararActivo = false;
  await cliente.subirPendiente(q, SIN_ESPERAS);
  await recetaEnNube(q.id);
  e = undefined;
  await cliente.marcarGuardado(q.id, `rec_${q.id}`).catch((x) => (e = x));
  ok("marcarGuardado antes de estar listo → RechazoDictado «Todavía no está listo»", e instanceof RechazoDictado && e.message === "Todavía no está listo" && e.status === 409);
  falsa = (metodo, url) =>
    metodo === "POST" && url.pathname === `/api/dictados/${q.id}/guardado` ? Response.json({ error: "La receta todavía no está guardada", codigo: "RECETA_NO_GUARDADA" }, { status: 409 }) : undefined;
  ok("marcarGuardado con 409 RECETA_NO_GUARDADA → false (reintentar más tarde, no es un error)", (await cliente.marcarGuardado(q.id, `rec_${q.id}`)) === false);
  falsa = undefined;
  await cliente.descartarBorrador(q.id);
  dispararActivo = true;
});

seccion("Gemini sin clave y la clave del equipo revocada");
await caso("clave", async () => {
  ok("probarGemini con clave → ok y el modelo", JSON.stringify(await cliente.probarGemini()) === JSON.stringify({ gemini: "ok", modelo: "gemini-3.8-flash" }));
  const antes = env.GEMINI_API_KEY;
  delete env.GEMINI_API_KEY;
  igual("probarGemini sin clave", await cliente.probarGemini(), { gemini: "sin_clave" });
  igual("salud sin clave", await cliente.salud(), { blobs: true, gemini: "sin_clave" });
  const p = cliente.nuevoPendiente(blobDe(WEBM), { origen: "grabacion" });
  await pendientes.guardar(p);
  const r = await cliente.subirPendiente(p, SIN_ESPERAS);
  ok("sin clave la subida igual queda (error sin_clave) y la copia se borra", r.ok && r.dictado.estado === "error" && r.dictado.error?.codigo === "sin_clave" && (await pendientes.leer(p.id)) === null);
  env.GEMINI_API_KEY = antes;
  const l = await cliente.listarDictados();
  ok("con la clave puesta, la lista dice gemini ok y la regla pide procesar", l.gemini === "ok" && debeReintentar(l.dictados[0], Date.now(), l.gemini));
  const d = await cliente.procesarDictado(p.id);
  await esperar();
  ok("…y queda listo", d?.estado === "subido" && (await cliente.leerDictado(p.id))?.estado === "listo");
  await cliente.descartarBorrador(p.id);
  globalThis.__blobsHook = async (op: string, clave: string) => {
    if (op === "get" && clave === "registro/primera") throw new Error("Blobs caído");
  };
  igual("salud con Blobs caído → {blobs:false}", await cliente.salud(), { blobs: false, gemini: "ok" });
  globalThis.__blobsHook = undefined;
  conectar(`fcli.${equipo.equipoId}.secretoquenoes`, equipo.equipoId);
  let e: unknown;
  await cliente.listarDictados().catch((x) => (e = x));
  ok("con la clave del equipo revocada → AccesoRevocado", e instanceof AccesoRevocado);
  e = undefined;
  await cliente.subirPendiente(cliente.nuevoPendiente(blobDe(WEBM), { origen: "grabacion" }), SIN_ESPERAS).catch((x) => (e = x));
  ok("…también al subir (no se toma como sin conexión)", e instanceof AccesoRevocado);
  e = undefined;
  await cliente.bajarAudio(p.id).catch((x) => (e = x));
  ok("…y al bajar el audio", e instanceof AccesoRevocado);
  conectar(equipo.token, equipo.equipoId);
});


// ---------------------------------------------------------------------------------------------
seccion("Lo automático corre sin la pestaña Recetas (motor.ts; hallazgos 12 y 24)");
// El motor tal como lo enciende el Panel (sin pantalla de Recetas montada), con "online",
// "visibilitychange" y el temporizador en manos de la prueba.
const ventana = new EventTarget();
const documento = Object.assign(new EventTarget(), { visibilityState: "visible" });
let tempo: { fn: () => void; ms: number } | null = null;
let adelanto = 0; // ms que el reloj del motor va adelante del servidor
let recetasApp = new Set<string>();
const motor = crearMotor();
const apagarMotor = motor.encender({
  recetaIds: () => recetasApp,
  ventana,
  documento,
  ahora: () => Date.now() + desfase + adelanto,
  ponerTemporizador: (fn, ms) => (tempo = { fn, ms }),
  quitarTemporizador: () => (tempo = null),
  esperasSubida: [0, 0],
});
const enLista = (id: string) => motor.leer().lista?.dictados.find((d) => d.id === id);
/** Como si se cumpliera el temporizador del motor. */
function cumplir() {
  const t = tempo;
  tempo = null;
  t?.fn();
}
const pidio = (desde: number, metodo: string, ruta: string, busqueda?: string) =>
  pedidos.slice(desde).some((x) => x.metodo === metodo && x.ruta === ruta && (busqueda === undefined || x.busqueda === busqueda));

await caso("subidas que dejó la ventana", async () => {
  await calma();
  ok("al encenderse lee la lista", motor.encendido && motor.leer().lista !== null && !motor.leer().sinConexion);
  // La ventana de dictar guarda la copia y sube; no hay red.
  const p = cliente.nuevoPendiente(blobDe(cabecera("ogg", 300, 41), "audio/ogg"), { origen: "grabacion", segundos: 12 });
  await pendientes.guardar(p);
  await calma();
  ok("el motor ve el audio que guardó la ventana", motor.leer().locales.some((x) => x.id === p.id));
  cortes = 3;
  const r = await cliente.subirPendiente(p, SIN_ESPERAS);
  ok("la ventana no pudo subirlo (sin_conexion)", !r.ok && r.motivo === "sin_conexion", r);
  await calma();
  ok("el motor se enteró y vuelve a mirar en un minuto", tempo?.ms === CADA_LOCALES_MS && motor.leer().subiendo.length === 0, tempo?.ms);
  const antes = pedidos.length;
  ventana.dispatchEvent(new Event("online"));
  await calma();
  ok("al volver internet lo sube solo", pidio(antes, "PUT", `/api/dictados/${p.id}`) && !!enLista(p.id));
  ok("…y la copia del equipo se borró", (await pendientes.leer(p.id)) === null && !motor.leer().locales.some((x) => x.id === p.id));

  // Sin evento «online» (la nube devolvió 5xx o se demoró): lo sube el temporizador, respetando la espera.
  const q = cliente.nuevoPendiente(blobDe(cabecera("ogg", 300, 42), "audio/ogg"), { origen: "grabacion", segundos: 8 });
  await pendientes.guardar(q);
  cortes = 3;
  await cliente.subirPendiente(q, SIN_ESPERAS);
  await calma();
  ok("programado en CADA_LOCALES_MS", tempo?.ms === CADA_LOCALES_MS, tempo?.ms);
  let n = pedidos.length;
  cumplir(); // mira antes de que pase el minuto: no insiste
  await calma();
  ok("antes del minuto mira la lista pero no lo vuelve a subir", !pidio(n, "PUT", `/api/dictados/${q.id}`) && pidio(n, "GET", "/api/dictados"));
  adelanto += CADA_LOCALES_MS;
  n = pedidos.length;
  cumplir();
  await calma();
  ok("pasado el minuto lo sube solo", pidio(n, "PUT", `/api/dictados/${q.id}`) && !!enLista(q.id) && (await pendientes.leer(q.id)) === null);

  // Con la app en segundo plano, el temporizador no hace nada; al volver, mira.
  documento.visibilityState = "hidden";
  n = pedidos.length;
  cumplir();
  await calma();
  ok("escondida no pide nada", pedidos.length === n);
  documento.visibilityState = "visible";
  documento.dispatchEvent(new Event("visibilitychange"));
  await calma();
  ok("al volver a la app mira la lista", pidio(n, "GET", "/api/dictados"));
  for (const id of [p.id, q.id]) await motor.descartar(id);
  ok("motor.descartar manda DELETE ?borrador=1 y lo saca de la lista", pidio(n, "DELETE", `/api/dictados/${q.id}`, "?borrador=1") && !enLista(q.id));
});

await caso("reintentos solos", async () => {
  adelanto = 0;
  dispararActivo = false; // el disparo a la función en segundo plano no llega
  const p = cliente.nuevoPendiente(blobDe(cabecera("ogg", 300, 43), "audio/ogg"), { origen: "grabacion", segundos: 20 });
  await pendientes.guardar(p);
  await cliente.subirPendiente(p, SIN_ESPERAS);
  await calma();
  ok("queda «subido» y el motor mira cada 20 s", (await cliente.leerDictado(p.id))?.estado === "subido" && enLista(p.id)?.estado === "subido" && tempo?.ms === CADA_MS, [enLista(p.id)?.estado, tempo?.ms]);
  dispararActivo = true;
  adelanto = ESPERA_SUBIDO_MS + 1000;
  const n = pedidos.length;
  cumplir();
  await calma();
  ok("pasados 30 s pide «procesar» solo", pidio(n, "POST", `/api/dictados/${p.id}/procesar`));
  await motor.refrescar();
  ok("…y queda listo", enLista(p.id)?.estado === "listo", enLista(p.id)?.estado);
  idListo = p.id;
});

seccion("La limpieza no toma la receta optimista como guardada (hallazgo 9)");
await caso("limpieza", async () => {
  const id = idListo;
  const repo = new RepositorioNube({ token: equipo.token, equipoId: equipo.equipoId, familia: { id: "fcli", nombre: "Familia" } });
  await repo.cargar();
  const enNube = ((await C.leerColeccion("fcli", "recetas")) as { datos: Receta[] } | null)?.datos ?? [];
  const receta: Receta = { id: `rec_${id}`, nombre: "Charquicán", emoji: "🍲", porciones: 4, ingredientes: [], pasos: ["Pica todo."], dictado: { id, fecha: new Date().toISOString() } };
  // «Guardar receta»: la app la muestra al tiro (lib/store.tsx), antes de que el PUT llegue a la nube.
  recetasApp = new Set([`rec_${id}`]);
  let n = pedidos.length;
  await motor.refrescar();
  await calma();
  ok("mientras el guardado va en camino, no marca el dictado como guardado", !pidio(n, "POST", `/api/dictados/${id}/guardado`));
  ok("…y el borrador sigue en la nube", (await cliente.leerDictado(id))?.borrador?.id === `rec_${id}`);
  cortes = 1;
  let e: unknown;
  await repo.guardar("recetas", [...enNube, receta]).catch((x) => (e = x));
  ok("el PUT de recetas falla (sin red)", e instanceof SinConexion);
  ok("…la copia del equipo no tiene la receta", !recetasConfirmadas()?.has(`rec_${id}`));
  n = pedidos.length;
  await motor.refrescar();
  await calma();
  ok("con el guardado fallido tampoco lo marca: el borrador no se pierde", !pidio(n, "POST", `/api/dictados/${id}/guardado`) && !!(await cliente.leerDictado(id)));
  recetasApp = new Set(); // la app deshace la receta que no se guardó
  // Ahora sí se guarda.
  recetasApp = new Set([`rec_${id}`]);
  await repo.guardar("recetas", [...enNube, receta]);
  ok("la copia del equipo tiene la receta después del 200", !!recetasConfirmadas()?.has(`rec_${id}`));
  // Si la nube responde que todavía no la tiene (409 RECETA_NO_GUARDADA): no es error, se reintenta.
  falsa = (metodo, url) =>
    metodo === "POST" && url.pathname === `/api/dictados/${id}/guardado` ? Response.json({ error: "La receta todavía no está guardada en Recetas.", codigo: "RECETA_NO_GUARDADA" }, { status: 409 }) : undefined;
  n = pedidos.length;
  await motor.refrescar();
  await calma();
  falsa = undefined;
  ok("con la receta confirmada lo marca; un 409 RECETA_NO_GUARDADA no lo da por hecho", pidio(n, "POST", `/api/dictados/${id}/guardado`) && !!(await cliente.leerDictado(id)) && !motor.leer().sinConexion);
  n = pedidos.length;
  await motor.refrescar();
  await calma();
  ok("en la vuelta siguiente lo vuelve a intentar y queda guardado", pidio(n, "POST", `/api/dictados/${id}/guardado`) && (await cliente.leerDictado(id)) === null);
  ok("…sale de la lista y lo que se dijo queda con la receta", !enLista(id) && (await cliente.leerTexto(id))?.recetaId === `rec_${id}`);
  await cliente.quitarAudio(id);
});

await caso("apagar", async () => {
  apagarMotor();
  ok("apagado: sin lista ni temporizador", !motor.encendido && motor.leer().lista === null && tempo === null && motor.proxima === null, { encendido: motor.encendido, lista: motor.leer().lista, tempo, proxima: motor.proxima });
  const n = pedidos.length;
  ventana.dispatchEvent(new Event("online"));
  documento.dispatchEvent(new Event("visibilitychange"));
  await motor.refrescar();
  await calma();
  ok("ya no escucha ni pide nada", pedidos.length === n);
});

// ---------------------------------------------------------------------------------------------
seccion("Reglas de useDictados (reglas.ts)");
await caso("reglas", () => {
  const ahora = Date.parse("2026-11-09T18:00:00Z");
  const base: DictadoPublico = { id: "x".repeat(24), estado: "subido", creado: "", actualizado: new Date(ahora - 31_000).toISOString(), equipoId: "e", mime: "audio/webm", bytes: 1, origen: "grabacion", intentos: 0 };
  const err = (codigo: CodigoError, extra: Partial<DictadoPublico> = {}, proximo?: number): DictadoPublico => ({ ...base, estado: "error", error: { codigo, reintentable: true, ...(proximo ? { proximo } : {}) }, ...extra });
  ok("subido hace más de 30 s → pedir", debeReintentar(base, ahora, "ok"));
  ok("subido hace 20 s → no", !debeReintentar({ ...base, actualizado: new Date(ahora - 20_000).toISOString() }, ahora, "ok"));
  ok("subido que no avanza: la segunda vez espera 1 min, la tercera 2", !debeReintentar(base, ahora, "ok", 1) && debeReintentar({ ...base, actualizado: new Date(ahora - 61_000).toISOString() }, ahora, "ok", 1) && !debeReintentar({ ...base, actualizado: new Date(ahora - 61_000).toISOString() }, ahora, "ok", 2));
  ok("…y nunca más de cada 32 min", debeReintentar({ ...base, actualizado: new Date(ahora - 32 * 60_000 - 1).toISOString() }, ahora, "ok", 40));
  ok("procesando y listo → no", !debeReintentar({ ...base, estado: "procesando" }, ahora, "ok") && !debeReintentar({ ...base, estado: "listo" }, ahora, "ok"));
  ok("se_corto → pedir (hasta el tope)", debeReintentar(err("se_corto", { intentos: 1 }), ahora, "ok") && !debeReintentar(err("se_corto", { intentos: MAX_INTENTOS_SOLOS.se_corto }), ahora, "ok"));
  ok("sin_clave: sólo cuando la lista dice gemini ok", !debeReintentar(err("sin_clave"), ahora, "sin_clave") && !debeReintentar(err("solo_ai_gateway"), ahora, null) && debeReintentar(err("solo_ai_gateway"), ahora, "ok"));
  ok("cuota_dia: sólo pasada la hora", !debeReintentar(err("cuota_dia", {}, ahora + 1000), ahora, "ok") && debeReintentar(err("cuota_dia", { intentos: 50 }, ahora - 1), ahora, "ok"));
  ok("ocupado: pasada la hora y hasta el tope", debeReintentar(err("ocupado", { intentos: 2 }, ahora), ahora, "ok") && !debeReintentar(err("ocupado", { intentos: MAX_INTENTOS_SOLOS.ocupado }, ahora - 1), ahora, "ok"));
  ok("incompleta / interno sin hora → no (los pide la familia)", !debeReintentar(err("incompleta"), ahora, "ok") && !debeReintentar(err("interno"), ahora, "ok"));
  ok("los que no son reintentables nunca, aunque traigan hora", (["clave_invalida", "formato", "bloqueado", "audio_perdido", "verificacion"] as CodigoError[]).every((c) => !debeReintentar(err(c, {}, ahora - 1), ahora, "ok")));
  const recetas = new Set([`rec_${"a".repeat(24)}`]);
  igual("yaGuardados: sólo los listos cuya receta está", yaGuardados([{ id: "a".repeat(24), estado: "listo" }, { id: "a".repeat(24), estado: "error" }, { id: "b".repeat(24), estado: "listo" }], recetas), [{ id: "a".repeat(24), estado: "listo" }]);
  const dos = [{ id: "a".repeat(24), estado: "listo" as const }, { id: "b".repeat(24), estado: "listo" as const }];
  const enApp = new Set([`rec_${"a".repeat(24)}`, `rec_${"b".repeat(24)}`]);
  igual("porLimpiar: sólo los que la nube confirmó (no lo optimista)", porLimpiar(dos, enApp, new Set([`rec_${"b".repeat(24)}`])).map((d) => d.id), ["b".repeat(24)]);
  igual("porLimpiar: confirmada en la nube pero ya no en la app → no", porLimpiar(dos, new Set(), new Set(enApp)), []);
  igual("porLimpiar: sin saber qué confirmó la nube (null), lo de la app (decide el servidor)", porLimpiar(dos, enApp, null).length, 2);
  const guardado = (v: string | null, falla = false) => ({ getItem: (k: string) => (falla ? (() => { throw new Error("SecurityError"); })() : k === "calendario-familiar:v1:recetas" ? v : null) });
  igual("recetasConfirmadas lee la copia del equipo", [...(recetasConfirmadas(guardado(JSON.stringify([{ id: "rec_x" }, { id: 3 }, null]))) ?? [])], ["rec_x"]);
  igual("…sin copia: ninguna", recetasConfirmadas(guardado(null))?.size, 0);
  ok("…dañada, bloqueada o sin localStorage: null", recetasConfirmadas(guardado("{no")) === null && recetasConfirmadas(guardado("{}")) === null && recetasConfirmadas(guardado("[]", true)) === null && recetasConfirmadas(null) === null);
  igual("proximaRevision: en camino → cada 20 s", [proximaRevision([{ estado: "subido" }], ahora), proximaRevision([{ estado: "procesando" }], ahora), proximaRevision([], ahora, { subiendo: true })], [CADA_MS, CADA_MS, CADA_MS]);
  igual("proximaRevision: nada → null", proximaRevision([{ estado: "listo" }], ahora), null);
  igual("proximaRevision: un error con hora → a esa hora (+1 s)", proximaRevision([{ estado: "error", error: { codigo: "ocupado", reintentable: true, proximo: ahora + 600_000 } }], ahora), 601_000);
  igual("proximaRevision: hora lejana → a lo más 6 h", proximaRevision([{ estado: "error", error: { codigo: "cuota_dia", reintentable: true, proximo: ahora + 30 * 3600_000 } }], ahora), 6 * 3600_000);
  igual("proximaRevision: audios por subir → cada minuto", proximaRevision([], ahora, { localesPorSubir: true }), CADA_LOCALES_MS);
  ok("subeSolo: sin rechazo sí; rechazado no; lleno sólo con cupo", subeSolo({}, false) && !subeSolo({ rechazo: { mensaje: "", reintentar: false } }, true) && subeSolo({ rechazo: { mensaje: "", reintentar: true } }, true) && !subeSolo({ rechazo: { mensaje: "", reintentar: true } }, false));
  ok("ESPERA_SUBIDO_MS es 30 s", ESPERA_SUBIDO_MS === 30_000);
});

seccion("Nada se filtró");
{
  const todo = JSON.stringify([...(globalThis as O).__blobs.entries()].map(([n, m]: [string, Map<string, O>]) => [n, [...m.entries()].map(([k, v]) => [k, v.bytes.toString("utf8").slice(0, 2000), v.metadata])]));
  ok("la clave de Gemini no está en ningún blob ni metadata", !todo.includes(CLAVE));
  ok("ni en los registros de error", !errores.some((x) => x.includes(CLAVE)), errores.slice(0, 3));
  ok("ninguna respuesta de la API fue 5xx salvo las simuladas", pedidos.filter((x) => x.status >= 500 && x.ruta !== "/api/salud").length === 5, pedidos.filter((x) => x.status >= 500));
}

idb.quitar();
await terminar(() => sim.cerrar());
