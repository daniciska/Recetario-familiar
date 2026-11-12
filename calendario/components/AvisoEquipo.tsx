"use client";

// Avisos de arriba, en todas las pestañas, sobre si este equipo está unido a la familia en la nube:
// - sin unir: lo que se ve es la familia de ejemplo (inventada) o una copia que vive sólo aquí. En el
//   iPhone pasa al abrir el ícono de la pantalla de inicio después de unirse en Safari (cada uno guarda
//   sus datos aparte), y asusta: parecen los eventos de otra familia.
// - recién unido (o recién creada la familia): lo confirma y, en Safari del iPhone, cómo dejarla como app.

import { useEffect, useState } from "react";
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
import { DONDE_INVITAR, UnirseConCodigoModal, textoIconoIOS } from "./Nube";
import { Boton, cx } from "./ui";

/** Franja de "este equipo no está unido a la familia". En la pared, lo más baja posible. */
export function AvisoSinFamilia({ compacto }: { compacto: boolean }) {
  const { estado, nube } = useDatos();
  const [oculto, setOculto] = useState(avisoSinFamiliaOculto);
  const [icono] = useState(esIconoDeInicioIOS);
  const [uniendo, setUniendo] = useState(false);
  if (nube || oculto) return null;
  const ejemplo = esFamiliaDeEjemplo(estado);

  return (
    <section
      aria-label="Este equipo no está unido a la familia"
      data-aviso="sin-familia"
      className={cx(
        "mx-3 mb-2 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border-2 border-acento/40 bg-acento-suave md:mx-4",
        compacto ? "px-3 py-1.5" : "px-4 py-3",
      )}
    >
      <div className="min-w-0 flex-[1_1_20rem] space-y-1">
        <p className={cx("font-extrabold", compacto ? "text-base" : "text-lg")}>
          {ejemplo
            ? "👋 Este equipo todavía no está unido a tu familia: lo que ves es una familia de ejemplo (inventada)."
            : "☁️ Este equipo no está unido a la familia en la nube: los cambios quedan sólo aquí."}
        </p>
        {icono && <p className="text-base">{textoIconoIOS()}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Boton variante="primario" onClick={() => setUniendo(true)} className={cx(compacto && "min-h-11 text-base")}>
          Unirme con un código
        </Boton>
        <Boton
          onClick={() => {
            ocultarAvisoSinFamilia();
            setOculto(true);
          }}
          className={cx("bg-superficie", compacto && "min-h-11 text-base")}
        >
          Usar sólo en este equipo
        </Boton>
      </div>
      {uniendo && <UnirseConCodigoModal alCerrar={() => setUniendo(false)} />}
    </section>
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
      className="mx-3 mb-2 flex items-start gap-3 rounded-2xl border-2 border-ok/40 bg-superficie px-4 py-3 md:mx-4"
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
