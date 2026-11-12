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
  /**
   * Hace `accion` si no hace falta PIN (o ya se puso hace poco); si no, lo pide y la hace al acertar.
   * Con `siempre`, lo pide aunque esté abierto (quitar o cambiar el PIN, dejar de pedirlo).
   */
  proteger: (accion: () => void, opciones?: { siempre?: boolean }) => void;
  /** Hay PIN y este equipo lo pide ahora mismo. */
  bloqueado: boolean;
  /** Vuelve a cerrar el candado (la pared volvió sola al calendario). */
  cerrar: () => void;
}

const Ctx = createContext<Candado>({ proteger: (a) => a(), bloqueado: false, cerrar: () => {} });
export const useCandado = () => useContext(Ctx);

/** Un teclado del PIN sin tocar este rato se cierra solo (un niño tocó algo protegido y se fue). */
const TECLADO_OLVIDADO = 60_000;

/**
 * Código para destrabar un equipo que olvidó el PIN: el equipo muestra un número al azar y otro
 * equipo con la app (el teléfono) calcula el código. No guarda nada: es la misma cuenta en los dos.
 */
export function codigoDestrabe(numero: string): string {
  const h = parseInt(huellaPin(`destrabar|${numero.replace(/\D/g, "")}`).slice(6), 16);
  return String(h % 1_000_000).padStart(6, "0");
}

export function ProveedorCandado({ children }: { children: React.ReactNode }) {
  const { estado, actualizar } = useDatos();
  const [pedir] = usePedirPinEnEquipo();
  const pin = estado.ajustes.pin;
  const hasta = useRef(0);
  const [, refrescar] = useState(0);
  const [pendiente, setPendiente] = useState<{ accion: () => void } | null>(null);
  const pendienteRef = useRef(pendiente);
  useEffect(() => {
    pendienteRef.current = pendiente;
  }, [pendiente]);

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

  // Si nadie lo usa, el teclado se cierra solo: si no, tapa la pared y frena la vuelta al
  // calendario y la recarga diaria, que respetan cualquier ventana abierta.
  useEffect(() => {
    if (!pendiente) return;
    let ultimo = Date.now();
    const tocar = () => {
      ultimo = Date.now();
    };
    const op = { capture: true, passive: true } as const;
    window.addEventListener("pointerdown", tocar, op);
    window.addEventListener("keydown", tocar, op);
    const t = setInterval(() => {
      if (Date.now() - ultimo >= TECLADO_OLVIDADO) setPendiente(null);
    }, 5_000);
    return () => {
      clearInterval(t);
      window.removeEventListener("pointerdown", tocar, op);
      window.removeEventListener("keydown", tocar, op);
    };
  }, [pendiente]);

  const proteger = useCallback((accion: () => void, opciones?: { siempre?: boolean }) => {
    const pide = pideAhora();
    if (!pide || (abierto() && !opciones?.siempre)) {
      if (pide) hasta.current = Date.now() + DESBLOQUEO;
      accion();
      return;
    }
    setPendiente({ accion });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cerrar = useCallback(() => {
    hasta.current = 0;
  }, []);

  /** Después de acertar (o de destrabar): se hace la acción pendiente una sola vez. */
  const hacerPendiente = () => {
    const p = pendienteRef.current;
    if (!p) return;
    pendienteRef.current = null;
    setPendiente(null);
    refrescar((n) => n + 1);
    p.accion();
  };

  return (
    <Ctx.Provider value={{ proteger, bloqueado: activo && !abierto(), cerrar }}>
      {children}
      {pendiente && pin && (
        <TecladoPin
          huella={pin}
          alAcertar={() => {
            hasta.current = Date.now() + DESBLOQUEO;
            hacerPendiente();
          }}
          alDestrabar={async () => {
            const ok = await actualizar("ajustes", (a) => ({ ...a, pin: undefined }));
            if (ok) hacerPendiente();
            return ok;
          }}
          alCancelar={() => setPendiente(null)}
        />
      )}
    </Ctx.Provider>
  );
}

/**
 * Teclado grande de 4 dígitos. Sirve para pedir el PIN (con `huella`) o para elegir uno nuevo.
 * Con `alDestrabar`, ofrece "¿Olvidaste el PIN?".
 */
export function TecladoPin({
  huella,
  titulo = "Ingresa el PIN",
  ayuda = "Para hacer cambios en esta pantalla.",
  alAcertar,
  alElegir,
  alDestrabar,
  alCancelar,
}: {
  huella?: string;
  titulo?: string;
  ayuda?: string;
  alAcertar?: () => void;
  alElegir?: (pin: string) => void;
  alDestrabar?: () => Promise<boolean>;
  alCancelar: () => void;
}) {
  const [digitos, setDigitos] = useState("");
  const [error, setError] = useState(false);
  const [olvido, setOlvido] = useState(false);

  // Con 4 dígitos se resuelve (después de dibujar el cuarto punto); los toques de más no cuentan.
  const resolver = useRef({ huella, alAcertar, alElegir });
  useEffect(() => {
    resolver.current = { huella, alAcertar, alElegir };
  });
  useEffect(() => {
    if (digitos.length !== 4) return;
    const t = setTimeout(() => {
      const r = resolver.current;
      if (!r.huella) return r.alElegir?.(digitos);
      if (huellaPin(digitos) === r.huella) r.alAcertar?.();
      else {
        setError(true);
        setDigitos("");
      }
    }, 120);
    return () => clearTimeout(t);
  }, [digitos]);

  const poner = useCallback((d: string) => {
    setError(false);
    setDigitos((p) => (p.length >= 4 ? p : p + d));
  }, []);

  useEffect(() => {
    // Que los dígitos no se escriban también en el campo que tenía el foco.
    (document.activeElement as HTMLElement | null)?.blur?.();
  }, []);

  useEffect(() => {
    if (olvido) return;
    const tecla = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) poner(e.key);
      else if (e.key === "Backspace") setDigitos((p) => p.slice(0, -1));
      else if (e.key === "Escape") alCancelar();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", tecla, true);
    return () => window.removeEventListener("keydown", tecla, true);
  }, [poner, alCancelar, olvido]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4" onClick={alCancelar}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        onClick={(e) => e.stopPropagation()}
        className="aparecer w-full max-w-sm rounded-3xl bg-superficie p-6 text-center shadow-2xl cel:px-5 cel:py-5"
      >
        <div className="text-5xl cel:text-4xl" aria-hidden>
          🔒
        </div>
        {olvido && alDestrabar ? (
          <Destrabar alDestrabar={alDestrabar} alVolver={() => setOlvido(false)} />
        ) : (
          <>
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
            {alDestrabar && (
              <button type="button" onClick={() => setOlvido(true)} className="mt-4 min-h-11 text-base font-bold text-acento underline">
                ¿Olvidaste el PIN?
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Quitar el PIN olvidado con un código que da otro equipo (Familia → PIN → Destrabar otro equipo). */
function Destrabar({ alDestrabar, alVolver }: { alDestrabar: () => Promise<boolean>; alVolver: () => void }) {
  const [numero] = useState(() => String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0"));
  const [codigo, setCodigo] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const listo = codigo.replace(/\D/g, "").length === 6;
  return (
    <div className="mt-2 space-y-3 text-left">
      <h2 className="text-center font-display text-2xl font-semibold">¿Olvidaste el PIN?</h2>
      <p className="text-base">
        En otro equipo con la app (tu teléfono) entra a <strong>Familia → PIN → Destrabar otro equipo</strong> y escribe este
        número:
      </p>
      <p className="num text-center font-display text-4xl font-semibold tracking-widest">
        {numero.slice(0, 3)} {numero.slice(3)}
      </p>
      <p className="text-base">Allá aparece un código de 6 dígitos. Escríbelo aquí:</p>
      <input
        inputMode="numeric"
        autoComplete="off"
        value={codigo}
        onChange={(e) => {
          setMsg(null);
          setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6));
        }}
        aria-label="Código para destrabar"
        className="num min-h-13 w-full rounded-2xl border-2 border-borde bg-fondo px-4 text-center text-2xl tracking-widest outline-none focus:border-acento"
      />
      {msg && <p className="text-base font-bold text-red-700 noche:text-red-300">{msg}</p>}
      <p className="text-sm text-tinta-suave">Sólo se quita el PIN; los datos quedan igual. Después puedes definir uno nuevo en Familia.</p>
      <div className="flex justify-between gap-2">
        <button type="button" onClick={alVolver} className="min-h-12 rounded-2xl px-4 text-lg font-bold text-tinta-suave">
          Volver
        </button>
        <button
          type="button"
          disabled={!listo}
          onClick={async () => {
            if (codigo !== codigoDestrabe(numero)) return setMsg("Ese código no corresponde a este número.");
            if (!(await alDestrabar())) setMsg("No se pudo guardar. Inténtalo de nuevo.");
          }}
          className="min-h-12 rounded-2xl bg-acento px-5 text-lg font-bold text-acento-tinta disabled:opacity-40"
        >
          Quitar el PIN
        </button>
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
