"use client";

import { useEffect } from "react";
import type { Miembro } from "@/lib/datos/tipos";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type Variante = "primario" | "suave" | "fantasma" | "peligro";

export function Boton({
  variante = "suave",
  grande,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante; grande?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-2xl font-bold transition active:scale-[0.97] disabled:opacity-40",
        grande ? "min-h-16 px-6 text-xl" : "min-h-12 px-4 text-lg",
        variante === "primario" && "bg-acento text-acento-tinta shadow-sm",
        variante === "suave" && "bg-superficie-2 text-tinta",
        variante === "fantasma" && "text-tinta-suave",
        variante === "peligro" && "bg-red-600/10 text-red-700 noche:text-red-300",
        className,
      )}
    />
  );
}

export function BotonIcono({
  etiqueta,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { etiqueta: string }) {
  return (
    <button
      type="button"
      aria-label={etiqueta}
      title={etiqueta}
      {...props}
      className={cx(
        "inline-flex size-12 shrink-0 items-center justify-center rounded-2xl bg-superficie-2 text-2xl transition active:scale-95",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Ventana emergente: hoja inferior en el teléfono, centrada en el tablet. */
export function Modal({
  titulo,
  alCerrar,
  children,
  pie,
  ancho = "max-w-2xl",
}: {
  titulo: string;
  alCerrar: () => void;
  children: React.ReactNode;
  pie?: React.ReactNode;
  ancho?: string;
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && alCerrar();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [alCerrar]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 md:items-center md:p-6" onClick={alCerrar}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        onClick={(e) => e.stopPropagation()}
        className={cx(
          "aparecer flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-superficie shadow-2xl md:rounded-3xl",
          ancho,
        )}
      >
        <div className="flex items-center gap-3 border-b border-borde px-5 py-4">
          <h2 className="flex-1 font-display text-2xl font-semibold">{titulo}</h2>
          <BotonIcono etiqueta="Cerrar" onClick={alCerrar}>
            ✕
          </BotonIcono>
        </div>
        <div className="desliza flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {pie && (
          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-borde px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {pie}
          </div>
        )}
      </div>
    </div>
  );
}

export function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-base font-bold text-tinta-suave">{etiqueta}</span>
      {children}
    </label>
  );
}

export const claseInput =
  "w-full min-h-13 rounded-2xl border-2 border-borde bg-fondo px-4 py-2.5 text-lg text-tinta outline-none focus:border-acento";

export function Entrada(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(claseInput, props.className)} />;
}

export function Selector(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(claseInput, "appearance-auto", props.className)} />;
}

export function AreaTexto(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...props} className={cx(claseInput, props.className)} />;
}

/** Botones segmentados (Día / Semana / Mes, etc.) */
export function Segmentos<T extends string>({
  opciones,
  valor,
  alCambiar,
}: {
  opciones: { valor: T; texto: string }[];
  valor: T;
  alCambiar: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-2xl bg-superficie-2 p-1">
      {opciones.map((o) => (
        <button
          key={o.valor}
          type="button"
          onClick={() => alCambiar(o.valor)}
          className={cx(
            "min-h-11 rounded-xl px-4 text-lg font-bold transition",
            o.valor === valor ? "bg-superficie text-tinta shadow-sm" : "text-tinta-suave",
          )}
        >
          {o.texto}
        </button>
      ))}
    </div>
  );
}

export function Contador({
  valor,
  alCambiar,
  min = 1,
  max = 30,
}: {
  valor: number;
  alCambiar: (v: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div className="inline-flex items-center gap-2">
      <BotonIcono etiqueta="Menos" onClick={() => alCambiar(Math.max(min, valor - 1))}>
        −
      </BotonIcono>
      <span className="num min-w-10 text-center text-2xl font-extrabold">{valor}</span>
      <BotonIcono etiqueta="Más" onClick={() => alCambiar(Math.min(max, valor + 1))}>
        +
      </BotonIcono>
    </div>
  );
}

export function Avatar({ miembro, tam = "md" }: { miembro: Miembro; tam?: "sm" | "md" | "lg" }) {
  const t = tam === "sm" ? "size-7 text-base" : tam === "lg" ? "size-16 text-4xl" : "size-10 text-2xl";
  return (
    <span
      className={cx("inline-flex shrink-0 items-center justify-center rounded-full", t)}
      style={{ background: miembro.color }}
      title={miembro.nombre}
    >
      <span aria-hidden>{miembro.emoji}</span>
    </span>
  );
}

/** Chip para elegir personas (varias a la vez). */
export function ChipMiembro({
  miembro,
  activo,
  onClick,
}: {
  miembro: Miembro;
  activo: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={cx(
        "inline-flex min-h-12 items-center gap-2 rounded-full border-[3px] py-1 pl-1 pr-4 text-lg font-bold transition active:scale-95",
        activo ? "text-tinta" : "border-transparent bg-superficie-2 text-tinta-suave opacity-70",
      )}
      style={activo ? { borderColor: miembro.color, background: `color-mix(in srgb, ${miembro.color} 30%, var(--c-superficie))` } : undefined}
    >
      <Avatar miembro={miembro} tam="sm" />
      {miembro.nombre}
    </button>
  );
}

export function Vacio({ emoji, texto, children }: { emoji: string; texto: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-tinta-suave">
      <span className="text-6xl">{emoji}</span>
      <p className="text-xl">{texto}</p>
      {children}
    </div>
  );
}

export function Casilla({ marcada, color }: { marcada: boolean; color?: string }) {
  return (
    <span
      className={cx(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-xl border-[3px] text-2xl font-black transition",
        marcada ? "border-ok bg-ok text-white" : "border-borde bg-superficie",
      )}
      style={!marcada && color ? { borderColor: color } : undefined}
      aria-hidden
    >
      {marcada ? "✓" : ""}
    </span>
  );
}

const HORAS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
/** Propia (sin el px-4 de claseInput ni la flecha nativa) para que "09" quepa entero en el teléfono. */
const claseHora =
  "num min-h-13 w-auto min-w-0 flex-1 appearance-none rounded-2xl border-2 border-borde bg-fondo px-1 py-2.5 text-center text-xl font-bold text-tinta outline-none focus:border-acento disabled:opacity-60";
const MINUTOS = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"));

/** Hora en formato 24 h (independiente del idioma del tablet). */
export function SelectorHora({
  valor,
  alCambiar,
  opcional,
  etiqueta,
}: {
  valor?: string;
  alCambiar: (v: string | undefined) => void;
  opcional?: boolean;
  etiqueta: string;
}) {
  const [h, m] = valor ? valor.split(":") : ["", ""];
  const mm = MINUTOS.includes(m) ? m : m ? m : "00";
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label={etiqueta}>
      <select
        aria-label={`${etiqueta}: hora`}
        className={claseHora}
        value={h}
        onChange={(e) => alCambiar(e.target.value ? `${e.target.value}:${mm}` : undefined)}
      >
        {opcional && <option value="">—</option>}
        {HORAS.map((x) => (
          <option key={x} value={x}>
            {x}
          </option>
        ))}
      </select>
      <span className="text-2xl font-black">:</span>
      <select
        aria-label={`${etiqueta}: minutos`}
        className={claseHora}
        value={h ? mm : ""}
        disabled={!h}
        onChange={(e) => alCambiar(`${h}:${e.target.value}`)}
      >
        {!h && <option value="">—</option>}
        {!MINUTOS.includes(mm) && <option value={mm}>{mm}</option>}
        {MINUTOS.map((x) => (
          <option key={x} value={x}>
            {x}
          </option>
        ))}
      </select>
    </div>
  );
}
