"use client";

// Familia → "Calendario del iPhone (iCloud)": conectar el calendario "Familia" de iCloud (en ambos sentidos),
// ver cómo va la sincronización y resolver cuando se borraría mucho de una vez. Se muestra sólo si el
// servidor tiene la cuenta de iCloud o si ya hay un calendario de iCloud conectado (lo habitual ahora es
// Google Calendar: ver CalendarioGoogle.tsx). Hay un solo calendario conectado a la vez.

import { useState } from "react";
import { useDatos } from "@/lib/store";
import { leerSesion } from "@/lib/datos/nube";
import { EstadoConexion, ReglasPersonas, SubirExistentes, cargarInfoCalendario, esICloud, useInfoCalendario, usePedido } from "./CalendarioComun";
import { Boton, Modal, cx } from "./ui";

interface CalendarioRemoto {
  url: string;
  nombre: string;
  color?: string;
}

export function SeccionICloud() {
  const { nube, estado } = useDatos();
  const sesion = leerSesion();
  const { info } = useInfoCalendario();
  const { ocupado, msg, setMsg, pedir } = usePedido();
  const [eligiendo, setEligiendo] = useState<CalendarioRemoto[] | null>(null);

  // Sin la familia en la nube no se sabe si el servidor tiene iCloud: la sección de Google explica qué hacer.
  if (!nube || !sesion || !info) return null;
  const conexion = info.conexiones.find(esICloud);
  if (!info.servidor.icloud && !conexion) return null;
  const otra = !conexion ? info.conexiones[0] : undefined;

  const buscarCalendarios = async () => {
    const r = await pedir<{ calendarios: CalendarioRemoto[] }>("/api/calendario/calendarios");
    if (!r) return;
    if (r.status !== 200) return setMsg(r.datos.error ?? "No se pudieron ver los calendarios de iCloud.");
    if (!r.datos.calendarios.length) return setMsg("La cuenta de iCloud no tiene calendarios. Crea “Familia” en iCloud.com → Calendario.");
    setEligiendo(r.datos.calendarios);
  };

  const sinVincular = estado.eventos.filter((x) => !x.externo && !x.soloPanel).length;

  return (
    <div className="rounded-3xl bg-superficie p-4">
      <h2 className="mb-1 text-xl font-extrabold">📅 Calendario del iPhone (iCloud)</h2>
      {otra && <p className="text-lg">Hay otro calendario conectado («{otra.nombre}»): desconéctalo para usar iCloud.</p>}

      {!otra && info.servidor.icloud && info.servidor.otraFamilia && !conexion && (
        <p className="text-lg">La cuenta de iCloud del panel ya está conectada a otra familia en este sitio.</p>
      )}

      {!otra && info.servidor.icloud && !info.servidor.otraFamilia && !conexion && (
        <>
          <p className="mb-3 text-lg">
            Conecta un calendario de la cuenta <strong>{info.servidor.usuario}</strong>: lo que se agregue en la pared aparece en los
            iPhone, y lo que se agregue en el Calendario del iPhone aparece en la pared.
          </p>
          <Boton variante="primario" disabled={ocupado} onClick={buscarCalendarios}>
            {ocupado ? "Buscando…" : "📅 Elegir calendario"}
          </Boton>
        </>
      )}

      {conexion && (
        <EstadoConexion
          conexion={conexion}
          proveedor="iCloud"
          ayudas={{
            CLAVE: (
              <>
                Revisa ICLOUD_USUARIO e ICLOUD_CLAVE_APP en Netlify (la contraseña de app se puede revocar en account.apple.com; si se
                crea otra, hay que cambiarla allá y volver a publicar).
              </>
            ),
          }}
          encabezado={
            <p className="mb-1 text-lg">
              Conectado a <strong>«{conexion.nombre}»</strong> de iCloud
              {info.servidor.usuario && <span className="text-tinta-suave"> ({info.servidor.usuario})</span>}
            </p>
          }
        >
          <details className="mt-4 rounded-2xl bg-superficie-2 px-4 py-3 text-base">
            <summary className="cursor-pointer text-lg font-bold">¿Cómo se sabe para quién es un evento del iPhone?</summary>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <ReglasPersonas />
            </ul>
          </details>
        </EstadoConexion>
      )}

      {msg && <p className="mt-3 text-lg font-bold">{msg}</p>}

      {eligiendo && (
        <ElegirCalendario
          calendarios={eligiendo}
          sinVincular={sinVincular}
          alCerrar={() => setEligiendo(null)}
          alConectar={async (url, subirExistentes) => {
            const r = await pedir<{ resultado?: { ok: boolean; pendiente?: boolean; error?: { mensaje: string } } }>(
              "/api/calendario/conectar",
              { url, subirExistentes },
            );
            setEligiendo(null);
            if (r && r.status !== 200) setMsg(r.datos.error ?? "No se pudo conectar el calendario.");
            else if (r?.datos.resultado && !r.datos.resultado.ok) setMsg(r.datos.resultado.error?.mensaje ?? "La primera sincronización falló.");
            // iCloud lento: la conexión quedó, pero la primera sincronización no alcanzó; se sigue de inmediato.
            else if (r?.datos.resultado?.pendiente) await pedir("/api/calendario/sincronizar", {});
            await cargarInfoCalendario();
            nube?.revisar();
          }}
          ocupado={ocupado}
        />
      )}
    </div>
  );
}

function ElegirCalendario({
  calendarios,
  sinVincular,
  ocupado,
  alCerrar,
  alConectar,
}: {
  calendarios: CalendarioRemoto[];
  sinVincular: number;
  ocupado: boolean;
  alCerrar: () => void;
  alConectar: (url: string, subirExistentes: boolean) => void;
}) {
  const [url, setUrl] = useState(() => (calendarios.find((c) => /familia/i.test(c.nombre)) ?? calendarios[0]).url);
  const [subir, setSubir] = useState(true);
  return (
    <Modal
      titulo="Elegir el calendario de la familia"
      alCerrar={alCerrar}
      ancho="max-w-lg"
      pie={
        <>
          <Boton variante="fantasma" onClick={alCerrar}>
            Cancelar
          </Boton>
          <Boton variante="primario" disabled={ocupado} onClick={() => alConectar(url, subir)}>
            {ocupado ? "Conectando…" : "Conectar"}
          </Boton>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-2" role="radiogroup" aria-label="Calendario">
          {calendarios.map((c) => (
            <button
              key={c.url}
              type="button"
              role="radio"
              aria-checked={url === c.url}
              onClick={() => setUrl(c.url)}
              className={cx(
                "flex min-h-14 w-full items-center gap-3 rounded-2xl px-4 text-left text-lg font-bold transition",
                url === c.url ? "bg-acento text-acento-tinta" : "bg-superficie-2",
              )}
            >
              <span className="size-4 shrink-0 rounded-full" style={{ background: c.color ?? "#9AA0A6" }} aria-hidden />
              {c.nombre}
            </button>
          ))}
        </div>
        <p className="text-base text-tinta-suave">
          Conviene un calendario sólo para la familia (“Familia”), compartido desde iCloud con cada integrante con permiso para editar.
        </p>
        <SubirExistentes n={sinVincular} subir={subir} alCambiar={setSubir} />
      </div>
    </Modal>
  );
}
