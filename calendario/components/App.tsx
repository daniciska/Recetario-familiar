"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ProveedorDatos, useDatos } from "@/lib/store";
import { ProveedorCandado, useCandado } from "@/lib/candado";
import { useAhora, useClima, useModoPared, useRecargaDiaria, useTema, useWakeLock } from "@/lib/hooks";
import { useMotorDictados } from "@/lib/dictados/useDictados";
import BarraSuperior, { PantallaCompleta } from "./BarraSuperior";
import VistaCalendario from "./VistaCalendario";
import VistaComidas from "./VistaComidas";
import VistaRecetas from "./VistaRecetas";
import VistaCompras from "./VistaCompras";
import VistaTareas from "./VistaTareas";
import VistaAjustes from "./VistaAjustes";
import { cx } from "./ui";
import { UnirseModal } from "./Nube";
import { AvisoRecienUnido, AvisoSinFamilia } from "./AvisoEquipo";

export type Pestana = "calendario" | "comidas" | "recetas" | "compras" | "tareas" | "ajustes";

// `iconoCel`: en la barra del teléfono. 📅 dibuja «July 17» (una fecha cualquiera) y ahí se lee mal.
const PESTANAS: { id: Pestana; icono: string; iconoCel?: string; texto: string }[] = [
  { id: "calendario", icono: "📅", iconoCel: "🗓️", texto: "Calendario" },
  { id: "comidas", icono: "🍽️", texto: "Menú" },
  { id: "recetas", icono: "📖", texto: "Recetas" },
  { id: "compras", icono: "🛒", texto: "Compras" },
  { id: "tareas", icono: "✅", texto: "Tareas" },
  { id: "ajustes", icono: "⚙️", texto: "Familia" },
];

export default function App() {
  return (
    <ProveedorDatos>
      <ProveedorCandado>
        <Panel />
      </ProveedorCandado>
    </ProveedorDatos>
  );
}

function leerHash(): Pestana {
  const h = (typeof window !== "undefined" ? window.location.hash.slice(1) : "") as Pestana;
  return PESTANAS.some((p) => p.id === h) ? h : "calendario";
}

const INACTIVIDAD = 5 * 60_000;

function Panel() {
  const { estado, errorGuardado, cerrarError, sinGuardar } = useDatos();
  const ahora = useAhora();
  const clima = useClima(estado.ajustes.latitud, estado.ajustes.longitud);
  const [modoPared] = useModoPared();
  useTema(estado.ajustes, ahora.minutosDelDia);
  useWakeLock(true);
  useRecargaDiaria(ahora, "03:30", sinGuardar);
  // «Dictar receta»: los audios que quedaron en el equipo se suben y lo que falló se reintenta solo en
  // cualquier pestaña (no sólo con Recetas abierta). Sin nube no hace nada.
  useMotorDictados();

  const { proteger, cerrar: cerrarCandado } = useCandado();
  const [pestana, setPestana] = useState<Pestana>("calendario");
  const ir = useCallback(
    (p: Pestana) => {
      const cambiar = () => {
        history.replaceState(null, "", p === "calendario" ? location.pathname : `#${p}`);
        setPestana(p);
      };
      // Los ajustes de la familia (integrantes, PIN, respaldo) piden el PIN en la pared.
      if (p === "ajustes") proteger(cambiar);
      else cambiar();
    },
    [proteger],
  );
  // La pestaña sale de la dirección (#compras…). Llegar a #ajustes (recarga, enlace) también pide
  // el PIN; una vez adentro, no se echa a nadie aunque venza el desbloqueo.
  const irRef = useRef(ir);
  useEffect(() => {
    irRef.current = ir;
  }, [ir]);
  // Enlace de invitación (QR): …/#unirse=CÓDIGO
  const [unirse, setUnirse] = useState<string | null>(null);
  useEffect(() => {
    const f = () => {
      const inv = /^#unirse=([A-Za-z0-9-]+)$/.exec(window.location.hash);
      if (inv) {
        history.replaceState(null, "", location.pathname);
        setPestana("calendario");
        setUnirse(inv[1].toUpperCase().replace(/[^A-Z0-9]/g, ""));
        return;
      }
      const h = leerHash();
      if (h === "ajustes") {
        history.replaceState(null, "", location.pathname);
        setPestana("calendario");
        irRef.current("ajustes");
      } else setPestana(h);
    };
    f();
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);

  // Modo pared: si nadie toca la pantalla en 5 minutos, vuelve al calendario de esta semana.
  // Sólo en el equipo marcado como pantalla de pared (nunca en el teléfono), y nunca si hay
  // una ventana abierta (una receta mientras se cocina, un formulario a medio llenar).
  const [reinicio, setReinicio] = useState(0);
  useEffect(() => {
    if (!modoPared) return;
    let ultimo = Date.now();
    let yaVolvio = false;
    const actividad = () => {
      ultimo = Date.now();
      yaVolvio = false;
    };
    const alVisible = () => document.visibilityState === "visible" && actividad();
    const t = setInterval(() => {
      if (yaVolvio || document.hidden || Date.now() - ultimo < INACTIVIDAD) return;
      if (document.querySelector('[role="dialog"]')) return;
      yaVolvio = true;
      cerrarCandado(); // lo que se abrió con el PIN vuelve a quedar cerrado
      ir("calendario");
      setReinicio((n) => n + 1); // vuelve a semana / hoy / sin filtro
    }, 10_000);
    const opciones = { capture: true, passive: true } as const;
    window.addEventListener("pointerdown", actividad, opciones);
    window.addEventListener("keydown", actividad, opciones);
    window.addEventListener("wheel", actividad, opciones);
    document.addEventListener("visibilitychange", alVisible);
    return () => {
      clearInterval(t);
      window.removeEventListener("pointerdown", actividad, opciones);
      window.removeEventListener("keydown", actividad, opciones);
      window.removeEventListener("wheel", actividad, opciones);
      document.removeEventListener("visibilitychange", alVisible);
    };
  }, [modoPared, ir, cerrarCandado]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden md:flex-row">
      {/* Riel lateral (tablet / pantalla de pared) */}
      <nav className="desliza hidden w-28 shrink-0 flex-col items-center gap-2 overflow-y-auto border-r border-borde bg-superficie py-4 pl-[env(safe-area-inset-left)] md:flex [@media(max-height:620px)]:gap-1 [@media(max-height:620px)]:py-2">
        {PESTANAS.map((p) => (
          <BotonPestana key={p.id} p={p} activa={pestana === p.id} onClick={() => ir(p.id)} />
        ))}
        <div className="mt-auto pt-2">
          <PantallaCompleta />
        </div>
      </nav>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <BarraSuperior ahora={ahora} clima={clima} alIrAMenu={() => ir("comidas")} />
        {/* Sin unir a la familia en la nube se ve la familia de ejemplo: que nadie crea que es otra familia. */}
        <AvisoSinFamilia compacto={modoPared} />
        <AvisoRecienUnido />
        {errorGuardado && (
          <div role="alert" className="mx-3 mb-2 flex items-center gap-3 rounded-2xl bg-red-600/15 px-4 py-2 text-lg font-bold text-red-700 noche:text-red-300 md:mx-4 cel:mx-seguro cel:gap-2 cel:px-3 cel:py-1">
            <span className="flex-1">{errorGuardado}</span>
            <button type="button" onClick={cerrarError} aria-label="Cerrar aviso" className="min-h-11 min-w-11 rounded-xl text-xl">
              ✕
            </button>
          </div>
        )}
        {/* Celular: márgenes de 16 px, como una app de teléfono (más, en horizontal, si la muesca los tapa). */}
        <main className="min-h-0 flex-1 overflow-hidden px-3 pb-3 md:px-4 md:pb-4 cel:px-seguro cel:pb-2">
          {pestana === "calendario" && (
            <VistaCalendario key={reinicio} hoy={ahora.fecha} clima={clima} alIrAMenu={() => ir("comidas")} />
          )}
          {pestana === "comidas" && <VistaComidas hoy={ahora.fecha} alIrACompras={() => ir("compras")} />}
          {pestana === "recetas" && <VistaRecetas />}
          {pestana === "compras" && <VistaCompras />}
          {pestana === "tareas" && <VistaTareas hoy={ahora.fecha} />}
          {pestana === "ajustes" && <VistaAjustes />}
        </main>
      </div>

      {unirse && <UnirseModal codigo={unirse} alCerrar={() => setUnirse(null)} />}

      {/* Barra inferior (teléfono): 52 px más la zona segura (abajo y, en horizontal, a los lados); la pestaña
          activa con una píldora detrás del ícono (el emoji no se puede teñir) y la etiqueta (12 px) en el color
          de acento. Cada pestaña mide lo que su etiqueta y reparte lo que sobra: así «Calendario» no se corta en
          un teléfono angosto (en seis partes iguales de 320 o 375 px no cabe). */}
      <nav className="flex shrink-0 border-t border-borde bg-superficie pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] md:hidden">
        {PESTANAS.map((p) => {
          const activa = pestana === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => ir(p.id)}
              aria-current={activa ? "page" : undefined}
              className={cx(
                "flex min-h-13 min-w-11 flex-[1_1_auto] flex-col items-center justify-center gap-0.5 pt-1 text-[0.75rem] font-bold leading-tight",
                activa ? "text-acento" : "text-tinta-suave",
              )}
            >
              <span
                aria-hidden
                className={cx(
                  "flex h-7 w-12 items-center justify-center rounded-full text-[1.375rem] leading-none transition",
                  activa ? "bg-acento-suave" : "opacity-85",
                )}
              >
                {p.iconoCel ?? p.icono}
              </span>
              <span className="max-w-full truncate px-0.5">{p.texto}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

function BotonPestana({
  p,
  activa,
  onClick,
}: {
  p: (typeof PESTANAS)[number];
  activa: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={activa ? "page" : undefined}
      className={cx(
        "flex w-22 shrink-0 flex-col items-center gap-1 rounded-2xl py-3 text-sm font-extrabold transition active:scale-95 [@media(max-height:620px)]:py-1.5",
        activa ? "bg-acento text-acento-tinta shadow" : "text-tinta-suave",
      )}
    >
      <span className="text-3xl">{p.icono}</span>
      {p.texto}
    </button>
  );
}
