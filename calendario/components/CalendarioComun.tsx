"use client";

// Lo común de las secciones de calendario conectado en Familia (Google Calendar e iCloud): el estado
// que manda GET /api/calendario (compartido por las dos secciones: un solo pedido y se refrescan
// juntas), cómo va la sincronización, el aviso cuando se borraría mucho de una vez, desconectar y las
// reglas de "para quién es" un evento del iPhone.

import { useEffect, useState, type ReactNode } from "react";
import { useDatos } from "@/lib/store";
import { AccesoRevocado, SinConexion, api, leerSesion } from "@/lib/datos/nube";
import type { RolAdulto } from "@/lib/datos/repositorio";
import { Boton, Casilla, Modal } from "./ui";

export type NombreProveedor = "iCloud" | "Google Calendar";

export interface EstadoSync {
  ultima?: string;
  intento?: string;
  error: { mensaje: string; codigo?: string; cuando: string; cuantos?: number; uids?: string[] } | null;
  resumen?: { traidos: number; subidos: number; borradosAqui: number; borradosAlla: number };
  pendiente: boolean;
  avisos: string[];
  /** Una respuesta a un aviso anotada, que se aplica en cuanto el calendario alcance a responder. */
  respuesta?: "borrar" | "recuperar" | null;
}

export interface Adulto {
  nombre: string;
  correo: string;
  rol: RolAdulto;
  miembroId?: string;
}

export interface Conexion {
  id: string;
  proveedor: "icloud" | "google";
  nombre: string;
  color?: string;
  eventos: number;
  estado: EstadoSync | null;
  /** Sólo google: el ID del calendario y su dueño. */
  calendarioId?: string;
  dueno?: Adulto | null;
}

export interface InfoGoogle {
  configurado: boolean;
  /** Correo de la cuenta de servicio (con él se comparte el calendario). */
  correo?: string;
  /** La clave guardada en Netlify no se pudo leer: por qué (nunca trae la clave). */
  problema?: string;
  otraFamilia: boolean;
}

export interface Info {
  servidor: { icloud: boolean; usuario?: string; otraFamilia: boolean; google?: InfoGoogle };
  conexiones: Conexion[];
}

export const esICloud = (c: Conexion) => c.proveedor !== "google";

export const ROL_TEXTO: Record<RolAdulto, string> = { madre: "Madre", padre: "Padre", adulto: "Otro adulto" };

export function hace(iso?: string): string {
  if (!iso) return "nunca";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `hace ${h} h` : `hace ${Math.round(h / 24)} días`;
}

export const mensajeDe = (e: unknown, def: string) =>
  e instanceof SinConexion ? "No hay conexión con la nube. Revisa el wifi e inténtalo de nuevo." : e instanceof AccesoRevocado ? e.message : def;

// ---------- Estado compartido (GET /api/calendario) ----------

const memo: { info: Info | null; error: string | null; enCurso: Promise<void> | null } = { info: null, error: null, enCurso: null };
const oyentes = new Set<() => void>();

/** Vuelve a pedir el estado (si ya hay un pedido en curso, espera ese). */
export function cargarInfoCalendario(): Promise<void> {
  if (memo.enCurso) return memo.enCurso;
  const sesion = leerSesion();
  if (!sesion) return Promise.resolve();
  memo.enCurso = (async () => {
    try {
      const { status, datos } = await api<Info & { error?: string }>("/api/calendario", { token: sesion.token });
      if (status === 200) {
        memo.info = datos;
        memo.error = null;
      } else memo.error = datos.error ?? "No se pudo ver el estado del calendario.";
    } catch (e) {
      memo.error = mensajeDe(e, "No se pudo ver el estado del calendario.");
    } finally {
      memo.enCurso = null;
      oyentes.forEach((f) => f());
    }
  })();
  return memo.enCurso;
}

/** El estado de los calendarios conectados, el mismo para todas las secciones (se pide al mostrarse). */
export function useInfoCalendario(): { info: Info | null; error: string | null; cargar: () => Promise<void> } {
  const [, setVersion] = useState(0);
  useEffect(() => {
    const f = () => setVersion((v) => v + 1);
    oyentes.add(f);
    void cargarInfoCalendario();
    return () => {
      oyentes.delete(f);
    };
  }, []);
  return { info: memo.info, error: memo.error, cargar: cargarInfoCalendario };
}

/** Pedidos POST (o GET) a /api/calendario/* con "ocupado" y el mensaje para mostrar. */
export function usePedido() {
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<ReactNode>(null);
  const pedir = async <T,>(ruta: string, cuerpo: unknown = {}, metodo: "GET" | "POST" = "POST") => {
    const sesion = leerSesion();
    if (!sesion) return null;
    setOcupado(true);
    setMsg(null);
    try {
      return await api<T & { error?: string; codigo?: string }>(ruta, {
        metodo,
        cuerpo: metodo === "POST" ? cuerpo : undefined,
        token: sesion.token,
        espera: 20_000,
      });
    } catch (e) {
      setMsg(mensajeDe(e, "No se pudo hablar con el servidor."));
      return null;
    } finally {
      setOcupado(false);
    }
  };
  return { ocupado, msg, setMsg, pedir };
}

// ---------- Conectado: estado, avisos, sincronizar y desconectar ----------

export function EstadoConexion({
  conexion,
  proveedor,
  encabezado,
  ayudas,
  children,
}: {
  conexion: Conexion;
  proveedor: NombreProveedor;
  encabezado: ReactNode;
  /** Ayuda bajo el error según su código (CLAVE, CONFIGURACION, PERMISO…). */
  ayudas: Partial<Record<string, ReactNode>>;
  children?: ReactNode;
}) {
  const { nube } = useDatos();
  const { ocupado, msg, setMsg, pedir } = usePedido();
  const [desconectar, setDesconectar] = useState(false);
  const e = conexion.estado;

  const sincronizar = async (resolver?: "borrar" | "recuperar") => {
    // Con la respuesta va el aviso que se estaba viendo (y sus eventos): si mientras tanto cambió, no se
    // aplica a ciegas.
    const error = e?.error;
    const r = await pedir<{
      resultados: { id: string; ok: boolean; ocupado?: boolean; error?: { mensaje: string; codigo?: string }; respuesta?: "aplicada" | "anotada" | "vieja" | "sinAviso" }[];
    }>("/api/calendario/sincronizar", resolver ? { resolver, codigo: error?.codigo, uids: error?.uids } : {});
    const res = r?.status === 200 ? (r.datos.resultados.find((x) => x.id === conexion.id) ?? r.datos.resultados[0]) : undefined;
    if (resolver && res?.respuesta === "anotada")
      setMsg(
        res.ocupado
          ? "Respuesta anotada: se estaba sincronizando, así que se aplica sola en la próxima sincronización (unos minutos)."
          : `Respuesta anotada: ${proveedor} está lento, así que se aplica sola en la próxima sincronización (unos minutos).`,
      );
    else if (res?.ocupado)
      setMsg(
        resolver
          ? "Se estaba sincronizando y la respuesta no alcanzó a pasar: vuelve a tocar el botón en unos segundos."
          : "Ya se estaba sincronizando: en un momento queda al día.",
      );
    else if (resolver && res?.respuesta === "vieja" && res.error?.codigo?.startsWith("MUCHOS_BORRADOS_"))
      setMsg("Mientras tanto se borraron otros eventos, así que no se borró nada todavía: revisa el aviso de nuevo.");
    else if (resolver && res?.respuesta === "sinAviso") setMsg("Ese aviso ya se había resuelto (desde otro equipo, por ejemplo).");
    await cargarInfoCalendario();
    nube?.revisar();
  };

  const quitar = async () => {
    const r = await pedir("/api/calendario/desconectar", { id: conexion.id });
    setDesconectar(false);
    if (r && r.status !== 200) setMsg(r.datos.error ?? "No se pudo desconectar.");
    await cargarInfoCalendario();
    nube?.revisar();
  };

  return (
    <>
      {encabezado}
      <p className="mb-3 text-base text-tinta-suave">
        {conexion.eventos} eventos en los dos lados · última sincronización: {hace(e?.ultima)}
        {e?.pendiente && " · quedan cambios por pasar (sigue sola en unos minutos)"}. Se revisa cada 5 minutos y al guardar un evento.
      </p>
      {e?.error && (
        <ErrorSync error={e.error} respuesta={e.respuesta ?? null} ocupado={ocupado} alResolver={sincronizar} proveedor={proveedor} ayudas={ayudas} />
      )}
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
        <Boton variante="fantasma" disabled={ocupado} onClick={() => setDesconectar(true)}>
          Desconectar
        </Boton>
      </div>
      {msg && <p className="mt-3 text-lg font-bold">{msg}</p>}
      {children}

      {desconectar && (
        <Modal
          titulo={`¿Desconectar «${conexion.nombre}»?`}
          alCerrar={() => setDesconectar(false)}
          ancho="max-w-md"
          pie={
            <>
              <Boton variante="fantasma" onClick={() => setDesconectar(false)}>
                Cancelar
              </Boton>
              <Boton variante="peligro" disabled={ocupado} onClick={quitar}>
                Desconectar
              </Boton>
            </>
          }
        >
          <p className="text-lg">
            Los eventos quedan en la pared y en {proveedor}, pero los cambios ya no pasan de un lado al otro. Si se vuelve a conectar, se
            reconocen y no se duplican.
          </p>
        </Modal>
      )}
    </>
  );
}

export function ErrorSync({
  error,
  respuesta,
  ocupado,
  alResolver,
  proveedor,
  ayudas,
}: {
  error: NonNullable<EstadoSync["error"]>;
  respuesta: "borrar" | "recuperar" | null;
  ocupado: boolean;
  alResolver: (r: "borrar" | "recuperar") => void;
  proveedor: NombreProveedor;
  ayudas: Partial<Record<string, ReactNode>>;
}) {
  const masivo = error.codigo === "MUCHOS_BORRADOS_PANEL" || error.codigo === "MUCHOS_BORRADOS_ICLOUD";
  const ayuda = error.codigo ? ayudas[error.codigo] : undefined;
  return (
    <div role="alert" className="mb-3 rounded-2xl bg-red-600/15 px-4 py-3 text-red-800 noche:text-red-200">
      <p className="text-lg font-bold">
        {masivo ? "⚠️ " : "⚠️ No se pudo sincronizar: "}
        {error.mensaje}
      </p>
      {ayuda && <p className="mt-1 text-base">{ayuda}</p>}
      {masivo && respuesta && (
        <p className="mt-1 text-base">
          Respuesta anotada ({respuesta === "borrar" ? "borrarlos" : "traerlos de vuelta"}): se aplica sola en cuanto {proveedor} responda.
        </p>
      )}
      {masivo && !respuesta && (
        <div className="mt-2 flex flex-wrap gap-2">
          <Boton variante="peligro" disabled={ocupado} onClick={() => alResolver("borrar")}>
            {error.codigo === "MUCHOS_BORRADOS_PANEL" ? "Sí, borrarlos también de los iPhone" : "Sí, borrarlos también de la pared"}
          </Boton>
          <Boton variante="primario" disabled={ocupado} onClick={() => alResolver("recuperar")}>
            {error.codigo === "MUCHOS_BORRADOS_PANEL" ? `No, traerlos de vuelta desde ${proveedor}` : `No, volver a subirlos a ${proveedor}`}
          </Boton>
        </div>
      )}
    </div>
  );
}

/** "Subir los N eventos que ya están en la pared" (al conectar). */
export function SubirExistentes({ n, subir, alCambiar }: { n: number; subir: boolean; alCambiar: (v: boolean) => void }) {
  if (n <= 0) return null;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={subir}
      onClick={() => alCambiar(!subir)}
      className="flex min-h-14 w-full items-center gap-3 rounded-2xl bg-superficie-2 px-4 text-left"
    >
      <Casilla marcada={subir} />
      <span className="flex-1">
        <span className="block text-lg font-bold">Subir los {n} eventos que ya están en la pared</span>
        <span className="block text-base text-tinta-suave">
          {subir ? "Aparecen también en los iPhone." : "Quedan sólo en la pared (se puede cambiar en cada evento)."}
        </span>
      </span>
    </button>
  );
}

/** Cómo se sabe para quién es un evento que llega del iPhone (lo mismo con los dos proveedores). */
export function ReglasPersonas() {
  const { estado } = useDatos();
  return (
    <>
      <li>
        Con el emoji de la persona al inicio del título: <strong>{estado.miembros[0]?.emoji ?? "🦄"} Dentista</strong>. Así quedan los
        eventos que se crean en la pared.
      </li>
      <li>
        O con el nombre en el título (“Fútbol {estado.miembros[0]?.nombre ?? "Sofía"}”) o <strong>@{estado.miembros[0]?.nombre ?? "Sofía"}</strong> en
        la nota.
      </li>
      <li>Sin nada de eso, el evento es para todos.</li>
      <li>Si se cambia lo mismo en los dos lados a la vez, queda el cambio más reciente.</li>
    </>
  );
}
