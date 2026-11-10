// lib/dictados/grabadora.ts con un navegador falso (MediaRecorder, pistas, getUserMedia, Wake Lock y el reloj
// de performance.now), para lo que no se puede probar a mano sin trucos: cerrar la ventana mientras se espera
// el permiso del micrófono, el corte de las 15:00 que llega tarde y el micrófono que se corta solo.
//   node --experimental-transform-types --no-warnings --import ./pruebas/registrar.mjs pruebas/recetas/grabadora.test.ts
import { caso, ok, seccion, terminar } from "./arnes.ts";

// ---------- El navegador falso ----------
let ahoraMs = 0;
Object.defineProperty(globalThis, "performance", { value: { now: () => ahoraMs }, configurable: true, writable: true });
const dormir = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

class PistaFalsa extends EventTarget {
  kind = "audio";
  viva = true;
  stop() {
    this.viva = false; // como en el navegador: stop() no dispara "ended"
  }
}

const grabadoras: GrabadoraFalsa[] = [];
class GrabadoraFalsa {
  static isTypeSupported = (t: string) => t.startsWith("audio/webm");
  state: "inactive" | "recording" | "paused" = "inactive";
  mimeType = "audio/webm;codecs=opus";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  iniciada = false;
  constructor(public flujo: FlujoFalso) {
    grabadoras.push(this);
  }
  start() {
    this.state = "recording";
    this.iniciada = true;
  }
  pause() {
    if (this.state === "inactive") throw new DOMException("inactiva", "InvalidStateError");
    this.state = "paused";
  }
  resume() {
    if (this.state === "inactive") throw new DOMException("inactiva", "InvalidStateError");
    this.state = "recording";
  }
  stop() {
    if (this.state === "inactive") throw new DOMException("inactiva", "InvalidStateError");
    this.detener();
  }
  /** Como el navegador: estado "inactive" al tiro; después el último trozo y "stop". */
  detener(bytes = 10) {
    this.state = "inactive";
    setTimeout(() => {
      this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)]) });
      this.onstop?.();
    }, 5);
  }
}
(globalThis as Record<string, unknown>).MediaRecorder = GrabadoraFalsa;

class FlujoFalso {
  pistas = [new PistaFalsa()];
  getTracks = () => this.pistas;
  getAudioTracks = () => this.pistas;
}

const oyentesDoc = new Map<string, Set<() => void>>();
(globalThis as Record<string, unknown>).document = {
  hidden: false,
  visibilityState: "visible",
  addEventListener: (t: string, f: () => void) => (oyentesDoc.get(t) ?? oyentesDoc.set(t, new Set()).get(t)!).add(f),
  removeEventListener: (t: string, f: () => void) => oyentesDoc.get(t)?.delete(f),
};
(globalThis as Record<string, unknown>).window = { AudioContext: undefined };

let pedidosMic = 0;
const esperandoMic: { ok: (f: FlujoFalso) => void; mal: (e: unknown) => void }[] = [];
/** Responde todos los pedidos de micrófono que están esperando. */
const soltarMic = (f: FlujoFalso) => esperandoMic.splice(0).forEach((p) => p.ok(f));
const fallarMic = (e: unknown) => esperandoMic.splice(0).forEach((p) => p.mal(e));
let soltarPantalla: () => void = () => {};
let pantallasSueltas = 0;
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    userAgent: "prueba",
    maxTouchPoints: 0,
    mediaDevices: {
      getUserMedia: () => {
        pedidosMic++;
        return new Promise<FlujoFalso>((ok, mal) => void esperandoMic.push({ ok, mal }));
      },
    },
    wakeLock: {
      request: () =>
        new Promise((ok) => {
          soltarPantalla = () => ok({ release: async () => void pantallasSueltas++ });
        }),
    },
  },
});

const { crearGrabadora, ErrorGrabadora } = await import("../../lib/dictados/grabadora.ts");
type Aviso = Parameters<NonNullable<Parameters<typeof crearGrabadora>[0]>["alAviso"]>[0];

/** Una grabadora con todo lo que avisa anotado, ya grabando (o esperando el micrófono si `esperar`). */
async function nueva({ esperar = false } = {}) {
  const avisos: Aviso[] = [];
  const estados: string[] = [];
  const tiempos: number[] = [];
  const g = crearGrabadora({ alAviso: (a) => avisos.push(a), alEstado: (e) => estados.push(e), alTiempo: (s) => tiempos.push(s) });
  const antes = grabadoras.length;
  const empezo = g.empezar();
  const flujo = new FlujoFalso();
  if (!esperar) {
    soltarMic(flujo);
    await empezo;
  }
  return { g, avisos, estados, tiempos, empezo, flujo, pista: flujo.pistas[0], rec: () => grabadoras[antes] as GrabadoraFalsa | undefined };
}

// ---------------------------------------------------------------------------------------------
seccion("Grabar, pausar, seguir y terminar");
await caso("normal", async () => {
  ahoraMs = 0;
  const { g, rec, pista, tiempos } = await nueva();
  ok("empezar → grabando, con la grabadora iniciada y el reloj en 0", g.estado === "grabando" && rec()?.iniciada && tiempos[0] === 0);
  ahoraMs = 5000;
  g.pausar();
  ahoraMs = 15_000; // la pausa no cuenta
  g.seguir();
  ahoraMs = 18_000;
  const r = await g.terminar();
  ok("8 s grabados (sin la pausa), webm y con datos", r.segundos === 8 && r.mime === "audio/webm" && r.blob.size === 10, { ...r, blob: r.blob.size });
  ok("el micrófono quedó apagado", !pista.viva && g.estado === "terminada");
  ok("terminar() otra vez da lo mismo", (await g.terminar()) === r);
});

// ---------------------------------------------------------------------------------------------
seccion("Cerrar mientras se espera el micrófono (hallazgos 13 y 22)");
await caso("cancelar durante empezar", async () => {
  ahoraMs = 0;
  const { g, empezo, flujo, pista, rec, tiempos } = await nueva({ esperar: true });
  const visibilidadAntes = oyentesDoc.get("visibilitychange")?.size ?? 0;
  g.cancelar(); // la ventana se cerró: DictarReceta llama a cancelar() al desmontarse
  ok("cancelar → terminada", g.estado === "terminada");
  soltarMic(flujo); // el permiso o el micrófono llegan después
  let e: unknown;
  await empezo.catch((x) => (e = x));
  ok("empezar() lanza ErrorGrabadora «cancelada»", e instanceof ErrorGrabadora && e.motivo === "otro" && e.message === "cancelada", String(e));
  ok("la pista que llegó tarde se apaga al tiro", !pista.viva);
  ok("no se crea ni se inicia la grabadora", !rec()?.iniciada);
  await dormir(300);
  ok("sigue terminada, sin reloj corriendo ni escuchar visibilitychange", g.estado === "terminada" && tiempos.length === 0 && (oyentesDoc.get("visibilitychange")?.size ?? 0) === visibilidadAntes);
});
await caso("terminar durante empezar", async () => {
  const { g, empezo, flujo, pista } = await nueva({ esperar: true });
  const r = await g.terminar();
  ok("terminar() antes de tener micrófono entrega una grabación vacía", r.blob.size === 0 && r.segundos === 0);
  soltarMic(flujo);
  await empezo.catch(() => {});
  ok("…y el micrófono que llega después se apaga", !pista.viva && g.estado === "terminada");
});
await caso("dos toques en «Empezar»", async () => {
  const antes = pedidosMic;
  const g = crearGrabadora();
  const a = g.empezar();
  const b = g.empezar();
  ok("la misma promesa y un solo pedido de micrófono", a === b && pedidosMic === antes + 1);
  soltarMic(new FlujoFalso());
  await a;
  ok("graba", g.estado === "grabando");
  g.cancelar();
});
await caso("sin permiso se puede volver a intentar", async () => {
  const g = crearGrabadora();
  const a = g.empezar();
  fallarMic(Object.assign(new Error("no"), { name: "NotAllowedError" }));
  let e: unknown;
  await a.catch((x) => (e = x));
  ok("permiso negado → ErrorGrabadora «permiso»", e instanceof ErrorGrabadora && e.motivo === "permiso");
  const b = g.empezar();
  ok("otro toque vuelve a pedir el micrófono", b !== a);
  soltarMic(new FlujoFalso());
  await b;
  ok("…y graba", g.estado === "grabando");
  g.cancelar();
});
await caso("Wake Lock que llega después de cancelar", async () => {
  const antes = pantallasSueltas;
  const { g } = await nueva();
  g.cancelar();
  soltarPantalla();
  await dormir(5);
  ok("se suelta (la pantalla no queda encendida para siempre)", pantallasSueltas === antes + 1);
});

// ---------------------------------------------------------------------------------------------
seccion("El corte de las 15:00 nunca manda más de 900 s (hallazgo 14)");
await caso("corte tardío", async () => {
  ahoraMs = 0;
  const { g, avisos } = await nueva();
  ahoraMs = 900_600; // el tic de 250 ms llegó 0,6 s tarde (hilo ocupado)
  await dormir(300);
  ok("se cortó sola y avisó «maximo»", avisos.includes("maximo"), avisos);
  const r = await g.terminar();
  ok("segundos = 900 (no 901, que el servidor rechaza con 413)", r.segundos === 900, r.segundos);
});
await caso("terminar a mano pasado el tope", async () => {
  ahoraMs = 0;
  const { g } = await nueva();
  ahoraMs = 905_000;
  const r = await g.terminar();
  ok("también queda en 900", r.segundos === 900, r.segundos);
});

// ---------------------------------------------------------------------------------------------
seccion("El micrófono se corta solo (hallazgo 15)");
await caso("la grabadora se detiene sola", async () => {
  ahoraMs = 0;
  const { g, avisos, estados, rec, pista } = await nueva();
  ahoraMs = 60_000;
  rec()!.detener(); // el navegador la detiene (p. ej. terminó la pista)
  await dormir(20);
  ok("avisa «cortada» y sale de «grabando»", avisos.includes("cortada") && g.estado === "terminada" && estados.at(-1) === "terminada", { avisos, estado: g.estado });
  ahoraMs = 120_000;
  ok("el reloj se detuvo en 60 s", Math.round(g.segundos) === 60, g.segundos);
  const r = await g.terminar();
  ok("terminar() entrega lo grabado hasta ahí", r.segundos === 60 && r.blob.size === 10, { segundos: r.segundos, bytes: r.blob.size });
  ok("el micrófono quedó apagado", !pista.viva);
});
await caso("se desconecta el micrófono (la pista termina)", async () => {
  ahoraMs = 0;
  const { g, avisos, pista, rec } = await nueva();
  ahoraMs = 30_000;
  // Como el navegador: la grabadora queda inactiva y la pista avisa "ended" antes del último trozo y del "stop".
  rec()!.detener(25);
  pista.viva = false;
  pista.dispatchEvent(new Event("ended"));
  ok("avisa «cortada» al tiro", avisos.includes("cortada"), avisos);
  const r = await g.terminar();
  ok("espera el último trozo: lo grabado no se pierde", r.blob.size === 25 && r.segundos === 30, { bytes: r.blob.size, segundos: r.segundos });
});
await caso("la pista termina con la grabadora todavía grabando", async () => {
  ahoraMs = 0;
  const { g, avisos, pista } = await nueva();
  ahoraMs = 12_000;
  pista.dispatchEvent(new Event("ended"));
  const r = await g.terminar();
  ok("se detiene, avisa y entrega lo grabado", avisos.includes("cortada") && r.blob.size === 10 && r.segundos === 12, { avisos, bytes: r.blob.size });
});
await caso("«Seguir» cuando la grabadora ya no está", async () => {
  ahoraMs = 0;
  const { g, avisos, rec } = await nueva();
  ahoraMs = 20_000;
  g.pausar();
  rec()!.state = "inactive"; // se cayó en la pausa sin avisar
  g.seguir();
  ok("no se queda en «pausa» sin decir nada: avisa «cortada»", avisos.includes("cortada"), avisos);
  const r = await g.terminar();
  ok("…y entrega lo grabado (20 s)", r.segundos === 20 && g.estado === "terminada", r.segundos);
});
await caso("un error de MediaRecorder", async () => {
  const { g, avisos, rec } = await nueva();
  rec()!.onerror?.();
  ok("termina con lo que hay y avisa «cortada»", avisos.includes("cortada"), avisos);
  await g.terminar();
  ok("terminada", g.estado === "terminada");
});
await caso("cancelar no se toma como corte", async () => {
  const { g, avisos } = await nueva();
  g.cancelar();
  await dormir(20);
  ok("sin aviso «cortada»", !avisos.includes("cortada") && g.estado === "terminada", avisos);
});

await terminar();
