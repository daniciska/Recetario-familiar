// Grabadora de «🎙️ Dictar receta» con MediaRecorder, sin dependencias. Basada en el prototipo probado en
// Chrome (SP/audio-navegador/grabadora.js); lo de iOS sale del código de WebKit y está por confirmar en un
// iPhone real (ver RIESGOS-recetas.md).
//
// - WebM/Opus primero (Chrome, Android, Safari ≥ 18.4); MP4/AAC si no (Safari 14.5–18.3).
// - Siempre con audioBitsPerSecond (32 kbps Opus ≈ 0,24 MB/min; 64 kbps AAC ≈ 0,48 MB/min): sin eso Safari
//   graba a 192 kbps.
// - start(1000) y se juntan TODOS los trozos al final (sólo el primero trae la cabecera; sin timeslice
//   Safari deja MP4 truncados).
// - La duración la lleva un reloj propio que no cuenta las pausas (el WebM de Chrome dice Infinity).
// - Se pausa sola si la app pasa a segundo plano o el micrófono se silencia (llamada, otra app: iOS lo
//   corta) y avisa «interrumpida». Pide Wake Lock para que no se apague la pantalla.
// - Avisa tras GRABACION_SILENCIO_SEG de silencio y cuando quedan 2 minutos (a los GRABACION_AVISO_SEG o cerca
//   de GRABACION_MAX_BYTES); se corta sola a los GRABACION_MAX_SEG o al llegar a GRABACION_MAX_BYTES.

import { GRABACION_AVISO_SEG, GRABACION_MAX_BYTES, GRABACION_MAX_SEG, GRABACION_SILENCIO_SEG, MAX_SEGUNDOS } from "./tipos";

export const TIPOS_GRABACION = ["audio/webm;codecs=opus", "audio/mp4;codecs=mp4a.40.2", "audio/mp4"];

/** El primer tipo que el navegador sabe grabar ("" = que elija él; null = no puede grabar). */
export function tipoGrabacion(soporta: (t: string) => boolean = (t) => MediaRecorder.isTypeSupported(t)): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const t of TIPOS_GRABACION) {
    try {
      if (soporta(t)) return t;
    } catch {
      /* isTypeSupported puede lanzar en navegadores viejos */
    }
  }
  return "";
}

/** Bits por segundo que se piden: 32 kbps para Opus (o si elige el navegador), 64 kbps para AAC. */
export const bitsPara = (tipo: string) => (/mp4|aac/i.test(tipo) && !/opus/i.test(tipo) ? 64_000 : 32_000);

export const puedeGrabar = () =>
  typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

/** iPhone, iPad o iPod (también el iPad que se presenta como Mac). */
export function esIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

/**
 * `accept` del <input type="file">: en iOS sin `accept` (con "audio/*" el selector no deja elegir el .opus
 * de WhatsApp desde Archivos); en los demás, "audio/*".
 */
export const aceptarArchivos = (): string | undefined => (esIOS() ? undefined : "audio/*");

/** Duración de un archivo elegido, si el navegador sabe leerla (si no, undefined: no se revisa). */
export function duracionArchivo(archivo: Blob, espera = 4000): Promise<number | undefined> {
  return new Promise((ok) => {
    let url = "";
    let listo = false;
    const fin = (v?: number) => {
      if (listo) return;
      listo = true;
      if (url) URL.revokeObjectURL(url);
      ok(v && Number.isFinite(v) && v > 0 ? v : undefined);
    };
    try {
      url = URL.createObjectURL(archivo);
      const a = new Audio();
      a.preload = "metadata";
      a.onloadedmetadata = () => fin(a.duration);
      a.onerror = () => fin();
      setTimeout(() => fin(), espera);
      a.src = url;
    } catch {
      fin();
    }
  });
}

/** ¿Pasa el tope de duración del servidor? (sin duración conocida, no se revisa). */
export const muyLargo = (segundos: number | undefined) => segundos != null && segundos > MAX_SEGUNDOS;

// ---------- Grabadora ----------

export type EstadoGrabadora = "inactiva" | "grabando" | "pausa" | "terminada";
/** silencio: no se escucha nada · quedan_dos: faltan ~2 min · maximo: se cortó sola (llamar a terminar()) · interrumpida: se pausó sola. */
export type AvisoGrabadora = "silencio" | "quedan_dos" | "maximo" | "interrumpida";

export interface Grabacion {
  blob: Blob;
  mime: string; // sin parámetros ("audio/webm")
  segundos: number; // redondeado, sin las pausas
}

export interface OpcionesGrabadora {
  alNivel?: (nivel: number) => void; // 0–1, varias veces por segundo
  alTiempo?: (segundos: number) => void; // cada segundo grabado
  alAviso?: (a: AvisoGrabadora) => void;
  alEstado?: (e: EstadoGrabadora) => void;
}

export interface Grabadora {
  readonly estado: EstadoGrabadora;
  readonly segundos: number;
  readonly bytes: number;
  /** Llamarla dentro del toque en «Empezar a grabar» (en la app de inicio de iOS el permiso dura esa apertura). */
  empezar(): Promise<void>;
  pausar(): void;
  seguir(): void;
  /** Junta los trozos y apaga el micrófono. Se puede llamar varias veces: da siempre lo mismo. */
  terminar(): Promise<Grabacion>;
  cancelar(): void;
}

/** permiso: el usuario o el sistema no dieron el micrófono · sin_microfono · sin_soporte: no hay MediaRecorder · otro. */
export type MotivoGrabadora = "permiso" | "sin_microfono" | "sin_soporte" | "otro";
export class ErrorGrabadora extends Error {
  motivo: MotivoGrabadora;
  constructor(motivo: MotivoGrabadora, mensaje?: string) {
    super(mensaje ?? motivo);
    this.motivo = motivo;
  }
}

const NIVEL_SONIDO = 0.04; // bajo esto (RMS × 4) es silencio
const TIC_MS = 250;

export function crearGrabadora(op: OpcionesGrabadora = {}): Grabadora {
  let estado: EstadoGrabadora = "inactiva";
  let rec: MediaRecorder | undefined;
  let flujo: MediaStream | undefined;
  let ctx: AudioContext | undefined;
  let analizador: AnalyserNode | undefined;
  let tic: ReturnType<typeof setInterval> | undefined;
  let pantalla: { release: () => Promise<void> } | null = null;
  let tipo = "";
  const trozos: Blob[] = [];
  let bytes = 0;
  let acumulado = 0; // ms grabados antes de la última reanudación
  let desde = 0; // performance.now() de la última reanudación
  let ultimoSegundo = -1;
  let ultimoSonido = 0; // segundos grabados cuando se escuchó algo por última vez
  let avisoSilencio = false;
  let avisoDos = false;
  let terminando: Promise<Grabacion> | null = null;
  let cerrando = false; // terminar() ya empezó: no se cuenta más tiempo ni se pausa o sigue
  let alParar: (() => void) | null = null;

  const segundos = () => (acumulado + (estado === "grabando" && !cerrando ? performance.now() - desde : 0)) / 1000;
  const cambiar = (e: EstadoGrabadora) => {
    if (estado === e) return;
    estado = e;
    op.alEstado?.(e);
  };

  const alSalir = () => {
    if (document.hidden) {
      if (estado === "grabando") interrumpir();
    } else void pedirPantalla();
  };
  const alSilenciar = () => {
    if (estado === "grabando") interrumpir();
  };

  function interrumpir() {
    pausar();
    op.alAviso?.("interrumpida");
  }

  async function pedirPantalla() {
    try {
      const wl = (navigator as unknown as { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock;
      if (wl && !document.hidden && !pantalla) pantalla = await wl.request("screen");
    } catch {
      /* se puede apagar la pantalla: se pausa sola y se sigue al volver */
    }
  }

  function nivel(): number {
    if (!analizador) return 0;
    const d = new Uint8Array(analizador.fftSize);
    analizador.getByteTimeDomainData(d);
    let suma = 0;
    for (const v of d) suma += ((v - 128) / 128) ** 2;
    return Math.min(1, Math.sqrt(suma / d.length) * 4);
  }

  function revisar() {
    if (estado !== "grabando" || cerrando) return;
    const s = segundos();
    const n = nivel();
    op.alNivel?.(n);
    if (Math.floor(s) !== ultimoSegundo) {
      ultimoSegundo = Math.floor(s);
      op.alTiempo?.(ultimoSegundo);
    }
    if (analizador) {
      if (n >= NIVEL_SONIDO) {
        ultimoSonido = s;
        avisoSilencio = false;
      } else if (!avisoSilencio && s - ultimoSonido >= GRABACION_SILENCIO_SEG) {
        avisoSilencio = true;
        op.alAviso?.("silencio");
      }
    }
    // Quedan ~2 minutos: por tiempo o porque, a este ritmo, en 2 minutos se llega al tope de bytes.
    const ritmo = s > 5 ? bytes / s : 0;
    if (!avisoDos && (s >= GRABACION_AVISO_SEG || (ritmo && bytes + ritmo * 120 >= GRABACION_MAX_BYTES))) {
      avisoDos = true;
      op.alAviso?.("quedan_dos");
    }
    if (s >= GRABACION_MAX_SEG || bytes >= GRABACION_MAX_BYTES) {
      void terminar();
      op.alAviso?.("maximo");
    }
  }

  function limpiar() {
    clearInterval(tic);
    tic = undefined;
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", alSalir);
    flujo?.getTracks().forEach((t) => {
      t.removeEventListener("mute", alSilenciar);
      t.stop();
    });
    flujo = undefined;
    void ctx?.close().catch(() => {});
    ctx = undefined;
    analizador = undefined;
    void pantalla?.release().catch(() => {});
    pantalla = null;
  }

  async function empezar() {
    if (estado !== "inactiva") return;
    if (!puedeGrabar()) throw new ErrorGrabadora("sin_soporte");
    // El AudioContext se crea dentro del toque (si no, Safari lo deja suspendido).
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC) ctx = new AC();
      void ctx?.resume().catch(() => {});
    } catch {
      ctx = undefined; // sin barra de nivel ni aviso de silencio
    }
    try {
      flujo = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      limpiar();
      const n = (e as { name?: string })?.name;
      if (n === "NotAllowedError" || n === "SecurityError") throw new ErrorGrabadora("permiso", String((e as Error)?.message ?? n));
      if (n === "NotFoundError" || n === "OverconstrainedError" || n === "NotReadableError") throw new ErrorGrabadora("sin_microfono", String((e as Error)?.message ?? n));
      throw new ErrorGrabadora("otro", String((e as Error)?.message ?? e));
    }
    try {
      if (ctx) {
        analizador = ctx.createAnalyser();
        analizador.fftSize = 1024;
        ctx.createMediaStreamSource(flujo).connect(analizador);
      }
    } catch {
      analizador = undefined;
    }
    for (const t of flujo.getAudioTracks()) t.addEventListener("mute", alSilenciar);
    const elegido = tipoGrabacion() ?? "";
    try {
      rec = new MediaRecorder(flujo, { ...(elegido ? { mimeType: elegido } : {}), audioBitsPerSecond: bitsPara(elegido) });
    } catch {
      try {
        rec = new MediaRecorder(flujo); // con lo que el navegador quiera
      } catch (e) {
        limpiar();
        throw new ErrorGrabadora("sin_soporte", String((e as Error)?.message ?? e));
      }
    }
    tipo = elegido;
    rec.ondataavailable = (e) => {
      if (!e.data?.size) return;
      trozos.push(e.data);
      bytes += e.data.size;
    };
    rec.onstop = () => alParar?.();
    rec.onerror = () => {
      if (estado === "grabando") interrumpir();
    };
    rec.start(1000);
    desde = performance.now();
    ultimoSonido = 0;
    cambiar("grabando");
    document.addEventListener("visibilitychange", alSalir);
    void pedirPantalla();
    tic = setInterval(revisar, TIC_MS);
    ultimoSegundo = 0;
    op.alTiempo?.(0);
  }

  function pausar() {
    if (estado !== "grabando" || !rec || cerrando) return;
    try {
      rec.pause();
    } catch {
      /* si no se puede pausar, igual se deja de contar */
    }
    acumulado += performance.now() - desde;
    cambiar("pausa");
  }

  function seguir() {
    if (estado !== "pausa" || !rec || cerrando) return;
    try {
      rec.resume();
    } catch {
      return;
    }
    desde = performance.now();
    ultimoSonido = segundos();
    avisoSilencio = false;
    cambiar("grabando");
    void pedirPantalla();
  }

  function terminar(): Promise<Grabacion> {
    if (terminando) return terminando;
    // Lo que sigue hasta el primer await corre al tiro: desde aquí no se cuenta más tiempo.
    if (estado === "grabando" && !cerrando) acumulado += performance.now() - desde;
    cerrando = true;
    clearInterval(tic);
    tic = undefined;
    const total = acumulado / 1000;
    terminando = (async () => {
      if (rec && rec.state !== "inactive") {
        // El último dataavailable llega antes de "stop".
        await new Promise<void>((ok) => {
          const t = setTimeout(ok, 3000);
          alParar = () => {
            clearTimeout(t);
            ok();
          };
          try {
            rec!.stop();
          } catch {
            clearTimeout(t);
            ok();
          }
        });
      }
      limpiar();
      const mime = (rec?.mimeType || tipo || "audio/mp4").split(";")[0].trim();
      estado = "terminada";
      op.alEstado?.("terminada");
      return { blob: new Blob(trozos, { type: mime }), mime, segundos: Math.round(total) };
    })();
    return terminando;
  }

  function cancelar() {
    if (estado === "terminada" || terminando) return; // terminar() ya está juntando los trozos
    cerrando = true;
    try {
      if (rec) rec.ondataavailable = null; // el último trozo llega después de stop(): se descarta también
      if (rec && rec.state !== "inactive") rec.stop();
    } catch {
      /* nada */
    }
    trozos.length = 0;
    bytes = 0;
    limpiar();
    cambiar("terminada");
  }

  return {
    get estado() {
      return estado;
    },
    get segundos() {
      return segundos();
    },
    get bytes() {
      return bytes;
    },
    empezar,
    pausar,
    seguir,
    terminar,
    cancelar,
  };
}
