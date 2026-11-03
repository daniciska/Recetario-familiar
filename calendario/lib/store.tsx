"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ConflictoVersion, crearRepositorio, type CalendarioConectado, type ClaveColeccion, type EstadoApp } from "./datos";
import { SinConexion, tomarAviso } from "./datos/nube";
import { normalizarGuardado } from "./datos/normalizar";
import { estadoEjemplo } from "./ejemplo";

interface Contexto {
  estado: EstadoApp;
  /**
   * Cambia una colección y la guarda. Devuelve true si el cambio quedó aplicado (guardado, o sólo en
   * memoria si el navegador no deja guardar: eso ya lo avisa el banner) y false si no cupo (se deshace).
   */
  actualizar: <K extends ClaveColeccion>(clave: K, fn: (previo: EstadoApp[K]) => EstadoApp[K]) => Promise<boolean>;
  /** Reemplaza todo. Devuelve false si no cupo (queda todo como estaba); true si quedó aplicado. */
  reemplazarTodo: (estado: EstadoApp) => Promise<boolean>;
  errorGuardado: string | null;
  cerrarError: () => void;
  /** Hay cambios que viven sólo en memoria (el navegador no guarda nada): recargar los perdería. */
  sinGuardar: boolean;
  /** Familia en la nube a la que está conectado este equipo (null: los datos viven sólo aquí). */
  nube: { familia: { id: string; nombre: string }; conectado: boolean; calendarios: CalendarioConectado[] } | null;
}

const Ctx = createContext<Contexto | null>(null);

const NOMBRES: Record<ClaveColeccion, string> = {
  ajustes: "los ajustes",
  miembros: "los integrantes",
  eventos: "los eventos",
  recetas: "las recetas",
  plan: "el menú",
  compras: "la lista de compras",
  tareas: "las tareas",
  premios: "los premios",
  estrellas: "las estrellas",
};

/** Sin almacenamiento, el aviso cerrado vuelve con el primer cambio pasado este rato (no en cada toque). */
const RECORDAR_AVISO = 10 * 60_000;

const AVISO_SIN_ALMACENAMIENTO =
  "Este navegador no deja guardar datos (modo privado o almacenamiento bloqueado): los cambios se perderán al recargar.";

export function ProveedorDatos({ children }: { children: React.ReactNode }) {
  const repo = useMemo(() => crearRepositorio(), []);
  const [estado, setEstado] = useState<EstadoApp | null>(null);
  const [errorGuardado, setError] = useState<string | null>(null);
  const estadoRef = useRef<EstadoApp | null>(null);
  /** Lo último que quedó guardado de verdad, para deshacer si un guardado falla. */
  const persistido = useRef<EstadoApp | null>(null);
  /** Colecciones que no se pudieron guardar y por qué ("lleno": no cupo en el equipo; "red": sin conexión con la nube). */
  const fallidas = useRef(new Map<ClaveColeccion, "lleno" | "red">());
  const [conectado, setConectado] = useState(true);
  const [calendarios, setCalendarios] = useState<CalendarioConectado[]>([]);
  const sinAlmacenamiento = useRef(false);
  /** Cuándo se cerró el aviso de "no se guarda" (0: nunca). */
  const avisoCerradoEn = useRef(0);

  const refrescarAviso = useCallback(() => {
    if (sinAlmacenamiento.current) return setError(AVISO_SIN_ALMACENAMIENTO);
    const lleno = [...fallidas.current].filter(([, m]) => m === "lleno").map(([c]) => NOMBRES[c]);
    const red = [...fallidas.current].filter(([, m]) => m === "red").map(([c]) => NOMBRES[c]);
    const partes = [
      lleno.length &&
        `No se pudieron guardar ${lleno.join(", ")}: el almacenamiento de este equipo está lleno. Prueba quitando fotos de recetas o usando fotos más chicas.`,
      red.length &&
        `No se pudieron guardar ${red.join(", ")}: no hay conexión con la nube. Revisa el wifi e inténtalo de nuevo; lo demás está a salvo.`,
    ].filter(Boolean);
    setError(partes.length ? partes.join(" ") : null);
  }, []);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const base = estadoEjemplo();
      let guardado: EstadoApp | null = null;
      const aviso = tomarAviso();
      try {
        guardado = await repo.cargar();
      } catch {
        sinAlmacenamiento.current = true;
      }
      const final = guardado ? normalizarGuardado(guardado, base.ajustes) : base;
      if (!vivo) return;
      // Primero se muestra la app; guardar no puede dejarla en "Cargando…".
      estadoRef.current = final;
      persistido.current = guardado ? final : null;
      setEstado(final);
      if (!guardado) {
        try {
          await repo.reemplazarTodo(final);
          persistido.current = final;
        } catch (e) {
          // Sin conexión con la nube no es "el navegador no guarda": se reintenta al guardar.
          if (!(e instanceof SinConexion)) sinAlmacenamiento.current = true;
        }
      }
      if (vivo) {
        refrescarAviso();
        if (aviso) setError(aviso);
      }
    })();
    const sinConexion = repo.alCambiarConexion?.((c) => vivo && setConectado(c));
    const sinCalendarios = repo.alCambiarCalendarios?.((c) => vivo && setCalendarios(c));
    const desuscribir = repo.suscribir((nuevo) => {
      const n = normalizarGuardado(nuevo, estadoEjemplo().ajustes);
      persistido.current = n;
      estadoRef.current = n;
      setEstado(n);
    });
    return () => {
      vivo = false;
      desuscribir();
      sinConexion?.();
      sinCalendarios?.();
    };
  }, [repo, refrescarAviso]);

  const actualizar = useCallback<Contexto["actualizar"]>(
    async (clave, fn) => {
      for (let intento = 0; ; intento++) {
        const previo = estadoRef.current;
        if (!previo) return false;
        const valor = fn(previo[clave]);
        const siguiente = { ...previo, [clave]: valor };
        estadoRef.current = siguiente;
        setEstado(siguiente);
        try {
          await repo.guardar(clave, valor);
          if (persistido.current) persistido.current = { ...persistido.current, [clave]: valor };
          if (fallidas.current.delete(clave)) refrescarAviso();
          return true;
        } catch (e) {
          // Otro equipo la cambió antes: se toma lo último de la nube y se vuelve a aplicar este cambio encima.
          if (e instanceof ConflictoVersion && intento < 4 && estadoRef.current) {
            const ultimo = normalizarGuardado({ [clave]: e.datos } as Partial<EstadoApp>, estadoRef.current.ajustes)[clave];
            estadoRef.current = { ...estadoRef.current, [clave]: ultimo };
            if (persistido.current) persistido.current = { ...persistido.current, [clave]: ultimo };
            continue;
          }
          // No hay dónde guardar: el cambio sigue en memoria y cuenta como hecho. Si cerraron el aviso,
          // vuelve con el primer cambio pasados unos minutos (no en cada casilla marcada, que en el
          // teléfono taparía la lista), para que nadie crea que quedó guardado.
          if (sinAlmacenamiento.current) {
            if (Date.now() - avisoCerradoEn.current >= RECORDAR_AVISO) refrescarAviso();
            return true;
          }
          // No cupo: se deshace para no mostrar algo que se perdería al recargar.
          const guardadoAntes = persistido.current?.[clave];
          if (guardadoAntes !== undefined && estadoRef.current) {
            const deshecho = { ...estadoRef.current, [clave]: guardadoAntes };
            estadoRef.current = deshecho;
            setEstado(deshecho);
          }
          fallidas.current.set(clave, e instanceof SinConexion ? "red" : "lleno");
          refrescarAviso();
          return false;
        }
      }
    },
    [repo, refrescarAviso],
  );

  const reemplazarTodo = useCallback(
    async (nuevo: EstadoApp) => {
      try {
        await repo.reemplazarTodo(nuevo);
      } catch {
        if (!sinAlmacenamiento.current) return false;
        estadoRef.current = nuevo; // sólo en memoria: se vuelve a mostrar el aviso
        setEstado(nuevo);
        refrescarAviso();
        return true;
      }
      persistido.current = nuevo;
      estadoRef.current = nuevo;
      setEstado(nuevo);
      fallidas.current.clear();
      refrescarAviso();
      return true;
    },
    [repo, refrescarAviso],
  );

  const cerrarError = useCallback(() => {
    fallidas.current.clear();
    if (sinAlmacenamiento.current) avisoCerradoEn.current = Date.now();
    setError(null);
  }, []);

  if (!estado) {
    return <div className="flex h-dvh items-center justify-center text-3xl text-tinta-suave">Cargando…</div>;
  }

  return (
    <Ctx.Provider
      value={{
        estado,
        actualizar,
        reemplazarTodo,
        errorGuardado,
        cerrarError,
        // Un guardado que no cupo ya se deshizo: en memoria queda lo mismo que en el equipo.
        sinGuardar: sinAlmacenamiento.current,
        nube: repo.familia ? { familia: repo.familia, conectado, calendarios } : null,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useDatos() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useDatos fuera de ProveedorDatos");
  return c;
}
