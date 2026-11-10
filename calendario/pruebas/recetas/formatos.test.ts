// detectarAudio (servidor/gemini.ts): el tipo de audio sale de los bytes, no de lo que dice el navegador.
//   node --experimental-transform-types --no-warnings --import ./pruebas/registrar.mjs pruebas/recetas/formatos.test.ts
import { detectarAudio, type AudioDetectado } from "../../servidor/gemini.ts";
import { MIMES_DOCUMENTADOS } from "./mock-gemini.mts";
import { cabecera, conFfmpeg, grabadoChrome, type Formato } from "./audios.ts";
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

await terminar();
