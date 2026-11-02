"use client";

import { useMemo, useState } from "react";
import { useDatos } from "@/lib/store";
import type { ComidaPlanificada, Receta, TipoComida } from "@/lib/datos/tipos";
import { DIAS_CORTOS, DIAS_LARGOS, diasDeSemana, lunesDe, partes, rangoSemana, sumarDias } from "@/lib/fechas";
import {
  agruparPorCategoria,
  claveComida,
  comidasDeSemana,
  generarLista,
  lineaAItem,
  textoCantidad,
  type LineaGenerada,
} from "@/lib/compras";
import { TIPOS_COMIDA, nombreComida } from "@/lib/comidas";
import { nuevoId } from "@/lib/ejemplo";
import { useIrAHoyEnMovil } from "@/lib/hooks";
import { Boton, BotonIcono, Casilla, Contador, Entrada, Modal, cx } from "./ui";
import { FotoReceta, RecetaDetalle } from "./VistaRecetas";

export default function VistaComidas({ hoy, alIrACompras }: { hoy: string; alIrACompras: () => void }) {
  const { estado, actualizar } = useDatos();
  const [lunes, setLunes] = useState(() => lunesDe(hoy));
  const [celda, setCelda] = useState<{ fecha: string; tipo: TipoComida } | null>(null);
  const [generando, setGenerando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const dias = diasDeSemana(lunes);
  const recetas = useMemo(() => new Map(estado.recetas.map((r) => [r.id, r])), [estado.recetas]);
  useIrAHoyEnMovil(lunes);
  const nComidas = comidasDeSemana(estado.plan, lunes).filter((c) => c.recetaId).length;

  const repetirSemanaPasada = () => {
    let n = 0;
    actualizar("plan", (plan) => {
      const nuevo = { ...plan };
      for (const f of dias)
        for (const t of TIPOS_COMIDA) {
          const prev = plan[claveComida(sumarDias(f, -7), t.id)];
          const k = claveComida(f, t.id);
          if (prev && !nuevo[k]) {
            nuevo[k] = { ...prev };
            n++;
          }
        }
      return nuevo;
    });
    setAviso(n ? `Se copiaron ${n} comidas de la semana pasada.` : "No había nada nuevo que copiar.");
    setTimeout(() => setAviso(null), 3500);
  };

  return (
    <section className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <BotonIcono etiqueta="Semana anterior" onClick={() => setLunes((l) => sumarDias(l, -7))}>
          ‹
        </BotonIcono>
        <Boton onClick={() => setLunes(lunesDe(hoy))} className={cx(lunes === lunesDe(hoy) && "opacity-60")}>
          Esta semana
        </Boton>
        <BotonIcono etiqueta="Semana siguiente" onClick={() => setLunes((l) => sumarDias(l, 7))}>
          ›
        </BotonIcono>
        <h1 className="mx-1 whitespace-nowrap font-display text-2xl font-semibold xl:text-3xl">
          Menú <span className="text-tinta-suave">· {rangoSemana(lunes)}</span>
        </h1>
        <div className="flex flex-1 flex-wrap justify-end gap-2">
          <Boton onClick={repetirSemanaPasada} className="whitespace-nowrap">↻ Repetir semana</Boton>
          <Boton variante="primario" className="whitespace-nowrap" onClick={() => setGenerando(true)} disabled={nComidas === 0}>
            🛒 Generar lista de compras
          </Boton>
        </div>
      </div>
      {aviso && <div className="rounded-2xl bg-acento-suave px-4 py-2 text-lg font-bold">{aviso}</div>}

      {/* Tablet: grilla días × comidas */}
      <div className="hidden min-h-0 flex-1 grid-cols-[6.5rem_repeat(7,minmax(0,1fr))] grid-rows-[auto_repeat(4,minmax(0,1fr))] gap-2 md:grid">
        <div />
        {dias.map((f, i) => (
          <div
            key={f}
            className={cx(
              "rounded-2xl py-1.5 text-center",
              f === hoy ? "bg-acento text-acento-tinta" : "text-tinta-suave",
            )}
          >
            <span className="text-lg font-extrabold uppercase">{DIAS_CORTOS[i]}</span>{" "}
            <span className="num font-display text-2xl font-semibold">{partes(f).dia}</span>
          </div>
        ))}
        {TIPOS_COMIDA.map((t) => (
          <FilaComida key={t.id} tipo={t} dias={dias} hoy={hoy} recetas={recetas} alElegir={(fecha) => setCelda({ fecha, tipo: t.id })} />
        ))}
      </div>

      {/* Teléfono: un bloque por día */}
      <div className="desliza min-h-0 flex-1 space-y-3 overflow-y-auto md:hidden">
        {dias.map((f, i) => (
          <div key={f} data-hoy-movil={f === hoy || undefined} className={cx("scroll-mt-2 rounded-3xl border-[3px] p-3", f === hoy ? "border-hoy-borde bg-hoy" : "border-transparent bg-superficie")}>
            <div className="mb-2 text-xl font-extrabold">
              {DIAS_LARGOS[i]} <span className="num">{partes(f).dia}</span>
              {f === hoy && <span className="ml-2 text-acento">· Hoy</span>}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {TIPOS_COMIDA.map((t) => (
                <Celda
                  key={t.id}
                  tipo={t}
                  comida={estado.plan[claveComida(f, t.id)]}
                  recetas={recetas}
                  esHoy={false}
                  conEtiqueta
                  onClick={() => setCelda({ fecha: f, tipo: t.id })}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {celda && <AsignarComida {...celda} alCerrar={() => setCelda(null)} />}
      {generando && (
        <GenerarLista
          lunes={lunes}
          alCerrar={() => setGenerando(false)}
          alEnviar={() => {
            setGenerando(false);
            alIrACompras();
          }}
        />
      )}
    </section>
  );
}

function FilaComida({
  tipo,
  dias,
  hoy,
  recetas,
  alElegir,
}: {
  tipo: (typeof TIPOS_COMIDA)[number];
  dias: string[];
  hoy: string;
  recetas: Map<string, Receta>;
  alElegir: (fecha: string) => void;
}) {
  const { estado } = useDatos();
  return (
    <>
      <div className="flex flex-col items-center justify-center rounded-2xl bg-superficie-2 text-center">
        <span className="text-3xl">{tipo.emoji}</span>
        <span className="text-base font-extrabold">{tipo.nombre}</span>
      </div>
      {dias.map((f) => (
        <Celda
          key={f}
          tipo={tipo}
          comida={estado.plan[claveComida(f, tipo.id)]}
          recetas={recetas}
          esHoy={f === hoy}
          onClick={() => alElegir(f)}
        />
      ))}
    </>
  );
}

function Celda({
  tipo,
  comida,
  recetas,
  esHoy,
  conEtiqueta,
  onClick,
}: {
  tipo: (typeof TIPOS_COMIDA)[number];
  comida?: ComidaPlanificada;
  recetas: Map<string, Receta>;
  esHoy: boolean;
  conEtiqueta?: boolean;
  onClick: () => void;
}) {
  const receta = comida?.recetaId ? recetas.get(comida.recetaId) : undefined;
  const nombre = comida ? nombreComida(comida, recetas) : "";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "relative flex min-h-20 min-w-0 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-2xl border-[3px] px-1.5 py-1 text-center transition active:scale-[0.97]",
        esHoy ? "border-hoy-borde bg-hoy shadow-md" : "border-transparent bg-superficie",
        !comida && "border-dashed border-borde",
      )}
    >
      {conEtiqueta && <span className="text-xs font-extrabold uppercase text-tinta-suave">{tipo.nombre}</span>}
      {!comida ? (
        <span className="text-3xl text-borde">＋</span>
      ) : (
        <>
          {receta ? (
            <FotoReceta receta={receta} className="size-9 text-3xl 2xl:size-12 2xl:text-4xl" />
          ) : (
            <span className="text-2xl">🍴</span>
          )}
          <span className="line-clamp-2 text-base font-extrabold leading-[1.15] 2xl:text-lg">{nombre}</span>
          {receta && (
            <span className="num absolute right-1.5 top-1 text-xs font-bold text-tinta-suave">👥{comida.porciones}</span>
          )}
        </>
      )}
    </button>
  );
}

// ---------- Elegir qué se cocina ----------

const ATAJOS = ["Sobras", "Comemos fuera", "Delivery", "Cada uno se las arregla", "Pan con palta"];

function AsignarComida({ fecha, tipo, alCerrar }: { fecha: string; tipo: TipoComida; alCerrar: () => void }) {
  const { estado, actualizar } = useDatos();
  const clave = claveComida(fecha, tipo);
  const actual = estado.plan[clave];
  const tamFamilia = Math.max(1, estado.miembros.length);
  const [porciones, setPorciones] = useState(actual?.porciones ?? tamFamilia);
  const [busqueda, setBusqueda] = useState("");
  const [texto, setTexto] = useState(actual && !actual.recetaId ? actual.texto ?? "" : "");
  const [verReceta, setVerReceta] = useState<Receta | null>(null);
  const t = TIPOS_COMIDA.find((x) => x.id === tipo)!;
  const dia = DIAS_LARGOS[(new Date(fecha + "T12:00:00Z").getUTCDay() + 6) % 7];

  const poner = (c: ComidaPlanificada | null) => {
    actualizar("plan", (plan) => {
      const n = { ...plan };
      if (c) n[clave] = c;
      else delete n[clave];
      return n;
    });
    alCerrar();
  };

  const filtradas = estado.recetas
    .filter((r) => r.nombre.toLowerCase().includes(busqueda.toLowerCase()))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  if (verReceta) return <RecetaDetalle receta={verReceta} alCerrar={() => setVerReceta(null)} porcionesIniciales={porciones} />;

  return (
    <Modal
      titulo={`${t.emoji} ${t.nombre} del ${dia.toLowerCase()} ${partes(fecha).dia}`}
      alCerrar={alCerrar}
      ancho="max-w-3xl"
      pie={
        <>
          {actual && (
            <Boton variante="peligro" className="mr-auto" onClick={() => poner(null)}>
              Quitar
            </Boton>
          )}
          {actual?.recetaId && buscarReceta(estado.recetas, actual.recetaId) && (
            <Boton onClick={() => setVerReceta(buscarReceta(estado.recetas, actual.recetaId!)!)}>📖 Ver receta</Boton>
          )}
          {actual?.recetaId && (
            <Boton variante="primario" onClick={() => poner({ ...actual, porciones })}>
              Guardar porciones
            </Boton>
          )}
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-superficie-2 p-3">
          <span className="text-lg font-bold">¿Para cuántos?</span>
          <Contador valor={porciones} alCambiar={setPorciones} />
          <span className="text-base text-tinta-suave">Las cantidades se ajustan solas.</span>
        </div>

        <div>
          <Entrada placeholder="🔎 Buscar receta…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {filtradas.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => poner({ recetaId: r.id, porciones })}
                className={cx(
                  "flex min-h-24 flex-col items-center justify-center gap-1 rounded-2xl border-[3px] bg-superficie p-2 text-center transition active:scale-95",
                  actual?.recetaId === r.id ? "border-acento" : "border-borde",
                )}
              >
                <FotoReceta receta={r} className="size-12 text-4xl" />
                <span className="text-lg font-extrabold leading-tight">{r.nombre}</span>
              </button>
            ))}
            {filtradas.length === 0 && (
              <p className="col-span-full py-4 text-center text-lg text-tinta-suave">
                No hay recetas con ese nombre. Créala en la pestaña Recetas.
              </p>
            )}
          </div>
        </div>

        <div>
          <span className="mb-1.5 block text-base font-bold text-tinta-suave">…o escribe algo sin receta</span>
          <div className="mb-2 flex flex-wrap gap-2">
            {ATAJOS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => poner({ texto: a, porciones })}
                className="min-h-11 rounded-full bg-superficie-2 px-4 text-base font-bold"
              >
                {a}
              </button>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (texto.trim()) poner({ texto: texto.trim(), porciones });
            }}
          >
            <Entrada value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Ej.: Completos" />
            <Boton type="submit" variante="primario" disabled={!texto.trim()}>
              Poner
            </Boton>
          </form>
        </div>
      </div>
    </Modal>
  );
}

function buscarReceta(lista: Receta[], id: string) {
  return lista.find((r) => r.id === id);
}

// ---------- Generar lista de compras ----------

function GenerarLista({ lunes, alCerrar, alEnviar }: { lunes: string; alCerrar: () => void; alEnviar: () => void }) {
  const { estado, actualizar } = useDatos();
  const lineas = useMemo(() => generarLista(estado.plan, estado.recetas, lunes), [estado.plan, estado.recetas, lunes]);
  // Lo "al gusto" (sal, pimienta) normalmente ya está en casa: parte desmarcado.
  const [incluir, setIncluir] = useState<Set<string>>(
    () => new Set(lineas.filter((l) => l.cantidad != null).map((l) => l.clave)),
  );
  const grupos = agruparPorCategoria(lineas);
  const yaHabia = estado.compras.some((c) => c.origen === "menu" && c.semana === lunes && !c.comprado);

  const enviar = () => {
    const elegidas = lineas.filter((l) => incluir.has(l.clave));
    actualizar("compras", (lista) => [
      // Reemplaza lo que el menú de esta semana había mandado antes (y que aún no se compra).
      ...lista.filter((c) => !(c.origen === "menu" && c.semana === lunes && !c.comprado)),
      ...elegidas.map((l: LineaGenerada) => lineaAItem(l, lunes, nuevoId("com"))),
    ]);
    alEnviar();
  };

  return (
    <Modal
      titulo={`🛒 Compras del menú · ${rangoSemana(lunes)}`}
      alCerrar={alCerrar}
      ancho="max-w-3xl"
      pie={
        <>
          <span className="mr-auto text-base text-tinta-suave">Desmarca lo que ya tienes en casa.</span>
          <Boton variante="fantasma" onClick={alCerrar}>
            Cancelar
          </Boton>
          <Boton variante="primario" grande disabled={incluir.size === 0} onClick={enviar}>
            Mandar {incluir.size} a la lista
          </Boton>
        </>
      }
    >
      {yaHabia && (
        <p className="mb-4 rounded-2xl bg-acento-suave px-4 py-3 text-lg">
          Ya habías generado la lista de esta semana. Al mandarla, se reemplazan esos ítems (los que ya marcaste como comprados se quedan).
        </p>
      )}
      <div className="space-y-5">
        {grupos.map((g) => (
          <div key={g.nombre}>
            <h3 className="mb-2 text-lg font-extrabold uppercase text-tinta-suave">
              {g.emoji} {g.nombre}
            </h3>
            <div className="space-y-1.5">
              {g.items.map((l) => {
                const marcado = incluir.has(l.clave);
                return (
                  <button
                    key={l.clave}
                    type="button"
                    onClick={() =>
                      setIncluir((s) => {
                        const n = new Set(s);
                        if (n.has(l.clave)) n.delete(l.clave);
                        else n.add(l.clave);
                        return n;
                      })
                    }
                    className={cx(
                      "flex w-full items-center gap-3 rounded-2xl bg-superficie-2 px-3 py-2 text-left transition",
                      !marcado && "opacity-50",
                    )}
                  >
                    <Casilla marcada={marcado} />
                    <div className="min-w-0 flex-1">
                      <div className="text-xl font-extrabold">
                        {l.nombre}{" "}
                        <span className="num font-bold text-acento">{textoCantidad(l.cantidad, l.unidad)}</span>
                      </div>
                      <div className="truncate text-sm text-tinta-suave">{l.recetas.join(" · ")}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
