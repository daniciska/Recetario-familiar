// detectarAudio (servidor/gemini.ts): el tipo de audio sale de los bytes, no de lo que dice el navegador.
// duracionAudio: los segundos también (para el tope de 15 minutos), con contenedores mínimos y, si hay ffmpeg,
// audios reales y escritos «en vivo» (sin la duración en la cabecera, como MediaRecorder).
//   node --experimental-transform-types --no-warnings --import ./pruebas/registrar.mjs pruebas/recetas/formatos.test.ts
import { detectarAudio, duracionAudio, type AudioDetectado } from "../../servidor/gemini.ts";
import { MIMES_DOCUMENTADOS } from "./mock-gemini.mts";
import { cabecera, conDuracion, conFfmpeg, conFfmpegDesplazados, conFfmpegSinDuracion, grabadoChrome, type Formato } from "./audios.ts";
import { info, ok, seccion, terminar } from "./arnes.ts";

const ver = (d: AudioDetectado) => (d.ok ? `${d.mime}|${d.alterno ?? ""}|${d.reproducir}` : `✗ ${d.mensaje}`);

seccion("Cabeceras");
const tabla: [Formato, string][] = [
  ["ogg", "audio/ogg|audio/opus|audio/ogg"],
  ["webm", "audio/webm||audio/webm"],
  ["m4a", "audio/m4a|audio/mp4|audio/mp4"],
  ["mp4", "audio/m4a|audio/mp4|audio/mp4"],
  ["mov", "audio/m4a|audio/mp4|audio/mp4"],
  ["wav", "audio/wav||audio/wav"],
  ["flac", "audio/flac||audio/flac"],
  ["aiff", "audio/aiff||audio/aiff"],
  ["aifc", "audio/aiff||audio/aiff"],
  ["mp3", "audio/mp3|audio/mpeg|audio/mpeg"],
  ["mp3sync", "audio/mp3|audio/mpeg|audio/mpeg"],
  ["aac", "audio/aac||audio/aac"],
];
for (const [f, esperado] of tabla) {
  const d = detectarAudio(cabecera(f));
  ok(`${f} → ${esperado}`, ver(d) === esperado, ver(d));
  if (d.ok) {
    ok(`${f}: el mime que va a Gemini está documentado`, MIMES_DOCUMENTADOS.includes(d.mime));
    if (d.alterno) ok(`${f}: el alterno es distinto`, d.alterno !== d.mime);
  }
}
ok("ADTS FF F9 (MPEG-2) → aac", ver(detectarAudio(new Uint8Array([0xff, 0xf9, 0x50, 0x80, 0, 0, 0, 0, 0, 0, 0, 0]))) === "audio/aac||audio/aac");
ok("mp3 MPEG-2 FF F3 → mp3", detectarAudio(new Uint8Array([0xff, 0xf3, 0x90, 0x64, 0, 0, 0, 0, 0, 0, 0, 0])).ok);
ok("formato del m4a = la marca ftyp", (() => {
  const d = detectarAudio(cabecera("m4a"));
  return d.ok && d.formato === "M4A";
})());

seccion("Rechazos con su texto exacto");
const rechazos: [Formato | "vacio" | "cinco", string][] = [
  ["caf", "Ese formato (CAF del iPhone) no sirve. Compártelo como m4a desde la app Notas de Voz."],
  ["amr", "Ese formato (AMR) no sirve. Graba de nuevo desde el panel."],
  ["pdf", "Ese archivo no es un audio."],
  ["jpeg", "Ese archivo no es un audio."],
  ["png", "Ese archivo no es un audio."],
  ["texto", "No reconozco ese formato de audio. Sirven notas de voz de WhatsApp (.opus), m4a, mp3, ogg, webm o wav."],
  ["vacio", "El archivo está vacío o incompleto."],
  ["cinco", "El archivo está vacío o incompleto."],
];
for (const [f, texto] of rechazos) {
  const bytes = f === "vacio" ? new Uint8Array(0) : f === "cinco" ? new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0]) : cabecera(f);
  const d = detectarAudio(bytes);
  ok(`${f} → «${texto.slice(0, 40)}…»`, !d.ok && d.mensaje === texto, ver(d));
}

seccion("Tamaños límite (sólo la cabecera decide)");
for (const n of [3_999_999, 4_000_000, 4_000_001]) {
  const d = detectarAudio(cabecera("ogg", n));
  ok(`ogg de ${n} bytes → audio/ogg`, d.ok && d.mime === "audio/ogg");
}

seccion("Grabación real de MediaRecorder (Chrome)");
{
  const b = grabadoChrome();
  const d = detectarAudio(b);
  ok("grabado-chrome.webm → audio/webm", d.ok && d.mime === "audio/webm" && d.reproducir === "audio/webm", ver(d));
  ok("grabado-chrome.webm pesa ≈ 15 KB", b.byteLength > 10_000 && b.byteLength < 20_000, b.byteLength);
}

seccion("Audios reales generados con ffmpeg");
{
  const reales = conFfmpeg();
  if (!reales) info("omitido (sin ffmpeg)");
  else {
    for (const a of reales) {
      const d = detectarAudio(a.bytes);
      if (a.esperado === "rechazo") ok(`${a.nombre} → rechazado con su texto`, !d.ok && /CAF/.test(d.mensaje), ver(d));
      else ok(`${a.nombre} → ${a.esperado}`, d.ok && d.mime === a.esperado, ver(d));
    }
    info(`ffmpeg generó ${reales.length} audios: ${reales.map((a) => `${a.nombre} (${a.bytes.byteLength} B)`).join(", ")}`);
  }
}

// ---------- Duración por los bytes (para que el tope de 15 minutos no dependa sólo del equipo) ----------
const cerca = (x: number | undefined, s: number, margen = 0.5) => x != null && Math.abs(x - s) <= margen;

seccion("Duración: contenedores mínimos");
for (const f of ["ogg", "webm", "mp4", "wav"] as const) {
  for (const s of [60, 600, 1000]) {
    const b = conDuracion(f, s, 400_000);
    const d = duracionAudio(b);
    ok(`${f} que dice ${s} s → ${s} s`, detectarAudio(b).ok && cerca(d, s, 0.5), d); // wav: bytes por segundo enteros
  }
}
{
  const t0 = performance.now();
  const d = duracionAudio(conDuracion("webm", 950, 4_000_000));
  ok("webm de 4 MB → se lee en menos de 200 ms", cerca(d, 950) && performance.now() - t0 < 200, [d, Math.round(performance.now() - t0)]);
}

seccion("Duración: lo que no se puede saber → undefined");
for (const f of ["ogg", "webm", "m4a", "mp4", "mov", "wav", "flac", "aiff", "aifc", "mp3", "mp3sync"] as const) {
  ok(`cabecera ${f} sin datos de duración → undefined`, duracionAudio(cabecera(f, 3_000_000)) === undefined, duracionAudio(cabecera(f, 3_000_000)));
}
ok("vacío, cortito o basura → undefined", [new Uint8Array(0), new Uint8Array([0x4f, 0x67]), cabecera("texto", 5000), cabecera("caf")].every((b) => duracionAudio(b) === undefined));
ok("duración imposible para el tamaño (2 MB en 0,01 s) → undefined", duracionAudio(conDuracion("mp4", 0.01, 2_000_000)) === undefined);
ok("duración imposible para el tamaño (20 KB que dicen 2 semanas) → undefined", duracionAudio(conDuracion("ogg", 1_209_600, 20_000)) === undefined);
{
  const b = conDuracion("ogg", 1000, 400_000);
  const cortado = b.subarray(0, b.length - 50); // la última página quedó a medias: no hay otra → undefined
  ok("ogg con la última página cortada (y sin otra) → undefined", duracionAudio(cortado) === undefined, duracionAudio(cortado));
}

seccion("Duración: grabaciones reales");
{
  const d = duracionAudio(grabadoChrome());
  ok("grabado-chrome.webm (MediaRecorder, sin Duration) → ≈ 3,9 s", cerca(d, 3.95, 0.15), d);
  const reales = conFfmpeg();
  if (!reales) info("omitido (sin ffmpeg)");
  else
    for (const a of reales) {
      const x = duracionAudio(a.bytes);
      if (a.esperado === "rechazo") ok(`${a.nombre} → undefined (se rechaza por el formato)`, x === undefined, x);
      else ok(`${a.nombre} (4 s) → ≈ 4 s`, cerca(x, 4, 0.15), x);
    }
  const vivos = conFfmpegSinDuracion(20);
  if (!vivos) info("omitido (sin ffmpeg)");
  else for (const a of vivos) ok(`${a.nombre} (20 s, sin la duración en la cabecera) → ≈ 20 s`, cerca(duracionAudio(a.bytes), 20, 0.3), duracionAudio(a.bytes));
}

// Lo que DURA, no dónde termina: si el audio no parte en 0, antes se tomaba el final (1260 s para 60 s que
// parten en 1200 s) y un audio corto salía con 413 «dura más de 15 minutos», sin reintento.
seccion("Duración: audios que no parten en 0");
for (const f of ["ogg", "webm", "mp4"] as const) {
  for (const inicio of [0, 1200]) {
    const d = duracionAudio(conDuracion(f, 60, 400_000, { inicio }));
    ok(`${f} de 60 s que parte en ${inicio} s → 60 s`, cerca(d, 60, 0.5), d);
  }
}
{
  const d = duracionAudio(conDuracion("ogg", 600, 400_000, { inicio: 30 }));
  ok("ogg de 10 min que parte en 30 s → 600 s (el comienzo sale del TOC de los paquetes)", cerca(d, 600, 0.01), d);
  const reales = conFfmpegDesplazados(60, 1200);
  if (!reales) info("omitido (sin ffmpeg)");
  else {
    for (const a of reales) {
      const x = duracionAudio(a.bytes);
      ok(`${a.nombre} (60 s${a.nombre.startsWith("vbr") ? "" : " desde 1200 s"}) → ≈ 60 s`, cerca(x, 60, 0.5), x);
    }
    info(`ffmpeg generó ${reales.length}: ${reales.map((a) => a.nombre).join(", ")}`);
  }
}

{
  // MP3 sin Xing con una etiqueta grande al final (APEv2 o ID3v2 con pie, p. ej. una carátula): la etiqueta no
  // tiene cuadros, y antes dejaba la cobertura bajo el 90 % → sin duración → 413 si el equipo no mandaba ?segundos=.
  const cbr = conFfmpegSinDuracion(20)?.find((a) => a.nombre === "cbr.mp3");
  if (!cbr) info("omitido (sin ffmpeg o sin libmp3lame)");
  else {
    const relleno = new Uint8Array(Math.round(cbr.bytes.length * 0.4)).fill(0x41);
    const ape = (() => {
      const pie = new Uint8Array(32);
      pie.set(new TextEncoder().encode("APETAGEX"));
      return new Uint8Array([...new TextEncoder().encode("APETAGEX"), ...new Uint8Array(24), ...relleno, ...pie]);
    })();
    const id3pie = new Uint8Array([...new TextEncoder().encode("ID3"), 4, 0, 0x10, 0, 0, 0, 0, ...relleno, ...new TextEncoder().encode("3DI"), 4, 0, 0x10, 0, 0, 0, 0]);
    for (const [nombre, cola] of [["APEv2", ape], ["ID3v2 con pie", id3pie]] as const) {
      const d = duracionAudio(new Uint8Array([...cbr.bytes, ...cola]));
      ok(`mp3 CBR sin Xing de 20 s con una etiqueta ${nombre} del 40 % al final → ≈ 20 s`, cerca(d, 20, 0.5), d);
    }
    const basura = new Uint8Array(4_000_000).fill(0x55);
    const dosCuadros = new Uint8Array([...cbr.bytes.slice(0, 2000), ...basura]);
    ok("mp3: 2 KB de cuadros y 4 MB de basura → sin duración (la regla de los 6 Mbit/s)", duracionAudio(dosCuadros) === undefined, duracionAudio(dosCuadros));
  }
}

await terminar();
