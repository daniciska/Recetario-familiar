"use client";

import { useCallback, useEffect, useState } from "react";
import { ProveedorDatos, useDatos } from "@/lib/store";
import { useAhora, useClima, useModoPared, useRecargaDiaria, useTema, useWakeLock } from "@/lib/hooks";
import BarraSuperior, { PantallaCompleta } from "./BarraSuperior";
import VistaCalendario from "./VistaCalendario";
import VistaComidas from "./VistaComidas";
import VistaRecetas from "./VistaRecetas";
import VistaCompras from "./VistaCompras";
import VistaTareas from "./VistaTareas";
import VistaAjustes from "./VistaAjustes";
import { cx } from "./ui";

export type Pestana = "calendario" | "comidas" | "recetas" | "compras" | "tareas" | "ajustes";

const PESTANAS: { id: Pestana; icono: string; texto: string }[] = [
  { id: "calendario", icono: "📅", texto: "Calendario" },
  { id: "comidas", icono: "🍽️", texto: "Menú" },
  { id: "recetas", icono: "📖", texto: "Recetas" },
  { id: "compras", icono: "🛒", texto: "Compras" },
  { id: "tareas", icono: "✅", texto: "Tareas" },
  { id: "ajustes", icono: "⚙️", texto: "Familia" },
];

export default function App() {
  return (
    <ProveedorDatos>
      <Panel />
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

  const [pestana, setPestana] = useState<Pestana>("calendario");
  useEffect(() => {
    setPestana(leerHash());
    const f = () => setPestana(leerHash());
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  const ir = useCallback((p: Pestana) => {
    history.replaceState(null, "", p === "calendario" ? location.pathname : `#${p}`);
    setPestana(p);
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
  }, [modoPared, ir]);

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
        {errorGuardado && (
          <div role="alert" className="mx-3 mb-2 flex items-center gap-3 rounded-2xl bg-red-600/15 px-4 py-2 text-lg font-bold text-red-700 noche:text-red-300 md:mx-4">
            <span className="flex-1">{errorGuardado}</span>
            <button type="button" onClick={cerrarError} aria-label="Cerrar aviso" className="min-h-11 min-w-11 rounded-xl text-xl">
              ✕
            </button>
          </div>
        )}
        <main className="min-h-0 flex-1 overflow-hidden px-3 pb-3 md:px-4 md:pb-4">
          {pestana === "calendario" && (
            <VistaCalendario key={reinicio} hoy={ahora.fecha} clima={clima} alIrAMenu={() => ir("comidas")} />
          )}
          {pestana === "comidas" && <VistaComidas hoy={ahora.fecha} alIrACompras={() => ir("compras")} />}
          {pestana === "recetas" && <VistaRecetas />}
          {pestana === "compras" && <VistaCompras />}
          {pestana === "tareas" && <VistaTareas />}
          {pestana === "ajustes" && <VistaAjustes />}
        </main>
      </div>

      {/* Barra inferior (teléfono) */}
      <nav className="grid shrink-0 grid-cols-6 border-t border-borde bg-superficie pb-[env(safe-area-inset-bottom)] md:hidden">
        {PESTANAS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => ir(p.id)}
            className={cx(
              "flex min-h-16 flex-col items-center justify-center gap-0.5 text-xs font-bold",
              pestana === p.id ? "text-acento" : "text-tinta-suave",
            )}
          >
            <span className={cx("text-2xl transition", pestana === p.id && "scale-110")}>{p.icono}</span>
            {p.texto}
          </button>
        ))}
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
