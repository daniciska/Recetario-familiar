"use client";

import { useState } from "react";

const PREFIJO = "calendario-familiar:v1:";

/** Si algo falla al dibujar la app (p. ej. datos dañados), se puede salir sin borrar el navegador. */
export default function ErrorApp({ reset }: { error: Error; reset: () => void }) {
  const [confirmar, setConfirmar] = useState(false);

  const descargar = () => {
    const datos: Record<string, unknown> = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith(PREFIJO)) datos[k.slice(PREFIJO.length)] = JSON.parse(localStorage.getItem(k) ?? "null");
      }
    } catch {
      /* lo que se pueda */
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, ...datos }, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "calendario-familiar-copia.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const borrar = () => {
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIJO)) localStorage.removeItem(k);
    } catch {
      /* nada */
    }
    location.reload();
  };

  const boton = "min-h-14 rounded-2xl px-6 text-xl font-bold";
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-5 p-6 text-center">
      <span className="text-7xl">😵‍💫</span>
      <h1 className="font-display text-3xl font-semibold">Algo salió mal</h1>
      <p className="max-w-xl text-xl text-tinta-suave">
        Prueba de nuevo. Si sigue fallando, puede que los datos guardados en este equipo estén dañados: descarga una copia
        y después empieza de nuevo.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <button type="button" className={`${boton} bg-acento text-acento-tinta`} onClick={reset}>
          Probar de nuevo
        </button>
        <button type="button" className={`${boton} bg-superficie-2`} onClick={descargar}>
          ⬇️ Descargar copia
        </button>
        {confirmar ? (
          <button type="button" className={`${boton} bg-red-600/15 text-red-700`} onClick={borrar}>
            Sí, borrar los datos de este equipo
          </button>
        ) : (
          <button type="button" className={`${boton} bg-red-600/10 text-red-700`} onClick={() => setConfirmar(true)}>
            Empezar de nuevo
          </button>
        )}
      </div>
    </div>
  );
}
