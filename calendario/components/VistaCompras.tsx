"use client";

import { useState } from "react";
import { useDatos } from "@/lib/store";
import type { CategoriaCompra, ItemCompra } from "@/lib/datos/tipos";
import { CATEGORIAS, adivinarCategoria, agruparPorCategoria, textoCantidad } from "@/lib/compras";
import { nuevoId } from "@/lib/ejemplo";
import { Boton, BotonIcono, Casilla, Entrada, Selector, Vacio, cx } from "./ui";

/** "2 kg papas" → { cantidad: 2, unidad: "kg", nombre: "papas" } */
function interpretar(texto: string): Pick<ItemCompra, "nombre" | "cantidad" | "unidad"> {
  const m = texto.trim().match(/^(\d+(?:[.,]\d+)?)\s*(kg|g|gr|l|lt|litros?|ml|un|unidades?)?\s+(.+)$/i);
  if (!m) return { nombre: texto.trim(), cantidad: null, unidad: "unidad" };
  const cant = Number(m[1].replace(",", "."));
  const u = (m[2] ?? "").toLowerCase();
  const unidad =
    u === "kg" ? "kg" : u === "g" || u === "gr" ? "g" : u.startsWith("l") ? "l" : u === "ml" ? "ml" : "unidad";
  return { nombre: m[3].trim(), cantidad: cant, unidad };
}

export default function VistaCompras() {
  const { estado, actualizar } = useDatos();
  const [texto, setTexto] = useState("");
  const [categoria, setCategoria] = useState<CategoriaCompra | "auto">("auto");
  const pendientes = estado.compras.filter((c) => !c.comprado);
  const comprados = estado.compras.filter((c) => c.comprado);

  const agregar = (e: React.FormEvent) => {
    e.preventDefault();
    if (!texto.trim()) return;
    const base = interpretar(texto);
    actualizar("compras", (l) => [
      ...l,
      {
        id: nuevoId("com"),
        ...base,
        categoria: categoria === "auto" ? adivinarCategoria(base.nombre) : categoria,
        comprado: false,
        origen: "manual",
      },
    ]);
    setTexto("");
  };

  const alternar = (id: string) =>
    actualizar("compras", (l) => l.map((c) => (c.id === id ? { ...c, comprado: !c.comprado } : c)));
  const quitar = (id: string) => actualizar("compras", (l) => l.filter((c) => c.id !== id));

  return (
    <section className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 font-display text-2xl font-semibold md:text-3xl">
          Lista de compras <span className="num text-tinta-suave">· {pendientes.length}</span>
        </h1>
        {comprados.length > 0 && (
          <Boton className="ml-auto" onClick={() => actualizar("compras", (l) => l.filter((c) => !c.comprado))}>
            🧹 Sacar comprados ({comprados.length})
          </Boton>
        )}
      </div>

      <form onSubmit={agregar} className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
        <Entrada
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Agregar: “2 kg papas”, “leche”, “detergente”…"
          enterKeyHint="done"
        />
        <Selector className="md:w-auto" value={categoria} onChange={(e) => setCategoria(e.target.value as CategoriaCompra | "auto")}>
          <option value="auto">✨ Categoría automática</option>
          {CATEGORIAS.map((c) => (
            <option key={c.nombre} value={c.nombre}>
              {c.emoji} {c.nombre}
            </option>
          ))}
        </Selector>
        <Boton type="submit" variante="primario" disabled={!texto.trim()}>
          ＋ Agregar
        </Boton>
      </form>

      <div className="desliza min-h-0 flex-1 overflow-y-auto">
        {estado.compras.length === 0 ? (
          <Vacio emoji="🛒" texto="La lista está vacía. Genérala desde el Menú o agrega cosas arriba." />
        ) : (
          <div className="columns-1 gap-3 md:columns-2 xl:columns-3">
            {agruparPorCategoria(pendientes).map((g) => (
              <div key={g.nombre} className="mb-3 break-inside-avoid rounded-3xl bg-superficie p-3">
                <h2 className="mb-2 px-1 text-lg font-extrabold uppercase text-tinta-suave">
                  {g.emoji} {g.nombre}
                </h2>
                <div className="space-y-1">
                  {g.items.map((c) => (
                    <Fila key={c.id} item={c} alAlternar={() => alternar(c.id)} alQuitar={() => quitar(c.id)} />
                  ))}
                </div>
              </div>
            ))}
            {comprados.length > 0 && (
              <div className="mb-3 break-inside-avoid rounded-3xl bg-superficie p-3 opacity-80">
                <h2 className="mb-2 px-1 text-lg font-extrabold uppercase text-ok">✓ En el carro</h2>
                <div className="space-y-1">
                  {comprados.map((c) => (
                    <Fila key={c.id} item={c} alAlternar={() => alternar(c.id)} alQuitar={() => quitar(c.id)} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function Fila({ item, alAlternar, alQuitar }: { item: ItemCompra; alAlternar: () => void; alQuitar: () => void }) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={alAlternar}
        className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-2xl px-1 text-left transition active:bg-superficie-2"
      >
        <Casilla marcada={item.comprado} />
        <div className="min-w-0">
          <div className={cx("text-xl font-extrabold leading-tight", item.comprado && "text-tinta-suave line-through")}>
            {item.nombre}
            {item.cantidad != null && (
              <span className="num ml-2 font-bold text-acento">{textoCantidad(item.cantidad, item.unidad)}</span>
            )}
          </div>
          {item.origen === "menu" && item.detalle && (
            <div className="truncate text-sm font-bold text-tinta-suave">🍽️ {item.detalle}</div>
          )}
        </div>
      </button>
      <BotonIcono etiqueta={`Quitar ${item.nombre}`} className="bg-transparent text-xl text-tinta-suave" onClick={alQuitar}>
        ✕
      </BotonIcono>
    </div>
  );
}
