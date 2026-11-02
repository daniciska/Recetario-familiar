"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { crearRepositorio, type ClaveColeccion, type EstadoApp } from "./datos";
import { estadoEjemplo } from "./ejemplo";

interface Contexto {
  estado: EstadoApp;
  actualizar: <K extends ClaveColeccion>(clave: K, fn: (previo: EstadoApp[K]) => EstadoApp[K]) => void;
  reemplazarTodo: (estado: EstadoApp) => void;
  errorGuardado: string | null;
}

const Ctx = createContext<Contexto | null>(null);

export function ProveedorDatos({ children }: { children: React.ReactNode }) {
  const repo = useMemo(() => crearRepositorio(), []);
  const [estado, setEstado] = useState<EstadoApp | null>(null);
  const [errorGuardado, setError] = useState<string | null>(null);
  const estadoRef = useRef<EstadoApp | null>(null);
  estadoRef.current = estado;

  useEffect(() => {
    let vivo = true;
    repo.cargar().then(async (guardado) => {
      const base = estadoEjemplo();
      const final = guardado ? { ...base, ...guardado, ajustes: { ...base.ajustes, ...guardado.ajustes } } : base;
      if (!guardado) await repo.reemplazarTodo(final);
      if (vivo) setEstado(final);
    });
    const desuscribir = repo.suscribir((nuevo) => setEstado((p) => (p ? { ...p, ...nuevo } : nuevo)));
    return () => {
      vivo = false;
      desuscribir();
    };
  }, [repo]);

  const actualizar = useCallback<Contexto["actualizar"]>(
    (clave, fn) => {
      const previo = estadoRef.current;
      if (!previo) return;
      const valor = fn(previo[clave]);
      const siguiente = { ...previo, [clave]: valor };
      estadoRef.current = siguiente;
      setEstado(siguiente);
      repo
        .guardar(clave, valor)
        .then(() => setError(null))
        .catch(() =>
          setError("No se pudo guardar. Puede que el almacenamiento esté lleno (las fotos ocupan mucho)."),
        );
    },
    [repo],
  );

  const reemplazarTodo = useCallback(
    (nuevo: EstadoApp) => {
      estadoRef.current = nuevo;
      setEstado(nuevo);
      repo.reemplazarTodo(nuevo).catch(() => setError("No se pudo guardar."));
    },
    [repo],
  );

  if (!estado) {
    return (
      <div className="flex h-dvh items-center justify-center text-3xl text-tinta-suave">Cargando…</div>
    );
  }

  return <Ctx.Provider value={{ estado, actualizar, reemplazarTodo, errorGuardado }}>{children}</Ctx.Provider>;
}

export function useDatos() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useDatos fuera de ProveedorDatos");
  return c;
}
