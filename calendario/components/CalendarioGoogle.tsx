"use client";

// Familia → "Calendario del iPhone (Google Calendar)": el calendario «Familia» es un calendario del
// Gmail de un adulto (el dueño: Madre, Padre u Otro adulto). El panel lo usa con una cuenta de servicio
// de Google (su clave vive sólo en Netlify) y, si se compartió con «administrar el uso compartido»,
// invita desde aquí a los demás como editor o solo lectura.
//
// Pasos en pantalla: ¿de quién es? → preparar Google (una vez) → compartir con el correo del panel →
// pegar el ID → Probar → Conectar. Conectado: cómo va la sincronización y «👥 Quiénes lo ven».

import { useEffect, useState, type ReactNode } from "react";
import { useDatos } from "@/lib/store";
import { leerSesion } from "@/lib/datos/nube";
import type { RolAdulto } from "@/lib/datos/repositorio";
import type { Miembro } from "@/lib/datos/tipos";
import {
  EstadoConexion,
  ROL_TEXTO,
  ReglasPersonas,
  SubirExistentes,
  cargarInfoCalendario,
  useInfoCalendario,
  usePedido,
  type Adulto,
  type Conexion,
  type InfoGoogle,
} from "./CalendarioComun";
import { Avatar, Boton, Campo, Entrada, Modal, Segmentos, cx } from "./ui";

type Permiso = "editor" | "lectura";

interface PasoPrueba {
  clave: string;
  estado: "ok" | "aviso" | "error";
  texto: string;
}
interface ResultadoPrueba {
  pasos: PasoPrueba[];
  nombre: string | null;
  zona: string | null;
  rol: string | null;
  terminado: boolean;
}

/** Una persona como la muestra GET /api/calendario/personas (lo guardado junto con Google). */
interface PersonaVista {
  correo: string;
  nombre: string | null;
  rol: RolAdulto | null;
  miembroId?: string;
  permiso: Permiso | null;
  rolGoogle: string | null;
  /**
   * ok · sinAcceso: se invitó desde el panel y ya no está en Google · pendiente: le falta el acceso pedido y
   * el panel no puede invitar (pasos a mano; con rolGoogle, tiene otro permiso) · sinInvitar: le falta el
   * acceso pedido y el panel YA puede invitar («Invitar ahora») · google: compartido en Google Calendar.
   */
  estado: "ok" | "sinAcceso" | "pendiente" | "sinInvitar" | "google";
  guardada: boolean;
  modo?: "panel" | "manual";
}
interface Personas {
  puedeInvitar: boolean;
  correoPanel: string;
  dueno: Adulto | null;
  duenoEnGoogle: boolean | null;
  personas: PersonaVista[];
  aviso?: string;
}

/** Cómo se llama cada permiso en la pantalla de Google Calendar (en español). */
const PERMISO_EN_GOOGLE: Record<Permiso, string> = {
  editor: "Realizar cambios y ver los detalles del evento",
  lectura: "Ver los detalles de todos los eventos",
};
const PERMISO_TEXTO: Record<Permiso, string> = { editor: "Editor", lectura: "Solo lectura" };
const ADMINISTRAR = "Realizar cambios y administrar el uso compartido";
const OPCIONES_ROL: { valor: RolAdulto; texto: string }[] = [
  { valor: "madre", texto: "Madre" },
  { valor: "padre", texto: "Padre" },
  { valor: "adulto", texto: "Otro adulto" },
];
const CORREO = /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/;

const duenoA = (rol: RolAdulto) => (rol === "madre" ? "dueña" : rol === "padre" ? "dueño" : "dueño/a");
function adultoCompleto<T extends Partial<Adulto>>(a: T | null): a is T & Adulto {
  return !!a && !!a.nombre?.trim() && !!a.correo && CORREO.test(a.correo.trim()) && !!a.rol && a.rol in ROL_TEXTO;
}
/** Nombre y Gmail listos, pero sin rol (para decir qué falta junto al botón desactivado). */
const soloFaltaRol = (a: Partial<Adulto> | null) => !!a && !a.rol && adultoCompleto({ ...a, rol: "adulto" });

// Borradores de este equipo (preparar Google toma un rato: que no se pierda lo escrito).
const CLAVE_DUENO = "calendario-familiar:google:dueno";
const CLAVE_ID = "calendario-familiar:google:id";
function leerBorrador<T>(clave: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(clave) ?? "null") as T | null;
  } catch {
    return null;
  }
}
function guardarBorrador(clave: string, v: unknown) {
  try {
    if (v === null) localStorage.removeItem(clave);
    else localStorage.setItem(clave, JSON.stringify(v));
  } catch {
    /* sin almacenamiento: sólo vive en pantalla */
  }
}

const AYUDA_CLAVE = (
  <>
    Revisa GOOGLE_CUENTA_SERVICIO en Netlify (si se borró o deshabilitó la clave en Google Cloud, crea otra, pégala allá y vuelve a
    publicar).
  </>
);
const AYUDA_CONFIGURACION = (
  <>En console.cloud.google.com → APIs y servicios → Biblioteca, habilita «Google Calendar API» en el proyecto de la cuenta de servicio.</>
);

export function SeccionGoogle() {
  const { nube } = useDatos();
  const sesion = leerSesion();
  const { info, error, cargar } = useInfoCalendario();
  const [reintentando, setReintentando] = useState(false);
  // Lo que avisó /conectar (p. ej. eventos con fechas sueltas que quedaron solo en la pared): vive aquí y
  // no en <Preparar>, que se desmonta al pasar a <Conectado>. Sólo para esa conexión.
  const [aviso, setAviso] = useState<{ conexion: string; texto: string } | null>(null);

  const titulo = <h2 className="mb-1 text-xl font-extrabold">📅 Calendario del iPhone (Google Calendar)</h2>;
  if (!nube || !sesion) {
    return (
      <div className="rounded-3xl bg-superficie p-4">
        {titulo}
        <p className="text-base text-tinta-suave">Para conectar Google Calendar, primero comparte este equipo con la familia (aquí arriba).</p>
      </div>
    );
  }
  const conexion = info?.conexiones.find((c) => c.proveedor === "google");
  const otra = info && !conexion ? info.conexiones[0] : undefined;
  const g = info?.servidor.google ?? { configurado: false, otraFamilia: false };

  return (
    <div className="rounded-3xl bg-superficie p-4">
      {titulo}
      {!info && !error && <p className="text-base text-tinta-suave">Cargando…</p>}
      {!info && error && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="min-w-48 flex-1 text-lg font-bold">{error}</p>
          <Boton
            disabled={reintentando}
            onClick={async () => {
              setReintentando(true);
              await cargar();
              setReintentando(false);
            }}
          >
            {reintentando ? "Reintentando…" : "🔄 Reintentar"}
          </Boton>
        </div>
      )}
      {info && conexion && (
        <Conectado
          conexion={conexion}
          correoPanel={g.correo}
          aviso={aviso?.conexion === conexion.id ? aviso.texto : null}
          alCerrarAviso={() => setAviso(null)}
        />
      )}
      {info && otra && <p className="text-lg">Hay otro calendario conectado («{otra.nombre}»): desconéctalo para usar Google Calendar.</p>}
      {info && !conexion && !otra && <Preparar g={g} alAvisar={(conexion, texto) => setAviso({ conexion, texto })} />}
    </div>
  );
}

// ---------- Antes de conectar ----------

function Preparar({ g, alAvisar }: { g: InfoGoogle; alAvisar: (conexion: string, texto: string) => void }) {
  const { estado, nube } = useDatos();
  const { ocupado, msg, setMsg, pedir } = usePedido();
  const [dueno, setDueno] = useState<Partial<Adulto> | null>(null);
  const [editandoDueno, setEditandoDueno] = useState(false);
  const [id, setId] = useState("");
  const [prueba, setPrueba] = useState<ResultadoPrueba | null>(null);
  const [conectando, setConectando] = useState(false);

  useEffect(() => {
    const d = leerBorrador<Partial<Adulto>>(CLAVE_DUENO);
    setDueno(d);
    setEditandoDueno(!adultoCompleto(d));
    setId(leerBorrador<string>(CLAVE_ID) ?? "");
  }, []);

  const completo = adultoCompleto(dueno);
  const quien = completo ? dueno.nombre.trim() : null;
  const conGmail = quien ? `Con el Gmail de ${quien}` : "Con el Gmail del adulto dueño del calendario";
  const listo = g.configurado && !g.otraFamilia && !!g.correo;
  // Las repeticiones con fechas sueltas (vienen de otro calendario) quedan siempre sólo en la pared con
  // Google: no se cuentan entre las que se suben.
  const libres = estado.eventos.filter((x) => !x.externo && !x.soloPanel);
  const conFechas = libres.filter((x) => !!x.fechas?.length).length;
  const sinVincular = libres.length - conFechas;
  const cambiarId = (v: string) => {
    setId(v);
    setPrueba(null);
    guardarBorrador(CLAVE_ID, v || null);
  };

  const probar = async () => {
    setPrueba(null);
    const r = await pedir<ResultadoPrueba>("/api/calendario/probar", { calendarioId: id });
    if (!r) return;
    if (r.status !== 200) return setMsg(r.datos.error ?? "No se pudo probar el calendario.");
    setPrueba(r.datos);
  };

  const conectar = async (subirExistentes: boolean) => {
    if (!completo) return;
    const r = await pedir<{
      conexion?: { id: string; nombre: string };
      resultado?: { ok: boolean; pendiente?: boolean; error?: { mensaje: string } };
      avisos?: string[];
    }>(
      "/api/calendario/conectar",
      { proveedor: "google", calendarioId: id, dueno, subirExistentes },
    );
    setConectando(false);
    if (!r) return;
    if (r.status !== 200) return setMsg(r.datos.error ?? "No se pudo conectar el calendario.");
    guardarBorrador(CLAVE_DUENO, null);
    guardarBorrador(CLAVE_ID, null);
    const avisos = r.datos.avisos ?? [];
    if (r.datos.resultado && !r.datos.resultado.ok) setMsg(r.datos.resultado.error?.mensaje ?? "La primera sincronización falló.");
    // Google lento: la conexión quedó, pero la primera sincronización no alcanzó; se sigue de inmediato.
    else if (r.datos.resultado?.pendiente) await pedir("/api/calendario/sincronizar", {});
    // Con la conexión, la sección pasa a «Conectado» y este paso se desmonta: el aviso lo guarda la sección.
    if (avisos.length && r.datos.conexion) alAvisar(r.datos.conexion.id, avisos.join(" "));
    else if (avisos.length) setMsg(avisos.join(" "));
    await cargarInfoCalendario();
    nube?.revisar();
  };

  return (
    <div className="space-y-4">
      <p className="text-lg">
        Lo que se agregue en la pared aparece en el Calendario de los iPhone, y lo que se agregue en los iPhone aparece en la pared. Se usa
        un calendario «Familia» de Google Calendar.
      </p>

      {/* 1. ¿De quién es? */}
      <Paso n={1} titulo="¿De quién es el calendario?">
        {!editandoDueno && completo ? (
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-56 flex-1">
              <p className="text-lg">
                Del Gmail de <strong>{dueno.nombre}</strong> · {ROL_TEXTO[dueno.rol]}
              </p>
              <p className="text-base text-tinta-suave [overflow-wrap:anywhere]">{dueno.correo}</p>
            </div>
            <Boton onClick={() => setEditandoDueno(true)}>Cambiar</Boton>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-base text-tinta-suave">
              El calendario «Familia» se crea en el Gmail de uno de los adultos. Esa persona lo prepara (una vez) y después, desde aquí, se
              invita al resto.
            </p>
            <FormularioAdulto valor={dueno ?? {}} alCambiar={setDueno} miembros={estado.miembros} />
            <Boton
              variante="primario"
              disabled={!completo}
              onClick={() => {
                guardarBorrador(CLAVE_DUENO, dueno);
                setEditandoDueno(false);
              }}
            >
              Listo
            </Boton>
            {soloFaltaRol(dueno) && <p className="text-base font-bold">Elige si es Madre, Padre u Otro adulto.</p>}
          </div>
        )}
      </Paso>

      {/* 2. Preparar Google (una vez) */}
      {!g.configurado && (
        <Paso n={2} titulo="Preparar Google (una sola vez)">
          {g.problema ? (
            <p className="mb-2 text-lg font-bold">
              La clave de Google guardada en Netlify (GOOGLE_CUENTA_SERVICIO) no se pudo leer: {g.problema}. Vuelve a pegarla completa y
              publica de nuevo.
            </p>
          ) : (
            <p className="mb-2 text-base">Para que la pared y el Calendario de los iPhone compartan los eventos, falta preparar Google una sola vez:</p>
          )}
          <ol className="list-decimal space-y-1.5 pl-6 text-base">
            <li>
              {conGmail}, en <strong>calendar.google.com</strong> (en un computador): junto a «Otros calendarios», toca <strong>+</strong> →
              Crear calendario → nombre <strong>Familia</strong> y zona horaria <strong>Santiago</strong> (sale como «(GMT-03:00) Santiago» en
              verano y «(GMT-04:00) Santiago» en invierno).
            </li>
            <li>
              {conGmail}, en <strong>console.cloud.google.com</strong>: crea un proyecto, habilita «Google Calendar API» y crea una cuenta de
              servicio (sin roles).
            </li>
            <li>
              En la cuenta de servicio → Claves → Agregar clave → <strong>JSON</strong>. No la pegues aquí ni en el chat.
            </li>
            <li>
              En <strong>Netlify</strong> → Project configuration → Environment variables: agrega{" "}
              <code className="rounded bg-superficie-2 px-1">GOOGLE_CUENTA_SERVICIO</code> con el contenido del archivo, marcada como
              secreta, y vuelve a publicar el sitio.
            </li>
            <li>Vuelve aquí: aparecerá el correo con el que hay que compartir el calendario.</li>
          </ol>
        </Paso>
      )}

      {g.configurado && g.otraFamilia && <p className="text-lg">La cuenta de servicio de Google del panel ya está conectada a otra familia en este sitio.</p>}

      {listo && (
        <>
          <Paso n={2} titulo="Compartir «Familia» con el panel">
            <p className="mb-2 text-base">
              {conGmail}, en calendar.google.com → junto a «Familia», <strong>⋮</strong> → Configuración y uso compartido → Compartido con →
              Agregar personas y grupos → pega este correo con el permiso <strong>«{ADMINISTRAR}»</strong> (así el panel puede invitar al
              resto):
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-2xl bg-fondo px-4 py-3 text-lg font-bold">{g.correo}</code>
              <Copiar texto={g.correo!} />
            </div>
            <p className="mt-2 text-base text-tinta-suave">
              También sirve «{PERMISO_EN_GOOGLE.editor}»: la pared se sincroniza igual, pero las invitaciones se hacen a mano en Google
              Calendar. No hay que aceptar nada.
            </p>
          </Paso>

          <Paso n={3} titulo="Pegar el ID del calendario">
            <Campo etiqueta="En esa misma página → Integrar el calendario → ID de calendario">
              <Entrada
                value={id}
                onChange={(e) => cambiarId(e.target.value)}
                placeholder="c_…@group.calendar.google.com"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode="email"
              />
            </Campo>
            <div className="mt-3 flex flex-wrap gap-2">
              <Boton disabled={ocupado || !id.trim()} onClick={probar}>
                {ocupado && !conectando ? "Probando…" : "🔎 Probar"}
              </Boton>
              <Boton variante="primario" disabled={ocupado || !id.trim() || !completo} onClick={() => setConectando(true)}>
                🔗 Conectar
              </Boton>
            </div>
            {!completo && <p className="mt-2 text-base text-tinta-suave">Para conectar, primero di de quién es el calendario (paso 1).</p>}
            {prueba && <ResultadoProbar r={prueba} />}
          </Paso>
        </>
      )}

      {msg && <p className="text-lg font-bold">{msg}</p>}

      {conectando && completo && (
        <Modal
          titulo={`Conectar «${prueba?.nombre ?? "Familia"}»`}
          alCerrar={() => setConectando(false)}
          ancho="max-w-lg"
          pie={
            <ConectarPie
              ocupado={ocupado}
              alCancelar={() => setConectando(false)}
              alConectar={conectar}
              sinVincular={sinVincular}
              conFechas={conFechas}
            />
          }
        >
          <p className="text-lg">
            Calendario de <strong>{dueno.nombre}</strong> ({ROL_TEXTO[dueno.rol]})
          </p>
          <p className="text-base text-tinta-suave [overflow-wrap:anywhere]">{dueno.correo}</p>
        </Modal>
      )}
    </div>
  );
}

/** El pie del modal "Conectar", con el interruptor de subir lo que ya está en la pared. */
function ConectarPie({
  ocupado,
  sinVincular,
  conFechas,
  alCancelar,
  alConectar,
}: {
  ocupado: boolean;
  sinVincular: number;
  /** Repeticiones con fechas sueltas: quedan sólo en la pared igual. */
  conFechas: number;
  alCancelar: () => void;
  alConectar: (subir: boolean) => void;
}) {
  const [subir, setSubir] = useState(true);
  return (
    <div className="flex w-full flex-col gap-3">
      <SubirExistentes n={sinVincular} subir={subir} alCambiar={setSubir} />
      {conFechas > 0 && (
        <p className="text-base text-tinta-suave">
          {conFechas === 1
            ? "1 evento con fechas sueltas (una repetición que vino de otro calendario) queda solo en la pared."
            : `${conFechas} eventos con fechas sueltas (repeticiones que vinieron de otro calendario) quedan solo en la pared.`}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-3">
        <Boton variante="fantasma" onClick={alCancelar}>
          Cancelar
        </Boton>
        <Boton variante="primario" disabled={ocupado} onClick={() => alConectar(subir)}>
          {ocupado ? "Conectando…" : "Conectar"}
        </Boton>
      </div>
    </div>
  );
}

function Paso({ n, titulo, children }: { n: number; titulo: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl bg-superficie-2 px-4 py-3">
      <h3 className="mb-2 flex items-center gap-2 text-lg font-extrabold">
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-acento text-base text-acento-tinta">{n}</span>
        {titulo}
      </h3>
      {children}
    </section>
  );
}

function ResultadoProbar({ r }: { r: ResultadoPrueba }) {
  const icono = { ok: "✅", aviso: "⚠️", error: "❌" } as const;
  return (
    <div className="mt-3 rounded-2xl bg-superficie px-4 py-3" aria-live="polite">
      <ul className="space-y-1.5 text-base">
        {r.pasos.map((p) => (
          <li key={p.clave} className="flex gap-2">
            <span aria-hidden>{icono[p.estado]}</span>
            <span className={cx(p.estado === "error" && "font-bold")}>{p.texto}</span>
          </li>
        ))}
      </ul>
      {!r.terminado && <p className="mt-2 text-lg font-bold">No alcanzó el tiempo: toca Probar de nuevo.</p>}
    </div>
  );
}

function Copiar({ texto }: { texto: string }) {
  const [hecho, setHecho] = useState(false);
  const copiar = async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(texto);
      ok = true;
    } catch {
      // Sin permiso del navegador para el portapapeles: el método antiguo.
      const t = document.createElement("textarea");
      t.value = texto;
      t.setAttribute("readonly", "");
      t.style.position = "fixed";
      t.style.opacity = "0";
      document.body.appendChild(t);
      t.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      t.remove();
    }
    if (ok) {
      setHecho(true);
      setTimeout(() => setHecho(false), 2500);
    }
  };
  return (
    <Boton onClick={copiar} aria-live="polite">
      {hecho ? "Copiado ✓" : "📋 Copiar"}
    </Boton>
  );
}

/** Nombre (o un integrante del panel), Gmail y rol de un adulto. */
function FormularioAdulto({
  valor,
  alCambiar,
  miembros,
  excluir = [],
}: {
  valor: Partial<Adulto>;
  alCambiar: (a: Partial<Adulto>) => void;
  miembros: Miembro[];
  excluir?: string[];
}) {
  const elegibles = miembros.filter((m) => !excluir.includes(m.id));
  const set = (c: Partial<Adulto>) => alCambiar({ ...valor, ...c });
  return (
    <div className="space-y-3">
      {elegibles.length > 0 && (
        <div>
          <span className="mb-1.5 block text-base font-bold text-tinta-suave">¿Es alguien del panel? (opcional)</span>
          <div className="flex flex-wrap gap-2">
            {elegibles.map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={valor.miembroId === m.id}
                onClick={() => (valor.miembroId === m.id ? set({ miembroId: undefined }) : set({ miembroId: m.id, nombre: m.nombre }))}
                className={cx(
                  "inline-flex min-h-12 items-center gap-2 rounded-full border-[3px] py-1 pl-1 pr-4 text-lg font-bold transition active:scale-95",
                  valor.miembroId === m.id ? "text-tinta" : "border-transparent bg-superficie text-tinta-suave",
                )}
                style={valor.miembroId === m.id ? { borderColor: m.color } : undefined}
              >
                <Avatar miembro={m} tam="sm" />
                {m.nombre}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <Campo etiqueta="Nombre">
          <Entrada value={valor.nombre ?? ""} onChange={(e) => set({ nombre: e.target.value })} placeholder="Ej.: Carolina" maxLength={60} />
        </Campo>
        <Campo etiqueta="Su Gmail">
          <Entrada
            type="email"
            value={valor.correo ?? ""}
            onChange={(e) => set({ correo: e.target.value.trim() })}
            placeholder="nombre@gmail.com"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </Campo>
      </div>
      <div>
        <span className="mb-1.5 block text-base font-bold text-tinta-suave">Es</span>
        {/* Marco blanco: sobre el fondo del paso (superficie-2) el selector solo no se distingue. */}
        <div className="inline-block rounded-[1.25rem] border border-borde bg-superficie p-1">
          <Segmentos opciones={OPCIONES_ROL} valor={(valor.rol ?? "") as RolAdulto} alCambiar={(rol) => set({ rol })} />
        </div>
      </div>
    </div>
  );
}

// ---------- Conectado ----------

function Conectado({
  conexion,
  correoPanel,
  aviso,
  alCerrarAviso,
}: {
  conexion: Conexion;
  correoPanel?: string;
  /** Lo que avisó /conectar (se ve hasta tocar «Entendido»). */
  aviso: string | null;
  alCerrarAviso: () => void;
}) {
  const panel = correoPanel ?? "el correo del panel";
  const d = conexion.dueno;
  return (
    <EstadoConexion
      conexion={conexion}
      proveedor="Google Calendar"
      ayudas={{
        CLAVE: AYUDA_CLAVE,
        CONFIGURACION: AYUDA_CONFIGURACION,
        PERMISO: (
          <>
            Comparte el calendario con <span className="break-all">{panel}</span> con el permiso «{ADMINISTRAR}» (o «{PERMISO_EN_GOOGLE.editor}»).
          </>
        ),
      }}
      encabezado={
        <>
          <p className="mb-1 text-lg">
            Conectado a <strong>«{conexion.nombre}»</strong> de Google Calendar
          </p>
          {d && (
            <p className="mb-1 text-base text-tinta-suave">
              Es del Gmail de {d.nombre} ({ROL_TEXTO[d.rol]}).
            </p>
          )}
          {aviso && (
            <div role="status" className="mb-3 flex flex-wrap items-center gap-3 rounded-2xl bg-superficie-2 px-4 py-3">
              <p className="min-w-48 flex-1 text-lg font-bold">⚠️ {aviso}</p>
              <Boton variante="fantasma" onClick={alCerrarAviso}>
                Entendido
              </Boton>
            </div>
          )}
        </>
      }
    >
      <QuienesLoVen conexion={conexion} />
      <details className="mt-4 rounded-2xl bg-superficie-2 px-4 py-3 text-base">
        <summary className="cursor-pointer text-lg font-bold">¿Cómo se ve en el iPhone?</summary>
        <ul className="mt-2 list-disc space-y-1 pl-6">
          <li>Agrega tu cuenta de Google en Configuración → Apps → Calendario → Cuentas de Calendario.</li>
          <li>Si «{conexion.nombre}» no aparece, entra a calendar.google.com/calendar/syncselect en un computador, márcalo y toca Guardar.</li>
          <li>
            En Obtener datos elige «Cada 15 minutos»: los cambios de la pared llegan al iPhone en hasta 15 minutos; los del iPhone llegan a
            la pared en hasta 5.
          </li>
          <li>Los avisos son de cada persona: configúralos en Google Calendar → {conexion.nombre} → Notificaciones de eventos.</li>
          <li>Las invitaciones de otras personas se ven en la pared, pero se cambian en Google Calendar.</li>
          <li>Quien tiene «Solo lectura» ve los eventos en su iPhone, pero no los puede cambiar.</li>
          <ReglasPersonas />
        </ul>
      </details>
    </EstadoConexion>
  );
}

/**
 * "Pídele a {dueño} que en calendar.google.com…" (cuando el panel no puede compartir). `calendario`: el
 * nombre del calendario conectado. `despues`: qué tocar en el panel una vez que el panel pueda compartir
 * (en la fila de una persona que falta: «Invitar ahora»).
 */
function textoManual(
  dueno: Adulto | null | undefined,
  correo: string,
  accion: "agregar" | "cambiar" | "quitar",
  permiso: Permiso | undefined,
  calendario: string,
  despues = accion === "quitar" ? "toca «Quitar» en su fila" : "toca «Invitar ahora» en su fila",
) {
  const quien = dueno?.nombre ?? "quien es dueño del calendario";
  const donde = `en calendar.google.com → ${calendario} → Configuración y uso compartido → Compartido con`;
  const que =
    accion === "agregar"
      ? `toque «Agregar personas y grupos» y agregue ${correo} con «${PERMISO_EN_GOOGLE[permiso ?? "editor"]}»`
      : accion === "cambiar"
        ? `le cambie el permiso a ${correo} por «${PERMISO_EN_GOOGLE[permiso ?? "editor"]}»`
        : `quite a ${correo} (con la ✕ junto a su nombre)`;
  return `El panel no tiene permiso para compartir. Pídele a ${quien} que ${donde}, ${que}. O comparte el calendario con el panel con «${ADMINISTRAR}» y después ${despues}.`;
}

function textoListo(correo: string, permiso: Permiso) {
  return (
    `Listo: Google le mandó un correo a ${correo}. Tiene que abrirlo y tocar el enlace. Después, en su iPhone: Configuración → Apps → ` +
    `Calendario → Cuentas de Calendario → Agregar cuenta → Google.` +
    (permiso === "lectura" ? " Con «Solo lectura» ve los eventos en su iPhone, pero no los puede cambiar." : "")
  );
}

function QuienesLoVen({ conexion }: { conexion: Conexion }) {
  const { estado } = useDatos();
  const { ocupado, msg, setMsg, pedir } = usePedido();
  const [datos, setDatos] = useState<Personas | null>(null);
  const [cargando, setCargando] = useState(true);
  const [invitando, setInvitando] = useState<Partial<Adulto> & { permiso?: Permiso } | null>(null);
  const [quitando, setQuitando] = useState<PersonaVista | null>(null);
  const [editandoDueno, setEditandoDueno] = useState<Partial<Adulto> | null>(null);

  const cargar = async (): Promise<Personas | null> => {
    setCargando(true);
    const r = await pedir<Personas>("/api/calendario/personas", undefined, "GET");
    setCargando(false);
    if (!r) return null;
    if (r.status !== 200) {
      setMsg(r.datos.error ?? "No se pudo ver con quién se comparte el calendario.");
      return null;
    }
    setDatos(r.datos);
    return r.datos;
  };
  useEffect(() => {
    void cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conexion.id]);

  const dueno = datos?.dueno ?? conexion.dueno ?? null;
  const miembro = (id?: string) => estado.miembros.find((m) => m.id === id);

  /** `alGuardar`: se llama apenas quedó guardada (p. ej. cerrar la ventana antes de mostrar el resultado). */
  const invitar = async (p: Partial<Adulto> & { permiso?: Permiso }, alGuardar?: () => void) => {
    const r = await pedir<{ modo: "panel" | "manual"; igual?: boolean; persona: { correo: string; permiso: Permiso } }>("/api/calendario/invitar", p);
    if (!r) return;
    if (r.status !== 200) return setMsg(r.datos.error ?? "No se pudo invitar.");
    alGuardar?.();
    const { correo, permiso } = r.datos.persona;
    const lista = await cargar();
    const ya = lista?.personas.find((x) => x.correo === correo)?.estado === "ok";
    setMsg(
      // Los pasos para hacerlo a mano quedan en la fila de esa persona (aquí arriba): no se repiten.
      r.datos.modo === "manual" && !ya
        ? `El panel no tiene permiso para compartir: ${correo} quedó en la lista, pero falta compartirlo a mano (los pasos están en su fila, aquí arriba).`
        : r.datos.igual || r.datos.modo === "manual"
          ? `${correo} ya tenía ese permiso en Google Calendar.`
          : textoListo(correo, permiso),
    );
  };

  const cambiarPermiso = async (p: PersonaVista, permiso: Permiso) => {
    const r = await pedir<{ modo: "panel" | "manual" }>("/api/calendario/permiso", { correo: p.correo, permiso });
    if (!r) return;
    // Primero se recarga la lista (eso borra el mensaje) y después se dice cómo resultó.
    await cargar();
    if (r.status !== 200) setMsg(r.datos.error ?? "No se pudo cambiar el permiso.");
    else {
      setMsg(
        r.datos.modo === "manual"
          ? textoManual(dueno, p.correo, "cambiar", permiso, conexion.nombre, `vuelve a tocar «${PERMISO_TEXTO[permiso]}» en su fila`)
          : permiso === "lectura"
            ? `${p.nombre ?? p.correo} ahora tiene «Solo lectura»: ve los eventos en su iPhone, pero no los puede cambiar.`
            : `${p.nombre ?? p.correo} ahora es «Editor»: ve y cambia los eventos desde su iPhone.`,
      );
    }
  };

  const quitar = async (p: PersonaVista) => {
    const r = await pedir<{ modo: "panel" | "manual"; yaNoEstaba?: boolean }>("/api/calendario/quitar", { correo: p.correo });
    setQuitando(null);
    if (!r) return;
    await cargar();
    if (r.status !== 200) setMsg(r.datos.error ?? "No se pudo quitar.");
    else setMsg(r.datos.modo === "manual" ? textoManual(dueno, p.correo, "quitar", undefined, conexion.nombre) : `${p.nombre ?? p.correo} ya no ve el calendario.`);
  };

  const guardarDueno = async (a: Adulto) => {
    const r = await pedir<{ dueno: Adulto }>("/api/calendario/dueno", a);
    if (!r) return;
    if (r.status !== 200) return setMsg(r.datos.error ?? "No se pudo guardar.");
    setEditandoDueno(null);
    await Promise.all([cargar(), cargarInfoCalendario()]);
  };

  // Los dos formularios muestran su propio error (detrás de la ventana no se vería): al abrirlos y al
  // cancelarlos se borra el mensaje anterior. Al guardar bien se cierran sin borrarlo (es el resultado).
  const abrirInvitar = () => {
    setMsg(null);
    setInvitando({ permiso: "editor" });
  };
  const cancelarInvitar = () => {
    setInvitando(null);
    setMsg(null);
  };
  const abrirDueno = (a: Adulto) => {
    setMsg(null);
    setEditandoDueno({ ...a });
  };
  const cancelarDueno = () => {
    setEditandoDueno(null);
    setMsg(null);
  };
  const enVentana = !!invitando || !!editandoDueno;
  const hayPendientes = !!datos?.personas.some((p) => p.estado === "pendiente");

  return (
    <section className="mt-4 rounded-2xl bg-superficie-2 px-4 py-3">
      <h3 className="mb-2 text-lg font-extrabold">👥 Quiénes lo ven</h3>
      {cargando && !datos && <p className="text-base text-tinta-suave">Cargando…</p>}

      {dueno && (
        <div className="mb-2 flex flex-wrap items-center gap-3 rounded-2xl bg-superficie px-3 py-2">
          {miembro(dueno.miembroId) ? <Avatar miembro={miembro(dueno.miembroId)!} /> : <span className="text-2xl" aria-hidden>👑</span>}
          <div className="min-w-48 flex-1">
            <p className="text-lg">
              <strong>{dueno.nombre}</strong> · {ROL_TEXTO[dueno.rol]} · {duenoA(dueno.rol)}
            </p>
            <p className="text-base text-tinta-suave [overflow-wrap:anywhere]">{dueno.correo}</p>
          </div>
          <Boton variante="fantasma" disabled={ocupado} onClick={() => abrirDueno(dueno)}>
            Cambiar
          </Boton>
        </div>
      )}
      {datos?.duenoEnGoogle === false && dueno && (
        <p className="mb-2 text-base text-tinta-suave">
          En Google Calendar, {dueno.correo} no aparece como dueño de «{conexion.nombre}»: revisa que sea el Gmail correcto.
        </p>
      )}

      {datos?.aviso && <p className="mb-2 text-base font-bold">{datos.aviso}</p>}
      {datos && !datos.puedeInvitar && !datos.aviso && (
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <p className="min-w-48 flex-1 text-base text-tinta-suave">
            El panel no puede invitar (se compartió sin «administrar el uso compartido»): las invitaciones se hacen a mano en Google Calendar.
            Para que el panel pueda invitar, comparte el calendario con {datos.correoPanel} con «{ADMINISTRAR}»
            {hayPendientes ? ", toca «Revisar de nuevo» y después «Invitar ahora» en la fila de quien falte." : "."}
          </p>
          <Boton variante="fantasma" disabled={ocupado} onClick={() => void cargar()}>
            🔄 Revisar de nuevo
          </Boton>
        </div>
      )}

      {datos && (
        <ul className="space-y-2">
          {datos.personas.map((p) => (
            <FilaPersona
              key={p.correo}
              p={p}
              miembro={miembro(p.miembroId)}
              ocupado={ocupado}
              // Sin regla en Google: agregarla; con una de otro permiso (rolGoogle): cambiársela.
              textoPendiente={textoManual(dueno, p.correo, p.rolGoogle ? "cambiar" : "agregar", p.permiso ?? "editor", conexion.nombre)}
              alCambiarPermiso={(v) => cambiarPermiso(p, v)}
              alQuitar={() => setQuitando(p)}
              alInvitar={() =>
                void invitar({ nombre: p.nombre ?? p.correo, correo: p.correo, rol: p.rol ?? "adulto", miembroId: p.miembroId, permiso: p.permiso ?? "editor" })
              }
            />
          ))}
          {!datos.personas.length && <li className="text-base text-tinta-suave">Todavía no se comparte con nadie más.</li>}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Boton variante="primario" disabled={ocupado} onClick={abrirInvitar}>
          ✉️ Invitar a otro adulto
        </Boton>
      </div>
      {msg && !enVentana && (
        <p className="mt-3 text-lg font-bold" role="status">
          {msg}
        </p>
      )}

      {invitando && (
        <Modal
          titulo="Invitar a otro adulto"
          alCerrar={cancelarInvitar}
          ancho="max-w-xl"
          pie={
            <>
              <ErrorVentana msg={msg} />
              <Boton variante="fantasma" onClick={cancelarInvitar}>
                Cancelar
              </Boton>
              <Boton
                variante="primario"
                disabled={ocupado || !adultoCompleto(invitando) || !invitando.permiso}
                onClick={() => void invitar(invitando, () => setInvitando(null))}
              >
                {ocupado ? "Enviando…" : "✉️ Enviar invitación"}
              </Boton>
            </>
          }
        >
          <div className="space-y-4">
            <FormularioAdulto
              valor={invitando}
              alCambiar={(a) => setInvitando({ ...invitando, ...a })}
              miembros={estado.miembros}
              excluir={[dueno?.miembroId ?? "", ...(datos?.personas.map((p) => p.miembroId ?? "") ?? [])].filter(Boolean)}
            />
            <div className="space-y-2" role="radiogroup" aria-label="Permiso">
              <span className="block text-base font-bold text-tinta-suave">Permiso</span>
              {(
                [
                  ["editor", "Editor", "Ve y cambia los eventos desde su iPhone."],
                  ["lectura", "Solo lectura", "Solo los ve: no los puede cambiar."],
                ] as const
              ).map(([v, t, d]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={invitando.permiso === v}
                  onClick={() => setInvitando({ ...invitando, permiso: v })}
                  className={cx(
                    "flex min-h-14 w-full flex-col justify-center rounded-2xl px-4 py-2 text-left transition",
                    invitando.permiso === v ? "bg-acento text-acento-tinta" : "bg-superficie-2",
                  )}
                >
                  <span className="text-lg font-bold">{t}</span>
                  <span className="text-base opacity-80">{d}</span>
                </button>
              ))}
            </div>
            <p className="text-base text-tinta-suave">
              Google le manda un correo con el enlace. Si no tiene Gmail: en accounts.google.com → Crear cuenta → Para mi uso personal →
              «Usar tu correo electrónico existente» (primero la cuenta, después la invitación).
            </p>
          </div>
        </Modal>
      )}

      {quitando && (
        <Modal
          titulo={`¿Dejar de compartir con ${quitando.nombre ?? quitando.correo}?`}
          alCerrar={() => setQuitando(null)}
          ancho="max-w-md"
          pie={
            <>
              <Boton variante="fantasma" onClick={() => setQuitando(null)}>
                Cancelar
              </Boton>
              <Boton variante="peligro" disabled={ocupado} onClick={() => quitar(quitando)}>
                Quitar
              </Boton>
            </>
          }
        >
          <p className="text-lg">
            {quitando.correo} deja de ver «{conexion.nombre}» en su iPhone y en Google Calendar. Se puede volver a invitar cuando quieras.
          </p>
        </Modal>
      )}

      {editandoDueno && (
        <Modal
          titulo="¿De quién es el calendario?"
          alCerrar={cancelarDueno}
          ancho="max-w-xl"
          pie={
            <>
              <ErrorVentana msg={msg} />
              <Boton variante="fantasma" onClick={cancelarDueno}>
                Cancelar
              </Boton>
              <Boton
                variante="primario"
                disabled={ocupado || !adultoCompleto(editandoDueno)}
                onClick={() => adultoCompleto(editandoDueno) && guardarDueno(editandoDueno)}
              >
                Guardar
              </Boton>
            </>
          }
        >
          <div className="space-y-3">
            <p className="text-base text-tinta-suave">
              Sólo corrige el dato en el panel: en Google Calendar el calendario sigue siendo de quien lo creó.
            </p>
            <FormularioAdulto valor={editandoDueno} alCambiar={setEditandoDueno} miembros={estado.miembros} />
          </div>
        </Modal>
      )}
    </section>
  );
}

/** El error de un formulario, dentro de su ventana (en el pie, siempre a la vista). */
function ErrorVentana({ msg }: { msg: ReactNode }) {
  if (!msg) return null;
  return (
    <p role="alert" className="w-full rounded-2xl bg-red-600/15 px-4 py-2 text-lg font-bold text-red-800 noche:text-red-200">
      {msg}
    </p>
  );
}

function FilaPersona({
  p,
  miembro,
  ocupado,
  textoPendiente,
  alCambiarPermiso,
  alQuitar,
  alInvitar,
}: {
  p: PersonaVista;
  miembro?: Miembro;
  ocupado: boolean;
  /** Los pasos a mano (sólo en «pendiente»). */
  textoPendiente: string;
  alCambiarPermiso: (v: Permiso) => void;
  alQuitar: () => void;
  /** Invitar con lo guardado («Invitar de nuevo» / «Invitar ahora»). */
  alInvitar: () => void;
}) {
  const administra = p.rolGoogle === "owner";
  const falta = p.estado === "sinAcceso" || p.estado === "pendiente" || p.estado === "sinInvitar";
  const etiqueta =
    p.estado === "sinAcceso"
      ? "ya no tiene acceso"
      : p.estado === "pendiente"
        ? "falta compartirlo a mano"
        : p.estado === "sinInvitar"
          ? "falta compartirlo"
          : p.estado === "google"
            ? administra
              ? "administra el calendario en Google"
              : "compartido en Google Calendar"
            : null;
  return (
    <li className="rounded-2xl bg-superficie px-3 py-2">
      <div className="flex flex-wrap items-center gap-3">
        {miembro ? <Avatar miembro={miembro} /> : <span className="text-2xl" aria-hidden>👤</span>}
        <div className="min-w-48 flex-1">
          <p className="text-lg [overflow-wrap:anywhere]">
            <strong>{p.nombre ?? p.correo}</strong>
            {p.rol && <> · {ROL_TEXTO[p.rol]}</>}
            {etiqueta && (
              <span
                className={cx(
                  "ml-2 inline-block rounded-full px-2.5 py-0.5 text-sm font-bold",
                  falta ? "bg-red-600/15 text-red-800 noche:text-red-200" : "bg-superficie-2",
                )}
              >
                {etiqueta}
              </span>
            )}
          </p>
          {p.nombre && <p className="text-base text-tinta-suave [overflow-wrap:anywhere]">{p.correo}</p>}
        </div>
        {!administra && !falta && p.permiso && (
          <Segmentos
            opciones={[
              { valor: "editor", texto: "Editor" },
              { valor: "lectura", texto: "Solo lectura" },
            ]}
            valor={p.permiso}
            alCambiar={(v) => !ocupado && v !== p.permiso && alCambiarPermiso(v)}
          />
        )}
        {(p.estado === "sinAcceso" || p.estado === "sinInvitar") && (
          <Boton variante={p.estado === "sinInvitar" ? "primario" : undefined} disabled={ocupado} onClick={alInvitar}>
            {p.estado === "sinInvitar" ? "✉️ Invitar ahora" : "✉️ Invitar de nuevo"}
          </Boton>
        )}
        {!administra && (
          <Boton variante="peligro" disabled={ocupado} onClick={alQuitar}>
            Quitar
          </Boton>
        )}
      </div>
      {p.estado === "pendiente" && <p className="mt-2 text-base">{textoPendiente}</p>}
      {p.estado === "sinInvitar" && (
        <p className="mt-2 text-base">
          El panel ya puede compartir: toca «Invitar ahora» para darle «{PERMISO_TEXTO[p.permiso ?? "editor"]}».
        </p>
      )}
    </li>
  );
}
