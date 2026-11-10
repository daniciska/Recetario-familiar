// Fuzz del motor con Google Calendar (plan de pruebas C4, punto 12): secuencias al azar (con semilla fija)
// de cambios en la pared, en la "web" y en el "iPhone", con fallas inyectadas (TIEMPO, 412, 500, aplica y
// falla) y con distintas combinaciones de interruptores del simulador. Después de dos vueltas quietas:
//   - la pared es igual a lo que Google tiene (leerRecurso de la proyección, misma huella por serie);
//   - no hay duplicados (ni en la pared ni dos series vivas de Google para un mismo evento del panel);
//   - una vuelta quieta no escribe nada;
//   - nunca aparece PERMISO por un error transitorio (ni INTERNO);
//   - no hay borrados masivos sin preguntar.
//
//   cd calendario && node --experimental-transform-types --no-warnings --import ./pruebas/registrar.mjs pruebas/google/fuzz.test.ts
//   FUZZ_SEMILLAS=3,7 FUZZ_PASOS=80 …   (por omisión: 6 semillas, 40 pasos; menos de ~1 min por semilla)
import * as h from "../h.ts";
import { respuestas, es, type Interruptores, type Paginacion } from "./mock-google.mts";
import { uidDesdeId } from "../../servidor/google/ids.ts";
import type { Evento } from "../../lib/datos/tipos.ts";

const { ok, seccion } = h;
const SEMILLAS = (process.env.FUZZ_SEMILLAS ?? "1,2,3,4,5,6").split(",").map(Number).filter(Number.isFinite);
const PASOS = Number(process.env.FUZZ_PASOS ?? 40);

/** Combinaciones de lo no documentado (una por semilla, en orden). */
const CONFIGS: { nombre: string; interruptores: Partial<Interruptores>; paginacion?: Partial<Paginacion> }[] = [
  { nombre: "por omisión", interruptores: {} },
  { nombre: "normaliza, EXDATE→cancelada, título a las excepciones", interruptores: { normalizar: true, exdateAExcepcionCancelada: true, propagarTituloAExcepciones: true } },
  { nombre: "fantasmas, borra excepciones al cambiar la regla, lápida libre", interruptores: { fantasmasAlLeer: true, cambioReglaExcepciones: "borrar", lapidaOcupaId: false }, paginacion: { modo: "azar", probVacia: 0.3 } },
  { nombre: "iPhone borra la marca, fin=inicio rechazado, UNTIL ignorado tras dividir", interruptores: { extendedPropsSeConservan: false, finIgualInicio: "400", untilIgnoradoTrasDivision: true } },
  { nombre: "todo junto + páginas al azar", interruptores: { normalizar: true, fantasmasAlLeer: true, propagarTituloAExcepciones: true, cambioReglaExcepciones: "borrar", extendedPropsSeConservan: false, exdateAExcepcionCancelada: true }, paginacion: { modo: "azar", probVacia: 0.2 } },
  { nombre: "sin fin aceptado de ningún modo", interruptores: { finIgualInicio: "400", endTimeUnspecifiedAceptado: false, lapidaOcupaId: false } },
];

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sumarDias = (f: string, n: number) => {
  const d = new Date(`${f}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dos = (n: number) => String(n).padStart(2, "0");
const TITULOS = ["Dentista", "Fútbol", "Piano", "Natación", "Reunión", "Cumpleaños", "Inglés", "Control", "Taller", "Paseo", "Feria", "Clase"];
const PERSONAS = [["sofi"], ["tomi"], ["mama"], ["sofi", "tomi"], ["sofi", "tomi", "mama"]];
const EMOJI: Record<string, string> = { sofi: "🦄", tomi: "⚽", mama: "🌸" };

async function correr(semilla: number, config: (typeof CONFIGS)[number]) {
  const t0 = Date.now();
  const sim = await h.arrancar({ semilla, interruptores: config.interruptores, paginacion: config.paginacion });
  const azar = mulberry32(semilla * 7919 + 13);
  const entero = (n: number) => Math.floor(azar() * n);
  const uno = <T>(l: readonly T[]): T => l[entero(l.length)];
  const cal = h.nuevoCalendario();
  const con = h.conexionGoogle(cal);
  const web = sim.actor("web", cal);
  const iphone = sim.actor("iPhone", cal);
  let n = 0;
  const fecha = () => sumarDias("2026-11-10", entero(60));
  const hora = () => `${dos(7 + entero(13))}:${uno(["00", "15", "30", "45"])}`;
  const nuevoPanel = (): Evento => {
    const id = `z${semilla}_${++n}`;
    const tipo = entero(10);
    const base = h.ev(id, { titulo: uno(TITULOS), miembros: uno(PERSONAS), fecha: fecha() });
    const hi = hora();
    const conHora = { horaInicio: hi, horaFin: entero(6) ? `${dos(Math.min(23, Number(hi.slice(0, 2)) + 1))}:${hi.slice(3)}` : undefined };
    if (tipo === 0) return { ...base, todoElDia: true, horaInicio: undefined, horaFin: undefined };
    if (tipo === 1) return { ...base, ...conHora, repeticion: "diaria", repetirHasta: sumarDias(base.fecha, 5 + entero(30)) };
    if (tipo === 2) return { ...base, ...conHora, repeticion: "semanal", repetirHasta: entero(2) ? sumarDias(base.fecha, 30 + entero(90)) : undefined };
    if (tipo === 3) return { ...base, ...conHora, repeticion: "semanal", diasSemana: [0, 2, 4].slice(0, 1 + entero(3)), fecha: "2026-11-16" };
    if (tipo === 4) return { ...base, ...conHora, repeticion: "mensual" };
    if (tipo === 5) return { ...base, todoElDia: true, horaInicio: undefined, horaFin: undefined, repeticion: "anual" };
    if (tipo === 6) return { ...base, todoElDia: true, horaInicio: undefined, horaFin: undefined, fechaFin: sumarDias(base.fecha, 1 + entero(5)) };
    return { ...base, ...conHora };
  };
  const fam = await h.familia(Array.from({ length: 8 }, nuevoPanel));
  const fallas: string[] = [];
  const vigilar = async (r: Awaited<ReturnType<typeof h.sync>>, paso: string, total: number) => {
    const c = r.error?.codigo;
    if (c === "PERMISO" || c === "INTERNO" || c === "CLAVE" || c === "CONFIGURACION") fallas.push(`${paso}: ${c} ${r.error?.mensaje}`);
    const muchos = (k: number) => k >= 5 && k > total * 0.3;
    if (r.resumen && (muchos(r.resumen.borradosAqui) || muchos(r.resumen.borradosAlla))) fallas.push(`${paso}: borrado masivo sin preguntar ${JSON.stringify(r.resumen)}`);
  };
  const sincronizar = async (paso: string, ms = 6500) => {
    const total = Object.keys((await h.estado(fam, con))?.recursos ?? {}).length;
    let r = await h.sync(fam, con, ms);
    await vigilar(r, paso, total);
    if (r.error?.codigo?.startsWith("MUCHOS_BORRADOS_")) {
      // La familia responde (al azar): traerlos de vuelta o borrarlos.
      r = await h.sync(fam, con, ms, entero(2) ? "recuperar" : "borrar");
      await vigilar(r, `${paso} (respuesta)`, total);
    }
    return r;
  };
  await sincronizar("conectar", 24_000);

  // ---- Acciones ----
  const principalesGoogle = () => h.vivos(cal).filter((e) => !e.recurringEventId && e.eventType === "default");
  const conRegla = () => principalesGoogle().filter((e) => e.recurrence?.some((l: string) => l.startsWith("RRULE")));
  const instancia = (idSerie: string) => {
    const l = sim.instancias(cal, idSerie, Date.parse("2026-11-01T00:00:00Z"), Date.parse("2027-06-01T00:00:00Z")).filter((x) => x.status !== "cancelled" && x.originalStartTime);
    const x = l.length ? uno(l) : null;
    return x ? (x.originalStartTime.dateTime ?? x.originalStartTime.date) : null;
  };
  const tituloGoogle = (actual: string) => {
    const emoji = [...actual.matchAll(/(🦄|⚽|🌸)/gu)].map((m) => m[0]).join("");
    return `${emoji ? emoji + " " : ""}${uno(TITULOS)} ${++n}`;
  };
  const horaGoogle = (diaCompleto: boolean) => {
    const f = fecha();
    if (diaCompleto) return { start: { date: f }, end: { date: sumarDias(f, 1) } };
    const hi = 8 + entero(12);
    return {
      start: { dateTime: `${f}T${dos(hi)}:00:00-03:00`, timeZone: "America/Santiago" },
      end: { dateTime: `${f}T${dos(hi + 1)}:30:00-03:00`, timeZone: "America/Santiago" },
    };
  };
  const REGLAS = ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE", "RRULE:FREQ=DAILY;COUNT=8", "RRULE:FREQ=MONTHLY;BYMONTHDAY=15", "RRULE:FREQ=MONTHLY;BYDAY=2TU;COUNT=5", "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=FR"];
  const enPared = async () => (await h.leerEventos(fam)).filter((e) => !e.externo?.recurrencia);

  const acciones: [string, number, () => Promise<string | null>][] = [
    [
      "pared: título",
      3,
      async () => {
        const e = uno(await enPared());
        if (!e) return null;
        await h.cambiarEvento(fam, e.id, { titulo: `${uno(TITULOS)} ${++n}` });
        return e.id;
      },
    ],
    [
      "pared: hora",
      2,
      async () => {
        const e = uno((await enPared()).filter((x) => !x.todoElDia && !x.fechas?.length));
        if (!e) return null;
        const hi = hora();
        await h.cambiarEvento(fam, e.id, { horaInicio: hi, horaFin: `${dos(Math.min(23, Number(hi.slice(0, 2)) + 1))}:${hi.slice(3)}` });
        return e.id;
      },
    ],
    [
      "pared: lugar y nota",
      1,
      async () => {
        const e = uno(await enPared());
        if (!e) return null;
        await h.cambiarEvento(fam, e.id, { lugar: entero(2) ? `Sala ${++n}` : undefined, nota: entero(2) ? `Nota ${n}\ncon dos líneas` : undefined });
        return e.id;
      },
    ],
    [
      "pared: borrar sólo un día",
      2,
      async () => {
        const e = uno((await enPared()).filter((x) => (x.repeticion === "diaria" || (x.repeticion === "semanal" && !x.diasSemana)) && !x.intervalo && !x.fechas?.length));
        if (!e) return null;
        const paso = e.repeticion === "diaria" ? 1 : 7;
        const f = sumarDias(e.fecha, paso * (1 + entero(4)));
        if (e.repetirHasta && f > e.repetirHasta) return null;
        await h.cambiarEvento(fam, e.id, (x) => ({ ...x, excepciones: [...new Set([...(x.excepciones ?? []), f])].sort(), actualizado: new Date().toISOString() }));
        return `${e.id} ${f}`;
      },
    ],
    [
      "pared: «hasta»",
      1,
      async () => {
        const e = uno((await enPared()).filter((x) => x.repeticion !== "nunca" && !x.fechas?.length));
        if (!e) return null;
        await h.cambiarEvento(fam, e.id, { repetirHasta: sumarDias(e.fecha, 20 + entero(120)) });
        return e.id;
      },
    ],
    [
      "pared: borrar",
      2,
      async () => {
        const e = uno(await enPared());
        if (!e) return null;
        await h.guardarEventos(fam, (l) => l.filter((x) => x.id !== e.id && !(e.externo && x.externo?.uid === e.externo.uid)));
        return e.id;
      },
    ],
    [
      "pared: nuevo",
      2,
      async () => {
        const e = nuevoPanel();
        await h.guardarEventos(fam, (l) => [...l, e]);
        return e.id;
      },
    ],
    [
      "web: título",
      2,
      async () => {
        const e = uno(principalesGoogle());
        if (!e) return null;
        web.editarTitulo(e.id, tituloGoogle(e.summary ?? ""));
        return e.id;
      },
    ],
    [
      "web: borrar un día",
      2,
      async () => {
        const e = uno(conRegla());
        const d = e && instancia(e.id);
        if (!d) return null;
        web.borrarDia(e.id, d);
        return `${e.id} ${d}`;
      },
    ],
    [
      "web: mover un día",
      2,
      async () => {
        const e = uno(conRegla());
        const d = e && instancia(e.id);
        if (!d || !e.start?.dateTime) return null;
        const ini = Date.parse(d) + 2 * 3600_000;
        const fin = ini + 3600_000;
        web.moverDia(e.id, d, { dateTime: new Date(ini).toISOString(), timeZone: "America/Santiago" }, { dateTime: new Date(fin).toISOString(), timeZone: "America/Santiago" });
        return `${e.id} ${d}`;
      },
    ],
    [
      "web: borrar",
      1,
      async () => {
        const e = uno(principalesGoogle());
        if (!e) return null;
        web.borrar(e.id);
        return e.id;
      },
    ],
    [
      "web: nuevo",
      2,
      async () => {
        const dc = entero(4) === 0;
        const x = web.crear({ summary: `${EMOJI[uno(["sofi", "tomi", "mama"])]} ${uno(TITULOS)} ${++n}`, ...horaGoogle(dc), ...(entero(2) ? { recurrence: [uno(REGLAS)] } : {}) });
        return x.id;
      },
    ],
    [
      "web: nota con formato",
      1,
      async () => {
        const e = uno(principalesGoogle());
        if (!e) return null;
        web.editar(e.id, { description: `Llevar <b>${++n}</b> cosas\nY "más" & otras` });
        return e.id;
      },
    ],
    [
      "web: este y los siguientes",
      1,
      async () => {
        const e = uno(conRegla());
        const d = e && instancia(e.id);
        if (!d) return null;
        web.esteYLosSiguientes(e.id, d, { summary: tituloGoogle(e.summary ?? "") });
        return `${e.id} ${d}`;
      },
    ],
    [
      "iPhone: borrar un día",
      2,
      async () => {
        const e = uno(conRegla());
        const d = e && instancia(e.id);
        if (!d) return null;
        iphone.borrarDia(e.id, d);
        return `${e.id} ${d}`;
      },
    ],
    [
      "iPhone: título",
      1,
      async () => {
        const e = uno(principalesGoogle());
        if (!e) return null;
        iphone.editarTitulo(e.id, tituloGoogle(e.summary ?? ""));
        return e.id;
      },
    ],
    [
      "iPhone: nuevo",
      1,
      async () => {
        const x = iphone.crear({ summary: `${EMOJI[uno(["sofi", "tomi", "mama"])]} ${uno(TITULOS)} ${++n}`, ...horaGoogle(false), ...(entero(3) === 0 ? { recurrence: [uno(REGLAS)] } : {}) });
        return x.id;
      },
    ],
  ];
  const pesoTotal = acciones.reduce((s, a) => s + a[1], 0);
  const elegir = () => {
    let x = azar() * pesoTotal;
    for (const a of acciones) if ((x -= a[1]) < 0) return a;
    return acciones[0];
  };

  // Fallas para la vuelta siguiente.
  const FALLAS: [string, () => { ms: number; quitar: () => void }][] = [
    ["ninguna", () => ({ ms: 6500, quitar: () => {} })],
    ["TIEMPO en una escritura", () => { const x = sim.inyectar(es.escritura(), respuestas.demora(15_000)); return { ms: 4500, quitar: () => x.quitar() }; }],
    ["TIEMPO al listar", () => { const x = sim.inyectar(es.tipo("events.list"), respuestas.demora(15_000)); return { ms: 4500, quitar: () => x.quitar() }; }],
    ["412 en una escritura", () => { const x = sim.inyectar((p) => p.tipo === "events.patch" || p.tipo === "events.delete", respuestas.error("conditionNotMet")); return { ms: 6500, quitar: () => x.quitar() }; }],
    ["500 en cualquier pedido", () => { const x = sim.inyectar(es.todo(), respuestas.error("backendError")); return { ms: 6500, quitar: () => x.quitar() }; }],
    ["500 en la segunda escritura", () => { let k = 0; const x = sim.inyectar((p) => p.metodo !== "GET" && ++k === 2, respuestas.error("backendError")); return { ms: 6500, quitar: () => x.quitar() }; }],
    ["aplica y responde 503", () => { const x = sim.inyectar(es.escritura(), respuestas.aplicarYLuego(respuestas.error("unavailable"))); return { ms: 6500, quitar: () => x.quitar() }; }],
    ["aplica y corta", () => { const x = sim.inyectar(es.escritura(), respuestas.aplicarYCortar()); return { ms: 6500, quitar: () => x.quitar() }; }],
    ["límite de uso", () => { const x = sim.inyectar(es.escritura(), respuestas.error("rateLimitExceeded")); return { ms: 6500, quitar: () => x.quitar() }; }],
  ];

  const bitacora: string[] = [];
  for (let paso = 0; paso < PASOS; paso++) {
    const k = 1 + entero(3);
    for (let i = 0; i < k; i++) {
      const [nombre, , fn] = elegir();
      try {
        const que = await fn();
        if (que) bitacora.push(`${paso}: ${nombre} ${que}`);
      } catch (e) {
        bitacora.push(`${paso}: ${nombre} (no se pudo: ${(e as Error).message.slice(0, 80)})`);
      }
    }
    const [falla, armar] = entero(10) < 6 ? FALLAS[0] : uno(FALLAS.slice(1));
    const f = armar();
    const r = await sincronizar(`paso ${paso} (${falla})`, f.ms);
    f.quitar();
    bitacora.push(`${paso}: sync [${falla}] → ${r.ok ? "ok" : r.error?.codigo}${r.pendiente ? " pendiente" : ""}`);
  }

  // ---- Converger: sin fallas, hasta que no quede nada pendiente; después dos vueltas quietas ----
  sim.limpiarInyecciones();
  for (let i = 0; i < 6; i++) {
    const r = await sincronizar(`final ${i}`, 24_000);
    if (r.ok && !r.pendiente) break;
  }
  await sincronizar("quieta 1", 24_000);
  sim.reiniciarContadores();
  const rq = await sincronizar("quieta 2", 24_000);
  const dif = await h.comparar(fam, con);
  const etiqueta = `semilla ${semilla} (${config.nombre})`;
  const pista = () => bitacora.slice(-12);
  ok(`${etiqueta}: la pared coincide con Google`, rq.ok && !dif.length, { rq, dif: dif.slice(0, 4), pista: pista() });
  ok(`${etiqueta}: una vuelta quieta no escribe nada`, rq.ok && sim.contadores.escrituras === 0, { porTipo: sim.contadores.porTipo, avisos: (await h.estado(fam, con))?.avisos });
  const porUid = new Map<string, number>();
  for (const e of principalesGoogle()) {
    const d = uidDesdeId(e.id);
    if (d) porUid.set(d.uid, (porUid.get(d.uid) ?? 0) + 1);
  }
  const repetidos = [...porUid].filter(([, c]) => c > 1);
  ok(`${etiqueta}: sin duplicados en Google (una sola serie viva por evento del panel)`, !repetidos.length, repetidos);
  ok(`${etiqueta}: nunca PERMISO/INTERNO por errores transitorios ni borrados masivos sin preguntar`, !fallas.length, fallas.slice(0, 5));
  const s = Math.round((Date.now() - t0) / 1000);
  ok(`${etiqueta}: dura menos de 3 minutos (${s} s, ${PASOS} pasos, ${h.vivos(cal).length} eventos vivos en Google)`, s < 180, s);
  if (process.env.FUZZ_VER) console.log(bitacora.join("\n"));
}

seccion(`Fuzz: ${SEMILLAS.length} semillas × ${PASOS} pasos`);
for (const [i, semilla] of SEMILLAS.entries()) {
  try {
    await correr(semilla, CONFIGS[i % CONFIGS.length]);
  } catch (e) {
    ok(`semilla ${semilla} (lanzó)`, false, `${(e as Error)?.name}: ${(e as Error)?.message}\n${(e as Error)?.stack?.split("\n").slice(1, 5).join("\n")}`);
  }
}
await h.terminar();
