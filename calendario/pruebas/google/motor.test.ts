// Pruebas de punta a punta del motor con Google Calendar (plan de pruebas C4, puntos 1 a 11): el motor
// real (servidor/sincronizar.ts, sin cambios de lógica) con el transporte real, el simulador de la API y
// Blobs en memoria. Sin red: todo en 127.0.0.1 (ver pruebas/h.ts).
//
//   cd calendario && node --experimental-transform-types --no-warnings --import ./pruebas/registrar.mjs pruebas/google/motor.test.ts
import * as h from "../h.ts";
import { respuestas, es } from "./mock-google.mts";
import type { Evento } from "../../lib/datos/tipos.ts";

const { ok, seccion, caso, ev, gid } = h;
const sim = await h.arrancar({ semilla: 7 });
const ahoraIso = () => new Date().toISOString();
const avisosDe = async (fam: string, con: ReturnType<typeof h.conexionGoogle>) => (await h.estado(fam, con))?.avisos ?? [];
const porId = async (fam: string, id: string) => (await h.leerEventos(fam)).find((e) => e.id === id);
/** Dos vueltas quietas: la pared igual a Google y la segunda sin escribir nada. */
async function quieto(nombre: string, fam: string, con: ReturnType<typeof h.conexionGoogle>) {
  await h.sync(fam, con);
  sim.reiniciarContadores();
  const r = await h.sync(fam, con);
  const dif = await h.comparar(fam, con);
  ok(`${nombre}: después, una vuelta quieta no escribe y la pared coincide con Google`, r.ok && sim.contadores.escrituras === 0 && !dif.length, {
    r,
    porTipo: sim.contadores.porTipo,
    dif: dif.slice(0, 4),
    avisos: await avisosDe(fam, con),
  });
}

/** Todas las repeticiones que escribe el panel. */
function corpus(): Evento[] {
  return [
    ev("r01", { titulo: "Dentista", lugar: "Clínica", nota: "Llevar la ficha\nY el carnet" }),
    ev("r02", { titulo: "Natación", repeticion: "diaria", fecha: "2026-11-10", repetirHasta: "2026-11-30", excepciones: ["2026-11-22"] }),
    ev("r03", { titulo: "Fútbol", miembros: ["tomi"], repeticion: "semanal", fecha: "2026-11-09", diasSemana: [0, 2, 4], horaInicio: "17:00", horaFin: "18:30" }),
    ev("r04", { titulo: "Piano", repeticion: "semanal", intervalo: 2, fecha: "2026-11-11" }),
    ev("r05", { titulo: "Arriendo", miembros: ["mama"], repeticion: "mensual", fecha: "2026-11-30", horaInicio: "09:00", horaFin: "09:30" }),
    ev("r06", { titulo: "Cierre de mes", miembros: ["mama"], repeticion: "mensual", fecha: "2026-12-31", todoElDia: true, horaInicio: undefined, horaFin: undefined }),
    ev("r07", { titulo: "Cumpleaños de Sofía", repeticion: "anual", fecha: "2028-02-29", todoElDia: true, horaInicio: undefined, horaFin: undefined }),
    ev("r08", { titulo: "Vacaciones", miembros: ["sofi", "tomi"], fecha: "2026-12-20", fechaFin: "2026-12-27", todoElDia: true, horaInicio: undefined, horaFin: undefined }),
    ev("r09", { titulo: "Feriado", miembros: ["sofi", "tomi", "mama"], fecha: "2026-12-08", todoElDia: true, horaInicio: undefined, horaFin: undefined }),
    ev("r10", { titulo: "Remedio", horaFin: undefined, horaInicio: "08:00", repeticion: "diaria", fecha: "2026-11-15", repetirHasta: "2026-11-25" }),
    ev("r11", { titulo: "Inglés", repeticion: "semanal", fecha: "2026-11-12", diasSemana: [3], excepciones: ["2026-11-19", "2026-12-03"], repetirHasta: "2027-01-28" }),
    ev("r12", { titulo: "Viaje", fecha: "2026-11-25", fechaFin: "2026-11-26", horaInicio: "10:00", horaFin: "12:00" }),
    ev("r13", { titulo: "Control", repeticion: "mensual", intervalo: 3, fecha: "2026-11-16", repetirHasta: "2027-11-30" }),
    ev("r14", { titulo: "Aniversario", miembros: ["mama"], repeticion: "anual", fecha: "2026-11-28", horaInicio: "20:00", horaFin: "23:00" }),
    ev("r15", { titulo: "Riego", miembros: ["tomi"], repeticion: "diaria", intervalo: 2, fecha: "2026-11-10", repetirHasta: "2026-12-10" }),
    ev("r16", { titulo: "Medianoche", fecha: "2026-11-21", horaInicio: "23:00", horaFin: "23:59" }),
  ];
}

// =====================================================================================
seccion("1. Ida y vuelta con todas las repeticiones del panel");
const cal1 = h.nuevoCalendario();
const con1 = h.conexionGoogle(cal1);
const fam1 = await h.familia(corpus());
await caso("ida y vuelta", async () => {
  sim.reiniciarContadores();
  const r1 = await h.sync(fam1, con1);
  const vivos = h.vivos(cal1);
  ok("vuelta 1: sube las 16 series", r1.ok && vivos.length === 16 && sim.contadores.porTipo["events.insert"] === 16, {
    r1,
    n: vivos.length,
    porTipo: sim.contadores.porTipo,
    avisos: await avisosDe(fam1, con1),
  });
  const l1 = await h.leerEventos(fam1);
  ok("vuelta 1: todos quedan vinculados a la conexión", l1.every((e) => e.externo?.conexion === con1.id && e.externo.uid === h.uidPanel(e.id)), l1.map((e) => [e.id, e.externo]));
  const titulo = (id: string) => sim.evento(cal1, gid(id))?.summary;
  ok(
    "en Google los títulos llevan el emoji de las personas (y sin emoji si es para todos)",
    titulo("r01") === "🦄 Dentista" && titulo("r03") === "⚽ Fútbol" && /🦄/.test(titulo("r08") ?? "") && /⚽/.test(titulo("r08") ?? "") && titulo("r09") === "Feriado",
    [titulo("r01"), titulo("r03"), titulo("r08"), titulo("r09")],
  );
  ok(
    "las piezas que escribió el panel llevan la marca cfh",
    vivos.every((e) => typeof e.extendedProperties?.private?.cfh === "string"),
    vivos.filter((e) => !e.extendedProperties?.private?.cfh).map((e) => e.id),
  );
  const antes = JSON.stringify(await h.leerEventos(fam1));
  sim.reiniciarContadores();
  const r2 = await h.sync(fam1, con1);
  ok("vuelta 2: 0 escrituras y la pared no cambia", r2.ok && sim.contadores.escrituras === 0 && JSON.stringify(await h.leerEventos(fam1)) === antes, {
    r2,
    porTipo: sim.contadores.porTipo,
    avisos: await avisosDe(fam1, con1),
  });
  sim.reiniciarContadores();
  const r3 = await h.sync(fam1, con1);
  ok("vuelta 3: atajo (1 listado, 0 escrituras)", r3.ok && sim.contadores.api === 1 && sim.contadores.porTipo["events.list"] === 1 && sim.contadores.escrituras === 0, {
    r3,
    porTipo: sim.contadores.porTipo,
  });
  const dif = await h.comparar(fam1, con1);
  ok("la pared coincide con lo que Google tiene (misma huella por serie)", !dif.length, dif.slice(0, 5));
  const est = await h.estado(fam1, con1);
  ok("sin error ni avisos", !est?.error && !est?.avisos?.length, est);
});

// =====================================================================================
seccion("2. Cambios en la pared (uno por vuelta)");
await caso("cambios en la pared", async () => {
  const cambio = async (nombre: string, fn: () => Promise<void>, esperado: Record<string, number>, verificar: () => boolean | Promise<boolean>) => {
    await fn();
    sim.reiniciarContadores();
    const r = await h.sync(fam1, con1);
    const pt = sim.contadores.porTipo;
    const escrituras = Object.entries(pt).filter(([t]) => !/\.(list|get|instances)$/.test(t));
    const calza = escrituras.length === Object.keys(esperado).length && Object.entries(esperado).every(([t, n]) => pt[t] === n);
    ok(`${nombre} → ${Object.entries(esperado).map(([t, n]) => `${n} ${t}`).join(" + ")}`, r.ok && calza && (await verificar()), {
      r,
      porTipo: pt,
      avisos: await avisosDe(fam1, con1),
    });
    sim.reiniciarContadores();
    const r2 = await h.sync(fam1, con1);
    const dif = await h.comparar(fam1, con1);
    ok(`${nombre}: la vuelta siguiente queda estable`, r2.ok && sim.contadores.escrituras === 0 && !dif.length, { porTipo: sim.contadores.porTipo, dif: dif.slice(0, 3) });
  };
  await cambio(
    "título",
    () => h.cambiarEvento(fam1, "r01", { titulo: "Dentista Dr. Pérez" }),
    { "events.patch": 1 },
    () => sim.evento(cal1, gid("r01"))?.summary === "🦄 Dentista Dr. Pérez",
  );
  await cambio(
    "hora",
    () => h.cambiarEvento(fam1, "r03", { horaInicio: "16:00", horaFin: "17:30" }),
    { "events.patch": 1 },
    () => /T16:00:00/.test(sim.evento(cal1, gid("r03"))?.start?.dateTime ?? ""),
  );
  await cambio(
    "«hasta»",
    () => h.cambiarEvento(fam1, "r02", { repetirHasta: "2026-12-15" }),
    { "events.patch": 1 },
    () => (sim.evento(cal1, gid("r02"))?.recurrence ?? []).some((l: string) => /UNTIL=202612/.test(l)),
  );
  await cambio(
    "borrar sólo este día",
    () => h.cambiarEvento(fam1, "r03", (e) => ({ ...e, excepciones: [...(e.excepciones ?? []), "2026-11-18"], actualizado: ahoraIso() })),
    { "events.patch": 1 },
    () => (sim.evento(cal1, gid("r03"))?.recurrence ?? []).some((l: string) => /^EXDATE.*20261118/.test(l)),
  );
  await cambio(
    "borrar la serie",
    () => h.guardarEventos(fam1, (l) => l.filter((e) => e.id !== "r04")).then(() => {}),
    { "events.delete": 1 },
    () => sim.evento(cal1, gid("r04"))?.status === "cancelled",
  );
  await cambio(
    "nota y lugar",
    () => h.cambiarEvento(fam1, "r14", { nota: "Reservar", lugar: "Restorán" }),
    { "events.patch": 1 },
    () => sim.evento(cal1, gid("r14"))?.location === "Restorán" && sim.evento(cal1, gid("r14"))?.description === "Reservar",
  );
  await cambio(
    "evento nuevo en la pared",
    () => h.guardarEventos(fam1, (l) => [...l, ev("r17", { titulo: "Reunión de apoderados", miembros: ["mama"], fecha: "2026-11-27", horaInicio: "19:00", horaFin: "20:30" })]).then(() => {}),
    { "events.insert": 1 },
    () => sim.evento(cal1, gid("r17"))?.summary === "🌸 Reunión de apoderados",
  );
});

await caso("borrar en la pared justo después de subir", async () => {
  // Después de crear o cambiar, la vuelta guarda el etag que tendrá la serie (no null): si la pared la
  // borra antes de que otra vuelta la relea, se borra en Google (antes volvía a aparecer).
  const cal = h.nuevoCalendario();
  const con = h.conexionGoogle(cal);
  const fam = await h.familia([ev("w1", { titulo: "Se queda" })]);
  await h.sync(fam, con);
  const diaCompleto = { todoElDia: true, horaInicio: undefined, horaFin: undefined };
  await h.guardarEventos(fam, (l) => [
    ...l,
    ev("w2", { titulo: "Con error de tipeo" }),
    ev("w3", { titulo: "Serie", repeticion: "semanal", fecha: "2026-11-16" }),
    ev("w4", { titulo: "Paseo", ...diaCompleto }),
    ev("w5", { titulo: "Cumple", repeticion: "anual", fecha: "2026-12-03", ...diaCompleto }),
  ]);
  await h.sync(fam, con);
  const est = await h.estado(fam, con);
  ok("después de crear, el estado ya tiene el etag de cada serie", Object.values(est!.recursos).every((x) => x.etag !== null), est?.recursos);
  await h.guardarEventos(fam, (l) => l.filter((e) => e.id !== "w2"));
  const r1 = await h.sync(fam, con);
  ok("creado y borrado enseguida en la pared → se borra en Google (no vuelve)", r1.ok && !(await porId(fam, "w2")) && sim.evento(cal, gid("w2"))?.status === "cancelled", { r1, l: (await h.leerEventos(fam)).map(h.resumen) });
  await h.cambiarEvento(fam, "w3", { titulo: "Serie (cambiada)", excepciones: ["2026-11-23"] });
  await h.sync(fam, con);
  await h.guardarEventos(fam, (l) => l.filter((e) => e.id !== "w3"));
  const r2 = await h.sync(fam, con);
  ok("cambiado y borrado enseguida en la pared → se borra en Google (no vuelve)", r2.ok && !(await porId(fam, "w3")) && sim.evento(cal, gid("w3"))?.status === "cancelled", { r2, l: (await h.leerEventos(fam)).map(h.resumen) });
  await h.cambiarEvento(fam, "w5", { titulo: "Cumple de la Sofi" });
  await h.sync(fam, con);
  await h.guardarEventos(fam, (l) => l.filter((e) => e.id !== "w4" && e.id !== "w5"));
  const r3 = await h.sync(fam, con);
  ok(
    "de día completo (la zona sale del calendario): también se borran en Google",
    r3.ok && sim.evento(cal, gid("w4"))?.status === "cancelled" && sim.evento(cal, gid("w5"))?.status === "cancelled",
    { r3, l: (await h.leerEventos(fam)).map(h.resumen) },
  );
  await quieto("borrar justo después de subir", fam, con);
});

// =====================================================================================
seccion("3. Cambios en Google (web, iPhone): la pared converge");
await caso("cambios en Google", async () => {
  const web = sim.actor("web", cal1);
  const iphone = sim.actor("iPhone", cal1);
  const desde = async (nombre: string, fn: () => void, verificar: (l: Evento[]) => boolean, detalle?: (l: Evento[]) => unknown) => {
    fn();
    const r = await h.sync(fam1, con1);
    const l = await h.leerEventos(fam1);
    ok(nombre, r.ok && verificar(l), { r, ev: detalle ? detalle(l) : undefined, avisos: await avisosDe(fam1, con1) });
    await quieto(nombre, fam1, con1);
  };
  const de = (l: Evento[], id: string) => l.find((e) => e.id === id);
  await desde(
    "título cambiado en la web",
    () => web.editarTitulo(gid("r01"), "🦄 Dentista (control)"),
    (l) => de(l, "r01")?.titulo === "Dentista (control)" && de(l, "r01")?.miembros.join() === "sofi",
    (l) => de(l, "r01"),
  );
  await desde(
    "día borrado en la web (excepción cancelada)",
    () => web.borrarDia(gid("r02"), "2026-11-12"),
    (l) => !!de(l, "r02")?.excepciones?.includes("2026-11-12") && !!de(l, "r02")?.excepciones?.includes("2026-11-22"),
    (l) => de(l, "r02"),
  );
  await desde(
    "día borrado en el iPhone (EXDATE;TZID)",
    () => iphone.borrarDia(gid("r03"), "2026-11-20"),
    (l) => !!de(l, "r03")?.excepciones?.includes("2026-11-20") && !!de(l, "r03")?.excepciones?.includes("2026-11-18"),
    (l) => de(l, "r03"),
  );
  await desde(
    "día movido en la web → día cambiado en la pared",
    () =>
      web.moverDia(gid("r11"), "2026-11-26", { dateTime: "2026-11-27T18:00:00-03:00", timeZone: "America/Santiago" }, { dateTime: "2026-11-27T19:00:00-03:00", timeZone: "America/Santiago" }),
    (l) => {
      const hijo = l.find((e) => e.externo?.uid === h.uidPanel("r11") && e.externo.recurrencia);
      return !!hijo && hijo.fecha === "2026-11-27" && hijo.horaInicio === "18:00" && !!de(l, "r11")?.excepciones?.includes("2026-11-26");
    },
    (l) => l.filter((e) => e.externo?.uid === h.uidPanel("r11")),
  );
  await desde(
    "nota con formato (HTML) escrita en la web → texto en la pared",
    () => web.editar(gid("r14"), { description: "Reservar mesa\nPara 2 & postre" }),
    (l) => de(l, "r14")?.nota === "Reservar mesa\nPara 2 & postre",
    (l) => [de(l, "r14")?.nota, sim.evento(cal1, gid("r14"))?.description],
  );
  await desde(
    "«este y los siguientes» en la web → dos series en la pared",
    () => web.esteYLosSiguientes(gid("r15"), "2026-11-20", { summary: "⚽ Riego (tarde)", start: { dateTime: "2026-11-20T18:00:00-03:00", timeZone: "America/Santiago" }, end: { dateTime: "2026-11-20T19:00:00-03:00", timeZone: "America/Santiago" } }),
    (l) => {
      const viejo = de(l, "r15");
      const nuevo = l.find((e) => e.titulo === "Riego (tarde)");
      return !!viejo && !!viejo.repetirHasta && viejo.repetirHasta < "2026-11-20" && !!nuevo && nuevo.fecha === "2026-11-20" && nuevo.horaInicio === "18:00" && nuevo.repeticion === "diaria";
    },
    (l) => l.filter((e) => /Riego/.test(e.titulo)).map(h.resumen),
  );
  await desde(
    "serie nueva del iPhone con regla ajena («segundo martes») → fechas sueltas de la serie",
    () =>
      void iphone.crear({
        summary: "⚽ Taller",
        start: { dateTime: "2026-11-10T15:00:00-03:00", timeZone: "America/Santiago" },
        end: { dateTime: "2026-11-10T16:00:00-03:00", timeZone: "America/Santiago" },
        recurrence: ["RRULE:FREQ=MONTHLY;BYDAY=2TU;COUNT=6"],
      }),
    (l) => {
      const t = l.find((e) => e.titulo === "Taller");
      return !!t && t.miembros.join() === "tomi" && !!t.fechas?.length && t.fechas.includes("2026-12-08") && !t.externo?.uid.endsWith("@calendario-familiar");
    },
    (l) => l.filter((e) => e.titulo === "Taller").map(h.resumen),
  );
  await desde(
    "evento suelto en otra zona (Madrid) → la hora correcta en Santiago",
    () =>
      void web.crear({
        summary: "🌸 Llamada a la abuela",
        start: { dateTime: "2026-11-23T20:00:00+01:00", timeZone: "Europe/Madrid" },
        end: { dateTime: "2026-11-23T21:00:00+01:00", timeZone: "Europe/Madrid" },
      }),
    (l) => {
      const t = l.find((e) => e.titulo === "Llamada a la abuela");
      return !!t && t.fecha === "2026-11-23" && t.horaInicio === "16:00" && t.miembros.join() === "mama";
    },
    (l) => l.filter((e) => /abuela/.test(e.titulo)).map(h.resumen),
  );
  await desde(
    "borrado en la web → borrado en la pared",
    () => web.borrar(gid("r16")),
    (l) => !de(l, "r16"),
  );
});

// =====================================================================================
seccion("4. Conflictos y escrituras a medias");
await caso("gana el más reciente", async () => {
  // Google primero (hace 2 minutos), la pared después → gana la pared (todo su grupo).
  sim.reloj.fijar(Date.now() - 120_000);
  sim.actor("web", cal1).editarTitulo(gid("r05"), "🌸 Arriendo (web)");
  sim.reloj.real();
  await h.cambiarEvento(fam1, "r05", { lugar: "Banco" });
  const r1 = await h.sync(fam1, con1);
  const g1 = sim.evento(cal1, gid("r05"));
  ok("cambió en los dos lados, la pared después → gana la pared", r1.ok && g1?.location === "Banco" && g1?.summary === "🌸 Arriendo", [g1?.summary, g1?.location, await porId(fam1, "r05")]);
  await quieto("gana la pared", fam1, con1);
  // La pared primero (hace 2 minutos), Google después → gana Google.
  await h.cambiarEvento(fam1, "r13", { lugar: "Consultorio", actualizado: new Date(Date.now() - 120_000).toISOString() });
  sim.actor("web", cal1).editarTitulo(gid("r13"), "🦄 Control (web)");
  const r2 = await h.sync(fam1, con1);
  const p2 = await porId(fam1, "r13");
  ok(
    "cambió en los dos lados, Google después → gana Google",
    r2.ok && p2?.titulo === "Control (web)" && !p2?.lugar && !sim.evento(cal1, gid("r13"))?.location,
    [p2, sim.evento(cal1, gid("r13"))?.summary],
  );
  await quieto("gana Google", fam1, con1);
});

await caso("título de la serie y lugar de un día cambiado en la misma tanda (Google pasa o no el título a las excepciones)", async () => {
  // Los PATCH de las excepciones van antes que el del principal: si Google pasa el título nuevo a las
  // excepciones, el If-Match del día ya se usó y su cambio no se pierde (antes daba 412 y la vuelta
  // siguiente traía lo de Google sin el lugar).
  for (const propagar of [false, true]) {
    sim.interruptores.propagarTituloAExcepciones = propagar;
    try {
      const cal = h.nuevoCalendario();
      const con = h.conexionGoogle(cal);
      const fam = await h.familia([ev("p1", { titulo: "Piano", repeticion: "semanal", fecha: "2026-11-16", horaInicio: "17:00", horaFin: "18:00" })]);
      await h.sync(fam, con);
      sim
        .actor("web", cal)
        .moverDia(gid("p1"), "2026-11-23", { dateTime: "2026-11-23T19:00:00-03:00", timeZone: "America/Santiago" }, { dateTime: "2026-11-23T20:00:00-03:00", timeZone: "America/Santiago" });
      await h.sync(fam, con);
      await h.dormir(1100); // (`updated` va en segundos: que la pared sea claramente posterior)
      await h.cambiarEvento(fam, "p1", { titulo: "Piano con la tía" });
      const dia = (await h.leerEventos(fam)).find((e) => e.externo?.recurrencia);
      if (!dia) throw new Error("no llegó el día cambiado");
      await h.cambiarEvento(fam, dia.id, { lugar: "Casa de la tía" });
      sim.reiniciarContadores();
      const r = await h.sync(fam, con);
      await h.sync(fam, con);
      const l = await h.leerEventos(fam);
      const g = h.vivos(cal).filter((e) => e.recurringEventId);
      ok(
        `${propagar ? "Google pasa" : "Google no pasa"} el título: el lugar del día queda en la pared y en Google, y la serie con su título nuevo`,
        r.ok && l.find((e) => e.id === dia.id)?.lugar === "Casa de la tía" && g.length === 1 && g[0].location === "Casa de la tía" && sim.evento(cal, gid("p1"))?.summary === "🦄 Piano con la tía" && !sim.contadores.status?.["412"],
        { r, l: l.map(h.resumen), g: g.map((e) => [e.summary, e.location]), status: sim.contadores.status },
      );
      await quieto(`título y día cambiado (${propagar ? "con" : "sin"} propagación)`, fam, con);
    } finally {
      sim.interruptores.propagarTituloAExcepciones = false;
    }
  }
});

await caso("título de la serie y borrar un día cambiado en la misma tanda (Google pasa o no el título a las excepciones)", async () => {
  // La cancelación del día cambiado va antes que el PATCH del principal: si Google pasa el título nuevo a las
  // excepciones, el If-Match del día ya se usó. Antes el principal iba primero, la cancelación daba 412 y la
  // vuelta siguiente hacía reaparecer el día borrado (lo de Google era más reciente).
  for (const propagar of [false, true]) {
    sim.interruptores.propagarTituloAExcepciones = propagar;
    try {
      const cal = h.nuevoCalendario();
      const con = h.conexionGoogle(cal);
      const fam = await h.familia([ev("p2", { titulo: "Guitarra", repeticion: "semanal", fecha: "2026-11-16", horaInicio: "17:00", horaFin: "18:00" })]);
      await h.sync(fam, con);
      sim
        .actor("web", cal)
        .moverDia(gid("p2"), "2026-11-23", { dateTime: "2026-11-23T19:00:00-03:00", timeZone: "America/Santiago" }, { dateTime: "2026-11-23T20:00:00-03:00", timeZone: "America/Santiago" });
      await h.sync(fam, con);
      const dia = (await h.leerEventos(fam)).find((e) => e.externo?.recurrencia);
      if (!dia) throw new Error("no llegó el día cambiado");
      await h.dormir(1100); // (`updated` va en segundos: que la pared sea claramente posterior)
      await h.guardarEventos(fam, (x) =>
        x.filter((e) => e.id !== dia.id).map((e) => (e.id === "p2" ? { ...e, titulo: "Guitarra eléctrica", excepciones: [...(e.excepciones ?? []), "2026-11-23"], actualizado: ahoraIso() } : e)),
      );
      sim.reiniciarContadores();
      const r = await h.sync(fam, con);
      await h.sync(fam, con);
      const l = await h.leerEventos(fam);
      const vivosDia = h.vivos(cal).filter((e) => e.recurringEventId && e.status !== "cancelled");
      ok(
        `${propagar ? "Google pasa" : "Google no pasa"} el título: el día borrado no reaparece (ni en la pared ni en Google) y la serie queda con su título nuevo`,
        r.ok &&
          l.length === 1 &&
          l[0].titulo === "Guitarra eléctrica" &&
          (l[0].excepciones ?? []).includes("2026-11-23") &&
          !vivosDia.length &&
          sim.evento(cal, gid("p2"))?.summary === "🦄 Guitarra eléctrica" &&
          !sim.contadores.status?.["412"],
        { r, l: l.map(h.resumen), vivosDia: vivosDia.map((e) => [e.id, e.summary, e.status]), status: sim.contadores.status },
      );
      await quieto(`título y día cambiado borrado (${propagar ? "con" : "sin"} propagación)`, fam, con);
    } finally {
      sim.interruptores.propagarTituloAExcepciones = false;
    }
  }
});

await caso("escritura a medias (TIEMPO entre un día cambiado y el principal)", async () => {
  // Una serie con un día cambiado hecho en la web; en la pared se cambian la serie y ese día a la vez:
  // son 2 PATCH, primero el del día y después el del principal. El segundo no alcanza (TIEMPO). La marca
  // cfh hace que lo ya escrito por el panel no le gane a la pared: la vuelta siguiente termina el cambio en
  // vez de revertirlo.
  const prepara = async () => {
    const cal = h.nuevoCalendario();
    const con = h.conexionGoogle(cal);
    const fam = await h.familia([ev("m1", { titulo: "Inglés", repeticion: "semanal", fecha: "2026-11-12", repetirHasta: "2027-01-28" })]);
    await h.sync(fam, con);
    sim.reloj.fijar(Date.now() - 300_000);
    const hijo = sim
      .actor("web", cal)
      .moverDia(gid("m1"), "2026-11-26", { dateTime: "2026-11-27T18:00:00-03:00", timeZone: "America/Santiago" }, { dateTime: "2026-11-27T19:00:00-03:00", timeZone: "America/Santiago" });
    sim.reloj.real();
    await h.sync(fam, con);
    const l = await h.leerEventos(fam);
    const dia = l.find((e) => e.externo?.recurrencia);
    if (!dia) throw new Error("no llegó el día cambiado");
    // La pared cambia hace 1 minuto (después del día cambiado de la web, antes de que el panel escriba):
    // sin la marca, lo que el panel alcance a escribir quedaría "más reciente" que la pared.
    const hace1min = new Date(Date.now() - 60_000).toISOString();
    await h.guardarEventos(fam, (x) =>
      x.map((e) => (e.id === "m1" ? { ...e, titulo: "Inglés avanzado", actualizado: hace1min } : e.id === dia.id ? { ...e, lugar: "Sala 2", actualizado: hace1min } : e)),
    );
    return { cal, con, fam, hijo, dia };
  };

  const a = await prepara();
  const freno = sim.inyectar((p) => p.tipo === "events.patch" && p.eventoId === gid("m1"), respuestas.demora(15_000));
  sim.reiniciarContadores();
  const r1 = await h.sync(a.fam, a.con, 5000);
  freno.quitar();
  const principal = sim.evento(a.cal, gid("m1"));
  const l1 = await h.leerEventos(a.fam);
  ok(
    "vuelta cortada: el día quedó escrito, el principal no; sin error y pendiente",
    r1.ok && r1.pendiente === true && principal?.summary === "🦄 Inglés" && sim.evento(a.cal, a.hijo.id)?.location === "Sala 2" && freno.disparos === 1,
    { r1, porTipo: sim.contadores.porTipo, principal: principal?.summary, dia: sim.evento(a.cal, a.hijo.id)?.location },
  );
  ok("…y la pared no se revirtió", l1.find((e) => e.id === "m1")?.titulo === "Inglés avanzado" && l1.find((e) => e.id === a.dia.id)?.lugar === "Sala 2", l1.map(h.resumen));
  const r2 = await h.sync(a.fam, a.con);
  const l2 = await h.leerEventos(a.fam);
  ok(
    "la vuelta siguiente retoma: Google termina con los dos cambios y la pared no se revierte (marca cfh)",
    r2.ok && sim.evento(a.cal, a.hijo.id)?.location === "Sala 2" && sim.evento(a.cal, gid("m1"))?.summary === "🦄 Inglés avanzado" && l2.find((e) => e.id === a.dia.id)?.lugar === "Sala 2",
    { r2, hijo: sim.evento(a.cal, a.hijo.id), avisos: await avisosDe(a.fam, a.con) },
  );
  await quieto("escritura a medias retomada", a.fam, a.con);

  // Lo mismo, pero un iPhone vuelve a guardar la serie y borra las extendedProperties (la marca): el
  // principal pasa a ser "ajeno" y más reciente que la pared → gana Google y se pierde lo que no alcanzó
  // (el título); el día, que sí alcanzó, queda.
  const b = await prepara();
  const freno2 = sim.inyectar((p) => p.tipo === "events.patch" && p.eventoId === gid("m1"), respuestas.demora(15_000));
  await h.sync(b.fam, b.con, 5000);
  freno2.quitar();
  sim.interruptores.extendedPropsSeConservan = false;
  sim.actor("iPhone", b.cal).editar(gid("m1"), {});
  sim.interruptores.extendedPropsSeConservan = true;
  await h.sync(b.fam, b.con);
  const l3 = await h.leerEventos(b.fam);
  ok(
    "sin la marca (un iPhone borró las extendedProperties) gana Google: la serie vuelve a lo de Google y el día que sí alcanzó queda (documentado en RIESGOS)",
    l3.find((e) => e.id === "m1")?.titulo === "Inglés" && l3.find((e) => e.id === b.dia.id)?.lugar === "Sala 2" && sim.evento(b.cal, b.hijo.id)?.location === "Sala 2",
    l3.map(h.resumen),
  );
  await quieto("sin marca", b.fam, b.con);
});

await caso("recrear una serie con días cambiados y TIEMPO entre pasos", async () => {
  // Borrada en Google y cambiada en la pared → se vuelve a crear (gen1) y después se escribe el día
  // cambiado (PATCH de su instancia). Si eso no alcanza, el día queda como un día normal, con aviso.
  const cal = h.nuevoCalendario();
  const con = h.conexionGoogle(cal);
  const fam = await h.familia([ev("m2", { titulo: "Yoga", repeticion: "semanal", fecha: "2026-11-13", repetirHasta: "2027-01-29" })]);
  await h.sync(fam, con);
  sim.reloj.fijar(Date.now() - 300_000);
  sim
    .actor("web", cal)
    .moverDia(gid("m2"), "2026-11-27", { dateTime: "2026-11-28T09:00:00-03:00", timeZone: "America/Santiago" }, { dateTime: "2026-11-28T10:00:00-03:00", timeZone: "America/Santiago" });
  sim.actor("web", cal).borrar(gid("m2"));
  sim.reloj.real();
  // (la pared se entera del día cambiado antes de que se borre: se lee en una vuelta intermedia)
  sim.actor("web", cal).restaurar(gid("m2"));
  await h.sync(fam, con);
  sim.actor("web", cal).borrar(gid("m2"));
  await h.cambiarEvento(fam, "m2", { titulo: "Yoga suave" });
  const freno = sim.inyectar(es.tipo("events.instances"), respuestas.demora(15_000));
  const r = await h.sync(fam, con, 5000);
  freno.quitar();
  const nuevo = sim.evento(cal, gid("m2", 1));
  const avisos = await avisosDe(fam, con);
  ok(
    "se recreó con gen1 y el día cambiado que no alcanzó queda con aviso «no se alcanzó a pasar… quedó como un día normal» (sin decir que dejó de ser parte de la serie)",
    r.ok &&
      nuevo?.status === "confirmed" &&
      nuevo.summary === "🦄 Yoga suave" &&
      avisos.some((a) => /no se alcanzó a pasar a Google Calendar el cambio del día 27-11-2026; quedó como un día normal/.test(a)) &&
      !avisos.some((a) => /ya no es parte de la serie/.test(a)),
    { r, nuevo: nuevo?.summary, avisos, disparos: freno.disparos },
  );
  await quieto("recrear con días cambiados", fam, con);
  const l = await h.leerEventos(fam);
  ok("la pared quedó como Google: la serie sin el día cambiado (sin duplicados)", l.length === 1 && l[0].titulo === "Yoga suave" && !l[0].excepciones?.includes("2026-11-27"), l.map(h.resumen));
});

await caso("recrear una serie con días cambiados y una falla pasajera en el día", async () => {
  // Borrada en Google y cambiada en la pared → se vuelve a crear y el día cambiado es un GET de instances y
  // un PATCH de la instancia. Un 5xx (o un límite de uso, o un corte de red) en esos pedidos se reintenta una
  // vez si queda plazo. Si vuelve a fallar, el día queda normal y el aviso dice que no se alcanzó a pasar.
  for (const veces of [1, 2]) {
    const cal = h.nuevoCalendario();
    const con = h.conexionGoogle(cal);
    const fam = await h.familia([ev("t1", { titulo: "Taller", repeticion: "semanal", fecha: "2026-11-16", horaInicio: "17:00", horaFin: "18:00" })]);
    await h.sync(fam, con);
    sim
      .actor("web", cal)
      .moverDia(gid("t1"), "2026-11-23", { dateTime: "2026-11-23T19:00:00-03:00", timeZone: "America/Santiago" }, { dateTime: "2026-11-23T20:00:00-03:00", timeZone: "America/Santiago" });
    await h.sync(fam, con);
    sim.actor("web", cal).borrar(gid("t1"));
    await h.cambiarEvento(fam, "t1", { lugar: "Sala nueva" });
    const inj = sim.inyectar(es.tipo("events.patch"), respuestas.error("backendError"), veces);
    const r = await h.sync(fam, con);
    inj.quitar();
    const avisos = await avisosDe(fam, con);
    await h.sync(fam, con);
    const l = await h.leerEventos(fam);
    const dia = l.find((e) => e.externo?.recurrencia === "2026-11-23");
    const enGoogle = h.vivos(cal).find((e) => e.recurringEventId === gid("t1", 1));
    const detalle = { r, disparos: inj.disparos, avisos, l: l.map(h.resumen), enGoogle: enGoogle?.start };
    if (veces === 1) {
      ok(
        "un 503 en el PATCH del día → se reintenta: el día sigue a las 19:00, en la pared y en Google, sin aviso",
        r.ok && inj.disparos === 1 && dia?.horaInicio === "19:00" && /T19:00/.test(enGoogle?.start?.dateTime ?? "") && !avisos.some((a) => /23-11-2026/.test(a)),
        detalle,
      );
    } else {
      ok(
        "dos 503 seguidos → el día queda normal, con el aviso «no se alcanzó a pasar… quedó como un día normal»",
        r.ok && inj.disparos === 2 && !dia && avisos.some((a) => /"🦄 Taller": no se alcanzó a pasar a Google Calendar el cambio del día 23-11-2026; quedó como un día normal\./.test(a)),
        detalle,
      );
    }
    await quieto(`recrear con una falla pasajera (${veces})`, fam, con);
  }
});

// =====================================================================================
seccion("5. Borrados masivos y permisos");
const diez = () => Array.from({ length: 10 }, (_, i) => ev(`b${i}`, { titulo: `Clase ${i}`, fecha: `2026-12-${String(i + 1).padStart(2, "0")}` }));
await caso("borrar 6 de 10 en Google", async () => {
  for (const resolver of ["borrar", "recuperar"] as const) {
    const cal = h.nuevoCalendario();
    const con = h.conexionGoogle(cal);
    const fam = await h.familia(diez());
    await h.sync(fam, con);
    for (let i = 0; i < 6; i++) sim.actor("web", cal).borrar(gid(`b${i}`));
    const r = await h.sync(fam, con);
    ok(
      `[${resolver}] pregunta antes de borrar del panel, con el nombre del proveedor`,
      !r.ok && r.error?.codigo === "MUCHOS_BORRADOS_ICLOUD" && r.error.mensaje === "Desaparecieron de Google Calendar 6 eventos. ¿Se borran también del panel?" && (await h.leerEventos(fam)).length === 10,
      r,
    );
    const r2 = await h.sync(fam, con, 6500, resolver);
    const l = await h.leerEventos(fam);
    if (resolver === "borrar") ok("«borrar»: quedan 4 en la pared y en Google", r2.ok && l.length === 4 && h.vivos(cal).length === 4, { r2, n: l.length, g: h.vivos(cal).length });
    else {
      await h.sync(fam, con);
      ok(
        "«recuperar»: los 6 vuelven a Google (gen1) y la pared sigue con 10, sin duplicados",
        r2.ok && (await h.leerEventos(fam)).length === 10 && h.vivos(cal).length === 10 && sim.evento(cal, gid("b0", 1))?.status === "confirmed",
        { r2, n: (await h.leerEventos(fam)).length, g: h.vivos(cal).map((e) => e.summary), avisos: await avisosDe(fam, con) },
      );
    }
    await quieto(`borrados en Google (${resolver})`, fam, con);
  }
});

await caso("borrar 6 de 10 en la pared", async () => {
  const cal = h.nuevoCalendario();
  const con = h.conexionGoogle(cal);
  const fam = await h.familia(diez());
  await h.sync(fam, con);
  await h.guardarEventos(fam, (l) => l.slice(6));
  sim.reiniciarContadores();
  const r = await h.sync(fam, con);
  ok(
    "pregunta antes de borrar de Google, con el nombre del proveedor",
    !r.ok && r.error?.codigo === "MUCHOS_BORRADOS_PANEL" && r.error.mensaje === "Se borraron del panel 6 eventos que están en Google Calendar. ¿Se borran también de los iPhone?" && h.vivos(cal).length === 10 && sim.contadores.escrituras === 0,
    r,
  );
  const r2 = await h.sync(fam, con, 6500, "borrar");
  ok("«borrar»: 6 DELETE y quedan 4 en Google", r2.ok && h.vivos(cal).length === 4 && sim.contadores.porTipo["events.delete"] === 6, { r2, porTipo: sim.contadores.porTipo });
  await quieto("borrados en la pared", fam, con);
});

await caso("rol que no alcanza o calendario que se dejó de compartir", async () => {
  const cal = h.nuevoCalendario();
  const con = h.conexionGoogle(cal);
  const fam = await h.familia(diez());
  await h.sync(fam, con);
  const antes = JSON.stringify(await h.leerEventos(fam));
  for (const [rol, codigo, texto] of [
    ["reader", "PERMISO", /compartido solo para ver/],
    ["freeBusyReader", "PERMISO", /compartido solo para ver/],
    ["writerWithoutPrivateAccess", "PERMISO", /disponible\/ocupado/],
    ["none", "NO_ENCONTRADO", /No encontramos el calendario/],
  ] as const) {
    sim.compartir(cal, h.SA, rol);
    sim.reiniciarContadores();
    const r = await h.sync(fam, con);
    ok(
      `rol ${rol} → ${codigo} visible, sin borrar nada de la pared ni escribir en Google`,
      !r.ok && r.error?.codigo === codigo && texto.test(r.error.mensaje) && JSON.stringify(await h.leerEventos(fam)) === antes && sim.contadores.escrituras === 0,
      r,
    );
  }
  sim.compartir(cal, h.SA, "owner");
  sim.reiniciarContadores();
  const r = await h.sync(fam, con);
  ok("al volver a compartir: sin error y sin escribir nada", r.ok && !r.error && sim.contadores.escrituras === 0 && JSON.stringify(await h.leerEventos(fam)) === antes, { r, porTipo: sim.contadores.porTipo });
});

// =====================================================================================
seccion("6. Lápidas");
await caso("borrado en Google y cambiado en la pared → se vuelve a crear", async () => {
  for (const lapidaOcupaId of [true, false]) {
    sim.interruptores.lapidaOcupaId = lapidaOcupaId;
    const cal = h.nuevoCalendario();
    const con = h.conexionGoogle(cal);
    const fam = await h.familia([ev("l1", { titulo: "Teatro" }), ev("l2", { titulo: "Cine" })]);
    await h.sync(fam, con);
    sim.actor("web", cal).borrar(gid("l1"));
    await h.cambiarEvento(fam, "l1", { titulo: "Teatro (función 2)" });
    const r = await h.sync(fam, con);
    const g = lapidaOcupaId ? sim.evento(cal, gid("l1", 1)) : sim.evento(cal, gid("l1"));
    const l = await h.leerEventos(fam);
    const avisos = await avisosDe(fam, con);
    ok(
      `lapidaOcupaId=${lapidaOcupaId}: ${lapidaOcupaId ? "gen1" : "el mismo id"}, vinculado al mismo UID y sin «se movió a otro calendario»`,
      r.ok &&
        g?.status === "confirmed" &&
        g.summary === "🦄 Teatro (función 2)" &&
        l.filter((e) => /Teatro/.test(e.titulo)).length === 1 &&
        l.find((e) => e.id === "l1")?.externo?.uid === h.uidPanel("l1") &&
        !avisos.some((a) => /se movió/.test(a)) &&
        h.vivos(cal).length === 2,
      { r, g: g && { id: g.id, status: g.status, summary: g.summary }, l: l.map(h.resumen), avisos },
    );
    await quieto(`lápida (lapidaOcupaId=${lapidaOcupaId})`, fam, con);
  }
  sim.interruptores.lapidaOcupaId = true;
});

// =====================================================================================
seccion("7. Idempotencia y reconexión");
await caso("desconectar y volver a conectar", async () => {
  const cal = h.nuevoCalendario();
  const con = h.conexionGoogle(cal);
  const fam = await h.familia(corpus().slice(0, 8));
  await h.sync(fam, con);
  sim.actor("iPhone", cal).crear({ summary: "⚽ Partido", start: { dateTime: "2026-11-29T11:00:00-03:00", timeZone: "America/Santiago" }, end: { dateTime: "2026-11-29T12:30:00-03:00", timeZone: "America/Santiago" } });
  sim.actor("web", cal).crear({ summary: "🌸 Peluquería", start: { date: "2026-11-30" }, end: { date: "2026-12-01" } });
  await h.sync(fam, con);
  const nPared = (await h.leerEventos(fam)).length;
  const nGoogle = h.vivos(cal).length;
  await h.desconectar(fam, con);
  ok("desconectado: los eventos quedan en la pared sin vínculo", (await h.leerEventos(fam)).every((e) => !e.externo), (await h.leerEventos(fam)).map((e) => e.externo));
  const con2 = h.conexionGoogle(cal, "con2");
  sim.reiniciarContadores();
  const r = await h.sync(fam, con2);
  const l = await h.leerEventos(fam);
  ok(
    "al volver a conectar: 0 duplicados (tampoco los creados en el iPhone o la web) y todo vinculado a la conexión nueva",
    r.ok && l.length === nPared && h.vivos(cal).length === nGoogle && sim.contadores.porTipo["events.insert"] === undefined && l.every((e) => e.externo?.conexion === "con2"),
    { r, nPared, n: l.length, nGoogle, g: h.vivos(cal).length, porTipo: sim.contadores.porTipo, l: l.map((e) => [e.id, e.externo]) },
  );
  await quieto("reconectar", fam, con2);
});

await caso("conectar sin subir lo que ya está", async () => {
  const cal = h.nuevoCalendario();
  const con = h.conexionGoogle(cal);
  const fam = await h.familia(corpus().slice(0, 5));
  sim.actor("web", cal).crear({ summary: "🦄 Ya estaba en Google", start: { date: "2026-12-02" }, end: { date: "2026-12-03" } });
  await h.conectarSinSubir(fam, con);
  sim.reiniciarContadores();
  const r = await h.sync(fam, con);
  const l = await h.leerEventos(fam);
  ok(
    "los de la pared quedan «sólo en la pared» y lo de Google llega a la pared",
    r.ok && sim.contadores.porTipo["events.insert"] === undefined && l.filter((e) => e.soloPanel).length === 5 && l.some((e) => e.titulo === "Ya estaba en Google" && e.externo) && h.vivos(cal).length === 1,
    { r, porTipo: sim.contadores.porTipo, l: l.map(h.resumen) },
  );
  await quieto("conectar sin subir", fam, con);
});

await caso("evento de fechas sueltas sin vínculo", async () => {
  // La serie «segundo martes» de la sección 3 está en la pared como fechas sueltas. Se desconecta, se borra
  // en Google y se vuelve a conectar sin su par: la API la deja «sólo en la pared» (plan §3, soloPanelInicial).
  const cal = h.nuevoCalendario();
  const con = h.conexionGoogle(cal);
  const fam = await h.familia([]);
  const t = sim.actor("iPhone", cal).crear({
    summary: "⚽ Taller",
    start: { dateTime: "2026-11-10T15:00:00-03:00", timeZone: "America/Santiago" },
    end: { dateTime: "2026-11-10T16:00:00-03:00", timeZone: "America/Santiago" },
    recurrence: ["RRULE:FREQ=MONTHLY;BYDAY=2TU;COUNT=6"],
  });
  await h.sync(fam, con);
  await h.desconectar(fam, con);
  sim.actor("web", cal).borrar(t.id);
  const conSueltas = (await h.leerEventos(fam)).filter((e) => e.fechas?.length).map((e) => e.id);
  const con2 = h.conexionGoogle(cal, "con2");
  await S_guardarSoloPanel(fam, con2, conSueltas);
  sim.reiniciarContadores();
  const r = await h.sync(fam, con2);
  const l = await h.leerEventos(fam);
  ok(
    "queda sólo en la pared (no se aplana como evento nuevo en Google)",
    r.ok && conSueltas.length === 1 && l.length === 1 && l[0].soloPanel === true && !l[0].externo && h.vivos(cal).length === 0 && sim.contadores.escrituras === 0,
    { r, conSueltas, l: l.map(h.resumen), porTipo: sim.contadores.porTipo },
  );
});
async function S_guardarSoloPanel(fam: string, con: ReturnType<typeof h.conexionGoogle>, ids: string[]) {
  await h.S.guardarEstado(fam, con.id, { recursos: {}, soloPanelInicial: ids });
  await h.registrarConexion(fam, con);
}

// =====================================================================================
seccion("8. Plazos");
await caso("latencia de 300 ms y 40 series cambiadas", async () => {
  const cal = h.nuevoCalendario();
  const con = h.conexionGoogle(cal);
  const fam = await h.familia(Array.from({ length: 40 }, (_, i) => ev(`p${i}`, { titulo: `Cita ${i}`, fecha: `2027-01-${String((i % 28) + 1).padStart(2, "0")}` })));
  await h.sync(fam, con, 24_000);
  await h.guardarEventos(fam, (l) => l.map((e) => ({ ...e, titulo: e.titulo + " (cambiada)", actualizado: ahoraIso() })));
  sim.latenciaMs = 300;
  sim.reiniciarContadores();
  const t0 = Date.now();
  const r1 = await h.sync(fam, con, 6500);
  const ms = Date.now() - t0;
  const enGoogle = h.vivos(cal).filter((e) => /\(cambiada\)/.test(e.summary)).length;
  const l1 = await h.leerEventos(fam);
  ok(
    "función normal (6,5 s): sube una parte, queda pendiente, sin error y la pared no se revierte",
    r1.ok && r1.pendiente === true && !r1.error && enGoogle > 0 && enGoogle < 40 && l1.every((e) => /\(cambiada\)/.test(e.titulo)) && ms < 6500,
    { r1, ms, enGoogle, porTipo: sim.contadores.porTipo },
  );
  const r2 = await h.sync(fam, con, 24_000);
  sim.latenciaMs = 0;
  ok("la programada (24 s) termina: las 40 en Google", r2.ok && !r2.pendiente && h.vivos(cal).filter((e) => /\(cambiada\)/.test(e.summary)).length === 40, { r2, enGoogle: h.vivos(cal).filter((e) => /\(cambiada\)/.test(e.summary)).length });
  await quieto("plazos", fam, con);
});

await caso("cambio de año: se relee todo una vez, sin pedidos extra a Google", async () => {
  const est = await h.estado(fam1, con1);
  await h.S.guardarEstado(fam1, con1.id, { ...est!, ventana: JSON.stringify({ desde: "2024-01-01", hasta: "2027-12-31" }) });
  sim.reiniciarContadores();
  const r = await h.sync(fam1, con1);
  const despues = await h.estado(fam1, con1);
  ok(
    "1 listado, 0 escrituras y la ventana nueva anotada",
    r.ok && sim.contadores.porTipo["events.list"] === 1 && sim.contadores.api === 1 && sim.contadores.escrituras === 0 && despues?.ventana === est?.ventana && Object.values(despues!.recursos).every((x) => x.etag !== null),
    { r, porTipo: sim.contadores.porTipo },
  );
  sim.reiniciarContadores();
  await h.sync(fam1, con1);
  ok("…y la vuelta siguiente es el atajo", sim.contadores.api === 1 && sim.contadores.escrituras === 0, sim.contadores.porTipo);
});

// =====================================================================================
seccion("9. Errores transitorios y de clave");
await caso("límite de uso en un PATCH", async () => {
  for (const tipo of ["rateLimitExceeded", "userRateLimitExceeded", "rateLimit429", "backendError"]) {
    await h.cambiarEvento(fam1, "r09", { titulo: `Feriado ${tipo}` });
    const inj = sim.inyectar(es.tipo("events.patch"), respuestas.error(tipo));
    const r = await h.sync(fam1, con1);
    inj.quitar();
    const p = await porId(fam1, "r09");
    ok(
      `${tipo}: el cambio de la pared se conserva, se muestra el error (SERVIDOR, nunca PERMISO)`,
      !r.ok && r.error?.codigo === "SERVIDOR" && p?.titulo === `Feriado ${tipo}` && inj.disparos === 1,
      { r, p: p && h.resumen(p) },
    );
    // «Se reintenta solo» lo agrega la sincronización (que sí reintenta), sólo a un límite de uso.
    ok(
      `${tipo}: el texto del error ${tipo === "backendError" ? "no promete reintentos" : "dice que se reintenta solo"}`,
      tipo === "backendError"
        ? !/reintenta/.test(r.error?.mensaje ?? "")
        : r.error?.mensaje === "Google Calendar pidió esperar un momento (límite de uso). Se reintenta solo.",
      r.error,
    );
    const r2 = await h.sync(fam1, con1);
    ok(`${tipo}: la vuelta siguiente lo sube`, r2.ok && !r2.error && sim.evento(cal1, gid("r09"))?.summary === `Feriado ${tipo}`, { r2, g: sim.evento(cal1, gid("r09"))?.summary });
  }
  await quieto("errores transitorios", fam1, con1);
});

await caso("límite de uso o caída al listar", async () => {
  const antes = JSON.stringify(await h.leerEventos(fam1));
  for (const tipo of ["quotaExceeded", "rateLimit429", "unavailable"]) {
    await h.guardarEventos(fam1, (l) => l); // (sin cambios: fuerza a no tomar el atajo sólo si cambió la versión)
    const inj = sim.inyectar(es.tipo("events.list"), respuestas.error(tipo), 50);
    const r = await h.sync(fam1, con1);
    inj.quitar();
    ok(`${tipo} al listar → SERVIDOR y nada se borra`, !r.ok && r.error?.codigo === "SERVIDOR" && JSON.stringify(await h.leerEventos(fam1)) === antes, r);
  }
  const r = await h.sync(fam1, con1);
  ok("…después, sin error", r.ok && !r.error, r);
});

await caso("API deshabilitada, clave rechazada y sin clave", async () => {
  const antes = JSON.stringify(await h.leerEventos(fam1));
  const inj = sim.inyectar(es.tipo("events.list"), respuestas.error("accessNotConfigured"), 50);
  await h.cambiarEvento(fam1, "r09", { lugar: "Casa" });
  const r1 = await h.sync(fam1, con1);
  inj.quitar();
  ok("accessNotConfigured → CONFIGURACION", !r1.ok && r1.error?.codigo === "CONFIGURACION" && /Google Calendar API/.test(r1.error.mensaje), r1);
  sim.token.opciones.deshabilitadas = new Set([h.SA]);
  sim.revocarTokens();
  const { olvidarTokens } = await import("../../servidor/google/cuenta.ts");
  olvidarTokens();
  const r2 = await h.sync(fam1, con1);
  sim.token.opciones.deshabilitadas = new Set();
  ok("cuenta de servicio deshabilitada → CLAVE, sin tocar la pared", !r2.ok && r2.error?.codigo === "CLAVE", r2);
  const guardada = process.env.GOOGLE_CUENTA_SERVICIO;
  delete process.env.GOOGLE_CUENTA_SERVICIO;
  const r3 = await h.sync(fam1, con1);
  process.env.GOOGLE_CUENTA_SERVICIO = guardada;
  ok(
    "sin GOOGLE_CUENTA_SERVICIO → SIN_CUENTA con el texto de Google",
    !r3.ok && r3.error?.codigo === "SIN_CUENTA" && r3.error.mensaje === "Falta configurar la cuenta de servicio de Google en el servidor (GOOGLE_CUENTA_SERVICIO).",
    r3,
  );
  const r4 = await h.sync(fam1, con1);
  ok("con la clave de vuelta: sube el cambio pendiente y sin error", r4.ok && sim.evento(cal1, gid("r09"))?.location === "Casa", { r4, l: sim.evento(cal1, gid("r09"))?.location });
  ok("la pared nunca perdió nada", (await h.leerEventos(fam1)).length === JSON.parse(antes).length);
});

// =====================================================================================
seccion("10. Eventos que no se pueden cambiar desde la pared");
await caso("invitaciones, cumpleaños y rechazos de Google", async () => {
  const inv = sim.actor("invitación", cal1).crear({
    summary: "Reunión de trabajo",
    start: { dateTime: "2026-11-25T19:00:00-03:00", timeZone: "America/Santiago" },
    end: { dateTime: "2026-11-25T20:00:00-03:00", timeZone: "America/Santiago" },
  });
  sim.actor("cumpleaños", cal1).crear({ summary: "Cumpleaños de Pedro", fecha: "2026-12-12" });
  await h.sync(fam1, con1);
  const l = await h.leerEventos(fam1);
  const pared = l.find((e) => e.titulo === "Reunión de trabajo");
  ok("la invitación se ve en la pared; el cumpleaños de Gmail (eventType) nunca", !!pared && !l.some((e) => /Pedro/.test(e.titulo)), l.map((e) => e.titulo));
  await h.cambiarEvento(fam1, pared!.id, { titulo: "Reunión (desde la pared)" });
  sim.reiniciarContadores();
  const r = await h.sync(fam1, con1);
  const l2 = await h.leerEventos(fam1);
  const avisos = await avisosDe(fam1, con1);
  ok(
    "invitación editada en la pared → vuelve atrás, con el aviso «…es una invitación…» y sin escribir en Google",
    r.ok && l2.some((e) => e.titulo === "Reunión de trabajo") && !l2.some((e) => /desde la pared/.test(e.titulo)) && avisos.some((a) => /es una invitación/.test(a)) && sim.contadores.escrituras === 0 && sim.evento(cal1, inv.id)?.summary === "Reunión de trabajo",
    { r, avisos, l: l2.filter((e) => /Reunión/.test(e.titulo)).map(h.resumen) },
  );
  await quieto("invitación editada", fam1, con1);
  // Borrarla en la pared: no se puede borrar allá → vuelve a la pared en esa misma vuelta (sin escribir en
  // Google), junto con el aviso «…solo se puede borrar en Google Calendar»: la familia ve por qué volvió,
  // también si la función no alcanza a dar otra vuelta. (Antes volvía en la vuelta siguiente, que borraba el
  // aviso; y con una sola vuelta, en la sincronización siguiente, que también lo borraba.)
  for (const ms of [6500, 3900]) {
    await h.guardarEventos(fam1, (x) => x.filter((e) => e.titulo !== "Reunión de trabajo"));
    sim.reiniciarContadores();
    const r2 = await h.sync(fam1, con1, ms);
    const avisosR2 = await avisosDe(fam1, con1);
    ok(
      `plazo ${ms} ms: invitación borrada en la pared → vuelve en la misma vuelta (1 listado, nada pendiente), sin escribir en Google, con el aviso «…solo se puede borrar en Google Calendar»`,
      r2.ok &&
        !r2.pendiente &&
        sim.contadores.porTipo["events.list"] === 1 &&
        (await h.leerEventos(fam1)).some((e) => e.titulo === "Reunión de trabajo") &&
        sim.evento(cal1, inv.id)?.status === "confirmed" &&
        sim.contadores.escrituras === 0 &&
        avisosR2.filter((a) => /"Reunión de trabajo" solo se puede borrar en Google Calendar/.test(a)).length === 1,
      { r2, porTipo: sim.contadores.porTipo, avisosR2 },
    );
    await h.sync(fam1, con1);
    ok(`plazo ${ms} ms: …la sincronización siguiente (sin nada que hacer) deja el aviso a la vista`, (await avisosDe(fam1, con1)).some((a) => /solo se puede borrar/.test(a)), await avisosDe(fam1, con1));
    // Los avisos son de la última sincronización que revisó algo: no se juntan de una llamada a otra.
    await h.guardarEventos(fam1, (x) => x);
    await h.sync(fam1, con1);
    ok(`plazo ${ms} ms: …y la siguiente que revisa algo (sin nada que avisar) ya no lo muestra`, !(await avisosDe(fam1, con1)).some((a) => /solo se puede borrar/.test(a)), await avisosDe(fam1, con1));
  }
  await quieto("invitación borrada", fam1, con1);
  // Google rechaza la repetición de un evento nuevo (400): queda sólo en la pared, con aviso.
  sim.interruptores.reglasRechazadas = [/INTERVAL=7/];
  await h.guardarEventos(fam1, (x) => [...x, ev("r18", { titulo: "Cada 7 semanas", repeticion: "semanal", intervalo: 7, fecha: "2026-11-30" })]);
  const r3 = await h.sync(fam1, con1);
  const avisos3 = await avisosDe(fam1, con1);
  const nuevo = await porId(fam1, "r18");
  ok(
    "Google rechaza un evento nuevo → queda «sólo en la pared», con aviso (sin error ni reintentos)",
    r3.ok && nuevo?.soloPanel === true && !nuevo.externo && avisos3.some((a) => /Cada 7 semanas/.test(a)) && !sim.evento(cal1, gid("r18")),
    { r3, nuevo, avisos3 },
  );
  // …y rechaza cambiar la repetición de una serie que ya está: la pared vuelve a lo de Google, con aviso.
  await h.cambiarEvento(fam1, "r13", { intervalo: 7, repeticion: "semanal" });
  const r4 = await h.sync(fam1, con1);
  const avisos4 = await avisosDe(fam1, con1);
  const p4 = await porId(fam1, "r13");
  sim.interruptores.reglasRechazadas = [];
  ok(
    "Google rechaza un cambio (400) → la pared vuelve a lo de Google, con aviso",
    r4.ok && p4?.repeticion === "mensual" && avisos4.some((a) => /no aceptó/.test(a)),
    { r4, p4: p4 && h.resumen(p4), avisos4 },
  );
  await quieto("rechazos de Google", fam1, con1);
});

await caso("Google no aplica todo lo que se le mandó → la pared relee lo que quedó", async () => {
  // a) La serie se dividió en la web («este y los siguientes») y Google ignora un cambio de repetición
  //    (interruptor untilIgnoradoTrasDivision): 200, pero recurrence igual → aviso y la pared vuelve a lo de Google.
  const cal = h.nuevoCalendario();
  const con = h.conexionGoogle(cal);
  const fam = await h.familia([ev("d1", { titulo: "Remedio", repeticion: "diaria", fecha: "2026-11-15", repetirHasta: "2026-11-30" })]);
  await h.sync(fam, con);
  sim.actor("web", cal).esteYLosSiguientes(gid("d1"), "2026-11-22", { summary: "🦄 Remedio (dosis nueva)" });
  await h.sync(fam, con);
  sim.interruptores.untilIgnoradoTrasDivision = true;
  await h.cambiarEvento(fam, "d1", { repetirHasta: "2026-11-18" });
  const r1 = await h.sync(fam, con);
  const avisos1 = await avisosDe(fam, con);
  sim.interruptores.untilIgnoradoTrasDivision = false;
  await h.sync(fam, con);
  const d1 = await porId(fam, "d1");
  ok(
    "repetición ignorada por Google → aviso «no aceptó cambiar la repetición» y la pared queda como Google («hasta» del 21)",
    r1.ok && avisos1.some((a) => /no aceptó cambiar la repetición/.test(a)) && d1?.repetirHasta === "2026-11-21",
    { r1, avisos1, d1: d1 && h.resumen(d1) },
  );
  await quieto("repetición ignorada", fam, con);

  // b) Dos PATCH (la serie y un día cambiado): el segundo da 400 → aviso «no aceptó parte del cambio» y la
  //    pared relee: queda lo que Google sí guardó.
  const fam2 = await h.familia([ev("d2", { titulo: "Teatro", repeticion: "semanal", fecha: "2026-11-12", repetirHasta: "2027-01-28" })]);
  const cal2 = h.nuevoCalendario();
  const con2 = h.conexionGoogle(cal2);
  await h.sync(fam2, con2);
  const hijo = sim
    .actor("web", cal2)
    .moverDia(gid("d2"), "2026-11-26", { dateTime: "2026-11-27T18:00:00-03:00", timeZone: "America/Santiago" }, { dateTime: "2026-11-27T19:00:00-03:00", timeZone: "America/Santiago" });
  await h.sync(fam2, con2);
  const dia = (await h.leerEventos(fam2)).find((e) => e.externo?.recurrencia)!;
  await h.guardarEventos(fam2, (x) => x.map((e) => (e.id === "d2" ? { ...e, titulo: "Teatro infantil", actualizado: ahoraIso() } : e.id === dia.id ? { ...e, lugar: "Sala 3", actualizado: ahoraIso() } : e)));
  const inj = sim.inyectar((p) => p.tipo === "events.patch" && p.eventoId === hijo.id, respuestas.error("timeRangeEmpty"));
  const r2 = await h.sync(fam2, con2);
  inj.quitar();
  const avisos2 = await avisosDe(fam2, con2);
  await h.sync(fam2, con2);
  const l2 = await h.leerEventos(fam2);
  ok(
    "el segundo PATCH rechazado → aviso «no aceptó parte del cambio» y la pared queda como Google (la serie cambiada, el día no)",
    r2.ok &&
      inj.disparos === 1 &&
      avisos2.some((a) => /no aceptó parte del cambio/.test(a)) &&
      l2.find((e) => e.id === "d2")?.titulo === "Teatro infantil" &&
      !l2.find((e) => e.externo?.recurrencia)?.lugar &&
      sim.evento(cal2, gid("d2"))?.summary === "🦄 Teatro infantil",
    { r2, avisos2, l2: l2.map(h.resumen) },
  );
  await quieto("parte del cambio rechazada", fam2, con2);
});

await caso("sin hora de término con fin = inicio rechazado (respaldo con end: null)", async () => {
  // Si Google no acepta fin = inicio, el transporte reintenta "sin hora de término". Al crear, eso es un
  // campo documentado (endTimeUnspecified) y el etag se puede prever. Al cambiar, el respaldo borra `end`
  // con un PATCH (no documentado): el transporte devuelve etag null y la vuelta siguiente relee lo que quedó.
  sim.interruptores.finIgualInicio = "400";
  try {
    const cal = h.nuevoCalendario();
    const con = h.conexionGoogle(cal);
    const fam = await h.familia([ev("s1", { titulo: "Remedio", horaInicio: "08:00", horaFin: undefined }), ev("s2", { titulo: "Cita", horaInicio: "10:00", horaFin: "11:00" })]);
    const r0 = await h.sync(fam, con);
    const est0 = await h.estado(fam, con);
    const uid = h.uidPanel("s2");
    ok(
      "crear (respaldo endTimeUnspecified): en Google sin hora de término y el estado con etag",
      r0.ok && sim.evento(cal, gid("s1"))?.endTimeUnspecified === true && !!est0?.recursos[h.uidPanel("s1")]?.etag,
      { r0, g: sim.evento(cal, gid("s1")), rec: est0?.recursos[h.uidPanel("s1")] },
    );
    await h.cambiarEvento(fam, "s2", { horaInicio: "09:30", horaFin: undefined });
    sim.reiniciarContadores();
    const r1 = await h.sync(fam, con, 6500);
    const est1 = await h.estado(fam, con);
    const g = sim.evento(cal, gid("s2"));
    ok(
      "quitar la hora de término: 2 PATCH (el segundo con end: null) y el estado queda sin etag (se relee lo que quedó)",
      r1.ok && sim.contadores.porTipo["events.patch"] === 2 && g?.endTimeUnspecified === true && /T09:30/.test(g?.start?.dateTime ?? "") && est1?.recursos[uid]?.etag === null,
      { r1, porTipo: sim.contadores.porTipo, g: g && { start: g.start, end: g.end, u: g.endTimeUnspecified }, rec: est1?.recursos[uid] },
    );
    await quieto("sin hora de término con end: null", fam, con);
    const p = await porId(fam, "s2");
    ok("…y la pared sigue a las 09:30, sin hora de término", p?.horaInicio === "09:30" && p.horaFin === undefined, p && h.resumen(p));
  } finally {
    sim.interruptores.finIgualInicio = "ok";
  }
});

await caso("lo que quedó en Google se ve distinto de lo que se mandó", async () => {
  // a) Una «fantasma» (un día que Google materializó idéntico a la serie). Cambiar el lugar de la serie es
  //    1 PATCH del principal y, después, otro de la fantasma con lo mismo: si Google no propaga el cambio,
  //    ese día igual queda como la serie (no aparece como día cambiado, ni en la pared ni en los iPhone) y
  //    el transporte prevé el etag. Lo mismo con la hora de término (la fantasma conserva su inicio) y, si
  //    Google sí pasa el título a la fantasma (su If-Match queda viejo), no se pisa: se relee.
  const cal = h.nuevoCalendario();
  const con = h.conexionGoogle(cal);
  const fam = await h.familia([ev("f1", { titulo: "Teatro", repeticion: "semanal", fecha: "2026-11-12", repetirHasta: "2027-01-28", lugar: "Sala 1" })]);
  await h.sync(fam, con);
  sim.interruptores.fantasmasAlLeer = true;
  sim.interruptores.probFantasma = 1;
  await h.sync(fam, con);
  sim.interruptores.fantasmasAlLeer = false;
  sim.interruptores.probFantasma = 0.3;
  const fantasmas = h.vivos(cal).filter((e) => e.recurringEventId);
  ok("hay una fantasma y la pared no la muestra", fantasmas.length === 1 && (await h.leerEventos(fam)).length === 1, fantasmas.map((e) => e.id));
  const fid = fantasmas[0]?.id ?? "";
  const patches = () => h.log.filter((x) => x.startsWith("PATCH ")).map((x) => decodeURIComponent(x.split("?")[0].split("/").pop() ?? ""));
  await h.cambiarEvento(fam, "f1", { lugar: "Sala 2" });
  sim.reiniciarContadores();
  h.log.length = 0;
  const r = await h.sync(fam, con);
  const porTipo = { ...sim.contadores.porTipo };
  const orden = patches();
  const rec = (await h.estado(fam, con))?.recursos[h.uidPanel("f1")];
  const r1 = await h.sync(fam, con);
  const l = await h.leerEventos(fam);
  ok(
    "lugar de la serie: 2 PATCH (el principal y después la fantasma), con etag previsto; la fantasma tiene el lugar nuevo y la pared no muestra un día cambiado",
    r.ok &&
      r1.ok &&
      porTipo["events.patch"] === 2 &&
      JSON.stringify(orden) === JSON.stringify([gid("f1"), fid]) &&
      rec?.etag !== null &&
      sim.evento(cal, gid("f1"))?.location === "Sala 2" &&
      sim.evento(cal, fid)?.location === "Sala 2" &&
      l.length === 1 &&
      l[0].lugar === "Sala 2",
    { r, r1, porTipo, orden, rec, l: l.map(h.resumen), fantasma: sim.evento(cal, fid) },
  );
  await quieto("fantasma con el lugar nuevo", fam, con);
  // a2) La hora de término de la serie: la fantasma recibe su propio fin (su inicio no cambia).
  await h.cambiarEvento(fam, "f1", { horaFin: "11:30" });
  sim.reiniciarContadores();
  const ra2 = await h.sync(fam, con);
  const fa2 = sim.evento(cal, fid);
  const la2 = await h.leerEventos(fam);
  ok(
    "hora de término de la serie: la fantasma termina a las 11:30 de su día (mismo inicio) y la pared no muestra un día cambiado",
    ra2.ok &&
      sim.contadores.porTipo["events.patch"] === 2 &&
      Date.parse(fa2?.end?.dateTime ?? "") - Date.parse(fa2?.start?.dateTime ?? "") === 90 * 60_000 &&
      Date.parse(fa2?.start?.dateTime ?? "") === Date.parse(fantasmas[0].start?.dateTime ?? "x") &&
      la2.length === 1 &&
      la2[0].horaFin === "11:30",
    { ra2, porTipo: sim.contadores.porTipo, fa2: fa2 && { start: fa2.start, end: fa2.end }, l: la2.map(h.resumen) },
  );
  await quieto("fantasma con la hora de término nueva", fam, con);
  // a3) Google pasa el título nuevo a la fantasma: su PATCH da 412 (If-Match viejo) y no se pisa; se relee.
  sim.interruptores.propagarTituloAExcepciones = true;
  try {
    await h.cambiarEvento(fam, "f1", { titulo: "Teatro musical" });
    sim.reiniciarContadores();
    const ra3 = await h.sync(fam, con);
    const avisos3 = await avisosDe(fam, con);
    const la3 = await h.leerEventos(fam);
    ok(
      "título con Google que lo pasa a la fantasma: el 412 de la fantasma no es error ni aviso; la pared no muestra un día cambiado",
      ra3.ok && !ra3.error && sim.contadores.status?.["412"] === 1 && sim.evento(cal, fid)?.summary === "🦄 Teatro musical" && la3.length === 1 && la3[0].titulo === "Teatro musical" && !avisos3.length,
      { ra3, status: sim.contadores.status, avisos3, l: la3.map(h.resumen) },
    );
    await quieto("fantasma con el título pasado por Google", fam, con);
  } finally {
    sim.interruptores.propagarTituloAExcepciones = false;
  }

  // a4) Google pasa sólo el título a la fantasma y la pared cambió el título y el lugar: el PATCH de la
  //     fantasma da 412; se relee y se le manda lo que le falta (el lugar), con su etag nuevo. Antes el lugar
  //     no llegaba a ese día: quedaba como un día cambiado con el lugar viejo, en la pared y en los iPhone.
  sim.interruptores.propagarTituloAExcepciones = true;
  try {
    await h.cambiarEvento(fam, "f1", { titulo: "Teatro de títeres", lugar: "Sala 3" });
    sim.reiniciarContadores();
    const ra4 = await h.sync(fam, con);
    const avisos4 = await avisosDe(fam, con);
    const la4 = await h.leerEventos(fam);
    const f4 = sim.evento(cal, fid);
    ok(
      "título y lugar con Google que sólo pasa el título: la fantasma queda con los dos (412, se relee y se le manda el lugar); la pared no muestra un día cambiado",
      ra4.ok &&
        !ra4.error &&
        sim.contadores.status?.["412"] === 1 &&
        sim.contadores.porTipo["events.get"] === 1 &&
        f4?.summary === "🦄 Teatro de títeres" &&
        f4?.location === "Sala 3" &&
        la4.length === 1 &&
        la4[0].lugar === "Sala 3" &&
        !avisos4.length,
      { ra4, status: sim.contadores.status, porTipo: sim.contadores.porTipo, fantasma: f4 && [f4.summary, f4.location], avisos4, l: la4.map(h.resumen) },
    );
    await quieto("fantasma con el título pasado por Google y el lugar desde la pared", fam, con);
  } finally {
    sim.interruptores.propagarTituloAExcepciones = false;
  }
  // a5) Lo mismo, pero alguien cambió el lugar de ese día en la web entre medio (después de que Google le
  //     pasara el título): no se pisa. La pared muestra ese día cambiado, como Google.
  sim.interruptores.propagarTituloAExcepciones = true;
  try {
    await h.cambiarEvento(fam, "f1", { titulo: "Teatro de sombras", lugar: "Sala 4" });
    // (Justo cuando llega el PATCH de la fantasma, la web le cambia el lugar.)
    let editado = false;
    const freno = sim.inyectar(
      (p) => {
        if (editado || p.tipo !== "events.patch" || p.eventoId !== fid) return false;
        editado = true;
        sim.actor("web", cal).editar(fid, { location: "Patio" });
        return true;
      },
      respuestas.demora(1),
      1,
    );
    sim.reiniciarContadores();
    const ra5 = await h.sync(fam, con);
    freno.quitar();
    await h.sync(fam, con);
    const la5 = await h.leerEventos(fam);
    const dia5 = la5.find((e) => e.externo?.recurrencia);
    ok(
      "un cambio ajeno en la fantasma no se pisa: queda «Patio» en Google y la pared muestra ese día cambiado",
      ra5.ok && sim.evento(cal, fid)?.location === "Patio" && dia5?.lugar === "Patio" && la5.find((e) => e.id === "f1")?.lugar === "Sala 4",
      { ra5, fantasma: sim.evento(cal, fid), l: la5.map(h.resumen) },
    );
    await quieto("fantasma cambiada por otro entre medio", fam, con);
  } finally {
    sim.interruptores.propagarTituloAExcepciones = false;
  }

  // b) Un día borrado en la web (excepción cancelada) y después la pared cambia la hora de la serie: la
  //    cancelada queda «huérfana» (a la hora vieja) y planear borra ese día con un EXDATE a la hora nueva.
  //    Al releer (aquí, porque la web cambia el título) la serie sigue siendo semanal con ese día borrado,
  //    no fechas sueltas.
  const cal2 = h.nuevoCalendario();
  const con2 = h.conexionGoogle(cal2);
  const fam2 = await h.familia([ev("o1", { titulo: "Piano", repeticion: "semanal", fecha: "2026-11-16", horaInicio: "10:00", horaFin: "11:00" })]);
  await h.sync(fam2, con2);
  sim.actor("web", cal2).borrarDia(gid("o1"), "2026-11-30");
  await h.sync(fam2, con2);
  ok("el día borrado en la web llegó a la pared", !!(await porId(fam2, "o1"))?.excepciones?.includes("2026-11-30"), (await porId(fam2, "o1")) && h.resumen((await porId(fam2, "o1"))!));
  await h.cambiarEvento(fam2, "o1", { horaInicio: "12:00", horaFin: "13:00" });
  sim.reiniciarContadores();
  const r2 = await h.sync(fam2, con2);
  const g2 = sim.evento(cal2, gid("o1"));
  ok(
    "mover la hora: 1 PATCH con un EXDATE a la hora nueva",
    r2.ok && sim.contadores.porTipo["events.patch"] === 1 && /T12:00/.test(g2?.start?.dateTime ?? "") && (g2?.recurrence ?? []).some((x: string) => /^EXDATE.*20261130T120000/.test(x)),
    { r2, porTipo: sim.contadores.porTipo, rec: g2?.recurrence },
  );
  sim.actor("web", cal2).editarTitulo(gid("o1"), "🦄 Piano (web)");
  const r3 = await h.sync(fam2, con2);
  const p3 = await porId(fam2, "o1");
  ok(
    "al releer: sigue semanal a las 12:00 con ese día borrado (la cancelada huérfana no la vuelve fechas sueltas)",
    r3.ok && p3?.titulo === "Piano (web)" && p3.repeticion === "semanal" && !p3.fechas?.length && p3.horaInicio === "12:00" && !!p3.excepciones?.includes("2026-11-30"),
    { r3, p3: p3 && h.resumen(p3) },
  );
  await quieto("cancelada huérfana", fam2, con2);

  // c) Un día borrado en el iPhone (EXDATE), después la web divide la serie («este y los siguientes»)
  //    antes de ese día: el EXDATE queda más allá del «hasta» y la pared ya no lo muestra como día borrado.
  //    Si la pared alarga el «hasta», ese EXDATE vuelve a ocultar el día en Google: la pared lo relee y lo
  //    muestra borrado (como en Google), en vez de quedar con ese día a la vista.
  const cal3 = h.nuevoCalendario();
  const con3 = h.conexionGoogle(cal3);
  const fam3 = await h.familia([]);
  const x = sim.actor("web", cal3).crear({ summary: "⚽ Control", start: { date: "2026-11-13" }, end: { date: "2026-11-14" }, recurrence: ["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=FR;UNTIL=20270105"] });
  await h.sync(fam3, con3);
  sim.actor("iPhone", cal3).borrarDia(x.id, "2026-12-11");
  await h.sync(fam3, con3);
  sim.actor("web", cal3).esteYLosSiguientes(x.id, "2026-11-27", { summary: "⚽ Control (nuevo)" });
  await h.sync(fam3, con3);
  const orig = (await h.leerEventos(fam3)).find((e) => e.titulo === "Control")!;
  await h.cambiarEvento(fam3, orig.id, { repetirHasta: "2027-02-15" });
  sim.reiniciarContadores();
  const r4 = await h.sync(fam3, con3);
  const est4 = await h.estado(fam3, con3);
  const p4 = await porId(fam3, orig.id);
  const rec4 = est4?.recursos[orig.externo!.uid];
  await h.sync(fam3, con3);
  const p5 = await porId(fam3, orig.id);
  ok(
    "alargar el «hasta» sobre un EXDATE que había quedado fuera: 1 PATCH sin etag previsto, y la pared termina con ese día borrado (como Google)",
    r4.ok && sim.contadores.porTipo["events.patch"] === 1 && rec4?.etag === null && !p4?.excepciones?.includes("2026-12-11") && p5?.repetirHasta === "2027-02-15" && !!p5?.excepciones?.includes("2026-12-11"),
    { r4, porTipo: sim.contadores.porTipo, rec4, p4: p4 && h.resumen(p4), p5: p5 && h.resumen(p5), rec: sim.evento(cal3, x.id)?.recurrence },
  );
  await quieto("EXDATE fuera del «hasta» que vuelve a valer", fam3, con3);
});

// =====================================================================================
seccion("11. UID repetidos (lápida restaurada desde la papelera con gen1 viva)");
await caso("lápida restaurada", async () => {
  const cal = h.nuevoCalendario();
  const con = h.conexionGoogle(cal);
  const fam = await h.familia([ev("u1", { titulo: "Ballet" }), ev("u2", { titulo: "Judo" })]);
  await h.sync(fam, con);
  sim.actor("web", cal).borrar(gid("u1"));
  await h.cambiarEvento(fam, "u1", { titulo: "Ballet (nuevo horario)", horaInicio: "15:00", horaFin: "16:00" });
  await h.sync(fam, con);
  ok("se recreó con gen1", sim.evento(cal, gid("u1", 1))?.status === "confirmed");
  sim.actor("web", cal).restaurar(gid("u1"));
  for (let i = 0; i < 3; i++) await h.sync(fam, con);
  const l = await h.leerEventos(fam);
  const est = await h.estado(fam, con);
  const hrefs = Object.values(est!.recursos).map((x) => x.href);
  const ballet = l.filter((e) => /Ballet/.test(e.titulo));
  ok(
    "no se pisan en estado.recursos: cada serie viva de Google tiene su recurso, y la pared muestra las dos (duplicado visible, como en Google)",
    ballet.length === 2 && new Set(hrefs).size === hrefs.length && hrefs.length === h.vivos(cal).length && h.vivos(cal).length === 3,
    { l: l.map(h.resumen), recursos: est?.recursos },
  );
  await quieto("UID repetidos", fam, con);
});

// =====================================================================================
seccion("12. Avisos de varias vueltas de una misma sincronización");
await caso("juntarAvisos", async () => {
  const S = h.S as unknown as { juntarAvisos?: (a: string[], b: string[]) => string[] | undefined; MAX_AVISOS?: number };
  const j = (a: string[], b: string[]) => JSON.stringify(S.juntarAvisos?.(a, b) ?? null);
  ok(
    "juntarAvisos: primero los de las vueltas anteriores y después los nuevos que no estaban, hasta 5; con una sola vuelta, igual que siempre (los primeros 5, tal cual); sin avisos → undefined",
    typeof S.juntarAvisos === "function" &&
      j(["a", "b"], ["b", "c", "a", "d", "e", "f"]) === '["a","b","c","d","e"]' &&
      j([], ["x", "x", "y"]) === '["x","x","y"]' &&
      j([], ["1", "2", "3", "4", "5", "6"]) === '["1","2","3","4","5"]' &&
      j(["a"], []) === '["a"]' &&
      j([], []) === "null" &&
      S.MAX_AVISOS === 5,
  );
});

await caso("el aviso de una vuelta sigue a la vista después de la vuelta que resuelve lo avisado", async () => {
  // Google no deja borrar (403 requiredAccessLevel en events.delete, como un calendario de sólo lectura en
  // iCloud): la primera vuelta avisa y deja la serie para releer; la segunda del mismo pedido la trae de
  // vuelta sin nada que avisar. Antes esa segunda vuelta borraba el aviso y el evento volvía sin explicación.
  const cal = h.nuevoCalendario();
  const con = h.conexionGoogle(cal);
  const fam = await h.familia([ev("v1", { titulo: "Vacuna" }), ev("v2", { titulo: "Control", fecha: "2026-12-02" })]);
  await h.sync(fam, con);
  await h.guardarEventos(fam, (x) => x.filter((e) => e.id !== "v1"));
  const inj = sim.inyectar(es.tipo("events.delete"), respuestas.error("requiredAccessLevel"));
  sim.reiniciarContadores();
  const r = await h.sync(fam, con);
  inj.quitar();
  const avisos = await avisosDe(fam, con);
  ok(
    "dos vueltas: la segunda trae de vuelta «Vacuna» y el aviso de la primera sigue a la vista (una vez)",
    r.ok && inj.disparos === 1 && sim.contadores.porTipo["events.list"] === 2 && (await porId(fam, "v1"))?.titulo === "Vacuna" && avisos.filter((a) => /no deja borrar eventos desde el panel/.test(a)).length === 1,
    { r, disparos: inj.disparos, porTipo: sim.contadores.porTipo, avisos },
  );
  await quieto("aviso de la primera vuelta", fam, con);
});

seccion("Al final");
ok("ningún pedido salió de esta máquina", h.urlsVistas.length > 0 && h.urlsVistas.every((u) => u.startsWith("http://127.0.0.1:")), h.urlsVistas.filter((u) => !u.startsWith("http://127.0.0.1:")).slice(0, 5));

await h.terminar();
