// Audios de prueba para "🎙️ Dictar receta".
//   cabecera(formato, bytes?)  la firma real del formato + relleno, en memoria (no es audio que suene)
//   conFfmpeg()                si existe ffmpeg, audios reales de 4 s en una carpeta temporal (null si no hay)
//   grabadoChrome()            una grabación real de MediaRecorder (Chrome, webm/opus) de fixtures/
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type Formato =
  | "ogg"
  | "webm"
  | "m4a"
  | "mp4"
  | "mov"
  | "wav"
  | "flac"
  | "aiff"
  | "aifc"
  | "mp3"
  | "mp3sync"
  | "aac"
  | "caf"
  | "amr"
  | "pdf"
  | "jpeg"
  | "png"
  | "texto";

const FIRMAS: Record<Formato, number[]> = {
  ogg: [...Buffer.from("OggS"), 0, 2, 0, 0, 0, 0, 0, 0, 0, 0],
  webm: [0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81],
  m4a: [0, 0, 0, 0x20, ...Buffer.from("ftypM4A "), 0, 0, 0, 0],
  mp4: [0, 0, 0, 0x1c, ...Buffer.from("ftypmp42"), 0, 0, 0, 0],
  mov: [0, 0, 0, 0x14, ...Buffer.from("ftypqt  "), 0, 0, 0, 0],
  wav: [...Buffer.from("RIFF"), 0x24, 0, 0, 0, ...Buffer.from("WAVEfmt ")],
  flac: [...Buffer.from("fLaC"), 0, 0, 0, 0x22, 0, 0, 0, 0],
  aiff: [...Buffer.from("FORM"), 0, 0, 0, 0, ...Buffer.from("AIFFCOMM")],
  aifc: [...Buffer.from("FORM"), 0, 0, 0, 0, ...Buffer.from("AIFCFVER")],
  mp3: [...Buffer.from("ID3"), 4, 0, 0, 0, 0, 0, 0, 0, 0],
  mp3sync: [0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0, 0, 0, 0, 0],
  aac: [0xff, 0xf1, 0x50, 0x80, 0x2e, 0x7f, 0xfc, 0, 0, 0, 0, 0],
  caf: [...Buffer.from("caff"), 0, 1, 0, 0, ...Buffer.from("desc")],
  amr: [...Buffer.from("#!AMR\n"), 0x3c, 0, 0, 0, 0, 0],
  pdf: [...Buffer.from("%PDF-1.7\n%"), 0xe2, 0xe3],
  jpeg: [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, ...Buffer.from("JFIF"), 0, 1],
  png: [0x89, ...Buffer.from("PNG\r\n"), 0x1a, 0x0a, 0, 0, 0, 0x0d],
  texto: [...Buffer.from("Hola, esto no es un audio")],
};

/** Firma real + relleno hasta `bytes` (mínimo, el largo de la firma). `marca` cambia el relleno (dos audios distintos). */
export function cabecera(formato: Formato, bytes = 2000, marca = 7): Uint8Array {
  const f = FIRMAS[formato];
  const b = new Uint8Array(Math.max(bytes, f.length)).fill(marca);
  b.set(f, 0);
  return b;
}

export const grabadoChrome = () => new Uint8Array(readFileSync(new URL("./fixtures/grabado-chrome.webm", import.meta.url)));

export interface AudioReal {
  nombre: string;
  ruta: string;
  bytes: Uint8Array;
  esperado: string; // mime que debería detectarse
}

/** Audios reales de 4 s con ffmpeg (null si no está instalado). */
export function conFfmpeg(): AudioReal[] | null {
  const ffmpeg = ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg"].find((r) => existsSync(r));
  if (!ffmpeg) return null;
  const dir = mkdtempSync(join(tmpdir(), "dictados-"));
  const fuente = ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=330:duration=4", "-ac", "1"];
  const lista: [string, string[], string][] = [
    ["PTT-20261109-WA0001.opus", ["-ar", "48000", "-c:a", "libopus", "-b:a", "16k", "-application", "voip", "-f", "ogg"], "audio/ogg"],
    ["nota.m4a", ["-c:a", "aac", "-b:a", "64k"], "audio/m4a"],
    ["nota.webm", ["-c:a", "libopus", "-b:a", "32k"], "audio/webm"],
    ["nota.mp3", ["-c:a", "libmp3lame", "-b:a", "64k"], "audio/mp3"],
    ["nota.wav", ["-ar", "16000"], "audio/wav"],
    ["nota.flac", [], "audio/flac"],
    ["nota.aac", ["-c:a", "aac", "-f", "adts"], "audio/aac"],
    ["nota.aiff", [], "audio/aiff"],
    ["nota.caf", ["-f", "caf"], "rechazo"],
  ];
  const salida: AudioReal[] = [];
  for (const [nombre, extra, esperado] of lista) {
    const ruta = join(dir, nombre);
    try {
      execFileSync(ffmpeg, [...fuente, ...extra, ruta], { stdio: "pipe" });
      salida.push({ nombre, ruta, bytes: new Uint8Array(readFileSync(ruta)), esperado });
    } catch {
      /* ese códec no está en este ffmpeg: se omite */
    }
  }
  return salida;
}
