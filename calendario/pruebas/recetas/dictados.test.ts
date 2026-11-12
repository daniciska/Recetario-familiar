// "🎙️ Dictar receta" de punta a punta en el servidor: la API síncrona (manejarApi) y la corrida en segundo
// plano (manejarProceso / correrDictado) en el mismo proceso, con Blobs en memoria, el simulador de Gemini
// (mock-gemini.mts) en 127.0.0.1 y un reloj falso (dormir avanza el tiempo sin esperar). Sin red ni clave real.
//   node --experimental-transform-types --no-warnings --import ./pruebas/registrar.mjs pruebas/recetas/dictados.test.ts
import { createHash } from "node:crypto";
import { getStore, reiniciarBlobs } from "@netlify/blobs";
import * as C from "../../servidor/comun.ts";
import {
  PLAZO_CORRIDA_MS,
  almacenAudios,
  cambiarDictado,
  claveAudio,
  claveDictado,
  claveTexto,
  correrDictado,
  leerDictado,
  manejarApi,
  manejarProceso,
  type DepsDictados,
} from "../../servidor/dictados.ts";
import { MAX_PEDIDOS_CORRIDA, reinicioCuota } from "../../servidor/gemini.ts";
import { AVISO_RESCATE } from "../../servidor/receta-ia/normalizar-receta.ts";
import { MAX_AUDIO_SIN_DURACION, MAX_PENDIENTES, RECETA_NO_GUARDADA, esperaOcupadoMs } from "../../lib/dictados/tipos.ts";
import { mensajeError } from "../../lib/dictados/textos.ts";
import { simuladorGemini, type Simulador } from "./mock-gemini.mts";
import { cabecera, conDuracion, conFfmpeg, conFfmpegDesplazados, grabadoChrome } from "./audios.ts";
import { CASOS } from "./casos.ts";
import { caso, info, ok, seccion, terminar } from "./arnes.ts";

type O = Record<string, any>;
// Clave falsa con forma de clave de Google, armada en partes (que `grep -rn` de claves no marque el archivo).
const CLAVE = `${"AI" + "za"}SyPRUEBA-dictados-no-es-real_012345`;
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

// ---------- Mini Netlify en el mismo proceso ----------
const errores: string[] = [];
const errorOriginal = console.error;
console.error = (...a: unknown[]) => void errores.push(a.map(String).join(" "));

const sim = await simuladorGemini({ clave: CLAVE });
const simMp4 = await simuladorGemini({ clave: CLAVE, mimesExtra: ["audio/mp4"] });
const simSinRF = await simuladorGemini({ clave: CLAVE, sinResponseFormat: true });
let desfase = 0;
const dormidas: number[] = [];
const reloj = {
  ahora: () => Date.now() + desfase,
  dormir: async (ms: number) => {
    dormidas.push(ms);
    desfase += ms;
    await new Promise((r) => setImmediate(r));
  },
};
const env: Record<string, string | undefined> = {};
function ponerEnv(extra: Record<string, string | undefined> = {}, s: Simulador = sim) {
  for (const k of Object.keys(env)) delete env[k];
  Object.assign(env, { GEMINI_API_KEY: CLAVE, GEMINI_API_URL: s.url, URL: "http://sitio.test" }, extra);
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
}
ponerEnv();
const registros: string[] = [];
const corridas: Promise<unknown>[] = [];
const disparos: string[] = [];
let dispararActivo = true;
const deps: DepsDictados = {
  reloj,
  env,
  log: (l) => void registros.push(l),
  disparar: async (base, auth, id) => {
    disparos.push(id);
    if (!dispararActivo) return false;
    // Lo mismo que Netlify: un POST a la función en segundo plano con el mismo Bearer (y 202 al tiro).
    const req = new Request(`${base}/api/dictados-proceso`, { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify({ id }) });
    corridas.push(proceso(req));
    return true;
  },
};
const api = manejarApi(deps);
const proceso = manejarProceso(deps);
async function esperar() {
  while (corridas.length) await corridas.shift();
}

const respuestas: { status: number; texto: string; ruta: string }[] = [];
let esperados401 = 0;
async function pedir(metodo: string, ruta: string, o: { token?: string; cuerpo?: Uint8Array | O; tokenCrudo?: string } = {}) {
  const binario = o.cuerpo instanceof Uint8Array;
  const cabeceras: Record<string, string> = {};
  if (o.token) cabeceras.authorization = `Bearer ${o.token}`;
  if (o.tokenCrudo !== undefined) cabeceras.authorization = o.tokenCrudo;
  if (o.cuerpo !== undefined) cabeceras["content-type"] = binario ? "application/octet-stream" : "application/json";
  const req = new Request(`http://sitio.test${ruta}`, {
    method: metodo,
    headers: cabeceras,
    body: o.cuerpo === undefined ? undefined : binario ? (o.cuerpo as Uint8Array) : JSON.stringify(o.cuerpo),
  });
  const r = await api(req);
  const crudo = new Uint8Array(await r.arrayBuffer());
  const texto = Buffer.from(crudo).toString("utf8");
  respuestas.push({ status: r.status, texto, ruta });
  const esJson = (r.headers.get("content-type") ?? "").includes("json");
  return { status: r.status, datos: (esJson ? JSON.parse(texto) : crudo) as any, headers: r.headers };
}

const ALF = "abcdefghijkmnopqrstuvwxyz23456789";
const nuevoId = () => Array.from({ length: 24 }, () => ALF[Math.floor(Math.random() * ALF.length)]).join("");
async function subir(token: string, bytes: Uint8Array, q: Record<string, string | number> = {}, id = nuevoId()) {
  const qs = new URLSearchParams(Object.entries({ segundos: 95, ...q }).map(([k, v]) => [k, String(v)])).toString();
  const r = await pedir("PUT", `/api/dictados/${id}?${qs}`, { token, cuerpo: bytes });
  return { id, ...r };
}
const detalle = async (token: string, id: string) => (await pedir("GET", `/api/dictados/${id}`, { token })).datos.dictado as O | undefined;
async function limpiar(token: string) {
  const l = await pedir("GET", "/api/dictados", { token });
  for (const d of l.datos.dictados ?? []) await pedir("DELETE", `/api/dictados/${d.id}`, { token });
}
/** La colección «recetas» de la familia (lo que hace el PUT /api/datos/recetas del equipo al guardar). */
const ponerRecetas = (f: string, recetas: O[]) => C.reemplazarColeccion(f, "recetas", recetas);
const existe = async (clave: string) => !!(await almacenAudios().getMetadata(clave));
/** Sube, deja correr a Gemini y devuelve el detalle. */
async function dictarYEsperar(token: string, bytes: Uint8Array, q: Record<string, string | number> = {}) {
  const s = await subir(token, bytes, q);
  await esperar();
  return { id: s.id, put: s, d: await detalle(token, s.id) };
}
function antes(s: Simulador = sim, extra: Record<string, string | undefined> = {}) {
  sim.reiniciar();
  simMp4.reiniciar();
  simSinRF.reiniciar();
  ponerEnv(extra, s);
  dispararActivo = true;
  dormidas.length = 0;
}

// ---------- Familias de prueba ----------
reiniciarBlobs();
for (const f of ["fam1", "fam2", "fam3"]) await C.almacen().setJSON(`acceso/${f}`, { familia: { id: f, nombre: `Prueba ${f}` }, equipos: {}, versiones: {} });
const { token } = await C.nuevoEquipo("fam1", "iPhone de la abuela");
const { token: tokenPared } = await C.nuevoEquipo("fam1", "Pared");
const { token: tokenOtra } = await C.nuevoEquipo("fam2", "Otra familia");
const { token: token3 } = await C.nuevoEquipo("fam3", "Tablet");
const WEBM = grabadoChrome();

seccion("D1 Autenticación y aislamiento");
await caso("D1", async () => {
  antes();
  let r = await pedir("PUT", `/api/dictados/${nuevoId()}`, { cuerpo: WEBM });
  esperados401++;
  ok("D1 PUT sin token → 401", r.status === 401, r.status);
  r = await pedir("GET", "/api/dictados", { tokenCrudo: "Bearer fam1.equipo.secreto-falso" });
  esperados401++;
  ok("D1 token falso → 401", r.status === 401, r.status);
  const s = await subir(token, WEBM);
  await esperar();
  r = await pedir("GET", `/api/dictados/${s.id}`, { token: tokenOtra });
  ok("D1 la otra familia no lo ve (GET → 410)", r.status === 410 && r.datos.existe === false, r);
  r = await pedir("GET", `/api/dictados/${s.id}/audio`, { token: tokenOtra });
  ok("D1 la otra familia no baja el audio (410)", r.status === 410, r.status);
  r = await pedir("GET", `/api/dictados/${s.id}/texto`, { token: tokenOtra });
  ok("D1 ni lo que se dijo (410)", r.status === 410, r.status);
  r = await pedir("DELETE", `/api/dictados/${s.id}`, { token: tokenOtra });
  ok("D1 DELETE de la otra familia no borra nada", r.status === 200 && (await pedir("GET", `/api/dictados/${s.id}`, { token })).status === 200);
  r = await pedir("GET", "/api/dictados", { token: tokenOtra });
  ok("D1 la lista de la otra familia está vacía", r.status === 200 && r.datos.dictados.length === 0, r.datos);
  ok("D1 otro equipo de la misma familia sí lo ve", (await pedir("GET", `/api/dictados/${s.id}`, { token: tokenPared })).status === 200);
  await limpiar(token);
});

seccion("D2 Validación del PUT");
await caso("D2", async () => {
  antes();
  dispararActivo = false; // el de 4.000.000 bytes sí es válido: que no vaya a Gemini
  let r = await pedir("PUT", "/api/dictados/MAL-id", { token, cuerpo: WEBM });
  ok("D2 id malo → 400", r.status === 400 && r.datos.error === "Pedido inválido", r);
  r = await pedir("PUT", `/api/dictados/${"l".repeat(24)}`, { token, cuerpo: WEBM });
  ok("D2 id con «l» (fuera del alfabeto) → 400", r.status === 400);
  r = await pedir("PUT", `/api/dictados/${nuevoId()}`, { token, cuerpo: new Uint8Array(0) });
  ok("D2 cuerpo vacío → 400", r.status === 400 && r.datos.error === "Llegó un audio vacío", r);
  r = await subir(token, cabecera("ogg", 4_000_001));
  ok("D2 4.000.001 bytes → 413", r.status === 413 && /máximo son 4 MB/.test(r.datos.error), r.datos);
  r = await subir(token, cabecera("ogg", 4_000_000), { segundos: 60 });
  ok("D2 4.000.000 bytes → 201", r.status === 201, r.status);
  await pedir("DELETE", `/api/dictados/${r.id}`, { token });
  r = await subir(token, WEBM, { segundos: 901 });
  ok("D2 segundos=901 → 413", r.status === 413 && /más de 15 minutos/.test(r.datos.error), r.datos);
  r = await subir(token, cabecera("caf"));
  ok("D2 CAF → 415 con su texto", r.status === 415 && r.datos.error === "Ese formato (CAF del iPhone) no sirve. Compártelo como m4a desde la app Notas de Voz.", r.datos);
  r = await subir(token, cabecera("jpeg"));
  ok("D2 JPEG → 415", r.status === 415 && r.datos.error === "Ese archivo no es un audio.", r.datos);
  r = await subir(token, cabecera("texto"));
  ok("D2 texto → 415 «No reconozco…»", r.status === 415 && /No reconozco/.test(r.datos.error));
  r = await pedir("POST", `/api/dictados/${nuevoId()}`, { token, cuerpo: {} });
  ok("D2 método no permitido → 405", r.status === 405);
  r = await pedir("GET", `/api/dictados/${nuevoId()}/otra/cosa`, { token });
  ok("D2 ruta de más → 400", r.status === 400);
  await esperar();
  ok("D2 sólo el audio válido se disparó; nada llegó a Gemini", sim.generar().length === 0, sim.generar().length);
  await limpiar(token);
});

seccion("D3 Subida idempotente");
await caso("D3", async () => {
  antes();
  dispararActivo = false;
  const n0 = disparos.length;
  const s = await subir(token, WEBM, { archivo: "", origen: "grabacion" });
  ok("D3 webm → 201 subido", s.status === 201 && s.datos.dictado.estado === "subido" && s.datos.dictado.mime === "audio/webm", s.datos);
  ok("D3 se disparó la corrida una vez", disparos.length === n0 + 1);
  const a = await almacenAudios().getWithMetadata(claveAudio("fam1", s.id), { type: "arrayBuffer" });
  ok("D3 el audio quedó en «audios» con sus bytes", !!a && sha(new Uint8Array(a.data as ArrayBuffer)) === sha(WEBM));
  const m = (a?.metadata ?? {}) as O;
  ok("D3 metadata {mime, mimeReproducir, sha256, segundos, equipo, subido}", m.mime === "audio/webm" && m.mimeReproducir === "audio/webm" && m.sha256 === sha(WEBM) && m.segundos === 95 && !!m.equipo && !!m.subido, m);
  const reg = await getStore({ name: "calendario" }).get(claveDictado("fam1", s.id), { type: "json" });
  ok("D3 el registro quedó en «calendario» con sha256 y familia", reg?.sha256 === sha(WEBM) && reg?.familiaId === "fam1" && reg?.origen === "grabacion", reg);
  ok("D3 la respuesta no trae sha256, familiaId ni turno", !/sha256|familiaId|turno|plazo/.test(JSON.stringify(s.datos)));
  const otra = await subir(token, WEBM, {}, s.id);
  ok("D3 el mismo PUT otra vez → 200, sin otro disparo", otra.status === 200 && otra.datos.dictado.id === s.id && disparos.length === n0 + 1, otra.status);
  const distinto = await subir(token, cabecera("webm", 5000), {}, s.id);
  ok("D3 mismo id con otro audio → 409", distinto.status === 409 && /ya se usó/.test(distinto.datos.error), distinto.datos);
  await limpiar(token);
});

seccion("D4 Tope de pendientes");
await caso("D4", async () => {
  antes();
  dispararActivo = false;
  for (let i = 0; i < MAX_PENDIENTES; i++) {
    const r = await subir(token3, cabecera("ogg", 200, i + 1));
    if (r.status !== 201) ok(`D4 subida ${i + 1}`, false, r);
  }
  const r = await subir(token3, cabecera("ogg", 200, 99));
  ok("D4 el pendiente número 21 → 409", r.status === 409 && r.datos.error === "Hay 20 recetas dictadas sin revisar. Revisa o descarta algunas en Recetas → 🎙️ Dictadas.", r.datos);
  ok("D4 y su audio no se guardó", (await getStore({ name: "audios" }).list({ prefix: "fam3/" })).blobs.length === MAX_PENDIENTES);
  await limpiar(token3);
});

seccion("D5 Camino feliz con 3.8 Flash");
await caso("D5", async () => {
  antes();
  // El pebre (caso 05) con el merkén en una categoría que no existe: manda el diccionario de la app.
  const pebre = structuredClone(CASOS[4].esperado) as O;
  pebre.ingredientes.find((i: O) => /merk/i.test(i.nombre)).categoria = "Especias";
  sim.responder(pebre);
  sim.guion("*", [{ lento: 250 }]);
  const s = await subir(token, WEBM);
  await new Promise((r) => setTimeout(r, 80));
  const durante = await detalle(token, s.id);
  ok("D5 pasa por «procesando»", durante?.estado === "procesando", durante?.estado);
  await esperar();
  const d = (await detalle(token, s.id))!;
  ok("D5 queda listo", d.estado === "listo" && !d.error, d.estado);
  ok("D5 borrador.id = rec_<id> con su enlace al dictado", d.borrador?.id === `rec_${s.id}` && d.borrador.dictado?.id === s.id && d.borrador.dictado.segundos === 95, d.borrador?.dictado);
  const ings = d.borrador.ingredientes as O[];
  ok("D5 hay comoLoDijo, estimado y nota", ings.some((i) => i.comoLoDijo) && ings.some((i) => i.estimado === true) && ings.some((i) => i.nota), ings);
  const merken = ings.find((i) => /merk/i.test(i.nombre));
  ok("D5 Merkén cae en «Condimentos y especias»", merken?.categoria === "Condimentos y especias", merken);
  ok("D5 trae dudas, transcripción y modelo", (d.borrador.dudas?.length ?? 0) > 0 && d.transcripcion === pebre.transcripcion && d.modelo === "gemini-3.8-flash", { dudas: d.borrador.dudas, modelo: d.modelo });
  ok("D5 nombre y emoji en la vista", d.nombre === "Pebre" && !!d.emoji, [d.nombre, d.emoji]);
  ok("D5 intentos = 1 y ms medido", d.intentos === 1 && typeof d.ms === "number" && d.ms >= 200, [d.intentos, d.ms]);
  const p = sim.generar();
  ok("D5 un solo pedido", p.length === 1, p.length);
  const x = p[0];
  ok("D5 la clave fue en la cabecera y no en la URL", x.claveOk && !x.claveEnUrl);
  ok("D5 mime audio/webm y SHA-256 igual al subido", x.mime === "audio/webm" && x.sha256Audio === sha(WEBM));
  ok("D5 responseFormat.text con el esquema exacto", x.forma === "responseFormat" && x.esquemaExacto === true);
  ok("D5 la instrucción de sistema exacta", x.instruccionExacta === true);
  ok("D5 thinkingLevel low, sin temperature, texto al final", x.thinkingLevel === "low" && x.temperature === undefined && x.ultimoTextoNoVacio === true);
  ok("D5 el contexto lleva la fecha del dictado", /Fecha: \d{1,2} de [a-z]+ de 20\d\d\./.test(x.contexto ?? ""), x.contexto);
  ok("D5 el simulador no anotó faltas", sim.faltas.length === 0, sim.faltas);
  const l = await pedir("GET", "/api/dictados", { token });
  const fila = l.datos.dictados.find((y: O) => y.id === s.id);
  ok("D5 en la lista: listo, con nombre, sin borrador ni transcripción", fila?.estado === "listo" && fila.nombre === "Pebre" && !("borrador" in fila) && !("transcripcion" in fila), fila);
  await limpiar(token);
});

seccion("D6 m4a y su MIME alterno");
await caso("D6", async () => {
  antes();
  let r = await dictarYEsperar(token, cabecera("m4a", 3000));
  ok("D6 m4a se manda como audio/m4a y queda listo", r.d?.estado === "listo" && sim.generar()[0]?.mime === "audio/m4a", sim.generar().map((p) => p.mime));
  antes(simMp4);
  simMp4.guion("*", ["rechaza_mime"]);
  r = await dictarYEsperar(token, cabecera("m4a", 3000, 2));
  ok("D6 rechaza audio/m4a → reintenta con audio/mp4 y queda listo", r.d?.estado === "listo" && JSON.stringify(simMp4.generar().map((p) => p.mime)) === '["audio/m4a","audio/mp4"]', simMp4.generar().map((p) => [p.mime, p.status]));
  antes(simMp4);
  simMp4.guion("*", ["rechaza_mime", "rechaza_mime"]);
  r = await dictarYEsperar(token, cabecera("m4a", 3000, 3));
  ok("D6 si rechaza los dos → error formato, no reintentable", r.d?.estado === "error" && r.d.error.codigo === "formato" && r.d.error.reintentable === false, r.d?.error);
  ok("D6 … en 2 pedidos", simMp4.generar().length === 2, simMp4.generar().length);
  await limpiar(token);
});

seccion("D7 Nota de voz de WhatsApp");
await caso("D7", async () => {
  antes();
  const real = conFfmpeg()?.find((a) => a.nombre.endsWith(".opus"));
  if (!real) info("sin ffmpeg: se usa una cabecera Ogg");
  const bytes = real?.bytes ?? cabecera("ogg", 4000);
  const r = await dictarYEsperar(token, bytes, { archivo: "PTT-20261109-WA0001.opus", origen: "archivo", segundos: 4 });
  const p = sim.generar()[0];
  ok("D7 .opus va como audio/ogg y queda listo", r.d?.estado === "listo" && p?.mime === "audio/ogg", p?.mime);
  ok("D7 el contexto lleva el nombre del archivo", (p?.contexto ?? "").includes("PTT-20261109-WA0001.opus"), p?.contexto);
  ok("D7 archivo y origen en la vista", r.d?.archivo === "PTT-20261109-WA0001.opus" && r.d.origen === "archivo");
  ok("D7 se escucha como audio/ogg", (await pedir("GET", `/api/dictados/${r.id}/audio`, { token })).headers.get("content-type") === "audio/ogg");
  await limpiar(token);
});

seccion("D8 Respaldo de la salida estructurada");
await caso("D8", async () => {
  antes(simSinRF);
  const r = await dictarYEsperar(token, WEBM);
  const p = simSinRF.generar();
  ok("D8 sin responseFormat → responseJsonSchema y listo en 2 pedidos", r.d?.estado === "listo" && p.length === 2 && p[0].status === 400 && p[1].forma === "responseJsonSchema", p.map((x) => [x.forma, x.status]));
  ok("D8 el esquema del respaldo es el exacto", p[1]?.esquemaExacto === true);
  await limpiar(token);
});

seccion("D9–D13 Cuotas y Gemini ocupado");
await caso("D9", async () => {
  antes();
  sim.guion("*", ["429min", "429min"]);
  const r = await dictarYEsperar(token, WEBM);
  ok("D9 429 por minuto en 3.8 y 3.6 → listo con 3.5 Flash-Lite en 3 pedidos (el cupo por minuto es de cada modelo)", r.d?.estado === "listo" && r.d.modelo === "gemini-3.5-flash-lite" && sim.generar().length === 3, [r.d?.estado, r.d?.modelo, sim.generar().length]);
  ok("D9 … sin esperar", dormidas.length === 0, dormidas);
  antes();
  sim.guion("*", ["429min", "429min", "429min", "429min"]);
  const t0 = reloj.ahora();
  const r2 = await dictarYEsperar(token, cabecera("webm", 3000, 30));
  ok("D9 429 por minuto en los 4 → otra vuelta y listo con 3.8 en 5 pedidos", r2.d?.estado === "listo" && r2.d.modelo === "gemini-3.8-flash" && sim.generar().length === 5, [r2.d?.estado, r2.d?.modelo, sim.generar().length]);
  ok("D9 … después de lo que dijo Google (2 s mínimo, +20 %), una sola espera", reloj.ahora() - t0 >= 2_000 && dormidas.length === 1 && dormidas[0] >= 1_900 && dormidas[0] <= 2_400, dormidas);
  await limpiar(token);
});
await caso("D10", async () => {
  antes();
  sim.guion("gemini-3.8-flash", ["429dia"]);
  const r = await dictarYEsperar(token, WEBM);
  ok("D10 cuota del día en 3.8 → listo con 3.6 Flash", r.d?.estado === "listo" && r.d.modelo === "gemini-3.6-flash", r.d?.modelo);
  ok("D10 sin esperar y en 2 pedidos", dormidas.length === 0 && sim.generar().length === 2, [dormidas, sim.generar().length]);
  await limpiar(token);
});
await caso("D11", async () => {
  antes();
  sim.guion("*", ["429dia", "429dia", "429dia", "429dia"]);
  const r = await dictarYEsperar(token, WEBM);
  const e = r.d?.error;
  ok("D11 cuota del día en los cuatro → error cuota_dia reintentable", r.d?.estado === "error" && e?.codigo === "cuota_dia" && e.reintentable === true, e);
  ok("D11 proximo = medianoche del Pacífico + 5 min", e?.proximo === reinicioCuota(reloj.ahora()), [e?.proximo, reinicioCuota(reloj.ahora())]);
  ok("D11 en 4 pedidos, sin esperar", sim.generar().length === 4 && dormidas.length === 0);
  await limpiar(token);
});
await caso("D12", async () => {
  antes();
  sim.guion("*", Array.from({ length: 20 }, () => "503" as const));
  const r = await dictarYEsperar(token, WEBM);
  const e = r.d?.error;
  ok("D12 503 en todo → 12 pedidos (3 vueltas por los 4 modelos)", sim.generar().length === 12 && MAX_PEDIDOS_CORRIDA === 12, sim.generar().length);
  const cerca = (ms: number, x: number) => ms >= x * 0.8 && ms <= x * 1.2;
  ok("D12 esperas de ≈ 10 s y ≈ 30 s entre vueltas (±20 %)", dormidas.length === 2 && cerca(dormidas[0], 10_000) && cerca(dormidas[1], 30_000), dormidas);
  ok("D12 error ocupado reintentable con proximo ≈ +3 min (primera corrida)", e?.codigo === "ocupado" && e.reintentable && Math.abs(e.proximo - (reloj.ahora() + 180_000)) < 5_000, e);
  await limpiar(token);
});
await caso("D13", async () => {
  antes();
  sim.guion("*", ["500"]);
  const r = await dictarYEsperar(token, WEBM);
  ok("D13 un 500 y después ok → listo en 2 pedidos", r.d?.estado === "listo" && sim.generar().length === 2, [r.d?.estado, sim.generar().length]);
  await limpiar(token);
});

seccion("D14–D16 Problemas de la clave, la cuenta y los modelos");
await caso("D14", async () => {
  antes();
  sim.guion("*", ["clave"]);
  const r = await dictarYEsperar(token, WEBM);
  ok("D14 clave mala → error clave_invalida (no reintentable) en 1 pedido", r.d?.error?.codigo === "clave_invalida" && r.d.error.reintentable === false && sim.generar().length === 1, r.d?.error);
  await limpiar(token);
});
await caso("D15", async () => {
  for (const [accion, codigo] of [
    ["verificacion", "verificacion"],
    ["region", "region"],
    ["402", "sin_saldo"],
  ] as const) {
    antes();
    sim.guion("*", [accion]);
    const r = await dictarYEsperar(token, WEBM);
    ok(`D15 ${accion} → error ${codigo} en 1 pedido`, r.d?.error?.codigo === codigo && r.d.error.reintentable === false && sim.generar().length === 1, r.d?.error);
  }
  await limpiar(token);
});
await caso("D16", async () => {
  antes(sim, { GEMINI_MODELOS: "gemini-9-nada,gemini-3.8-flash" });
  const r = await dictarYEsperar(token, WEBM);
  ok("D16 el 404 pasa al siguiente modelo y queda listo", r.d?.estado === "listo" && r.d.modelo === "gemini-3.8-flash" && sim.generar().length === 2 && sim.generar()[0].status === 404, sim.generar().map((p) => [p.modelo, p.status]));
  antes(sim, { GEMINI_MODELOS: "gemini-9-nada" });
  const r2 = await dictarYEsperar(token, cabecera("webm", 900, 4));
  ok("D16 si ningún modelo existe → error interno", r2.d?.error?.codigo === "interno" && r2.d.error.reintentable === true, r2.d?.error);
  await limpiar(token);
});

seccion("D17–D21 Respuestas raras de Gemini");
await caso("D17", async () => {
  antes();
  sim.guion("*", ["max_tokens"]);
  let r = await dictarYEsperar(token, WEBM);
  ok("D17 MAX_TOKENS → reintento con 32.768 y listo", r.d?.estado === "listo" && JSON.stringify(sim.generar().map((p) => p.maxTokens)) === "[16384,32768]" && r.d.borrador.nombre === CASOS[0].esperado.nombre, sim.generar().map((p) => p.maxTokens));
  antes();
  sim.guion("*", ["max_tokens", "max_tokens"]);
  r = await dictarYEsperar(token, cabecera("webm", 3000, 5));
  ok("D17 dos MAX_TOKENS → listo con rescate", r.d?.estado === "listo" && r.d.borrador.nombre === "Receta dictada" && r.d.borrador.ingredientes.length === 0, r.d?.borrador);
  ok("D17 … con el aviso y la transcripción rescatada", r.d?.avisos?.includes(AVISO_RESCATE) && CASOS[0].esperado.transcripcion.startsWith(r.d.transcripcion.replace(/ \[…\]$/, "")) && r.d.transcripcion.length > 100, r.d?.avisos);
  await limpiar(token);
});
await caso("D18", async () => {
  antes();
  sim.guion("*", ["json_malo", "json_malo"]);
  let r = await dictarYEsperar(token, WEBM);
  ok("D18 JSON dañado dos veces → rescate con la transcripción entera", r.d?.estado === "listo" && r.d.transcripcion === CASOS[0].esperado.transcripcion && r.d.avisos.includes(AVISO_RESCATE), r.d?.avisos);
  ok("D18 … en 2 pedidos", sim.generar().length === 2);
  antes();
  sim.guion("*", ["texto_basura", "texto_basura"]);
  r = await dictarYEsperar(token, cabecera("webm", 3000, 6));
  ok("D18 sin nada que rescatar → error incompleta reintentable", r.d?.error?.codigo === "incompleta" && r.d.error.reintentable === true, r.d?.error);
  await limpiar(token);
});
await caso("D19", async () => {
  for (const accion of ["safety", "bloqueo_prompt"] as const) {
    antes();
    sim.guion("*", [accion]);
    const r = await dictarYEsperar(token, WEBM);
    ok(`D19 ${accion} → error bloqueado en 1 pedido`, r.d?.error?.codigo === "bloqueado" && sim.generar().length === 1, r.d?.error);
  }
  await limpiar(token);
});
await caso("D20", async () => {
  antes();
  sim.guion("*", ["no_receta"]);
  const r = await dictarYEsperar(token, WEBM);
  ok("D20 no es receta → listo con esReceta false y su motivo", r.d?.estado === "listo" && r.d.esReceta === false && !!r.d.motivo && !!r.d.transcripcion, [r.d?.esReceta, r.d?.motivo]);
  await limpiar(token);
});
await caso("D21", async () => {
  antes();
  sim.guion("*", ["con_thought"]);
  const r = await dictarYEsperar(token, WEBM);
  ok("D21 las partes de pensamiento se ignoran", r.d?.estado === "listo" && r.d.borrador.nombre === CASOS[0].esperado.nombre && !/Primero transcribo/.test(JSON.stringify(r.d)), r.d?.borrador?.nombre);
  await limpiar(token);
});

seccion("D22–D23 Sin clave y AI Gateway");
await caso("D22", async () => {
  antes(sim, { GEMINI_API_KEY: undefined });
  const n0 = disparos.length;
  const s = await subir(token, WEBM);
  ok("D22 sin clave: PUT → 201 con error sin_clave reintentable", s.status === 201 && s.datos.dictado.estado === "error" && s.datos.dictado.error.codigo === "sin_clave" && s.datos.dictado.error.reintentable, s.datos);
  await esperar();
  ok("D22 … sin disparo ni pedidos", disparos.length === n0 && sim.generar().length === 0);
  let r = await pedir("POST", `/api/dictados/${s.id}/procesar`, { token, cuerpo: {} });
  ok("D22 procesar sin clave → 200 con sin_clave", r.status === 200 && r.datos.dictado.error?.codigo === "sin_clave", r);
  const l = await pedir("GET", "/api/dictados", { token });
  ok("D22 la lista dice gemini sin_clave", l.datos.gemini === "sin_clave");
  ponerEnv();
  r = await pedir("POST", `/api/dictados/${s.id}/procesar`, { token, cuerpo: {} });
  ok("D22 con la clave puesta, procesar → 202", r.status === 202 && r.datos.dictado.estado === "subido", r);
  await esperar();
  const d = await detalle(token, s.id);
  ok("D22 … y queda listo", d?.estado === "listo" && !d.error, d?.estado);
  await limpiar(token);
});
await caso("D23", async () => {
  antes(sim, { GOOGLE_GEMINI_BASE_URL: "https://gateway.example/gemini" });
  const s = await subir(token, WEBM);
  await esperar();
  ok("D23 con GOOGLE_GEMINI_BASE_URL → error solo_ai_gateway y 0 pedidos", s.datos.dictado.error?.codigo === "solo_ai_gateway" && sim.generar().length === 0, s.datos.dictado);
  const l = await pedir("GET", "/api/dictados", { token });
  ok("D23 la lista dice gemini solo_ai_gateway", l.datos.gemini === "solo_ai_gateway");
  await limpiar(token);
});

seccion("D24–D28 La cerca: turnos, plazos y descartes");
await caso("D24", async () => {
  antes();
  dispararActivo = false;
  const s = await subir(token, WEBM);
  const rs = await Promise.all([correrDictado("fam1", s.id, deps), correrDictado("fam1", s.id, deps), correrDictado("fam1", s.id, deps)]);
  ok("D24 tres disparos a la vez → 1 solo pedido", sim.generar().length === 1, sim.generar().length);
  ok("D24 una corrida queda lista y las otras no hacen nada", rs.filter((x) => x === "listo").length === 1 && rs.filter((x) => x === "perdio" || x === "nada").length === 2, rs);
  ok("D24 intentos = 1", (await detalle(token, s.id))?.intentos === 1);
  await limpiar(token);
});
await caso("D25", async () => {
  antes();
  dispararActivo = false;
  const s = await subir(token, WEBM);
  await cambiarDictado("fam1", s.id, (d) => d && { ...d, estado: "procesando", turno: "corrida-vieja", plazo: reloj.ahora() - 1, intentos: 1 });
  let d = await detalle(token, s.id);
  ok("D25 procesando con plazo vencido se ve como se_corto", d?.estado === "error" && d.error?.codigo === "se_corto" && d.error.reintentable, d);
  ok("D25 … sin escribir nada", (await leerDictado("fam1", s.id))?.d.estado === "procesando");
  ok("D25 la corrida vieja no puede volver a tomarlo si no venció", (await correrDictado("fam1", nuevoId(), deps)) === "nada");
  dispararActivo = true;
  const r = await pedir("POST", `/api/dictados/${s.id}/procesar`, { token, cuerpo: {} });
  ok("D25 procesar → 202", r.status === 202, r.status);
  await esperar();
  d = await detalle(token, s.id);
  ok("D25 … queda listo con intentos = 2", d?.estado === "listo" && d.intentos === 2, [d?.estado, d?.intentos]);
  await limpiar(token);
});
await caso("D26", async () => {
  antes();
  sim.guion("*", [{ lento: 300 }]);
  const s = await subir(token, WEBM);
  await new Promise((r) => setTimeout(r, 80));
  const r = await pedir("DELETE", `/api/dictados/${s.id}`, { token });
  ok("D26 descartar mientras Gemini escucha → 200", r.status === 200);
  await esperar();
  ok("D26 el dictado no resucita (GET → 410)", (await pedir("GET", `/api/dictados/${s.id}`, { token })).status === 410);
  ok("D26 la corrida terminó como «descartado»", registros.some((l) => l === `dictado ${s.id}: descartado`), registros.slice(-3));
  ok("D26 no quedó ni el audio ni el texto", !(await almacenAudios().getMetadata(claveAudio("fam1", s.id))) && !(await almacenAudios().getMetadata(claveTexto("fam1", s.id))));
});
await caso("D27", async () => {
  antes();
  dispararActivo = false;
  sim.guion("*", [{ lento: 300 }]);
  const s = await subir(token, WEBM);
  const corrida = correrDictado("fam1", s.id, deps);
  await new Promise((r) => setTimeout(r, 80));
  // Otra corrida (p. ej. después de vencer el plazo) se quedó con el dictado.
  await cambiarDictado("fam1", s.id, (d) => d && { ...d, turno: "turno-ajeno", plazo: reloj.ahora() + PLAZO_CORRIDA_MS });
  const res = await corrida;
  const d = (await leerDictado("fam1", s.id))?.d;
  ok("D27 una corrida con turno ajeno no pisa", res === "perdio" && d?.estado === "procesando" && d.turno === "turno-ajeno" && !d.borrador, [res, d?.estado, d?.turno]);
  await limpiar(token);
});
await caso("D28", async () => {
  antes();
  const r0 = await dictarYEsperar(token, WEBM);
  const n0 = disparos.length;
  let r = await pedir("POST", `/api/dictados/${r0.id}/procesar`, { token, cuerpo: {} });
  ok("D28 procesar en listo → 200 sin disparar", r.status === 200 && r.datos.dictado.estado === "listo" && disparos.length === n0, r.status);
  const antesIds = r0.d!.borrador.ingredientes.map((i: O) => i.id).join();
  r = await pedir("POST", `/api/dictados/${r0.id}/procesar`, { token, cuerpo: { otraVez: true } });
  ok("D28 con otraVez → 202 y sin el borrador anterior", r.status === 202 && r.datos.dictado.estado === "subido" && !r.datos.dictado.borrador && !r.datos.dictado.transcripcion, r.datos.dictado);
  await esperar();
  const d = await detalle(token, r0.id);
  ok("D28 … trae un borrador nuevo", d?.estado === "listo" && d.borrador.ingredientes.map((i: O) => i.id).join() !== antesIds && d.intentos === 2, d?.intentos);
  antes(sim, { GEMINI_API_KEY: undefined });
  r = await pedir("POST", `/api/dictados/${r0.id}/procesar`, { token, cuerpo: { otraVez: true } });
  ok("D28 otra versión sin clave: avisa sin perder el borrador", r.status === 200 && r.datos.dictado.error?.codigo === "sin_clave" && (await detalle(token, r0.id))?.estado === "listo", r.datos.dictado.error);
  await limpiar(token);
});

seccion("D29–D30 Guardar y descartar");
await caso("D29", async () => {
  antes();
  dispararActivo = false;
  const pendiente = await subir(token, cabecera("webm", 900, 8));
  let r = await pedir("POST", `/api/dictados/${pendiente.id}/guardado`, { token, cuerpo: { recetaId: `rec_${pendiente.id}` } });
  ok("D29 guardado antes de estar listo → 409", r.status === 409 && r.datos.error === "Todavía no está listo", r);
  dispararActivo = true;
  const { id, d } = await dictarYEsperar(token, WEBM);
  r = await pedir("POST", `/api/dictados/${id}/guardado`, { token, cuerpo: { recetaId: "../malo" } });
  ok("D29 recetaId inválido → 400", r.status === 400);
  await ponerRecetas("fam1", [d!.borrador]); // el equipo guardó la receta en la colección
  r = await pedir("POST", `/api/dictados/${id}/guardado`, { token, cuerpo: { recetaId: d!.borrador.id } });
  ok("D29 guardado → 200", r.status === 200 && r.datos.ok === true);
  ok("D29 borra el registro", !(await leerDictado("fam1", id)) && (await pedir("GET", `/api/dictados/${id}`, { token })).status === 410);
  const t = await almacenAudios().get(claveTexto("fam1", id), { type: "json" });
  ok("D29 escribe el .texto", t?.transcripcion === d!.transcripcion && t.modelo === "gemini-3.8-flash" && t.recetaId === d!.borrador.id && t.segundos === 95, t);
  r = await pedir("GET", `/api/dictados/${id}/texto`, { token });
  ok("D29 GET texto → lo que se dijo", r.status === 200 && r.datos.transcripcion === d!.transcripcion && r.datos.fecha === d!.creado, r.datos);
  r = await pedir("GET", `/api/dictados/${id}/audio`, { token });
  ok("D29 GET audio → bytes idénticos", r.status === 200 && sha(r.datos) === sha(WEBM));
  ok("D29 … con content-type audio/webm y cache-control private", r.headers.get("content-type") === "audio/webm" && /^private/.test(r.headers.get("cache-control") ?? ""), [r.headers.get("content-type"), r.headers.get("cache-control")]);
  r = await pedir("POST", `/api/dictados/${id}/guardado`, { token, cuerpo: { recetaId: d!.borrador.id } });
  ok("D29 repetir guardado → 200", r.status === 200);
  const otra = await subir(token, WEBM, {}, id);
  ok("D29 volver a subir el mismo id ya guardado → 409", otra.status === 409, otra.datos);
  // El texto de un pendiente sale del registro.
  r = await pedir("GET", `/api/dictados/${pendiente.id}/texto`, { token });
  ok("D29 texto de un pendiente sin transcripción → 410", r.status === 410);
  await pedir("DELETE", `/api/dictados/${id}`, { token });
  await ponerRecetas("fam1", []);
  await limpiar(token);
});
await caso("D30", async () => {
  antes();
  const { id } = await dictarYEsperar(token, WEBM);
  let r = await pedir("GET", `/api/dictados/${id}/texto`, { token });
  ok("D30 el texto de un listo sale del registro", r.status === 200 && r.datos.transcripcion === CASOS[0].esperado.transcripcion);
  r = await pedir("DELETE", `/api/dictados/${id}`, { token });
  ok("D30 DELETE → 200", r.status === 200 && r.datos.ok === true);
  ok("D30 borra registro, audio y texto", !(await leerDictado("fam1", id)) && !(await almacenAudios().getMetadata(claveAudio("fam1", id))) && !(await almacenAudios().getMetadata(claveTexto("fam1", id))));
  r = await pedir("DELETE", `/api/dictados/${id}`, { token });
  ok("D30 repetido → 200", r.status === 200);
  r = await pedir("GET", `/api/dictados/${id}/audio`, { token });
  ok("D30 el audio → 410", r.status === 410 && r.datos.error === "El audio se borró", r.datos);
  r = await pedir("POST", `/api/dictados/${id}/procesar`, { token, cuerpo: {} });
  ok("D30 procesar un descartado → 410", r.status === 410);
});

seccion("D31–D32 Probar la conexión y /api/salud");
await caso("D31", async () => {
  antes();
  let r = await pedir("POST", "/api/dictados/probar", { token, cuerpo: {} });
  ok("D31 probar → ok con el modelo", r.status === 200 && r.datos.gemini === "ok" && r.datos.modelo === "gemini-3.8-flash", r.datos);
  ponerEnv({ GEMINI_API_KEY: "otra-clave-de-prueba-mala" });
  r = await pedir("POST", "/api/dictados/probar", { token, cuerpo: {} });
  ok("D31 clave mala → clave_invalida (200, no 401)", r.status === 200 && r.datos.gemini === "clave_invalida", r);
  ponerEnv({ GEMINI_API_KEY: undefined });
  r = await pedir("POST", "/api/dictados/probar", { token, cuerpo: {} });
  ok("D31 sin clave → sin_clave", r.status === 200 && r.datos.gemini === "sin_clave", r.datos);
  ok("D31 0 pedidos de generación", sim.generar().length === 0);
  r = await pedir("GET", "/api/dictados/probar", { token });
  ok("D31 GET probar → 405", r.status === 405);
});
await caso("D32", async () => {
  const { default: salud } = await import("../../netlify/functions/api-salud.mts");
  const guardado = { ...process.env };
  const leer = async () => {
    const r = await (salud as () => Promise<Response>)();
    return { status: r.status, texto: await r.text() };
  };
  try {
    process.env.GEMINI_API_KEY = CLAVE;
    delete process.env.GOOGLE_GEMINI_BASE_URL;
    let r = await leer();
    ok("D32 salud con clave → {blobs:true, gemini:ok}", r.status === 200 && r.texto === '{"blobs":true,"gemini":"ok"}', r);
    ok("D32 … sin la clave en la respuesta", !r.texto.includes(CLAVE));
    delete process.env.GEMINI_API_KEY;
    r = await leer();
    ok("D32 sin clave → gemini sin_clave", JSON.parse(r.texto).gemini === "sin_clave", r);
    process.env.GEMINI_API_KEY = "k-netlify";
    process.env.GOOGLE_GEMINI_BASE_URL = "https://gateway.example";
    r = await leer();
    ok("D32 con AI Gateway → gemini solo_ai_gateway", JSON.parse(r.texto).gemini === "solo_ai_gateway", r);
    (globalThis as O).__blobsHook = async () => {
      throw new Error("Blobs caído");
    };
    r = await leer();
    (globalThis as O).__blobsHook = undefined;
    ok("D32 Blobs caído → 503 {blobs:false, gemini}", r.status === 503 && JSON.parse(r.texto).blobs === false && JSON.parse(r.texto).gemini === "solo_ai_gateway", r);
  } finally {
    (globalThis as O).__blobsHook = undefined;
    for (const k of Object.keys(process.env)) if (!(k in guardado)) delete process.env[k];
    Object.assign(process.env, guardado);
  }
});

seccion("D34 La función en segundo plano no hace nada sin un pedido válido");
await caso("D34", async () => {
  antes();
  dispararActivo = false;
  const s = await subir(token, WEBM);
  const fondo = (cuerpo: unknown, auth?: string) =>
    proceso(new Request("http://sitio.test/api/dictados-proceso", { method: "POST", headers: { ...(auth ? { authorization: auth } : {}), "content-type": "application/json" }, body: JSON.stringify(cuerpo) }));
  await fondo({ id: s.id });
  await fondo({ id: s.id }, "Bearer fam1.xx.secreto-falso");
  await fondo({ id: nuevoId() }, `Bearer ${token}`);
  await fondo({ id: "../../acceso/fam1" }, `Bearer ${token}`);
  await fondo({ id: s.id }, `Bearer ${tokenOtra}`);
  await fondo("no es un objeto", `Bearer ${token}`);
  ok("D34 sin token, token malo, id inexistente o de otra familia → 0 pedidos", sim.generar().length === 0, sim.generar().length);
  ok("D34 … y el dictado sigue subido", (await leerDictado("fam1", s.id))?.d.estado === "subido");
  // El archivo real de la función (con depsReales: process.env y el reloj de verdad).
  const guardado = { ...process.env };
  try {
    Object.assign(process.env, { GEMINI_API_KEY: CLAVE, GEMINI_API_URL: sim.url });
    const { default: real } = await import("../../netlify/functions/dictados-proceso-background.mts");
    await (real as (r: Request) => Promise<void>)(
      new Request("http://sitio.test/api/dictados-proceso", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ id: s.id }) }),
    );
    ok("D34 dictados-proceso-background.mts con un pedido válido → listo", (await leerDictado("fam1", s.id))?.d.estado === "listo" && sim.generar().length === 1);
    const { default: apiReal } = await import("../../netlify/functions/api-dictados.mts");
    const r = await (apiReal as (r: Request, c?: unknown) => Promise<Response>)(new Request("http://sitio.test/api/dictados", { headers: { authorization: `Bearer ${token}` } }));
    const l = await r.json();
    ok("D34 api-dictados.mts responde la lista", r.status === 200 && l.gemini === "ok" && l.dictados.some((x: O) => x.id === s.id), l);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in guardado)) delete process.env[k];
    Object.assign(process.env, guardado);
  }
  await limpiar(token);
});

seccion("D35 Plazo por pedido y tope de pedidos");
await caso("D35", async () => {
  antes(sim, { GEMINI_TIMEOUT_MS: "300" });
  sim.guion("*", Array.from({ length: 14 }, () => ({ lento: 1000 })));
  const r = await dictarYEsperar(token, WEBM);
  ok("D35 Gemini demora más que el plazo → ocupado", r.d?.error?.codigo === "ocupado" && r.d.error.reintentable, r.d?.error);
  ok("D35 nunca más de 12 pedidos por corrida", sim.generar().length === 12, sim.generar().length);
  await limpiar(token);
});

seccion("D36 Lista de dictados");
await caso("D36", async () => {
  antes();
  const a = await dictarYEsperar(token, WEBM);
  desfase += 1_000;
  sim.guion("*", ["no_receta"]);
  const b = await dictarYEsperar(token, cabecera("ogg", 900, 9), { archivo: "Nota de voz 12.m4a" });
  desfase += 1_000;
  dispararActivo = false;
  const c = await subir(token, cabecera("mp3", 900, 10));
  const l = await pedir("GET", "/api/dictados", { token });
  const ids = l.datos.dictados.map((x: O) => x.id);
  ok("D36 del más nuevo al más viejo", JSON.stringify(ids) === JSON.stringify([c.id, b.id, a.id]), ids);
  ok("D36 sin borrador, transcripción, avisos ni revisar", l.datos.dictados.every((x: O) => !("borrador" in x) && !("transcripcion" in x) && !("avisos" in x) && !("revisar" in x)));
  ok("D36 con nombre del borrador y estado", l.datos.dictados[2].nombre === CASOS[0].esperado.nombre && l.datos.dictados[1].esReceta === false && l.datos.dictados[0].estado === "subido", l.datos.dictados.map((x: O) => [x.estado, x.nombre]));
  ok("D36 con gemini ok", l.datos.gemini === "ok");
  ok("D36 nunca turno, plazo, sha256 ni familiaId", !/"(turno|plazo|sha256|familiaId|mimeAlterno)"/.test(JSON.stringify(l.datos)));
  await limpiar(token);
});

seccion("D37 Sin ETag (el simulador local de Netlify): la cerca usa conCandado");
await caso("D37", async () => {
  (globalThis as O).__blobsSinEtag = true;
  try {
    antes();
    const r = await dictarYEsperar(token, WEBM);
    ok("D37 camino feliz sin ETag → listo", r.put.status === 201 && r.d?.estado === "listo", r.d?.estado);
    antes();
    dispararActivo = false;
    const s = await subir(token, cabecera("webm", 900, 11));
    const rs = await Promise.all([correrDictado("fam1", s.id, deps), correrDictado("fam1", s.id, deps), correrDictado("fam1", s.id, deps)]);
    ok("D37 tres disparos a la vez sin ETag → 1 solo pedido", sim.generar().length === 1 && rs.filter((x) => x === "listo").length === 1, [rs, sim.generar().length]);
    antes();
    sim.guion("*", [{ lento: 300 }]);
    const t = await subir(token, cabecera("webm", 900, 12));
    await new Promise((x) => setTimeout(x, 80));
    await pedir("DELETE", `/api/dictados/${t.id}`, { token });
    await esperar();
    ok("D37 descartar mientras Gemini escucha, sin ETag → no resucita", !(await leerDictado("fam1", t.id)), await leerDictado("fam1", t.id));
    ok("D37 no quedaron candados", (await C.almacen().list({ prefix: "candados/" })).blobs.length === 0);
    await limpiar(token);
  } finally {
    (globalThis as O).__blobsSinEtag = false;
  }
});

seccion("D38 Rescate: marcado, y nunca por un corte pasajero");
await caso("D38", async () => {
  antes();
  sim.guion("*", ["max_tokens", "max_tokens"]);
  const r = await dictarYEsperar(token, WEBM);
  ok("D38 dos MAX_TOKENS → listo con rescate: true", r.d?.estado === "listo" && r.d.rescate === true && r.d.borrador.ingredientes.length === 0, r.d);
  const fila = (await pedir("GET", "/api/dictados", { token })).datos.dictados.find((x: O) => x.id === r.id);
  ok("D38 … también en la lista (para ofrecer «Pedir otra versión»)", fila?.rescate === true, fila);
  ok("D38 un borrador normal no trae rescate", !("rescate" in ((await dictarYEsperar(token, cabecera("webm", 3000, 16))).d ?? {})));
  await pedir("POST", `/api/dictados/${r.id}/procesar`, { token, cuerpo: { otraVez: true } });
  await esperar();
  const d2 = await detalle(token, r.id);
  ok("D38 otra versión que sale entera → sin rescate y con ingredientes", d2?.estado === "listo" && !("rescate" in d2) && d2.borrador.ingredientes.length > 0, d2);
  antes();
  sim.guion("gemini-3.8-flash", ["json_malo"]);
  sim.guion("*", Array.from({ length: 20 }, () => "503" as const));
  const r2 = await dictarYEsperar(token, cabecera("webm", 3000, 13));
  ok(
    "D38 JSON dañado y después 503 → error ocupado reintentable, no un borrador vacío",
    r2.d?.estado === "error" && r2.d.error?.codigo === "ocupado" && r2.d.error.reintentable && !r2.d.borrador && !r2.d.rescate,
    r2.d,
  );
  antes();
  sim.guion("gemini-3.8-flash", ["json_malo"]);
  sim.guion("*", ["429dia", "429dia", "429dia", "429dia"]);
  const r3 = await dictarYEsperar(token, cabecera("webm", 3000, 14));
  ok("D38 JSON dañado y después la cuota del día → error cuota_dia", r3.d?.estado === "error" && r3.d.error?.codigo === "cuota_dia" && !r3.d.borrador, r3.d);
  await limpiar(token);
});

seccion("D39 «Pedir otra versión» que falla no pierde el borrador");
await caso("D39", async () => {
  antes();
  const r0 = await dictarYEsperar(token, WEBM);
  const ids = (d: O | undefined) => (d?.borrador?.ingredientes ?? []).map((i: O) => i.id).join();
  const antesIds = ids(r0.d);
  sim.guion("*", [{ lento: 300, luego: "429dia" }, "429dia", "429dia", "429dia"]);
  const p = await pedir("POST", `/api/dictados/${r0.id}/procesar`, { token, cuerpo: { otraVez: true } });
  ok("D39 otra versión → 202 sin el borrador en la respuesta", p.status === 202 && !p.datos.dictado.borrador, p.datos);
  await new Promise((x) => setTimeout(x, 80));
  const t = await pedir("GET", `/api/dictados/${r0.id}/texto`, { token });
  ok("D39 mientras Gemini vuelve a escuchar, lo que se dijo sigue disponible", t.status === 200 && t.datos.transcripcion === r0.d!.transcripcion, t);
  const fila = (await pedir("GET", "/api/dictados", { token })).datos.dictados.find((x: O) => x.id === r0.id);
  ok("D39 … y la lista sigue mostrando el nombre", fila?.estado === "procesando" && fila.nombre === r0.d!.nombre, fila);
  await esperar();
  let d = await detalle(token, r0.id);
  ok("D39 cuota del día en la otra versión → vuelve el borrador anterior (listo, mismos ingredientes)", d?.estado === "listo" && ids(d) === antesIds, d);
  ok("D39 … con la transcripción y el error cuota_dia como aviso", d?.transcripcion === r0.d!.transcripcion && d?.error?.codigo === "cuota_dia" && d.error.reintentable === true, d?.error);
  ok("D39 … y el registro no se queda con `anterior`", !(await leerDictado("fam1", r0.id))?.d.anterior);
  const n0 = sim.generar().length;
  await pedir("POST", `/api/dictados/${r0.id}/procesar`, { token, cuerpo: {} });
  await esperar();
  ok("D39 «Intentar de nuevo» sobre ese borrador no vuelve a llamar a Gemini", sim.generar().length === n0 && (await detalle(token, r0.id))?.estado === "listo");
  sim.guion("*", ["safety"]);
  await pedir("POST", `/api/dictados/${r0.id}/procesar`, { token, cuerpo: { otraVez: true } });
  await esperar();
  d = await detalle(token, r0.id);
  ok("D39 bloqueado (no reintentable) en la otra versión → también vuelve el borrador", d?.estado === "listo" && ids(d) === antesIds && d.error?.codigo === "bloqueado", d?.error);
  await pedir("POST", `/api/dictados/${r0.id}/procesar`, { token, cuerpo: { otraVez: true } });
  await esperar();
  d = await detalle(token, r0.id);
  ok("D39 después, una otra versión que sale bien → borrador nuevo y sin error", d?.estado === "listo" && !d.error && ids(d) !== antesIds && ids(d) !== "", d);
  await limpiar(token);
});

seccion("D40 Descartar un borrador que otro equipo ya guardó");
await caso("D40", async () => {
  antes();
  const { id, d } = await dictarYEsperar(token, WEBM);
  await ponerRecetas("fam1", [d!.borrador]);
  let r = await pedir("POST", `/api/dictados/${id}/guardado`, { token, cuerpo: { recetaId: d!.borrador.id } });
  ok("D40 el iPhone guarda la receta → 200", r.status === 200, r);
  // La pared seguía con la revisión abierta y la descarta ("no hay receta guardada").
  r = await pedir("DELETE", `/api/dictados/${id}?borrador=1`, { token: tokenPared });
  ok("D40 DELETE ?borrador=1 de una receta ya guardada → 200 {ok, guardada: true}", r.status === 200 && r.datos.ok === true && r.datos.guardada === true, r.datos);
  ok("D40 … y no borra ni el audio ni lo que se dijo", (await existe(claveAudio("fam1", id))) && (await existe(claveTexto("fam1", id))));
  ok("D40 … el audio de la receta se sigue escuchando", (await pedir("GET", `/api/dictados/${id}/audio`, { token })).status === 200);
  const b = await dictarYEsperar(token, cabecera("webm", 3000, 15));
  r = await pedir("DELETE", `/api/dictados/${b.id}?borrador=1`, { token });
  ok("D40 ?borrador=1 de un borrador sin guardar → lo borra entero", r.status === 200 && !r.datos.guardada && !(await leerDictado("fam1", b.id)) && !(await existe(claveAudio("fam1", b.id))), r.datos);
  r = await pedir("DELETE", `/api/dictados/${b.id}?borrador=1`, { token });
  ok("D40 … repetido → 200", r.status === 200 && r.datos.ok === true);
  r = await pedir("DELETE", `/api/dictados/${id}`, { token });
  ok("D40 sin ?borrador=1 (quitar el audio de la receta) → borra el audio y lo que se dijo", r.status === 200 && !(await existe(claveAudio("fam1", id))) && !(await existe(claveTexto("fam1", id))));
  await ponerRecetas("fam1", []);
  await limpiar(token);
});

seccion("D41 «Guardado» sólo con la receta en la colección");
await caso("D41", async () => {
  antes();
  await ponerRecetas("fam1", [{ id: "rec_otra", nombre: "Porotos" }]);
  const { id, d } = await dictarYEsperar(token, WEBM);
  let r = await pedir("POST", `/api/dictados/${id}/guardado`, { token, cuerpo: { recetaId: d!.borrador.id } });
  ok(`D41 el PUT de la colección no llegó → 409 {codigo: ${RECETA_NO_GUARDADA}}`, r.status === 409 && r.datos.codigo === RECETA_NO_GUARDADA && typeof r.datos.error === "string", r);
  ok("D41 … el registro sigue (la revisión no se pierde) y no hay .texto", (await leerDictado("fam1", id))?.d.estado === "listo" && !(await existe(claveTexto("fam1", id))));
  await ponerRecetas("fam1", [{ id: "rec_otra", nombre: "Porotos" }, d!.borrador]);
  r = await pedir("POST", `/api/dictados/${id}/guardado`, { token, cuerpo: { recetaId: d!.borrador.id } });
  ok("D41 cuando la colección ya la tiene → 200, sale de la lista y queda el .texto", r.status === 200 && !(await leerDictado("fam1", id)) && (await existe(claveTexto("fam1", id))), r);
  await ponerRecetas("fam1", []);
  await pedir("DELETE", `/api/dictados/${id}`, { token });
  await limpiar(token);
});

seccion("D42 El tope de 15 minutos sale de los bytes, no sólo de ?segundos");
await caso("D42", async () => {
  antes();
  dispararActivo = false;
  const put = (bytes: Uint8Array, q = "") => pedir("PUT", `/api/dictados/${nuevoId()}${q ? `?${q}` : ""}`, { token, cuerpo: bytes });
  const largo = (r: { status: number; datos: O }) => r.status === 413 && /más de 15 minutos/.test(r.datos.error);
  let r = await put(conDuracion("ogg", 1000, 500_000));
  ok("D42 .opus de 16:40 sin ?segundos → 413 «más de 15 minutos»", largo(r), r.datos);
  r = await put(conDuracion("ogg", 1000, 500_000), "segundos=60");
  ok("D42 … aunque el equipo diga 60 s", largo(r), r.datos);
  r = await put(conDuracion("webm", 960, 300_000), "origen=grabacion");
  ok("D42 WebM de MediaRecorder (sin Duration) de 16 min → 413", largo(r), r.datos);
  r = await put(conDuracion("mp4", 1200, 300_000));
  ok("D42 m4a de 20 min → 413", largo(r), r.datos);
  r = await put(conDuracion("wav", 1000, 600_000));
  ok("D42 wav de 16:40 → 413", largo(r), r.datos);
  r = await put(conDuracion("ogg", 600, 300_000));
  ok("D42 .opus de 10 min sin ?segundos → 201 con segundos = 600 (de los bytes)", r.status === 201 && r.datos.dictado.segundos === 600, r.datos);
  r = await put(conDuracion("ogg", 905, 300_000));
  ok("D42 15:05 (dentro del margen) → 201", r.status === 201, r.datos);
  r = await put(cabecera("ogg", MAX_AUDIO_SIN_DURACION + 1, 21));
  ok("D42 sin duración en los bytes ni ?segundos y más de 1,8 MB → 413 «No se pudo saber cuánto dura»", r.status === 413 && /No se pudo saber cuánto dura/.test(r.datos.error), r.datos);
  r = await put(cabecera("ogg", 2_000_000, 22), "segundos=300");
  ok("D42 … con ?segundos=300 → 201 (se usa lo del equipo)", r.status === 201 && r.datos.dictado.segundos === 300, r.datos);
  r = await put(cabecera("ogg", MAX_AUDIO_SIN_DURACION, 23));
  ok("D42 sin duración y justo 1,8 MB → 201", r.status === 201, r.datos);
  ok("D42 nada llegó a Gemini", sim.generar().length === 0);
  await limpiar(token);
});

seccion("D43 Lo que dura el audio, no dónde termina; con ?segundos los bytes son sólo un tope");
await caso("D43", async () => {
  antes();
  dispararActivo = false;
  const put = (bytes: Uint8Array, q = "") => pedir("PUT", `/api/dictados/${nuevoId()}${q ? `?${q}` : ""}`, { token, cuerpo: bytes });
  const largo = (r: { status: number; datos: O }) => r.status === 413 && /más de 15 minutos/.test(r.datos.error);
  // 60 s que parten en 1200 s (cortado de una transmisión, ffmpeg -output_ts_offset): antes daba 1260 s → 413.
  let r = await put(conDuracion("webm", 60, 300_000, { inicio: 1200 }), "segundos=60&origen=grabacion");
  ok("D43 WebM de 60 s que parte en 1200 s, con ?segundos=60 → 201 con 60 s", r.status === 201 && r.datos.dictado.segundos === 60, r.datos);
  r = await put(conDuracion("ogg", 60, 300_000, { inicio: 1200 }), "origen=archivo&archivo=nota.opus");
  ok("D43 .opus de 60 s que parte en 1200 s, sin ?segundos → 201 con segundos = 60 (de los bytes)", r.status === 201 && r.datos.dictado.segundos === 60, r.datos);
  r = await put(conDuracion("mp4", 60, 300_000, { inicio: 1200 }), "origen=archivo");
  ok("D43 m4a de 60 s con un hueco inicial de 1200 s, sin ?segundos → 201 con 60 s", r.status === 201 && r.datos.dictado.segundos === 60, r.datos);
  r = await put(conDuracion("webm", 960, 300_000, { inicio: 1200 }), "origen=grabacion");
  ok("D43 … pero 16 min que parten en 1200 s siguen siendo más de 15 → 413", largo(r), r.datos);
  // Con ?segundos= (que ya pasó el tope de 900), los bytes sólo atajan lo claramente más largo: 900 s + 10 %.
  r = await put(conDuracion("ogg", 950, 500_000), "segundos=880");
  ok("D43 el equipo dice 880 s y los bytes 950 s → 201 con 880 s (tope de 990 s con ?segundos)", r.status === 201 && r.datos.dictado.segundos === 880, r.datos);
  r = await put(conDuracion("ogg", 950, 500_000));
  ok("D43 … sin ?segundos, 950 s de los bytes → 413 (margen de 10 s)", largo(r), r.datos);
  r = await put(conDuracion("ogg", 995, 500_000), "segundos=880");
  ok("D43 … y 995 s de los bytes, aunque el equipo diga 880 → 413", largo(r), r.datos);
  const reales = conFfmpegDesplazados(60, 1200);
  if (!reales) info("sin ffmpeg: sólo contenedores mínimos");
  else
    for (const a of reales) {
      r = await put(a.bytes, `segundos=60&origen=archivo&archivo=${a.nombre}`);
      ok(`D43 ${a.nombre} (60 s) con ?segundos=60 → 201`, r.status === 201 && r.datos.dictado.segundos === 60, [a.bytes.byteLength, r.status, r.datos]);
    }
  ok("D43 nada llegó a Gemini", sim.generar().length === 0);
  await limpiar(token);
});

seccion("D44 Descartar un borrador cuya receta ya está en la colección, aunque el POST /guardado no llegó");
await caso("D44", async () => {
  antes();
  const { id, d } = await dictarYEsperar(token, WEBM);
  await ponerRecetas("fam1", [d!.borrador]); // llegó el PUT de la colección; el POST /guardado, no
  ok("D44 la receta está en la colección y todavía no hay .texto", d!.borrador.id === `rec_${id}` && !(await existe(claveTexto("fam1", id))));
  // La pared tenía la revisión abierta y la descarta: no puede borrar el audio de una receta guardada.
  let r = await pedir("DELETE", `/api/dictados/${id}?borrador=1`, { token: tokenPared });
  ok("D44 DELETE ?borrador=1 → 200 {ok, guardada: true}", r.status === 200 && r.datos.ok === true && r.datos.guardada === true, r.datos);
  ok("D44 … no borra el audio", await existe(claveAudio("fam1", id)));
  const t = (await almacenAudios().get(claveTexto("fam1", id), { type: "json" })) as O | null;
  ok("D44 … completa el guardado: queda el .texto con lo que se dijo", t?.transcripcion === d!.transcripcion && t?.recetaId === `rec_${id}` && t?.modelo === d!.modelo && t?.segundos === 95 && t?.fecha === d!.creado, t);
  ok("D44 … y el registro sale de la lista", !(await leerDictado("fam1", id)) && !(await pedir("GET", "/api/dictados", { token })).datos.dictados.some((x: O) => x.id === id));
  r = await pedir("GET", `/api/dictados/${id}/audio`, { token });
  ok("D44 el audio de la receta se sigue escuchando", r.status === 200 && sha(r.datos) === sha(WEBM));
  r = await pedir("GET", `/api/dictados/${id}/texto`, { token });
  ok("D44 … y lo que se dijo", r.status === 200 && r.datos.transcripcion === d!.transcripcion, r.datos);
  r = await pedir("POST", `/api/dictados/${id}/guardado`, { token, cuerpo: { recetaId: `rec_${id}` } });
  ok("D44 el POST /guardado que llega después → 200", r.status === 200 && r.datos.ok === true, r.datos);
  const otra = await subir(token, WEBM, {}, id);
  ok("D44 volver a subir ese id → 409 ya_guardada", otra.status === 409 && otra.datos.motivo === "ya_guardada", otra.datos);
  r = await pedir("DELETE", `/api/dictados/${id}?borrador=1`, { token });
  ok("D44 repetido → 200 {guardada: true} y el audio sigue", r.status === 200 && r.datos.guardada === true && (await existe(claveAudio("fam1", id))), r.datos);

  // Mientras se pide otra versión, lo que se dijo está en `anterior`: es eso lo que queda.
  dispararActivo = true;
  const b = await dictarYEsperar(token, cabecera("webm", 3000, 16));
  dispararActivo = false;
  r = await pedir("POST", `/api/dictados/${b.id}/procesar`, { token, cuerpo: { otraVez: true } });
  ok("D44 «Pedir otra versión» deja el borrador en `anterior`", r.status === 202 && (await leerDictado("fam1", b.id))?.d.anterior?.transcripcion === b.d!.transcripcion, r.datos);
  await ponerRecetas("fam1", [d!.borrador, b.d!.borrador]);
  r = await pedir("DELETE", `/api/dictados/${b.id}?borrador=1`, { token });
  const tb = (await almacenAudios().get(claveTexto("fam1", b.id), { type: "json" })) as O | null;
  ok("D44 … descartarlo con la receta en la colección → guardada, con lo que se dijo antes", r.datos.guardada === true && (await existe(claveAudio("fam1", b.id))) && tb?.transcripcion === b.d!.transcripcion && !(await leerDictado("fam1", b.id)), [r.datos, tb]);

  // La receta de OTRO dictado en la colección no cuenta: el borrador se borra entero.
  dispararActivo = true;
  const c = await dictarYEsperar(token, cabecera("webm", 3000, 17));
  r = await pedir("DELETE", `/api/dictados/${c.id}?borrador=1`, { token });
  ok("D44 un borrador cuya receta no está en la colección se borra entero", r.status === 200 && !r.datos.guardada && !(await existe(claveAudio("fam1", c.id))) && !(await leerDictado("fam1", c.id)), r.datos);
  // Sin ?borrador=1 (quitar el audio de la receta) se borra aunque la receta esté.
  for (const x of [id, b.id]) await pedir("DELETE", `/api/dictados/${x}`, { token });
  ok("D44 sin ?borrador=1 → borra el audio y el texto", !(await existe(claveAudio("fam1", id))) && !(await existe(claveTexto("fam1", id))) && !(await existe(claveAudio("fam1", b.id))));
  await ponerRecetas("fam1", []);
  await limpiar(token);
});

seccion("D45–D48 Google saturado (503 «high demand»): rotar de modelo antes de esperar");
const modelosPedidos = () => sim.generar().map((p) => p.modelo);
await caso("D45", async () => {
  antes();
  sim.guion("gemini-3.8-flash", ["503"]);
  sim.guion("gemini-3.6-flash", ["503"]);
  const n0 = registros.length;
  const r = await dictarYEsperar(token, WEBM);
  ok("D45 503 en 3.8 y 3.6 → listo con 3.5 Flash-Lite en la primera corrida", r.d?.estado === "listo" && r.d.modelo === "gemini-3.5-flash-lite" && r.d.intentos === 1, [r.d?.estado, r.d?.modelo, r.d?.intentos]);
  ok("D45 … en 3 pedidos, uno por modelo y en orden", JSON.stringify(modelosPedidos()) === JSON.stringify(["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"]), modelosPedidos());
  ok("D45 … sin esperar", dormidas.length === 0, dormidas);
  const nuevos = registros.slice(n0);
  ok("D45 el registro dice qué pasó con cada modelo", nuevos.some((l) => l.startsWith(`dictado ${r.id}: gemini resumen (3 pedidos → ok con gemini-3.5-flash-lite): gemini-3.8-flash: ocupado 503 · gemini-3.6-flash: ocupado 503 · gemini-3.5-flash-lite: ok`)), nuevos);
  await limpiar(token);
});
await caso("D46", async () => {
  antes();
  sim.guion("*", Array.from({ length: 40 }, () => "503" as const));
  const n0 = registros.length;
  const t0 = reloj.ahora();
  const s = await subir(token, WEBM);
  await esperar();
  let d = await detalle(token, s.id);
  ok("D46 503 en los 4 modelos → error ocupado reintentable", d?.estado === "error" && d.error?.codigo === "ocupado" && d.error.reintentable === true, d?.error);
  ok("D46 … sin pasar del tope de pedidos ni del presupuesto (12 min)", sim.generar().length === MAX_PEDIDOS_CORRIDA && reloj.ahora() - t0 < 12 * 60_000 && dormidas.length === 2, [sim.generar().length, reloj.ahora() - t0, dormidas]);
  ok("D46 la primera corrida se reintenta sola a los 3 min", Math.abs(d!.error.proximo - (reloj.ahora() + esperaOcupadoMs(1))) < 5_000 && esperaOcupadoMs(1) === 3 * 60_000, d?.error);
  const linea = registros.slice(n0).find((l) => l.includes("gemini resumen")) ?? "";
  ok("D46 el registro nombra los 4 modelos con sus 503", ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"].every((m) => linea.includes(`${m}: ocupado 503, ocupado 503, ocupado 503`)) && linea.includes("12 pedidos → ocupado"), linea);
  ok("D46 la familia lee que Google está saturado, que no es el panel y que se reintenta solo", /Google\) está saturado.*no es un error del panel.*se vuelve a intentar solo cerca de las \d{2}:\d{2}/.test(mensajeError(d!)), mensajeError(d!));
  // La app lo vuelve a pedir (como «Intentar de nuevo» o el reintento solo): la segunda corrida espera más.
  dormidas.length = 0;
  sim.reiniciar();
  sim.guion("*", Array.from({ length: 40 }, () => "503" as const));
  let p = await pedir("POST", `/api/dictados/${s.id}/procesar`, { token, cuerpo: {} });
  await esperar();
  d = await detalle(token, s.id);
  ok("D46 segunda corrida también ocupada → proximo a los 10 min", p.status === 202 && d?.error?.codigo === "ocupado" && d.intentos === 2 && Math.abs(d.error.proximo - (reloj.ahora() + 10 * 60_000)) < 5_000, d?.error);
  // Google se recupera: la tercera corrida sale con el primer modelo.
  sim.reiniciar();
  p = await pedir("POST", `/api/dictados/${s.id}/procesar`, { token, cuerpo: {} });
  await esperar();
  d = await detalle(token, s.id);
  ok("D46 cuando Google se recupera → listo con 3.8 Flash en 1 pedido", d?.estado === "listo" && d.modelo === "gemini-3.8-flash" && d.intentos === 3 && sim.generar().length === 1, [d?.estado, d?.modelo, d?.intentos]);
  await limpiar(token);
});
await caso("D47", async () => {
  antes();
  sim.guion("gemini-3.8-flash", ["503"]);
  sim.guion("gemini-3.6-flash", ["400"]);
  const n0 = registros.length;
  const r = await dictarYEsperar(token, WEBM);
  ok("D47 400 en un modelo de respaldo → sigue con el siguiente y queda listo (3.5 Flash-Lite)", r.d?.estado === "listo" && r.d.modelo === "gemini-3.5-flash-lite" && sim.generar().length === 3 && dormidas.length === 0, [r.d?.estado, r.d?.error, modelosPedidos()]);
  ok("D47 el registro dice que 3.6 rechazó el pedido", registros.slice(n0).some((l) => l.includes("gemini-3.6-flash: peticion 400 → fuera (rechazó el pedido)")), registros.slice(n0));
  antes();
  sim.guion("*", ["400", "400", "400", "400"]);
  const r2 = await dictarYEsperar(token, cabecera("webm", 3000, 31));
  ok("D47 400 en los cuatro → recién ahí error interno (4 pedidos)", r2.d?.estado === "error" && r2.d.error?.codigo === "interno" && sim.generar().length === 4, [r2.d?.error, sim.generar().length]);
  await limpiar(token);
});
await caso("D48", async () => {
  antes();
  sim.guion("gemini-3.8-flash", ["404"]);
  let r = await dictarYEsperar(token, WEBM);
  ok("D48 404 en 3.8 → se salta y queda listo con 3.6 Flash en 2 pedidos", r.d?.estado === "listo" && r.d.modelo === "gemini-3.6-flash" && sim.generar().length === 2 && dormidas.length === 0, [r.d?.modelo, modelosPedidos()]);
  antes(sim, { GEMINI_MODELOS: "gemini-3.8-flash,gemini-9-nada,gemini-3.5-flash-lite" });
  sim.guion("gemini-3.8-flash", ["503"]);
  r = await dictarYEsperar(token, cabecera("webm", 3000, 32));
  ok("D48 503, un modelo que no existe y ok → listo con el tercero, sin esperar", r.d?.estado === "listo" && r.d.modelo === "gemini-3.5-flash-lite" && JSON.stringify(modelosPedidos()) === JSON.stringify(["gemini-3.8-flash", "gemini-9-nada", "gemini-3.5-flash-lite"]) && dormidas.length === 0, [r.d?.modelo, modelosPedidos(), dormidas]);
  await limpiar(token);
});

seccion("D33 La clave nunca sale; Gemini nunca da 401 ni 5xx");
await caso("D33", async () => {
  const todos = (globalThis as O).__blobs as Map<string, Map<string, { bytes: Buffer; metadata: unknown }>>;
  let enBlobs = 0;
  for (const [, m] of todos) for (const [k, x] of m) if (k.includes(CLAVE) || x.bytes.toString("latin1").includes(CLAVE) || JSON.stringify(x.metadata).includes(CLAVE)) enBlobs++;
  ok("D33 la clave no está en ningún blob ni metadata", enBlobs === 0, enBlobs);
  ok("D33 ni en ninguna respuesta", respuestas.every((r) => !r.texto.includes(CLAVE)), respuestas.filter((r) => r.texto.includes(CLAVE)).map((r) => r.ruta));
  ok("D33 ni en los registros ni en console.error", ![...registros, ...errores].some((l) => l.includes(CLAVE) || l.includes("AI" + "za")), [...registros, ...errores].filter((l) => l.includes(CLAVE)));
  ok("D33 ninguna respuesta fue 5xx", respuestas.every((r) => r.status < 500), respuestas.filter((r) => r.status >= 500));
  const n401 = respuestas.filter((r) => r.status === 401).length;
  ok("D33 sólo hubo los 401 de los pedidos sin clave del equipo (ninguno vino de Gemini)", n401 === esperados401, [n401, esperados401]);
  info(`${respuestas.length} respuestas de la API, ${registros.length} líneas de registro`);
});

await terminar(async () => {
  console.error = errorOriginal;
  await Promise.all([sim.cerrar(), simMp4.cerrar(), simSinRF.cerrar()]);
});
