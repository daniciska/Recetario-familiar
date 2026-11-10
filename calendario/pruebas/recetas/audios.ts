// Audios de prueba para "🎙️ Dictar receta".
//   cabecera(formato, bytes?)  la firma real del formato + relleno, en memoria (no es audio que suene)
//   conFfmpeg()                si existe ffmpeg, audios reales de 4 s en una carpeta temporal (null si no hay)
//   conFfmpegSinDuracion(s)    si existe ffmpeg, audios de `s` segundos escritos "en vivo" (sin la duración en la
//                              cabecera: WebM sin Duration, MP4 fragmentado, WAV por tubería, MP3 CBR sin Xing)
//   grabadoChrome()            una grabación real de MediaRecorder (Chrome, webm/opus) de fixtures/
//   conDuracion(f, s, bytes)   contenedor mínimo pero válido (ogg/opus, webm de MediaRecorder, mp4, wav) que dice
//                              durar `s` segundos, con relleno hasta `bytes` (para el tope de 15 minutos);
//                              con {inicio} (ogg, webm, mp4) el audio no parte en 0 sino en `inicio` segundos
//   conFfmpegDesplazados(s, inicio)  si existe ffmpeg, audios de `s` segundos que parten en `inicio` (-output_ts_offset;
//                              el MP4 fragmentado, corriendo sus tfdt) y un MP3 VBR sin Xing; null si no hay
//   desplazarTfdt(b, ticks)    copia de un MP4 fragmentado con todos sus tfdt corridos en `ticks`
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

/**
 * Contenedor que dice durar `segundos`, sin audio que suene (relleno con 7):
 *   ogg   página OpusHead (pre-skip 312) + última página con granule = segundos·48000 + 312
 *   webm  como MediaRecorder: Segment y Clusters de tamaño desconocido, sin Duration; un bloque en 0 y otro en segundos
 *   mp4   ftyp + moov/mvhd (timescale 1000) + mdat
 *   wav   fmt con los bytes por segundo que hacen calzar `segundos` con el bloque data
 * Con `inicio` (segundos) el audio parte ahí, como lo escribe `ffmpeg -output_ts_offset` o un corte de una
 * transmisión: lo que DURA sigue siendo `segundos`, pero los números del contenedor llegan a inicio + segundos.
 *   ogg   + OpusTags y una primera página de audio con 50 paquetes de 20 ms en granule = inicio·48000 + 48000
 *   webm  el primer bloque en `inicio` y el último en inicio + segundos
 *   mp4   mvhd = inicio + segundos (el hueco inicial de la lista de ediciones) y trak/mdhd = segundos
 */
export function conDuracion(formato: "ogg" | "webm" | "mp4" | "wav", segundos: number, bytes = 200_000, op: { inicio?: number } = {}): Uint8Array {
  const b = new Uint8Array(bytes).fill(7);
  const v = new DataView(b.buffer);
  const pon = (i: number, x: number[] | string) => b.set(typeof x === "string" ? [...Buffer.from(x, "latin1")] : x, i);
  const inicio = op.inicio ?? 0;
  if (formato === "ogg") {
    /** Página con un segmento por paquete (`largos`, cada uno < 255); devuelve dónde empiezan sus datos. */
    const pagina = (i: number, tipo: number, granule: bigint, secuencia: number, largos: number[]) => {
      pon(i, "OggS");
      b[i + 4] = 0;
      b[i + 5] = tipo;
      v.setBigUint64(i + 6, granule, true);
      v.setUint32(i + 14, 0x5eca, true); // serie del flujo
      v.setUint32(i + 18, secuencia, true);
      v.setUint32(i + 22, 0, true); // CRC (no se revisa)
      b[i + 26] = largos.length;
      pon(i + 27, largos);
      return i + 27 + largos.length;
    };
    pagina(0, 2, 0n, 0, [19]);
    pon(28, "OpusHead");
    pon(36, [1, 1]);
    v.setUint16(38, 312, true);
    v.setUint32(40, 48_000, true);
    pon(44, [0, 0, 0]);
    const comienzo = BigInt(Math.round(inicio * 48_000));
    if (op.inicio != null) {
      const tags = pagina(47, 0, 0n, 1, [16]); // OpusTags sin vendor ni comentarios: termina en 91
      pon(tags, "OpusTags");
      pon(tags + 8, [0, 0, 0, 0, 0, 0, 0, 0]);
      // 50 paquetes de un byte: TOC 0xF8 = CELT 48 kHz de 20 ms, un cuadro (960 muestras) → 1 s.
      const datos = pagina(91, 0, comienzo + 48_000n, 2, Array(50).fill(1));
      pon(datos, Array(50).fill(0xf8));
    }
    pagina(bytes - 27 - 1 - 200, 4, comienzo + BigInt(Math.round(segundos * 48_000) + 312), 99, [200]);
  } else if (formato === "webm") {
    const cabeza = [
      ...[0x1a, 0x45, 0xdf, 0xa3, 0x87, 0x42, 0x82, 0x84, ...Buffer.from("webm")], // EBML, DocType webm
      ...[0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff], // Segment (tamaño desconocido)
      ...[0x15, 0x49, 0xa9, 0x66, 0x87, 0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40], // Info: TimecodeScale 1 ms, sin Duration
    ];
    const cluster = (ms: number) => [
      ...[0x1f, 0x43, 0xb6, 0x75, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff], // Cluster (tamaño desconocido)
      ...[0xe7, 0x84, (ms >>> 24) & 0xff, (ms >>> 16) & 0xff, (ms >>> 8) & 0xff, ms & 0xff], // Timecode
      ...[0xa3, 0x84, 0x81, 0x00, 0x00, 0x80], // SimpleBlock: pista 1, +0 ms
    ];
    const ms0 = Math.round(inicio * 1000);
    cabeza.push(...cluster(ms0)); // el primer bloque
    const cola = cluster(ms0 + Math.round(segundos * 1000));
    const relleno = bytes - cabeza.length - cola.length - 9; // Void (EC) con tamaño de 8 bytes
    pon(0, cabeza);
    pon(cabeza.length, [0xec, 0x01, 0, 0, 0, (relleno >>> 24) & 0xff, (relleno >>> 16) & 0xff, (relleno >>> 8) & 0xff, relleno & 0xff]);
    pon(bytes - cola.length, cola);
  } else if (formato === "mp4") {
    const conPista = op.inicio != null;
    const finMoov = conPista ? 276 : 136;
    pon(0, [0, 0, 0, 20, ...Buffer.from("ftypM4A "), 0, 0, 0, 0, ...Buffer.from("M4A ")]);
    pon(20, [0, 0, 0, finMoov - 20, ...Buffer.from("moov"), 0, 0, 0, 108, ...Buffer.from("mvhd")]);
    b.fill(0, 36, finMoov);
    v.setUint32(48, 1000, false); // timescale
    v.setUint32(52, Math.round((inicio + segundos) * 1000), false); // duration (con el hueco inicial)
    if (conPista) {
      pon(136, [0, 0, 0, 140, ...Buffer.from("trak"), 0, 0, 0, 92, ...Buffer.from("tkhd")]);
      v.setUint32(152, 3, false); // versión 0, flags: activa y en la película
      v.setUint32(164, 1, false); // track_ID
      pon(236, [0, 0, 0, 40, ...Buffer.from("mdia"), 0, 0, 0, 32, ...Buffer.from("mdhd")]);
      v.setUint32(264, 1000, false); // timescale de la pista
      v.setUint32(268, Math.round(segundos * 1000), false); // lo que dura la pista
    }
    v.setUint32(finMoov, bytes - finMoov, false);
    pon(finMoov + 4, "mdat");
  } else {
    const datos = bytes - 44;
    pon(0, "RIFF");
    v.setUint32(4, bytes - 8, true);
    pon(8, "WAVEfmt ");
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); // PCM
    v.setUint16(22, 1, true);
    v.setUint32(24, 8000, true);
    v.setUint32(28, Math.max(1, Math.round(datos / segundos)), true); // bytes por segundo
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    pon(36, "data");
    v.setUint32(40, datos, true);
  }
  return b;
}

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

/** Audios de `segundos` sin la duración en la cabecera (como los escribe un grabador "en vivo"); null sin ffmpeg. */
export function conFfmpegSinDuracion(segundos = 20): { nombre: string; bytes: Uint8Array }[] | null {
  const ffmpeg = ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg"].find((r) => existsSync(r));
  if (!ffmpeg) return null;
  const fuente = ["-v", "error", "-y", "-f", "lavfi", "-i", `sine=frequency=330:duration=${segundos}`, "-ac", "1"];
  const lista: [string, string[]][] = [
    ["tuberia.webm", ["-c:a", "libopus", "-b:a", "16k", "-f", "webm", "pipe:1"]], // sin Duration ni Cues
    ["fragmentado.m4a", ["-c:a", "aac", "-b:a", "32k", "-movflags", "frag_keyframe+empty_moov+default_base_moof", "-frag_duration", "1000000", "-f", "mp4", "pipe:1"]],
    ["tuberia.wav", ["-ar", "8000", "-f", "wav", "pipe:1"]], // bloque data de tamaño desconocido
    ["cbr.mp3", ["-c:a", "libmp3lame", "-b:a", "32k", "-write_xing", "0", "-f", "mp3", "pipe:1"]],
    // Fragmentado con el primer segundo en el moov (mvhd y mdhd dicen 1 s; el resto viene en fragmentos).
    ["fragmentado-con-moov.m4a", ["-c:a", "aac", "-b:a", "32k", "-movflags", "frag_keyframe", "-frag_duration", "1000000", "-f", "mp4", "pipe:1"]],
  ];
  const salida: { nombre: string; bytes: Uint8Array }[] = [];
  for (const [nombre, extra] of lista) {
    try {
      salida.push({ nombre, bytes: new Uint8Array(execFileSync(ffmpeg, [...fuente, ...extra], { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 })) });
    } catch {
      /* ese códec no está en este ffmpeg */
    }
  }
  return salida;
}

/** Copia de un MP4 fragmentado con el tfdt de cada traf corrido en `ticks` (como si partiera más tarde). */
export function desplazarTfdt(original: Uint8Array, ticks: number): Uint8Array {
  const b = new Uint8Array(original);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const cajas = (desde: number, hasta: number, fn: (tipo: string, datos: number, fin: number) => void) => {
    for (let i = desde; i + 8 <= hasta; ) {
      const tam = v.getUint32(i);
      if (tam < 8) return;
      fn(Buffer.from(b.subarray(i + 4, i + 8)).toString("latin1"), i + 8, Math.min(i + tam, hasta));
      i += tam;
    }
  };
  let corridos = 0;
  cajas(0, b.length, (t, d, f) => {
    if (t !== "moof") return;
    cajas(d, f, (t2, d2, f2) => {
      if (t2 !== "traf") return;
      cajas(d2, f2, (t3, d3) => {
        if (t3 !== "tfdt") return;
        if (b[d3] === 1) v.setBigUint64(d3 + 4, v.getBigUint64(d3 + 4) + BigInt(ticks));
        else v.setUint32(d3 + 4, v.getUint32(d3 + 4) + ticks);
        corridos++;
      });
    });
  });
  if (!corridos) throw new Error("desplazarTfdt: no hay fragmentos");
  return b;
}

/**
 * Audios de `segundos` que NO parten en 0 sino en `inicio` (null sin ffmpeg): lo que dura sigue siendo
 * `segundos`, pero las marcas de tiempo llegan a inicio + segundos. Más un MP3 VBR sin cabecera Xing que
 * parte en silencio (el primer cuadro es el más chico: su bitrate hacía creer que duraba más del triple).
 */
export function conFfmpegDesplazados(segundos = 60, inicio = 1200): { nombre: string; bytes: Uint8Array }[] | null {
  const ffmpeg = ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg"].find((r) => existsSync(r));
  if (!ffmpeg) return null;
  const dir = mkdtempSync(join(tmpdir(), "dictados-desplazados-"));
  const fuente = ["-v", "error", "-y", "-f", "lavfi", "-i", `sine=frequency=330:duration=${segundos}`, "-ac", "1"];
  const corrido = ["-output_ts_offset", String(inicio)];
  // [nombre, argumentos, a archivo (con Duration/moov) o por tubería, transformar]
  const lista: [string, string[], boolean, ((b: Uint8Array) => Uint8Array)?][] = [
    ["opus-desplazado.ogg", ["-ar", "48000", "-c:a", "libopus", "-b:a", "16k", ...corrido, "-f", "ogg"], false],
    ["vorbis-desplazado.ogg", ["-c:a", "libvorbis", "-q:a", "0", ...corrido, "-f", "ogg"], false],
    ["desplazado.webm", ["-c:a", "libopus", "-b:a", "16k", ...corrido, "-f", "webm"], true], // con Duration (= donde termina)
    ["tuberia-desplazado.webm", ["-c:a", "libopus", "-b:a", "16k", ...corrido, "-f", "webm"], false], // sin Duration
    ["desplazado.m4a", ["-c:a", "aac", "-b:a", "32k", ...corrido, "-f", "mp4"], true], // mvhd con el hueco inicial
    [
      "fragmentado-desplazado.m4a",
      ["-ar", "16000", "-c:a", "aac", "-b:a", "32k", "-movflags", "frag_keyframe+empty_moov+default_base_moof", "-frag_duration", "1000000", "-f", "mp4"],
      false,
      (b) => desplazarTfdt(b, inicio * 16_000), // ffmpeg no corre los tfdt: se corren a mano
    ],
  ];
  const salida: { nombre: string; bytes: Uint8Array }[] = [];
  for (const [nombre, extra, aArchivo, transformar] of lista) {
    try {
      const ruta = join(dir, nombre);
      const bytes = aArchivo
        ? (execFileSync(ffmpeg, [...fuente, ...extra, ruta], { stdio: "pipe" }), new Uint8Array(readFileSync(ruta)))
        : new Uint8Array(execFileSync(ffmpeg, [...fuente, ...extra, "pipe:1"], { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 }));
      salida.push({ nombre, bytes: transformar ? transformar(bytes) : bytes });
    } catch {
      /* ese códec no está en este ffmpeg: se omite */
    }
  }
  try {
    const vbr = execFileSync(
      ffmpeg,
      ["-v", "error", "-y", "-f", "lavfi", "-i", `aevalsrc=exprs='if(lt(t,3),0,0.4*sin(2*PI*330*t)+0.4*(random(0)-0.5))':d=${segundos}:s=44100`, "-ac", "1"]
        .concat(["-c:a", "libmp3lame", "-q:a", "0", "-write_xing", "0", "-f", "mp3", "pipe:1"]),
      { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 },
    );
    salida.push({ nombre: "vbr-sin-xing.mp3", bytes: new Uint8Array(vbr) });
  } catch {
    /* sin libmp3lame */
  }
  return salida;
}
