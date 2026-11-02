"use client";

import { useMemo, useState } from "react";
import { useDatos } from "@/lib/store";
import type { ComidaPlanificada, Receta, TipoComida } from "@/lib/datos/tipos";
import { DIAS_CORTOS, DIAS_LARGOS, diasDeSemana, lunesDe, partes, rangoSemana, semanaCorta, sumarDias } from "@/lib/fechas";
import {
  agruparPorCategoria,
  claveComida,
  comidasDeSemana,
  generarLista,
  lineaAItem,
  sinTildes,
  textoCantidad,
  type LineaGenerada,
} from "@/lib/compras";
import { SIN_COLACION, TIPOS_COMIDA, nombreComida } from "@/lib/comidas";
import { nuevoId } from "@/lib/ejemplo";
import { useIrAHoyEnMovil } from "@/lib/hooks";
import { Boton, BotonIcono, Casilla, Contador, Entrada, Modal, cx } from "./ui";
import { FotoReceta, RecetaDetalle } from "./VistaRecetas";

export default function VistaComidas({ hoy, alIrACompras }: { hoy: string; alIrACompras: () => void }) {
  const { estado, actualizar } = useDatos();
  // null = la semana de hoy (sigue sola al cambiar de semana).
  const [semana, setSemana] = useState<string | null>(null);
  const lunes = semana ?? lunesDe(hoy);
  const [celda, setCelda] = useState<{ fecha: string; tipo: TipoComida } | null>(null);
  // Lunes de la semana para la que se abrió "Generar lista" (fijo aunque pase la medianoche del domingo).
  const [generando, setGenerando] = useState<string | null>(null);
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
      <div className="flex flex-wrap items-center gap-2 md:flex-nowrap">
        <BotonIcono etiqueta="Semana anterior" onClick={() => setSemana(sumarDias(lunes, -7))}>
          ‹
        </BotonIcono>
        <Boton onClick={() => setSemana(null)} className={cx("whitespace-nowrap", lunes === lunesDe(hoy) && "opacity-60")}>
          {/* En el tablet angosto (iPad vertical) "Hoy" deja espacio para el rango de la semana. */}
          <span className="md:max-[56rem]:hidden">Esta semana</span>
          <span className="hidden md:max-[56rem]:inline">Hoy</span>
        </Boton>
        <BotonIcono etiqueta="Semana siguiente" onClick={() => setSemana(sumarDias(lunes, 7))}>
          ›
        </BotonIcono>
        <h1 className="mx-1 min-w-0 text-balance font-display text-2xl font-semibold leading-tight md:flex-1 xl:text-3xl">
          <span className="md:max-xl:hidden">Menú </span>
          <span className="text-tinta-suave">
            <span className="md:max-xl:hidden">· </span>
            <span className="md:max-[56rem]:hidden">{rangoSemana(lunes)}</span>
            <span className="hidden md:max-[56rem]:inline">{semanaCorta(lunes)}</span>
          </span>
        </h1>
        <div className="flex flex-1 flex-wrap justify-end gap-2 md:flex-none md:flex-nowrap">
          <Boton onClick={repetirSemanaPasada} className="whitespace-nowrap" aria-label="Repetir la semana pasada" title="Repetir la semana pasada">
            ↻<span className="md:max-xl:hidden"> Repetir semana</span>
          </Boton>
          <Boton variante="primario" className="whitespace-nowrap" onClick={() => setGenerando(lunes)} disabled={nComidas === 0}>
            🛒 <span className="md:max-xl:hidden">Generar lista de compras</span>
            <span className="hidden md:max-xl:inline">Lista de compras</span>
          </Boton>
        </div>
      </div>
      {aviso && <div className="rounded-2xl bg-acento-suave px-4 py-2 text-lg font-bold">{aviso}</div>}

      {/* Tablet: grilla días × comidas */}
      <div className="desliza hidden min-h-0 flex-1 grid-cols-[6.5rem_repeat(7,minmax(0,1fr))] grid-rows-[auto_repeat(5,minmax(3rem,1fr))] gap-2 overflow-y-auto md:grid [@media(max-height:700px)]:gap-1.5">
        <div className="sticky top-0 z-10 bg-fondo" />
        {dias.map((f, i) => (
          <div
            key={f}
            className={cx(
              "sticky top-0 z-10 rounded-2xl py-1.5 text-center",
              f === hoy ? "bg-acento text-acento-tinta" : "bg-fondo text-tinta-suave",
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
            {/* 5 comidas en 2 columnas: la última (cena) ocupa la fila entera. */}
            <div className="grid grid-cols-2 gap-2 [&>:last-child:nth-child(odd)]:col-span-2">
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
          lunes={generando}
          alCerrar={() => setGenerando(null)}
          alEnviar={() => {
            setGenerando(null);
            alIrACompras();
          }}
        />
      )}
    </section>
  );
}

/**
 * Ícono de la celda de la grilla según el alto disponible dentro de la celda (sin borde ni relleno):
 * completo si caben ícono + 2 líneas (≈ 75 px), chico hasta 3,5rem (ícono de 20 px + 2 líneas en
 * text-sm ≈ 57 px) y oculto por debajo (el nombre solo ≈ 35 px).
 */
// (Clases escritas completas: Tailwind sólo genera las que encuentra literalmente en el código.)
const ICONO_BAJO =
  "[@container(max-height:4.75rem)]:size-5 [@container(max-height:4.75rem)]:text-lg [@container(max-height:4.75rem)]:leading-none [@container(max-height:3.5rem)]:hidden";
const NOMBRE_BAJO = "[@container(max-height:4.75rem)]:text-sm [@container(max-height:4.75rem)]:leading-tight";
/**
 * En pantallas 2xl el ícono (48 px) y el nombre (text-lg) crecen sólo si la celda tiene alto para los dos
 * (48 + 2 líneas de 20,7 px ≈ 92 px); si no, quedan del tamaño normal (≈ 75 px) y nada se corta.
 */
const ICONO_GRANDE = "2xl:[@container(min-height:5.75rem)]:size-12 2xl:[@container(min-height:5.75rem)]:text-4xl";
const NOMBRE_GRANDE = "2xl:[@container(min-height:5.75rem)]:text-lg";
/**
 * En una celda angosta y no muy alta (iPad de 1024 px apaisado) la foto de 36 px queda a la altura del 👥,
 * y "👥12" se montaría sobre su esquina: con 2 dígitos de porciones la foto baja a 24 px.
 */
const ICONO_ANGOSTO =
  "[@container(max-width:6.4rem)_and_(min-height:4.76rem)_and_(max-height:6.9rem)]:size-6 [@container(max-width:6.4rem)_and_(min-height:4.76rem)_and_(max-height:6.9rem)]:text-xl [@container(max-width:6.4rem)_and_(min-height:4.76rem)_and_(max-height:6.9rem)]:leading-none";

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
      <div className="flex flex-col items-center justify-center rounded-2xl bg-superficie-2 text-center [container-type:size]">
        <span className="text-3xl [@container(max-height:4.5rem)]:text-xl [@container(max-height:3.5rem)]:hidden">{tipo.emoji}</span>
        <span className="text-base font-extrabold">{tipo.nombre}</span>
      </div>
      {dias.map((f) => (
        <Celda
          key={f}
          tipo={tipo}
          comida={estado.plan[claveComida(f, tipo.id)]}
          recetas={recetas}
          esHoy={f === hoy}
          enGrilla
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
  enGrilla,
  onClick,
}: {
  tipo: (typeof TIPOS_COMIDA)[number];
  comida?: ComidaPlanificada;
  recetas: Map<string, Receta>;
  esHoy: boolean;
  conEtiqueta?: boolean;
  /** En la grilla del tablet la celda se ajusta a su fila (pantallas bajas como el Fire HD 8). */
  enGrilla?: boolean;
  onClick: () => void;
}) {
  const receta = comida?.recetaId ? recetas.get(comida.recetaId) : undefined;
  const nombre = comida ? nombreComida(comida, recetas) : "";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "relative flex min-w-0 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-2xl border-[3px] text-center transition active:scale-[0.97]",
        // En la grilla la celda toma el alto de su fila y es un contenedor: si la fila es baja (Fire HD 8
        // en el navegador), el ícono se achica y luego se oculta, para que las 5 comidas se vean sin
        // desplazar y el nombre nunca se corte. Casi sin relleno lateral: el nombre usa todo el ancho y
        // sólo se corta en sílabas cuando de verdad no cabe (iPad vertical).
        enGrilla ? "min-h-0 px-0.5 py-0.5 [container-type:size]" : "min-h-20 px-1.5 py-1",
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
            <FotoReceta
              receta={receta}
              className={cx(
                "size-9 text-3xl",
                enGrilla && ICONO_GRANDE,
                enGrilla && ICONO_BAJO,
                enGrilla && comida.porciones >= 10 && ICONO_ANGOSTO,
              )}
            />
          ) : (
            <span className={cx("text-2xl", enGrilla && ICONO_BAJO)}>🍴</span>
          )}
          <span
            className={cx(
              // Una palabra más ancha que la celda ("Charquicán" en el iPad vertical) se corta en
              // sílabas en vez de quedar recortada por los lados.
              "line-clamp-2 max-w-full break-words hyphens-auto text-base font-extrabold leading-[1.15] md:max-[56rem]:text-sm",
              enGrilla && NOMBRE_GRANDE,
              enGrilla && NOMBRE_BAJO,
            )}
          >
            {nombre}
          </span>
          {receta && (
            <span
              className={cx(
                "num absolute right-1.5 top-1 text-xs font-bold text-tinta-suave",
                // Sin ícono (fila muy baja) el nombre sube y el 👥 lo taparía.
                enGrilla && "[@container(max-height:3.5rem)]:hidden",
              )}
            >
              👥{comida.porciones}
            </span>
          )}
        </>
      )}
    </button>
  );
}

// ---------- Elegir qué se cocina ----------

const ATAJOS = ["Sobras", "Comemos fuera", "Delivery", "Cada uno se las arregla", "Pan con palta"];
/** La colación casi nunca es una receta: atajos propios. */
const ATAJOS_COLACION = ["Fruta", "Yogur", "Sándwich", "Barra de cereal", "Galletas", SIN_COLACION];

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

  const q = sinTildes(busqueda);
  const filtradas = estado.recetas
    .filter((r) => sinTildes(r.nombre).includes(q))
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
            {(tipo === "colacion" ? ATAJOS_COLACION : ATAJOS).map((a) => (
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

/**
 * Al abrir, parte marcado lo que tiene cantidad y no está en el carro. Lo "al gusto" normalmente ya está
 * en casa y parte desmarcado, salvo que ya se haya mandado y siga pendiente en la lista (se acabó la sal).
 */
const parteMarcada = (l: LineaGenerada) => !l.yaComprado && (l.cantidad != null || !!l.enLista);

function GenerarLista({ lunes, alCerrar, alEnviar }: { lunes: string; alCerrar: () => void; alEnviar: () => void }) {
  const { estado, actualizar } = useDatos();
  // Se calcula una vez al abrir: descuenta lo que ya está en el carro de esta semana.
  const [lineas] = useState(() => generarLista(estado.plan, estado.recetas, lunes, estado.compras));
  // Qué parte marcado al abrir: ver parteMarcada.
  const [incluir, setIncluir] = useState<Set<string>>(() => new Set(lineas.filter(parteMarcada).map((l) => l.clave)));
  const grupos = agruparPorCategoria(lineas);
  const delMenu = estado.compras.filter((c) => c.origen === "menu" && c.semana === lunes);
  const yaHabia = delMenu.length > 0;
  const nPendientes = delMenu.filter((c) => !c.comprado).length;
  const nDescontados = lineas.filter((l) => l.yaComprado || l.descontado).length;

  const elegidas = lineas.filter((l) => incluir.has(l.clave) && !(l.yaComprado && l.cantidad === 0));
  // El usuario desmarcó algo que partió marcado (ver parteMarcada).
  const quedaPorMandar = lineas.some((l) => parteMarcada(l) && !incluir.has(l.clave));
  const enviar = () => {
    actualizar("compras", (lista) => [
      // Reemplaza lo que el menú de esta semana había mandado antes y aún no se compra.
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
          <Boton variante="primario" grande disabled={elegidas.length === 0 && nPendientes === 0} onClick={enviar}>
            {elegidas.length > 0
              ? `Mandar ${elegidas.length} a la lista`
              : nPendientes > 0
                ? `Quitar ${nPendientes} ${nPendientes === 1 ? "pendiente" : "pendientes"} de la lista`
                : "Nada que mandar"}
          </Boton>
        </>
      }
    >
      {yaHabia && (
        <p className="mb-4 rounded-2xl bg-acento-suave px-4 py-3 text-lg">
          {elegidas.length === 0 && nPendientes > 0 ? (
            `${quedaPorMandar ? "Desmarcaste todo." : "No queda nada por mandar."} Al confirmar se quitan de la lista ${nPendientes === 1 ? "el pendiente" : `los ${nPendientes} pendientes`} que había mandado el menú de esta semana.`
          ) : (
            <>
              Ya habías mandado la lista de esta semana.
              {nPendientes > 0 && " Lo pendiente se reemplaza por esta."}
              {nDescontados === 1
                ? " A 1 ingrediente se le descontó lo que ya compraste."
                : nDescontados > 1
                  ? ` A ${nDescontados} ingredientes se les descontó lo que ya compraste.`
                  : ""}
            </>
          )}
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
                const todoComprado = l.yaComprado && (l.cantidad === 0 || l.cantidad == null);
                // Lo que ya está entero en el carro no se puede volver a mandar (no queda cantidad).
                const fijo = l.yaComprado && l.cantidad === 0;
                return (
                  <button
                    key={l.clave}
                    type="button"
                    disabled={fijo}
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
                        {todoComprado ? (
                          <span className="font-bold text-ok">✓ ya en el carro</span>
                        ) : (
                          <span className="num font-bold text-acento">{textoCantidad(l.cantidad, l.unidad)}</span>
                        )}
                      </div>
                      <div className="truncate text-sm text-tinta-suave">
                        {l.descontado && !todoComprado && `ya compraste ${l.descontado} · `}
                        {l.recetas.join(" · ")}
                      </div>
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
