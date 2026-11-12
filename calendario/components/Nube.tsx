"use client";

// Compartir los datos entre equipos: crear la familia en la nube, invitar con un código (o un QR que
// se escanea con la cámara del iPhone) y unirse.

import { useEffect, useRef, useState } from "react";
import qrcode from "qrcode-generator";
import { useDatos } from "@/lib/store";
import {
  AccesoRevocado,
  SinConexion,
  anotarRecienUnido,
  api,
  borrarSesion,
  esIconoDeInicioIOS,
  guardarSesion,
  leerSesion,
  nombreDeEsteEquipo,
} from "@/lib/datos/nube";
import { descargarRespaldo } from "@/lib/respaldo";
import { TEXTOS } from "@/lib/dictados/textos";
import { Boton, Entrada, Modal, claseInput, cx } from "./ui";

const SIN_RED = "No hay conexión con la nube. Revisa el wifi e inténtalo de nuevo.";
const formatoCodigo = (c: string) => (c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c);
const limpiarCodigo = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);

function mensajeDe(e: unknown, def: string) {
  if (e instanceof SinConexion) return SIN_RED;
  if (e instanceof AccesoRevocado) return e.message;
  return def;
}

/** Dónde se pide un código nuevo (en un equipo que ya está unido). */
export const DONDE_INVITAR = "⚙️\u00a0Familia → Compartir entre equipos → Invitar otro equipo";

/**
 * Para la app abierta desde el ícono de la pantalla de inicio del iPhone o iPad (esIconoDeInicioIOS):
 * guarda sus datos aparte de Safari, así que unirse con el QR de la Cámara (que abre Safari) no la une.
 */
export function textoIconoIOS(): string {
  return `En el ${equipoIOS()}, el ícono de la pantalla de inicio no comparte lo de Safari: aunque te hayas unido en Safari, aquí hay que unirse de nuevo. Pide un código nuevo en otro equipo (${DONDE_INVITAR}) y escríbelo aquí.`;
}

/** textoIconoIOS en una línea: para la franja de arriba (el texto largo queda en «Unirme con un código»). */
export function textoIconoCorto(): string {
  return `En el ${equipoIOS()}, el ícono no comparte lo de Safari: únete aquí con un código nuevo.`;
}

/** El resto de textoIconoIOS, para el «¿Por qué?» de la franja (va después de textoIconoCorto). */
export function textoIconoPorQue(): string {
  return `Aunque te hayas unido en Safari, aquí hay que unirse de nuevo: el ícono funciona como otro equipo y no ve lo que se hizo en Safari. El código nuevo se pide en un equipo ya unido (${DONDE_INVITAR}) y se escribe aquí.`;
}

const equipoIOS = () => (nombreDeEsteEquipo() === "iPad" ? "iPad" : "iPhone");

/** El QR de un texto (una dirección), como SVG. */
function svgQR(texto: string): string {
  const q = qrcode(0, "M");
  q.addData(texto);
  q.make();
  return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
}

/** El campo del código de invitación (ABCD-2345) con su botón. */
function FormularioCodigo({
  valor,
  alCambiar,
  alEnviar,
  etiqueta,
  enfocar,
}: {
  valor: string;
  alCambiar: (v: string) => void;
  alEnviar: (codigo: string) => void;
  etiqueta: string;
  enfocar?: boolean;
}) {
  const limpio = limpiarCodigo(valor);
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (limpio.length === 8) alEnviar(limpio);
      }}
    >
      <span className="w-full text-base font-bold text-tinta-suave">{etiqueta}</span>
      <Entrada
        value={formatoCodigo(limpio)}
        onChange={(e) => alCambiar(e.target.value)}
        placeholder="ABCD-2345"
        aria-label="Código de invitación"
        autoCapitalize="characters"
        autoComplete="off"
        autoFocus={enfocar}
        className="num max-w-56 text-center text-2xl tracking-widest"
      />
      <Boton type="submit" variante={enfocar ? "primario" : "suave"} disabled={limpio.length !== 8}>
        Unirme
      </Boton>
    </form>
  );
}

/** «Unirme con un código» del aviso de arriba: escribir el código y después confirmar (UnirseModal). */
export function UnirseConCodigoModal({ alCerrar }: { alCerrar: () => void }) {
  const [escrito, setEscrito] = useState("");
  const [codigo, setCodigo] = useState<string | null>(null);
  const [icono] = useState(esIconoDeInicioIOS);
  // Con «Cancelar» (p. ej. el código estaba mal escrito) se vuelve a este paso con lo escrito.
  if (codigo) return <UnirseModal codigo={codigo} alCerrar={() => setCodigo(null)} />;
  return (
    <Modal titulo="Unirme a la familia" alCerrar={alCerrar} ancho="max-w-lg">
      <div className="space-y-4 text-lg">
        {icono ? (
          <>
            <p className="rounded-2xl bg-acento-suave px-4 py-3">{textoIconoIOS()}</p>
            <p className="text-base text-tinta-suave">
              Si ya te uniste en Safari en este {equipoIOS()}, el código lo puedes pedir ahí mismo y volver al ícono a escribirlo.
            </p>
          </>
        ) : (
          <p>
            Pide el código en un equipo que ya esté unido a la familia: <strong>{DONDE_INVITAR}</strong>. Sirve una vez y vence en
            24 horas.
          </p>
        )}
        <FormularioCodigo valor={escrito} alCambiar={setEscrito} alEnviar={setCodigo} etiqueta="El código que muestra el otro equipo:" enfocar />
      </div>
    </Modal>
  );
}

/** Sección de Familia → "Compartir entre equipos". */
export function SeccionNube() {
  const { nube } = useDatos();
  return (
    <div className="rounded-3xl bg-superficie p-4">
      <h2 className="mb-1 text-xl font-extrabold">☁️ Compartir entre equipos</h2>
      {nube ? <FamiliaConectada /> : <Conectar />}
    </div>
  );
}

function Conectar() {
  const { estado } = useDatos();
  const [creando, setCreando] = useState(false);
  const [codigo, setCodigo] = useState("");
  const [uniendo, setUniendo] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [icono] = useState(esIconoDeInicioIOS);

  const crear = async () => {
    setOcupado(true);
    setMsg(null);
    try {
      const { status, datos } = await api<{ token?: string; equipoId?: string; familia?: { id: string; nombre: string }; error?: string }>(
        "/api/familia",
        { metodo: "POST", cuerpo: { nombre: estado.ajustes.nombreFamilia, nombreEquipo: nombreDeEsteEquipo() } },
      );
      if (status !== 201 || !datos.token) {
        setCreando(false);
        return setMsg(datos.error ?? "No se pudo crear la familia.");
      }
      // Se guarda la conexión al tiro (si se corta, al volver a abrir termina de subir los datos).
      guardarSesion({ token: datos.token, equipoId: datos.equipoId!, familia: datos.familia!, pendienteSubir: true });
      anotarRecienUnido("creada");
      location.reload();
    } catch (e) {
      setMsg(mensajeDe(e, "No se pudo crear la familia."));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <>
      <p className="mb-3 text-base text-tinta-suave">
        Hoy los datos viven sólo en este equipo. Conéctalo a la nube para que el iPhone, el iPad y la pantalla de la pared
        vean y cambien lo mismo.
      </p>
      {icono && <p className="mb-3 rounded-2xl bg-acento-suave px-4 py-3 text-lg">{textoIconoIOS()}</p>}
      <div className="flex flex-wrap gap-3">
        <Boton variante="primario" onClick={() => setCreando(true)}>
          ☁️ Crear la familia en la nube
        </Boton>
      </div>
      <div className="mt-4">
        <FormularioCodigo
          valor={codigo}
          alCambiar={setCodigo}
          alEnviar={setUniendo}
          etiqueta="¿Ya hay una familia? Únete con el código que muestra otro equipo:"
        />
      </div>
      {msg && <p className="mt-3 text-lg font-bold">{msg}</p>}

      {creando && (
        <Modal
          titulo="Crear la familia en la nube"
          alCerrar={() => setCreando(false)}
          ancho="max-w-lg"
          pie={
            <>
              <Boton variante="fantasma" onClick={() => setCreando(false)}>
                Cancelar
              </Boton>
              <Boton variante="primario" disabled={ocupado} onClick={crear}>
                {ocupado ? "Creando…" : "Crear y subir"}
              </Boton>
            </>
          }
        >
          <div className="space-y-3 text-lg">
            <p>
              Se suben los datos de este equipo: integrantes, eventos, menú, recetas (con sus fotos), compras, quehaceres y
              premios.
            </p>
            <p>Después, desde aquí mismo, invitas a los demás equipos con un código o un QR.</p>
          </div>
        </Modal>
      )}
      {uniendo && <UnirseModal codigo={uniendo} alCerrar={() => setUniendo(null)} />}
    </>
  );
}

/** Confirmar la unión a una familia (con el código escrito o desde el enlace del QR). */
export function UnirseModal({ codigo, alCerrar }: { codigo: string; alCerrar: () => void }) {
  const { estado, nube } = useDatos();
  const [familia, setFamilia] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (nube) return;
    let vivo = true;
    api<{ familia?: { nombre: string }; error?: string }>(`/api/unirse?codigo=${encodeURIComponent(codigo)}`)
      .then(({ status, datos }) => vivo && (status === 200 && datos.familia ? setFamilia(datos.familia.nombre) : setMsg(datos.error ?? "Ese código no sirve.")))
      .catch((e) => vivo && setMsg(mensajeDe(e, "Ese código no sirve.")));
    return () => {
      vivo = false;
    };
  }, [codigo, nube]);

  const unirse = async () => {
    setOcupado(true);
    try {
      const { status, datos } = await api<{ token?: string; equipoId?: string; familia?: { id: string; nombre: string }; error?: string }>(
        "/api/unirse",
        { metodo: "POST", cuerpo: { codigo, nombreEquipo: nombreDeEsteEquipo() } },
      );
      if (status !== 201 || !datos.token) return setMsg(datos.error ?? "No se pudo unir este equipo.");
      guardarSesion({ token: datos.token, equipoId: datos.equipoId!, familia: datos.familia! });
      anotarRecienUnido("unido");
      location.reload();
    } catch (e) {
      setMsg(mensajeDe(e, "No se pudo unir este equipo."));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Modal
      titulo="Unir este equipo"
      alCerrar={alCerrar}
      ancho="max-w-lg"
      pie={
        <>
          <Boton variante="fantasma" onClick={alCerrar}>
            {nube ? "Cerrar" : "Cancelar"}
          </Boton>
          {!nube && (
            <Boton variante="primario" disabled={!familia || ocupado} onClick={unirse}>
              {ocupado ? "Uniendo…" : "Unirme"}
            </Boton>
          )}
        </>
      }
    >
      {nube ? (
        <p className="text-lg">
          Este equipo ya está conectado a «{nube.familia.nombre}». Para unirlo a otra familia, primero desconéctalo en Familia →
          Compartir entre equipos.
        </p>
      ) : msg ? (
        <p className="text-lg font-bold">{msg}</p>
      ) : !familia ? (
        <p className="text-lg text-tinta-suave">Buscando la familia…</p>
      ) : (
        <div className="space-y-4 text-lg">
          <p>
            Este equipo va a ver y cambiar los datos de <strong>«{familia}»</strong>.
          </p>
          <p className="rounded-2xl bg-acento-suave px-4 py-3">
            Lo que hay ahora en este equipo se reemplaza por lo de la familia. Si quieres guardarlo, descarga una copia antes.
          </p>
          <Boton onClick={() => descargarRespaldo(estado)}>⬇️ Descargar una copia de este equipo</Boton>
        </div>
      )}
    </Modal>
  );
}

interface EquipoLista {
  id: string;
  nombre: string;
  creado: string;
  esEste: boolean;
}

function FamiliaConectada() {
  const { nube } = useDatos();
  const [equipos, setEquipos] = useState<EquipoLista[] | null>(null);
  const [invitando, setInvitando] = useState(false);
  const [quitar, setQuitar] = useState<EquipoLista | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [vuelta, setVuelta] = useState(0);
  const sesion = leerSesion();

  useEffect(() => {
    if (!sesion) return;
    let vivo = true;
    api<{ equipos: EquipoLista[] }>("/api/equipos", { token: sesion.token })
      .then(({ status, datos }) => vivo && status === 200 && setEquipos(datos.equipos))
      .catch((e) => vivo && setMsg(mensajeDe(e, "No se pudo ver la lista de equipos.")));
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vuelta]);

  const sacar = async (e: EquipoLista) => {
    if (!sesion) return;
    try {
      const { status } = await api(`/api/equipos/${e.id}`, { metodo: "DELETE", token: sesion.token });
      if (e.esEste || status === 200) {
        if (e.esEste) {
          borrarSesion();
          location.reload();
          return;
        }
        setQuitar(null);
        setVuelta((n) => n + 1);
      }
    } catch (err) {
      if (e.esEste && err instanceof AccesoRevocado) {
        borrarSesion();
        location.reload();
        return;
      }
      setMsg(mensajeDe(err, "No se pudo quitar el acceso."));
      setQuitar(null);
    }
  };

  if (!nube) return null;
  return (
    <>
      <p className="mb-3 text-lg">
        Conectado a <strong>«{nube.familia.nombre}»</strong>{" "}
        <span className={cx("ml-1 whitespace-nowrap text-base font-bold", nube.conectado ? "text-ok" : "text-tinta-suave")}>
          {nube.conectado ? "● en línea" : "● sin conexión (se muestra la copia de este equipo)"}
        </span>
      </p>
      <p className="mb-3 text-base text-tinta-suave">
        Lo que se cambia en un equipo aparece en los demás en unos segundos. Los ajustes de “Este equipo” (pared, PIN que se
        pide) son de cada equipo.
      </p>
      <Boton variante="primario" onClick={() => setInvitando(true)}>
        📲 Invitar otro equipo
      </Boton>

      <h3 className="mb-2 mt-5 text-lg font-extrabold uppercase text-tinta-suave">Equipos conectados</h3>
      {!equipos && !msg && <p className="text-base text-tinta-suave">Cargando…</p>}
      <ul className="space-y-2">
        {equipos?.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-superficie-2 px-4 py-2 cel:gap-x-2 cel:gap-y-0.5 cel:rounded-xl cel:px-3 cel:pb-1.5">
            {/* Celular: el nombre en su línea y el botón debajo (si no, quedan apretados). */}
            <span className="min-w-0 flex-1 text-lg font-bold cel:basis-full">
              {e.nombre} {e.esEste && <span className="font-normal text-tinta-suave">(este)</span>}
            </span>
            <Boton variante={e.esEste ? "fantasma" : "peligro"} onClick={() => setQuitar(e)}>
              {e.esEste ? "Desconectar este equipo" : "Quitar acceso"}
            </Boton>
          </li>
        ))}
      </ul>
      {msg && <p className="mt-3 text-lg font-bold">{msg}</p>}

      {invitando && sesion && <InvitarModal token={sesion.token} alCerrar={() => setInvitando(false)} />}
      {quitar && (
        <Modal
          titulo={quitar.esEste ? "¿Desconectar este equipo?" : `¿Quitarle el acceso a “${quitar.nombre}”?`}
          alCerrar={() => setQuitar(null)}
          ancho="max-w-md"
          pie={
            <>
              <Boton variante="fantasma" onClick={() => setQuitar(null)}>
                Cancelar
              </Boton>
              <Boton variante="peligro" onClick={() => sacar(quitar)}>
                {quitar.esEste ? "Desconectar" : "Quitar acceso"}
              </Boton>
            </>
          }
        >
          <p className="text-lg">
            {quitar.esEste
              ? `Este equipo deja de ver los cambios de la familia y se queda con una copia de lo que hay ahora. Para volver, hace falta un código nuevo. ${TEXTOS.respaldo}`
              : "Ese equipo deja de ver y cambiar los datos de la familia (sirve si se perdió un teléfono). Se queda con una copia de lo que tenía."}
          </p>
        </Modal>
      )}
    </>
  );
}

function InvitarModal({ token, alCerrar }: { token: string; alCerrar: () => void }) {
  const [inv, setInv] = useState<{ codigo: string; expira: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [copiada, setCopiada] = useState<boolean | null>(null);
  const campoDireccion = useRef<HTMLInputElement>(null);
  const direccion = location.origin;

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(direccion);
      setCopiada(true);
    } catch {
      // Sin permiso para copiar: queda marcada, para copiarla a mano (mantener apretado → Copiar).
      campoDireccion.current?.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch {
        /* nada */
      }
      setCopiada(ok);
    }
  };

  useEffect(() => {
    let vivo = true;
    api<{ codigo?: string; expira?: string; error?: string }>("/api/invitar", { metodo: "POST", token })
      .then(({ status, datos }) =>
        vivo && (status === 201 && datos.codigo ? setInv({ codigo: datos.codigo, expira: datos.expira! }) : setMsg(datos.error ?? "No se pudo crear la invitación.")),
      )
      .catch((e) => vivo && setMsg(mensajeDe(e, "No se pudo crear la invitación.")));
    return () => {
      vivo = false;
    };
  }, [token]);

  // El QR de unirse lleva el código; el segundo, sólo la dirección (para abrirla en Safari sin gastar el código).
  const svgUnirse = inv ? svgQR(`${direccion}/#unirse=${inv.codigo}`) : "";
  const svgDireccion = inv ? svgQR(`${direccion}/`) : "";

  return (
    <Modal titulo="📲 Invitar otro equipo" alCerrar={alCerrar} ancho="max-w-lg">
      {msg ? (
        <p className="text-lg font-bold">{msg}</p>
      ) : !inv ? (
        <p className="text-lg text-tinta-suave">Creando el código…</p>
      ) : (
        <div className="space-y-4 text-center">
          <div className="mx-auto w-60 rounded-2xl bg-white p-2" role="img" aria-label="Código QR para unirse" dangerouslySetInnerHTML={{ __html: svgUnirse }} />
          <p className="text-lg">
            En el iPhone o iPad, abre la <strong>Cámara</strong> y apunta al código: se une en Safari.
          </p>
          <p className="text-base text-tinta-suave">
            O en el otro equipo: toca «Unirme con un código» (arriba) o ve a Familia → Compartir entre equipos, y escribe
          </p>
          <p className="num font-display text-4xl font-semibold tracking-widest">{formatoCodigo(inv.codigo)}</p>
          <p className="text-base text-tinta-suave">Sirve una vez y vence en 24 horas.</p>
          {/* La Cámara abre Safari, y en el iPhone el ícono de la pantalla de inicio guarda sus datos aparte:
              si escanean el QR de arriba se une Safari y el código queda gastado para el ícono. */}
          <div className="space-y-3 rounded-2xl bg-acento-suave px-4 py-3 text-left text-base" data-guia="como-app">
            <p>
              <strong>¿La quieren como app en el iPhone o iPad?</strong> Entonces <strong>no escaneen el QR de arriba</strong>: se
              uniría Safari, no la app, y el código quedaría gastado.
            </p>
            <ol className="list-decimal space-y-1 pl-6">
              <li>Escaneen este otro QR con la Cámara: sólo abre la dirección en Safari, sin unirse.</li>
              <li>En Safari: Compartir → Agregar a pantalla de inicio.</li>
              <li>
                Ábranla desde el ícono, toquen «Unirme con un código» y escriban{" "}
                <strong className="num whitespace-nowrap">{formatoCodigo(inv.codigo)}</strong>.
              </li>
            </ol>
            <div
              className="mx-auto w-40 rounded-2xl bg-white p-2"
              role="img"
              aria-label="Código QR sólo con la dirección (no une)"
              dangerouslySetInnerHTML={{ __html: svgDireccion }}
            />
            <p className="text-tinta-suave">O manden la dirección (por WhatsApp, por ejemplo):</p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={campoDireccion}
                readOnly
                value={direccion}
                aria-label="Dirección del panel"
                onFocus={(e) => e.currentTarget.select()}
                className={cx(claseInput, "min-w-0 flex-1 basis-56")}
              />
              <Boton onClick={copiar}>{copiada ? "✓ Copiada" : "📋 Copiar"}</Boton>
            </div>
            {copiada === false && <p className="text-tinta-suave">No se pudo copiar sola: mantén apretada la dirección y elige Copiar.</p>}
          </div>
        </div>
      )}
    </Modal>
  );
}
