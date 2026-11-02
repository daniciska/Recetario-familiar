"use client";

import { useEffect, useMemo, useState } from "react";
import { useDatos } from "@/lib/store";
import { useCandado } from "@/lib/candado";
import type { Miembro, Momento, MovimientoEstrellas, Premio, Tarea } from "@/lib/datos/tipos";
import { nuevoId } from "@/lib/ejemplo";
import { diaSemana, hoy as hoyFecha } from "@/lib/fechas";
import { Avatar, Boton, BotonIcono, Campo, Casilla, Contador, Entrada, Modal, Segmentos, Vacio, cx } from "./ui";

// ---------- Reglas de los quehaceres (puras) ----------

const DIAS_LETRA = ["L", "M", "M", "J", "V", "S", "D"];
const DIAS_NOMBRE = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const MOMENTOS: { id: Momento; texto: string; emoji: string }[] = [
  { id: "manana", texto: "Mañana", emoji: "☀️" },
  { id: "tarde", texto: "Tarde", emoji: "🌤️" },
  { id: "noche", texto: "Noche", emoji: "🌙" },
];
const ORDEN_MOMENTO: Record<string, number> = { manana: 0, tarde: 1, noche: 2, "": 3 };

/** ¿Le toca hoy? Las de una sola vez siempre se muestran (hasta que se limpian). */
export function tocaEn(t: Tarea, fecha: string): boolean {
  if (!t.repetir || t.repetir === "nunca") return true;
  if (t.repetir === "diaria") return true;
  return !!t.dias?.includes(diaSemana(fecha));
}

export function hechaEn(t: Tarea, fecha: string): boolean {
  return !t.repetir || t.repetir === "nunca" ? t.hecha : !!t.hechas?.includes(fecha);
}

/** Referencia del movimiento de estrellas de un quehacer (por día si se repite). */
export const refDe = (t: Tarea, fecha: string) => (!t.repetir || t.repetir === "nunca" ? t.id : `${t.id}|${fecha}`);

export function textoRepeticion(t: Tarea): string | null {
  if (t.repetir === "diaria") return "Todos los días";
  if (t.repetir === "dias" && t.dias?.length) {
    if (t.dias.length === 5 && t.dias.every((d) => d < 5)) return "Lunes a viernes";
    return t.dias.map((d) => DIAS_LETRA[d]).join(" · ");
  }
  return null;
}

export function saldos(movs: MovimientoEstrellas[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of movs) m.set(x.miembroId, (m.get(x.miembroId) ?? 0) + x.cantidad);
  return m;
}

const porOrden = (hoy: string) => (a: Tarea, b: Tarea) =>
  Number(hechaEn(a, hoy)) - Number(hechaEn(b, hoy)) ||
  ORDEN_MOMENTO[a.momento ?? ""] - ORDEN_MOMENTO[b.momento ?? ""] ||
  a.titulo.localeCompare(b.titulo, "es");

// ---------- Vista ----------

export default function VistaTareas({ hoy }: { hoy: string }) {
  const { estado, actualizar } = useDatos();
  const { proteger } = useCandado();
  const [filtro, setFiltro] = useState<string | "todos">("todos");
  const [texto, setTexto] = useState("");
  const [editando, setEditando] = useState<Tarea | "nueva" | null>(null);
  const [verPremios, setVerPremios] = useState(false);
  const [quien, setQuien] = useState<Tarea | null>(null);
  const [festejo, setFestejo] = useState<string | null>(null);

  const miembros = useMemo(() => new Map(estado.miembros.map((m) => [m.id, m])), [estado.miembros]);
  const saldo = useMemo(() => saldos(estado.estrellas), [estado.estrellas]);
  const orden = porOrden(hoy);

  const visibles = estado.tareas.filter((t) => filtro === "todos" || t.miembroId === filtro);
  const deHoy = visibles.filter((t) => tocaEn(t, hoy)).sort(orden);
  const otrosDias = visibles.filter((t) => !tocaEn(t, hoy)).sort((a, b) => a.titulo.localeCompare(b.titulo, "es"));
  const pendientesHoy = estado.tareas.filter((t) => tocaEn(t, hoy) && !hechaEn(t, hoy)).length;
  const hayHechasUnaVez = visibles.some((t) => (!t.repetir || t.repetir === "nunca") && t.hecha);

  useEffect(() => {
    if (!festejo) return;
    const t = setTimeout(() => setFestejo(null), 2500);
    return () => clearTimeout(t);
  }, [festejo]);

  /** Marca o desmarca para hoy. Con estrellas: suma (o las devuelve al desmarcar). */
  const marcar = (t: Tarea, quienId?: string) => {
    const ya = hechaEn(t, hoy);
    const ref = refDe(t, hoy);
    if (!ya && (t.estrellas ?? 0) > 0 && !t.miembroId && !quienId && estado.miembros.length > 0) {
      setQuien(t); // "Quien pueda": hay que elegir quién la hizo
      return;
    }
    actualizar("tareas", (l) =>
      l.map((x) => {
        if (x.id !== t.id) return x;
        if (!x.repetir || x.repetir === "nunca") return { ...x, hecha: !ya };
        const hechas = new Set(x.hechas ?? []);
        if (ya) hechas.delete(hoy);
        else hechas.add(hoy);
        return { ...x, hechas: [...hechas].sort().slice(-60) };
      }),
    );
    const para = quienId ?? t.miembroId;
    if (ya) actualizar("estrellas", (l) => l.filter((m) => m.ref !== ref));
    else if ((t.estrellas ?? 0) > 0 && para) {
      actualizar("estrellas", (l) => [
        ...l.filter((m) => m.ref !== ref),
        { id: nuevoId("est"), miembroId: para, cantidad: t.estrellas!, motivo: t.titulo, fecha: new Date().toISOString(), ref },
      ]);
      const nombre = miembros.get(para)?.nombre;
      setFestejo(`+${t.estrellas} ⭐${nombre ? ` para ${nombre}` : ""}`);
    }
  };

  const agregarRapido = (e: React.FormEvent) => {
    e.preventDefault();
    const titulo = texto.trim();
    if (!titulo) return;
    proteger(() => {
      actualizar("tareas", (l) => [
        { id: nuevoId("tar"), titulo, miembroId: filtro === "todos" ? undefined : filtro, hecha: false, creada: new Date().toISOString() },
        ...l,
      ]);
      setTexto("");
    });
  };

  // En el tablet, sin filtro: una columna por persona (como un tablero de quehaceres).
  const columnas = [
    ...estado.miembros.map((m) => ({ miembro: m as Miembro | undefined, tareas: deHoy.filter((t) => t.miembroId === m.id) })),
    { miembro: undefined, tareas: deHoy.filter((t) => !t.miembroId || !miembros.has(t.miembroId)) },
  ].filter((c) => c.miembro || c.tareas.length > 0);

  return (
    <section className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto font-display text-2xl font-semibold max-sm:w-full md:text-3xl">
          Tareas de hoy <span className="num text-tinta-suave">· {pendientesHoy}</span>
        </h1>
        <Boton onClick={() => setVerPremios(true)}>🏆 Premios</Boton>
        <Boton variante="primario" onClick={() => proteger(() => setEditando("nueva"))}>
          ＋ Tarea
        </Boton>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <FiltroBtn activo={filtro === "todos"} onClick={() => setFiltro("todos")}>
          Todos
        </FiltroBtn>
        {estado.miembros.map((m) => (
          <FiltroBtn key={m.id} activo={filtro === m.id} color={m.color} onClick={() => setFiltro(m.id)}>
            {m.emoji} {m.nombre}
            {(saldo.get(m.id) ?? 0) !== 0 && <span className="num ml-1 text-acento">⭐{saldo.get(m.id)}</span>}
          </FiltroBtn>
        ))}
      </div>

      <form onSubmit={agregarRapido} className="flex gap-2">
        <Entrada
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder={`Nueva tarea${filtro !== "todos" && miembros.get(filtro) ? ` para ${miembros.get(filtro)!.nombre}` : ""}: “Sacar la basura”`}
        />
        <Boton type="submit" variante="primario" disabled={!texto.trim()} aria-label="Agregar tarea">
          ＋
        </Boton>
      </form>

      <div className="desliza min-h-0 flex-1 space-y-4 overflow-y-auto">
        {filtro === "todos" && (
          <div className="hidden grid-cols-[repeat(auto-fit,minmax(12.5rem,1fr))] items-start gap-3 md:grid">
            {columnas.map(({ miembro, tareas }) => (
              <div key={miembro?.id ?? "cualquiera"} className="flex min-w-0 flex-col gap-2 rounded-3xl bg-superficie p-2" style={miembro ? { boxShadow: `inset 0 6px 0 ${miembro.color}` } : undefined}>
                <div className="flex items-center gap-2 px-1 pt-1.5">
                  {miembro ? <Avatar miembro={miembro} /> : <span className="flex size-10 items-center justify-center text-2xl">👥</span>}
                  <span className="min-w-0 flex-1 truncate text-xl font-extrabold">{miembro?.nombre ?? "Quien pueda"}</span>
                  {miembro && <Estrellas n={saldo.get(miembro.id) ?? 0} />}
                </div>
                {tareas.length === 0 && <p className="py-3 text-center text-lg text-tinta-suave">Nada para hoy 🎉</p>}
                {tareas.map((t) => (
                  <FilaTarea key={t.id} t={t} hoy={hoy} miembros={miembros} enColumna alMarcar={() => marcar(t)} alEditar={() => proteger(() => setEditando(t))} />
                ))}
              </div>
            ))}
          </div>
        )}

        <div className={cx("space-y-2", filtro === "todos" && "md:hidden")}>
          {deHoy.length === 0 && <Vacio emoji="🎉" texto="Nada para hoy." />}
          {deHoy.map((t) => (
            <FilaTarea key={t.id} t={t} hoy={hoy} miembros={miembros} alMarcar={() => marcar(t)} alEditar={() => proteger(() => setEditando(t))} />
          ))}
        </div>

        {(otrosDias.length > 0 || hayHechasUnaVez) && (
          <div className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-lg font-extrabold uppercase text-tinta-suave">{otrosDias.length > 0 ? "Otros días" : ""}</h2>
              {hayHechasUnaVez && (
                <Boton
                  variante="fantasma"
                  onClick={() =>
                    actualizar("tareas", (l) =>
                      l.filter((t) => !((!t.repetir || t.repetir === "nunca") && t.hecha && (filtro === "todos" || t.miembroId === filtro))),
                    )
                  }
                >
                  🧹 Limpiar hechas
                </Boton>
              )}
            </div>
            {otrosDias.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => proteger(() => setEditando(t))}
                className="flex min-h-12 w-full items-center gap-3 rounded-2xl bg-superficie px-3 py-2 text-left opacity-70"
              >
                {t.miembroId && miembros.get(t.miembroId) ? <Avatar miembro={miembros.get(t.miembroId)!} tam="sm" /> : <span>👥</span>}
                <span className="min-w-0 flex-1 truncate text-lg font-bold">{t.titulo}</span>
                <span className="text-base font-bold text-tinta-suave">{textoRepeticion(t)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {festejo && (
        <div role="status" className="aparecer pointer-events-none fixed inset-x-0 bottom-24 z-40 mx-auto w-fit rounded-full bg-acento px-6 py-3 text-2xl font-extrabold text-acento-tinta shadow-xl md:bottom-10">
          {festejo}
        </div>
      )}
      {editando && <EditorTarea tarea={editando === "nueva" ? undefined : editando} paraInicial={filtro === "todos" ? undefined : filtro} alCerrar={() => setEditando(null)} />}
      {verPremios && <PremiosModal alCerrar={() => setVerPremios(false)} />}
      {quien && (
        <Modal titulo="¿Quién la hizo?" alCerrar={() => setQuien(null)} ancho="max-w-md">
          <p className="mb-4 text-lg">
            “{quien.titulo}” · <Estrellas n={quien.estrellas ?? 0} signo />
          </p>
          <div className="grid grid-cols-2 gap-3">
            {estado.miembros.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  const t = quien;
                  setQuien(null);
                  marcar(t, m.id);
                }}
                className="flex min-h-20 flex-col items-center justify-center gap-1 rounded-2xl bg-superficie-2 p-2 text-lg font-bold active:scale-95"
              >
                <Avatar miembro={m} />
                {m.nombre}
              </button>
            ))}
          </div>
        </Modal>
      )}
    </section>
  );
}

function Estrellas({ n, signo }: { n: number; signo?: boolean }) {
  return (
    <span className="num inline-flex shrink-0 items-center gap-0.5 rounded-full bg-acento-suave px-2.5 py-0.5 text-lg font-extrabold">
      ⭐ {signo && n > 0 ? "+" : ""}
      {n}
    </span>
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
  hoy,
  miembros,
  enColumna,
  alMarcar,
  alEditar,
}: {
  t: Tarea;
  hoy: string;
  miembros: Map<string, Miembro>;
  enColumna?: boolean;
  alMarcar: () => void;
  alEditar: () => void;
}) {
  const m = t.miembroId ? miembros.get(t.miembroId) : undefined;
  const hecha = hechaEn(t, hoy);
  const rep = textoRepeticion(t);
  const mom = MOMENTOS.find((x) => x.id === t.momento);
  return (
    <div
      className={cx("flex items-center gap-1 rounded-2xl p-1.5", enColumna ? "bg-superficie-2 pl-2" : "bg-superficie pl-2.5", hecha && "opacity-55")}
      style={m && !enColumna ? { boxShadow: `inset 6px 0 0 ${m.color}` } : undefined}
    >
      <button type="button" onClick={alMarcar} className={cx("flex min-h-14 min-w-0 flex-1 items-center text-left", enColumna ? "gap-2" : "gap-3")}>
        <Casilla marcada={hecha} color={m?.color} />
        <span className="min-w-0 flex-1">
          <span className={cx("block break-words font-extrabold leading-tight", enColumna ? "text-lg xl:text-xl" : "text-xl md:text-2xl", hecha && "line-through")}>
            {mom && <span aria-label={mom.texto}>{mom.emoji} </span>}
            {t.titulo}
          </span>
          {(rep || (t.estrellas ?? 0) > 0 || (!enColumna && !m)) && (
            <span className="mt-0.5 flex flex-wrap gap-x-2 text-base font-bold text-tinta-suave">
              {(t.estrellas ?? 0) > 0 && <span className="text-acento">⭐ {t.estrellas}</span>}
              {rep && <span>🔁 {rep}</span>}
              {!enColumna && !m && <span>👥 Quien pueda</span>}
            </span>
          )}
        </span>
      </button>
      {!enColumna && m && <Avatar miembro={m} tam="sm" />}
      <BotonIcono etiqueta={`Editar “${t.titulo}”`} className={cx("bg-transparent text-tinta-suave", enColumna ? "w-9 text-base" : "text-lg")} onClick={alEditar}>
        ✏️
      </BotonIcono>
    </div>
  );
}

// ---------- Editor de quehaceres ----------

function EditorTarea({ tarea, paraInicial, alCerrar }: { tarea?: Tarea; paraInicial?: string; alCerrar: () => void }) {
  const { estado, actualizar } = useDatos();
  const [f, setF] = useState<Tarea>(
    () => tarea ?? { id: nuevoId("tar"), titulo: "", miembroId: paraInicial, hecha: false, creada: new Date().toISOString(), repetir: "nunca" },
  );
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Tarea>(k: K, v: Tarea[K]) => setF((p) => ({ ...p, [k]: v }));
  const repetir = f.repetir ?? "nunca";
  const sinDias = repetir === "dias" && !f.dias?.length;
  const valido = f.titulo.trim() !== "" && !sinDias;

  const guardar = async () => {
    const limpio: Tarea = {
      ...f,
      titulo: f.titulo.trim(),
      dias: repetir === "dias" ? [...(f.dias ?? [])].sort() : undefined,
      hechas: repetir === "nunca" ? undefined : (f.hechas ?? []),
      estrellas: f.estrellas || undefined,
    };
    const ok = await actualizar("tareas", (l) => (l.some((t) => t.id === limpio.id) ? l.map((t) => (t.id === limpio.id ? limpio : t)) : [limpio, ...l]));
    if (ok) alCerrar();
    else setError("No se pudo guardar: el almacenamiento de este equipo está lleno.");
  };
  const borrar = () => {
    actualizar("tareas", (l) => l.filter((t) => t.id !== f.id));
    alCerrar();
  };

  return (
    <Modal
      titulo={tarea ? "Editar tarea" : "Nueva tarea"}
      alCerrar={alCerrar}
      pie={
        <>
          {error && <span className="w-full text-base font-bold text-red-700 noche:text-red-300">{error}</span>}
          {tarea && (
            <Boton variante="peligro" className="mr-auto" onClick={borrar}>
              Borrar
            </Boton>
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
        <Campo etiqueta="¿Qué hay que hacer?">
          <Entrada autoFocus value={f.titulo} onChange={(e) => set("titulo", e.target.value)} placeholder="Ej.: Hacer la cama" />
        </Campo>

        <div>
          <span className="mb-1.5 block text-base font-bold text-tinta-suave">¿Quién?</span>
          <div className="flex flex-wrap gap-2">
            <FiltroBtn activo={!f.miembroId} onClick={() => set("miembroId", undefined)}>
              👥 Quien pueda
            </FiltroBtn>
            {estado.miembros.map((m) => (
              <FiltroBtn key={m.id} activo={f.miembroId === m.id} color={m.color} onClick={() => set("miembroId", m.id)}>
                {m.emoji} {m.nombre}
              </FiltroBtn>
            ))}
          </div>
        </div>

        <div>
          <span className="mb-1.5 block text-base font-bold text-tinta-suave">¿Se repite?</span>
          <Segmentos<"nunca" | "diaria" | "dias">
            valor={repetir}
            alCambiar={(v) => setF((p) => ({ ...p, repetir: v, dias: v === "dias" ? (p.dias?.length ? p.dias : [diaSemana(hoyFecha())]) : p.dias }))}
            opciones={[
              { valor: "nunca", texto: "Una vez" },
              { valor: "diaria", texto: "Todos los días" },
              { valor: "dias", texto: "Algunos días" },
            ]}
          />
          {repetir === "dias" && (
            <div className="mt-3 flex flex-wrap gap-2">
              {DIAS_LETRA.map((l, i) => {
                const activo = !!f.dias?.includes(i);
                return (
                  <button
                    key={i}
                    type="button"
                    aria-label={DIAS_NOMBRE[i]}
                    aria-pressed={activo}
                    onClick={() => set("dias", activo ? (f.dias ?? []).filter((d) => d !== i) : [...(f.dias ?? []), i])}
                    className={cx("size-12 rounded-full text-lg font-extrabold transition", activo ? "bg-acento text-acento-tinta" : "bg-superficie-2 text-tinta-suave")}
                  >
                    {l}
                  </button>
                );
              })}
              {sinDias && <span className="w-full text-base font-bold text-red-700 noche:text-red-300">Elige al menos un día.</span>}
            </div>
          )}
        </div>

        <div>
          <span className="mb-1.5 block text-base font-bold text-tinta-suave">¿En qué momento? (opcional)</span>
          <div className="flex flex-wrap gap-2">
            <FiltroBtn activo={!f.momento} onClick={() => set("momento", undefined)}>
              Cualquiera
            </FiltroBtn>
            {MOMENTOS.map((m) => (
              <FiltroBtn key={m.id} activo={f.momento === m.id} onClick={() => set("momento", m.id)}>
                {m.emoji} {m.texto}
              </FiltroBtn>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <span className="text-base font-bold text-tinta-suave">⭐ Estrellas que gana</span>
          <Contador valor={f.estrellas ?? 0} min={0} max={5} alCambiar={(v) => set("estrellas", v)} />
        </div>
      </div>
    </Modal>
  );
}

// ---------- Premios y estrellas ----------

function PremiosModal({ alCerrar }: { alCerrar: () => void }) {
  const { estado, actualizar } = useDatos();
  const { proteger } = useCandado();
  const saldo = saldos(estado.estrellas);
  const miembros = new Map(estado.miembros.map((m) => [m.id, m]));
  const [nuevo, setNuevo] = useState<Premio | null>(null);
  const [canje, setCanje] = useState<{ premio: Premio; miembro: Miembro } | null>(null);

  const ajustar = (m: Miembro, cantidad: number) =>
    proteger(() =>
      actualizar("estrellas", (l) => [
        ...l,
        { id: nuevoId("est"), miembroId: m.id, cantidad, motivo: cantidad > 0 ? "Estrella extra" : "Ajuste", fecha: new Date().toISOString() },
      ]),
    );
  const canjear = (premio: Premio, m: Miembro) =>
    actualizar("estrellas", (l) => [
      ...l,
      { id: nuevoId("est"), miembroId: m.id, cantidad: -premio.costo, motivo: `${premio.emoji} ${premio.titulo}`, fecha: new Date().toISOString() },
    ]);
  const historial = [...estado.estrellas].sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 12);

  return (
    <>
      <Modal titulo="🏆 Estrellas y premios" alCerrar={alCerrar} ancho="max-w-4xl">
        <div className="space-y-6">
          <div className="grid gap-2 sm:grid-cols-2">
            {estado.miembros.map((m) => (
              <div key={m.id} className="flex items-center gap-3 rounded-2xl bg-superficie-2 p-2 pl-3">
                <Avatar miembro={m} />
                <span className="min-w-0 flex-1 truncate text-xl font-extrabold">{m.nombre}</span>
                <Estrellas n={saldo.get(m.id) ?? 0} />
                <BotonIcono etiqueta={`Quitar una estrella a ${m.nombre}`} onClick={() => ajustar(m, -1)}>
                  −
                </BotonIcono>
                <BotonIcono etiqueta={`Dar una estrella a ${m.nombre}`} onClick={() => ajustar(m, 1)}>
                  +
                </BotonIcono>
              </div>
            ))}
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-lg font-extrabold uppercase text-tinta-suave">Premios</h3>
              <Boton onClick={() => proteger(() => setNuevo({ id: nuevoId("pre"), titulo: "", emoji: "🎁", costo: 10 }))}>＋ Premio</Boton>
            </div>
            {estado.premios.length === 0 && <Vacio emoji="🎁" texto="Agrega premios para canjear con estrellas." />}
            <div className="space-y-2">
              {estado.premios.map((p) => {
                const para = p.miembroId ? estado.miembros.filter((m) => m.id === p.miembroId) : estado.miembros;
                return (
                  <div key={p.id} className="rounded-2xl bg-superficie-2 p-3">
                    <div className="flex items-center gap-3">
                      <span className="text-4xl" aria-hidden>
                        {p.emoji}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xl font-extrabold leading-tight">{p.titulo}</span>
                        <span className="text-base font-bold text-tinta-suave">
                          ⭐ {p.costo} · {p.miembroId ? `para ${miembros.get(p.miembroId)?.nombre ?? "—"}` : "para todos"}
                        </span>
                      </span>
                      <BotonIcono
                        etiqueta={`Borrar premio ${p.titulo}`}
                        className="bg-transparent text-lg text-tinta-suave"
                        onClick={() => proteger(() => actualizar("premios", (l) => l.filter((x) => x.id !== p.id)))}
                      >
                        ✕
                      </BotonIcono>
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {para.map((m) => {
                        const s = saldo.get(m.id) ?? 0;
                        const alcanza = s >= p.costo;
                        return (
                          <div key={m.id} className="flex items-center gap-2">
                            <Avatar miembro={m} tam="sm" />
                            {alcanza ? (
                              <Boton variante="primario" className="flex-1" onClick={() => proteger(() => setCanje({ premio: p, miembro: m }))}>
                                Canjear
                              </Boton>
                            ) : (
                              <div className="flex-1" title={`${s} de ${p.costo}`}>
                                <div className="h-3 overflow-hidden rounded-full bg-fondo">
                                  <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, (s / p.costo) * 100))}%`, background: m.color }} />
                                </div>
                                <span className="num text-sm font-bold text-tinta-suave">
                                  faltan {p.costo - s} ⭐
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {historial.length > 0 && (
            <div>
              <h3 className="mb-2 text-lg font-extrabold uppercase text-tinta-suave">Últimos movimientos</h3>
              <ul className="space-y-1 text-base">
                {historial.map((h) => (
                  <li key={h.id} className="flex items-center gap-2">
                    <span className={cx("num w-12 shrink-0 text-right font-extrabold", h.cantidad > 0 ? "text-ok" : "text-red-700 noche:text-red-300")}>
                      {h.cantidad > 0 ? "+" : ""}
                      {h.cantidad}
                    </span>
                    <span className="font-bold">{miembros.get(h.miembroId)?.nombre ?? "—"}</span>
                    <span className="min-w-0 flex-1 truncate text-tinta-suave">{h.motivo}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Modal>

      {nuevo && (
        <Modal
          titulo="Nuevo premio"
          alCerrar={() => setNuevo(null)}
          ancho="max-w-lg"
          pie={
            <>
              <Boton variante="fantasma" onClick={() => setNuevo(null)}>
                Cancelar
              </Boton>
              <Boton
                variante="primario"
                disabled={!nuevo.titulo.trim()}
                onClick={() => {
                  actualizar("premios", (l) => [...l, { ...nuevo, titulo: nuevo.titulo.trim(), emoji: nuevo.emoji.trim() || "🎁" }]);
                  setNuevo(null);
                }}
              >
                Guardar
              </Boton>
            </>
          }
        >
          <div className="space-y-4">
            <div className="grid grid-cols-[5rem_1fr] gap-3">
              <Campo etiqueta="Ícono">
                <Entrada value={nuevo.emoji} maxLength={4} className="text-center text-2xl" onChange={(e) => setNuevo({ ...nuevo, emoji: e.target.value })} />
              </Campo>
              <Campo etiqueta="Premio">
                <Entrada autoFocus value={nuevo.titulo} placeholder="Ej.: Helado" onChange={(e) => setNuevo({ ...nuevo, titulo: e.target.value })} />
              </Campo>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <span className="text-base font-bold text-tinta-suave">⭐ Cuesta</span>
              <Contador valor={nuevo.costo} min={1} max={500} alCambiar={(v) => setNuevo({ ...nuevo, costo: v })} />
            </div>
            <div className="flex flex-wrap gap-2">
              <FiltroBtn activo={!nuevo.miembroId} onClick={() => setNuevo({ ...nuevo, miembroId: undefined })}>
                Para todos
              </FiltroBtn>
              {estado.miembros.map((m) => (
                <FiltroBtn key={m.id} activo={nuevo.miembroId === m.id} color={m.color} onClick={() => setNuevo({ ...nuevo, miembroId: m.id })}>
                  {m.emoji} {m.nombre}
                </FiltroBtn>
              ))}
            </div>
          </div>
        </Modal>
      )}

      {canje && (
        <Modal
          titulo="¿Canjear el premio?"
          alCerrar={() => setCanje(null)}
          ancho="max-w-md"
          pie={
            <>
              <Boton variante="fantasma" onClick={() => setCanje(null)}>
                Cancelar
              </Boton>
              <Boton
                variante="primario"
                onClick={() => {
                  canjear(canje.premio, canje.miembro);
                  setCanje(null);
                }}
              >
                Sí, canjear
              </Boton>
            </>
          }
        >
          <p className="text-center text-xl">
            <span className="block text-6xl">{canje.premio.emoji}</span>
            <strong>{canje.premio.titulo}</strong> para <strong>{canje.miembro.nombre}</strong>
            <span className="mt-2 block text-tinta-suave">Se descuentan ⭐ {canje.premio.costo}.</span>
          </p>
        </Modal>
      )}
    </>
  );
}
