"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ahoraEnSantiago, horaAMinutos, sumarDias, type Ahora } from "./fechas";
import type { Ajustes } from "./datos/tipos";

/** Reloj en vivo (se actualiza cada segundo). */
export function useAhora(): Ahora {
  const [ahora, setAhora] = useState(() => ahoraEnSantiago());
  useEffect(() => {
    const t = setInterval(() => setAhora(ahoraEnSantiago()), 1000);
    return () => clearInterval(t);
  }, []);
  return ahora;
}

export function esDeNoche(ajustes: Ajustes, minutos: number): boolean {
  const desde = horaAMinutos(ajustes.nocheDesde);
  const hasta = horaAMinutos(ajustes.nocheHasta);
  return desde > hasta ? minutos >= desde || minutos < hasta : minutos >= desde && minutos < hasta;
}

/** Aplica el tema claro/noche al <html>. En "auto" cambia según la hora de Santiago. */
export function useTema(ajustes: Ajustes, minutos: number) {
  const noche = ajustes.tema === "noche" || (ajustes.tema === "auto" && esDeNoche(ajustes, minutos));
  useEffect(() => {
    document.documentElement.dataset.tema = noche ? "noche" : "claro";
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", noche ? "#1b1714" : "#fbf6ee");
  }, [noche]);
  return noche;
}

/** Mantiene la pantalla encendida mientras la app está visible (si el navegador lo permite). */
export function useWakeLock(activo = true) {
  useEffect(() => {
    if (!activo || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const pedir = async () => {
      try {
        if (document.visibilityState === "visible") lock = await navigator.wakeLock.request("screen");
      } catch {
        /* sin permiso: no pasa nada */
      }
    };
    pedir();
    const alVolver = () => document.visibilityState === "visible" && pedir();
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      document.removeEventListener("visibilitychange", alVolver);
      lock?.release().catch(() => {});
    };
  }, [activo]);
}

/**
 * Auto-refresco: recarga la página una vez al día de madrugada (toma versiones nuevas
 * del deploy y limpia memoria en tablets que pasan meses encendidos).
 *
 * Sólo recarga si el servidor responde (sin internet, recargar dejaría la pantalla de error
 * del navegador), si nadie tocó la pantalla en los últimos 2 minutos y si no hay cambios que
 * vivan sólo en memoria. Una ventana abierta la frena siempre, salvo de madrugada (entre `hora` y
 * las 06:00) si nadie la toca hace una hora: esa se da por olvidada y se limpia. `hora` debe ser
 * anterior a las 06:00. Si no se puede, lo reintenta cada 5 minutos; si el equipo
 * estaba suspendido a esa hora, lo intenta al despertar, cuando se cumplan esas condiciones.
 */
export function useRecargaDiaria(ahora: Ahora, hora = "03:30", bloqueada = false) {
  const [objetivo] = useState(() => `${ahora.hora < hora ? ahora.fecha : sumarDias(ahora.fecha, 1)} ${hora}`);
  const probando = useRef(false);
  const ultimoIntento = useRef(0);
  const ultimoToque = useRef(0);
  const bloqueadaRef = useRef(bloqueada);
  useEffect(() => {
    bloqueadaRef.current = bloqueada;
  }, [bloqueada]);

  useEffect(() => {
    ultimoToque.current = Date.now();
    const tocar = () => {
      ultimoToque.current = Date.now();
    };
    const alVisible = () => document.visibilityState === "visible" && tocar();
    const op = { capture: true, passive: true } as const;
    window.addEventListener("pointerdown", tocar, op);
    window.addEventListener("keydown", tocar, op);
    window.addEventListener("wheel", tocar, op);
    document.addEventListener("visibilitychange", alVisible);
    return () => {
      window.removeEventListener("pointerdown", tocar, op);
      window.removeEventListener("keydown", tocar, op);
      window.removeEventListener("wheel", tocar, op);
      document.removeEventListener("visibilitychange", alVisible);
    };
  }, []);

  useEffect(() => {
    const sePuede = () => {
      const quieto = Date.now() - ultimoToque.current;
      if (bloqueadaRef.current || document.hidden || quieto < 2 * 60_000) return false;
      // Una ventana olvidada (1 h sin tocar) sólo se limpia de madrugada; de día, una abierta
      // (una receta mientras se cocina, un formulario a medio llenar) siempre la frena.
      const h = ahoraEnSantiago().hora;
      const olvidada = h >= hora && h < "06:00" && quieto >= 60 * 60_000;
      if (document.querySelector('[role="dialog"]') && !olvidada) return false;
      return navigator.onLine !== false;
    };
    if (`${ahora.fecha} ${ahora.hora}` < objetivo) return;
    if (probando.current || Date.now() - ultimoIntento.current < 5 * 60_000 || !sePuede()) return;
    probando.current = true;
    ultimoIntento.current = Date.now();
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    fetch(location.pathname, { method: "HEAD", cache: "no-store", signal: ctrl.signal })
      .then((r) => {
        // Se vuelve a revisar: alguien pudo tocar la pantalla mientras se esperaba la respuesta.
        if (r.ok && sePuede()) window.location.reload();
      })
      .catch(() => {})
      .finally(() => {
        clearTimeout(t);
        probando.current = false;
      });
  }, [ahora, objetivo]);
}

/** Igual que la variante `md` de globals.css: ancho de tablet y alto suficiente (un teléfono horizontal no cuenta). */
export const MEDIA_TABLET = "(min-width: 48rem) and (min-height: 29rem)";

// ---------- Modo pared (ajuste de este equipo, no se comparte) ----------

const CLAVE_PARED = "calendario-familiar:equipo:pared";
const oyentesPared = new Set<() => void>();

/** Por defecto: pantalla táctil grande y apaisada (el tablet de la pared), nunca un teléfono. */
function paredPorDefecto(): boolean {
  return window.matchMedia("(min-width: 900px) and (min-height: 464px) and (pointer: coarse)").matches;
}

function leerPared(): boolean {
  try {
    const v = localStorage.getItem(CLAVE_PARED);
    if (v === "1") return true;
    if (v === "0") return false;
  } catch {
    /* sin almacenamiento */
  }
  return paredPorDefecto();
}

/**
 * "Este equipo es la pantalla de la pared": vuelve solo al calendario tras 5 minutos sin tocarlo.
 * Se guarda sólo en este equipo, para que el teléfono nunca lo herede.
 */
export function useModoPared(): [boolean, (v: boolean) => void] {
  const valor = useSyncExternalStore(
    (cb) => {
      oyentesPared.add(cb);
      return () => oyentesPared.delete(cb);
    },
    leerPared,
    () => false,
  );
  const cambiar = (v: boolean) => {
    try {
      localStorage.setItem(CLAVE_PARED, v ? "1" : "0");
    } catch {
      /* sin almacenamiento */
    }
    oyentesPared.forEach((f) => f());
  };
  return [valor, cambiar];
}

// ---------- Clima (Open-Meteo, sin clave) ----------

export interface Clima {
  actual: number;
  codigo: number;
  max: number;
  min: number;
  lluvia: number;
  dias: { fecha: string; codigo: number; max: number; min: number }[];
}

const CODIGOS: [number[], string, string][] = [
  [[0], "☀️", "Despejado"],
  [[1], "🌤️", "Mayormente despejado"],
  [[2], "⛅", "Parcial nublado"],
  [[3], "☁️", "Nublado"],
  [[45, 48], "🌫️", "Neblina"],
  [[51, 53, 55, 56, 57], "🌦️", "Llovizna"],
  [[61, 63, 65, 66, 67, 80, 81, 82], "🌧️", "Lluvia"],
  [[71, 73, 75, 77, 85, 86], "🌨️", "Nieve"],
  [[95, 96, 99], "⛈️", "Tormenta"],
];

export function iconoClima(codigo: number): { icono: string; texto: string } {
  const c = CODIGOS.find(([cs]) => cs.includes(codigo));
  return c ? { icono: c[1], texto: c[2] } : { icono: "🌡️", texto: "" };
}

export function useClima(lat: number, lon: number): Clima | null {
  const [clima, setClima] = useState<Clima | null>(null);
  useEffect(() => {
    let vivo = true;
    const cargar = async () => {
      try {
        const url =
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
          `&current=temperature_2m,weather_code` +
          `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
          `&timezone=America%2FSantiago&forecast_days=7`;
        const r = await fetch(url);
        if (!r.ok) return;
        const j = await r.json();
        if (!vivo) return;
        setClima({
          actual: Math.round(j.current.temperature_2m),
          codigo: j.current.weather_code,
          max: Math.round(j.daily.temperature_2m_max[0]),
          min: Math.round(j.daily.temperature_2m_min[0]),
          lluvia: j.daily.precipitation_probability_max?.[0] ?? 0,
          dias: j.daily.time.map((f: string, i: number) => ({
            fecha: f,
            codigo: j.daily.weather_code[i],
            max: Math.round(j.daily.temperature_2m_max[i]),
            min: Math.round(j.daily.temperature_2m_min[i]),
          })),
        });
      } catch {
        /* sin internet: se reintenta en el próximo ciclo */
      }
    };
    cargar();
    const t = setInterval(cargar, 30 * 60 * 1000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [lat, lon]);
  return clima;
}

/** En el teléfono, lleva la lista de días hasta "hoy" al abrir la vista. */
export function useIrAHoyEnMovil(dependencia: unknown) {
  useEffect(() => {
    if (window.matchMedia(MEDIA_TABLET).matches) return;
    document.querySelector("[data-hoy-movil]")?.scrollIntoView({ block: "start" });
  }, [dependencia]);
}
