// Lo que «🎙️ Dictadas» hace solo, fuera de React y para toda la app. Lo enciende el Panel
// (components/App.tsx, con useMotorDictados) cuando hay nube, así corre aunque la pestaña Recetas no esté
// abierta (en la pared, el panel vuelve solo al calendario a los 5 minutos):
// - mira la lista al encenderse, al volver a la app, al volver internet y después de cada acción; mientras
//   algo esté en cola, con Gemini o subiéndose, cada 20 s (y, si hay un error con hora, a esa hora);
// - sube los audios que quedaron en el equipo (de a uno; nunca dos veces el mismo en esta pestaña), también
//   los que dejó la ventana de dictar sin red o con «lleno»: pendientes.ts y cliente.ts le avisan cada cambio
//   y cada subida que termina;
// - vuelve a pedir «procesar» sola, una vez por cada (id, actualizado), según debeReintentar();
// - marca como guardados (POST /guardado) los dictados cuya receta (rec_<id>) la nube ya confirmó
//   (porLimpiar): que la app la muestre no basta, puede ser el cambio optimista de un guardado que no llegó.
// La pantalla (useDictados) lee este mismo estado y usa estas mismas acciones. Lo que decide va en
// funciones puras (reglas.ts); el motor lo prueba pruebas/recetas/cliente.test.ts contra el servidor.

import { SinConexion } from "../datos/nube";
import * as cliente from "./cliente";
import type { EventoSubida, ResultadoDescarte, ResultadoSubida } from "./cliente";
import * as pendientes from "./pendientes";
import type { ResumenLocal } from "./pendientes";
import { CADA_LOCALES_MS, debeReintentar, porLimpiar, proximaRevision, recetasConfirmadas, subeSolo } from "./reglas";
import { MAX_PENDIENTES, type DictadoPublico, type ListaDictados } from "./tipos";

export interface EstadoMotor {
  /** La lista de la nube (null: todavía no se lee). */
  lista: ListaDictados | null;
  /** Audios que siguen sólo en este equipo. */
  locales: ResumenLocal[];
  /** Ids que se están subiendo ahora desde esta pestaña. */
  subiendo: string[];
  /** La última vez no se pudo hablar con la nube. */
  sinConexion: boolean;
}

type Escuchable = Pick<EventTarget, "addEventListener" | "removeEventListener">;

export interface EntornoMotor {
  /** Ids de las recetas que muestra la app ahora (con lo optimista). */
  recetaIds: () => Set<string>;
  /** Ids de las recetas que la nube confirmó; null: no se sabe. Por omisión, recetasConfirmadas(). */
  confirmadas?: () => Set<string> | null;
  /** Donde llega "online" (por omisión window; null: ninguno). */
  ventana?: Escuchable | null;
  /** Donde llega "visibilitychange" (por omisión document; null: ninguno). */
  documento?: (Escuchable & { visibilityState?: string }) | null;
  ahora?: () => number;
  ponerTemporizador?: (fn: () => void, ms: number) => unknown;
  quitarTemporizador?: (t: unknown) => void;
  /** Esperas entre intentos de cada subida (por omisión las de subirPendiente). */
  esperasSubida?: number[];
}

export interface Motor {
  /** El estado de ahora (el mismo objeto hasta que algo cambie: sirve para useSyncExternalStore). */
  leer(): EstadoMotor;
  suscribir(fn: () => void): () => void;
  /** Empieza lo automático. Devuelve cómo apagarlo (se olvida la lista; lo que estaba en vuelo no escribe). */
  encender(e: EntornoMotor): () => void;
  readonly encendido: boolean;
  /** En cuántos ms está puesta la próxima mirada (null: ninguna). */
  readonly proxima: number | null;
  /** Mira la lista y hace lo que toque (sin encender, nada). */
  refrescar(): Promise<void>;
  /** «Intentar de nuevo» / (otraVez) «Pedir otra versión». null: ya no existe. Lanza RechazoDictado o SinConexion. */
  procesar(id: string, otraVez?: boolean): Promise<DictadoPublico | null>;
  /** Descarta el borrador en la nube y en el equipo. "guardada": otro equipo ya la guardó (no se borró nada). */
  descartar(id: string): Promise<ResultadoDescarte>;
  /** Sube los audios del equipo que se suben solos. Devuelve cuántos subió. */
  subirLocales(): Promise<number>;
  /** «Subir ahora» (también uno que la nube rechazó antes). null: ya no está en el equipo. */
  subirLocal(id: string): Promise<ResultadoSubida | null>;
}

const INICIAL: EstadoMotor = { lista: null, locales: [], subiendo: [], sinConexion: false };

export function crearMotor(): Motor {
  let estado = INICIAL;
  const oyentes = new Set<() => void>();
  let entorno: EntornoMotor | null = null;
  let apagarOyentes: (() => void) | null = null;
  /** Cambia al apagar: lo que estaba en vuelo no escribe en el estado de después. */
  let generacion = 0;
  const pedidos = new Set<string>(); // `${id}|${actualizado}` que ya se pidieron solos
  const veces = new Map<string, number>();
  const limpiados = new Set<string>();
  let corriendo: Promise<void> | null = null;
  let otraVuelta = false;
  let subidaEnCurso: Promise<number> | null = null;
  /** Cuándo falló por última vez una subida por falta de red (0: no falló o volvió internet). */
  let falloSubida = 0;
  let temporizador: unknown;
  let proxima: number | null = null;

  const ahora = () => entorno?.ahora?.() ?? Date.now();
  const visible = () => entorno?.documento?.visibilityState !== "hidden";

  function cambiar(parcial: Partial<EstadoMotor>) {
    estado = { ...estado, ...parcial };
    for (const f of [...oyentes]) f();
    programar();
  }

  function quitarTemporizador() {
    if (temporizador !== undefined) (entorno?.quitarTemporizador ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>)))(temporizador);
    temporizador = undefined;
    proxima = null;
  }

  /** Mientras algo está en camino (o hay un error con hora, o audios por subir), se vuelve a mirar. */
  function programar() {
    if (!entorno) return;
    quitarTemporizador();
    const hayCupo = (estado.lista?.dictados.length ?? 0) < MAX_PENDIENTES;
    const ms = proximaRevision(estado.lista?.dictados ?? [], ahora(), {
      subiendo: estado.subiendo.length > 0,
      localesPorSubir: estado.locales.some((p) => subeSolo(p, hayCupo)),
    });
    if (ms == null) return;
    const poner = entorno.ponerTemporizador ?? ((fn, t) => setTimeout(fn, t));
    proxima = ms;
    temporizador = poner(() => {
      temporizador = undefined;
      proxima = null;
      if (visible()) void refrescar();
    }, ms);
  }

  async function leerLocales(): Promise<ResumenLocal[]> {
    const g = generacion;
    const l = await pendientes.resumenes();
    if (g === generacion && JSON.stringify(l) !== JSON.stringify(estado.locales)) cambiar({ locales: l });
    return l;
  }

  async function subirUno(id: string): Promise<ResultadoSubida | null> {
    const p = await pendientes.leer(id);
    if (!p) return null;
    return cliente.subirPendiente(p, entorno?.esperasSubida ? { esperas: entorno.esperasSubida } : {});
  }

  /** Marca como guardados los listos cuya receta la nube ya tiene (si no se puede, en la próxima vuelta). */
  function limpiar(dictados: DictadoPublico[]) {
    if (!entorno) return;
    const g = generacion;
    const confirmadas = entorno.confirmadas ? entorno.confirmadas() : recetasConfirmadas();
    for (const d of porLimpiar(dictados, entorno.recetaIds(), confirmadas)) {
      if (limpiados.has(d.id)) continue;
      limpiados.add(d.id);
      cliente.marcarGuardado(d.id, `rec_${d.id}`).then(
        (hecho) => {
          // false: la nube todavía no tiene la receta (409 RECETA_NO_GUARDADA): se reintenta en la próxima vuelta.
          if (!hecho) return void limpiados.delete(d.id);
          const l = estado.lista;
          if (g === generacion && l) cambiar({ lista: { ...l, dictados: l.dictados.filter((x) => x.id !== d.id) } });
        },
        () => void limpiados.delete(d.id),
      );
    }
  }

  function subirLocales(): Promise<number> {
    if (subidaEnCurso) return subidaEnCurso;
    const g = generacion;
    subidaEnCurso = (async () => {
      let subidos = 0;
      try {
        const hayCupo = (estado.lista?.dictados.length ?? 0) < MAX_PENDIENTES;
        for (const p of await pendientes.resumenes()) {
          if (g !== generacion) break;
          if (cliente.subiendo(p.id) || !subeSolo(p, hayCupo)) continue;
          const r = await subirUno(p.id).catch(() => null);
          if (r?.ok) subidos++;
          else if (r && r.motivo === "sin_conexion") break; // sin red no tiene sentido seguir con los demás
        }
      } finally {
        if (g === generacion) await leerLocales();
      }
      return subidos;
    })().finally(() => (subidaEnCurso = null));
    return subidaEnCurso;
  }

  async function vuelta() {
    const g = generacion;
    const ls = await leerLocales();
    let l: ListaDictados;
    try {
      l = await cliente.listarDictados();
    } catch (e) {
      if (g === generacion) cambiar({ sinConexion: e instanceof SinConexion });
      return;
    }
    if (g !== generacion) return;
    cambiar({ lista: l, sinConexion: false });
    limpiar(l.dictados);
    // Reintentos solos.
    const t = ahora();
    const cambiados = new Map<string, DictadoPublico | null>();
    for (const d of l.dictados) {
      const k = `${d.id}|${d.actualizado}`;
      const n = veces.get(d.id) ?? 0;
      if (pedidos.has(k) || !debeReintentar(d, t, l.gemini, n)) continue;
      pedidos.add(k);
      veces.set(d.id, n + 1);
      try {
        cambiados.set(d.id, await cliente.procesarDictado(d.id));
      } catch {
        /* se vuelve a mirar en la próxima vuelta */
      }
    }
    if (cambiados.size && g === generacion) {
      const actual = estado.lista ?? l;
      cambiar({
        lista: {
          ...actual,
          dictados: actual.dictados.flatMap((d) => {
            if (!cambiados.has(d.id)) return [d];
            const c = cambiados.get(d.id);
            return c ? [c] : [];
          }),
        },
      });
    }
    // Lo que quedó en el equipo (si recién falló por falta de red, se espera un rato o a que vuelva internet).
    const hayCupo = l.dictados.length < MAX_PENDIENTES;
    const toca = ahora() - falloSubida >= CADA_LOCALES_MS;
    if (toca && ls.some((p) => !cliente.subiendo(p.id) && subeSolo(p, hayCupo)))
      void subirLocales().then((n) => {
        if (n) void refrescar();
      });
  }

  function refrescar(): Promise<void> {
    if (!entorno) return Promise.resolve();
    if (corriendo) {
      otraVuelta = true;
      return corriendo;
    }
    const g = generacion;
    const c = (async () => {
      do {
        otraVuelta = false;
        await vuelta();
      } while (otraVuelta && g === generacion);
    })().finally(() => {
      if (corriendo === c) corriendo = null;
    });
    corriendo = c;
    return c;
  }

  /** Una subida de esta pestaña empezó o terminó (la de la ventana de dictar, la de «Subir ahora» o una sola). */
  function alSubir(e: EventoSubida) {
    if (e.fase === "termina") {
      if (e.resultado?.ok) falloSubida = 0;
      else if (e.resultado?.motivo === "sin_conexion") falloSubida = ahora(); // se reintenta en CADA_LOCALES_MS o al volver internet
    }
    cambiar({ subiendo: cliente.subiendoAhora() });
    if (e.fase === "termina") {
      void leerLocales();
      if (e.resultado?.ok) void refrescar(); // ya está en la nube: que aparezca en la lista
    }
  }

  function encender(e: EntornoMotor): () => void {
    if (entorno) apagar();
    const ventana = e.ventana !== undefined ? e.ventana : typeof window !== "undefined" ? window : null;
    const documento = e.documento !== undefined ? e.documento : typeof document !== "undefined" ? document : null;
    entorno = { ...e, ventana, documento };
    const alVolver = () => {
      if (visible()) void refrescar();
    };
    const alVolverInternet = () => {
      falloSubida = 0;
      alVolver();
    };
    documento?.addEventListener("visibilitychange", alVolver);
    ventana?.addEventListener("online", alVolverInternet);
    const sinSubidas = cliente.alCambiarSubidas(alSubir);
    const sinPendientes = pendientes.alCambiar(() => void leerLocales());
    apagarOyentes = () => {
      documento?.removeEventListener("visibilitychange", alVolver);
      ventana?.removeEventListener("online", alVolverInternet);
      sinSubidas();
      sinPendientes();
    };
    cambiar({ ...INICIAL, subiendo: cliente.subiendoAhora() });
    void refrescar();
    const g = generacion;
    return () => {
      if (g === generacion && entorno) apagar();
    };
  }

  function apagar() {
    quitarTemporizador();
    apagarOyentes?.();
    apagarOyentes = null;
    entorno = null;
    generacion++;
    corriendo = null;
    otraVuelta = false;
    subidaEnCurso = null;
    falloSubida = 0;
    cambiar(INICIAL);
  }

  async function procesar(id: string, otraVez = false) {
    const r = await cliente.procesarDictado(id, otraVez);
    const l = estado.lista;
    if (l) cambiar({ lista: { ...l, dictados: r ? l.dictados.map((d) => (d.id === id ? r : d)) : l.dictados.filter((d) => d.id !== id) } });
    void refrescar();
    return r;
  }

  async function descartar(id: string): Promise<ResultadoDescarte> {
    const enNube = estado.lista?.dictados.some((d) => d.id === id) ?? true;
    let r: ResultadoDescarte = "descartado";
    try {
      r = await cliente.descartarBorrador(id);
    } catch (e) {
      // Un audio que nunca llegó a la nube ya quedó descartado al borrar la copia del equipo.
      if (!(e instanceof SinConexion) || enNube) throw e;
    }
    const l = estado.lista;
    if (l) cambiar({ lista: { ...l, dictados: l.dictados.filter((d) => d.id !== id) } });
    await leerLocales();
    void refrescar();
    return r;
  }

  async function subirLocal(id: string) {
    const r = await subirUno(id);
    await leerLocales();
    void refrescar();
    return r;
  }

  return {
    leer: () => estado,
    suscribir(fn) {
      oyentes.add(fn);
      return () => void oyentes.delete(fn);
    },
    encender,
    get encendido() {
      return entorno !== null;
    },
    get proxima() {
      return proxima;
    },
    refrescar,
    procesar,
    descartar,
    subirLocales,
    subirLocal,
  };
}

/** El de la app: uno por pestaña (lo enciende el Panel; la pantalla de Recetas lo lee). */
export const motorDictados = crearMotor();
