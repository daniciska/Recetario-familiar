// Pruebas de servidor/google/escritura.ts (plan de pruebas C2): planear como función pura, con B armado
// por escribirRecurso de servidor/ics.ts a partir de la serie proyectada (lo mismo que hace el motor),
// más los cuerpos de hora, el insert, los días cambiados al recrear y la marca de escritura propia.
//
//   cd calendario && node --experimental-transform-types --no-warnings --import ./pruebas/registrar.mjs pruebas/google/escritura.test.ts
import ICAL from "ical.js";
import { NoSePuedeEscribir, escribirRecurso, leerRecurso, parsear } from "../../servidor/ics";
import type { Evento } from "../../lib/datos/tipos";
import { agrupar, huellaPieza, serieAIcs, type EvG, type HoraG, type Serie } from "../../servidor/google/serie";
import {
  cuerpoInsert,
  cuerposDeHora,
  finIgualInicio,
  fusionar,
  marcar,
  ocurre,
  planear,
  planearCreacion,
  recurrenciaDe,
  sinHoraDeTermino,
  vista,
  type Cuerpo,
  type Plan,
} from "../../servidor/google/escritura";
import { idGoogleDe } from "../../servidor/google/ids";

// ---------- Arnés ----------
const resultados: string[] = [];
const ok = (nombre: string, cond: unknown, detalle: unknown = "") => {
  const d = detalle === "" ? "" : ` · ${(typeof detalle === "string" ? detalle : JSON.stringify(detalle)).slice(0, 600)}`;
  resultados.push(`${cond ? "OK " : "MAL"} ${nombre}${d}`);
};
function caso(nombre: string, fn: () => void) {
  try {
    fn();
  } catch (e) {
    ok(`${nombre} (lanzó)`, false, `${(e as Error)?.name}: ${(e as Error)?.message}`);
  }
}

const CAL = "familia123@group.calendar.google.com";
const SCL = "America/Santiago";
const miembros = [
  { id: "sofi", nombre: "Sofía", color: "#f00", emoji: "🦄" },
  { id: "tomi", nombre: "Tomás", color: "#0f0", emoji: "⚽" },
];
const ctx = { conexion: "c1", miembros, hoy: "2026-11-09" };
const h = (dateTime: string, timeZone: string | undefined = SCL): HoraG => (timeZone ? { dateTime, timeZone } : { dateTime });
const yo = { email: CAL, self: true };

function unaSerie(items: EvG[]): Serie {
  const m = agrupar(items, CAL, SCL);
  if (m.size !== 1) throw new Error(`se esperaba 1 serie y hay ${m.size}`);
  return [...m.values()][0];
}

// ---------- Corpus ----------
const idNat = idGoogleDe("ev_natacion1@calendario-familiar");
const principalNat = (extra: Partial<EvG> = {}): EvG => ({
  id: idNat,
  etag: '"1"',
  status: "confirmed",
  summary: "🦄 Natación",
  start: h("2026-11-04T09:00:00-03:00"),
  end: h("2026-11-04T10:00:00-03:00"),
  recurrence: ["RRULE:FREQ=WEEKLY;WKST=MO;BYDAY=WE", "EXDATE;TZID=America/Santiago:20261111T090000"],
  updated: "2026-11-05T12:00:00.000Z",
  organizer: yo,
  ...extra,
});
const vivaNat = (): EvG => ({
  id: `${idNat}_20261118T120000Z`,
  etag: '"2"',
  status: "confirmed",
  recurringEventId: idNat,
  originalStartTime: h("2026-11-18T09:00:00-03:00"),
  summary: "🦄 Natación (piscina 2)",
  start: h("2026-11-18T10:00:00-03:00"),
  end: h("2026-11-18T11:00:00-03:00"),
  updated: "2026-11-06T12:00:00.000Z",
  organizer: yo,
});
const canceladaNat = (): EvG => ({ id: `${idNat}_20261125T120000Z`, status: "cancelled", recurringEventId: idNat, originalStartTime: h("2026-11-25T09:00:00-03:00") });
const fantasmaNat = (): EvG => ({
  id: `${idNat}_20261202T120000Z`,
  etag: '"3"',
  status: "confirmed",
  recurringEventId: idNat,
  originalStartTime: h("2026-12-02T09:00:00-03:00"),
  summary: "🦄 Natación",
  start: h("2026-12-02T09:00:00-03:00"),
  end: h("2026-12-02T10:00:00-03:00"),
  updated: "2026-11-07T12:00:00.000Z",
  organizer: yo,
});
const natacion = () => [principalNat(), vivaNat(), canceladaNat(), fantasmaNat()];

const cumple = (): EvG[] => [
  {
    id: idGoogleDe("k3m9@calendario-familiar"),
    etag: '"9"',
    status: "confirmed",
    summary: "🦄 Cumpleaños Sofía",
    description: "<b>Torta</b> de chocolate<br>en la casa &amp; jardín",
    start: { date: "2026-12-05" },
    end: { date: "2026-12-06" },
    recurrence: ["RRULE:FREQ=YEARLY", "EXDATE;VALUE=DATE:20271205"],
    organizer: yo,
  },
];
const dentista = (extra: Partial<EvG> = {}): EvG[] => [
  { id: idGoogleDe("den1@calendario-familiar"), etag: '"4"', status: "confirmed", summary: "Dentista", start: h("2026-11-20T10:00:00-03:00"), end: h("2026-11-20T11:00:00-03:00"), organizer: yo, ...extra },
];
const corpus: [string, EvG[]][] = [
  ["natación (EXDATE, viva, cancelada, fantasma)", natacion()],
  ["cumpleaños anual de día completo con HTML", cumple()],
  ["suelto en Madrid", [{ id: "zz9abc", etag: '"4"', status: "confirmed", summary: "Vuelo", start: h("2026-12-20T08:00:00+01:00", "Europe/Madrid"), end: h("2026-12-20T20:00:00-03:00", undefined), organizer: yo }]],
  ["diaria hasta medianoche", [{ id: "turno01", etag: '"5"', status: "confirmed", summary: "Turno", start: h("2026-11-10T22:00:00-03:00"), end: h("2026-11-11T00:00:00-03:00"), recurrence: ["RRULE:FREQ=DAILY;UNTIL=20261115T025959Z"], organizer: yo }]],
  ["sin hora de término", dentista({ endTimeUnspecified: true })],
  ["invitación a un solo día (sin principal)", [{ ...vivaNat(), id: "ajeno77_20261118T120000Z", recurringEventId: "ajeno77", organizer: { email: "profe@colegio.cl" } }]],
  ["serie en UTC (fechas sueltas)", [{ id: "utc0001", etag: '"8"', status: "confirmed", summary: "Reunión", start: h("2026-11-04T20:00:00Z", "UTC"), end: h("2026-11-04T21:00:00Z", "UTC"), recurrence: ["RRULE:FREQ=WEEKLY;COUNT=4"], organizer: yo }]],
  ["segundo martes (regla que el panel no escribe)", [{ id: "martes2", etag: '"1"', status: "confirmed", summary: "Apoderados", start: h("2026-11-10T19:00:00-03:00"), end: h("2026-11-10T20:00:00-03:00"), recurrence: ["RRULE:FREQ=MONTHLY;BYDAY=2TU"], organizer: yo }]],
  ["invitación de otra persona", [principalNat({ organizer: { email: "otra@gmail.com", self: false } })]],
];

/** Lo que haría el motor: leer la serie, cambiar el panel, escribir B desde la serie y planear. */
function plan(items: EvG[], cambio: (l: Evento[]) => Evento[] = (l) => l): Plan | NoSePuedeEscribir {
  const s = unaSerie(items);
  const A = serieAIcs(s);
  const g = leerRecurso(A, ctx)!;
  const local = cambio(structuredClone(g.eventos)).map((e) => ({ ...e, actualizado: "2026-11-09T12:00:00.000Z" }));
  try {
    return planear(s, escribirRecurso(local, ctx, g.uid, A));
  } catch (e) {
    if (e instanceof NoSePuedeEscribir) return e;
    throw e;
  }
}
const esPrincipal = (e: Evento) => !e.externo?.recurrencia;
const enPrincipal = (f: (e: Evento) => Evento) => (l: Evento[]) => l.map((e) => (esPrincipal(e) ? f(e) : e));
const vacio = (p: Plan | NoSePuedeEscribir) => !(p instanceof Error) && !p.maestro && p.ops.length === 0;
const claves = (c: Cuerpo | undefined) => Object.keys(c ?? {}).filter((k) => k !== "extendedProperties").sort().join(",");
const sinPieza = (p: Plan | NoSePuedeEscribir) => (p instanceof Error ? `${p.name}: ${p.message}` : JSON.stringify(p, (k, v) => (k === "pieza" ? v.id : v)));
const PROHIBIDOS = ["sequence", "attendees", "organizer", "reminders", "conferenceData", "attachments", "eventType", "colorId", "visibility", "transparency", "guestsCanModify", "guestsCanInviteOthers", "guestsCanSeeOtherGuests", "iCalUID", "created", "updated", "etag"];
const todosLosCuerpos: Cuerpo[] = [];
function guardar(p: Plan | NoSePuedeEscribir) {
  if (p instanceof Error) return;
  if (p.maestro) todosLosCuerpos.push(p.maestro);
  for (const o of p.ops) todosLosCuerpos.push(o.cuerpo);
}
const mensaje = (p: Plan | NoSePuedeEscribir) => (p instanceof Error ? p.message : "");

// ---------- Ida y vuelta sin cambios ----------
caso("ida y vuelta sin cambios: ningún pedido", () => {
  for (const [nombre, items] of corpus) {
    const p = plan(items);
    ok(`sin cambios → plan vacío: ${nombre}`, vacio(p), sinPieza(p));
  }
});

// ---------- C2: la tabla ----------
caso("C2: tabla de casos de planear", () => {
  const T = (nombre: string, p: Plan | NoSePuedeEscribir, cond: (p: Plan) => boolean) => {
    guardar(p);
    ok(nombre, !(p instanceof Error) && cond(p), sinPieza(p));
  };
  const N = (nombre: string, p: Plan | NoSePuedeEscribir, texto: RegExp) => ok(nombre, p instanceof NoSePuedeEscribir && texto.test(p.message), sinPieza(p));

  T("título → maestro.summary (nada más)", plan(natacion(), enPrincipal((e) => ({ ...e, titulo: "Natación y clavados" }))), (p) => claves(p.maestro) === "summary" && p.maestro!.summary === "🦄 Natación y clavados" && !p.ops.length);
  T(
    "borrar un día → recurrence con un EXDATE más (la regla de Google tal cual)",
    plan(natacion(), enPrincipal((e) => ({ ...e, excepciones: [...e.excepciones!, "2026-12-09"] }))),
    (p) =>
      claves(p.maestro) === "recurrence" &&
      JSON.stringify(p.maestro!.recurrence) === JSON.stringify(["RRULE:FREQ=WEEKLY;WKST=MO;BYDAY=WE", "EXDATE;TZID=America/Santiago:20261111T090000", "EXDATE;TZID=America/Santiago:20261209T090000"]) &&
      !p.ops.length,
  );
  T(
    "borrar un día con fantasma → cancelar la fantasma, recurrence sin cambios",
    plan(natacion(), enPrincipal((e) => ({ ...e, excepciones: [...e.excepciones!, "2026-12-02"] }))),
    (p) => !p.maestro && p.ops.length === 1 && p.ops[0].tipo === "cancelar" && p.ops[0].id === fantasmaNat().id && p.ops[0].etag === '"3"' && claves(p.ops[0].cuerpo) === "status" && p.ops[0].cuerpo.status === "cancelled" && p.ops[0].fecha === "2026-12-02",
  );
  T(
    "cambiar el lugar de un día cambiado → cambiar con sólo location",
    plan(natacion(), (l) => l.map((e) => (esPrincipal(e) ? e : { ...e, lugar: "Piscina 2" }))),
    (p) => !p.maestro && p.ops.length === 1 && p.ops[0].tipo === "cambiar" && p.ops[0].id === vivaNat().id && p.ops[0].etag === '"2"' && claves(p.ops[0].cuerpo) === "location" && p.ops[0].cuerpo.location === "Piscina 2",
  );
  T(
    "borrar un día cambiado → cancelar, sin EXDATE nuevo",
    plan(natacion(), (l) => l.filter(esPrincipal)),
    (p) => !p.maestro && p.ops.length === 1 && p.ops[0].tipo === "cancelar" && p.ops[0].id === vivaNat().id && p.ops[0].fecha === "2026-11-18",
  );
  N("día cambiado que vuelve a lo normal → NoSePuedeEscribir (revertir)", plan(natacion(), (l) => l.filter(esPrincipal).map((e) => ({ ...e, excepciones: e.excepciones!.filter((x) => x !== "2026-11-18") }))), /no se puede volver a la normalidad/);
  N(
    "día cambiado nuevo → NoSePuedeEscribir",
    plan(natacion(), (l) => {
      const p = l.find(esPrincipal)!;
      return [...l, { ...p, id: "nuevo1", fecha: "2026-12-16", horaInicio: "11:00", horaFin: "12:00", repeticion: "nunca", excepciones: undefined, diasSemana: undefined, externo: { conexion: "c1", uid: p.externo!.uid, recurrencia: "2026-12-16" } }];
    }),
    /no se puede crear un día cambiado/,
  );
  N("recuperar un día cancelado en Google → NoSePuedeEscribir (recuperar)", plan(natacion(), enPrincipal((e) => ({ ...e, excepciones: e.excepciones!.filter((x) => x !== "2026-11-25") }))), /se borró en Google Calendar; para recuperarlo/);
  T(
    "recuperar un día de un EXDATE de línea → recurrence sin ese EXDATE",
    plan(natacion(), enPrincipal((e) => ({ ...e, excepciones: e.excepciones!.filter((x) => x !== "2026-11-11") }))),
    (p) => claves(p.maestro) === "recurrence" && JSON.stringify(p.maestro!.recurrence) === JSON.stringify(["RRULE:FREQ=WEEKLY;WKST=MO;BYDAY=WE"]) && !p.ops.length,
  );
  T(
    "mover la serie con una cancelada y sin vivas → 1 PATCH: start, end y EXDATE en el instante nuevo",
    plan([principalNat(), canceladaNat()], enPrincipal((e) => ({ ...e, horaInicio: "10:00", horaFin: "11:00" }))),
    (p) =>
      claves(p.maestro) === "end,recurrence,start" &&
      JSON.stringify(p.maestro!.start) === JSON.stringify({ date: null, dateTime: "2026-11-04T10:00:00-03:00", timeZone: SCL }) &&
      JSON.stringify(p.maestro!.end) === JSON.stringify({ date: null, dateTime: "2026-11-04T11:00:00-03:00", timeZone: SCL }) &&
      JSON.stringify(p.maestro!.recurrence) === JSON.stringify(["RRULE:FREQ=WEEKLY;WKST=MO;BYDAY=WE", "EXDATE;TZID=America/Santiago:20261111T100000", "EXDATE;TZID=America/Santiago:20261125T100000"]) &&
      !p.ops.length,
  );
  N("mover la serie con una viva → NoSePuedeEscribir (G1)", plan(natacion(), enPrincipal((e) => ({ ...e, horaInicio: "10:00", horaFin: "11:00" }))), /tiene días cambiados uno por uno/);
  N("mover la serie con sólo una fantasma → NoSePuedeEscribir (G1)", plan([principalNat(), fantasmaNat()], enPrincipal((e) => ({ ...e, horaInicio: "10:00", horaFin: "11:00" }))), /tiene días cambiados uno por uno/);
  const conHasta = () => [principalNat({ recurrence: ["RRULE:FREQ=WEEKLY;UNTIL=20261231T025959Z"] }), vivaNat()];
  T(
    "alargar el UNTIL con una viva antes del UNTIL viejo → permitido",
    plan(conHasta(), enPrincipal((e) => ({ ...e, repetirHasta: "2027-03-31" }))),
    (p) => claves(p.maestro) === "recurrence" && JSON.stringify(p.maestro!.recurrence) === JSON.stringify(["RRULE:FREQ=WEEKLY;UNTIL=20270401T025959Z"]) && !p.ops.length,
  );
  N("acortar el UNTIL dejando una viva fuera → NoSePuedeEscribir", plan(conHasta(), enPrincipal((e) => ({ ...e, repetirHasta: "2026-11-15" }))), /tiene días cambiados uno por uno/);
  T("acortar el UNTIL sin dejar fuera la viva → permitido", plan(conHasta(), enPrincipal((e) => ({ ...e, repetirHasta: "2026-11-25" }))), (p) => claves(p.maestro) === "recurrence");
  T(
    "cambiar sólo la hora de término → permitido aunque haya vivas (sin tocar recurrence)",
    plan(natacion(), enPrincipal((e) => ({ ...e, horaFin: "10:30" }))),
    (p) => claves(p.maestro) === "end,start" && (p.maestro!.end as { dateTime: string }).dateTime === "2026-11-04T10:30:00-03:00" && !p.ops.length,
  );
  T(
    "pasar de día completo a con hora → date:null, dateTime con desfase y timeZone",
    plan(cumple(), enPrincipal((e) => ({ ...e, todoElDia: false, horaInicio: "10:00", horaFin: "12:00" }))),
    (p) =>
      JSON.stringify(p.maestro!.start) === JSON.stringify({ date: null, dateTime: "2026-12-05T10:00:00-03:00", timeZone: SCL }) &&
      JSON.stringify(p.maestro!.end) === JSON.stringify({ date: null, dateTime: "2026-12-05T12:00:00-03:00", timeZone: SCL }) &&
      JSON.stringify(p.maestro!.recurrence) === JSON.stringify(["RRULE:FREQ=YEARLY", "EXDATE;TZID=America/Santiago:20271205T100000"]),
  );
  T(
    "pasar de con hora a día completo → dateTime:null y timeZone:null",
    plan(dentista(), enPrincipal((e) => ({ ...e, todoElDia: true, horaInicio: undefined, horaFin: undefined }))),
    (p) => claves(p.maestro) === "end,start" && JSON.stringify(p.maestro!.start) === JSON.stringify({ date: "2026-11-20", dateTime: null, timeZone: null }) && JSON.stringify(p.maestro!.end) === JSON.stringify({ date: "2026-11-21", dateTime: null, timeZone: null }),
  );
  N("invitación (organizer.self=false con otro correo) → NoSePuedeEscribir", plan([principalNat({ organizer: { email: "otra@gmail.com", self: false } })], enPrincipal((e) => ({ ...e, titulo: "Otro" }))), /es una invitación/);
  T("organizer.email = el calendario y sin self → editable", plan([principalNat({ organizer: { email: CAL } })], enPrincipal((e) => ({ ...e, titulo: "Otro" }))), (p) => claves(p.maestro) === "summary");
  N("grupo sin principal → NoSePuedeEscribir", plan(corpus[5][1], (l) => l.map((e) => ({ ...e, lugar: "Sala 3" }))), /solo se puede cambiar en Google Calendar/);
});

caso("C2: otros casos", () => {
  const T = (nombre: string, p: Plan | NoSePuedeEscribir, cond: (p: Plan) => boolean) => {
    guardar(p);
    ok(nombre, !(p instanceof Error) && cond(p), sinPieza(p));
  };
  T(
    "mover la serie a otro día de la semana → regla de B y EXDATE nuevos",
    plan([principalNat(), canceladaNat()], enPrincipal((e) => ({ ...e, fecha: "2026-11-05" }))),
    (p) => (p.maestro!.recurrence as string[])[0] === "RRULE:FREQ=WEEKLY" && (p.maestro!.start as { dateTime: string }).dateTime === "2026-11-05T09:00:00-03:00",
  );
  T("título con nota en HTML → sólo summary (el HTML queda en Google)", plan(cumple(), enPrincipal((e) => ({ ...e, titulo: "Cumpleaños de la Sofi" }))), (p) => claves(p.maestro) === "summary");
  T("cambiar la nota de un evento con HTML → description en texto", plan(cumple(), enPrincipal((e) => ({ ...e, nota: "Torta de piña" }))), (p) => claves(p.maestro) === "description" && p.maestro!.description === "Torta de piña");
  T("borrar la nota y el lugar → \"\" para vaciar", plan(dentista({ description: "x", location: "Clínica" }), enPrincipal((e) => ({ ...e, nota: undefined, lugar: undefined }))), (p) => claves(p.maestro) === "description,location" && p.maestro!.description === "" && p.maestro!.location === "");
  T(
    "ponerle hora de término a un evento sin ella → endTimeUnspecified:false",
    plan(dentista({ endTimeUnspecified: true }), enPrincipal((e) => ({ ...e, horaFin: "10:45" }))),
    (p) => claves(p.maestro) === "end,endTimeUnspecified,start" && p.maestro!.endTimeUnspecified === false,
  );
  T(
    "mover la hora de una serie de afuera en UTC → dateTime en Z con timeZone UTC",
    plan(corpus[6][1], enPrincipal((e) => ({ ...e, horaInicio: "18:00", horaFin: "19:00" }))),
    (p) => JSON.stringify(p.maestro!.start) === JSON.stringify({ date: null, dateTime: "2026-11-04T21:00:00Z", timeZone: "UTC" }) && !("recurrence" in p.maestro!),
  );
  T(
    "borrar un día de una regla de afuera (segundo martes) → EXDATE",
    plan(corpus[7][1], enPrincipal((e) => ({ ...e, excepciones: ["2026-12-08"] }))),
    (p) => JSON.stringify(p.maestro!.recurrence) === JSON.stringify(["RRULE:FREQ=MONTHLY;BYDAY=2TU", "EXDATE;TZID=America/Santiago:20261208T190000"]),
  );
  T(
    "título y un día cambiado en la misma vuelta → maestro + cambiar",
    plan(natacion(), (l) => l.map((e) => (esPrincipal(e) ? { ...e, titulo: "Natación y clavados" } : { ...e, horaInicio: "10:30", horaFin: "11:30" }))),
    (p) => claves(p.maestro) === "summary" && p.ops.length === 1 && p.ops[0].tipo === "cambiar" && claves(p.ops[0].cuerpo) === "end,start",
  );
  T(
    "borrar el día cambiado y otro normal → cancelar + EXDATE (cambiar antes que cancelar)",
    plan(natacion(), (l) => l.filter(esPrincipal).map((e) => ({ ...e, excepciones: [...e.excepciones!, "2026-12-09"] }))),
    (p) => claves(p.maestro) === "recurrence" && p.ops.length === 1 && p.ops[0].tipo === "cancelar",
  );
  T(
    "quitar la repetición (sin días cambiados) → recurrence: null",
    plan([principalNat(), canceladaNat()], enPrincipal((e) => ({ ...e, repeticion: "nunca", diasSemana: undefined, excepciones: undefined }))),
    (p) => claves(p.maestro) === "recurrence" && p.maestro!.recurrence === null,
  );
  ok("quitar la repetición con un día cambiado → NoSePuedeEscribir (G1)", /tiene días cambiados/.test(mensaje(plan(natacion(), enPrincipal((e) => ({ ...e, repeticion: "nunca", diasSemana: undefined, excepciones: undefined }))))));
  T(
    "mover la serie de hora y no excluir el día cancelado allá → permitido (la cancelada queda huérfana)",
    plan([principalNat(), canceladaNat()], enPrincipal((e) => ({ ...e, horaInicio: "10:00", horaFin: "11:00", excepciones: ["2026-11-11"] }))),
    (p) => JSON.stringify(p.maestro!.recurrence) === JSON.stringify(["RRULE:FREQ=WEEKLY;WKST=MO;BYDAY=WE", "EXDATE;TZID=America/Santiago:20261111T100000"]) && !p.ops.length,
  );
  const orden = plan(natacion(), (l) => l.filter(esPrincipal).map((e) => ({ ...e, excepciones: [...e.excepciones!, "2026-12-02"] })));
  ok("dos cancelar en orden de fecha", !(orden instanceof Error) && orden.ops.map((o) => o.fecha).join() === "2026-11-18,2026-12-02", sinPieza(orden));
});

caso("cuerpos: nunca campos que no son del panel; siempre la marca", () => {
  const malos = todosLosCuerpos.filter((c) => PROHIBIDOS.some((k) => k in c) || typeof (c.extendedProperties as { private?: { cfh?: unknown } })?.private?.cfh !== "string");
  ok(`${todosLosCuerpos.length} cuerpos sin sequence/attendees/reminders/… y con extendedProperties.private.cfh`, todosLosCuerpos.length > 15 && malos.length === 0, malos);
  ok("la marca es sólo cfh (las demás propiedades privadas se mezclan en Google)", todosLosCuerpos.every((c) => JSON.stringify(Object.keys((c.extendedProperties as { private: object }).private)) === '["cfh"]'));
});

caso("determinismo de planear", () => {
  const cambio = (l: Evento[]) => l.filter(esPrincipal).map((e) => ({ ...e, titulo: "Otro", excepciones: [...e.excepciones!, "2026-12-09", "2026-12-02"] }));
  const a = sinPieza(plan(natacion(), cambio));
  const b = sinPieza(plan([...natacion()].reverse(), cambio));
  const c = sinPieza(plan(natacion(), cambio));
  ok("el mismo cambio da el mismo plan byte a byte (también con el listado en otro orden)", a === b && a === c && !a.startsWith("NoSe"), a);
});

caso("ocurre", () => {
  const ics = escribirRecurso(
    [{ id: "o1", titulo: "Natación", miembros: ["sofi"], fecha: "2026-11-04", todoElDia: false, horaInicio: "09:00", horaFin: "10:00", repeticion: "semanal", repetirHasta: "2026-12-31", externo: { conexion: "c1", uid: "o1@calendario-familiar" } }],
    ctx,
    "o1@calendario-familiar",
    null,
  );
  const v = parsear(ics).getFirstSubcomponent("vevent")!;
  ok("una ocurrencia de la serie (en otra forma: UTC)", ocurre(v, { dateTime: "2026-11-18T12:00:00Z" }));
  ok("la primera", ocurre(v, h("2026-11-04T09:00:00-03:00")));
  ok("otra hora ese día → no", !ocurre(v, h("2026-11-18T10:00:00-03:00")));
  ok("otro día de la semana → no", !ocurre(v, h("2026-11-19T09:00:00-03:00")));
  ok("después del hasta → no", !ocurre(v, h("2027-01-06T09:00:00-03:00")));
  ok("antes del inicio → no", !ocurre(v, h("2026-10-28T09:00:00-03:00")));
  ok("con EXDATE igual cuenta (la regla la genera)", (() => {
    const c = parsear(escribirRecurso([{ id: "o2", titulo: "N", miembros: ["sofi"], fecha: "2026-11-04", todoElDia: false, horaInicio: "09:00", horaFin: "10:00", repeticion: "semanal", excepciones: ["2026-11-18"], externo: { conexion: "c1", uid: "o2@calendario-familiar" } }], ctx, "o2@calendario-familiar", null)).getFirstSubcomponent("vevent")!;
    return ocurre(c, h("2026-11-18T09:00:00-03:00"));
  })());
  const anual = parsear(escribirRecurso([{ id: "o3", titulo: "C", miembros: ["sofi"], fecha: "2026-12-05", todoElDia: true, repeticion: "anual", externo: { conexion: "c1", uid: "o3@calendario-familiar" } }], ctx, "o3@calendario-familiar", null)).getFirstSubcomponent("vevent")!;
  ok("día completo: por fecha", ocurre(anual, { date: "2030-12-05" }) && !ocurre(anual, { date: "2030-12-06" }));
  ok("hora que no se entiende → no", !ocurre(v, { dateTime: "mañana" }));
});

caso("cuerpos de hora", () => {
  const vev = (lineas: string[]) => {
    const c = new ICAL.Component("vevent");
    for (const l of lineas) c.addProperty(ICAL.Property.fromString(l));
    return c;
  };
  const j = (x: unknown) => JSON.stringify(x);
  ok(
    "TZID Santiago en verano (-03:00)",
    j(cuerposDeHora(vev(["DTSTART;TZID=America/Santiago:20261104T090000", "DTEND;TZID=America/Santiago:20261104T100000"]), false)) ===
      j({ start: { date: null, dateTime: "2026-11-04T09:00:00-03:00", timeZone: SCL }, end: { date: null, dateTime: "2026-11-04T10:00:00-03:00", timeZone: SCL } }),
  );
  ok("TZID Santiago en invierno (-04:00)", (cuerposDeHora(vev(["DTSTART;TZID=America/Santiago:20260704T090000"]), false).start.dateTime ?? "") === "2026-07-04T09:00:00-04:00");
  ok("hora que no existe (adelanto del 6-sep-2026) → se corre como en ics.ts", cuerposDeHora(vev(["DTSTART;TZID=America/Santiago:20260906T003000"]), false).start.dateTime === "2026-09-06T01:30:00-03:00", cuerposDeHora(vev(["DTSTART;TZID=America/Santiago:20260906T003000"]), false));
  ok("hora repetida (atraso del 4-abr-2027) → la primera", cuerposDeHora(vev(["DTSTART;TZID=America/Santiago:20270403T233000"]), false).start.dateTime === "2027-04-03T23:30:00-03:00", cuerposDeHora(vev(["DTSTART;TZID=America/Santiago:20270403T233000"]), false));
  ok("UTC suelto → Z sin zona; en una serie → timeZone UTC", cuerposDeHora(vev(["DTSTART:20261104T200000Z"]), false).start.timeZone === null && j(cuerposDeHora(vev(["DTSTART:20261104T200000Z"]), true).start) === j({ date: null, dateTime: "2026-11-04T20:00:00Z", timeZone: "UTC" }));
  ok("flotante → como America/Santiago", j(cuerposDeHora(vev(["DTSTART:20261104T090000"]), false).start) === j({ date: null, dateTime: "2026-11-04T09:00:00-03:00", timeZone: SCL }));
  ok("otra zona IANA se respeta", j(cuerposDeHora(vev(["DTSTART;TZID=Europe/Madrid:20261220T080000"]), false).start) === j({ date: null, dateTime: "2026-12-20T08:00:00+01:00", timeZone: "Europe/Madrid" }));
  ok("zona desconocida → hora de Santiago", cuerposDeHora(vev(["DTSTART;TZID=Hora del Pacífico:20261104T090000"]), false).start.timeZone === SCL);
  ok("día completo sin DTEND → fin al día siguiente", j(cuerposDeHora(vev(["DTSTART;VALUE=DATE:20261205"]), false)) === j({ start: { date: "2026-12-05", dateTime: null, timeZone: null }, end: { date: "2026-12-06", dateTime: null, timeZone: null } }));
  ok("con hora sin DTEND → fin = inicio", (() => {
    const x = cuerposDeHora(vev(["DTSTART;TZID=America/Santiago:20261104T090000"]), false);
    return x.end.dateTime === x.start.dateTime;
  })());
  ok("DURATION → fin = inicio + duración (en instante, aunque cruce un cambio de hora)", cuerposDeHora(vev(["DTSTART;TZID=America/Santiago:20260905T230000", "DURATION:PT3H"]), false).end.dateTime === "2026-09-06T03:00:00-03:00", cuerposDeHora(vev(["DTSTART;TZID=America/Santiago:20260905T230000", "DURATION:PT3H"]), false));
  ok("finIgualInicio", finIgualInicio(cuerposDeHora(vev(["DTSTART;TZID=America/Santiago:20261104T090000"]), false) as unknown as Cuerpo) && !finIgualInicio({ start: { date: "2026-11-04" }, end: { date: "2026-11-05" } }));
});

caso("vista", () => {
  const a = serieAIcs(unaSerie(natacion()));
  const v = vista(a);
  ok("principal + un día cambiado (clave = instante del RECURRENCE-ID)", JSON.stringify(Object.keys(v).sort()) === JSON.stringify(["", `T:${Date.parse("2026-11-18T12:00:00Z")}`]), Object.keys(v));
  ok("EXDATE como instantes", JSON.stringify(v[""].exdate) === JSON.stringify([`T:${Date.parse("2026-11-11T12:00:00Z")}`, `T:${Date.parse("2026-11-25T12:00:00Z")}`]), v[""].exdate);
  const otro = a.replace("SUMMARY:🦄 Natación\r\n", "SUMMARY:🦄 Natación\r\nSEQUENCE:7\r\n").replace(/DTSTAMP:\d+T\d+Z/g, "DTSTAMP:20300101T000000Z");
  ok("SEQUENCE y DTSTAMP no cuentan", JSON.stringify(vista(otro)) === JSON.stringify(v));
  const utc = a.replace("EXDATE;TZID=America/Santiago:20261111T090000", "EXDATE:20261111T120000Z");
  ok("un EXDATE en UTC del mismo instante es el mismo", JSON.stringify(vista(utc)[""].exdate) === JSON.stringify(v[""].exdate));
  const dur = a.replace("DTEND;TZID=America/Santiago:20261104T100000", "DURATION:PT1H");
  ok("DURATION = DTEND equivalente", vista(dur)[""].end === v[""].end, [vista(dur)[""].end, v[""].end]);
});

caso("crear", () => {
  const uid = "e1@calendario-familiar";
  const local: Evento[] = [
    { id: "e1", titulo: "Natación", miembros: ["sofi"], fecha: "2026-11-04", todoElDia: false, horaInicio: "09:00", horaFin: "10:00", repeticion: "semanal", excepciones: ["2026-11-11", "2026-11-18"], nota: "Gorro", externo: { conexion: "c1", uid } },
    { id: "e1d", titulo: "Natación (piscina 2)", miembros: ["sofi"], fecha: "2026-11-18", todoElDia: false, horaInicio: "10:00", horaFin: "11:00", repeticion: "nunca", externo: { conexion: "c1", uid, recurrencia: "2026-11-18" } },
  ];
  const B = escribirRecurso(local, ctx, uid, null);
  const cr = planearCreacion(B);
  const c0 = cr.cuerpo(0);
  ok("uid y título", cr.uid === uid && cr.titulo === "🦄 Natación");
  ok(
    "insert: id del UID, textos, horas con zona, recurrence con un EXDATE por valor (sin el del día cambiado)",
    c0.id === idGoogleDe(uid) &&
      c0.summary === "🦄 Natación" &&
      c0.description === "Gorro" &&
      !("location" in c0) &&
      JSON.stringify(c0.start) === JSON.stringify({ dateTime: "2026-11-04T09:00:00-03:00", timeZone: SCL }) &&
      JSON.stringify(c0.recurrence) === JSON.stringify(["RRULE:FREQ=WEEKLY", "EXDATE;TZID=America/Santiago:20261111T090000"]),
    c0,
  );
  ok("insert: otra generación, otro id", cr.cuerpo(2).id === idGoogleDe(uid, 2));
  ok("insert: marca = huella de lo que se crea", (c0.extendedProperties as { private: { cfh: string } }).private.cfh === huellaPieza(fusionar({} as EvG, Object.fromEntries(Object.entries(c0).filter(([k]) => k !== "extendedProperties")))));
  ok("insert: sin campos prohibidos ni null", !PROHIBIDOS.some((k) => k in c0) && !JSON.stringify(c0).includes("null"));
  ok("un día cambiado", cr.dias.length === 1 && cr.dias[0].fecha === "2026-11-18" && cr.dias[0].original.dateTime === "2026-11-18T12:00:00Z", cr.dias);
  const d = cr.dias[0];
  ok("ventana de búsqueda de la instancia: ±1 día", d.desde === "2026-11-17T12:00:00Z" && d.hasta === "2026-11-19T12:00:00Z", d);
  const instancia: EvG = { id: `${c0.id}_20261118T120000Z`, etag: '"7"', status: "confirmed", recurringEventId: String(c0.id), originalStartTime: h("2026-11-18T09:00:00-03:00"), summary: "🦄 Natación", description: "Gorro", start: h("2026-11-18T09:00:00-03:00"), end: h("2026-11-18T10:00:00-03:00") };
  ok("calza por originalStartTime (en cualquier forma)", d.calza(instancia) && d.calza({ ...instancia, originalStartTime: { dateTime: "2026-11-18T12:00:00Z" } }) && !d.calza({ ...instancia, originalStartTime: h("2026-11-25T09:00:00-03:00") }));
  const cd = d.cuerpo(instancia);
  ok(
    "PATCH de la instancia: todos los campos del día (vacía la nota heredada) y la marca sobre la instancia",
    cd.summary === "🦄 Natación (piscina 2)" && cd.description === "" && cd.location === "" && (cd.start as HoraG).dateTime === "2026-11-18T10:00:00-03:00" && (cd.extendedProperties as { private: { cfh: string } }).private.cfh === huellaPieza(fusionar(instancia, { ...cd, extendedProperties: undefined } as Cuerpo)),
    cd,
  );
  const utc = parsear(["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:u1@calendario-familiar", "SUMMARY:R", "DTSTART:20261104T200000Z", "DTEND:20261104T210000Z", "RRULE:FREQ=WEEKLY;COUNT=3", "END:VEVENT", "END:VCALENDAR"].join("\r\n")).getFirstSubcomponent("vevent")!;
  const ci = cuerpoInsert(utc, "u1@calendario-familiar", 0);
  ok("serie en UTC: start.timeZone y end.timeZone = UTC (Google lo exige en las series)", JSON.stringify(ci.start) === JSON.stringify({ dateTime: "2026-11-04T20:00:00Z", timeZone: "UTC" }) && (ci.end as HoraG).timeZone === "UTC", ci);
  ok("recurrenciaDe junta los EXDATE en una línea por valor", JSON.stringify(recurrenciaDe(parsear(["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:x", "DTSTART;TZID=America/Santiago:20261104T090000", "RRULE:FREQ=WEEKLY", "EXDATE;TZID=America/Santiago:20261118T090000,20261111T090000", "END:VEVENT", "END:VCALENDAR"].join("\r\n")).getFirstSubcomponent("vevent")!)) === JSON.stringify(["RRULE:FREQ=WEEKLY", "EXDATE;TZID=America/Santiago:20261111T090000", "EXDATE;TZID=America/Santiago:20261118T090000"]));
  let error: unknown = null;
  try {
    planearCreacion(escribirRecurso([local[1]], ctx, uid, null));
  } catch (e) {
    error = e;
  }
  ok("sin principal → NoSePuedeEscribir", error instanceof NoSePuedeEscribir, String(error));
});

caso("fusionar, marcar y el respaldo sin hora de término", () => {
  const base: EvG = { id: "x", summary: "A", start: { date: "2026-11-04" }, end: { date: "2026-11-05" }, recurrence: ["RRULE:FREQ=DAILY"], extendedProperties: { private: { otra: "1" } } };
  const f = fusionar(base, { start: { date: null, dateTime: "2026-11-04T09:00:00-03:00", timeZone: SCL }, recurrence: null, location: "L", extendedProperties: { private: { cfh: "z" } } });
  ok("objetos se mezclan, null borra, arreglos se reemplazan", JSON.stringify(f.start) === JSON.stringify({ dateTime: "2026-11-04T09:00:00-03:00", timeZone: SCL }) && !("recurrence" in f) && f.location === "L" && JSON.stringify(f.extendedProperties) === JSON.stringify({ private: { otra: "1", cfh: "z" } }), f);
  ok("fusionar no cambia la base", JSON.stringify(base.start) === JSON.stringify({ date: "2026-11-04" }) && base.recurrence?.length === 1);
  const m = marcar(base, { summary: "B", extendedProperties: { private: { cfh: "vieja" } } });
  ok("marcar reemplaza una marca vieja y la calcula sobre el resultado", (m.extendedProperties as { private: { cfh: string } }).private.cfh === huellaPieza({ ...base, summary: "B" }));
  const p = principalNat();
  const c = marcar(p, { start: { date: null, dateTime: "2026-11-04T09:00:00-03:00", timeZone: SCL }, end: { date: null, dateTime: "2026-11-04T09:00:00-03:00", timeZone: SCL } });
  const s = sinHoraDeTermino(c, p);
  ok("sin hora de término: sin end, con endTimeUnspecified y la marca de nuevo", !("end" in s) && s.endTimeUnspecified === true && (s.extendedProperties as { private: { cfh: string } }).private.cfh === huellaPieza(fusionar(p, { start: c.start as Cuerpo, endTimeUnspecified: true })), s);
});

for (const r of resultados) console.log(r);
const malas = resultados.filter((r) => r.startsWith("MAL")).length;
console.log(`\n${resultados.length - malas} OK, ${malas} MAL`);
process.exit(malas ? 1 : 0);
