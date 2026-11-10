"use client";

// Ventana «🎙️ Dictar receta»: grabar en el panel (MediaRecorder) o subir una nota de voz → copia en este
// equipo (IndexedDB) → subida a la nube (PUT idempotente) → Gemini en una función en segundo plano →
// borrador que se revisa en el editor de recetas. Desde que el audio quedó guardado se puede cerrar: la
// subida sigue sola (lib/dictados/cliente.ts y lib/dictados/motor.ts) y el resultado aparece en Recetas →
// 🎙️ Dictadas. Mientras el audio está sólo en esta ventana (grabando, juntando lo grabado, guardando la
// copia, o sin copia en el equipo y sin llegar a la nube), cerrar espera a que se guarde o pregunta antes.

import { useCallback, useEffect, useRef, useState } from "react";
import { useDatos } from "@/lib/store";
import { AccesoRevocado } from "@/lib/datos/nube";
import * as cliente from "@/lib/dictados/cliente";
import type { ResultadoSubida } from "@/lib/dictados/cliente";
import {
  aceptarArchivos,
  crearGrabadora,
  duracionArchivo,
  esIOS,
  muyLargo,
  puedeGrabar,
  type AvisoGrabadora,
  type EstadoGrabadora,
  type Grabacion,
  type Grabadora,
  ErrorGrabadora,
} from "@/lib/dictados/grabadora";
import * as pendientes from "@/lib/dictados/pendientes";
import type { PendienteLocal } from "@/lib/dictados/pendientes";
import {
  CHIPS,
  TEXTOS,
  botonesDictado,
  mensajeError,
  mmss,
  otraVersionDaLoMismo,
  revisarSinRed,
  sePuedeRevisar,
  situacion,
  textoMicrofono,
  textoOtraVersionFallo,
  vistaAvance,
  type Situacion,
  type SubidaVista,
} from "@/lib/dictados/textos";
import { GRABACION_MIN_SEG, MAX_AUDIO, type DictadoPublico } from "@/lib/dictados/tipos";
import { mensajeNube, VerLoQueSeDijo } from "./Escuchar";
import { Boton, Modal, cx } from "./ui";

type Fase = "inicio" | "grabando" | "avance";
/** Cómo va la subida a la nube. */
type Subida = SubidaVista;
/** La grabación se cortó sola: a los 15:00 (o por tamaño) o porque el micrófono se cortó. */
type Corte = "maximo" | "cortada";

const NIVEL_SONIDO = 0.04;

/** Consultar el dictado: a los 2 s, cada 3 s hasta el segundo 60 y después cada 10 s. */
const esperaConsulta = (n: number, desde: number) => (n === 0 ? 2000 : Date.now() - desde < 60_000 ? 3000 : 10_000);

/** Sin permiso: los pasos del iPhone o iPad, o los de Chrome, Silk y Fully Kiosk (tablet Android o Fire). */
const textoGrabadora = (e: unknown) => textoMicrofono(e instanceof ErrorGrabadora ? e.motivo : "otro", esIOS());

const extension = (mime: string) =>
  ({ "audio/webm": "webm", "audio/mp4": "m4a", "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/aac": "aac", "audio/flac": "flac" })[
    mime.split(";")[0]
  ] ?? "audio";

/** «📤 Guardar una copia en Archivos»: con la hoja de compartir (iPhone) o como descarga. */
async function guardarCopia(p: PendienteLocal) {
  const nombre = p.archivo ?? `receta-dictada-${p.creado.slice(0, 16).replace(/[:T]/g, "-")}.${extension(p.mime)}`;
  const f = new File([p.blob], nombre, { type: p.mime || p.blob.type });
  try {
    if (navigator.canShare?.({ files: [f] })) {
      await navigator.share({ files: [f] });
      return;
    }
  } catch {
    /* canceló o no se pudo: se descarga */
  }
  const url = URL.createObjectURL(f);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export default function DictarReceta({
  alCerrar,
  alRevisar,
  alCambiar,
}: {
  alCerrar: () => void;
  /** «Revisar receta»: el dictado completo, con su borrador. */
  alRevisar: (d: DictadoPublico) => void;
  /** Algo cambió en la nube (subió, se descartó): la lista de Dictadas se vuelve a mirar. */
  alCambiar?: () => void;
}) {
  const { nube } = useDatos();
  const conNube = !!nube;
  const [fase, setFase] = useState<Fase>("inicio");
  const [aviso, setAviso] = useState<string | null>(null);
  const [geminiFalta, setGeminiFalta] = useState(false);
  const [iniciando, setIniciando] = useState(false);
  // Grabando
  const grab = useRef<Grabadora | null>(null);
  const [estadoGrab, setEstadoGrab] = useState<EstadoGrabadora>("inactiva");
  const [segundos, setSegundos] = useState(0);
  const [nivel, setNivel] = useState(0);
  const [avisoGrab, setAvisoGrab] = useState<AvisoGrabadora | null>(null);
  const [confirmarCierre, setConfirmarCierre] = useState(false);
  const [corte, setCorte] = useState<Corte | null>(null);
  // Entre «Terminar» y tener el audio (MediaRecorder entrega el último trozo al detenerse: hasta 3 s).
  const [terminando, setTerminando] = useState(false);
  const terminandoRef = useRef(false);
  /** Se pidió cerrar mientras se juntaba lo grabado o se guardaba la copia: se cierra apenas esté guardado. */
  const [cerrarAlGuardar, setCerrarAlGuardar] = useState(false);
  const cerrarAlGuardarRef = useRef(false);
  /** «Este audio no quedó guardado en ningún lado…» antes de cerrar. */
  const [confirmarPerder, setConfirmarPerder] = useState(false);
  // Avance
  const [pendiente, setPendiente] = useState<PendienteLocal | null>(null);
  const [enEquipo, setEnEquipo] = useState<boolean | null>(null);
  const [subida, setSubida] = useState<Subida | null>(null);
  const [dictado, setDictado] = useState<DictadoPublico | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmarDescarte, setConfirmarDescarte] = useState(false);
  /** «Pedir otra versión» después de una que falló por el audio mismo: se advierte que va a dar lo mismo. */
  const [confirmarOtra, setConfirmarOtra] = useState(false);

  const vivo = useRef(true);
  const alCambiarRef = useRef(alCambiar);
  useEffect(() => {
    alCambiarRef.current = alCambiar;
  }, [alCambiar]);
  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
      // Se cerró la ventana sin terminar (no debería pasar: ✕ pregunta antes). Si ya se estaba terminando,
      // grab.current es null y lo grabado se guarda y se sube igual (terminarGrabacion sigue sin la ventana).
      grab.current?.cancelar();
      grab.current = null;
    };
  }, []);

  // ¿Gemini tiene clave? (no impide grabar: el audio queda guardado y se procesa cuando esté).
  useEffect(() => {
    if (!conNube) return;
    void cliente.salud().then((s) => vivo.current && setGeminiFalta(!!s && s.gemini !== "ok"));
  }, [conNube]);

  // ---------- Subir ----------

  const subir = useCallback(async (p: PendienteLocal) => {
    if (vivo.current) setSubida({ e: "subiendo" });
    let r: ResultadoSubida;
    try {
      r = await cliente.subirPendiente(p);
    } catch (e) {
      if (vivo.current) setSubida({ e: "rechazo", motivo: "rechazado", mensaje: e instanceof AccesoRevocado ? e.message : mensajeNube(e) });
      return;
    }
    if (r.ok) alCambiarRef.current?.(); // también si ya se cerró la ventana: la lista de Dictadas se pone al día
    if (!vivo.current) return;
    if (r.ok) {
      setSubida({ e: "ok" });
      setDictado(r.dictado);
    } else if (r.motivo === "sin_conexion") setSubida({ e: "sin_conexion" });
    else setSubida({ e: "rechazo", motivo: r.motivo, mensaje: r.mensaje });
  }, []);

  /**
   * Primero la copia en este equipo y después la subida. Sigue aunque la ventana ya se haya cerrado (la copia
   * y la subida no dependen de la pantalla: lo que no llegue lo sube lib/dictados/motor.ts).
   */
  const enviar = async (blob: Blob, meta: { origen: "grabacion" | "archivo"; segundos?: number; archivo?: string; mime?: string }) => {
    const p = cliente.nuevoPendiente(blob, meta);
    if (vivo.current) {
      setPendiente(p);
      setEnEquipo(null);
      setFase("avance");
      setSubida({ e: "subiendo" });
    }
    const guardado = await pendientes.guardar(p);
    if (vivo.current) setEnEquipo(guardado);
    await subir(p);
  };

  // Sin conexión: apenas vuelve internet se sube (además del botón «Reintentar ahora»).
  useEffect(() => {
    if (subida?.e !== "sin_conexion" || !pendiente) return;
    const volver = () => void subir(pendiente);
    window.addEventListener("online", volver);
    return () => window.removeEventListener("online", volver);
  }, [subida, pendiente, subir]);

  // ---------- Esperar a Gemini ----------

  const enCamino = dictado && (dictado.estado === "subido" || dictado.estado === "procesando");
  useEffect(() => {
    if (!dictado || !enCamino) return;
    const id = dictado.id;
    const desde = Date.now();
    let n = 0;
    let t: ReturnType<typeof setTimeout>;
    let parar = false;
    const mirar = async () => {
      try {
        const d = await cliente.leerDictado(id);
        if (parar || !vivo.current) return;
        if (!d) {
          setMsg(TEXTOS.yaNoExiste);
          return;
        }
        setDictado(d);
        if (d.estado !== "subido" && d.estado !== "procesando") {
          alCambiarRef.current?.();
          return;
        }
      } catch {
        /* sin red: se vuelve a mirar */
      }
      if (!parar) t = setTimeout(mirar, esperaConsulta(++n, desde));
    };
    t = setTimeout(mirar, esperaConsulta(n, desde));
    return () => {
      parar = true;
      clearTimeout(t);
    };
    // Sólo al cambiar de dictado o al pasar a «en camino» (no en cada consulta).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dictado?.id, enCamino]);

  // ---------- Grabar ----------

  const terminarGrabacion = async () => {
    const g = grab.current;
    if (!g || terminandoRef.current) return;
    // Un segundo toque (o el corte automático) no manda dos veces. Con grab.current en null, si la ventana se
    // desmonta mientras tanto no se cancela la grabadora: lo grabado se guarda y se sube igual.
    grab.current = null;
    terminandoRef.current = true;
    setTerminando(true);
    setConfirmarCierre(false);
    let r: Grabacion | null = null;
    try {
      r = await g.terminar();
    } catch {
      r = null;
    }
    terminandoRef.current = false;
    if (vivo.current) setTerminando(false);
    if (!r || r.segundos < GRABACION_MIN_SEG || !r.blob.size) {
      if (!vivo.current) return;
      if (cerrarAlGuardarRef.current) return alCerrar(); // no hay nada que guardar
      setFase("inicio");
      setAviso(r ? TEXTOS.muyCorta : TEXTOS.micOtro);
      return;
    }
    await enviar(r.blob, { origen: "grabacion", segundos: r.segundos, mime: r.mime });
  };
  const terminarRef = useRef(terminarGrabacion);
  useEffect(() => {
    terminarRef.current = terminarGrabacion;
  });

  const grabar = async () => {
    setAviso(null);
    if (!puedeGrabar()) return setAviso(TEXTOS.sinGrabadora);
    setIniciando(true);
    setSegundos(0);
    setNivel(0);
    setAvisoGrab(null);
    setCorte(null);
    const g = crearGrabadora({
      alNivel: (n) => {
        if (!vivo.current) return;
        setNivel(n);
        if (n >= NIVEL_SONIDO) setAvisoGrab((a) => (a === "silencio" ? null : a));
      },
      alTiempo: (s) => vivo.current && setSegundos(s),
      alEstado: (e) => vivo.current && setEstadoGrab(e),
      alAviso: (a) => {
        if (!vivo.current) return;
        if (a === "maximo" || a === "cortada") {
          // La grabadora ya está terminando: se guarda lo grabado y se pasa al avance.
          setCorte(a);
          void terminarRef.current();
        } else setAvisoGrab(a);
      },
    });
    grab.current = g;
    try {
      await g.empezar(); // dentro del toque: en la app de inicio del iPhone el permiso dura esa apertura
      if (vivo.current) setFase("grabando");
    } catch (e) {
      grab.current = null;
      if (vivo.current) setAviso(textoGrabadora(e));
    } finally {
      if (vivo.current) setIniciando(false);
    }
  };

  // ---------- Archivo ----------

  const elegirArchivo = async (a: File) => {
    setAviso(null);
    if (!a.size) return setAviso(TEXTOS.archivoVacio);
    if (a.size > MAX_AUDIO) return setAviso(TEXTOS.archivoGrande);
    const seg = await duracionArchivo(a);
    if (!vivo.current) return;
    if (muyLargo(seg)) return setAviso(TEXTOS.archivoLargo);
    await enviar(a, { origen: "archivo", segundos: seg, archivo: a.name, mime: cliente.tipoDeArchivo(a.name, a.type) });
  };

  // ---------- Acciones sobre el dictado ----------

  const procesar = async (otraVez: boolean) => {
    if (!dictado) return;
    setMsg(null);
    setConfirmarOtra(false);
    setOcupado(true);
    try {
      const d = await cliente.procesarDictado(dictado.id, otraVez);
      if (!vivo.current) return;
      if (d) setDictado(d);
      else setMsg(TEXTOS.yaNoExiste);
      alCambiarRef.current?.();
    } catch (e) {
      if (vivo.current) setMsg(mensajeNube(e));
    } finally {
      if (vivo.current) setOcupado(false);
    }
  };

  /** «Pedir otra versión»: si la anterior falló por el audio mismo, primero se advierte que va a dar lo mismo. */
  const pedirOtra = () => (otraVersionDaLoMismo(dictado) ? setConfirmarOtra(true) : void procesar(true));
  // Si mientras tanto el dictado cambió (otro equipo pidió otra versión), la pregunta ya no corre.
  const pidiendoIgual = confirmarOtra && otraVersionDaLoMismo(dictado);

  /**
   * Con el dictado recién pedido: desde otro equipo pueden haber pedido otra versión (queda en cola, sin
   * borrador). Sólo se abre la revisión con un «listo» que trae borrador; si no, se muestra cómo va. Sin red se
   * abre el borrador que ya está en la ventana (se corrige sin red y queda en el equipo).
   */
  const revisar = async () => {
    if (!dictado) return;
    setMsg(null);
    setOcupado(true);
    try {
      const d = await cliente.leerDictado(dictado.id);
      if (!vivo.current) return;
      if (!d) setMsg(TEXTOS.yaNoExiste);
      else if (sePuedeRevisar(d)) alRevisar(d);
      else {
        setDictado(d); // vuelve a consultar mientras está en cola o con Gemini
        setMsg(TEXTOS.yaCambio);
        alCambiarRef.current?.();
      }
    } catch (e) {
      if (!vivo.current) return;
      if (dictado && revisarSinRed(e, dictado)) alRevisar(dictado);
      else setMsg(mensajeNube(e));
    } finally {
      if (vivo.current) setOcupado(false);
    }
  };

  const descartar = async () => {
    setMsg(null);
    setOcupado(true);
    try {
      const id = dictado?.id ?? pendiente?.id;
      let guardada = false;
      if (id) {
        // Un borrador: si otro equipo ya guardó la receta, la nube no borra nada.
        if (dictado) guardada = (await cliente.descartarBorrador(id)) === "guardada";
        else await pendientes.borrar(id); // nunca llegó a la nube
      }
      alCambiarRef.current?.();
      if (guardada && vivo.current) {
        setConfirmarDescarte(false);
        setMsg(TEXTOS.yaGuardadaOtro);
        return;
      }
      alCerrar();
    } catch (e) {
      if (vivo.current) setMsg(mensajeNube(e));
    } finally {
      if (vivo.current) setOcupado(false);
    }
  };

  const vista = vistaAvance({ enEquipo, subida, dictado });
  const enNube = subida?.e === "ok" || !!dictado;
  // Recién terminada la grabación o elegido el archivo, todavía no se sabe si quedó la copia en el equipo.
  const guardandoCopia = fase === "avance" && enEquipo === null && !enNube;

  const pedirCerrarAlGuardar = () => {
    cerrarAlGuardarRef.current = true;
    setCerrarAlGuardar(true);
  };
  // Se pidió cerrar mientras se guardaba: con la copia guardada se cierra; sin copia, se pregunta.
  useEffect(() => {
    if (!cerrarAlGuardar || terminando || fase !== "avance" || enEquipo === null) return;
    cerrarAlGuardarRef.current = false;
    setCerrarAlGuardar(false);
    if (vista.enRiesgo) setConfirmarPerder(true);
    else alCerrar();
  }, [cerrarAlGuardar, terminando, fase, enEquipo, vista.enRiesgo, alCerrar]);

  // Recargar o cerrar la pestaña mientras el audio está sólo aquí: el navegador pregunta antes.
  const soloAqui = fase === "grabando" || terminando || guardandoCopia || (fase === "avance" && vista.enRiesgo);
  useEffect(() => {
    if (!soloAqui) return;
    const antes = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", antes);
    return () => window.removeEventListener("beforeunload", antes);
  }, [soloAqui]);

  // ✕, Escape, un toque afuera o «Cerrar». Grabando se pregunta (lo grabado se guarda); juntando lo grabado o
  // guardando la copia, se cierra apenas quede guardado; sin copia en el equipo ni en la nube, se pregunta.
  const cerrar = () => {
    if (terminandoRef.current) return pedirCerrarAlGuardar();
    if (fase === "grabando" && grab.current) return setConfirmarCierre(true);
    if (guardandoCopia) return pedirCerrarAlGuardar();
    if (fase === "avance" && vista.enRiesgo) return setConfirmarPerder(true);
    alCerrar();
  };

  if (!nube)
    return (
      <Modal
        titulo={TEXTOS.tituloDictar}
        alCerrar={alCerrar}
        ancho="max-w-lg"
        pie={
          <Boton variante="primario" onClick={alCerrar}>
            {TEXTOS.entendido}
          </Boton>
        }
      >
        <p className="text-lg">{TEXTOS.sinNube}</p>
      </Modal>
    );

  return (
    <Modal titulo={TEXTOS.tituloDictar} alCerrar={cerrar} ancho="max-w-2xl" pie={pie()}>
      {fase === "inicio" && (
        <Inicio
          aviso={aviso}
          geminiFalta={geminiFalta}
          iniciando={iniciando}
          alGrabar={() => void grabar()}
          alElegir={(a) => void elegirArchivo(a)}
        />
      )}
      {fase === "grabando" && (
        <Grabando
          terminando={terminando}
          estado={estadoGrab}
          segundos={segundos}
          nivel={nivel}
          aviso={avisoGrab}
          confirmar={confirmarCierre}
          alPausar={() => grab.current?.pausar()}
          alSeguir={() => {
            setAvisoGrab((a) => (a === "interrumpida" ? null : a));
            grab.current?.seguir();
          }}
          alTerminar={() => void terminarGrabacion()}
          alSeguirGrabando={() => setConfirmarCierre(false)}
        />
      )}
      {fase === "avance" && (
        <Avance
          pendiente={pendiente}
          enEquipo={enEquipo}
          subida={subida}
          dictado={dictado}
          corte={corte}
          vista={vista}
          esperandoCierre={cerrarAlGuardar}
          msg={msg}
          confirmarDescarte={confirmarDescarte}
          confirmarOtra={pidiendoIgual}
          ocupado={ocupado}
          alSiDescartar={() => void descartar()}
          alNoDescartar={() => setConfirmarDescarte(false)}
          alSiOtra={() => void procesar(true)}
          alNoOtra={() => setConfirmarOtra(false)}
        />
      )}
    </Modal>
  );

  function pie() {
    if (fase !== "avance") return undefined;
    // Sin copia en ningún lado: antes de cerrar se pregunta (y se ofrece guardar una copia).
    if (confirmarPerder && vista.enRiesgo)
      return [
        <p key="perder-texto" role="alert" className="basis-full text-lg font-bold text-red-700 noche:text-red-300">
          {TEXTOS.confirmarPerder}
        </p>,
        pendiente && (
          <Boton key="copia" onClick={() => void guardarCopia(pendiente)}>
            {TEXTOS.guardarCopia}
          </Boton>
        ),
        <Boton key="perder" variante="peligro" onClick={alCerrar}>
          {TEXTOS.cerrarYPerder}
        </Boton>,
        <Boton key="no-cerrar" variante="primario" onClick={() => setConfirmarPerder(false)}>
          {TEXTOS.noCerrar}
        </Boton>,
      ];
    const botones: React.ReactNode[] = [];
    const cerrarBtn = (
      <Boton key="cerrar" variante="fantasma" disabled={cerrarAlGuardar} onClick={cerrar}>
        {TEXTOS.cerrar}
      </Boton>
    );
    const descartarBtn = !confirmarDescarte && (
      <Boton key="descartar" variante="peligro" className="mr-auto" disabled={ocupado} onClick={() => setConfirmarDescarte(true)}>
        {TEXTOS.descartar}
      </Boton>
    );
    const copiaBtn = vista.copia && pendiente && (
      <Boton key="copia" onClick={() => void guardarCopia(pendiente)}>
        {TEXTOS.guardarCopia}
      </Boton>
    );
    if (subida?.e === "sin_conexion" && pendiente) {
      botones.push(
        copiaBtn,
        cerrarBtn,
        <Boton key="reintentar" variante="primario" onClick={() => void subir(pendiente)}>
          {TEXTOS.reintentarAhora}
        </Boton>,
      );
      return botones;
    }
    if (subida?.e === "rechazo") {
      if (subida.motivo !== "ya_guardada") botones.push(descartarBtn); // ya_guardada: el audio es de una receta guardada
      botones.push(copiaBtn, cerrarBtn);
      return botones;
    }
    if (!dictado) return [copiaBtn, cerrarBtn];
    const b = botonesDictado(dictado);
    const otraBtn = !pidiendoIgual && (
      <Boton key="otra" disabled={ocupado} onClick={pedirOtra}>
        {TEXTOS.otraVersion}
      </Boton>
    );
    if (dictado.estado === "listo" && dictado.esReceta !== false)
      return [
        cerrarBtn,
        b.includes("otra_version") && otraBtn, // borrador de rescate: sin ingredientes ni pasos
        <Boton key="revisar" variante="primario" disabled={ocupado} onClick={() => void revisar()}>
          {TEXTOS.revisarReceta}
        </Boton>,
      ];
    if (b.includes("revisar_igual"))
      return [
        descartarBtn,
        otraBtn,
        <Boton key="igual" variante="primario" disabled={ocupado} onClick={() => void revisar()}>
          {TEXTOS.revisarIgual}
        </Boton>,
      ];
    if (dictado.estado === "error") {
      botones.push(descartarBtn, cerrarBtn);
      if (b.includes("intentar"))
        botones.push(
          <Boton key="intentar" variante="primario" disabled={ocupado} onClick={() => void procesar(false)}>
            {TEXTOS.intentar}
          </Boton>,
        );
      return botones;
    }
    return [cerrarBtn];
  }
}

// ---------- Pantallas ----------

function Inicio({
  aviso,
  geminiFalta,
  iniciando,
  alGrabar,
  alElegir,
}: {
  aviso: string | null;
  geminiFalta: boolean;
  iniciando: boolean;
  alGrabar: () => void;
  alElegir: (a: File) => void;
}) {
  const [graba] = useState(() => puedeGrabar());
  const [ios] = useState(() => esIOS());
  const [accept] = useState(() => aceptarArchivos());
  return (
    <div className="space-y-4 text-lg">
      {aviso && (
        <p role="alert" className="rounded-2xl bg-red-600/15 px-4 py-2 font-bold text-red-700 noche:text-red-300">
          {aviso}
        </p>
      )}
      {geminiFalta && <p className="rounded-2xl bg-acento-suave px-4 py-3">{TEXTOS.geminiNoConectado}</p>}
      <p>{TEXTOS.inicio}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Boton variante="primario" grande disabled={!graba || iniciando} onClick={alGrabar}>
            {iniciando ? TEXTOS.abriendoMicrofono : TEXTOS.empezar}
          </Boton>
          {!graba && <span className="text-base text-tinta-suave">{TEXTOS.sinGrabadora}</span>}
          {graba && ios && <span className="text-base text-tinta-suave">{TEXTOS.permisoIphone}</span>}
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="inline-flex min-h-16 cursor-pointer items-center justify-center gap-2 rounded-2xl bg-superficie-2 px-6 text-xl font-bold transition active:scale-[0.97]">
            {TEXTOS.subirAudio}
            {/* En iOS sin `accept`: con "audio/*" el selector no deja elegir el .opus de WhatsApp desde Archivos. */}
            <input
              type="file"
              accept={accept}
              className="sr-only"
              aria-label={TEXTOS.subirAudio}
              onChange={(e) => {
                const a = e.target.files?.[0];
                e.target.value = ""; // así se puede volver a elegir el mismo
                if (a) alElegir(a);
              }}
            />
          </label>
          <span className="text-base text-tinta-suave">{TEXTOS.subirAudioLinea}</span>
        </div>
      </div>
      <details className="rounded-2xl bg-superficie-2 p-3 text-base">
        <summary className="min-h-8 cursor-pointer text-lg font-bold">{TEXTOS.whatsappTitulo}</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-6 text-lg">
          {TEXTOS.whatsappPasos.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ol>
      </details>
      <p className="text-base text-tinta-suave">{TEXTOS.privacidad}</p>
    </div>
  );
}

function Grabando({
  terminando,
  estado,
  segundos,
  nivel,
  aviso,
  confirmar,
  alPausar,
  alSeguir,
  alTerminar,
  alSeguirGrabando,
}: {
  terminando: boolean;
  estado: EstadoGrabadora;
  segundos: number;
  nivel: number;
  aviso: AvisoGrabadora | null;
  confirmar: boolean;
  alPausar: () => void;
  alSeguir: () => void;
  alTerminar: () => void;
  alSeguirGrabando: () => void;
}) {
  const pausa = estado === "pausa";
  const textoAviso = aviso === "silencio" ? TEXTOS.silencio : aviso === "quedan_dos" ? TEXTOS.quedanDos : aviso === "interrumpida" ? TEXTOS.interrumpida : null;
  return (
    <div className="flex flex-col items-center gap-4 py-2 text-center">
      <div className={cx("text-2xl font-extrabold", !pausa && !terminando && "text-red-700 noche:text-red-300")} role="status">
        {terminando ? TEXTOS.guardandoGrabacion : pausa ? TEXTOS.enPausa : TEXTOS.grabando}
      </div>
      <div className="num font-display text-7xl font-semibold" aria-label={`Tiempo grabado ${mmss(segundos)}`}>
        {mmss(segundos)}
      </div>
      <div className="text-base text-tinta-suave">{TEXTOS.maximo}</div>
      <div className="h-4 w-full max-w-md overflow-hidden rounded-full bg-superficie-2" aria-hidden>
        <div className="h-full rounded-full bg-acento transition-[width] duration-200" style={{ width: `${Math.round((pausa ? 0 : nivel) * 100)}%` }} />
      </div>
      {textoAviso && (
        <p role="alert" className="max-w-lg rounded-2xl bg-acento-suave px-4 py-3 text-lg font-bold">
          {textoAviso}
        </p>
      )}
      {terminando ? null : confirmar ? (
        <div className="w-full max-w-lg rounded-2xl bg-superficie-2 p-4">
          <p className="mb-3 text-xl font-bold">{TEXTOS.confirmarTerminar}</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Boton variante="primario" onClick={alTerminar}>
              {TEXTOS.terminarYGuardar}
            </Boton>
            <Boton onClick={alSeguirGrabando}>{TEXTOS.seguirGrabando}</Boton>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap justify-center gap-3">
          {pausa ? (
            <Boton grande onClick={alSeguir}>
              {TEXTOS.seguir}
            </Boton>
          ) : (
            <Boton grande onClick={alPausar}>
              {TEXTOS.pausa}
            </Boton>
          )}
          <Boton grande variante="primario" onClick={alTerminar}>
            {TEXTOS.terminar}
          </Boton>
        </div>
      )}
    </div>
  );
}

/** Un paso del avance. `tono`: un error que necesita a alguien ("alerta") o algo que espera ("espera"), a la vista. */
function Paso({ hecho, actual, tono, children }: { hecho?: boolean; actual?: boolean; tono?: "alerta" | "espera"; children: React.ReactNode }) {
  return (
    <li
      className={cx(
        "rounded-2xl px-4 py-2.5 text-xl font-bold",
        tono === "alerta"
          ? "bg-red-600/15 text-red-700 noche:text-red-300"
          : tono === "espera"
            ? "bg-acento-suave"
            : hecho
              ? "bg-superficie-2"
              : actual
                ? "animate-pulse bg-acento-suave"
                : "bg-superficie-2 opacity-50",
      )}
    >
      {children}
    </li>
  );
}

const tonoDe = (s: Situacion | null): "alerta" | "espera" | undefined =>
  s === "necesita_ayuda" ? "alerta" : s === "no_receta" || s === "se_reintenta" || s === "esperando_gemini" ? "espera" : undefined;

function Avance({
  pendiente,
  enEquipo,
  subida,
  dictado,
  corte,
  vista,
  esperandoCierre,
  msg,
  confirmarDescarte,
  confirmarOtra,
  ocupado,
  alSiDescartar,
  alNoDescartar,
  alSiOtra,
  alNoOtra,
}: {
  pendiente: PendienteLocal | null;
  enEquipo: boolean | null;
  subida: Subida | null;
  dictado: DictadoPublico | null;
  corte: Corte | null;
  vista: ReturnType<typeof vistaAvance>;
  esperandoCierre: boolean;
  msg: string | null;
  confirmarDescarte: boolean;
  confirmarOtra: boolean;
  ocupado: boolean;
  alSiDescartar: () => void;
  alNoDescartar: () => void;
  alSiOtra: () => void;
  alNoOtra: () => void;
}) {
  const enNube = subida?.e === "ok" || !!dictado;
  const s = dictado ? situacion(dictado) : null;
  const escribiendo = dictado && (dictado.estado === "subido" || dictado.estado === "procesando");
  const lista = dictado?.estado === "listo" && dictado.esReceta !== false;
  // «Pedir otra versión» falló: quedó el borrador de antes, y se dice por qué (no basta con «¡Lista!»).
  const fallo = textoOtraVersionFallo(dictado);
  return (
    <div className="space-y-4 text-lg">
      {corte && <p className="rounded-2xl bg-acento-suave px-4 py-3 font-bold">{corte === "maximo" ? TEXTOS.maximoAlcanzado : TEXTOS.cortada}</p>}
      <ol className="space-y-2" aria-label="Avance">
        {enEquipo === false ? (
          // Sin copia en el equipo: el aviso rojo mientras el audio está sólo aquí; ya en la nube, sobra.
          vista.enRiesgo && <li className="rounded-2xl bg-red-600/15 px-4 py-2.5 text-lg font-bold text-red-700 noche:text-red-300">{TEXTOS.sinCopiaLocal}</li>
        ) : (
          <Paso hecho={enEquipo === true} actual={enEquipo === null}>
            {TEXTOS.guardadoEquipo(pendiente?.segundos)}
          </Paso>
        )}
        <Paso hecho={enNube} actual={subida?.e === "subiendo"}>
          {enNube ? TEXTOS.guardadoNube : TEXTOS.subiendo}
        </Paso>
        {(enNube || escribiendo) && (
          <Paso hecho={lista} actual={!!escribiendo} tono={lista ? undefined : tonoDe(s)}>
            {lista ? TEXTOS.lista : (dictado?.estado === "error" || s === "no_receta") && s ? CHIPS[s] : TEXTOS.escribiendo}
          </Paso>
        )}
      </ol>

      {fallo && (
        <p role="alert" className="rounded-2xl bg-acento-suave px-4 py-3 font-bold">
          {fallo}
        </p>
      )}
      {lista && dictado?.rescate && <p className="rounded-2xl bg-acento-suave px-4 py-3">{TEXTOS.rescate}</p>}
      {vista.sinConexion && <p className="rounded-2xl bg-acento-suave px-4 py-3 font-bold">{vista.sinConexion}</p>}
      {subida?.e === "rechazo" && (
        <p role="alert" className="rounded-2xl bg-red-600/15 px-4 py-3 font-bold text-red-700 noche:text-red-300">
          {subida.mensaje}
        </p>
      )}

      {dictado?.estado === "error" && (
        <div className="space-y-2 rounded-2xl bg-superficie-2 p-4">
          <p className="text-xl font-extrabold">{s === "esperando_gemini" ? CHIPS.esperando_gemini : TEXTOS.errorTitulo}</p>
          <p role="alert">{mensajeError(dictado)}</p>
          {dictado.transcripcion && <VerLoQueSeDijo titulo={TEXTOS.loQueSeEscucho} texto={dictado.transcripcion} />}
        </div>
      )}
      {s === "no_receta" && (
        <div className="space-y-2 rounded-2xl bg-superficie-2 p-4">
          <p role="alert">{TEXTOS.noReceta(dictado?.motivo)}</p>
          {dictado?.transcripcion && <VerLoQueSeDijo titulo={TEXTOS.loQueSeEscucho} texto={dictado.transcripcion} />}
        </div>
      )}
      {msg && (
        <p role="alert" className="font-bold">
          {msg}
        </p>
      )}
      {confirmarOtra && (
        <div className="rounded-2xl bg-acento-suave p-4">
          <p className="mb-3 font-bold">{TEXTOS.confirmarOtraIgual}</p>
          <div className="flex flex-wrap gap-2">
            <Boton disabled={ocupado} onClick={alSiOtra}>
              {TEXTOS.siOtraIgual}
            </Boton>
            <Boton variante="primario" onClick={alNoOtra}>
              {TEXTOS.no}
            </Boton>
          </div>
        </div>
      )}
      {confirmarDescarte && (
        <div className="rounded-2xl bg-red-600/10 p-4">
          <p className="mb-3 font-bold">{TEXTOS.confirmarDescartar}</p>
          <div className="flex flex-wrap gap-2">
            <Boton variante="peligro" disabled={ocupado} onClick={alSiDescartar}>
              {TEXTOS.siDescartar}
            </Boton>
            <Boton variante="fantasma" onClick={alNoDescartar}>
              {TEXTOS.no}
            </Boton>
          </div>
        </div>
      )}
      {esperandoCierre && (
        <p role="status" className="font-bold">
          {TEXTOS.guardandoGrabacion}
        </p>
      )}
      {vista.pie && <p className="text-base text-tinta-suave">{TEXTOS.pieAvance}</p>}
    </div>
  );
}
