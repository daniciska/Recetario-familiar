// lib/dictados/{grabadora,pendientes,cliente}.ts en un Chrome de verdad (manual: no es *.test, necesita
// /usr/bin/google-chrome, Playwright y ffmpeg). Un servidor en este mismo proceso sirve esos módulos (con
// los tipos quitados por Node, sin compilar la app) y /api/* con el servidor real (manejarApi + Blobs en
// memoria + el simulador de Gemini). Chrome usa un micrófono falso que toca un tono (o silencio).
//   cd calendario && node --experimental-transform-types --no-warnings --import ./pruebas/registrar.mjs pruebas/recetas/navegador-lib.mts [--puerto 8904]
// Prueba: MediaRecorder (tipo, pausa, seguir, segundos sin pausas, trozos juntos con cabecera, nivel,
// aviso de silencio, pausa al ocultar la app, permiso denegado), IndexedDB real (también después de
// recargar), duracionArchivo, subir → Gemini → bajar el audio → descartar desde el navegador, sin red y de
// vuelta, y el aviso de una «otra versión» que falló y revisar sin red (lib/dictados/textos.ts).
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createRequire, stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reiniciarBlobs } from "@netlify/blobs";
import * as C from "../../servidor/comun.ts";
import { manejarApi, manejarProceso, type DepsDictados } from "../../servidor/dictados.ts";
import { simuladorGemini } from "./mock-gemini.mts";
import { caso, info, ok, seccion, terminar } from "./arnes.ts";

type O = Record<string, any>;
const require = createRequire(import.meta.url);
const CHROME = "/usr/bin/google-chrome";
const i = process.argv.indexOf("--puerto");
const PUERTO = i > 0 ? Number(process.argv[i + 1]) : 8904;
const CLAVE = `${"AI" + "za"}SyPRUEBA-navegador-no-es-real_01234`;
if (!existsSync(CHROME)) {
  info("sin /usr/bin/google-chrome: no se puede probar en el navegador");
  process.exit(1);
}
const { chromium } = require("playwright") as typeof import("playwright");

// ---------- Audios del micrófono falso y de archivo ----------
const dir = mkdtempSync(join(tmpdir(), "dictados-nav-"));
const ff = (...a: string[]) => execFileSync("ffmpeg", ["-v", "error", "-y", ...a]);
ff("-f", "lavfi", "-i", "sine=frequency=300:duration=60", "-ar", "48000", "-ac", "1", join(dir, "voz.wav"));
ff("-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", "60", join(dir, "silencio.wav"));
ff("-f", "lavfi", "-i", "sine=frequency=330:duration=20", "-ac", "1", "-c:a", "libopus", "-b:a", "16k", "-f", "ogg", join(dir, "PTT-20261109-WA0001.opus"));
ff("-f", "lavfi", "-i", "sine=frequency=330:duration=12", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "64k", join(dir, "nota.mp3"));

// ---------- Servidor: módulos de lib/ y la API ----------
const sim = await simuladorGemini({ clave: CLAVE });
const env: Record<string, string | undefined> = { GEMINI_API_KEY: CLAVE, GEMINI_API_URL: sim.url, URL: `http://127.0.0.1:${PUERTO}` };
const corridas: Promise<unknown>[] = [];
const deps: DepsDictados = {
  reloj: { ahora: () => Date.now(), dormir: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 50))) },
  env,
  log: () => {},
  disparar: async (base, auth, id) => {
    corridas.push(proceso(new Request(`${base}/api/dictados-proceso`, { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify({ id }) })));
    return true;
  },
};
const api = manejarApi(deps);
const proceso = manejarProceso(deps);
reiniciarBlobs();
await C.almacen().setJSON("acceso/fnav", { familia: { id: "fnav", nombre: "Familia" }, equipos: {}, versiones: {} });
const equipo = await C.nuevoEquipo("fnav", "Chrome");
const RAIZ = new URL("../../", import.meta.url).pathname; // calendario/

const PAGINA = `<!doctype html><meta charset="utf-8"><title>lib/dictados</title><body><p>pruebas</p>`;
async function atender(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PUERTO}`);
  if (url.pathname === "/") return void res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(PAGINA);
  if (url.pathname.startsWith("/archivos/")) {
    const f = join(dir, url.pathname.slice("/archivos/".length).replace(/[^A-Za-z0-9._-]/g, ""));
    if (!existsSync(f)) return void res.writeHead(404).end();
    return void res.writeHead(200, { "content-type": "application/octet-stream" }).end(readFileSync(f));
  }
  if (url.pathname.startsWith("/mod/")) {
    // Sólo lib/: el módulo con sus tipos quitados (los imports relativos sin extensión vuelven aquí).
    const rel = url.pathname.slice("/mod/".length);
    if (!/^lib\/[A-Za-z0-9/_.-]+$/.test(rel) || rel.includes("..")) return void res.writeHead(400).end();
    const base = join(RAIZ, rel);
    const archivo = [base, `${base}.ts`, join(base, "index.ts")].find((x) => existsSync(x) && statSync(x).isFile());
    if (!archivo) return void res.writeHead(404).end();
    const js = stripTypeScriptTypes(readFileSync(archivo, "utf8"));
    return void res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" }).end(js);
  }
  if (url.pathname.startsWith("/api/dictados")) {
    const cuerpo = ["GET", "HEAD"].includes(req.method ?? "GET") ? undefined : await new Promise<Buffer>((ok) => {
      const t: Buffer[] = [];
      req.on("data", (x: Buffer) => t.push(x)).on("end", () => ok(Buffer.concat(t)));
    });
    const cabeceras = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") cabeceras.set(k, v);
    const r = await api(new Request(url, { method: req.method, headers: cabeceras, body: cuerpo }));
    const h: Record<string, string> = {};
    r.headers.forEach((v, k) => (h[k] = v));
    return void res.writeHead(r.status, h).end(Buffer.from(await r.arrayBuffer()));
  }
  res.writeHead(404).end();
}
const servidor = createServer((req, res) => void atender(req, res).catch((e) => res.writeHead(500).end(String(e))));
await new Promise<void>((ok) => servidor.listen(PUERTO, "127.0.0.1", ok));
const ORIGEN = `http://127.0.0.1:${PUERTO}`;

const navegador = await chromium.launch({
  executablePath: CHROME,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${join(dir, "voz.wav")}`, "--autoplay-policy=no-user-gesture-required"],
});
const contexto = await navegador.newContext({ permissions: ["microphone"] });
await contexto.addInitScript(
  ([token, equipoId]) => localStorage.setItem("calendario-familiar:nube", JSON.stringify({ token, equipoId, familia: { id: "fnav", nombre: "Familia" } })),
  [equipo.token, equipo.equipoId],
);
const pagina = await contexto.newPage();
const consola: string[] = [];
pagina.on("console", (m) => m.type() === "error" && consola.push(m.text()));
pagina.on("pageerror", (e) => consola.push(String(e)));
await pagina.goto(ORIGEN);
const en = <T,>(fn: string) => pagina.evaluate(`(async () => { ${fn} })()`) as Promise<T>;

seccion("Grabadora (MediaRecorder de verdad, micrófono falso con un tono)");
await caso("grabadora", async () => {
  const sop = await en<O>(`
    const g = await import("/mod/lib/dictados/grabadora");
    return { puede: g.puedeGrabar(), tipo: g.tipoGrabacion(), ios: g.esIOS(), accept: g.aceptarArchivos() ?? null, bits: [g.bitsPara("audio/webm;codecs=opus"), g.bitsPara("audio/mp4;codecs=mp4a.40.2"), g.bitsPara("")] };`);
  ok("puedeGrabar, WebM/Opus primero, no es iOS, accept audio/*", sop.puede && sop.tipo === "audio/webm;codecs=opus" && !sop.ios && sop.accept === "audio/*", sop);
  ok("bits por segundo: 32k Opus, 64k AAC, 32k si elige el navegador", JSON.stringify(sop.bits) === "[32000,64000,32000]", sop.bits);
  const r = await en<O>(`
    const g = await import("/mod/lib/dictados/grabadora");
    const tiempos = [], niveles = [], avisos = [], estados = [];
    const gr = g.crearGrabadora({ alTiempo: (s) => tiempos.push(s), alNivel: (n) => niveles.push(n), alAviso: (a) => avisos.push(a), alEstado: (e) => estados.push(e) });
    const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));
    await gr.empezar();
    const e1 = gr.estado;
    await espera(2600);
    gr.pausar();
    const enPausa = gr.segundos;
    await espera(1500);
    const trasPausa = gr.segundos;
    gr.seguir();
    await espera(2200);
    const p1 = gr.terminar();
    const p2 = gr.terminar();
    const res = await p1;
    const cab = [...new Uint8Array(await res.blob.slice(0, 4).arrayBuffer())].map((x) => x.toString(16).padStart(2, "0")).join("");
    const ctx = new AudioContext();
    let dur = -1;
    try { dur = (await ctx.decodeAudioData(await res.blob.arrayBuffer())).duration; } catch (e) { dur = -2; }
    return { e1, enPausa, trasPausa, mismo: p1 === p2, segundos: res.segundos, mime: res.mime, tam: res.blob.size, tipoBlob: res.blob.type, cab, dur,
      tiempos, maxNivel: Math.max(0, ...niveles), avisos, estados, final: gr.estado, bytes: gr.bytes };`);
  ok("empieza grabando", r.e1 === "grabando", r);
  ok("en pausa no corre el reloj", Math.abs(r.trasPausa - r.enPausa) < 0.05, [r.enPausa, r.trasPausa]);
  ok("segundos sin contar la pausa (≈ 5)", r.segundos >= 4 && r.segundos <= 6, r.segundos);
  ok("terminar() dos veces es la misma promesa", r.mismo);
  ok("un solo audio WebM con su cabecera EBML (todos los trozos juntos)", r.mime === "audio/webm" && r.tipoBlob === "audio/webm" && r.cab === "1a45dfa3" && r.tam > 2000, r);
  ok("se puede decodificar y dura ≈ 5 s (sin la pausa)", r.dur > 3.5 && r.dur < 6.5, r.dur);
  ok("≈ 32 kbps (tope de 3,9 MB ≈ 16 min)", (r.tam * 8) / r.segundos < 45_000, Math.round((r.tam * 8) / r.segundos));
  ok("alTiempo va de 0 en adelante sin repetir", r.tiempos[0] === 0 && r.tiempos.every((t: number, n: number) => n === 0 || t > r.tiempos[n - 1]), r.tiempos);
  ok("el nivel se mueve con el tono", r.maxNivel > 0.1, r.maxNivel);
  ok("sin avisos con sonido y 5 s", r.avisos.length === 0, r.avisos);
  ok("estados: grabando → pausa → grabando → terminada", JSON.stringify(r.estados) === JSON.stringify(["grabando", "pausa", "grabando", "terminada"]), r.estados);
  ok("al terminar se apaga todo", r.final === "terminada");

  const oculto = await en<O>(`
    const g = await import("/mod/lib/dictados/grabadora");
    const avisos = [];
    const gr = g.crearGrabadora({ alAviso: (a) => avisos.push(a) });
    await gr.empezar();
    await new Promise((ok) => setTimeout(ok, 1200));
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
    const estado = gr.estado;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.dispatchEvent(new Event("visibilitychange"));
    gr.seguir();
    const sigue = gr.estado;
    await new Promise((ok) => setTimeout(ok, 1200));
    const res = await gr.terminar();
    return { avisos, estado, sigue, segundos: res.segundos };`);
  ok("al ocultar la app se pausa sola y avisa «interrumpida»", oculto.estado === "pausa" && JSON.stringify(oculto.avisos) === '["interrumpida"]', oculto);
  ok("…y se puede seguir (lo grabado no se pierde)", oculto.sigue === "grabando" && oculto.segundos >= 2, oculto);

  const cancelada = await en<O>(`
    const g = await import("/mod/lib/dictados/grabadora");
    const gr = g.crearGrabadora();
    await gr.empezar();
    await new Promise((ok) => setTimeout(ok, 500));
    gr.cancelar();
    const pistas = (await navigator.mediaDevices.enumerateDevices()).length;
    return { estado: gr.estado, bytes: gr.bytes, pistas };`);
  ok("cancelar descarta lo grabado", cancelada.estado === "terminada" && cancelada.bytes === 0, cancelada);
});

seccion("Archivos y copia en el equipo (IndexedDB de verdad)");
await caso("idb", async () => {
  const dur = await en<O>(`
    const g = await import("/mod/lib/dictados/grabadora");
    const opus = await (await fetch("/archivos/PTT-20261109-WA0001.opus")).blob();
    const mp3 = await (await fetch("/archivos/nota.mp3")).blob();
    return { opus: await g.duracionArchivo(opus), mp3: await g.duracionArchivo(mp3), basura: await g.duracionArchivo(new Blob(["hola"])), largo: g.muyLargo(901), justo: g.muyLargo(900), sin: g.muyLargo(undefined) };`);
  ok("duracionArchivo de un .opus de WhatsApp (20 s) y un mp3 (12 s)", Math.abs(dur.opus - 20) < 0.6 && Math.abs(dur.mp3 - 12) < 0.6, dur);
  ok("duracionArchivo de algo que no es audio → undefined", dur.basura === undefined || dur.basura === null, dur);
  ok("muyLargo: más de 15 min; sin duración no se revisa", dur.largo && !dur.justo && !dur.sin);
  const guardado = await en<O>(`
    const c = await import("/mod/lib/dictados/cliente");
    const p = await import("/mod/lib/dictados/pendientes");
    const opus = await (await fetch("/archivos/PTT-20261109-WA0001.opus")).blob();
    const x = c.nuevoPendiente(new File([opus], "PTT-20261109-WA0001.opus", { type: "" }), { origen: "archivo", archivo: "PTT-20261109-WA0001.opus", segundos: 20 });
    const okG = await p.guardar(x);
    localStorage.setItem("prueba:id", x.id);
    return { okG, id: x.id, mime: x.mime, tam: opus.size, resumen: await p.resumenes() };`);
  ok("guardar en IndexedDB de Chrome", guardado.okG && guardado.mime === "audio/ogg" && guardado.resumen.length === 1 && guardado.resumen[0].bytes === guardado.tam, guardado);
  await pagina.reload();
  const despues = await en<O>(`
    const p = await import("/mod/lib/dictados/pendientes");
    const id = localStorage.getItem("prueba:id");
    const x = await p.leer(id);
    const a = x ? new Uint8Array(await x.blob.arrayBuffer()) : null;
    const b = new Uint8Array(await (await fetch("/archivos/PTT-20261109-WA0001.opus")).arrayBuffer());
    const iguales = !!a && a.length === b.length && a.every((v, i) => v === b[i]);
    await p.anotarRechazo(id, { mensaje: "Muy grande", reintentar: false });
    const r = (await p.resumenes())[0];
    const todos = await p.listar();
    await p.borrar(id);
    return { iguales, tipo: x?.blob.type, segundos: x?.segundos, rechazo: r?.rechazo, todos: todos.length, quedan: (await p.resumenes()).length };`);
  ok("después de recargar la página, el audio sigue con los mismos bytes", despues.iguales && despues.tipo === "audio/ogg" && despues.segundos === 20, despues);
  ok("anotarRechazo, listar y borrar", despues.rechazo?.mensaje === "Muy grande" && despues.todos === 1 && despues.quedan === 0, despues);
});

seccion("Grabar → guardar → subir → Gemini → escuchar → descartar (desde el navegador)");
await caso("flujo", async () => {
  const r = await en<O>(`
    const g = await import("/mod/lib/dictados/grabadora");
    const c = await import("/mod/lib/dictados/cliente");
    const p = await import("/mod/lib/dictados/pendientes");
    const gr = g.crearGrabadora();
    await gr.empezar();
    await new Promise((ok) => setTimeout(ok, 3200));
    const rec = await gr.terminar();
    const x = c.nuevoPendiente(rec.blob, { origen: "grabacion", segundos: rec.segundos, mime: rec.mime });
    const okG = await p.guardar(x);
    const s = await c.subirPendiente(x, { esperas: [0, 0] });
    return { id: x.id, okG, s, local: await p.leer(x.id) };`);
  ok("grabado, guardado en el equipo y subido (201)", r.okG && r.s.ok && r.s.dictado.mime === "audio/webm" && r.s.dictado.origen === "grabacion", r.s);
  ok("la copia del equipo se borró al confirmar la nube", r.local === null);
  while (corridas.length) await corridas.shift();
  const d = await en<O>(`
    const c = await import("/mod/lib/dictados/cliente");
    const d = await c.leerDictado(${JSON.stringify(r.id)});
    const l = await c.listarDictados();
    const url = await c.bajarAudio(${JSON.stringify(r.id)});
    const audio = new Audio();
    const cargo = await new Promise((ok) => { audio.onloadedmetadata = () => ok(true); audio.onerror = () => ok(false); setTimeout(() => ok(false), 5000); audio.src = url; });
    URL.revokeObjectURL(url);
    const t = await c.leerTexto(${JSON.stringify(r.id)});
    await c.descartarDictado(${JSON.stringify(r.id)});
    return { estado: d?.estado, borrador: d?.borrador?.id, lista: l.dictados.length, gemini: l.gemini, url: url.slice(0, 5), cargo, texto: !!t?.transcripcion, despues: await c.bajarAudio(${JSON.stringify(r.id)}), existe: await c.leerDictado(${JSON.stringify(r.id)}) };`);
  ok("Gemini (simulado) lo dejó listo con borrador rec_<id>", d.estado === "listo" && d.borrador === `rec_${r.id}`, d);
  ok("la lista lo muestra y dice gemini ok", d.lista === 1 && d.gemini === "ok");
  ok("bajarAudio → blob: que un <audio> puede cargar", d.url === "blob:" && d.cargo, d);
  ok("lo que se dijo", d.texto);
  ok("descartado: el audio da «borrado» y el dictado ya no existe", d.despues === "borrado" && d.existe === null, d);

  await contexto.setOffline(true);
  const sinRed = await en<O>(`
    const c = await import("/mod/lib/dictados/cliente");
    const p = await import("/mod/lib/dictados/pendientes");
    const bytes = new Uint8Array(64);
    bytes.set([0x1a, 0x45, 0xdf, 0xa3]); // cabecera EBML: el servidor lo toma como WebM
    const x = c.nuevoPendiente(new Blob([bytes], { type: "audio/webm" }), { origen: "grabacion" });
    await p.guardar(x);
    localStorage.setItem("prueba:sinred", x.id);
    const s = await c.subirPendiente(x, { esperas: [0, 0] });
    const salud = await c.salud(2000);
    return { s, local: !!(await p.leer(x.id)), salud };`);
  ok("sin red: sin_conexion y la copia queda en el equipo", JSON.stringify(sinRed.s) === '{"ok":false,"motivo":"sin_conexion"}' && sinRed.local && sinRed.salud === null, sinRed);
  await contexto.setOffline(false);
  const vuelta = await en<O>(`
    const c = await import("/mod/lib/dictados/cliente");
    const p = await import("/mod/lib/dictados/pendientes");
    const x = await p.leer(localStorage.getItem("prueba:sinred"));
    const s = await c.subirPendiente(x, { esperas: [0, 0] });
    const quedan = (await p.resumenes()).length;
    if (s.ok) await c.descartarDictado(x.id);
    return { s: s.ok ? "ok" : s, quedan };`);
  ok("vuelve internet: sube y la copia se borra", vuelta.s === "ok" && vuelta.quedan === 0, vuelta);
});

seccion("«Pedir otra versión» que falla y «Revisar receta» sin red (lib/dictados/textos en Chrome; revisión 3)");
await caso("otra versión y sin red", async () => {
  sim.cola.length = 0;
  sim.guion("*", ["max_tokens", "max_tokens"]); // Gemini corta dos veces: borrador de rescate
  const r = await en<O>(`
    const c = await import("/mod/lib/dictados/cliente");
    const opus = await (await fetch("/archivos/PTT-20261109-WA0001.opus")).blob();
    const x = c.nuevoPendiente(new File([opus], "PTT-20261109-WA0001.opus", { type: "" }), { origen: "archivo", archivo: "PTT-20261109-WA0001.opus", segundos: 20 });
    const s = await c.subirPendiente(x, { esperas: [0, 0] });
    return { id: x.id, ok: s.ok };`);
  ok("sube el .opus", r.ok, r);
  while (corridas.length) await corridas.shift();
  sim.guion("*", ["safety"]); // la otra versión: Gemini no quiere procesar el audio
  const pedido = await en<O>(`
    const c = await import("/mod/lib/dictados/cliente");
    const t = await import("/mod/lib/dictados/textos");
    const antes = await c.leerDictado(${JSON.stringify(r.id)});
    const d = await c.procesarDictado(${JSON.stringify(r.id)}, true);
    return { rescate: antes?.rescate, avisoAntes: t.textoOtraVersionFallo(antes), estado: d?.estado };`);
  ok("borrador de rescate sin aviso; pedir otra versión → en cola", pedido.rescate === true && pedido.avisoAntes === null && pedido.estado === "subido", pedido);
  while (corridas.length) await corridas.shift();
  const v = await en<O>(`
    const c = await import("/mod/lib/dictados/cliente");
    const t = await import("/mod/lib/dictados/textos");
    const d = await c.leerDictado(${JSON.stringify(r.id)});
    window.__enVentana = d; // lo que la ventana de dictar tiene en memoria
    return { estado: d?.estado, codigo: d?.error?.codigo, rescate: d?.rescate, borrador: !!d?.borrador, fallo: t.otraVersionFallo(d), aviso: t.textoOtraVersionFallo(d), daLoMismo: t.otraVersionDaLoMismo(d), botones: t.botonesDictado(d) };`);
  ok("falló: «listo» con el borrador de antes y el error bloqueado", v.estado === "listo" && v.codigo === "bloqueado" && v.rescate === true && v.borrador && v.fallo, v);
  ok("…«No se pudo hacer otra versión: Gemini no quiso procesar este audio: si la pides de nuevo, va a pasar lo mismo…»", /^No se pudo hacer otra versión: Gemini no quiso procesar este audio: si la pides de nuevo, va a pasar lo mismo\. Quedó la versión de antes\.$/.test(v.aviso ?? ""), v.aviso);
  ok("…se advierte antes de pedirla de nuevo (sigue el botón, con la pregunta)", v.daLoMismo && JSON.stringify(v.botones) === '["revisar","otra_version"]', v);
  await contexto.setOffline(true);
  const sinRed = await en<O>(`
    const c = await import("/mod/lib/dictados/cliente");
    const t = await import("/mod/lib/dictados/textos");
    try {
      await c.leerDictado(${JSON.stringify(r.id)});
      return { leyo: true };
    } catch (e) {
      return { nombre: e?.constructor?.name, abre: t.revisarSinRed(e, window.__enVentana), sinBorrador: t.revisarSinRed(e, { ...window.__enVentana, borrador: undefined }) };
    }`);
  await contexto.setOffline(false);
  ok("sin red: leerDictado lanza SinConexion y la ventana abre igual el borrador que tiene", sinRed.nombre === "SinConexion" && sinRed.abre === true, sinRed);
  ok("…pero no si en la ventana no hay borrador", sinRed.sinBorrador === false, sinRed);
  const fin = await en<O>(`
    const c = await import("/mod/lib/dictados/cliente");
    const t = await import("/mod/lib/dictados/textos");
    let e = null;
    try { await c.procesarDictado("MAL"); } catch (x) { e = x; }
    const res = { nombre: e?.constructor?.name, abre: t.revisarSinRed(e, window.__enVentana) };
    await c.descartarBorrador(${JSON.stringify(r.id)});
    return res;`);
  ok("con la nube respondiendo que no (400), no se abre", fin.nombre === "RechazoDictado" && fin.abre === false, fin);
});

seccion("Permiso del micrófono denegado");
await caso("permiso", async () => {
  // Con micrófono (falso) pero sin el permiso: headless rechaza el pedido como lo haría «No permitir».
  const otro = await chromium.launch({ executablePath: CHROME, args: ["--use-fake-device-for-media-stream", "--deny-permission-prompts"] });
  const ctx = await otro.newContext({ permissions: [] });
  const pg = await ctx.newPage();
  await pg.goto(ORIGEN);
  const r = (await pg.evaluate(`(async () => {
    const g = await import("/mod/lib/dictados/grabadora");
    try { await g.crearGrabadora().empezar(); return { motivo: "grabó" }; } catch (e) { return { motivo: e.motivo, nombre: e.constructor.name }; }
  })()`)) as O;
  ok("getUserMedia denegado → ErrorGrabadora «permiso» (o sin micrófono si el equipo no tiene)", r.nombre === "ErrorGrabadora" && (r.motivo === "permiso" || r.motivo === "sin_microfono"), r);
  if (r.motivo === "sin_microfono") info("Chrome sin micrófono falso no tiene dispositivo: dio «sin_microfono»");
  await otro.close();
});

seccion("Silencio (micrófono falso sin sonido)");
await caso("silencio", async () => {
  const otro = await chromium.launch({
    executablePath: CHROME,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${join(dir, "silencio.wav")}`],
  });
  const pg = await (await otro.newContext({ permissions: ["microphone"] })).newPage();
  await pg.goto(ORIGEN);
  const r = (await pg.evaluate(`(async () => {
    const g = await import("/mod/lib/dictados/grabadora");
    const avisos = [];
    let nivel = 0;
    const gr = g.crearGrabadora({ alAviso: (a) => avisos.push([a, Math.round(gr.segundos)]), alNivel: (n) => (nivel = Math.max(nivel, n)) });
    await gr.empezar();
    await new Promise((ok) => setTimeout(ok, 11500));
    await gr.terminar();
    return { avisos, nivel };
  })()`)) as O;
  ok("a los 10 s de silencio avisa una vez", r.avisos.length === 1 && r.avisos[0][0] === "silencio" && r.avisos[0][1] >= 10, r);
  await otro.close();
});

// «Failed to load resource» es Chrome anotando los 410 y los pedidos sin red que la prueba provoca.
ok("sin errores en la consola del navegador", consola.filter((x) => !/^Failed to load resource/.test(x)).length === 0, consola);
await terminar(async () => {
  await navegador.close();
  servidor.close();
  await sim.cerrar();
});
