"use client";

// Familia → «🎙️ Recetas por audio (Gemini)»: qué hace, la privacidad del plan gratis y «Probar conexión»
// (pregunta por el modelo en Google: no gasta cuota). Sólo con la familia en la nube. La clave vive en la
// variable secreta GEMINI_API_KEY de Netlify: el panel nunca la pide ni la muestra.

import { useState } from "react";
import { useDatos } from "@/lib/store";
import { probarGemini } from "@/lib/dictados/cliente";
import { TEXTOS, TEXTOS_GEMINI, mensajeProbar } from "@/lib/dictados/textos";
import { mensajeNube } from "./Escuchar";
import { Boton, cx } from "./ui";

export function SeccionGemini() {
  const { nube } = useDatos();
  const [probando, setProbando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null);
  if (!nube) return null;

  const probar = async () => {
    setProbando(true);
    setResultado(null);
    try {
      const r = await probarGemini();
      setResultado({ ok: r.gemini === "ok", texto: mensajeProbar(r) });
    } catch (e) {
      setResultado({ ok: false, texto: mensajeNube(e) });
    } finally {
      setProbando(false);
    }
  };

  return (
    <div className="rounded-3xl bg-superficie p-4">
      <h2 className="mb-1 text-xl font-extrabold">{TEXTOS_GEMINI.titulo}</h2>
      <p className="mb-2 text-base text-tinta-suave">{TEXTOS_GEMINI.explicacion}</p>
      <p className="mb-3 text-base text-tinta-suave">{TEXTOS.limites}</p>
      <Boton onClick={() => void probar()} disabled={probando}>
        {probando ? TEXTOS_GEMINI.probando : TEXTOS_GEMINI.probar}
      </Boton>
      {resultado && (
        <p role="status" className={cx("mt-3 rounded-2xl px-4 py-3 text-lg", resultado.ok ? "bg-superficie-2 font-bold" : "bg-acento-suave")}>
          {resultado.texto}
        </p>
      )}
    </div>
  );
}
