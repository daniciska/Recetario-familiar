"use client";

import { useState } from "react";
import { useDatos } from "@/lib/store";
import { useCandado } from "@/lib/candado";
import type { Evento, Repeticion } from "@/lib/datos/tipos";
import { nuevoId } from "@/lib/ejemplo";
import { NOMBRE_REPETICION } from "@/lib/eventos";
import { fechaLarga, horaAMinutos, partes } from "@/lib/fechas";
import { AreaTexto, Boton, Campo, Casilla, ChipMiembro, Entrada, Modal, Segmentos, SelectorHora } from "./ui";

const HORA_DEFECTO = "09:00";

function minutosAHora(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

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
  const { proteger } = useCandado();
  const [f, setF] = useState<Evento>(
    () =>
      evento ?? {
        id: nuevoId("ev"),
        titulo: "",
        miembros: estado.miembros[0] ? [estado.miembros[0].id] : [],
        fecha,
        todoElDia: false,
        horaInicio: HORA_DEFECTO,
        horaFin: "10:00",
        repeticion: "nunca",
      },
  );
  const [confirmarBorrar, setConfirmarBorrar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Evento>(k: K, v: Evento[K]) => setF((p) => ({ ...p, [k]: v }));

  const hastaAntes = f.repeticion !== "nunca" && !!f.repetirHasta && f.repetirHasta < f.fecha;
  const finAntes = !f.todoElDia && !!f.horaInicio && !!f.horaFin && f.horaFin <= f.horaInicio;
  const valido = f.titulo.trim() !== "" && f.miembros.length > 0 && !hastaAntes && !finAntes;

  /** Al mover la hora de inicio, el término se mueve con ella (se mantiene la duración). */
  const cambiarInicio = (v: string | undefined) =>
    setF((p) => {
      if (!v) return p;
      if (!p.horaFin || !p.horaInicio) return { ...p, horaInicio: v };
      const dur = horaAMinutos(p.horaFin) - horaAMinutos(p.horaInicio);
      const fin = horaAMinutos(v) + (dur > 0 ? dur : 60);
      // Si se pasa de medianoche, se deja sin término (los eventos no cruzan de día).
      return { ...p, horaInicio: v, horaFin: fin < 24 * 60 ? minutosAHora(fin) : undefined };
    });

  /** Al mover el inicio de una serie más allá de su "hasta", el "hasta" se limpia. */
  const cambiarFecha = (v: string) =>
    setF((p) => ({ ...p, fecha: v, repetirHasta: p.repetirHasta && p.repetirHasta < v ? undefined : p.repetirHasta }));

  const cambiarRepeticion = (r: Repeticion) =>
    setF((p) => {
      const eraSerie = !!evento && evento.repeticion !== "nunca";
      let nueva = p.fecha;
      // Una serie que pasa a "No se repite" queda en el día que se abrió, no en el primero de la serie.
      if (eraSerie && r === "nunca" && p.fecha === evento.fecha) nueva = fecha;
      // Si vuelve a repetirse sin que se haya tocado la fecha, la serie recupera su inicio original.
      else if (eraSerie && r !== "nunca" && p.repeticion === "nunca" && p.fecha === fecha) nueva = evento.fecha;
      return { ...p, repeticion: r, fecha: nueva };
    });

  const guardar = async () => {
    if (!valido) return;
    const unico = f.repeticion === "nunca";
    const hasta = unico ? undefined : f.repetirHasta || undefined;
    const excepciones = unico ? [] : (f.excepciones ?? []).filter((x) => x >= f.fecha && (!hasta || x <= hasta));
    const limpio: Evento = {
      ...f,
      titulo: f.titulo.trim(),
      horaInicio: f.todoElDia ? undefined : (f.horaInicio ?? HORA_DEFECTO),
      horaFin: f.todoElDia ? undefined : f.horaFin || undefined,
      repetirHasta: hasta,
      nota: f.nota?.trim() || undefined,
      excepciones: excepciones.length ? excepciones : undefined,
    };
    const ok = await actualizar("eventos", (lista) =>
      lista.some((e) => e.id === limpio.id) ? lista.map((e) => (e.id === limpio.id ? limpio : e)) : [...lista, limpio],
    );
    if (ok) alCerrar();
    else setError("No se pudo guardar: el almacenamiento de este equipo está lleno.");
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
                <Boton variante="peligro" onClick={() => proteger(borrarSoloEste)}>
                  Sólo el {fechaLarga(fecha)}
                </Boton>
              )}
              <Boton variante="peligro" onClick={() => proteger(borrarTodo)}>
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
          <Boton variante="primario" disabled={!valido} onClick={() => proteger(guardar)}>
            Guardar
          </Boton>
        </>
      }
    >
      <div className="space-y-5">
        {error && <p role="alert" className="rounded-2xl bg-red-600/15 px-4 py-2 text-lg font-bold text-red-700 noche:text-red-300">{error}</p>}
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
            <Entrada type="date" value={f.fecha} onChange={(e) => e.target.value && cambiarFecha(e.target.value)} />
            <span className="mt-1 block text-base font-bold first-letter:uppercase">{fechaLarga(f.fecha, true)}</span>
          </Campo>
          <div>
            <span className="mb-1.5 block text-base font-bold text-tinta-suave">Horario</span>
            <Segmentos
              valor={f.todoElDia ? "todo" : "hora"}
              alCambiar={(v) =>
                setF((p) => ({
                  ...p,
                  todoElDia: v === "todo",
                  horaInicio: v === "todo" ? p.horaInicio : (p.horaInicio ?? HORA_DEFECTO),
                }))
              }
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
              <SelectorHora etiqueta="Empieza" valor={f.horaInicio ?? HORA_DEFECTO} alCambiar={cambiarInicio} />
            </div>
            <div>
              <span className="mb-1.5 block text-base font-bold text-tinta-suave">Termina (opcional)</span>
              <SelectorHora etiqueta="Termina" opcional valor={f.horaFin} alCambiar={(v) => set("horaFin", v)} />
            </div>
            {finAntes && (
              <p className="col-span-2 text-base font-bold text-red-700 noche:text-red-300">
                Termina antes de empezar: cambia la hora de término o déjala en “—”.
              </p>
            )}
          </div>
        )}

        <div>
          <span className="mb-1.5 block text-base font-bold text-tinta-suave">¿Se repite?</span>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(NOMBRE_REPETICION) as Repeticion[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => cambiarRepeticion(r)}
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

        {f.repeticion === "anual" && partes(f.fecha).mes === 2 && partes(f.fecha).dia === 29 && (
          <p className="-mt-3 text-base text-tinta-suave">En los años que no son bisiestos, se muestra el 28 de febrero.</p>
        )}

        {f.repeticion === "mensual" && partes(f.fecha).dia > 28 && (
          <p className="-mt-3 text-base text-tinta-suave">
            En los meses que no tienen el día {partes(f.fecha).dia}, se muestra el último día del mes.
          </p>
        )}

        {f.repeticion !== "nunca" && (
          <Campo etiqueta="Hasta (déjalo vacío si no termina)">
            <Entrada type="date" value={f.repetirHasta ?? ""} min={f.fecha} onChange={(e) => set("repetirHasta", e.target.value)} />
            {hastaAntes && (
              <span className="mt-1 block text-base font-bold text-red-700 noche:text-red-300">
                Tiene que ser el {fechaLarga(f.fecha)} o después.
              </span>
            )}
          </Campo>
        )}

        <button
          type="button"
          role="switch"
          aria-checked={!!f.cuentaRegresiva}
          onClick={() => set("cuentaRegresiva", f.cuentaRegresiva ? undefined : true)}
          className="flex min-h-14 w-full items-center gap-3 rounded-2xl bg-superficie-2 px-4 text-left"
        >
          <Casilla marcada={!!f.cuentaRegresiva} />
          <span className="flex-1">
            <span className="block text-lg font-bold">⏳ Cuenta regresiva</span>
            <span className="block text-base text-tinta-suave">Arriba se ve “… en 5 días” (cumpleaños, viajes).</span>
          </span>
        </button>

        <Campo etiqueta="Nota">
          <AreaTexto value={f.nota ?? ""} onChange={(e) => set("nota", e.target.value)} placeholder="Ej.: llevar la carpeta" />
        </Campo>
      </div>
    </Modal>
  );
}
