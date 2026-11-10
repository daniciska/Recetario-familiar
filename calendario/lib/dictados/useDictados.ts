"use client";

// Estado de «🎙️ Dictadas» para la pantalla de Recetas: la lista de la nube, los audios que siguen sólo en
// este equipo y lo que la app hace sola:
// - mira la lista al abrir, al volver a la app, al volver internet y después de cada acción; mientras algo
//   esté en cola, con Gemini o subiéndose, cada 20 s (y, si hay un error con hora, a esa hora);
// - sube los audios que quedaron en el equipo (de a uno; nunca dos veces el mismo en esta pestaña);
// - vuelve a pedir «procesar» sola, una vez por cada (id, actualizado), según debeReintentar();
// - oculta los dictados cuya receta (rec_<id>) ya está en Recetas y los marca como guardados (limpieza).
// Lo que decide va en funciones puras (lib/dictados/reglas.ts), que prueba pruebas/recetas/cliente.test.ts.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDatos } from "../store";
import { SinConexion } from "../datos/nube";
import * as cliente from "./cliente";
import type { ResultadoSubida } from "./cliente";
import * as pendientes from "./pendientes";
import type { ResumenLocal } from "./pendientes";
import { CADA_LOCALES_MS, debeReintentar, proximaRevision, subeSolo, yaGuardados } from "./reglas";
import { MAX_PENDIENTES, type DictadoPublico, type EstadoGemini, type ListaDictados } from "./tipos";

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
  /** Borra en la nube y en el equipo. Lanza SinConexion si no se pudo borrar en la nube. */
  descartar: (id: string) => Promise<void>;
  /** Sube los audios del equipo que se suben solos. Devuelve cuántos subió. */
  subirLocales: () => Promise<number>;
  /** «Subir ahora» (también uno que la nube rechazó antes). null: ya no está en el equipo. */
  subirLocal: (id: string) => Promise<ResultadoSubida | null>;
}

/** `activo`: la pantalla que lo usa está a la vista (sin nube no hace nada). */
export function useDictados(activo: boolean): EstadoDictados {
  const { estado, nube } = useDatos();
  const encendido = activo && !!nube;
  const [lista, setLista] = useState<ListaDictados | null>(null);
  const [locales, setLocales] = useState<ResumenLocal[]>([]);
  const [subiendoIds, setSubiendoIds] = useState<string[]>([]);
  const [sinConexion, setSinConexion] = useState(false);

  const vivo = useRef(true);
  const encendidoRef = useRef(encendido);
  const listaRef = useRef<ListaDictados | null>(null);
  const pedidos = useRef(new Set<string>()); // `${id}|${actualizado}` que ya se pidieron solos
  const veces = useRef(new Map<string, number>());
  const limpiados = useRef(new Set<string>());
  const corriendo = useRef<Promise<void> | null>(null);
  const otraVuelta = useRef(false);
  const recetaIds = useMemo(() => new Set(estado.recetas.map((r) => r.id)), [estado.recetas]);
  const recetaIdsRef = useRef(recetaIds);

  useEffect(() => {
    encendidoRef.current = encendido;
    recetaIdsRef.current = recetaIds;
  }, [encendido, recetaIds]);

  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);

  const ponerLista = useCallback((l: ListaDictados | null) => {
    listaRef.current = l;
    if (vivo.current) setLista(l);
  }, []);

  const leerLocales = useCallback(async () => {
    const l = await pendientes.resumenes();
    if (vivo.current) setLocales(l);
    return l;
  }, []);

  const subirUno = useCallback(async (id: string): Promise<ResultadoSubida | null> => {
    const p = await pendientes.leer(id);
    if (!p) return null;
    if (vivo.current) setSubiendoIds((s) => (s.includes(id) ? s : [...s, id]));
    try {
      return await cliente.subirPendiente(p);
    } finally {
      if (vivo.current) setSubiendoIds((s) => s.filter((x) => x !== id));
    }
  }, []);

  /** Limpieza: los listos cuya receta ya se guardó (si falla, se reintenta en la próxima vuelta). */
  const limpiar = useCallback((dictados: DictadoPublico[]) => {
    for (const d of yaGuardados(dictados, recetaIdsRef.current)) {
      if (limpiados.current.has(d.id)) continue;
      limpiados.current.add(d.id);
      cliente.marcarGuardado(d.id, `rec_${d.id}`).catch(() => limpiados.current.delete(d.id));
    }
  }, []);

  const subidaEnCurso = useRef<Promise<number> | null>(null);
  /** Cuándo falló por última vez una subida sola por falta de red (0: no falló o volvió internet). */
  const falloSubida = useRef(0);
  const subirLocales = useCallback(async () => {
    if (subidaEnCurso.current) return subidaEnCurso.current;
    subidaEnCurso.current = (async () => {
      let subidos = 0;
      try {
        const hayCupo = (listaRef.current?.dictados.length ?? 0) < MAX_PENDIENTES;
        for (const p of await pendientes.resumenes()) {
          if (!vivo.current) break;
          if (cliente.subiendo(p.id) || !subeSolo(p, hayCupo)) continue;
          const r = await subirUno(p.id).catch(() => null);
          if (r?.ok) {
            subidos++;
            falloSubida.current = 0;
          } else if (r && r.motivo === "sin_conexion") {
            falloSubida.current = Date.now();
            break; // sin red no tiene sentido seguir con los demás
          }
        }
      } finally {
        await leerLocales();
      }
      return subidos;
    })().finally(() => (subidaEnCurso.current = null));
    return subidaEnCurso.current;
  }, [leerLocales, subirUno]);

  const vuelta = useCallback(async () => {
    const ls = await leerLocales();
    let l: ListaDictados;
    try {
      l = await cliente.listarDictados();
      if (vivo.current) setSinConexion(false);
    } catch (e) {
      if (vivo.current) setSinConexion(e instanceof SinConexion);
      return;
    }
    if (!vivo.current) return;
    ponerLista(l);
    limpiar(l.dictados);
    // Reintentos solos.
    const ahora = Date.now();
    const cambiados = new Map<string, DictadoPublico | null>();
    for (const d of l.dictados) {
      const k = `${d.id}|${d.actualizado}`;
      const n = veces.current.get(d.id) ?? 0;
      if (pedidos.current.has(k) || !debeReintentar(d, ahora, l.gemini, n)) continue;
      pedidos.current.add(k);
      veces.current.set(d.id, n + 1);
      try {
        cambiados.set(d.id, await cliente.procesarDictado(d.id));
      } catch {
        /* se vuelve a mirar en la próxima vuelta */
      }
    }
    if (cambiados.size && vivo.current) {
      const actual = listaRef.current ?? l;
      ponerLista({
        ...actual,
        dictados: actual.dictados.flatMap((d) => {
          if (!cambiados.has(d.id)) return [d];
          const c = cambiados.get(d.id);
          return c ? [c] : [];
        }),
      });
    }
    // Lo que quedó en el equipo (si recién falló por falta de red, se espera un rato o a que vuelva internet).
    const hayCupo = l.dictados.length < MAX_PENDIENTES;
    const toca = Date.now() - falloSubida.current >= CADA_LOCALES_MS;
    if (toca && ls.some((p) => !cliente.subiendo(p.id) && subeSolo(p, hayCupo)))
      void subirLocales().then((n) => {
        if (n) void refrescarRef.current();
      });
  }, [leerLocales, limpiar, ponerLista, subirLocales]);

  const refrescar = useCallback(async () => {
    if (!encendidoRef.current) return;
    if (corriendo.current) {
      otraVuelta.current = true;
      return corriendo.current;
    }
    corriendo.current = (async () => {
      do {
        otraVuelta.current = false;
        await vuelta();
      } while (otraVuelta.current && vivo.current && encendidoRef.current);
    })().finally(() => (corriendo.current = null));
    return corriendo.current;
  }, [vuelta]);
  const refrescarRef = useRef(refrescar);
  useEffect(() => {
    refrescarRef.current = refrescar;
  }, [refrescar]);

  // Al abrir, al volver a la app y al volver internet.
  useEffect(() => {
    if (!encendido) return;
    void refrescar();
    const alVolver = () => {
      if (document.visibilityState === "visible") void refrescar();
    };
    const alVolverInternet = () => {
      falloSubida.current = 0;
      alVolver();
    };
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("online", alVolverInternet);
    return () => {
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("online", alVolverInternet);
    };
  }, [encendido, refrescar]);

  // Mientras algo está en camino (o hay un error con hora), se vuelve a mirar.
  useEffect(() => {
    if (!encendido) return;
    const hayCupo = (lista?.dictados.length ?? 0) < MAX_PENDIENTES;
    const ms = proximaRevision(lista?.dictados ?? [], Date.now(), {
      subiendo: subiendoIds.length > 0,
      localesPorSubir: locales.some((p) => subeSolo(p, hayCupo)),
    });
    if (ms == null) return;
    const t = setTimeout(() => {
      if (document.visibilityState === "visible") void refrescar();
    }, ms);
    return () => clearTimeout(t);
  }, [encendido, lista, locales, subiendoIds, refrescar]);

  // Recién guardada una receta dictada: su dictado se oculta y se limpia sin esperar la próxima vuelta.
  useEffect(() => {
    if (lista) limpiar(lista.dictados);
  }, [lista, recetaIds, limpiar]);

  const procesar = useCallback(
    async (id: string, otraVez = false) => {
      const r = await cliente.procesarDictado(id, otraVez);
      const actual = listaRef.current;
      if (actual) ponerLista({ ...actual, dictados: r ? actual.dictados.map((d) => (d.id === id ? r : d)) : actual.dictados.filter((d) => d.id !== id) });
      void refrescar();
      return r;
    },
    [ponerLista, refrescar],
  );

  const descartar = useCallback(
    async (id: string) => {
      const enNube = listaRef.current?.dictados.some((d) => d.id === id) ?? true;
      try {
        await cliente.descartarDictado(id);
      } catch (e) {
        // Un audio que nunca llegó a la nube ya quedó descartado al borrar la copia del equipo.
        if (!(e instanceof SinConexion) || enNube) throw e;
      }
      const actual = listaRef.current;
      if (actual) ponerLista({ ...actual, dictados: actual.dictados.filter((d) => d.id !== id) });
      await leerLocales();
      void refrescar();
    },
    [leerLocales, ponerLista, refrescar],
  );

  const subirLocal = useCallback(
    async (id: string) => {
      const r = await subirUno(id);
      await leerLocales();
      void refrescar();
      return r;
    },
    [leerLocales, refrescar, subirUno],
  );

  const dictados = useMemo(() => {
    const sobran = new Set(yaGuardados(lista?.dictados ?? [], recetaIds).map((d) => d.id));
    return (lista?.dictados ?? []).filter((d) => !sobran.has(d.id));
  }, [lista, recetaIds]);
  const enNube = useMemo(() => new Set((lista?.dictados ?? []).map((d) => d.id)), [lista]);
  const vistaLocales = useMemo(
    // Un audio que ya aparece en la nube (se subió desde otra pestaña y la copia aún no se borra) no se repite.
    () => locales.filter((p) => !enNube.has(p.id)).map((p) => ({ ...p, subiendo: subiendoIds.includes(p.id) || cliente.subiendo(p.id) })),
    [locales, enNube, subiendoIds],
  );

  return {
    dictados: encendido ? dictados : [],
    locales: encendido ? vistaLocales : [],
    gemini: encendido ? (lista?.gemini ?? null) : null,
    sinConexion,
    cargado: lista !== null,
    refrescar,
    procesar,
    descartar,
    subirLocales,
    subirLocal,
  };
}
