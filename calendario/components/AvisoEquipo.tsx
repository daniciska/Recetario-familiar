"use client";

// Avisos de arriba, en todas las pestañas, sobre si este equipo está unido a la familia en la nube:
// - sin unir: lo que se ve es la familia de ejemplo (inventada) o una copia que vive sólo aquí. En el
//   iPhone pasa al abrir el ícono de la pantalla de inicio después de unirse en Safari (cada uno guarda
//   sus datos aparte), y asusta: parecen los eventos de otra familia.
// - recién unido (o recién creada la familia): lo confirma y, en Safari del iPhone, cómo dejarla como app.

import { useEffect, useId, useState } from "react";
import { useDatos } from "@/lib/store";
import {
  avisoSinFamiliaOculto,
  esIPhoneOIPad,
  esIconoDeInicioIOS,
  leerRecienUnido,
  ocultarAvisoSinFamilia,
  olvidarRecienUnido,
} from "@/lib/datos/nube";
import { esFamiliaDeEjemplo } from "@/lib/ejemplo";
import { DONDE_INVITAR, UnirseConCodigoModal, textoIconoCorto, textoIconoPorQue } from "./Nube";
import { cx } from "./ui";

const claseBoton =
  "inline-flex items-center justify-center rounded-2xl px-3 py-1 text-center text-base font-bold leading-tight transition active:scale-[0.97]";

/**
 * Franja de "este equipo no está unido a la familia". En la pared, lo más baja posible.
 * En la app del ícono del iPhone o iPad suma una línea (textoIconoCorto). En la pared es todo: la
 * explicación completa está en la ventana de «Unirme con un código». Fuera de la pared, la explicación
 * (textoIconoPorQue) va después de los botones, plegada tras «¿Por qué?», y en pantallas bajas también
 * la línea queda ahí, para que los botones y el calendario quepan.
 */
export function AvisoSinFamilia({ compacto }: { compacto: boolean }) {
  const { estado, nube } = useDatos();
  const [oculto, setOculto] = useState(avisoSinFamiliaOculto);
  const [icono] = useState(esIconoDeInicioIOS);
  const [uniendo, setUniendo] = useState(false);
  const [porQue, setPorQue] = useState(false);
  const idPorQue = useId();
  if (nube || oculto) return null;
  const ejemplo = esFamiliaDeEjemplo(estado);
  const conPorQue = icono && !compacto;

  return (
    <>
      <section
        aria-label="Este equipo no está unido a la familia"
        data-aviso="sin-familia"
        className={cx(
          "mx-3 mb-2 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border-2 border-acento/40 bg-acento-suave md:mx-4",
          // Con «¿Por qué?» abierto en una pantalla baja, la franja no pasa de la mitad: se desplaza adentro.
          compacto ? "px-3 py-1.5" : "desliza max-h-[50dvh] overflow-y-auto overscroll-contain px-4 py-3",
          // Celular: más baja (texto corto de 14 px, botones de 44 px con textos cortos).
          "cel:mx-4 cel:gap-y-1.5 cel:px-3 cel:py-2",
        )}
      >
        <div className="min-w-0 flex-[1_1_20rem] space-y-1 cel:space-y-0.5">
          <p className={cx("font-extrabold", compacto ? "text-base" : "text-base md:text-lg", "cel:text-sm")}>
            <span className="cel:hidden">
              {ejemplo
                ? "👋 Este equipo todavía no está unido a tu familia: lo que ves es una familia de ejemplo (inventada)."
                : "☁️ Este equipo no está unido a la familia en la nube: los cambios quedan sólo aquí."}
            </span>
            <span className="hidden cel:inline">
              {ejemplo
                ? "👋 Lo que ves es una familia de ejemplo (inventada): este equipo aún no está unido a la tuya."
                : "☁️ Este equipo no está unido a la familia: los cambios quedan sólo aquí."}
            </span>
            {conPorQue && (
              <>
                {" "}
                {/* -my-1 compensa el py-1 (área para tocar) sin agrandar la línea. */}
                <button
                  type="button"
                  aria-expanded={porQue}
                  aria-controls={idPorQue}
                  onClick={() => setPorQue((v) => !v)}
                  className="-my-1 rounded-lg px-1 py-1 text-base font-bold whitespace-nowrap text-tinta underline decoration-2 underline-offset-2 cel:-my-3.5 cel:inline-flex cel:min-h-11 cel:items-center cel:text-sm"
                >
                  ¿Por qué?
                </button>
              </>
            )}
          </p>
          {/* Pantalla baja (≤ 640 px de alto: iPhone SE de 1ª generación, teléfono en horizontal): sólo «¿Por qué?». */}
          {conPorQue && (
            <p className="text-base [@media(max-height:640px)]:hidden cel:text-[0.8125rem] cel:leading-snug" data-texto="icono">
              {textoIconoCorto()}
            </p>
          )}
        </div>
        {/* En el teléfono, los dos botones lado a lado (el texto baja a dos líneas) para que la franja sea más baja. */}
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap">
          <button
            type="button"
            onClick={() => setUniendo(true)}
            aria-label="Unirme con un código"
            className={cx(claseBoton, compacto ? "min-h-11" : "min-h-12", "bg-acento text-acento-tinta shadow-sm", "cel:min-h-11 cel:rounded-xl cel:text-sm")}
          >
            <span className="cel:hidden">Unirme con un código</span>
            <span className="hidden cel:inline">Unirme con código</span>
          </button>
          <button
            type="button"
            onClick={() => {
              ocultarAvisoSinFamilia();
              setOculto(true);
            }}
            aria-label="Usar sólo en este equipo"
            className={cx(claseBoton, compacto ? "min-h-11" : "min-h-12", "bg-superficie text-tinta", "cel:min-h-11 cel:rounded-xl cel:text-sm")}
          >
            <span className="cel:hidden">Usar sólo en este equipo</span>
            <span className="hidden cel:inline">Usar sólo aquí</span>
          </button>
        </div>
        {/* En la pared, la línea del ícono va abajo a todo lo ancho: así cabe en una sola línea. */}
        {icono && compacto && (
          <p className="w-full text-base" data-texto="icono">
            {textoIconoCorto()}
          </p>
        )}
        {conPorQue && (
          <p id={idPorQue} hidden={!porQue} className="w-full text-base cel:text-[0.8125rem] cel:leading-snug" data-texto="icono-por-que">
            {textoIconoPorQue()}
          </p>
        )}
      </section>
      {uniendo && <UnirseConCodigoModal alCerrar={() => setUniendo(false)} />}
    </>
  );
}

/** "Listo: este equipo quedó unido" después de la recarga que sigue a unirse o a crear la familia. */
export function AvisoRecienUnido() {
  const { nube } = useDatos();
  // Se lee una vez al abrir y se borra enseguida: es para esta recarga, no para la próxima.
  const [como, setComo] = useState(leerRecienUnido);
  const [safariIOS] = useState(() => esIPhoneOIPad() && !esIconoDeInicioIOS());
  useEffect(() => olvidarRecienUnido(), []);
  if (!nube || !como) return null;

  return (
    <section
      aria-label="Equipo unido a la familia"
      data-aviso="recien-unido"
      className="mx-3 mb-2 flex items-start gap-3 rounded-2xl border-2 border-ok/40 bg-superficie px-4 py-3 md:mx-4 cel:mx-4 cel:gap-2 cel:px-3 cel:py-2"
    >
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-lg font-extrabold">
          {como === "creada"
            ? `✅ Listo: «${nube.familia.nombre}» quedó en la nube. Para sumar otro equipo: ${DONDE_INVITAR}.`
            : `✅ Listo: este equipo quedó unido a «${nube.familia.nombre}».`}
        </p>
        {safariIOS && (
          <p className="text-base">
            Si la quieres como app: Compartir → Agregar a pantalla de inicio, y desde el ícono únete de nuevo con otro código (lo
            pides aquí mismo: {DONDE_INVITAR}). El ícono no comparte lo de Safari.
          </p>
        )}
      </div>
      <button type="button" onClick={() => setComo(null)} aria-label="Cerrar aviso" className="min-h-11 min-w-11 rounded-xl text-xl">
        ✕
      </button>
    </section>
  );
}
