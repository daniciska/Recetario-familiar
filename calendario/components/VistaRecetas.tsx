"use client";

import { useEffect, useRef, useState } from "react";
import { useDatos } from "@/lib/store";
import { useCandado } from "@/lib/candado";
import type { Ingrediente, Receta, Unidad } from "@/lib/datos/tipos";
import { CATEGORIAS, UNIDADES, adivinarCategoria, escalar, sinTildes, textoCantidad } from "@/lib/compras";
import { quitarRecetaDelPlan } from "@/lib/comidas";
import { nuevoId } from "@/lib/ejemplo";
import { subirFoto } from "@/lib/datos/nube";
import * as cliente from "@/lib/dictados/cliente";
import { TEXTOS, conAprox, fechaDictado, otraVersionDaLoMismo, otraVersionFallo, sePuedeRevisar, textoOtraVersionFallo } from "@/lib/dictados/textos";
import type { DictadoPublico } from "@/lib/dictados/tipos";
import { borradorVacio, borrarRevision, guardarRevision, leerRevision, limpiarReceta } from "@/lib/dictados/revision";
import { useDictados } from "@/lib/dictados/useDictados";
import DictarReceta from "./DictarReceta";
import { AvisoDictados, ModalDictados } from "./Dictados";
import { BotonEscuchar, VerLoQueSeDijo, mensajeNube } from "./Escuchar";
import { AreaTexto, Boton, BotonIcono, Campo, Casilla, Contador, Entrada, Modal, Selector, Vacio, cx } from "./ui";

export function FotoReceta({ receta, className }: { receta: Pick<Receta, "foto" | "emoji" | "nombre">; className?: string }) {
  if (receta.foto)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={receta.foto} alt={receta.nombre} className={cx("shrink-0 rounded-xl object-cover", className)} />;
  return (
    <span className={cx("inline-flex shrink-0 items-center justify-center", className)} aria-hidden>
      {receta.emoji || "🍽️"}
    </span>
  );
}

// `revision`: el borrador de una receta dictada (Receta ya tiene un campo `dictado`, por eso otro nombre).
type Editando = Receta | "nueva" | { revision: DictadoPublico };

export default function VistaRecetas() {
  const { estado } = useDatos();
  const { proteger } = useCandado();
  const dictados = useDictados(true);
  const [busqueda, setBusqueda] = useState("");
  const [viendo, setViendo] = useState<Receta | null>(null);
  const [editando, setEditando] = useState<Editando | null>(null);
  const [dictando, setDictando] = useState(false);
  const [verDictados, setVerDictados] = useState(false);

  const q = sinTildes(busqueda);
  const lista = estado.recetas
    .filter((r) => sinTildes(r.nombre).includes(q))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  // Sólo un dictado «listo» con su borrador (las pantallas lo piden fresco antes): nunca un borrador vacío.
  const revisar = (d: DictadoPublico) => {
    if (!sePuedeRevisar(d)) return;
    setDictando(false);
    setVerDictados(false);
    setEditando({ revision: d });
  };
  // «Pedir otra versión» desde la revisión (borrador de rescate): se cierra y se ve cómo va en 🎙️ Dictadas.
  // Si falló al tiro (p. ej. sin la clave de Gemini), la revisión sigue abierta y dice por qué.
  const otraVersion = async (id: string) => {
    const r = await dictados.procesar(id, true);
    if (r && !otraVersionFallo(r)) {
      setEditando(null);
      setVerDictados(true);
    }
    return r;
  };

  return (
    <section className="flex h-full flex-col gap-3 cel:gap-2">
      {/* Celular: título, 🎙️ y ＋ en una fila; el buscador debajo, a todo el ancho. */}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 font-display text-2xl font-semibold md:text-3xl cel:text-[1.375rem]">Recetario</h1>
        <Entrada
          className="max-w-sm flex-1 cel:order-last cel:max-w-none cel:basis-full"
          placeholder="🔎 Buscar…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
        <div className="ml-auto flex gap-2">
          <Boton onClick={() => proteger(() => setDictando(true))}>
            <span className="sm:hidden">{TEXTOS.botonDictarCorto}</span>
            <span className="hidden sm:inline">{TEXTOS.botonDictar}</span>
          </Boton>
          <Boton variante="primario" onClick={() => proteger(() => setEditando("nueva"))}>
            ＋ Receta
          </Boton>
        </div>
      </div>

      <AvisoDictados d={dictados} alAbrir={() => setVerDictados(true)} />

      <div className="desliza min-h-0 flex-1 overflow-y-auto">
        {lista.length === 0 ? (
          <Vacio emoji="📖" texto={busqueda ? "No hay recetas con ese nombre." : TEXTOS.vacio} />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 cel:gap-2.5">
            {lista.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setViendo(r)}
                className="flex flex-col overflow-hidden rounded-3xl bg-superficie text-left shadow-sm transition active:scale-[0.98]"
              >
                <div className="flex aspect-[4/3] items-center justify-center bg-superficie-2 cel:aspect-[3/2]">
                  <FotoReceta receta={r} className={r.foto ? "size-full rounded-none" : "text-7xl"} />
                </div>
                <div className="p-3 cel:px-2.5 cel:py-2">
                  <div className="text-xl font-extrabold leading-tight cel:text-[1.0625rem]">{r.nombre}</div>
                  <div className="mt-1 text-base font-bold text-tinta-suave cel:mt-0.5 cel:text-[0.8125rem]">
                    👥 {r.porciones}
                    {r.tiempoMin ? ` · ⏱ ${r.tiempoMin} min` : ""} · {r.ingredientes.length} ingr.
                    {r.dictado ? " · 🎙️" : ""}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {viendo && (
        <RecetaDetalle
          receta={estado.recetas.find((r) => r.id === viendo.id) ?? viendo}
          alCerrar={() => setViendo(null)}
          alEditar={() =>
            proteger(() => {
              setEditando(estado.recetas.find((r) => r.id === viendo.id) ?? viendo);
              setViendo(null);
            })
          }
        />
      )}
      {editando && (
        <EditorReceta
          key={editando === "nueva" ? "nueva" : "revision" in editando ? `d:${editando.revision.id}` : editando.id}
          receta={editando === "nueva" || "revision" in editando ? undefined : editando}
          dictado={editando !== "nueva" && "revision" in editando ? editando.revision : undefined}
          alCerrar={() => setEditando(null)}
          alCambiarDictados={() => void dictados.refrescar()}
          alOtraVersion={otraVersion}
        />
      )}
      {dictando && <DictarReceta alCerrar={() => setDictando(false)} alRevisar={revisar} alCambiar={() => void dictados.refrescar()} />}
      {verDictados && <ModalDictados d={dictados} alCerrar={() => setVerDictados(false)} alRevisar={revisar} />}
    </section>
  );
}

// ---------- Detalle ----------

export function RecetaDetalle({
  receta,
  alCerrar,
  alEditar,
  porcionesIniciales,
}: {
  receta: Receta;
  alCerrar: () => void;
  alEditar?: () => void;
  porcionesIniciales?: number;
}) {
  const { nube } = useDatos();
  const [porciones, setPorciones] = useState(porcionesIniciales ?? receta.porciones);
  const [hechos, setHechos] = useState<Set<number>>(new Set());
  return (
    <Modal
      titulo={receta.nombre}
      alCerrar={alCerrar}
      ancho="max-w-5xl"
      pie={
        alEditar && (
          <Boton onClick={alEditar} className="mr-auto">
            ✏️ Editar
          </Boton>
        )
      }
    >
      <div className="grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] cel:gap-5">
        <div>
          {/* Celular: sin foto no se muestra el bloque 4:3 (sólo un emoji): el emoji va junto a las porciones. */}
          {receta.foto ? (
            <FotoReceta receta={receta} className="mb-4 aspect-[4/3] w-full cel:mb-3 cel:aspect-[16/9]" />
          ) : (
            <div className="mb-4 flex aspect-[4/3] items-center justify-center rounded-2xl bg-superficie-2 text-8xl cel:hidden">
              {receta.emoji}
            </div>
          )}
          <div className="mb-3 flex flex-wrap items-center gap-3 cel:gap-x-2.5 cel:gap-y-1">
            {!receta.foto && (
              <span className="hidden size-11 items-center justify-center rounded-xl bg-superficie-2 text-[1.75rem] cel:inline-flex" aria-hidden>
                {receta.emoji || "🍽️"}
              </span>
            )}
            <span className="text-lg font-bold cel:text-base">Porciones</span>
            <Contador valor={porciones} alCambiar={setPorciones} />
            {receta.tiempoMin ? <span className="text-lg font-bold text-tinta-suave">⏱ {receta.tiempoMin} min</span> : null}
          </div>
          <h3 className="mb-2 text-lg font-extrabold uppercase text-acento cel:mb-1 cel:text-[0.8125rem] cel:tracking-wide">Ingredientes</h3>
          <ul className="space-y-1.5">
            {receta.ingredientes.map((i) => {
              const cant = escalar(i.cantidad, receta, porciones);
              return (
                <li key={i.id} className="flex gap-2 border-b border-borde pb-1.5 text-lg cel:pb-1">
                  <span className="num min-w-24 shrink-0 font-extrabold cel:min-w-20">
                    {conAprox(textoCantidad(cant != null ? redondeo(cant) : null, i.unidad), i.estimado === true && cant != null)}
                  </span>
                  <span className="min-w-0">
                    {i.nombre}
                    {i.nota && <span className="text-tinta-suave"> — {i.nota}</span>}
                    {i.comoLoDijo && <span className="block text-base text-tinta-suave">{TEXTOS.dijoDetalle(i.comoLoDijo)}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
          {receta.dictado && nube && (
            <div className="mt-4 space-y-2 rounded-2xl bg-superficie-2 p-3">
              <p className="text-lg font-bold">{TEXTOS.dictadaEl(fechaDictado(receta.dictado.fecha))}</p>
              <BotonEscuchar dictadoId={receta.dictado.id} etiqueta={TEXTOS.escucharComo} />
              <VerLoQueSeDijo dictadoId={receta.dictado.id} className="bg-superficie" />
            </div>
          )}
        </div>
        <div>
          <h3 className="mb-2 text-lg font-extrabold uppercase text-acento cel:mb-1.5 cel:text-[0.8125rem] cel:tracking-wide">Preparación</h3>
          <ol className="space-y-2">
            {receta.pasos.map((p, n) => (
              <li key={n}>
                <button
                  type="button"
                  onClick={() =>
                    setHechos((s) => {
                      const x = new Set(s);
                      if (x.has(n)) x.delete(n);
                      else x.add(n);
                      return x;
                    })
                  }
                  className={cx(
                    "flex w-full gap-3 rounded-2xl bg-superficie-2 p-3 text-left text-xl leading-snug transition cel:gap-2.5 cel:rounded-xl cel:p-2.5 cel:text-[1.0625rem]",
                    hechos.has(n) && "opacity-45 line-through",
                  )}
                >
                  <span className="num flex size-9 shrink-0 items-center justify-center rounded-full bg-acento font-extrabold text-acento-tinta cel:size-7 cel:text-sm">
                    {n + 1}
                  </span>
                  <span>{p}</span>
                </button>
              </li>
            ))}
          </ol>
          {receta.nota && <p className="mt-4 whitespace-pre-line rounded-2xl bg-acento-suave p-3 text-lg">💡 {receta.nota}</p>}
          {!!receta.dudas?.length && (
            <div className="mt-4 rounded-2xl bg-acento-suave p-3">
              <h3 className="mb-1 text-lg font-extrabold">{TEXTOS.porConfirmar}</h3>
              <ul className="list-disc space-y-1 pl-6 text-lg">
                {receta.dudas.map((q, n) => (
                  <li key={n}>{q}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function redondeo(n: number) {
  if (n <= 0) return 0;
  return n >= 10 ? Math.round(n) : Math.max(0.25, Math.round(n * 4) / 4);
}

// ---------- Editor ----------

const EMOJIS_RECETA = ["🍲", "🥘", "🌽", "🫘", "🥗", "🍝", "🍗", "🐟", "🥩", "🥑", "🥞", "🍰", "🍞", "🥧", "🍳", "🍜", "🟠", "🍎"];

function ingredienteVacio(): Ingrediente {
  return { id: nuevoId("ing"), nombre: "", cantidad: null, unidad: "g", categoria: "Otros" };
}

/** Reduce la foto antes de guardarla (localStorage tiene ~5 MB). */
function reducirFoto(archivo: File, max = 640): Promise<string> {
  return new Promise((ok, mal) => {
    const lector = new FileReader();
    lector.onerror = mal;
    lector.onload = () => {
      const img = new Image();
      img.onerror = mal;
      img.onload = () => {
        const escala = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * escala);
        c.height = Math.round(img.height * escala);
        c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
        ok(c.toDataURL("image/jpeg", 0.72));
      };
      img.src = lector.result as string;
    };
    lector.readAsDataURL(archivo);
  });
}

function sinDictado({ dictado: _, ...r }: Receta): Receta {
  return r;
}

function EditorReceta({
  receta,
  dictado,
  alCerrar,
  alCambiarDictados,
  alOtraVersion,
}: {
  receta?: Receta;
  /** Revisar el borrador de una receta dictada (ya completo, con `borrador`). */
  dictado?: DictadoPublico;
  alCerrar: () => void;
  alCambiarDictados?: () => void;
  /** «Pedir otra versión» de un borrador de rescate. null: el dictado ya no existe. Lanza si la nube no responde. */
  alOtraVersion?: (id: string) => Promise<DictadoPublico | null>;
}) {
  const { actualizar, nube } = useDatos();
  const { proteger } = useCandado();
  const [inicio] = useState(() => {
    if (dictado) {
      const guardada = leerRevision(dictado);
      return { r: guardada ?? dictado.borrador ?? borradorVacio(dictado, ingredienteVacio), seguiste: !!guardada };
    }
    return {
      r: receta ?? { id: nuevoId("rec"), nombre: "", emoji: "🍲", porciones: 4, ingredientes: [ingredienteVacio()], pasos: [""] },
      seguiste: false,
    };
  });
  const [r, setR] = useState<Receta>(inicio.r);
  const [confirmar, setConfirmar] = useState(false);
  const [borrarAudio, setBorrarAudio] = useState(true);
  const [confirmarAudio, setConfirmarAudio] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  // «Guardar» espera a la nube (hasta 15 s con mala señal): mientras, el botón dice «Guardando…» y no se repite.
  const [guardando, setGuardando] = useState(false);
  const [confirmarOtra, setConfirmarOtra] = useState(false);
  const revisar = dictado?.revisar ?? {};

  // Cada cambio del borrador queda guardado en este equipo (no el primer dibujo: eso es lo que trajo Gemini).
  const primera = useRef(true);
  useEffect(() => {
    if (primera.current) {
      primera.current = false;
      return;
    }
    if (dictado) guardarRevision(dictado, r);
  }, [r, dictado]);

  const set = <K extends keyof Receta>(k: K, v: Receta[K]) => setR((p) => ({ ...p, [k]: v }));
  const setIng = (id: string, cambios: Partial<Ingrediente>) =>
    set(
      "ingredientes",
      r.ingredientes.map((i) => (i.id === id ? { ...i, ...cambios } : i)),
    );

  const guardar = async () => {
    if (guardando) return;
    setGuardando(true);
    setError(null);
    try {
      // Con la familia en la nube, la foto se sube aparte (y la receta guarda sólo su dirección).
      let foto = r.foto;
      if (nube && foto?.startsWith("data:")) {
        try {
          foto = await subirFoto(foto);
        } catch {
          return setError("No se pudo subir la foto: no hay conexión con la nube. Revisa el wifi e inténtalo de nuevo.");
        }
      }
      const limpia: Receta = { ...limpiarReceta(r), foto };
      const ok = await actualizar("recetas", (lista) =>
        lista.some((x) => x.id === limpia.id) ? lista.map((x) => (x.id === limpia.id ? limpia : x)) : [...lista, limpia],
      );
      if (!ok)
        return setError(
          nube
            ? dictado
              ? "No se pudo guardar: no hay conexión con la nube. Lo que corregiste queda en este equipo: inténtalo de nuevo cuando vuelva el wifi."
              : "No se pudo guardar: no hay conexión con la nube. Revisa el wifi e inténtalo de nuevo."
            : r.foto
              ? "No se pudo guardar: el almacenamiento de este equipo está lleno. Prueba quitando la foto o borrando fotos de otras recetas."
              : "No se pudo guardar: el almacenamiento de este equipo está lleno. Prueba borrando fotos de otras recetas.",
        );
      if (dictado) {
        borrarRevision(dictado.id);
        // Si falla (o la nube todavía no tiene la receta: false), no importa: el motor de Dictadas oculta el
        // dictado (ya está rec_<id>) y lo marca como guardado después.
        void cliente
          .marcarGuardado(dictado.id, limpia.id)
          .catch(() => false)
          .finally(() => alCambiarDictados?.());
      }
      alCerrar();
    } finally {
      setGuardando(false);
    }
  };

  const borrar = () => {
    actualizar("recetas", (lista) => lista.filter((x) => x.id !== r.id));
    actualizar("plan", (plan) => quitarRecetaDelPlan(plan, r.id));
    // El audio y lo que se dijo se borran sin esperar (si no hay red, quedan en la nube).
    if (r.dictado && nube && borrarAudio) void cliente.quitarAudio(r.dictado.id).catch(() => {});
    alCerrar();
  };

  /** Revisión: descartar el audio y el borrador (no hay receta guardada; si otro equipo ya la guardó, no se borra nada). */
  const descartar = async () => {
    if (!dictado) return;
    setOcupado(true);
    setError(null);
    try {
      const res = await cliente.descartarBorrador(dictado.id);
      borrarRevision(dictado.id);
      alCambiarDictados?.();
      if (res === "guardada") {
        setConfirmar(false);
        return setError(TEXTOS.yaGuardadaOtro);
      }
      alCerrar();
    } catch (e) {
      setError(mensajeNube(e));
    } finally {
      setOcupado(false);
    }
  };

  /** Receta guardada: borrar sólo el audio (y lo que se dijo); la receta queda sin el enlace. */
  const quitarAudio = async () => {
    if (!r.dictado) return;
    setOcupado(true);
    setError(null);
    try {
      await cliente.quitarAudio(r.dictado.id);
      setR(sinDictado);
      await actualizar("recetas", (lista) => lista.map((x) => (x.id === r.id ? sinDictado(x) : x)));
      setConfirmarAudio(false);
    } catch (e) {
      setError(mensajeNube(e));
    } finally {
      setOcupado(false);
    }
  };

  /**
   * Borrador de rescate: pedirle a Gemini otra versión. Se pregunta antes si se corrigió algo aquí o si la
   * anterior falló por el audio mismo (va a dar lo mismo).
   */
  const corregido = inicio.seguiste || JSON.stringify(r) !== JSON.stringify(inicio.r);
  const daLoMismo = otraVersionDaLoMismo(dictado);
  const pedirOtraVersion = async (confirmado = false) => {
    if (!dictado || !alOtraVersion) return;
    if (!confirmado && (corregido || daLoMismo)) return setConfirmarOtra(true);
    setConfirmarOtra(false);
    setOcupado(true);
    setError(null);
    try {
      const d = await alOtraVersion(dictado.id);
      if (!d) setError(TEXTOS.yaNoExiste);
      // Falló al tiro: no se pidió nada y lo corregido aquí sigue.
      else if (otraVersionFallo(d)) setError(textoOtraVersionFallo(d));
      else borrarRevision(dictado.id);
    } catch (e) {
      setError(mensajeNube(e));
    } finally {
      setOcupado(false);
    }
  };

  const titulo = dictado ? TEXTOS.tituloRevisar : receta ? "Editar receta" : "Nueva receta";
  // El error va en el pie, junto a los botones: arriba quedaba fuera de la vista en una receta larga.
  const avisoError = error && (
    <p key="error" role="alert" className="basis-full rounded-2xl bg-red-600/15 px-4 py-2 text-lg font-bold text-red-700 noche:text-red-300">
      {error}
    </p>
  );
  const pie = dictado ? (
    <>
      {avisoError}
      {confirmarOtra && (
        <div className="flex basis-full flex-wrap items-center gap-2 rounded-2xl bg-acento-suave p-3">
          <span className="text-base font-bold">
            {daLoMismo ? (corregido ? TEXTOS.confirmarOtraIgualCorregida : TEXTOS.confirmarOtraIgual) : TEXTOS.confirmarOtraVersion}
          </span>
          {/* Si va a dar lo mismo, el botón destacado es «No». */}
          <Boton variante={daLoMismo ? "suave" : "primario"} disabled={ocupado} onClick={() => void pedirOtraVersion(true)}>
            {daLoMismo ? TEXTOS.siOtraIgual : TEXTOS.siOtraVersion}
          </Boton>
          <Boton variante={daLoMismo ? "primario" : "fantasma"} onClick={() => setConfirmarOtra(false)}>
            {TEXTOS.no}
          </Boton>
        </div>
      )}
      {confirmar ? (
        <div className="mr-auto flex flex-wrap items-center gap-2">
          <span className="text-base font-bold">{TEXTOS.confirmarDescartar}</span>
          <Boton variante="peligro" disabled={ocupado} onClick={() => proteger(() => void descartar())}>
            {TEXTOS.siDescartar}
          </Boton>
          <Boton variante="fantasma" onClick={() => setConfirmar(false)}>
            {TEXTOS.no}
          </Boton>
        </div>
      ) : (
        <Boton variante="peligro" className="mr-auto" onClick={() => setConfirmar(true)}>
          {TEXTOS.descartar}
        </Boton>
      )}
      {dictado.rescate && alOtraVersion && !confirmarOtra && (
        <Boton disabled={ocupado || guardando} onClick={() => void pedirOtraVersion()}>
          {TEXTOS.otraVersion}
        </Boton>
      )}
      <Boton variante="fantasma" onClick={alCerrar}>
        {TEXTOS.despues}
      </Boton>
      <Boton variante="primario" disabled={!r.nombre.trim() || ocupado || guardando} onClick={() => void guardar()}>
        {guardando ? TEXTOS.guardando : TEXTOS.guardarReceta}
      </Boton>
    </>
  ) : (
    <>
      {avisoError}
      {receta &&
        (confirmar ? (
          <div className="mr-auto flex flex-wrap items-center gap-2">
            <span className="text-base font-bold">¿Borrar? También sale del menú.</span>
            {r.dictado && nube && (
              <button
                type="button"
                role="checkbox"
                aria-checked={borrarAudio}
                onClick={() => setBorrarAudio((x) => !x)}
                className="inline-flex min-h-12 items-center gap-2 rounded-2xl px-2 text-base font-bold"
              >
                <Casilla marcada={borrarAudio} />
                {TEXTOS.borrarTambienAudio}
              </button>
            )}
            <Boton variante="peligro" onClick={borrar}>
              Sí
            </Boton>
            <Boton variante="fantasma" onClick={() => setConfirmar(false)}>
              No
            </Boton>
          </div>
        ) : (
          <Boton variante="peligro" className="mr-auto" onClick={() => setConfirmar(true)}>
            🗑 Borrar
          </Boton>
        ))}
      <Boton variante="fantasma" onClick={alCerrar}>
        Cancelar
      </Boton>
      <Boton variante="primario" disabled={!r.nombre.trim() || guardando} onClick={() => void guardar()}>
        {guardando ? TEXTOS.guardando : "Guardar"}
      </Boton>
    </>
  );

  return (
    <Modal titulo={titulo} alCerrar={alCerrar} ancho="max-w-4xl" pie={pie}>
      <div className="space-y-6">
        {dictado && (
          <div className="space-y-3 rounded-2xl bg-acento-suave p-4 text-lg">
            {inicio.seguiste && <p className="font-bold">{TEXTOS.seguisteDondeQuedaste}</p>}
            {otraVersionFallo(dictado) && (
              <p role="alert" className="rounded-2xl bg-superficie px-3 py-2 font-bold">
                {textoOtraVersionFallo(dictado)}
              </p>
            )}
            <p>{TEXTOS.recuadroRevisar}</p>
            {!!dictado.avisos?.length && (
              <ul className="list-disc space-y-1 pl-6">
                {dictado.avisos.map((a, n) => (
                  <li key={n}>{a}</li>
                ))}
              </ul>
            )}
            <BotonEscuchar dictadoId={dictado.id} etiqueta={TEXTOS.escucharAudio} />
            <VerLoQueSeDijo dictadoId={dictado.id} texto={dictado.transcripcion} className="bg-superficie" />
          </div>
        )}
        {!dictado && r.dictado && nube && (
          <div className="space-y-3 rounded-2xl bg-superficie-2 p-4 text-lg">
            <p className="font-bold">{TEXTOS.dictadaEl(fechaDictado(r.dictado.fecha))}</p>
            <div className="flex flex-wrap items-start gap-2">
              <BotonEscuchar dictadoId={r.dictado.id} etiqueta={TEXTOS.escucharComo} />
              {!confirmarAudio && (
                <Boton variante="peligro" onClick={() => setConfirmarAudio(true)}>
                  {TEXTOS.borrarAudio}
                </Boton>
              )}
            </div>
            {confirmarAudio && (
              <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-red-600/10 p-3">
                <span className="font-bold">{TEXTOS.confirmarBorrarAudio}</span>
                <Boton variante="peligro" disabled={ocupado} onClick={() => void quitarAudio()}>
                  {TEXTOS.siBorrarAudio}
                </Boton>
                <Boton variante="fantasma" onClick={() => setConfirmarAudio(false)}>
                  {TEXTOS.no}
                </Boton>
              </div>
            )}
            <VerLoQueSeDijo dictadoId={r.dictado.id} className="bg-superficie" />
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-[1fr_auto]">
          <Campo etiqueta="Nombre">
            <Entrada value={r.nombre} onChange={(e) => set("nombre", e.target.value)} placeholder="Ej.: Pastel de papas" />
          </Campo>
          <div className="flex gap-4">
            <div>
              <span className="mb-1.5 block text-base font-bold text-tinta-suave">Porciones</span>
              <Contador valor={r.porciones} alCambiar={(v) => set("porciones", v)} />
            </div>
            <Campo etiqueta="Minutos">
              <Entrada
                type="number"
                inputMode="numeric"
                min={0}
                className="w-24"
                value={r.tiempoMin ?? ""}
                onChange={(e) => set("tiempoMin", e.target.value ? Number(e.target.value) : undefined)}
              />
            </Campo>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <span className="mb-1.5 block text-base font-bold text-tinta-suave">Ícono</span>
            <div className="flex flex-wrap gap-1.5">
              {EMOJIS_RECETA.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => set("emoji", e)}
                  className={cx("size-12 rounded-xl text-3xl", r.emoji === e ? "bg-acento-suave ring-[3px] ring-acento" : "bg-superficie-2")}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="mb-1.5 block text-base font-bold text-tinta-suave">Foto (opcional)</span>
            <div className="flex items-center gap-3">
              {r.foto && <FotoReceta receta={r} className="size-20" />}
              <label className="inline-flex min-h-12 cursor-pointer items-center rounded-2xl bg-superficie-2 px-4 text-lg font-bold">
                📷 {r.foto ? "Cambiar" : "Subir foto"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const a = e.target.files?.[0];
                    e.target.value = "";
                    if (!a) return;
                    try {
                      set("foto", await reducirFoto(a));
                    } catch {
                      setError("No se pudo leer esa foto. Prueba con otra (JPG o PNG).");
                    }
                  }}
                />
              </label>
              {r.foto && (
                <Boton variante="fantasma" onClick={() => set("foto", undefined)}>
                  Quitar
                </Boton>
              )}
            </div>
          </div>
        </div>

        {!!r.dudas?.length && (
          <div className="rounded-2xl bg-acento-suave p-4">
            <h3 className="mb-1 text-lg font-extrabold uppercase">{TEXTOS.dudasTitulo}</h3>
            <p className="mb-3 text-base">{TEXTOS.dudasAyuda}</p>
            <ul className="space-y-2">
              {r.dudas.map((q, n) => (
                <li key={`${n}:${q}`} className="flex flex-wrap items-center gap-3 rounded-2xl bg-superficie p-3">
                  <span className="min-w-0 flex-1 text-lg">{q}</span>
                  <Boton onClick={() => set("dudas", r.dudas!.filter((_, k) => k !== n))}>{TEXTOS.resuelta}</Boton>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <h3 className="mb-2 text-lg font-extrabold uppercase text-acento">Ingredientes</h3>
          <div className="space-y-2">
            {r.ingredientes.map((i) => {
              const extra = !!r.dictado || !!i.comoLoDijo || !!i.estimado || !!i.nota;
              return (
                <div
                  key={i.id}
                  className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] gap-2 rounded-2xl bg-superficie-2 p-2 md:grid-cols-[minmax(0,1fr)_6rem_9rem_13rem_auto]"
                >
                  <Entrada
                    aria-label="Ingrediente"
                    placeholder="Ingrediente"
                    className="col-span-2 col-start-1 row-start-1 md:col-span-1 md:col-start-1 md:row-start-1"
                    value={i.nombre}
                    onChange={(e) => {
                      const nombre = e.target.value;
                      // Mientras no se haya elegido a mano, la categoría se adivina por el nombre.
                      const auto = i.categoria === "Otros" || i.categoria === adivinarCategoria(i.nombre);
                      setIng(i.id, { nombre, ...(auto ? { categoria: adivinarCategoria(nombre) } : {}) });
                    }}
                  />
                  <Entrada
                    aria-label="Cantidad"
                    className={cx("col-start-1 row-start-2 md:col-start-2 md:row-start-1", i.estimado && "border-acento")}
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min={0}
                    placeholder="Cant."
                    disabled={i.unidad === "al gusto"}
                    value={i.cantidad ?? ""}
                    // Una cantidad cambiada a mano ya no es la que calculó Gemini.
                    onChange={(e) => setIng(i.id, { cantidad: e.target.value === "" ? null : Number(e.target.value), estimado: undefined })}
                  />
                  <Selector
                    aria-label="Unidad"
                    className="col-span-2 col-start-2 row-start-2 md:col-span-1 md:col-start-3 md:row-start-1"
                    value={i.unidad}
                    onChange={(e) => {
                      const u = e.target.value as Unidad;
                      setIng(i.id, { unidad: u, cantidad: u === "al gusto" ? null : i.cantidad, estimado: undefined });
                    }}
                  >
                    {UNIDADES.map((u) => (
                      <option key={u.valor} value={u.valor}>
                        {u.nombre}
                      </option>
                    ))}
                  </Selector>
                  <Selector
                    aria-label="Categoría"
                    className="col-span-3 col-start-1 row-start-3 md:col-span-1 md:col-start-4 md:row-start-1"
                    value={i.categoria}
                    onChange={(e) => setIng(i.id, { categoria: e.target.value as Ingrediente["categoria"] })}
                  >
                    {CATEGORIAS.map((c) => (
                      <option key={c.nombre} value={c.nombre}>
                        {c.emoji} {c.nombre}
                      </option>
                    ))}
                  </Selector>
                  <BotonIcono
                    etiqueta="Quitar ingrediente"
                    className="col-start-3 row-start-1 md:col-start-5"
                    onClick={() => set("ingredientes", r.ingredientes.filter((x) => x.id !== i.id))}
                  >
                    ✕
                  </BotonIcono>
                  {extra && (
                    <div className="col-span-3 col-start-1 row-start-4 flex flex-wrap items-center gap-2 md:col-span-5 md:col-start-1 md:row-start-2">
                      <button
                        type="button"
                        aria-pressed={!!i.estimado}
                        disabled={i.cantidad == null}
                        onClick={() => setIng(i.id, { estimado: i.estimado ? undefined : true })}
                        className={cx(
                          "inline-flex min-h-12 shrink-0 items-center rounded-2xl px-4 text-lg font-bold transition active:scale-[0.97] disabled:opacity-40",
                          i.estimado ? "bg-acento text-acento-tinta" : "bg-superficie text-tinta-suave",
                        )}
                      >
                        {TEXTOS.estimada}
                      </button>
                      <Entrada
                        aria-label="Nota del ingrediente"
                        placeholder={TEXTOS.notaIngrediente}
                        className="min-w-40 flex-1"
                        value={i.nota ?? ""}
                        onChange={(e) => setIng(i.id, { nota: e.target.value || undefined })}
                      />
                      {i.comoLoDijo && <span className="basis-full text-base text-tinta-suave md:basis-auto">{TEXTOS.dijo(i.comoLoDijo)}</span>}
                      {revisar[i.id] && <span className="basis-full text-base font-bold text-red-700 noche:text-red-300">⚠ {revisar[i.id]}</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <Boton className="mt-2" onClick={() => set("ingredientes", [...r.ingredientes, ingredienteVacio()])}>
            ＋ Ingrediente
          </Boton>
        </div>

        <div>
          <h3 className="mb-2 text-lg font-extrabold uppercase text-acento">Pasos</h3>
          <div className="space-y-2">
            {r.pasos.map((p, n) => (
              <div key={n} className="flex items-start gap-2">
                <span className="num mt-2 flex size-9 shrink-0 items-center justify-center rounded-full bg-acento font-extrabold text-acento-tinta">
                  {n + 1}
                </span>
                <AreaTexto
                  rows={2}
                  value={p}
                  onChange={(e) => set("pasos", r.pasos.map((x, k) => (k === n ? e.target.value : x)))}
                />
                <BotonIcono etiqueta="Quitar paso" onClick={() => set("pasos", r.pasos.filter((_, k) => k !== n))}>
                  ✕
                </BotonIcono>
              </div>
            ))}
          </div>
          <Boton className="mt-2" onClick={() => set("pasos", [...r.pasos, ""])}>
            ＋ Paso
          </Boton>
        </div>

        <Campo etiqueta="Secreto o nota (opcional)">
          <AreaTexto value={r.nota ?? ""} onChange={(e) => set("nota", e.target.value || undefined)} />
        </Campo>
      </div>
    </Modal>
  );
}
