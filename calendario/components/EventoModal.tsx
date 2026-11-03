"use client";

import { useState } from "react";
import { useDatos } from "@/lib/store";
import { useCandado } from "@/lib/candado";
import type { Evento, Repeticion } from "@/lib/datos/tipos";
import { nuevoId } from "@/lib/ejemplo";
import { DIAS_CORTOS, NOMBRE_REPETICION, aplicarCambios, canonico, diasDeLaSemana, duracionDias, seRepite, seSolapa, textoRepeticion, unidadRepeticion } from "@/lib/eventos";
import { diaSemana, diferenciaDias, fechaLarga, horaAMinutos, partes, sumarDias } from "@/lib/fechas";
import { AreaTexto, Boton, Campo, Casilla, ChipMiembro, Contador, Entrada, Modal, Segmentos, SelectorHora, cx } from "./ui";

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
  const { estado, actualizar, nube } = useDatos();
  const calendarios = nube?.calendarios ?? [];
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

  /** Día en que de verdad empieza (en una semanal, el primer día elegido desde la fecha). */
  const inicioReal = f.repeticion === "semanal" ? canonico({ ...f, fechaFin: undefined, repetirHasta: undefined }).fecha : f.fecha;
  const hastaAntes = f.repeticion !== "nunca" && !!f.repetirHasta && f.repetirHasta < inicioReal;
  const variosDias = f.fechaFin !== undefined;
  const finDiaAntes = variosDias && f.fechaFin! <= f.fecha;
  const finAntes = !variosDias && !f.todoElDia && !!f.horaInicio && !!f.horaFin && f.horaFin <= f.horaInicio;
  /** Repetición que viene del iPhone y la app no sabe escribir (p. ej. "el segundo martes"): se cambia allá. */
  const repeticionDeAfuera = !!f.fechas;
  /** Un día de una serie de iCloud que se cambió sólo ese día: no tiene repetición propia. */
  const diaDeSerie = !!f.externo?.recurrencia;
  /**
   * Si dura más de lo que tarda en repetirse, las ocurrencias se pisan (y "borrar sólo este día" no se
   * notaría). Sólo se avisa si se cambió el horario o la repetición: una serie que ya viene así del
   * iPhone se puede seguir editando (título, personas, nota…).
   */
  const forma = (e: Evento) => JSON.stringify([duracionDias(e), e.todoElDia, e.horaInicio, e.horaFin, e.repeticion, e.intervalo ?? 1, diasDeLaSemana(e)]);
  const tocoForma = !evento || forma(f) !== forma(evento);
  const pisa = !repeticionDeAfuera && !finDiaAntes && tocoForma && seSolapa(f);
  const valido = f.titulo.trim() !== "" && f.miembros.length > 0 && !hastaAntes && !finAntes && !finDiaAntes && !pisa;

  /** Al mover la hora de inicio, el término se mueve con ella (se mantiene la duración) si es de un día. */
  const cambiarInicio = (v: string | undefined) =>
    setF((p) => {
      if (!v) return p;
      // Varios días: la hora de término es la del último día, no se toca.
      if (!p.horaFin || !p.horaInicio || p.fechaFin !== undefined) return { ...p, horaInicio: v };
      const dur = horaAMinutos(p.horaFin) - horaAMinutos(p.horaInicio);
      const fin = horaAMinutos(v) + (dur > 0 ? dur : 60);
      // Si se pasa de medianoche, se deja sin término (para cruzar de día está "Dura varios días").
      return { ...p, horaInicio: v, horaFin: fin < 24 * 60 ? minutosAHora(fin) : undefined };
    });

  /**
   * Al mover el inicio de una serie más allá de su "hasta", el "hasta" se limpia; si dura varios
   * días, el último día se mueve con el primero. En una semanal, el día nuevo queda elegido.
   */
  const cambiarFecha = (v: string) =>
    setF((p) => {
      const n: Evento = { ...p, fecha: v, repetirHasta: p.repetirHasta && p.repetirHasta < v ? undefined : p.repetirHasta };
      if (p.fechaFin !== undefined) n.fechaFin = sumarDias(v, Math.max(1, diferenciaDias(p.fecha, p.fechaFin)));
      if (p.diasSemana?.length && !p.diasSemana.includes(diaSemana(v))) n.diasSemana = [...p.diasSemana, diaSemana(v)].sort();
      return n;
    });

  const cambiarDiasSemana = (d: number) =>
    setF((p) => {
      const actuales = diasDeLaSemana(p);
      const nuevos = actuales.includes(d) ? actuales.filter((x) => x !== d) : [...actuales, d].sort();
      return nuevos.length ? { ...p, diasSemana: nuevos } : p; // al menos un día
    });

  const cambiarRepeticion = (r: Repeticion) =>
    setF((p) => {
      const eraSerie = !!evento && evento.repeticion !== "nunca";
      let nueva = p.fecha;
      // Una serie que pasa a "No se repite" queda en el día que se abrió, no en el primero de la serie.
      if (eraSerie && r === "nunca" && p.fecha === evento.fecha) nueva = fecha;
      // Si vuelve a repetirse sin que se haya tocado la fecha, la serie recupera su inicio original.
      else if (eraSerie && r !== "nunca" && p.repeticion === "nunca" && p.fecha === fecha) nueva = evento.fecha;
      // Si dura varios días, el último día se mueve con el primero.
      const fechaFin = p.fechaFin !== undefined && nueva !== p.fecha ? sumarDias(nueva, Math.max(1, diferenciaDias(p.fecha, p.fechaFin))) : p.fechaFin;
      return { ...p, repeticion: r, fecha: nueva, fechaFin };
    });

  const guardar = async () => {
    if (!valido) return;
    const limpiar = (x: Evento): Evento =>
      canonico({
        ...x,
        titulo: x.titulo.trim(),
        horaInicio: x.todoElDia ? undefined : (x.horaInicio ?? HORA_DEFECTO),
        horaFin: x.todoElDia ? undefined : x.horaFin || undefined,
        repetirHasta: x.repeticion === "nunca" ? undefined : x.repetirHasta || undefined,
        nota: x.nota?.trim() || undefined,
        lugar: x.lugar?.trim() || undefined,
      });
    const limpio = limpiar(f);
    const ahora = new Date().toISOString();
    // El formulario es una copia de cuando se abrió: mientras tanto la sincronización pudo traer cambios
    // del iPhone (un día borrado, otra hora) o vincularlo con iCloud. Por eso se aplica sólo lo que se
    // cambió aquí sobre el evento como está ahora en la lista.
    // Si se borró (en el iPhone o en otro equipo) mientras se editaba, no se vuelve a crear.
    let seBorro = false;
    const ok = await actualizar("eventos", (lista) => {
      const actual = lista.find((e) => e.id === limpio.id);
      seBorro = !!evento && !actual;
      if (seBorro) return lista;
      if (!actual) return [...lista, { ...limpio, actualizado: ahora }];
      const final: Evento = { ...(evento ? aplicarCambios(limpiar(evento), limpio, actual) : limpio), actualizado: ahora };
      return lista.map((e) => (e.id === limpio.id ? final : e));
    });
    if (seBorro) setError("Este evento se borró (en el iPhone o en otro equipo) mientras lo tenías abierto.");
    else if (ok) alCerrar();
    else
      setError(
        nube
          ? "No se pudo guardar: no hay conexión con la nube. Revisa el wifi e inténtalo de nuevo."
          : "No se pudo guardar: el almacenamiento de este equipo está lleno.",
      );
  };

  /** Borra el evento; si es una serie de iCloud, también los días que se cambiaron sólo esa vez. */
  const borrarTodo = () => {
    actualizar("eventos", (lista) => {
      const actual = lista.find((e) => e.id === f.id);
      const serie = actual?.externo && !actual.externo.recurrencia ? actual.externo : null;
      return lista.filter((e) => e.id !== f.id && !(serie && e.externo?.uid === serie.uid && e.externo.conexion === serie.conexion));
    });
    alCerrar();
  };

  const borrarSoloEste = () => {
    actualizar("eventos", (lista) =>
      lista.map((e) =>
        e.id === f.id ? { ...e, excepciones: [...(e.excepciones ?? []), fecha], actualizado: new Date().toISOString() } : e,
      ),
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
              {seRepite(evento) && (
                <Boton variante="peligro" onClick={() => proteger(borrarSoloEste)}>
                  Sólo el {fechaLarga(fecha)}
                </Boton>
              )}
              <Boton variante="peligro" onClick={() => proteger(borrarTodo)}>
                {seRepite(evento) ? "Todas las repeticiones" : "Sí, borrar"}
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
          {repeticionDeAfuera ? (
            <div>
              <span className="mb-1.5 block text-base font-bold text-tinta-suave">Desde</span>
              <span className="block text-lg font-bold first-letter:uppercase">{fechaLarga(f.fecha, true)}</span>
            </div>
          ) : (
            <Campo etiqueta={variosDias ? "Primer día" : f.repeticion === "nunca" ? "Fecha" : "Desde"}>
              <Entrada type="date" value={f.fecha} onChange={(e) => e.target.value && cambiarFecha(e.target.value)} />
              <span className="mt-1 block text-base font-bold first-letter:uppercase">{fechaLarga(f.fecha, true)}</span>
            </Campo>
          )}
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

        {!repeticionDeAfuera && (
          <button
            type="button"
            role="switch"
            aria-checked={variosDias}
            onClick={() => set("fechaFin", variosDias ? undefined : sumarDias(f.fecha, 1))}
            className="flex min-h-14 w-full items-center gap-3 rounded-2xl bg-superficie-2 px-4 text-left"
          >
            <Casilla marcada={variosDias} />
            <span className="flex-1 text-lg font-bold">Dura varios días</span>
          </button>
        )}

        {variosDias && (
          <Campo etiqueta="Último día">
            <Entrada
              type="date"
              value={f.fechaFin}
              min={sumarDias(f.fecha, 1)}
              disabled={repeticionDeAfuera}
              onChange={(e) => e.target.value && set("fechaFin", e.target.value)}
            />
            <span className="mt-1 block text-base font-bold first-letter:uppercase">
              {fechaLarga(f.fechaFin!, true)}
              {!finDiaAntes && ` · ${duracionDias(f)} días`}
            </span>
            {finDiaAntes && (
              <span className="mt-1 block text-base font-bold text-red-700 noche:text-red-300">
                Tiene que ser después del {fechaLarga(f.fecha)}.
              </span>
            )}
          </Campo>
        )}

        {!f.todoElDia && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="mb-1.5 block text-base font-bold text-tinta-suave">{variosDias ? "Empieza el primer día" : "Empieza"}</span>
              <SelectorHora etiqueta="Empieza" valor={f.horaInicio ?? HORA_DEFECTO} alCambiar={cambiarInicio} />
            </div>
            <div>
              <span className="mb-1.5 block text-base font-bold text-tinta-suave">
                {variosDias ? "Termina el último día" : "Termina (opcional)"}
              </span>
              <SelectorHora etiqueta="Termina" opcional valor={f.horaFin} alCambiar={(v) => set("horaFin", v)} />
            </div>
            {finAntes && (
              <p className="col-span-2 text-base font-bold text-red-700 noche:text-red-300">
                Termina antes de empezar: cambia la hora de término o déjala en “—”.
              </p>
            )}
          </div>
        )}

        {diaDeSerie ? (
          <div className="rounded-2xl bg-superficie-2 px-4 py-3">
            <span className="block text-lg font-bold">↻ Cambio de un solo día de una serie</span>
            <span className="block text-base text-tinta-suave">
              En el iPhone se cambió sólo este día; el resto de la serie sigue igual. Aquí puedes moverlo o cambiarlo.
            </span>
          </div>
        ) : repeticionDeAfuera ? (
          <div className="rounded-2xl bg-superficie-2 px-4 py-3">
            <span className="block text-lg font-bold">↻ {textoRepeticion(f)}</span>
            <span className="block text-base text-tinta-suave">
              Para cambiar cómo se repite, hazlo en el Calendario del iPhone. Aquí puedes cambiar lo demás.
            </span>
          </div>
        ) : (
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
        )}

        {!repeticionDeAfuera && !diaDeSerie && f.repeticion !== "nunca" && (
          <div className="-mt-1 space-y-3 rounded-2xl bg-superficie-2 px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-lg font-bold">Cada</span>
              <Contador
                valor={f.intervalo ?? 1}
                min={1}
                max={30}
                alCambiar={(v) => set("intervalo", v > 1 ? v : undefined)}
              />
              <span className="text-lg font-bold">{unidadRepeticion(f.repeticion, f.intervalo ?? 1)}</span>
            </div>
            {f.repeticion === "semanal" && (
              <div>
                <span className="mb-1.5 block text-base font-bold text-tinta-suave">Los días</span>
                <div className="flex flex-wrap gap-1.5">
                  {DIAS_CORTOS.map((d, i) => {
                    const activo = diasDeLaSemana(f).includes(i);
                    return (
                      <button
                        key={d}
                        type="button"
                        aria-pressed={activo}
                        onClick={() => cambiarDiasSemana(i)}
                        className={cx(
                          "min-h-12 min-w-12 rounded-full px-3 text-lg font-bold capitalize transition",
                          activo ? "bg-acento text-acento-tinta" : "bg-superficie text-tinta-suave",
                        )}
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {f.repeticion === "anual" && partes(f.fecha).mes === 2 && partes(f.fecha).dia === 29 && (
          <p className="-mt-3 text-base text-tinta-suave">En los años que no son bisiestos, se muestra el 28 de febrero.</p>
        )}

        {f.repeticion === "mensual" && partes(f.fecha).dia > 28 && (
          <p className="-mt-3 text-base text-tinta-suave">
            En los meses que no tienen el día {partes(f.fecha).dia}, se muestra el último día del mes.
          </p>
        )}

        {!repeticionDeAfuera && !diaDeSerie && f.repeticion !== "nunca" && (
          <Campo etiqueta="Hasta (déjalo vacío si no termina)">
            <Entrada type="date" value={f.repetirHasta ?? ""} min={inicioReal} onChange={(e) => set("repetirHasta", e.target.value)} />
            {hastaAntes && (
              <span className="mt-1 block text-base font-bold text-red-700 noche:text-red-300">
                {inicioReal !== f.fecha
                  ? `Con esos días empieza el ${fechaLarga(inicioReal)}: el “hasta” tiene que ser ese día o después.`
                  : `Tiene que ser el ${fechaLarga(f.fecha)} o después.`}
              </span>
            )}
          </Campo>
        )}

        {pisa && (
          <p className="-mt-2 text-base font-bold text-red-700 noche:text-red-300">
            Dura {duracionDias(f)} días pero se repite antes de terminar: acorta el “Último día” o repítelo menos seguido.
          </p>
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

        <Campo etiqueta="Lugar (opcional)">
          <Entrada value={f.lugar ?? ""} onChange={(e) => set("lugar", e.target.value)} placeholder="Ej.: Clínica Alemana, Colegio" />
        </Campo>

        <Campo etiqueta="Nota">
          <AreaTexto value={f.nota ?? ""} onChange={(e) => set("nota", e.target.value)} placeholder="Ej.: llevar la carpeta" />
        </Campo>

        {calendarios.length > 0 && !diaDeSerie && (
          <button
            type="button"
            role="switch"
            aria-checked={!f.soloPanel}
            onClick={() => set("soloPanel", f.soloPanel ? undefined : true)}
            className="flex min-h-14 w-full items-center gap-3 rounded-2xl bg-superficie-2 px-4 text-left"
          >
            <Casilla marcada={!f.soloPanel} />
            <span className="flex-1">
              <span className="block text-lg font-bold">📱 También en el calendario “{calendarios[0].nombre}”</span>
              <span className="block text-base text-tinta-suave">
                {f.soloPanel
                  ? "Queda sólo en el panel: no se ve en los iPhone."
                  : "Se ve en el Calendario de los iPhone de la familia y avisa con sus alertas."}
              </span>
            </span>
          </button>
        )}
      </div>
    </Modal>
  );
}
