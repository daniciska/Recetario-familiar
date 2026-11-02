"use client";

import { useState } from "react";
import { useDatos } from "@/lib/store";
import type { Ingrediente, Receta, Unidad } from "@/lib/datos/tipos";
import { CATEGORIAS, UNIDADES, adivinarCategoria, escalar, sinTildes, textoCantidad } from "@/lib/compras";
import { nuevoId } from "@/lib/ejemplo";
import { AreaTexto, Boton, BotonIcono, Campo, Contador, Entrada, Modal, Selector, Vacio, cx } from "./ui";

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

export default function VistaRecetas() {
  const { estado } = useDatos();
  const [busqueda, setBusqueda] = useState("");
  const [viendo, setViendo] = useState<Receta | null>(null);
  const [editando, setEditando] = useState<Receta | "nueva" | null>(null);

  const q = sinTildes(busqueda);
  const lista = estado.recetas
    .filter((r) => sinTildes(r.nombre).includes(q))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  return (
    <section className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 font-display text-2xl font-semibold md:text-3xl">Recetario</h1>
        <Entrada
          className="max-w-sm flex-1"
          placeholder="🔎 Buscar…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
        <Boton variante="primario" className="ml-auto" onClick={() => setEditando("nueva")}>
          ＋ Receta
        </Boton>
      </div>

      <div className="desliza min-h-0 flex-1 overflow-y-auto">
        {lista.length === 0 ? (
          <Vacio emoji="📖" texto={busqueda ? "No hay recetas con ese nombre." : "Todavía no hay recetas."} />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {lista.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setViendo(r)}
                className="flex flex-col overflow-hidden rounded-3xl bg-superficie text-left shadow-sm transition active:scale-[0.98]"
              >
                <div className="flex aspect-[4/3] items-center justify-center bg-superficie-2">
                  <FotoReceta receta={r} className={r.foto ? "size-full rounded-none" : "text-7xl"} />
                </div>
                <div className="p-3">
                  <div className="text-xl font-extrabold leading-tight">{r.nombre}</div>
                  <div className="mt-1 text-base font-bold text-tinta-suave">
                    👥 {r.porciones}
                    {r.tiempoMin ? ` · ⏱ ${r.tiempoMin} min` : ""} · {r.ingredientes.length} ingr.
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
          alEditar={() => {
            setEditando(estado.recetas.find((r) => r.id === viendo.id) ?? viendo);
            setViendo(null);
          }}
        />
      )}
      {editando && (
        <EditorReceta receta={editando === "nueva" ? undefined : editando} alCerrar={() => setEditando(null)} />
      )}
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
      <div className="grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div>
          {receta.foto ? (
            <FotoReceta receta={receta} className="mb-4 aspect-[4/3] w-full" />
          ) : (
            <div className="mb-4 flex aspect-[4/3] items-center justify-center rounded-2xl bg-superficie-2 text-8xl">
              {receta.emoji}
            </div>
          )}
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <span className="text-lg font-bold">Porciones</span>
            <Contador valor={porciones} alCambiar={setPorciones} />
            {receta.tiempoMin ? <span className="text-lg font-bold text-tinta-suave">⏱ {receta.tiempoMin} min</span> : null}
          </div>
          <h3 className="mb-2 text-lg font-extrabold uppercase text-acento">Ingredientes</h3>
          <ul className="space-y-1.5">
            {receta.ingredientes.map((i) => (
              <li key={i.id} className="flex gap-2 border-b border-borde pb-1.5 text-lg">
                <span className="num min-w-24 font-extrabold">
                  {textoCantidad(escalar(i.cantidad, receta, porciones) != null ? redondeo(escalar(i.cantidad, receta, porciones)!) : null, i.unidad)}
                </span>
                <span>{i.nombre}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-2 text-lg font-extrabold uppercase text-acento">Preparación</h3>
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
                    "flex w-full gap-3 rounded-2xl bg-superficie-2 p-3 text-left text-xl leading-snug transition",
                    hechos.has(n) && "opacity-45 line-through",
                  )}
                >
                  <span className="num flex size-9 shrink-0 items-center justify-center rounded-full bg-acento font-extrabold text-acento-tinta">
                    {n + 1}
                  </span>
                  <span>{p}</span>
                </button>
              </li>
            ))}
          </ol>
          {receta.nota && <p className="mt-4 rounded-2xl bg-acento-suave p-3 text-lg">💡 {receta.nota}</p>}
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

function EditorReceta({ receta, alCerrar }: { receta?: Receta; alCerrar: () => void }) {
  const { actualizar } = useDatos();
  const [r, setR] = useState<Receta>(
    () =>
      receta ?? {
        id: nuevoId("rec"),
        nombre: "",
        emoji: "🍲",
        porciones: 4,
        ingredientes: [ingredienteVacio()],
        pasos: [""],
      },
  );
  const [confirmar, setConfirmar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Receta>(k: K, v: Receta[K]) => setR((p) => ({ ...p, [k]: v }));
  const setIng = (id: string, cambios: Partial<Ingrediente>) =>
    set(
      "ingredientes",
      r.ingredientes.map((i) => (i.id === id ? { ...i, ...cambios } : i)),
    );

  const guardar = async () => {
    const limpia: Receta = {
      ...r,
      nombre: r.nombre.trim(),
      tiempoMin: r.tiempoMin && r.tiempoMin > 0 ? Math.round(r.tiempoMin) : undefined,
      ingredientes: r.ingredientes.filter((i) => i.nombre.trim()).map((i) => ({ ...i, nombre: i.nombre.trim() })),
      pasos: r.pasos.map((p) => p.trim()).filter(Boolean),
    };
    const ok = await actualizar("recetas", (lista) =>
      lista.some((x) => x.id === limpia.id) ? lista.map((x) => (x.id === limpia.id ? limpia : x)) : [...lista, limpia],
    );
    if (ok) alCerrar();
    else
      setError(
        r.foto
          ? "No se pudo guardar: el almacenamiento de este equipo está lleno. Prueba quitando la foto o borrando fotos de otras recetas."
          : "No se pudo guardar: el almacenamiento de este equipo está lleno. Prueba borrando fotos de otras recetas.",
      );
  };

  const borrar = () => {
    actualizar("recetas", (lista) => lista.filter((x) => x.id !== r.id));
    actualizar("plan", (plan) =>
      Object.fromEntries(Object.entries(plan).filter(([, c]) => c.recetaId !== r.id)),
    );
    alCerrar();
  };

  return (
    <Modal
      titulo={receta ? "Editar receta" : "Nueva receta"}
      alCerrar={alCerrar}
      ancho="max-w-4xl"
      pie={
        <>
          {receta &&
            (confirmar ? (
              <div className="mr-auto flex items-center gap-2">
                <span className="text-base font-bold">¿Borrar? También sale del menú.</span>
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
          <Boton variante="primario" disabled={!r.nombre.trim()} onClick={guardar}>
            Guardar
          </Boton>
        </>
      }
    >
      <div className="space-y-6">
        {error && <p role="alert" className="rounded-2xl bg-red-600/15 px-4 py-2 text-lg font-bold text-red-700 noche:text-red-300">{error}</p>}
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

        <div>
          <h3 className="mb-2 text-lg font-extrabold uppercase text-acento">Ingredientes</h3>
          <div className="space-y-2">
            {r.ingredientes.map((i) => (
              <div
                key={i.id}
                className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] gap-2 rounded-2xl bg-superficie-2 p-2 md:grid-cols-[6rem_9rem_minmax(0,1fr)_13rem_auto]"
              >
                <Entrada
                  aria-label="Ingrediente"
                  placeholder="Ingrediente"
                  className="col-span-2 col-start-1 row-start-1 md:col-span-1 md:col-start-3 md:row-start-1"
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
                  className="col-start-1 row-start-2 md:col-start-1 md:row-start-1"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min={0}
                  placeholder="Cant."
                  disabled={i.unidad === "al gusto"}
                  value={i.cantidad ?? ""}
                  onChange={(e) => setIng(i.id, { cantidad: e.target.value === "" ? null : Number(e.target.value) })}
                />
                <Selector
                  aria-label="Unidad"
                  className="col-span-2 col-start-2 row-start-2 md:col-span-1 md:col-start-2 md:row-start-1"
                  value={i.unidad}
                  onChange={(e) => {
                    const u = e.target.value as Unidad;
                    setIng(i.id, { unidad: u, cantidad: u === "al gusto" ? null : i.cantidad });
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
              </div>
            ))}
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
