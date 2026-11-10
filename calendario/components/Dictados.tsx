"use client";

// «🎙️ Dictadas»: el aviso ancho de arriba de Recetas y la lista de las recetas dictadas que todavía no se
// guardan (en la nube, de toda la familia) y de los audios que siguen sólo en este equipo. Lo que la app
// hace sola (mirar la lista, subir, reintentar) vive en lib/dictados/useDictados.ts.

import { useState } from "react";
import { useCandado } from "@/lib/candado";
import * as cliente from "@/lib/dictados/cliente";
import type { EstadoDictados, LocalVista } from "@/lib/dictados/useDictados";
import {
  TEXTOS,
  botonesDictado,
  chip,
  chipLocal,
  mensajeError,
  otraVersionDaLoMismo,
  otraVersionFallo,
  resumir,
  sePuedeRevisar,
  situacion,
  textoAviso,
  textoOtraVersionFallo,
  tituloDictado,
} from "@/lib/dictados/textos";
import type { DictadoPublico } from "@/lib/dictados/tipos";
import { BotonEscuchar, mensajeNube } from "./Escuchar";
import { Boton, Modal, Vacio, cx } from "./ui";

/** El botón ancho de arriba de Recetas (nada si no hay recetas dictadas pendientes). */
export function AvisoDictados({ d, alAbrir }: { d: EstadoDictados; alAbrir: () => void }) {
  const texto = textoAviso(resumir(d.dictados, d.locales.length));
  if (!texto) return null;
  return (
    <button
      type="button"
      onClick={alAbrir}
      className="min-h-12 w-full rounded-2xl bg-acento-suave px-4 py-3 text-left text-lg font-bold transition active:scale-[0.99]"
    >
      {texto}
    </button>
  );
}

/** La lista «🎙️ Dictadas». `alRevisar` recibe el dictado completo (con su borrador). */
export function ModalDictados({ d, alCerrar, alRevisar }: { d: EstadoDictados; alCerrar: () => void; alRevisar: (x: DictadoPublico) => void }) {
  const vacio = d.dictados.length === 0 && d.locales.length === 0;
  return (
    <Modal titulo={TEXTOS.tituloDictadas} alCerrar={alCerrar} ancho="max-w-3xl">
      {d.sinConexion && (
        <p role="status" className="mb-3 rounded-2xl bg-superficie-2 px-4 py-2 text-lg font-bold">
          {TEXTOS.sinRed}
        </p>
      )}
      {vacio ? (
        <Vacio emoji="🎙️" texto={d.cargado ? TEXTOS.sinDictados : TEXTOS.cargando} />
      ) : (
        <ul className="space-y-3">
          {d.locales.map((p) => (
            <FilaLocal key={p.id} p={p} d={d} />
          ))}
          {d.dictados.map((x) => (
            <FilaDictado key={x.id} x={x} d={d} alRevisar={alRevisar} />
          ))}
        </ul>
      )}
    </Modal>
  );
}

/** Confirmación de «Descartar» dentro de la fila. */
function ConfirmarDescartar({ alSi, alNo, ocupado }: { alSi: () => void; alNo: () => void; ocupado: boolean }) {
  return (
    <div className="w-full rounded-2xl bg-red-600/10 p-3">
      <p className="mb-2 text-lg font-bold">{TEXTOS.confirmarDescartar}</p>
      <div className="flex flex-wrap gap-2">
        <Boton variante="peligro" disabled={ocupado} onClick={alSi}>
          {TEXTOS.siDescartar}
        </Boton>
        <Boton variante="fantasma" onClick={alNo}>
          {TEXTOS.no}
        </Boton>
      </div>
    </div>
  );
}

/** «Pedir otra versión» después de una que falló por el audio mismo: va a dar lo mismo. */
function ConfirmarOtraIgual({ alSi, alNo, ocupado }: { alSi: () => void; alNo: () => void; ocupado: boolean }) {
  return (
    <div className="w-full rounded-2xl bg-acento-suave p-3">
      <p className="mb-2 text-lg font-bold">{TEXTOS.confirmarOtraIgual}</p>
      <div className="flex flex-wrap gap-2">
        <Boton disabled={ocupado} onClick={alSi}>
          {TEXTOS.siOtraIgual}
        </Boton>
        <Boton variante="primario" onClick={alNo}>
          {TEXTOS.no}
        </Boton>
      </div>
    </div>
  );
}

function FilaDictado({ x, d, alRevisar }: { x: DictadoPublico; d: EstadoDictados; alRevisar: (x: DictadoPublico) => void }) {
  const { proteger } = useCandado();
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const [confirmarOtra, setConfirmarOtra] = useState(false);
  const s = situacion(x);
  const botones = botonesDictado(x);
  // La pregunta de «va a dar lo mismo» corre mientras la última otra versión siga fallida por el audio.
  const pidiendoIgual = confirmarOtra && otraVersionDaLoMismo(x);

  const hacer = (accion: () => Promise<void>) =>
    proteger(() => {
      setMsg(null);
      setOcupado(true);
      void accion()
        .catch((e) => setMsg(mensajeNube(e)))
        .finally(() => setOcupado(false));
    });

  // Con el dictado recién pedido (la lista puede estar vieja: desde otro equipo pueden haber pedido otra
  // versión). Sólo se abre un «listo» que trae borrador; si no, se avisa y la lista se pone al día.
  const revisar = () =>
    hacer(async () => {
      const completo = await cliente.leerDictado(x.id);
      if (!completo) {
        setMsg(TEXTOS.yaNoExiste);
        void d.refrescar();
        return;
      }
      if (!sePuedeRevisar(completo)) {
        setMsg(TEXTOS.yaCambio);
        void d.refrescar();
        return;
      }
      alRevisar(completo);
    });
  const procesar = (otraVez: boolean) =>
    hacer(async () => {
      setConfirmarOtra(false);
      const r = await d.procesar(x.id, otraVez);
      if (!r) setMsg(TEXTOS.yaNoExiste);
      // Falló al tiro (p. ej. sin la clave de Gemini): la nube no lo anota, así que el aviso queda en la fila.
      else if (otraVez && otraVersionFallo(r)) setMsg(textoOtraVersionFallo(r));
    });
  /** «Pedir otra versión»: si la anterior falló por el audio mismo, primero se advierte que va a dar lo mismo. */
  const pedirOtra = () => (otraVersionDaLoMismo(x) ? proteger(() => setConfirmarOtra(true)) : procesar(true));

  const detalle = x.estado === "error" ? mensajeError(x) : s === "no_receta" ? TEXTOS.noReceta(x.motivo) : s === "lista" && x.rescate ? TEXTOS.rescate : null;
  // «Pedir otra versión» falló y quedó el borrador de antes: se dice por qué (sin repetirlo si ya está en `msg`).
  const fallo = textoOtraVersionFallo(x);
  return (
    <li className="rounded-2xl bg-superficie-2 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-4xl" aria-hidden>
          {x.emoji || "🎙️"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xl font-extrabold leading-tight">{tituloDictado(x)}</div>
          <div className={cx("mt-0.5 text-base font-bold", s === "necesita_ayuda" ? "text-red-700 noche:text-red-300" : "text-tinta-suave")}>
            {chip(x)}
          </div>
        </div>
      </div>
      {detalle && <p className="mt-2 text-lg">{detalle}</p>}
      {fallo && fallo !== msg && <p className="mt-2 rounded-2xl bg-acento-suave px-3 py-2 text-lg font-bold">{fallo}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {botones.includes("revisar") && (
          <Boton variante="primario" disabled={ocupado} onClick={revisar}>
            {TEXTOS.revisar}
          </Boton>
        )}
        {botones.includes("revisar_igual") && (
          <Boton disabled={ocupado} onClick={revisar}>
            {TEXTOS.revisarIgual}
          </Boton>
        )}
        {botones.includes("otra_version") && !pidiendoIgual && (
          <Boton disabled={ocupado} onClick={pedirOtra}>
            {TEXTOS.otraVersion}
          </Boton>
        )}
        {botones.includes("intentar") && (
          <Boton variante="primario" disabled={ocupado} onClick={() => procesar(false)}>
            {TEXTOS.intentar}
          </Boton>
        )}
        {x.error?.codigo !== "audio_perdido" ? (
          <BotonEscuchar dictadoId={x.id} etiqueta="▶️" titulo={TEXTOS.escucharAudio} claseBoton="bg-superficie" enLinea />
        ) : null}
        {!confirmar && (
          <Boton variante="peligro" disabled={ocupado} onClick={() => proteger(() => setConfirmar(true))} className="ml-auto">
            {TEXTOS.descartar}
          </Boton>
        )}
      </div>
      {pidiendoIgual && (
        <div className="mt-3">
          <ConfirmarOtraIgual ocupado={ocupado} alNo={() => setConfirmarOtra(false)} alSi={() => procesar(true)} />
        </div>
      )}
      {confirmar && (
        <div className="mt-3">
          <ConfirmarDescartar
            ocupado={ocupado}
            alNo={() => setConfirmar(false)}
            alSi={() =>
              hacer(async () => {
                await d.descartar(x.id);
                setConfirmar(false);
              })
            }
          />
        </div>
      )}
      {msg && (
        <p role="alert" className="mt-2 text-lg font-bold">
          {msg}
        </p>
      )}
    </li>
  );
}

function FilaLocal({ p, d }: { p: LocalVista; d: EstadoDictados }) {
  const { proteger } = useCandado();
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState(false);

  const subir = () =>
    proteger(() => {
      setMsg(null);
      setOcupado(true);
      void d
        .subirLocal(p.id)
        .then((r) => {
          if (!r) setMsg(TEXTOS.yaNoExiste);
          else if (!r.ok) setMsg(r.motivo === "sin_conexion" ? TEXTOS.sinConexion : r.mensaje);
        })
        .catch((e) => setMsg(mensajeNube(e)))
        .finally(() => setOcupado(false));
    });

  return (
    <li className="rounded-2xl bg-superficie-2 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-4xl" aria-hidden>
          📱
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xl font-extrabold leading-tight">{tituloDictado(p)}</div>
          <div className={cx("mt-0.5 text-base font-bold", p.rechazo ? "text-red-700 noche:text-red-300" : "text-tinta-suave")}>{chipLocal(p)}</div>
        </div>
      </div>
      {p.rechazo && <p className="mt-2 text-lg">{p.rechazo.mensaje}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!p.subiendo && (
          <Boton variante="primario" disabled={ocupado} onClick={subir}>
            {TEXTOS.subirAhora}
          </Boton>
        )}
        <BotonEscuchar dictadoId={p.id} etiqueta="▶️" titulo={TEXTOS.escucharAudio} enEquipo claseBoton="bg-superficie" enLinea />
        {!confirmar && (
          <Boton variante="peligro" disabled={ocupado || p.subiendo} onClick={() => proteger(() => setConfirmar(true))} className="ml-auto">
            {TEXTOS.descartar}
          </Boton>
        )}
      </div>
      {confirmar && (
        <div className="mt-3">
          <ConfirmarDescartar
            ocupado={ocupado}
            alNo={() => setConfirmar(false)}
            alSi={() =>
              proteger(() => {
                setOcupado(true);
                void d
                  .descartar(p.id)
                  .then(() => setConfirmar(false))
                  .catch((e) => setMsg(mensajeNube(e)))
                  .finally(() => setOcupado(false));
              })
            }
          />
        </div>
      )}
      {msg && (
        <p role="alert" className="mt-2 text-lg font-bold">
          {msg}
        </p>
      )}
    </li>
  );
}
