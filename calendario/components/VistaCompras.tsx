"use client";

import { useState } from "react";
import { useDatos } from "@/lib/store";
import type { CategoriaCompra, ItemCompra, Unidad } from "@/lib/datos/tipos";
import { CATEGORIAS, adivinarCategoria, agruparPorCategoria, textoCantidad } from "@/lib/compras";
import { nuevoId } from "@/lib/ejemplo";
import { hoy, lunesDe, semanaCorta } from "@/lib/fechas";
import { Boton, BotonIcono, Casilla, Entrada, Selector, Vacio, cx } from "./ui";

/** Unidades que se entienden al escribir a mano ("2 kilos de papas", "1 docena de huevos"). */
const ALIAS: [RegExp, Unidad, number][] = [
  [/^(kg|kgs|kilos?)$/i, "kg", 1],
  [/^(g|gr|grs|gramos?)$/i, "g", 1],
  [/^(l|lt|lts|litros?)$/i, "l", 1],
  [/^(ml|cc)$/i, "ml", 1],
  [/^(un|und|unid|unidad(es)?)$/i, "unidad", 1],
  [/^docenas?$/i, "unidad", 12],
  [/^paquetes?$/i, "paquete", 1],
  [/^latas?$/i, "lata", 1],
  [/^atados?$/i, "atado", 1],
  [/^tazas?$/i, "taza", 1],
  [/^dientes?$/i, "diente", 1],
];

/** Número escrito en Chile: "1.000" son mil, "1,5" es uno y medio, "1/2" es medio. */
function numeroCL(s: string): number {
  if (s === "½") return 0.5;
  if (s === "¼") return 0.25;
  if (s === "¾") return 0.75;
  const fr = s.match(/^(\d+)\/(\d+)$/);
  if (fr) return Number(fr[1]) / Number(fr[2] || 1);
  // El punto separa miles sólo si no parte con 0 ("0.500" es medio, "1.000" son mil).
  if (/^[1-9]\d{0,2}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "");
  return Number(s.replace(",", "."));
}

/**
 * "2 kg de papas" → { cantidad: 2, unidad: "kg", nombre: "papas" }.
 * El número puede ir pegado a una unidad ("2kg"), pero no a otra palabra ("7up" queda tal cual).
 * "3x arroz" o "3 x arroz" son 3 de arroz.
 */
export function interpretar(texto: string): Pick<ItemCompra, "nombre" | "cantidad" | "unidad"> {
  const t = texto.trim().replace(/\s+/g, " ");
  const sin = { nombre: t, cantidad: null, unidad: "unidad" as Unidad };
  // La fracción va primero en la alternancia: si no, "1" calza solo y "/2" queda en el nombre.
  const m = t.match(/^(\d+\/\d+|\d+(?:[.,]\d+)*|½|¼|¾)(\s*)(.*)$/);
  if (!m || !m[3]) return sin;
  let cantidad = numeroCL(m[1]);
  if (!Number.isFinite(cantidad) || cantidad <= 0) return sin;
  let unidad: Unidad = "unidad";
  let resto = m[3];
  const pegado = m[2] === "";
  const w = resto.match(/^([a-záéíóúñ]+)\.?(?:\s+(.*))?$/i);
  const alias = w ? ALIAS.find(([re]) => re.test(w[1])) : undefined;
  if (w && alias) {
    if (!w[2]) return sin; // "2 kg" sin decir de qué
    unidad = alias[1];
    cantidad *= alias[2];
    resto = w[2];
  } else if (/^x(\s+|$)/i.test(resto)) {
    resto = resto.replace(/^x\s*/i, ""); // "3x arroz"
  } else if (pegado) {
    return sin; // "7up", "4x4": el número es parte del nombre
  }
  resto = resto.replace(/^de\s+/i, "").trim();
  if (!resto) return sin;
  return { nombre: resto, cantidad, unidad };
}

/** "2–8 nov" para distinguir ítems del menú de distintas semanas. */
export default function VistaCompras() {
  const { estado, actualizar } = useDatos();
  const [texto, setTexto] = useState("");
  const [categoria, setCategoria] = useState<CategoriaCompra | "auto">("auto");
  // Los "ocultos" son comprados que se sacaron de la vista; se guardan para descontarlos si se regenera la lista.
  const visibles = estado.compras.filter((c) => !c.oculto);
  const pendientes = visibles.filter((c) => !c.comprado);
  const comprados = visibles.filter((c) => c.comprado);
  const variasSemanas = new Set(visibles.filter((c) => c.origen === "menu" && c.semana).map((c) => c.semana)).size > 1;

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

  /** Un comprado del menú de esta semana o de una próxima se oculta (no se borra); lo demás se borra. */
  const lunesHoy = lunesDe(hoy());
  const seGuarda = (c: ItemCompra) => c.comprado && c.origen === "menu" && !!c.semana && c.semana >= lunesHoy;
  /** Los ocultos de semanas pasadas ya no sirven para descontar nada: se limpian en cada cambio. */
  const sinViejos = (l: ItemCompra[]) => l.filter((c) => !(c.oculto && (!c.semana || c.semana < lunesHoy)));
  const quitar = (id: string) =>
    actualizar("compras", (l) =>
      sinViejos(l).flatMap((c) => (c.id !== id ? [c] : seGuarda(c) ? [{ ...c, oculto: true }] : [])),
    );
  const sacarComprados = () =>
    actualizar("compras", (l) =>
      sinViejos(l).flatMap((c) => (!c.comprado || c.oculto ? [c] : seGuarda(c) ? [{ ...c, oculto: true }] : [])),
    );

  return (
    <section className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 font-display text-2xl font-semibold md:text-3xl">
          Lista de compras <span className="num text-tinta-suave">· {pendientes.length}</span>
        </h1>
        {comprados.length > 0 && (
          <Boton className="ml-auto" onClick={sacarComprados}>
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
        {visibles.length === 0 ? (
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
                    <Fila key={c.id} item={c} conSemana={variasSemanas} alAlternar={() => alternar(c.id)} alQuitar={() => quitar(c.id)} />
                  ))}
                </div>
              </div>
            ))}
            {comprados.length > 0 && (
              <div className="mb-3 break-inside-avoid rounded-3xl bg-superficie p-3 opacity-80">
                <h2 className="mb-2 px-1 text-lg font-extrabold uppercase text-ok">✓ En el carro</h2>
                <div className="space-y-1">
                  {comprados.map((c) => (
                    <Fila key={c.id} item={c} conSemana={variasSemanas} alAlternar={() => alternar(c.id)} alQuitar={() => quitar(c.id)} />
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

function Fila({
  item,
  conSemana,
  alAlternar,
  alQuitar,
}: {
  item: ItemCompra;
  conSemana: boolean;
  alAlternar: () => void;
  alQuitar: () => void;
}) {
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
            <div className="truncate text-sm font-bold text-tinta-suave">
              🍽️ {conSemana && item.semana ? `${semanaCorta(item.semana)} · ` : ""}
              {item.detalle}
            </div>
          )}
        </div>
      </button>
      <BotonIcono etiqueta={`Quitar ${item.nombre}`} className="bg-transparent text-xl text-tinta-suave" onClick={alQuitar}>
        ✕
      </BotonIcono>
    </div>
  );
}
