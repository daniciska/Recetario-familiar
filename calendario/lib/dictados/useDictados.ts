"use client";

// «🎙️ Dictadas» en React:
// - useMotorDictados(): va en el Panel (components/App.tsx). Con nube, enciende lo automático de
//   lib/dictados/motor.ts (subir los audios que quedaron en el equipo, reintentos solos, marcar como
//   guardados), así corre en cualquier pestaña y no sólo con Recetas abierta.
// - useDictados(activo): la pantalla de Recetas. Lee el estado del motor (la lista de la nube y los audios del
//   equipo), esconde los dictados cuya receta ya está en Recetas y da las acciones. Al abrirse mira la lista.
// Lo que decide va en funciones puras (lib/dictados/reglas.ts) y el motor se prueba sin React
// (pruebas/recetas/cliente.test.ts).

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useDatos } from "../store";
import type { ResultadoDescarte, ResultadoSubida } from "./cliente";
import { motorDictados } from "./motor";
import type { ResumenLocal } from "./pendientes";
import { yaGuardados } from "./reglas";
import type { DictadoPublico, EstadoGemini } from "./tipos";

export interface LocalVista extends ResumenLocal {
  subiendo: boolean;
}

export interface EstadoDictados {
  /** Los de la nube, del más nuevo al más viejo, sin los que ya están guardados como receta. */
  dictados: DictadoPublico[];
  /** Audios que siguen sólo en este equipo. */
  locales: LocalVista[];
  /** ¿Hay clave de Gemini? null: todavía no se sabe. */
  gemini: EstadoGemini | null;
  /** La última vez no se pudo hablar con la nube. */
  sinConexion: boolean;
  /** Ya se leyó la lista al menos una vez. */
  cargado: boolean;
  refrescar: () => Promise<void>;
  /** «Intentar de nuevo» / (otraVez) «Pedir otra versión». null: ya no existe. Lanza RechazoDictado o SinConexion. */
  procesar: (id: string, otraVez?: boolean) => Promise<DictadoPublico | null>;
  /**
   * Descarta el borrador en la nube y en el equipo (DELETE ?borrador=1). "guardada": otro equipo ya guardó
   * la receta y no se borró nada. Lanza SinConexion si no se pudo descartar en la nube.
   */
  descartar: (id: string) => Promise<ResultadoDescarte>;
  /** Sube los audios del equipo que se suben solos. Devuelve cuántos subió. */
  subirLocales: () => Promise<number>;
  /** «Subir ahora» (también uno que la nube rechazó antes). null: ya no está en el equipo. */
  subirLocal: (id: string) => Promise<ResultadoSubida | null>;
}

/** Lo automático de Dictadas para toda la app. Va una vez, en el Panel. Sin nube no hace nada. */
export function useMotorDictados(): void {
  const { estado, nube } = useDatos();
  const recetas = useRef(estado.recetas);
  useEffect(() => {
    recetas.current = estado.recetas;
  }, [estado.recetas]);
  const hayNube = !!nube;
  useEffect(() => {
    if (!hayNube) return;
    return motorDictados.encender({ recetaIds: () => new Set(recetas.current.map((r) => r.id)) });
  }, [hayNube]);
}

/** `activo`: la pantalla que lo usa está a la vista (sin nube no muestra nada). */
export function useDictados(activo: boolean): EstadoDictados {
  const { estado, nube } = useDatos();
  const encendido = activo && !!nube;
  const m = useSyncExternalStore(motorDictados.suscribir, motorDictados.leer, motorDictados.leer);

  // Al abrir la pantalla se mira la lista (lo demás lo hace el motor solo).
  useEffect(() => {
    if (encendido) void motorDictados.refrescar();
  }, [encendido]);

  const recetaIds = useMemo(() => new Set(estado.recetas.map((r) => r.id)), [estado.recetas]);
  const dictados = useMemo(() => {
    // Recién guardada una receta dictada, su dictado se esconde al tiro (el motor lo marca como guardado
    // cuando la nube confirma la receta; si el guardado falla, la receta se deshace y vuelve a aparecer).
    const sobran = new Set(yaGuardados(m.lista?.dictados ?? [], recetaIds).map((d) => d.id));
    return (m.lista?.dictados ?? []).filter((d) => !sobran.has(d.id));
  }, [m.lista, recetaIds]);
  const locales = useMemo(() => {
    // Un audio que ya aparece en la nube (se subió desde otra pestaña y la copia aún no se borra) no se repite.
    const enNube = new Set((m.lista?.dictados ?? []).map((d) => d.id));
    return m.locales.filter((p) => !enNube.has(p.id)).map((p) => ({ ...p, subiendo: m.subiendo.includes(p.id) }));
  }, [m.lista, m.locales, m.subiendo]);

  return {
    dictados: encendido ? dictados : [],
    locales: encendido ? locales : [],
    gemini: encendido ? (m.lista?.gemini ?? null) : null,
    sinConexion: m.sinConexion,
    cargado: m.lista !== null,
    refrescar: motorDictados.refrescar,
    procesar: motorDictados.procesar,
    descartar: motorDictados.descartar,
    subirLocales: motorDictados.subirLocales,
    subirLocal: motorDictados.subirLocal,
  };
}
