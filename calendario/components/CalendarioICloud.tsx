"use client";

// Familia → "Calendario del iPhone": conectar el calendario "Familia" de iCloud (en ambos sentidos),
// ver cómo va la sincronización y resolver cuando se borraría mucho de una vez.

import { useCallback, useEffect, useState } from "react";
import { useDatos } from "@/lib/store";
import { AccesoRevocado, SinConexion, api, leerSesion } from "@/lib/datos/nube";
import { Boton, Casilla, Modal, cx } from "./ui";

interface EstadoSync {
  ultima?: string;
  intento?: string;
  error: { mensaje: string; codigo?: string; cuando: string; cuantos?: number } | null;
  resumen?: { traidos: number; subidos: number; borradosAqui: number; borradosAlla: number };
  pendiente: boolean;
  avisos: string[];
}

interface Conexion {
  id: string;
  nombre: string;
  color?: string;
  eventos: number;
  estado: EstadoSync | null;
}

interface Info {
  servidor: { icloud: boolean; usuario?: string; otraFamilia: boolean };
  conexiones: Conexion[];
}

interface CalendarioRemoto {
  url: string;
  nombre: string;
  color?: string;
}

function hace(iso?: string): string {
  if (!iso) return "nunca";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `hace ${h} h` : `hace ${Math.round(h / 24)} días`;
}

const mensajeDe = (e: unknown, def: string) =>
  e instanceof SinConexion ? "No hay conexión con la nube. Revisa el wifi e inténtalo de nuevo." : e instanceof AccesoRevocado ? e.message : def;

export function SeccionICloud() {
  const { nube, estado } = useDatos();
  const sesion = leerSesion();
  const [info, setInfo] = useState<Info | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [eligiendo, setEligiendo] = useState<CalendarioRemoto[] | null>(null);
  const [desconectar, setDesconectar] = useState<Conexion | null>(null);

  const cargar = useCallback(async () => {
    if (!sesion) return;
    try {
      const { status, datos } = await api<Info & { error?: string }>("/api/calendario", { token: sesion.token });
      if (status === 200) setInfo(datos);
      else setMsg(datos.error ?? "No se pudo ver el estado del calendario.");
    } catch (e) {
      setMsg(mensajeDe(e, "No se pudo ver el estado del calendario."));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (!nube || !sesion) {
    return (
      <div className="rounded-3xl bg-superficie p-4">
        <h2 className="mb-1 text-xl font-extrabold">📅 Calendario del iPhone (iCloud)</h2>
        <p className="text-base text-tinta-suave">
          Para conectar el calendario de iCloud, primero comparte este equipo con la familia (aquí arriba).
        </p>
      </div>
    );
  }

  const pedir = async <T,>(ruta: string, cuerpo: unknown = {}) => {
    setOcupado(true);
    setMsg(null);
    try {
      return await api<T & { error?: string }>(ruta, { metodo: "POST", cuerpo, token: sesion.token, espera: 20_000 });
    } catch (e) {
      setMsg(mensajeDe(e, "No se pudo hablar con el servidor."));
      return null;
    } finally {
      setOcupado(false);
    }
  };

  const buscarCalendarios = async () => {
    const r = await pedir<{ calendarios: CalendarioRemoto[] }>("/api/calendario/calendarios");
    if (!r) return;
    if (r.status !== 200) return setMsg(r.datos.error ?? "No se pudieron ver los calendarios de iCloud.");
    if (!r.datos.calendarios.length) return setMsg("La cuenta de iCloud no tiene calendarios. Crea “Familia” en iCloud.com → Calendario.");
    setEligiendo(r.datos.calendarios);
  };

  const sincronizar = async (resolver?: "borrar" | "recuperar") => {
    const r = await pedir<{ resultados: { ok: boolean; ocupado?: boolean; error?: { mensaje: string } }[] }>(
      "/api/calendario/sincronizar",
      resolver ? { resolver } : {},
    );
    if (r?.status === 200 && r.datos.resultados[0]?.ocupado) setMsg("Ya se estaba sincronizando: en un momento queda al día.");
    await cargar();
    nube?.revisar();
  };

  const quitar = async (c: Conexion) => {
    const r = await pedir("/api/calendario/desconectar", { id: c.id });
    setDesconectar(null);
    if (r && r.status !== 200) setMsg(r.datos.error ?? "No se pudo desconectar.");
    await cargar();
    nube?.revisar();
  };

  const conexion = info?.conexiones[0];
  const e = conexion?.estado;
  const sinVincular = estado.eventos.filter((x) => !x.externo && !x.soloPanel).length;

  return (
    <div className="rounded-3xl bg-superficie p-4">
      <h2 className="mb-1 text-xl font-extrabold">📅 Calendario del iPhone (iCloud)</h2>
      {!info && !msg && <p className="text-base text-tinta-suave">Cargando…</p>}

      {info && !info.servidor.icloud && <Instrucciones />}

      {info?.servidor.icloud && info.servidor.otraFamilia && (
        <p className="text-lg">La cuenta de iCloud del panel ya está conectada a otra familia en este sitio.</p>
      )}

      {info?.servidor.icloud && !info.servidor.otraFamilia && !conexion && (
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
        <>
          <p className="mb-1 text-lg">
            Conectado a <strong>«{conexion.nombre}»</strong> de iCloud
            {info?.servidor.usuario && <span className="text-tinta-suave"> ({info.servidor.usuario})</span>}
          </p>
          <p className="mb-3 text-base text-tinta-suave">
            {conexion.eventos} eventos en los dos lados · última sincronización: {hace(e?.ultima)}
            {e?.pendiente && " · quedan cambios por pasar (sigue sola en unos minutos)"}. Se revisa cada 5 minutos y al guardar un
            evento.
          </p>
          {e?.error && <ErrorSync error={e.error} ocupado={ocupado} alResolver={sincronizar} />}
          {!!e?.avisos.length && (
            <ul className="mb-3 list-disc space-y-1 pl-6 text-base text-tinta-suave">
              {e.avisos.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <Boton variante="primario" disabled={ocupado} onClick={() => sincronizar()}>
              {ocupado ? "Sincronizando…" : "🔄 Sincronizar ahora"}
            </Boton>
            <Boton variante="fantasma" disabled={ocupado} onClick={() => setDesconectar(conexion)}>
              Desconectar
            </Boton>
          </div>
          <details className="mt-4 rounded-2xl bg-superficie-2 px-4 py-3 text-base">
            <summary className="cursor-pointer text-lg font-bold">¿Cómo se sabe para quién es un evento del iPhone?</summary>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>
                Con el emoji de la persona al inicio del título:{" "}
                <strong>
                  {estado.miembros[0]?.emoji ?? "🦄"} Dentista
                </strong>
                . Así quedan los eventos que se crean en la pared.
              </li>
              <li>
                O con el nombre en el título (“Fútbol {estado.miembros[0]?.nombre ?? "Sofía"}”) o <strong>@{estado.miembros[0]?.nombre ?? "Sofía"}</strong>{" "}
                en la nota.
              </li>
              <li>Sin nada de eso, el evento es para todos.</li>
              <li>Si se cambia lo mismo en los dos lados a la vez, queda el cambio más reciente.</li>
            </ul>
          </details>
        </>
      )}

      {msg && <p className="mt-3 text-lg font-bold">{msg}</p>}

      {eligiendo && (
        <ElegirCalendario
          calendarios={eligiendo}
          sinVincular={sinVincular}
          alCerrar={() => setEligiendo(null)}
          alConectar={async (url, subirExistentes) => {
            const r = await pedir<{ resultado?: { ok: boolean; error?: { mensaje: string } } }>("/api/calendario/conectar", {
              url,
              subirExistentes,
            });
            setEligiendo(null);
            if (r && r.status !== 200) setMsg(r.datos.error ?? "No se pudo conectar el calendario.");
            else if (r?.datos.resultado && !r.datos.resultado.ok) setMsg(r.datos.resultado.error?.mensaje ?? "La primera sincronización falló.");
            await cargar();
            nube?.revisar();
          }}
          ocupado={ocupado}
        />
      )}

      {desconectar && (
        <Modal
          titulo={`¿Desconectar «${desconectar.nombre}»?`}
          alCerrar={() => setDesconectar(null)}
          ancho="max-w-md"
          pie={
            <>
              <Boton variante="fantasma" onClick={() => setDesconectar(null)}>
                Cancelar
              </Boton>
              <Boton variante="peligro" disabled={ocupado} onClick={() => quitar(desconectar)}>
                Desconectar
              </Boton>
            </>
          }
        >
          <p className="text-lg">
            Los eventos quedan en la pared y en iCloud, pero los cambios ya no pasan de un lado al otro. Si se vuelve a conectar, se
            reconocen y no se duplican.
          </p>
        </Modal>
      )}
    </div>
  );
}

function ErrorSync({
  error,
  ocupado,
  alResolver,
}: {
  error: NonNullable<EstadoSync["error"]>;
  ocupado: boolean;
  alResolver: (r: "borrar" | "recuperar") => void;
}) {
  const masivo = error.codigo === "MUCHOS_BORRADOS_PANEL" || error.codigo === "MUCHOS_BORRADOS_ICLOUD";
  return (
    <div role="alert" className="mb-3 rounded-2xl bg-red-600/15 px-4 py-3 text-red-800 noche:text-red-200">
      <p className="text-lg font-bold">
        {masivo ? "⚠️ " : "⚠️ No se pudo sincronizar: "}
        {error.mensaje}
      </p>
      {error.codigo === "CLAVE" && (
        <p className="mt-1 text-base">
          Revisa ICLOUD_USUARIO e ICLOUD_CLAVE_APP en Netlify (la contraseña de app se puede revocar en account.apple.com; si se
          crea otra, hay que cambiarla allá y volver a publicar).
        </p>
      )}
      {masivo && (
        <div className="mt-2 flex flex-wrap gap-2">
          <Boton variante="peligro" disabled={ocupado} onClick={() => alResolver("borrar")}>
            {error.codigo === "MUCHOS_BORRADOS_PANEL" ? "Sí, borrarlos también de los iPhone" : "Sí, borrarlos también de la pared"}
          </Boton>
          <Boton variante="primario" disabled={ocupado} onClick={() => alResolver("recuperar")}>
            {error.codigo === "MUCHOS_BORRADOS_PANEL" ? "No, traerlos de vuelta desde iCloud" : "No, volver a subirlos a iCloud"}
          </Boton>
        </div>
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
        {sinVincular > 0 && (
          <button
            type="button"
            role="switch"
            aria-checked={subir}
            onClick={() => setSubir(!subir)}
            className="flex min-h-14 w-full items-center gap-3 rounded-2xl bg-superficie-2 px-4 text-left"
          >
            <Casilla marcada={subir} />
            <span className="flex-1">
              <span className="block text-lg font-bold">Subir los {sinVincular} eventos que ya están en la pared</span>
              <span className="block text-base text-tinta-suave">
                {subir ? "Aparecen también en los iPhone." : "Quedan sólo en la pared (se puede cambiar en cada evento)."}
              </span>
            </span>
          </button>
        )}
      </div>
    </Modal>
  );
}

function Instrucciones() {
  return (
    <div className="space-y-2 text-base">
      <p className="text-lg">
        Para que la pared y el Calendario de los iPhone compartan los eventos (en ambos sentidos), falta preparar la cuenta de iCloud del
        panel. Se hace una sola vez:
      </p>
      <ol className="list-decimal space-y-1.5 pl-6">
        <li>
          <strong>Apple ID del panel</strong>: uno nuevo, sólo para esto, en account.apple.com.
        </li>
        <li>
          <strong>Calendario “Familia”</strong>: con ese Apple ID, en iCloud.com → Calendario, créalo y compártelo con el Apple ID de
          cada integrante, con permiso para editar.
        </li>
        <li>
          <strong>Contraseña de app</strong>: en account.apple.com → Inicio de sesión y seguridad → Contraseñas de app → crear una
          llamada “Panel”. No la escribas aquí ni en el chat.
        </li>
        <li>
          <strong>En Netlify</strong> (proyecto del panel) → Project configuration → Environment variables: agrega{" "}
          <code className="rounded bg-superficie-2 px-1">ICLOUD_USUARIO</code> (el Apple ID) e{" "}
          <code className="rounded bg-superficie-2 px-1">ICLOUD_CLAVE_APP</code> (la contraseña de app), marcadas como secretas si se
          puede. Después hay que volver a publicar el sitio para que las tome.
        </li>
      </ol>
    </div>
  );
}
