"use client";

import { useEffect, useState } from "react";
import { useDatos } from "@/lib/store";
import { fechaLarga, type Ahora } from "@/lib/fechas";
import { iconoClima, type Clima } from "@/lib/hooks";
import { claveComida } from "@/lib/compras";
import { TIPOS_COMIDA, nombreComida } from "@/lib/comidas";
import { BotonIcono } from "./ui";

export default function BarraSuperior({
  ahora,
  clima,
  alIrAMenu,
}: {
  ahora: Ahora;
  clima: Clima | null;
  alIrAMenu: () => void;
}) {
  const { estado } = useDatos();
  const fecha = fechaLarga(ahora.fecha);
  const ci = clima ? iconoClima(clima.codigo) : null;

  // Qué se cocina hoy: almuerzo y cena primero (lo que más importa en la casa).
  const recetas = new Map(estado.recetas.map((r) => [r.id, r]));
  const hoyComidas = TIPOS_COMIDA.map((t) => {
    const c = estado.plan[claveComida(ahora.fecha, t.id)];
    return c ? { tipo: t, nombre: nombreComida(c, recetas), emoji: c.recetaId ? recetas.get(c.recetaId)?.emoji : "🍴" } : null;
  }).filter((x): x is NonNullable<typeof x> => !!x && !!x.nombre);
  const destacadas = [
    ...hoyComidas.filter((c) => c.tipo.id === "almuerzo" || c.tipo.id === "cena"),
    ...hoyComidas.filter((c) => c.tipo.id !== "almuerzo" && c.tipo.id !== "cena"),
  ].slice(0, 2);

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 xl:gap-x-6 px-3 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))] md:flex-nowrap md:px-4 md:pt-4">
      {/* Hora y fecha */}
      <div className="flex items-baseline gap-4">
        <span className="num font-display text-5xl font-semibold leading-none tracking-tight md:text-6xl 2xl:text-7xl">
          {ahora.hora}
        </span>
        <div className="leading-tight">
          <div className="whitespace-nowrap text-xl font-extrabold first-letter:uppercase md:text-2xl 2xl:text-3xl">{fecha}</div>
          <div className="text-base font-bold text-tinta-suave md:text-xl">{estado.ajustes.nombreFamilia}</div>
        </div>
      </div>

      {/* Clima */}
      {clima && ci && (
        <div className="flex items-center gap-2 rounded-3xl bg-superficie px-3 py-2 md:px-4">
          <span className="text-3xl md:text-5xl" aria-hidden>
            {ci.icono}
          </span>
          <div className="leading-tight">
            <div className="num text-2xl font-extrabold md:text-3xl">{clima.actual}°</div>
            <div className="num text-sm font-bold text-tinta-suave max-sm:hidden md:text-base">
              {clima.max}° / {clima.min}°
              {clima.lluvia >= 30 && <span className="ml-1.5 whitespace-nowrap">💧{clima.lluvia}%</span>}
            </div>
          </div>
        </div>
      )}

      {/* Hoy se cocina */}
      <button
        type="button"
        onClick={alIrAMenu}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-3xl bg-acento-suave px-3 py-2 md:gap-3 md:px-4 text-left transition active:scale-[0.99] md:min-w-64"
      >
        <span className="text-3xl md:text-4xl" aria-hidden>
          {destacadas[0]?.emoji ?? "🍳"}
        </span>
        <div className="min-w-0 leading-tight">
          <div className="truncate text-sm font-extrabold uppercase tracking-wide text-acento md:text-base">
            {destacadas[0] ? `Hoy · ${destacadas[0].tipo.nombre}` : "Hoy se cocina"}
          </div>
          {destacadas.length === 0 ? (
            <div className="truncate text-lg font-bold text-tinta-suave md:text-xl">Nada planificado · toca para elegir</div>
          ) : (
            <>
              <div className="line-clamp-2 text-xl font-extrabold leading-tight 2xl:text-2xl">{destacadas[0].nombre}</div>
              {destacadas[1] && (
                <div className="truncate text-base font-bold text-tinta-suave">
                  {destacadas[1].tipo.nombre}: {destacadas[1].nombre}
                </div>
              )}
            </>
          )}
        </div>
      </button>

      <PantallaCompleta />
    </header>
  );
}

function PantallaCompleta() {
  const [puede, setPuede] = useState(false);
  const [activa, setActiva] = useState(false);
  useEffect(() => {
    setPuede(!!document.documentElement.requestFullscreen);
    const f = () => setActiva(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", f);
    return () => document.removeEventListener("fullscreenchange", f);
  }, []);
  if (!puede) return null;
  return (
    <BotonIcono
      etiqueta={activa ? "Salir de pantalla completa" : "Pantalla completa"}
      className="max-md:hidden"
      onClick={() =>
        activa ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {})
      }
    >
      {activa ? "🗗" : "⛶"}
    </BotonIcono>
  );
}
