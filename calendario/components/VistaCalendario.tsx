"use client";

import { useMemo, useState } from "react";
import { useDatos } from "@/lib/store";
import type { Evento, Miembro, Ocurrencia } from "@/lib/datos/tipos";
import {
  DIAS_CORTOS,
  DIAS_LARGOS,
  diasDeSemana,
  fechaLarga,
  grillaMes,
  lunesDe,
  mesAnio,
  partes,
  rangoSemana,
  sumarDias,
  sumarMeses,
  diaSemana,
} from "@/lib/fechas";
import { ocurrenciasEnRango, textoHora } from "@/lib/eventos";
import { iconoClima, useIrAHoyEnMovil, type Clima } from "@/lib/hooks";
import { claveComida } from "@/lib/compras";
import { TIPOS_COMIDA, nombreComida } from "@/lib/comidas";
import { Avatar, Boton, BotonIcono, Segmentos, cx } from "./ui";
import EventoModal from "./EventoModal";

type Modo = "dia" | "semana" | "mes";

export default function VistaCalendario({
  hoy,
  clima,
  alIrAMenu,
}: {
  hoy: string;
  clima: Clima | null;
  alIrAMenu: () => void;
}) {
  const { estado } = useDatos();
  const [modo, setModo] = useState<Modo>("semana");
  // null = seguir a "hoy" (así a medianoche la pared pasa sola al día y la semana nuevos).
  const [ancla, setAncla] = useState<string | null>(null);
  const a = ancla ?? hoy;
  const [filtro, setFiltro] = useState<Set<string>>(new Set());
  const [editando, setEditando] = useState<{ evento?: Evento; fecha: string } | null>(null);

  const miembros = useMemo(() => new Map(estado.miembros.map((m) => [m.id, m])), [estado.miembros]);

  const mover = (dir: number) => {
    if (modo === "dia") setAncla((x) => sumarDias(x ?? hoy, dir));
    if (modo === "semana") setAncla((x) => sumarDias(x ?? hoy, 7 * dir));
    if (modo === "mes") setAncla((x) => sumarMeses(x ?? hoy, dir));
  };

  const titulo =
    modo === "semana" ? rangoSemana(lunesDe(a)) : modo === "mes" ? mesAnio(a) : fechaLarga(a, true);

  const alternar = (id: string) =>
    setFiltro((f) => {
      const n = new Set(f);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <section className="flex h-full flex-col gap-3">
      {/* Controles */}
      <div className="flex flex-wrap items-center gap-2">
        <BotonIcono etiqueta="Anterior" onClick={() => mover(-1)}>
          ‹
        </BotonIcono>
        <Boton onClick={() => setAncla(null)} className={cx(a === hoy && "opacity-60")}>
          Hoy
        </Boton>
        <BotonIcono etiqueta="Siguiente" onClick={() => mover(1)}>
          ›
        </BotonIcono>
        <h1 className="mx-1 min-w-0 text-balance font-display text-2xl font-semibold first-letter:uppercase md:whitespace-nowrap xl:text-3xl">
          {titulo}
        </h1>
        <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
          <div className="hidden items-center gap-1 xl:flex">
            {estado.miembros.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => alternar(m.id)}
                aria-pressed={filtro.has(m.id)}
                title={`Ver sólo ${m.nombre}`}
                className={cx(
                  "rounded-full p-0.5 transition active:scale-95",
                  filtro.size > 0 && !filtro.has(m.id) && "opacity-35",
                )}
                style={filtro.has(m.id) ? { boxShadow: `0 0 0 3px ${m.color}` } : undefined}
              >
                <Avatar miembro={m} />
              </button>
            ))}
          </div>
          <Segmentos
            valor={modo}
            alCambiar={setModo}
            opciones={[
              { valor: "dia", texto: "Día" },
              { valor: "semana", texto: "Semana" },
              { valor: "mes", texto: "Mes" },
            ]}
          />
          <Boton variante="primario" aria-label="Nuevo evento" onClick={() => setEditando({ fecha: a })}>
            ＋<span className="max-sm:hidden">Evento</span>
          </Boton>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {modo === "semana" && (
          <Semana
            lunes={lunesDe(a)}
            hoy={hoy}
            filtro={filtro}
            miembros={miembros}
            clima={clima}
            alAbrir={(evento, fecha) => setEditando({ evento, fecha })}
            alNuevo={(fecha) => setEditando({ fecha })}
            alIrAMenu={alIrAMenu}
            alVerDia={(f) => {
              setAncla(f);
              setModo("dia");
            }}
          />
        )}
        {modo === "mes" && (
          <Mes
            ancla={a}
            hoy={hoy}
            filtro={filtro}
            miembros={miembros}
            alVerDia={(f) => {
              setAncla(f);
              setModo("dia");
            }}
          />
        )}
        {modo === "dia" && (
          <Dia
            fecha={a}
            hoy={hoy}
            filtro={filtro}
            miembros={miembros}
            clima={clima}
            alAbrir={(evento, fecha) => setEditando({ evento, fecha })}
            alIrAMenu={alIrAMenu}
          />
        )}
      </div>

      {editando && (
        <EventoModal evento={editando.evento} fecha={editando.fecha} alCerrar={() => setEditando(null)} />
      )}
    </section>
  );
}

// ---------- Tarjeta de evento ----------

function coloresDe(ids: string[], miembros: Map<string, Miembro>): string[] {
  return ids.map((id) => miembros.get(id)?.color).filter(Boolean) as string[];
}

function estiloPersonas(ids: string[], miembros: Map<string, Miembro>): React.CSSProperties {
  const colores = coloresDe(ids, miembros);
  const c = colores[0] ?? "#999999";
  if (colores.length <= 1) return { ["--color-persona" as string]: c };
  const paso = 100 / colores.length;
  const franjas = colores.map((col, i) => `${col} ${i * paso}% ${(i + 1) * paso}%`).join(", ");
  return { ["--color-persona" as string]: c, ["--franjas" as string]: franjas };
}

/** Punto del mes en el teléfono: un color, o un círculo repartido entre todas las personas. */
function puntoPersonas(ids: string[], miembros: Map<string, Miembro>): string {
  const colores = coloresDe(ids, miembros);
  if (colores.length <= 1) return colores[0] ?? "#999999";
  const paso = 360 / colores.length;
  return `conic-gradient(${colores.map((c, i) => `${c} ${i * paso}deg ${(i + 1) * paso}deg`).join(", ")})`;
}

function TarjetaEvento({
  oc,
  miembros,
  grande,
  onClick,
}: {
  oc: Ocurrencia;
  miembros: Map<string, Miembro>;
  grande?: boolean;
  onClick: () => void;
}) {
  const ev = oc.evento;
  const personas = ev.miembros.map((id) => miembros.get(id)).filter(Boolean) as Miembro[];
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cx(
        "tarjeta-evento w-full min-w-0 rounded-xl px-2 py-1.5 text-left transition active:scale-[0.98] xl:px-2.5 xl:py-2",
        personas.length > 1 && "compartido",
      )}
      style={estiloPersonas(ev.miembros, miembros)}
    >
      <div
        className={cx(
          "num flex flex-wrap items-baseline font-bold leading-tight text-tinta-suave",
          grande ? "text-xl" : "text-base 2xl:text-lg",
        )}
      >
        {ev.horaInicio && ev.horaFin && !ev.todoElDia ? (
          <>
            <span className="whitespace-nowrap">{ev.horaInicio}–</span>
            <span className="whitespace-nowrap">{ev.horaFin}</span>
          </>
        ) : (
          <span>{textoHora(ev)}</span>
        )}
        {ev.repeticion !== "nunca" && (
          <span className="ml-1" aria-label="se repite">
            ↻
          </span>
        )}
      </div>
      <div
        className={cx(
          "font-extrabold leading-snug break-words hyphens-auto",
          grande ? "text-3xl" : "text-base lg:text-lg xl:text-xl",
        )}
      >
        {ev.titulo}
      </div>
      <div className="mt-1 flex flex-wrap gap-0.5">
        {personas.map((m) => (
          <span key={m.id} className={grande ? "text-2xl" : "text-lg"} title={m.nombre}>
            {m.emoji}
          </span>
        ))}
        {grande && <span className="ml-2 self-center text-xl font-bold text-tinta-suave">{personas.map((p) => p.nombre).join(", ")}</span>}
      </div>
      {grande && ev.nota && <div className="mt-2 text-lg text-tinta-suave">📝 {ev.nota}</div>}
    </button>
  );
}

// ---------- Semana ----------

/** Almuerzo y cena al pie del día; tocarlo lleva al menú. */
function ComidasDelDia({ fecha, alTocar }: { fecha: string; alTocar: () => void }) {
  const { estado } = useDatos();
  const recetas = new Map(estado.recetas.map((r) => [r.id, r]));
  const lista = TIPOS_COMIDA.filter((t) => t.id === "almuerzo" || t.id === "cena")
    .map((t) => ({ t, c: estado.plan[claveComida(fecha, t.id)] }))
    .filter((x) => x.c);
  if (!lista.length) return null;
  return (
    <button
      type="button"
      title="Ver el menú"
      onClick={(e) => {
        e.stopPropagation();
        alTocar();
      }}
      className="block min-h-12 w-full space-y-0.5 border-t border-dashed border-borde py-1.5 text-left text-sm transition active:scale-[0.98] md:pb-0 xl:text-base"
    >
      {lista.map(({ t, c }) => (
        <span key={t.id} className="line-clamp-2 break-words font-bold leading-tight text-tinta-suave">
          <span aria-hidden>{t.emoji}</span> {nombreComida(c!, recetas)}
        </span>
      ))}
    </button>
  );
}

function Semana({
  lunes,
  hoy,
  filtro,
  miembros,
  clima,
  alAbrir,
  alNuevo,
  alVerDia,
  alIrAMenu,
}: {
  lunes: string;
  hoy: string;
  filtro: Set<string>;
  miembros: Map<string, Miembro>;
  clima: Clima | null;
  alAbrir: (e: Evento, f: string) => void;
  alNuevo: (f: string) => void;
  alVerDia: (f: string) => void;
  alIrAMenu: () => void;
}) {
  const { estado } = useDatos();
  const dias = diasDeSemana(lunes);
  const ocs = ocurrenciasEnRango(estado.eventos, dias[0], dias[6], filtro);
  const climaDia = new Map(clima?.dias.map((d) => [d.fecha, d]) ?? []);
  useIrAHoyEnMovil(lunes);

  return (
    <>
      {/* Tablet: 7 columnas */}
      <div className="hidden h-full grid-cols-7 gap-2 md:grid">
        {dias.map((f, i) => {
          const esHoy = f === hoy;
          const pasado = f < hoy;
          const cd = climaDia.get(f);
          return (
            <div
              key={f}
              onClick={() => alNuevo(f)}
              className={cx(
                "flex min-h-0 flex-col rounded-3xl border-[3px] p-2",
                esHoy ? "border-hoy-borde bg-hoy shadow-md" : "border-transparent bg-superficie",
                pasado && "opacity-60",
              )}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  alVerDia(f);
                }}
                className="mb-2 flex items-center justify-between px-1"
              >
                <div className="text-left leading-none">
                  <div className={cx("text-base font-extrabold uppercase xl:text-lg", esHoy ? "text-acento" : "text-tinta-suave")}>
                    {DIAS_CORTOS[i]}
                  </div>
                  <div className="num font-display text-4xl font-semibold xl:text-5xl">{partes(f).dia}</div>
                </div>
                {cd && (
                  <div className="text-right leading-tight">
                    <div className="text-2xl">{iconoClima(cd.codigo).icono}</div>
                    <div className="num text-sm font-bold text-tinta-suave">{cd.max}°</div>
                  </div>
                )}
              </button>
              <div className="desliza flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
                {ocs.get(f)!.map((oc) => (
                  <TarjetaEvento key={oc.evento.id} oc={oc} miembros={miembros} onClick={() => alAbrir(oc.evento, f)} />
                ))}
              </div>
              <ComidasDelDia fecha={f} alTocar={alIrAMenu} />
            </div>
          );
        })}
      </div>

      {/* Teléfono: lista por día */}
      <div className="desliza h-full space-y-3 overflow-y-auto md:hidden">
        {dias.map((f, i) => {
          const esHoy = f === hoy;
          return (
            <div
              key={f}
              data-hoy-movil={esHoy || undefined}
              className={cx("scroll-mt-2 rounded-3xl border-[3px] p-3", esHoy ? "border-hoy-borde bg-hoy" : "border-transparent bg-superficie")}
            >
              <div className="mb-2 flex items-center justify-between">
                <div className="text-xl font-extrabold">
                  {DIAS_LARGOS[i]} <span className="num">{partes(f).dia}</span>
                  {esHoy && <span className="ml-2 text-acento">· Hoy</span>}
                </div>
                <BotonIcono etiqueta="Agregar evento" onClick={() => alNuevo(f)}>
                  ＋
                </BotonIcono>
              </div>
              <div className="space-y-1.5">
                {ocs.get(f)!.length === 0 && <div className="text-base text-tinta-suave">Sin eventos</div>}
                {ocs.get(f)!.map((oc) => (
                  <TarjetaEvento key={oc.evento.id} oc={oc} miembros={miembros} onClick={() => alAbrir(oc.evento, f)} />
                ))}
              </div>
              <div className="mt-2">
                <ComidasDelDia fecha={f} alTocar={alIrAMenu} />
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---------- Mes ----------

function Mes({
  ancla,
  hoy,
  filtro,
  miembros,
  alVerDia,
}: {
  ancla: string;
  hoy: string;
  filtro: Set<string>;
  miembros: Map<string, Miembro>;
  alVerDia: (f: string) => void;
}) {
  const { estado } = useDatos();
  const dias = grillaMes(ancla);
  const mes = partes(ancla).mes;
  const ocs = ocurrenciasEnRango(estado.eventos, dias[0], dias[41], filtro);
  return (
    <div className="flex h-full flex-col">
      <div className="grid grid-cols-7 gap-1.5 pb-1.5">
        {DIAS_CORTOS.map((d) => (
          <div key={d} className="text-center text-sm font-extrabold uppercase text-tinta-suave md:text-base">
            {d}
          </div>
        ))}
      </div>
      {/* En el teléfono cada fila tiene un alto mínimo (el número y los puntos) y la grilla hace scroll. */}
      <div className="desliza grid min-h-0 flex-1 grid-cols-7 grid-rows-[repeat(6,minmax(3.25rem,1fr))] gap-1.5 overflow-y-auto md:grid-rows-6 md:overflow-visible">
        {dias.map((f) => {
          const lista = ocs.get(f)!;
          const fuera = partes(f).mes !== mes;
          const esHoy = f === hoy;
          return (
            <button
              key={f}
              type="button"
              onClick={() => alVerDia(f)}
              className={cx(
                "flex min-h-0 flex-col overflow-hidden rounded-2xl border-[3px] p-1 text-left md:p-1.5",
                esHoy ? "border-hoy-borde bg-hoy" : "border-transparent bg-superficie",
                fuera && "opacity-40",
              )}
            >
              <span className={cx("num px-1 text-lg font-extrabold md:text-xl", esHoy && "text-acento")}>{partes(f).dia}</span>
              <div className="hidden min-h-0 flex-1 flex-col gap-0.5 overflow-hidden md:flex">
                {lista.slice(0, 2).map((oc) => (
                  <span
                    key={oc.evento.id}
                    className={cx(
                      "tarjeta-evento etiqueta-mes shrink-0 truncate rounded-md px-1.5 py-px text-sm font-bold leading-snug",
                      coloresDe(oc.evento.miembros, miembros).length > 1 && "compartido",
                    )}
                    style={estiloPersonas(oc.evento.miembros, miembros)}
                  >
                    {oc.evento.titulo}
                  </span>
                ))}
                {lista.length > 2 && <span className="shrink-0 px-1 text-sm font-bold leading-snug text-tinta-suave">+{lista.length - 2} más</span>}
              </div>
              <div className="flex flex-wrap gap-0.5 px-1 md:hidden">
                {lista.slice(0, 4).map((oc) => (
                  <span
                    key={oc.evento.id}
                    className="size-2 rounded-full"
                    style={{ background: puntoPersonas(oc.evento.miembros, miembros) }}
                  />
                ))}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Día ----------

function Dia({
  fecha,
  hoy,
  filtro,
  miembros,
  clima,
  alAbrir,
  alIrAMenu,
}: {
  fecha: string;
  hoy: string;
  filtro: Set<string>;
  miembros: Map<string, Miembro>;
  clima: Clima | null;
  alAbrir: (e: Evento, f: string) => void;
  alIrAMenu: () => void;
}) {
  const { estado } = useDatos();
  const lista = ocurrenciasEnRango(estado.eventos, fecha, fecha, filtro).get(fecha)!;
  const recetas = new Map(estado.recetas.map((r) => [r.id, r]));
  const cd = clima?.dias.find((d) => d.fecha === fecha);
  return (
    <div className="grid h-full gap-3 md:grid-cols-[2fr_1fr]">
      <div className={cx("desliza min-h-0 overflow-y-auto rounded-3xl p-3 md:p-4", fecha === hoy ? "bg-hoy" : "bg-superficie")}>
        <div className="mb-3 text-2xl font-extrabold md:text-3xl">
          {DIAS_LARGOS[diaSemana(fecha)]}
          {fecha === hoy && <span className="ml-2 text-acento">· Hoy</span>}
        </div>
        {lista.length === 0 && <div className="py-10 text-center text-2xl text-tinta-suave">Día libre 🌿</div>}
        <div className="space-y-2.5">
          {lista.map((oc) => (
            <TarjetaEvento key={oc.evento.id} oc={oc} miembros={miembros} grande onClick={() => alAbrir(oc.evento, fecha)} />
          ))}
        </div>
      </div>
      <div className="desliza min-h-0 space-y-3 overflow-y-auto">
        {cd && (
          <div className="flex items-center gap-4 rounded-3xl bg-superficie p-4">
            <span className="text-6xl">{iconoClima(cd.codigo).icono}</span>
            <div>
              <div className="text-xl font-bold">{iconoClima(cd.codigo).texto}</div>
              <div className="num text-3xl font-extrabold">
                {cd.max}° <span className="text-tinta-suave">/ {cd.min}°</span>
              </div>
            </div>
          </div>
        )}
        <button type="button" onClick={alIrAMenu} className="block w-full rounded-3xl bg-superficie p-4 text-left transition active:scale-[0.99]">
          <div className="mb-2 text-lg font-extrabold uppercase text-acento">Menú del día</div>
          {TIPOS_COMIDA.map((t) => {
            const c = estado.plan[claveComida(fecha, t.id)];
            return (
              <div key={t.id} className="flex items-center gap-3 border-b border-borde py-2.5 last:border-0">
                <span className="text-3xl">{c?.recetaId ? recetas.get(c.recetaId)?.emoji : t.emoji}</span>
                <div>
                  <div className="text-sm font-bold uppercase text-tinta-suave">{t.nombre}</div>
                  <div className="text-xl font-extrabold">{c ? nombreComida(c, recetas) : "—"}</div>
                </div>
              </div>
            );
          })}
        </button>
      </div>
    </div>
  );
}
