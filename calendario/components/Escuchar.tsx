"use client";

// Escuchar el audio de una receta dictada y ver lo que se dijo (la transcripción). El audio vive en la nube
// (Blobs) y se baja con la clave del equipo: un <audio src="/api/…"> no la manda, así que se pide con fetch
// y se reproduce desde una dirección blob: que se libera al cerrar. Un audio que todavía está sólo en este
// equipo (sin subir) se toca desde IndexedDB.

import { useEffect, useRef, useState } from "react";
import { AccesoRevocado, SinConexion } from "@/lib/datos/nube";
import { RechazoDictado, bajarAudio, leerTexto } from "@/lib/dictados/cliente";
import * as pendientes from "@/lib/dictados/pendientes";
import { TEXTOS } from "@/lib/dictados/textos";
import { Boton, cx } from "./ui";

/** Mensaje para mostrar de un error al hablar con la nube por un dictado. */
export function mensajeNube(e: unknown): string {
  if (e instanceof SinConexion) return TEXTOS.sinRed;
  if (e instanceof RechazoDictado || e instanceof AccesoRevocado) return e.message;
  return TEXTOS.algoFallo;
}

/**
 * [▶️ Escuchar el audio]: al tocarlo baja el audio y muestra un reproductor. `enEquipo`: el audio todavía
 * está sólo en este equipo (lo lee de IndexedDB, no de la nube).
 */
export function BotonEscuchar({
  dictadoId,
  etiqueta = TEXTOS.escucharAudio,
  titulo,
  enEquipo = false,
  className,
  claseBoton,
  enLinea = false,
}: {
  dictadoId: string;
  etiqueta?: string;
  /** Nombre accesible cuando `etiqueta` es sólo un ícono («▶️»). */
  titulo?: string;
  enEquipo?: boolean;
  className?: string;
  /** Clases del botón (p. ej. otro fondo cuando va sobre bg-superficie-2). */
  claseBoton?: string;
  /** Va dentro de una fila flex-wrap: sin contenedor propio (el reproductor ocupa una línea entera). */
  enLinea?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const vivo = useRef(true);

  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);
  // La dirección blob: se libera al cambiarla o al cerrar.
  useEffect(() => {
    if (!url) return;
    return () => URL.revokeObjectURL(url);
  }, [url]);

  const escuchar = async () => {
    setError(null);
    setCargando(true);
    try {
      let u: string | "borrado";
      if (enEquipo) {
        const p = await pendientes.leer(dictadoId);
        u = p ? URL.createObjectURL(p.blob) : "borrado";
      } else u = await bajarAudio(dictadoId);
      if (!vivo.current) {
        if (u !== "borrado") URL.revokeObjectURL(u);
        return;
      }
      if (u === "borrado") setError(TEXTOS.audioBorrado);
      else setUrl(u);
    } catch (e) {
      if (vivo.current) setError(mensajeNube(e));
    } finally {
      if (vivo.current) setCargando(false);
    }
  };

  if (url)
    return (
      <div className={cx("w-full min-w-0", enLinea && "order-last", className)}>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <audio
          controls
          autoPlay
          src={url}
          aria-label={titulo ?? etiqueta}
          className="w-full"
          onError={() => {
            setUrl(null);
            setError(TEXTOS.noReproduce);
          }}
        />
      </div>
    );
  const boton = (
    <Boton onClick={escuchar} disabled={cargando} aria-label={titulo} title={titulo} className={claseBoton}>
      {cargando ? TEXTOS.cargandoAudio : etiqueta}
    </Boton>
  );
  const aviso = error && (
    <p role="status" className={cx("text-base font-bold text-tinta-suave", enLinea && "order-last basis-full")}>
      {error}
    </p>
  );
  if (enLinea)
    return (
      <>
        {boton}
        {aviso}
      </>
    );
  return (
    <div className={cx("flex flex-wrap items-center gap-2", className)}>
      {boton}
      {aviso}
    </div>
  );
}

/**
 * «📝 Ver lo que se dijo»: un plegable que muestra la transcripción. Si no viene en `texto`, la pide a la
 * nube la primera vez que se abre.
 */
export function VerLoQueSeDijo({
  dictadoId,
  texto,
  titulo = TEXTOS.verLoQueSeDijo,
  className,
}: {
  dictadoId?: string;
  texto?: string;
  titulo?: string;
  className?: string;
}) {
  const [leido, setLeido] = useState<string | null>(texto?.trim() ? texto : null);
  const [estado, setEstado] = useState<"nada" | "cargando" | "listo">(texto?.trim() ? "listo" : "nada");
  const [error, setError] = useState<string | null>(null);

  const abrir = async () => {
    if (estado !== "nada" || !dictadoId) return;
    setEstado("cargando");
    setError(null);
    try {
      const t = await leerTexto(dictadoId);
      setLeido(t?.transcripcion.trim() ? t.transcripcion : null);
      if (!t?.transcripcion.trim()) setError(TEXTOS.textoNoEsta);
      setEstado("listo");
    } catch (e) {
      setError(mensajeNube(e));
      setEstado("nada"); // se puede volver a intentar cerrando y abriendo
    }
  };

  return (
    <details
      className={cx("rounded-2xl bg-superficie-2 p-3 text-base", className)}
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open) void abrir();
      }}
    >
      <summary className="min-h-8 cursor-pointer text-lg font-bold">{titulo}</summary>
      {estado === "cargando" && <p className="mt-2 text-tinta-suave">{TEXTOS.cargando}</p>}
      {error && <p className="mt-2 font-bold text-tinta-suave">{error}</p>}
      {leido && <p className="mt-2 whitespace-pre-wrap text-lg leading-relaxed">{leido}</p>}
    </details>
  );
}
