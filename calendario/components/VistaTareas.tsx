"use client";

import { useState } from "react";
import { useDatos } from "@/lib/store";
import type { Tarea } from "@/lib/datos/tipos";
import { nuevoId } from "@/lib/ejemplo";
import { Avatar, Boton, BotonIcono, Casilla, Entrada, Vacio, cx } from "./ui";

export default function VistaTareas() {
  const { estado, actualizar } = useDatos();
  const [texto, setTexto] = useState("");
  const [para, setPara] = useState<string | undefined>(undefined);
  const [filtro, setFiltro] = useState<string | "todos">("todos");
  const miembros = new Map(estado.miembros.map((m) => [m.id, m]));

  const visibles = estado.tareas.filter((t) => filtro === "todos" || t.miembroId === filtro);
  const pendientes = visibles.filter((t) => !t.hecha);
  const hechas = visibles.filter((t) => t.hecha);

  const agregar = (e: React.FormEvent) => {
    e.preventDefault();
    if (!texto.trim()) return;
    actualizar("tareas", (l) => [
      { id: nuevoId("tar"), titulo: texto.trim(), miembroId: para, hecha: false, creada: new Date().toISOString() },
      ...l,
    ]);
    setTexto("");
  };

  const alternar = (id: string) => actualizar("tareas", (l) => l.map((t) => (t.id === id ? { ...t, hecha: !t.hecha } : t)));
  const quitar = (id: string) => actualizar("tareas", (l) => l.filter((t) => t.id !== id));
  const reasignar = (id: string, miembroId?: string) =>
    actualizar("tareas", (l) => l.map((t) => (t.id === id ? { ...t, miembroId } : t)));

  return (
    <section className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 font-display text-2xl font-semibold md:text-3xl">
          Tareas de la casa <span className="num text-tinta-suave">· {estado.tareas.filter((t) => !t.hecha).length}</span>
        </h1>
        <div className="flex flex-wrap gap-1.5 md:ml-auto">
          <FiltroBtn activo={filtro === "todos"} onClick={() => setFiltro("todos")}>
            Todos
          </FiltroBtn>
          {estado.miembros.map((m) => (
            <FiltroBtn key={m.id} activo={filtro === m.id} color={m.color} onClick={() => setFiltro(m.id)}>
              {m.emoji} {m.nombre}
            </FiltroBtn>
          ))}
        </div>
      </div>

      <form onSubmit={agregar} className="rounded-3xl bg-superficie p-3">
        <div className="flex gap-2">
          <Entrada value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Nueva tarea: “Sacar la basura”" />
          <Boton type="submit" variante="primario" disabled={!texto.trim()}>
            ＋
          </Boton>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-base font-bold text-tinta-suave">Para:</span>
          <FiltroBtn activo={!para} onClick={() => setPara(undefined)}>
            Quien pueda
          </FiltroBtn>
          {estado.miembros.map((m) => (
            <FiltroBtn key={m.id} activo={para === m.id} color={m.color} onClick={() => setPara(m.id)}>
              {m.emoji} {m.nombre}
            </FiltroBtn>
          ))}
        </div>
      </form>

      <div className="desliza min-h-0 flex-1 overflow-y-auto">
        {visibles.length === 0 ? (
          <Vacio emoji="🎉" texto="¡No hay tareas!" />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="space-y-2">
              {pendientes.map((t) => (
                <FilaTarea key={t.id} t={t} miembros={miembros} alAlternar={alternar} alQuitar={quitar} alReasignar={reasignar} />
              ))}
              {pendientes.length === 0 && <Vacio emoji="🎉" texto="Todo listo por aquí." />}
            </div>
            {hechas.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <h2 className="text-lg font-extrabold uppercase text-ok">✓ Hechas</h2>
                  <Boton variante="fantasma" onClick={() => actualizar("tareas", (l) => l.filter((t) => !(t.hecha && visibles.includes(t))))}>
                    🧹 Limpiar
                  </Boton>
                </div>
                {hechas.map((t) => (
                  <FilaTarea key={t.id} t={t} miembros={miembros} alAlternar={alternar} alQuitar={quitar} alReasignar={reasignar} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function FiltroBtn({
  activo,
  color,
  onClick,
  children,
}: {
  activo: boolean;
  color?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "min-h-11 rounded-full border-[3px] px-3.5 text-base font-bold transition active:scale-95",
        activo ? "text-tinta" : "border-transparent bg-superficie-2 text-tinta-suave",
      )}
      style={activo ? { borderColor: color ?? "var(--c-acento)", background: "var(--c-superficie)" } : undefined}
    >
      {children}
    </button>
  );
}

function FilaTarea({
  t,
  miembros,
  alAlternar,
  alQuitar,
  alReasignar,
}: {
  t: Tarea;
  miembros: Map<string, import("@/lib/datos/tipos").Miembro>;
  alAlternar: (id: string) => void;
  alQuitar: (id: string) => void;
  alReasignar: (id: string, m?: string) => void;
}) {
  const m = t.miembroId ? miembros.get(t.miembroId) : undefined;
  const lista = [...miembros.values()];
  // Tocar el avatar rota entre las personas (rápido en pantalla táctil).
  const siguiente = () => {
    const i = m ? lista.findIndex((x) => x.id === m.id) : -1;
    alReasignar(t.id, i + 1 < lista.length ? lista[i + 1].id : undefined);
  };
  return (
    <div
      className={cx("flex items-center gap-2 rounded-3xl bg-superficie p-2 pl-3", t.hecha && "opacity-60")}
      style={m ? { boxShadow: `inset 6px 0 0 ${m.color}` } : undefined}
    >
      <button type="button" onClick={() => alAlternar(t.id)} className="flex min-h-14 min-w-0 flex-1 items-center gap-3 text-left">
        <Casilla marcada={t.hecha} color={m?.color} />
        <span className={cx("text-xl font-extrabold leading-tight md:text-2xl", t.hecha && "line-through")}>{t.titulo}</span>
      </button>
      <button type="button" onClick={siguiente} aria-label="Cambiar persona" className="flex items-center gap-1.5 rounded-full bg-superficie-2 py-1 pl-1 pr-3">
        {m ? <Avatar miembro={m} tam="sm" /> : <span className="flex size-7 items-center justify-center text-lg">👥</span>}
        <span className="hidden text-base font-bold sm:inline">{m?.nombre ?? "Cualquiera"}</span>
      </button>
      <BotonIcono etiqueta="Borrar tarea" className="bg-transparent text-xl text-tinta-suave" onClick={() => alQuitar(t.id)}>
        ✕
      </BotonIcono>
    </div>
  );
}
