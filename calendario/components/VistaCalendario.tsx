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

export default function VistaCalendario({ hoy, clima }: { hoy: string; clima: Clima | null }) {
  const { estado } = useDatos();
  const [modo, setModo] = useState<Modo>("semana");
  const [ancla, setAncla] = useState(hoy);
  const [filtro, setFiltro] = useState<Set<string>>(new Set());
  const [editando, setEditando] = useState<{ evento?: Evento; fecha: string } | null>(null);

  const miembros = useMemo(() => new Map(estado.miembros.map((m) => [m.id, m])), [estado.miembros]);

  const mover = (dir: number) => {
    if (modo === "dia") setAncla((a) => sumarDias(a, dir));
    if (modo === "semana") setAncla((a) => sumarDias(a, 7 * dir));
    if (modo === "mes") setAncla((a) => sumarMeses(a, dir));
  };

  const titulo =
    modo === "semana" ? rangoSemana(lunesDe(ancla)) : modo === "mes" ? mesAnio(ancla) : fechaLarga(ancla, true);

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
        <Boton onClick={() => setAncla(hoy)} className={cx(ancla === hoy && "opacity-60")}>
          Hoy
        </Boton>
        <BotonIcono etiqueta="Siguiente" onClick={() => mover(1)}>
          ›
        </BotonIcono>
        <h1 className="mx-1 whitespace-nowrap font-display text-2xl font-semibold first-letter:uppercase xl:text-3xl">{titulo}</h1>
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
          <Boton variante="primario" onClick={() => setEditando({ fecha: ancla })}>
            ＋ Evento
          </Boton>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {modo === "semana" && (
          <Semana
            lunes={lunesDe(ancla)}
            hoy={hoy}
            filtro={filtro}
            miembros={miembros}
            clima={clima}
            alAbrir={(evento, fecha) => setEditando({ evento, fecha })}
            alNuevo={(fecha) => setEditando({ fecha })}
            alVerDia={(f) => {
              setAncla(f);
              setModo("dia");
            }}
          />
        )}
        {modo === "mes" && (
          <Mes
            ancla={ancla}
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
            fecha={ancla}
            hoy={hoy}
            filtro={filtro}
            miembros={miembros}
            clima={clima}
            alAbrir={(evento, fecha) => setEditando({ evento, fecha })}
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

function estiloPersonas(ids: string[], miembros: Map<string, Miembro>): React.CSSProperties {
  const colores = ids.map((id) => miembros.get(id)?.color).filter(Boolean) as string[];
  const c = colores[0] ?? "#999999";
  if (colores.length <= 1) return { ["--color-persona" as string]: c };
  const paso = 100 / colores.length;
  const franjas = colores.map((col, i) => `${col} ${i * paso}% ${(i + 1) * paso}%`).join(", ");
  return { ["--color-persona" as string]: c, ["--franjas" as string]: franjas };
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
        "tarjeta-evento w-full rounded-xl px-2.5 py-2 text-left transition active:scale-[0.98]",
        personas.length > 1 && "compartido",
      )}
      style={estiloPersonas(ev.miembros, miembros)}
    >
      <div className={cx("num whitespace-nowrap font-bold text-tinta-suave", grande ? "text-xl" : "text-sm 2xl:text-base")}>
        {textoHora(ev)}
        {ev.repeticion !== "nunca" && <span className="ml-1" aria-label="se repite">↻</span>}
      </div>
      <div className={cx("font-extrabold leading-snug", grande ? "text-3xl" : "text-base xl:text-lg")}>{ev.titulo}</div>
      <div className="mt-1 flex flex-wrap gap-0.5">
        {personas.map((m) => (
          <span key={m.id} className={grande ? "text-2xl" : "text-base"} title={m.nombre}>
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

function ComidasDelDia({ fecha, compacto }: { fecha: string; compacto?: boolean }) {
  const { estado } = useDatos();
  const recetas = new Map(estado.recetas.map((r) => [r.id, r]));
  const lista = TIPOS_COMIDA.filter((t) => t.id === "almuerzo" || t.id === "cena")
    .map((t) => ({ t, c: estado.plan[claveComida(fecha, t.id)] }))
    .filter((x) => x.c);
  if (!lista.length) return null;
  return (
    <div className={cx("space-y-0.5 border-t border-dashed border-borde pt-1.5", compacto ? "text-sm" : "text-sm xl:text-base")}>
      {lista.map(({ t, c }) => (
        <div key={t.id} className="truncate font-bold text-tinta-suave">
          <span aria-hidden>{t.emoji}</span> {nombreComida(c!, recetas)}
        </div>
      ))}
    </div>
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
}: {
  lunes: string;
  hoy: string;
  filtro: Set<string>;
  miembros: Map<string, Miembro>;
  clima: Clima | null;
  alAbrir: (e: Evento, f: string) => void;
  alNuevo: (f: string) => void;
  alVerDia: (f: string) => void;
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
              <ComidasDelDia fecha={f} />
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
                <ComidasDelDia fecha={f} compacto />
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
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 gap-1.5">
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
                    className="tarjeta-evento shrink-0 truncate rounded-md px-1.5 py-px text-sm font-bold leading-snug"
                    style={{ ["--color-persona" as string]: miembros.get(oc.evento.miembros[0])?.color ?? "#999" }}
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
                    style={{ background: miembros.get(oc.evento.miembros[0])?.color }}
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
}: {
  fecha: string;
  hoy: string;
  filtro: Set<string>;
  miembros: Map<string, Miembro>;
  clima: Clima | null;
  alAbrir: (e: Evento, f: string) => void;
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
        <div className="rounded-3xl bg-superficie p-4">
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
        </div>
      </div>
    </div>
  );
}
