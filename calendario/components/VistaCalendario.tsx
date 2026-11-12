"use client";

import { useMemo, useState } from "react";
import { useDatos } from "@/lib/store";
import { useCandado } from "@/lib/candado";
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
  semanaCorta,
  sumarDias,
  sumarMeses,
  diaSemana,
  MESES,
} from "@/lib/fechas";
import { duracionDias, ocurrenciasEnRango, seRepite, textoHora } from "@/lib/eventos";
import { iconoClima, useIrAHoyEnMovil, type Clima } from "@/lib/hooks";
import { claveComida } from "@/lib/compras";
import { TIPOS_COMIDA, emojiComida, nombreComida, nombresComida } from "@/lib/comidas";
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
  const { proteger } = useCandado();

  const miembros = useMemo(() => new Map(estado.miembros.map((m) => [m.id, m])), [estado.miembros]);

  const mover = (dir: number) => {
    if (modo === "dia") setAncla((x) => sumarDias(x ?? hoy, dir));
    if (modo === "semana") setAncla((x) => sumarDias(x ?? hoy, 7 * dir));
    if (modo === "mes") setAncla((x) => sumarMeses(x ?? hoy, dir));
  };

  const titulo =
    modo === "semana" ? rangoSemana(lunesDe(a)) : modo === "mes" ? mesAnio(a) : fechaLarga(a, true);
  // Celular: título corto (cabe entre ‹ y › en una línea) y, debajo, si es el período de hoy o cómo volver.
  const pa = partes(a);
  const tituloCorto =
    modo === "semana"
      ? semanaCorta(lunesDe(a))
      : modo === "mes"
        ? mesAnio(a)
        : `${DIAS_CORTOS[diaSemana(a)]} ${pa.dia} ${MESES[pa.mes - 1].slice(0, 3)}`;
  const enHoy =
    modo === "semana" ? lunesDe(a) === lunesDe(hoy) : modo === "mes" ? a.slice(0, 7) === hoy.slice(0, 7) : a === hoy;

  const alternar = (id: string) =>
    setFiltro((f) => {
      const n = new Set(f);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <section className="flex h-full flex-col gap-3 cel:gap-2">
      {/* Controles. Celular (2 filas): ‹ título › ＋ y debajo Día | Semana | Mes a todo el ancho; tocar el
          título vuelve a hoy (reemplaza al botón «Hoy»). */}
      <div className="flex flex-wrap items-center gap-2 cel:grid cel:grid-cols-[auto_minmax(0,1fr)_auto_auto] cel:gap-x-1">
        <BotonIcono etiqueta="Anterior" onClick={() => mover(-1)} className="cel:col-start-1 cel:row-start-1">
          ‹
        </BotonIcono>
        <Boton onClick={() => setAncla(null)} className={cx(a === hoy && "opacity-60", "cel:hidden")}>
          Hoy
        </Boton>
        <BotonIcono etiqueta="Siguiente" onClick={() => mover(1)} className="cel:col-start-3 cel:row-start-1">
          ›
        </BotonIcono>
        <h1 className="mx-1 min-w-0 text-balance font-display text-2xl font-semibold first-letter:uppercase md:whitespace-nowrap xl:text-3xl cel:hidden">
          {titulo}
        </h1>
        <button
          type="button"
          onClick={() => setAncla(null)}
          aria-label={enHoy ? titulo : `${titulo}. Volver a hoy`}
          className="hidden min-h-11 min-w-0 flex-col items-center justify-center rounded-xl px-1 leading-tight transition active:scale-[0.97] cel:col-start-2 cel:row-start-1 cel:flex"
        >
          <span className="max-w-full truncate font-display text-2xl font-semibold first-letter:uppercase">{tituloCorto}</span>
          <span className={cx("text-xs font-bold", enHoy ? "text-tinta-suave" : "text-acento")}>
            {enHoy ? (modo === "semana" ? "Esta semana" : modo === "mes" ? "Este mes" : "Hoy") : "↩ Volver a hoy"}
          </span>
        </button>
        <div className="flex flex-1 flex-wrap items-center justify-end gap-2 cel:contents">
          <div className="hidden items-center gap-1 xl:flex cel:hidden">
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
            lleno
            className="cel:col-span-4 cel:row-start-2"
            opciones={[
              { valor: "dia", texto: "Día" },
              { valor: "semana", texto: "Semana" },
              { valor: "mes", texto: "Mes" },
            ]}
          />
          <Boton
            variante="primario"
            aria-label="Nuevo evento"
            className="cel:col-start-4 cel:row-start-1 cel:ml-1 cel:min-w-11"
            onClick={() => proteger(() => setEditando({ fecha: a }))}
          >
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
            alNuevo={(fecha) => proteger(() => setEditando({ fecha }))}
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
  fila,
  onClick,
}: {
  oc: Ocurrencia;
  miembros: Map<string, Miembro>;
  grande?: boolean;
  /** Celular: una fila (hora a la izquierda, título, personas a la derecha) en vez de 3 líneas. */
  fila?: boolean;
  onClick: () => void;
}) {
  const ev = oc.evento;
  const personas = ev.miembros.map((id) => miembros.get(id)).filter(Boolean) as Miembro[];
  if (fila) return <FilaEvento oc={oc} personas={personas} miembros={miembros} onClick={onClick} />;
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
        {ev.horaInicio && ev.horaFin && !ev.todoElDia && duracionDias(ev) === 1 ? (
          <>
            <span className="whitespace-nowrap">{ev.horaInicio}–</span>
            <span className="whitespace-nowrap">{ev.horaFin}</span>
          </>
        ) : (
          <span>{textoHora(ev, oc)}</span>
        )}
        {seRepite(ev) && (
          <span className="ml-1" aria-label="se repite">
            ↻
          </span>
        )}
      </div>
      <div
        className={cx(
          "font-extrabold leading-snug break-words hyphens-auto",
          grande ? "text-3xl cel:text-[1.375rem]" : "text-base lg:text-lg xl:text-xl",
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
      {grande && ev.lugar && <div className="mt-2 break-words text-lg text-tinta-suave">📍 {ev.lugar}</div>}
      {grande && ev.nota && <div className="mt-2 whitespace-pre-line break-words text-lg text-tinta-suave">📝 {ev.nota}</div>}
    </button>
  );
}

/** Lo que va en la columna de la hora de la fila: inicio arriba y término abajo. */
function horasFila(ev: Evento, oc: Ocurrencia): [string, string] {
  if (ev.horaInicio && ev.horaFin && !ev.todoElDia && duracionDias(ev) === 1) return [ev.horaInicio, ev.horaFin];
  const t = textoHora(ev, oc);
  if (t === "Todo el día") return ["Todo", "el día"];
  const m = /^(Desde|Hasta) (.+)$/.exec(t);
  return m ? [m[1], m[2]] : [t, ""];
}

function FilaEvento({
  oc,
  personas,
  miembros,
  onClick,
}: {
  oc: Ocurrencia;
  personas: Miembro[];
  miembros: Map<string, Miembro>;
  onClick: () => void;
}) {
  const ev = oc.evento;
  const [arriba, abajo] = horasFila(ev, oc);
  const esHora = /^\d/.test(arriba);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cx(
        "tarjeta-evento flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-xl py-1.5 pl-2 pr-2.5 text-left transition active:scale-[0.98]",
        personas.length > 1 && "compartido",
      )}
      style={estiloPersonas(ev.miembros, miembros)}
    >
      <span className="num w-11 shrink-0 leading-tight">
        <span className={cx("block font-bold", esHora ? "text-[0.9375rem]" : "text-[0.8125rem]")}>{arriba}</span>
        {(abajo || seRepite(ev)) && (
          <span className="block whitespace-nowrap text-[0.8125rem] font-semibold text-tinta-suave">
            {abajo}
            {seRepite(ev) && (
              <span className={abajo ? "ml-0.5" : undefined} aria-label="se repite">
                ↻
              </span>
            )}
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 break-words text-[1.0625rem] font-bold leading-snug hyphens-auto">{ev.titulo}</span>
        {ev.lugar && <span className="block truncate text-[0.8125rem] font-semibold text-tinta-suave">📍 {ev.lugar}</span>}
      </span>
      {personas.length > 0 && (
        <span className="flex shrink-0 -space-x-0.5 text-base leading-none" aria-label={personas.map((p) => p.nombre).join(", ")}>
          {personas.map((m) => (
            <span key={m.id} title={m.nombre} aria-hidden>
              {m.emoji}
            </span>
          ))}
        </span>
      )}
    </button>
  );
}

// ---------- Semana ----------

/** Almuerzo y cena al pie del día; tocarlo lleva al menú. */
function ComidasDelDia({ fecha, alTocar }: { fecha: string; alTocar: () => void }) {
  const { estado } = useDatos();
  const recetas = new Map(estado.recetas.map((r) => [r.id, r]));
  // Todos los ítems de la comida en una línea ("Charquicán · Ensalada · Fruta").
  const lista = TIPOS_COMIDA.filter((t) => t.id === "almuerzo" || t.id === "cena")
    .map((t) => {
      const c = estado.plan[claveComida(fecha, t.id)];
      return { t, nombre: c ? nombreComida(c, recetas) : "" };
    })
    .filter((x) => x.nombre);
  if (!lista.length) return null;
  return (
    <button
      type="button"
      title="Ver el menú"
      onClick={(e) => {
        e.stopPropagation();
        alTocar();
      }}
      className="block min-h-12 w-full space-y-0.5 border-t border-dashed border-borde py-1.5 text-left text-sm transition active:scale-[0.98] md:pb-0 xl:text-base cel:min-h-11 cel:pb-0"
    >
      {lista.map(({ t, nombre }) => (
        <span
          key={t.id}
          className={cx(
            "line-clamp-2 break-words font-bold leading-tight text-tinta-suave",
            // Con almuerzo y cena en un tablet bajo, una línea cada una (cortada al final, así el
            // nombre siempre empieza junto al emoji). Con una sola comida caben las 2 líneas.
            lista.length > 1 && "[@media(max-height:650px)]:md:block [@media(max-height:650px)]:md:truncate",
          )}
        >
          <span aria-hidden>{t.emoji}</span> {nombre}
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
                  <TarjetaEvento key={oc.evento.id} oc={oc} miembros={miembros} onClick={() => alAbrir(oc.evento, oc.inicio)} />
                ))}
              </div>
              <ComidasDelDia fecha={f} alTocar={alIrAMenu} />
            </div>
          );
        })}
      </div>

      {/* Teléfono: lista por día, cada evento en una fila */}
      <div className="desliza h-full space-y-2.5 overflow-y-auto md:hidden">
        {dias.map((f, i) => {
          const esHoy = f === hoy;
          const lista = ocs.get(f)!;
          return (
            <div
              key={f}
              data-hoy-movil={esHoy || undefined}
              className={cx("scroll-mt-1 rounded-2xl border-2 px-2.5 pb-2 pt-1", esHoy ? "border-hoy-borde bg-hoy" : "border-transparent bg-superficie")}
            >
              <div className="flex items-center justify-between pl-1">
                <div className="text-[1.0625rem] font-bold">
                  {DIAS_LARGOS[i]} <span className="num">{partes(f).dia}</span>
                  {esHoy && <span className="ml-1.5 text-acento">· Hoy</span>}
                </div>
                <BotonIcono etiqueta={`Agregar evento el ${DIAS_LARGOS[i].toLowerCase()} ${partes(f).dia}`} className="-mr-1.5 bg-transparent text-xl text-tinta-suave" onClick={() => alNuevo(f)}>
                  ＋
                </BotonIcono>
              </div>
              <div className="space-y-1.5">
                {lista.length === 0 && <div className="pb-1 pl-1 text-sm text-tinta-suave">Sin eventos</div>}
                {lista.map((oc) => (
                  <TarjetaEvento key={oc.evento.id} oc={oc} miembros={miembros} fila onClick={() => alAbrir(oc.evento, oc.inicio)} />
                ))}
              </div>
              <div className="mt-1.5">
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
      {/* Celular: casi sin espacio entre columnas, así cada día mide 44 px o más de ancho (360 px de pantalla). */}
      <div className="grid grid-cols-7 gap-1.5 pb-1.5 cel:gap-x-0.5">
        {DIAS_CORTOS.map((d) => (
          <div key={d} className="text-center text-sm font-extrabold uppercase text-tinta-suave md:text-base">
            {d}
          </div>
        ))}
      </div>
      {/* En el teléfono cada fila tiene un alto mínimo (el número y los puntos) y la grilla hace scroll. */}
      <div className="desliza grid min-h-0 flex-1 grid-cols-7 grid-rows-[repeat(6,minmax(3.25rem,1fr))] gap-1.5 overflow-y-auto md:grid-rows-6 md:overflow-visible cel:gap-x-0.5 cel:gap-y-1">
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
                "flex min-h-0 flex-col overflow-hidden rounded-2xl border-[3px] p-1 text-left md:p-1.5 cel:rounded-xl cel:border-2",
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
    // Celular: un solo desplazamiento (eventos, clima y menú uno debajo del otro), sin paneles con scroll propio.
    <div className="desliza grid h-full gap-3 md:grid-cols-[2fr_1fr] cel:block cel:space-y-3 cel:overflow-y-auto">
      <div className={cx("desliza min-h-0 overflow-y-auto rounded-3xl p-3 md:p-4 cel:overflow-visible", fecha === hoy ? "bg-hoy" : "bg-superficie")}>
        <div className="mb-3 text-2xl font-extrabold md:text-3xl cel:mb-2">
          {DIAS_LARGOS[diaSemana(fecha)]}
          {fecha === hoy && <span className="ml-2 text-acento">· Hoy</span>}
        </div>
        {lista.length === 0 && <div className="py-10 text-center text-2xl text-tinta-suave">Día libre 🌿</div>}
        <div className="space-y-2.5">
          {lista.map((oc) => (
            <TarjetaEvento key={oc.evento.id} oc={oc} miembros={miembros} grande onClick={() => alAbrir(oc.evento, oc.inicio)} />
          ))}
        </div>
      </div>
      <div className="desliza min-h-0 space-y-3 overflow-y-auto cel:overflow-visible">
        {cd && (
          <div className="flex items-center gap-4 rounded-3xl bg-superficie p-4 cel:gap-3 cel:px-4 cel:py-3">
            <span className="text-6xl cel:text-4xl">{iconoClima(cd.codigo).icono}</span>
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
            // Los ítems de la comida, uno por línea (sin los espacios vacíos).
            const nombres = c ? nombresComida(c, recetas) : [];
            return (
              <div key={t.id} className="flex items-center gap-3 border-b border-borde py-2.5 last:border-0">
                <span className="text-3xl">{emojiComida(c, recetas) ?? t.emoji}</span>
                <div className="min-w-0">
                  <div className="text-sm font-bold uppercase text-tinta-suave">{t.nombre}</div>
                  {nombres.length ? (
                    nombres.map((n, i) => (
                      <div key={i} className={cx("break-words leading-tight", i === 0 ? "text-xl font-extrabold" : "text-lg font-bold")}>
                        {n}
                      </div>
                    ))
                  ) : (
                    <div className="text-xl font-extrabold">—</div>
                  )}
                </div>
              </div>
            );
          })}
        </button>
      </div>
    </div>
  );
}
