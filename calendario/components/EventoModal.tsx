"use client";

import { useState } from "react";
import { useDatos } from "@/lib/store";
import type { Evento, Repeticion } from "@/lib/datos/tipos";
import { nuevoId } from "@/lib/ejemplo";
import { NOMBRE_REPETICION } from "@/lib/eventos";
import { fechaLarga } from "@/lib/fechas";
import { AreaTexto, Boton, Campo, ChipMiembro, Entrada, Modal, Segmentos, SelectorHora } from "./ui";

export default function EventoModal({
  evento,
  fecha,
  alCerrar,
}: {
  evento?: Evento;
  fecha: string;
  alCerrar: () => void;
}) {
  const { estado, actualizar } = useDatos();
  const [f, setF] = useState<Evento>(
    () =>
      evento ?? {
        id: nuevoId("ev"),
        titulo: "",
        miembros: estado.miembros[0] ? [estado.miembros[0].id] : [],
        fecha,
        todoElDia: false,
        horaInicio: "09:00",
        horaFin: "10:00",
        repeticion: "nunca",
      },
  );
  const [confirmarBorrar, setConfirmarBorrar] = useState(false);
  const set = <K extends keyof Evento>(k: K, v: Evento[K]) => setF((p) => ({ ...p, [k]: v }));
  const valido = f.titulo.trim() !== "" && f.miembros.length > 0;

  const guardar = () => {
    if (!valido) return;
    const limpio: Evento = {
      ...f,
      titulo: f.titulo.trim(),
      horaInicio: f.todoElDia ? undefined : f.horaInicio,
      horaFin: f.todoElDia ? undefined : f.horaFin || undefined,
      repetirHasta: f.repeticion === "nunca" ? undefined : f.repetirHasta || undefined,
    };
    actualizar("eventos", (lista) =>
      evento ? lista.map((e) => (e.id === evento.id ? limpio : e)) : [...lista, limpio],
    );
    alCerrar();
  };

  const borrarTodo = () => {
    actualizar("eventos", (lista) => lista.filter((e) => e.id !== f.id));
    alCerrar();
  };

  const borrarSoloEste = () => {
    actualizar("eventos", (lista) =>
      lista.map((e) => (e.id === f.id ? { ...e, excepciones: [...(e.excepciones ?? []), fecha] } : e)),
    );
    alCerrar();
  };

  return (
    <Modal
      titulo={evento ? "Editar evento" : "Nuevo evento"}
      alCerrar={alCerrar}
      pie={
        <>
          {evento && !confirmarBorrar && (
            <Boton variante="peligro" className="mr-auto" onClick={() => setConfirmarBorrar(true)}>
              🗑 Borrar
            </Boton>
          )}
          {evento && confirmarBorrar && (
            <div className="mr-auto flex flex-wrap gap-2">
              {evento.repeticion !== "nunca" && (
                <Boton variante="peligro" onClick={borrarSoloEste}>
                  Sólo el {fechaLarga(fecha)}
                </Boton>
              )}
              <Boton variante="peligro" onClick={borrarTodo}>
                {evento.repeticion !== "nunca" ? "Todas las repeticiones" : "Sí, borrar"}
              </Boton>
              <Boton variante="fantasma" onClick={() => setConfirmarBorrar(false)}>
                No
              </Boton>
            </div>
          )}
          <Boton variante="fantasma" onClick={alCerrar}>
            Cancelar
          </Boton>
          <Boton variante="primario" disabled={!valido} onClick={guardar}>
            Guardar
          </Boton>
        </>
      }
    >
      <div className="space-y-5">
        <Campo etiqueta="¿Qué es?">
          <Entrada
            autoFocus={!evento}
            value={f.titulo}
            onChange={(e) => set("titulo", e.target.value)}
            placeholder="Ej.: Dentista, Fútbol, Cumpleaños"
          />
        </Campo>

        <div>
          <span className="mb-1.5 block text-base font-bold text-tinta-suave">¿Para quién? (puedes elegir varios)</span>
          <div className="flex flex-wrap gap-2">
            {estado.miembros.map((m) => (
              <ChipMiembro
                key={m.id}
                miembro={m}
                activo={f.miembros.includes(m.id)}
                onClick={() =>
                  set(
                    "miembros",
                    f.miembros.includes(m.id) ? f.miembros.filter((x) => x !== m.id) : [...f.miembros, m.id],
                  )
                }
              />
            ))}
            <button
              type="button"
              onClick={() => set("miembros", estado.miembros.map((m) => m.id))}
              className="min-h-12 rounded-full bg-superficie-2 px-4 text-lg font-bold text-tinta-suave"
            >
              👨‍👩‍👧‍👦 Todos
            </button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta={f.repeticion === "nunca" ? "Fecha" : "Desde"}>
            <Entrada type="date" value={f.fecha} onChange={(e) => e.target.value && set("fecha", e.target.value)} />
            <span className="mt-1 block text-base font-bold first-letter:uppercase">{fechaLarga(f.fecha, true)}</span>
          </Campo>
          <div>
            <span className="mb-1.5 block text-base font-bold text-tinta-suave">Horario</span>
            <Segmentos
              valor={f.todoElDia ? "todo" : "hora"}
              alCambiar={(v) => set("todoElDia", v === "todo")}
              opciones={[
                { valor: "hora", texto: "Con hora" },
                { valor: "todo", texto: "Todo el día" },
              ]}
            />
          </div>
        </div>

        {!f.todoElDia && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="mb-1.5 block text-base font-bold text-tinta-suave">Empieza</span>
              <SelectorHora etiqueta="Empieza" valor={f.horaInicio ?? "09:00"} alCambiar={(v) => set("horaInicio", v)} />
            </div>
            <div>
              <span className="mb-1.5 block text-base font-bold text-tinta-suave">Termina (opcional)</span>
              <SelectorHora etiqueta="Termina" opcional valor={f.horaFin} alCambiar={(v) => set("horaFin", v)} />
            </div>
          </div>
        )}

        <div>
          <span className="mb-1.5 block text-base font-bold text-tinta-suave">¿Se repite?</span>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(NOMBRE_REPETICION) as Repeticion[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => set("repeticion", r)}
                className={
                  "min-h-12 rounded-2xl px-4 text-lg font-bold transition " +
                  (f.repeticion === r ? "bg-acento text-acento-tinta" : "bg-superficie-2 text-tinta-suave")
                }
              >
                {NOMBRE_REPETICION[r]}
              </button>
            ))}
          </div>
        </div>

        {f.repeticion !== "nunca" && (
          <Campo etiqueta="Hasta (déjalo vacío si no termina)">
            <Entrada type="date" value={f.repetirHasta ?? ""} min={f.fecha} onChange={(e) => set("repetirHasta", e.target.value)} />
          </Campo>
        )}

        <Campo etiqueta="Nota">
          <AreaTexto value={f.nota ?? ""} onChange={(e) => set("nota", e.target.value)} placeholder="Ej.: llevar la carpeta" />
        </Campo>
      </div>
    </Modal>
  );
}
