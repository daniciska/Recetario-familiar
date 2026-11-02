"use client";

import { useRef, useState } from "react";
import { useDatos } from "@/lib/store";
import type { EstadoApp, Miembro, Tema } from "@/lib/datos/tipos";
import { normalizarRespaldo } from "@/lib/datos/normalizar";
import { COLORES_MIEMBRO, EMOJIS_MIEMBRO, estadoEjemplo, nuevoId } from "@/lib/ejemplo";
import { hoy } from "@/lib/fechas";
import { useModoPared } from "@/lib/hooks";
import { Avatar, Boton, Campo, Entrada, Modal, Segmentos, Selector, SelectorHora, cx } from "./ui";

const CIUDADES: { nombre: string; lat: number; lon: number }[] = [
  { nombre: "Arica", lat: -18.4783, lon: -70.3126 },
  { nombre: "Iquique", lat: -20.2307, lon: -70.1357 },
  { nombre: "Antofagasta", lat: -23.6509, lon: -70.3975 },
  { nombre: "Copiapó", lat: -27.3668, lon: -70.3323 },
  { nombre: "La Serena", lat: -29.9027, lon: -71.2519 },
  { nombre: "Valparaíso", lat: -33.0472, lon: -71.6127 },
  { nombre: "Viña del Mar", lat: -33.0245, lon: -71.5518 },
  { nombre: "Santiago", lat: -33.4489, lon: -70.6693 },
  { nombre: "Rancagua", lat: -34.1708, lon: -70.7444 },
  { nombre: "Talca", lat: -35.4264, lon: -71.6554 },
  { nombre: "Chillán", lat: -36.6066, lon: -72.1034 },
  { nombre: "Concepción", lat: -36.827, lon: -73.0503 },
  { nombre: "Temuco", lat: -38.7359, lon: -72.5904 },
  { nombre: "Valdivia", lat: -39.8142, lon: -73.2459 },
  { nombre: "Osorno", lat: -40.5739, lon: -73.1336 },
  { nombre: "Puerto Montt", lat: -41.4693, lon: -72.9424 },
  { nombre: "Coyhaique", lat: -45.5712, lon: -72.0685 },
  { nombre: "Punta Arenas", lat: -53.1638, lon: -70.9171 },
];

export default function VistaAjustes() {
  const { estado, actualizar, reemplazarTodo, sinGuardar } = useDatos();
  // Si este navegador no deja guardar, cada "✓" lo recuerda.
  const noGuarda = sinGuardar ? " Ojo: este navegador no guarda datos; se perderá al cerrar o recargar." : "";
  const [editando, setEditando] = useState<Miembro | "nuevo" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmarReset, setConfirmarReset] = useState(false);
  const [modoPared, setModoPared] = useModoPared();
  const archivo = useRef<HTMLInputElement>(null);
  const a = estado.ajustes;
  const setA = (cambios: Partial<EstadoApp["ajustes"]>) => actualizar("ajustes", (p) => ({ ...p, ...cambios }));

  const exportar = () => {
    const blob = new Blob([JSON.stringify(estado, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement("a");
    enlace.href = url;
    enlace.download = `calendario-familiar-${hoy()}.json`;
    enlace.click();
    URL.revokeObjectURL(url);
  };

  const importar = async (f: File) => {
    let crudo: unknown;
    try {
      crudo = JSON.parse(await f.text());
    } catch {
      return setMsg("Ese archivo no parece un respaldo de esta app.");
    }
    const r = normalizarRespaldo(crudo, estadoEjemplo().ajustes);
    if ("error" in r) return setMsg(r.error);
    const ok = await reemplazarTodo(r.estado);
    setMsg(
      ok
        ? "✓ Respaldo cargado." + noGuarda
        : "No se pudo cargar: no cabe en el almacenamiento de este equipo (las fotos ocupan mucho). Tus datos siguen como estaban.",
    );
  };

  return (
    <section className="desliza h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-4 pb-6">
        <h1 className="font-display text-2xl font-semibold md:text-3xl">Familia y ajustes</h1>

        <div className="rounded-3xl bg-superficie p-4">
          <Campo etiqueta="Nombre de la familia">
            <Entrada value={a.nombreFamilia} onChange={(e) => setA({ nombreFamilia: e.target.value })} />
          </Campo>
        </div>

        <div className="rounded-3xl bg-superficie p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xl font-extrabold">Integrantes</h2>
            <Boton variante="primario" onClick={() => setEditando("nuevo")}>
              ＋ Persona
            </Boton>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {estado.miembros.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setEditando(m)}
                className="flex items-center gap-3 rounded-2xl border-[3px] p-2 text-left transition active:scale-[0.98]"
                style={{ borderColor: m.color }}
              >
                <Avatar miembro={m} tam="lg" />
                <span className="flex-1 text-2xl font-extrabold">{m.nombre}</span>
                <span className="pr-2 text-xl text-tinta-suave">✏️</span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 rounded-3xl bg-superficie p-4 md:grid-cols-2">
          <Campo etiqueta="Ciudad (para el clima)">
            <Selector
              value={a.ciudad}
              onChange={(e) => {
                const c = CIUDADES.find((x) => x.nombre === e.target.value);
                if (c) setA({ ciudad: c.nombre, latitud: c.lat, longitud: c.lon });
              }}
            >
              {!CIUDADES.some((c) => c.nombre === a.ciudad) && <option value={a.ciudad}>{a.ciudad}</option>}
              {CIUDADES.map((c) => (
                <option key={c.nombre} value={c.nombre}>
                  {c.nombre}
                </option>
              ))}
            </Selector>
          </Campo>
          <div>
            <span className="mb-1.5 block text-base font-bold text-tinta-suave">Colores de la pantalla</span>
            <Segmentos<Tema>
              valor={a.tema}
              alCambiar={(tema) => setA({ tema })}
              opciones={[
                { valor: "auto", texto: "🌗 Auto" },
                { valor: "claro", texto: "☀️ Claro" },
                { valor: "noche", texto: "🌙 Noche" },
              ]}
            />
          </div>
          <div className="md:col-span-2">
            <span className="mb-1.5 block text-base font-bold text-tinta-suave">Este equipo</span>
            <Segmentos<"pared" | "normal">
              valor={modoPared ? "pared" : "normal"}
              alCambiar={(v) => setModoPared(v === "pared")}
              opciones={[
                { valor: "pared", texto: "🖼️ Pared" },
                { valor: "normal", texto: "📱 Teléfono u otro" },
              ]}
            />
            <p className="mt-1.5 text-base text-tinta-suave">
              Si este equipo es la pantalla de la pared y nadie la toca en 5 minutos, vuelve sola al calendario de esta semana
              (salvo que haya una ventana abierta). Este ajuste es sólo de este equipo.
            </p>
          </div>
          {a.tema === "auto" && (
            <div className="grid grid-cols-2 gap-3 md:col-span-2">
              <div>
                <span className="mb-1.5 block text-base font-bold text-tinta-suave">Modo noche desde</span>
                <SelectorHora etiqueta="Modo noche desde" valor={a.nocheDesde} alCambiar={(v) => v && setA({ nocheDesde: v })} />
              </div>
              <div>
                <span className="mb-1.5 block text-base font-bold text-tinta-suave">Hasta</span>
                <SelectorHora etiqueta="Modo noche hasta" valor={a.nocheHasta} alCambiar={(v) => v && setA({ nocheHasta: v })} />
              </div>
            </div>
          )}
        </div>

        <div className="rounded-3xl bg-superficie p-4">
          <h2 className="mb-1 text-xl font-extrabold">Respaldo</h2>
          <p className="mb-3 text-base text-tinta-suave">
            Por ahora los datos se guardan en este dispositivo. Descarga un respaldo para pasarlos a otro (p. ej. del tablet al teléfono) o
            por si se borra el navegador.
          </p>
          <div className="flex flex-wrap gap-2">
            <Boton onClick={exportar}>⬇️ Descargar respaldo</Boton>
            <Boton
              onClick={() => {
                setMsg(null);
                archivo.current?.click();
              }}
            >
              ⬆️ Cargar respaldo
            </Boton>
            <input
              ref={archivo}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = ""; // así se puede volver a elegir el mismo archivo
                if (f) importar(f);
              }}
            />
            {confirmarReset ? (
              <>
                <Boton
                  variante="peligro"
                  onClick={async () => {
                    const ok = await reemplazarTodo(estadoEjemplo());
                    setConfirmarReset(false);
                    setMsg(ok ? "✓ Datos de ejemplo restaurados." + noGuarda : "No se pudo guardar en este equipo.");
                  }}
                >
                  Sí, borrar todo
                </Boton>
                <Boton variante="fantasma" onClick={() => setConfirmarReset(false)}>
                  No
                </Boton>
              </>
            ) : (
              <Boton variante="peligro" onClick={() => setConfirmarReset(true)}>
                ↺ Volver a los datos de ejemplo
              </Boton>
            )}
          </div>
          {msg && <p className="mt-3 text-lg font-bold">{msg}</p>}
        </div>
      </div>

      {editando && <EditorMiembro miembro={editando === "nuevo" ? undefined : editando} alCerrar={() => setEditando(null)} />}
    </section>
  );
}

function EditorMiembro({ miembro, alCerrar }: { miembro?: Miembro; alCerrar: () => void }) {
  const { estado, actualizar } = useDatos();
  const usados = new Set(estado.miembros.map((m) => m.color));
  const [m, setM] = useState<Miembro>(
    () =>
      miembro ?? {
        id: nuevoId("mie"),
        nombre: "",
        color: COLORES_MIEMBRO.find((c) => !usados.has(c)) ?? COLORES_MIEMBRO[0],
        emoji: "🙂",
      },
  );
  const [confirmar, setConfirmar] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guardar = async () => {
    const limpio = { ...m, nombre: m.nombre.trim() };
    const ok = await actualizar("miembros", (l) =>
      l.some((x) => x.id === limpio.id) ? l.map((x) => (x.id === limpio.id ? limpio : x)) : [...l, limpio],
    );
    if (ok) alCerrar();
    else setError("No se pudo guardar: el almacenamiento de este equipo está lleno.");
  };

  const borrar = () => {
    actualizar("miembros", (l) => l.filter((x) => x.id !== m.id));
    // Saca a la persona de los eventos; los que quedan sin nadie se borran.
    actualizar("eventos", (l) =>
      l.map((e) => ({ ...e, miembros: e.miembros.filter((id) => id !== m.id) })).filter((e) => e.miembros.length > 0),
    );
    actualizar("tareas", (l) => l.map((t) => (t.miembroId === m.id ? { ...t, miembroId: undefined } : t)));
    alCerrar();
  };

  return (
    <Modal
      titulo={miembro ? `Editar a ${miembro.nombre}` : "Nueva persona"}
      alCerrar={alCerrar}
      pie={
        <>
          {miembro &&
            (confirmar ? (
              <div className="mr-auto flex items-center gap-2">
                <span className="text-base font-bold">¿Seguro?</span>
                <Boton variante="peligro" onClick={borrar}>
                  Sí, borrar
                </Boton>
                <Boton variante="fantasma" onClick={() => setConfirmar(false)}>
                  No
                </Boton>
              </div>
            ) : (
              <Boton variante="peligro" className="mr-auto" onClick={() => setConfirmar(true)}>
                🗑 Borrar
              </Boton>
            ))}
          <Boton variante="fantasma" onClick={alCerrar}>
            Cancelar
          </Boton>
          <Boton variante="primario" disabled={!m.nombre.trim()} onClick={guardar}>
            Guardar
          </Boton>
        </>
      }
    >
      <div className="space-y-5">
        {error && <p role="alert" className="rounded-2xl bg-red-600/15 px-4 py-2 text-lg font-bold text-red-700 noche:text-red-300">{error}</p>}
        <div className="flex items-center gap-4">
          <Avatar miembro={m} tam="lg" />
          <Campo etiqueta="Nombre">
            <Entrada autoFocus={!miembro} value={m.nombre} onChange={(e) => setM({ ...m, nombre: e.target.value })} />
          </Campo>
        </div>
        <div>
          <span className="mb-1.5 block text-base font-bold text-tinta-suave">Color</span>
          <div className="flex flex-wrap gap-2">
            {COLORES_MIEMBRO.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Color ${c}`}
                onClick={() => setM({ ...m, color: c })}
                className={cx("size-14 rounded-full transition active:scale-95", m.color === c && "ring-4 ring-tinta ring-offset-2 ring-offset-superficie")}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>
        <div>
          <span className="mb-1.5 block text-base font-bold text-tinta-suave">Avatar</span>
          <div className="flex flex-wrap gap-1.5">
            {EMOJIS_MIEMBRO.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setM({ ...m, emoji: e })}
                className={cx("size-14 rounded-2xl text-3xl", m.emoji === e ? "bg-acento-suave ring-[3px] ring-acento" : "bg-superficie-2")}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
