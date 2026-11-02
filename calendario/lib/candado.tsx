"use client";

// PIN para hacer cambios en la pantalla de la pared (que los niños miren y marquen sus quehaceres,
// pero no borren eventos ni cambien el menú). Es un candado para la casa, no seguridad: los datos
// viven en el navegador.

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useDatos } from "./store";
import { esPantallaPared, useModoPared } from "./hooks";
import { cx } from "@/components/ui";

/** Cuánto dura desbloqueado después de poner el PIN (se alarga con cada cambio). */
const DESBLOQUEO = 5 * 60_000;
const CLAVE_PEDIR = "calendario-familiar:equipo:pin";

/** Huella del PIN (FNV-1a de 32 bits): basta para no guardar el PIN a la vista. */
export function huellaPin(pin: string): string {
  let h = 0x811c9dc5;
  for (const c of `calendario-familiar|${pin}`) {
    h ^= c.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `fnv1a:${h.toString(16).padStart(8, "0")}`;
}

// ---------- "Pedir PIN en este equipo" (por equipo, como el modo pared) ----------

const oyentes = new Set<() => void>();
function leerPedir(): boolean | null {
  try {
    const v = localStorage.getItem(CLAVE_PEDIR);
    if (v === "1") return true;
    if (v === "0") return false;
  } catch {
    /* sin almacenamiento */
  }
  return null; // sin elegir: sigue al modo pared
}

/** [pide PIN en este equipo, cambiar]. Por defecto lo pide sólo la pantalla de la pared. */
export function usePedirPinEnEquipo(): [boolean, (v: boolean) => void] {
  const [modoPared] = useModoPared();
  const elegido = useSyncExternalStore(
    (cb) => {
      oyentes.add(cb);
      return () => oyentes.delete(cb);
    },
    leerPedir,
    () => null,
  );
  const cambiar = (v: boolean) => {
    try {
      localStorage.setItem(CLAVE_PEDIR, v ? "1" : "0");
    } catch {
      /* sin almacenamiento */
    }
    oyentes.forEach((f) => f());
  };
  return [elegido ?? modoPared, cambiar];
}

// ---------- Contexto ----------

interface Candado {
  /** Hace `accion` si no hace falta PIN (o ya se puso); si no, lo pide y la hace al acertar. */
  proteger: (accion: () => void) => void;
  /** Hay PIN y este equipo lo pide ahora mismo. */
  bloqueado: boolean;
}

const Ctx = createContext<Candado>({ proteger: (a) => a(), bloqueado: false });
export const useCandado = () => useContext(Ctx);

export function ProveedorCandado({ children }: { children: React.ReactNode }) {
  const { estado } = useDatos();
  const [pedir] = usePedirPinEnEquipo();
  const pin = estado.ajustes.pin;
  const hasta = useRef(0);
  const [, refrescar] = useState(0);
  const [pendiente, setPendiente] = useState<{ accion: () => void } | null>(null);

  const activo = !!pin && pedir;
  const abierto = () => Date.now() < hasta.current;
  // Al decidir, se lee el ajuste del equipo en ese momento: en el primer dibujo (al cargar con
  // #ajustes en la dirección) `pedir` todavía no está leído del almacenamiento.
  const pinRef = useRef(pin);
  useEffect(() => {
    pinRef.current = pin;
  }, [pin]);
  const pideAhora = () => !!pinRef.current && (leerPedir() ?? esPantallaPared());

  // Al vencer el desbloqueo se vuelve a dibujar (para que `bloqueado` sea verdad otra vez).
  useEffect(() => {
    if (!activo) return;
    const t = setInterval(() => {
      if (hasta.current && !abierto()) {
        hasta.current = 0;
        refrescar((n) => n + 1);
      }
    }, 15_000);
    return () => clearInterval(t);
  }, [activo]);

  const proteger = useCallback((accion: () => void) => {
    const pide = pideAhora();
    if (!pide || abierto()) {
      if (pide) hasta.current = Date.now() + DESBLOQUEO;
      accion();
      return;
    }
    setPendiente({ accion });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Ctx.Provider value={{ proteger, bloqueado: activo && !abierto() }}>
      {children}
      {pendiente && pin && (
        <TecladoPin
          huella={pin}
          alAcertar={() => {
            hasta.current = Date.now() + DESBLOQUEO;
            const { accion } = pendiente;
            setPendiente(null);
            refrescar((n) => n + 1);
            accion();
          }}
          alCancelar={() => setPendiente(null)}
        />
      )}
    </Ctx.Provider>
  );
}

/** Teclado grande de 4 dígitos. Sirve para pedir el PIN o para elegir uno nuevo (sin `huella`). */
export function TecladoPin({
  huella,
  titulo = "Ingresa el PIN",
  ayuda = "Para hacer cambios en esta pantalla.",
  alAcertar,
  alElegir,
  alCancelar,
}: {
  huella?: string;
  titulo?: string;
  ayuda?: string;
  alAcertar?: () => void;
  alElegir?: (pin: string) => void;
  alCancelar: () => void;
}) {
  const [digitos, setDigitos] = useState("");
  const [error, setError] = useState(false);

  const poner = useCallback(
    (d: string) => {
      setError(false);
      setDigitos((p) => {
        const n = (p + d).slice(0, 4);
        if (n.length === 4) {
          // Se resuelve después de dibujar el cuarto punto.
          setTimeout(() => {
            if (!huella) return alElegir?.(n);
            if (huellaPin(n) === huella) alAcertar?.();
            else {
              setError(true);
              setDigitos("");
            }
          }, 120);
        }
        return n;
      });
    },
    [huella, alAcertar, alElegir],
  );

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) poner(e.key);
      else if (e.key === "Backspace") setDigitos((p) => p.slice(0, -1));
      else if (e.key === "Escape") alCancelar();
      else return;
      e.stopPropagation();
    };
    window.addEventListener("keydown", tecla, true);
    return () => window.removeEventListener("keydown", tecla, true);
  }, [poner, alCancelar]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4" onClick={alCancelar}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        onClick={(e) => e.stopPropagation()}
        className="aparecer w-full max-w-sm rounded-3xl bg-superficie p-6 text-center shadow-2xl"
      >
        <div className="text-5xl" aria-hidden>
          🔒
        </div>
        <h2 className="mt-2 font-display text-2xl font-semibold">{titulo}</h2>
        <p className="text-base text-tinta-suave">{ayuda}</p>
        <div className={cx("my-5 flex justify-center gap-4", error && "sacudir")} aria-live="polite">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={cx("size-5 rounded-full border-[3px] border-tinta-suave", i < digitos.length && "bg-tinta")}
            />
          ))}
        </div>
        {error && <p className="-mt-2 mb-3 text-base font-bold text-red-700 noche:text-red-300">PIN incorrecto</p>}
        <div className="mx-auto grid max-w-64 grid-cols-3 gap-3">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <Tecla key={d} onClick={() => poner(d)}>
              {d}
            </Tecla>
          ))}
          <Tecla suave onClick={alCancelar}>
            <span className="text-base">Cancelar</span>
          </Tecla>
          <Tecla onClick={() => poner("0")}>0</Tecla>
          <Tecla suave etiqueta="Borrar" onClick={() => setDigitos((p) => p.slice(0, -1))}>
            ⌫
          </Tecla>
        </div>
      </div>
    </div>
  );
}

function Tecla({
  children,
  onClick,
  suave,
  etiqueta,
}: {
  children: React.ReactNode;
  onClick: () => void;
  suave?: boolean;
  etiqueta?: string;
}) {
  return (
    <button
      type="button"
      aria-label={etiqueta}
      onClick={onClick}
      className={cx(
        "flex h-16 items-center justify-center rounded-2xl text-3xl font-bold transition active:scale-95",
        suave ? "text-tinta-suave" : "bg-superficie-2 text-tinta",
      )}
    >
      {children}
    </button>
  );
}
