"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { crearRepositorio, type ClaveColeccion, type EstadoApp } from "./datos";
import { normalizarGuardado } from "./datos/normalizar";
import { estadoEjemplo } from "./ejemplo";

interface Contexto {
  estado: EstadoApp;
  /** Cambia una colección y la guarda. Devuelve false si no se pudo guardar (el cambio se deshace). */
  actualizar: <K extends ClaveColeccion>(clave: K, fn: (previo: EstadoApp[K]) => EstadoApp[K]) => Promise<boolean>;
  /** Reemplaza todo. Devuelve false si no se pudo guardar (queda todo como estaba). */
  reemplazarTodo: (estado: EstadoApp) => Promise<boolean>;
  errorGuardado: string | null;
  cerrarError: () => void;
  /** Hay cambios que no se pudieron guardar o el navegador no guarda nada. */
  sinGuardar: boolean;
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
};

const AVISO_SIN_ALMACENAMIENTO =
  "Este navegador no deja guardar datos (modo privado o almacenamiento bloqueado): los cambios se perderán al recargar.";

export function ProveedorDatos({ children }: { children: React.ReactNode }) {
  const repo = useMemo(() => crearRepositorio(), []);
  const [estado, setEstado] = useState<EstadoApp | null>(null);
  const [errorGuardado, setError] = useState<string | null>(null);
  const estadoRef = useRef<EstadoApp | null>(null);
  /** Lo último que quedó guardado de verdad, para deshacer si un guardado falla. */
  const persistido = useRef<EstadoApp | null>(null);
  const fallidas = useRef(new Set<ClaveColeccion>());
  const sinAlmacenamiento = useRef(false);

  const refrescarAviso = useCallback(() => {
    if (sinAlmacenamiento.current) return setError(AVISO_SIN_ALMACENAMIENTO);
    const f = [...fallidas.current];
    setError(
      f.length
        ? `No se pudieron guardar ${f.map((c) => NOMBRES[c]).join(", ")}: el almacenamiento de este equipo está lleno. ` +
            "Prueba quitando fotos de recetas o usando fotos más chicas."
        : null,
    );
  }, []);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const base = estadoEjemplo();
      let guardado: EstadoApp | null = null;
      try {
        guardado = await repo.cargar();
      } catch {
        sinAlmacenamiento.current = true;
      }
      const final = guardado ? normalizarGuardado(guardado, base) : base;
      if (!vivo) return;
      // Primero se muestra la app; guardar no puede dejarla en "Cargando…".
      estadoRef.current = final;
      persistido.current = guardado ? final : null;
      setEstado(final);
      if (!guardado) {
        try {
          await repo.reemplazarTodo(final);
          persistido.current = final;
        } catch {
          sinAlmacenamiento.current = true;
        }
      }
      if (vivo) refrescarAviso();
    })();
    const desuscribir = repo.suscribir((nuevo) => {
      const base = estadoEjemplo();
      const n = normalizarGuardado(nuevo, base);
      persistido.current = n;
      estadoRef.current = n;
      setEstado(n);
    });
    return () => {
      vivo = false;
      desuscribir();
    };
  }, [repo, refrescarAviso]);

  const actualizar = useCallback<Contexto["actualizar"]>(
    async (clave, fn) => {
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
      } catch {
        if (sinAlmacenamiento.current) return false; // no hay dónde guardar: se sigue en memoria
        // No cupo: se deshace para no mostrar algo que se perdería al recargar.
        const guardadoAntes = persistido.current?.[clave];
        if (guardadoAntes !== undefined && estadoRef.current) {
          const deshecho = { ...estadoRef.current, [clave]: guardadoAntes };
          estadoRef.current = deshecho;
          setEstado(deshecho);
        }
        fallidas.current.add(clave);
        refrescarAviso();
        return false;
      }
    },
    [repo, refrescarAviso],
  );

  const reemplazarTodo = useCallback(
    async (nuevo: EstadoApp) => {
      try {
        await repo.reemplazarTodo(nuevo);
      } catch {
        if (sinAlmacenamiento.current) {
          estadoRef.current = nuevo;
          setEstado(nuevo);
        }
        return false;
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
        sinGuardar: sinAlmacenamiento.current || fallidas.current.size > 0,
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
