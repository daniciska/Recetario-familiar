// Pruebas de servidor/google/serie.ts (plan de pruebas C1.3 y C1.4): del listado de Google a series y
// .ics, leído con leerRecurso de servidor/ics.ts (lo mismo que hace el motor), y la marca de escritura
// propia (huellaPieza / esPropia). Funciones puras: sin red.
//
//   cd calendario && node --experimental-transform-types --no-warnings --import ./pruebas/registrar.mjs pruebas/google/serie.test.ts
import { escribirRecurso, instanteLocal, leerRecurso } from "../../servidor/ics";
import type { Evento } from "../../lib/datos/tipos";
import {
  MARCA_FANTASMAS,
  agrupar,
  esFantasma,
  esPropia,
  esRezagada,
  etagSerie,
  huellaPieza,
  inst,
  marcaFantasmas,
  normRec,
  proyectar,
  serieAIcs,
  textoPlano,
  type EvG,
  type HoraG,
  type Serie,
} from "../../servidor/google/serie";
import { cuerpoInsert, fusionar, planear, planearCreacion, type Cuerpo } from "../../servidor/google/escritura";
import { idDePrueba, idGoogleDe } from "../../servidor/google/ids";

// ---------- Arnés ----------
const resultados: string[] = [];
const ok = (nombre: string, cond: unknown, detalle: unknown = "") => {
  const d = detalle === "" ? "" : ` · ${(typeof detalle === "string" ? detalle : JSON.stringify(detalle)).slice(0, 500)}`;
  resultados.push(`${cond ? "OK " : "MAL"} ${nombre}${d}`);
};
function caso(nombre: string, fn: () => void) {
  try {
    fn();
  } catch (e) {
    ok(`${nombre} (lanzó)`, false, `${(e as Error)?.name}: ${(e as Error)?.message}`);
  }
}
function azar(semilla: number) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

/** La única serie de un listado. */
function unaSerie(items: EvG[], zonaCal: string | null = SCL): Serie {
  const m = agrupar(items, CAL, zonaCal);
  if (m.size !== 1) throw new Error(`se esperaba 1 serie y hay ${m.size}`);
  return [...m.values()][0];
}
const leer = (s: Serie) => leerRecurso(serieAIcs(s), ctx)!;
const resumen = (e: Evento) => ({
  id: e.id,
  t: e.titulo,
  m: e.miembros,
  f: e.fecha,
  ff: e.fechaFin,
  td: e.todoElDia,
  hi: e.horaInicio,
  hf: e.horaFin,
  rep: e.repeticion,
  ds: e.diasSemana,
  hasta: e.repetirHasta,
  ex: e.excepciones,
  fechas: e.fechas,
  rc: e.externo?.recurrencia,
  nota: e.nota,
});

// ---------- Corpus (como lo devolvería events.list con singleEvents=false y timeZone=America/Santiago) ----------
const idNat = idGoogleDe("ev_natacion1@calendario-familiar");
const natacion = (): EvG[] => [
  {
    id: idNat,
    etag: '"1"',
    status: "confirmed",
    summary: "🦄 Natación",
    start: h("2026-11-04T09:00:00-03:00"),
    end: h("2026-11-04T10:00:00-03:00"),
    recurrence: ["RRULE:FREQ=WEEKLY;WKST=MO;BYDAY=WE", "EXDATE;TZID=America/Santiago:20261111T090000"], // EXDATE del iPhone
    updated: "2026-11-05T12:00:00.000Z",
    created: "2026-11-01T12:00:00.000Z",
    sequence: 2,
    organizer: yo,
  },
  {
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
  },
  // Día borrado en la web: excepción cancelada (sin EXDATE).
  { id: `${idNat}_20261125T120000Z`, status: "cancelled", recurringEventId: idNat, originalStartTime: h("2026-11-25T09:00:00-03:00") },
  // Fantasma: idéntica a la serie.
  {
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
  },
];

caso("serie semanal con EXDATE, día movido, cancelado y fantasma", () => {
  const s = unaSerie(natacion());
  ok("agrupa: 1 viva, 1 fantasma, 1 cancelada; UID del panel", s.vivas.length === 1 && s.fantasmas.length === 1 && s.canceladas.length === 1 && s.uid === "ev_natacion1@calendario-familiar" && s.gen === 0 && !s.soloLectura, s);
  ok("href con el calendario y el id", s.href === `/calendar/v3/calendars/${encodeURIComponent(CAL)}/events/${idNat}`, s.href);
  const g = leer(s);
  const [p, d] = g.eventos;
  ok("2 eventos en la pared (la fantasma no aparece)", g.eventos.length === 2, g.eventos.map(resumen));
  ok(
    "principal semanal con excepciones 11, 18 y 25 de noviembre",
    p.id === "ev_natacion1" && p.titulo === "Natación" && p.miembros.join() === "sofi" && p.fecha === "2026-11-04" && p.horaInicio === "09:00" && p.horaFin === "10:00" && p.repeticion === "semanal" && JSON.stringify(p.excepciones) === JSON.stringify(["2026-11-11", "2026-11-18", "2026-11-25"]),
    resumen(p),
  );
  ok("día cambiado el 18-nov a las 10:00", d.fecha === "2026-11-18" && d.horaInicio === "10:00" && d.horaFin === "11:00" && d.externo?.recurrencia === "2026-11-18" && d.titulo === "Natación (piscina 2)", resumen(d));
  ok("ningún evento el 2-dic aparte de la serie", !g.eventos.some((e) => e.fecha === "2026-12-02"));
  const ics = serieAIcs(s);
  ok("sin VTIMEZONE ni hora actual; PRODID de Google", !/VTIMEZONE/.test(ics) && /PRODID:-\/\/Calendario familiar\/\/Google\/\/ES/.test(ics), ics);
  ok("el EXDATE de la cancelada va en la zona de la serie", /EXDATE;TZID=America\/Santiago:20261125T090000/.test(ics));
  ok("RECURRENCE-ID en la zona de la serie", /RECURRENCE-ID;TZID=America\/Santiago:20261118T090000/.test(ics));
  ok("SEQUENCE y CREATED del principal", /SEQUENCE:2/.test(ics) && /CREATED:20261101T120000Z/.test(ics));
  const pr = proyectar(s);
  ok("procedencia: p2 = la cancelada; porClave = la viva", pr.p2.size === 1 && [...pr.p2.values()][0].status === "cancelled" && pr.porClave.size === 1 && [...pr.porClave.values()][0].id.endsWith("_20261118T120000Z"));
  ok("modificado = el updated más alto de las piezas que se ven (no la fantasma)", g.modificado === "2026-11-06T12:00:00.000Z", g.modificado);
});

caso("cumpleaños anual de día completo con EXDATE;VALUE=DATE y nota en HTML", () => {
  const s = unaSerie([
    {
      id: idGoogleDe("k3m9@calendario-familiar"),
      etag: '"9"',
      status: "confirmed",
      summary: "🦄 Cumpleaños Sofía",
      description: "<b>Torta</b> de chocolate<br>en la casa &amp; jardín",
      start: { date: "2026-12-05" },
      end: { date: "2026-12-06" },
      recurrence: ["RRULE:FREQ=YEARLY", "EXDATE;VALUE=DATE:20271205"],
      updated: "2026-10-01T00:00:00.000Z",
      organizer: yo,
    },
  ]);
  const [e] = leer(s).eventos;
  ok(
    "anual, de día completo, con la excepción y la nota como texto",
    e.id === "k3m9" && e.repeticion === "anual" && e.todoElDia && e.fecha === "2026-12-05" && !e.fechaFin && JSON.stringify(e.excepciones) === '["2027-12-05"]' && e.nota === "Torta de chocolate\nen la casa & jardín" && e.miembros.join() === "sofi",
    resumen(e),
  );
});

caso("evento suelto en Europe/Madrid", () => {
  const s = unaSerie([
    { id: "zz9abc", etag: '"4"', status: "confirmed", summary: "Vuelo", start: h("2026-12-20T08:00:00+01:00", "Europe/Madrid"), end: h("2026-12-20T20:00:00-03:00", undefined), updated: "2026-11-05T00:00:00.000Z", organizer: yo },
  ]);
  const ics = serieAIcs(s);
  const [e] = leer(s).eventos;
  ok("UID de afuera = id@google.com", s.uid === "zz9abc@google.com" && s.gen === null, s.uid);
  ok("DTSTART en la zona del evento y DTEND en la del calendario", /DTSTART;TZID=Europe\/Madrid:20261220T080000/.test(ics) && /DTEND;TZID=America\/Santiago:20261220T200000/.test(ics), ics);
  ok("en Santiago: 04:00 a 20:00 del 20-dic", e.fecha === "2026-12-20" && e.horaInicio === "04:00" && e.horaFin === "20:00" && e.repeticion === "nunca", resumen(e));
});

caso("diaria hasta medianoche con UNTIL en UTC", () => {
  const s = unaSerie([
    {
      id: idGoogleDe("n@calendario-familiar"),
      etag: '"5"',
      status: "confirmed",
      summary: "Turno",
      start: h("2026-11-10T22:00:00-03:00"),
      end: h("2026-11-11T00:00:00-03:00"),
      recurrence: ["RRULE:FREQ=DAILY;UNTIL=20261115T025959Z"],
      updated: "2026-11-05T00:00:00.000Z",
      organizer: yo,
    },
  ]);
  const [e] = leer(s).eventos;
  ok("22:00 a 23:59, diaria hasta el 14-nov", e.horaInicio === "22:00" && e.horaFin === "23:59" && !e.fechaFin && e.repeticion === "diaria" && e.repetirHasta === "2026-11-14", resumen(e));
});

caso("sin hora de término (endTimeUnspecified)", () => {
  const s = unaSerie([
    { id: "sinfin01", etag: '"6"', status: "confirmed", summary: "Recordatorio", start: h("2026-11-20T10:00:00-03:00"), end: h("2026-11-20T11:00:00-03:00"), endTimeUnspecified: true, updated: "2026-11-05T00:00:00.000Z", organizer: yo },
  ]);
  const ics = serieAIcs(s);
  const [e] = leer(s).eventos;
  ok("DTEND = DTSTART y el panel no muestra hora de término", /DTEND;TZID=America\/Santiago:20261120T100000/.test(ics) && e.horaInicio === "10:00" && e.horaFin === undefined, resumen(e));
});

caso("grupo sin principal (invitación a un solo día)", () => {
  const s = unaSerie([
    {
      id: "ajeno77_20261118T120000Z",
      etag: '"7"',
      status: "confirmed",
      recurringEventId: "ajeno77",
      originalStartTime: h("2026-11-18T09:00:00-03:00"),
      summary: "Reunión del curso",
      start: h("2026-11-18T19:00:00-03:00"),
      end: h("2026-11-18T20:00:00-03:00"),
      updated: "2026-11-05T00:00:00.000Z",
      organizer: { email: "profe@colegio.cl" },
    },
  ]);
  const g = leer(s);
  ok("de sólo lectura, con el UID del recurringEventId", s.soloLectura && s.uid === "ajeno77@google.com" && !s.principal, s);
  ok("se lee como evento suelto", g.eventos.length === 1 && g.eventos[0].fecha === "2026-11-18" && g.eventos[0].horaInicio === "19:00" && g.eventos[0].repeticion === "nunca", g.eventos.map(resumen));
  ok("sin principal ni vivas no se expone", agrupar([{ id: "x1_20261118T120000Z", status: "cancelled", recurringEventId: "x1", originalStartTime: h("2026-11-18T09:00:00-03:00") }], CAL, SCL).size === 0);
});

caso("serie en UTC", () => {
  const s = unaSerie([
    { id: "utc0001", etag: '"8"', status: "confirmed", summary: "Reunión", start: h("2026-11-04T20:00:00Z", "UTC"), end: h("2026-11-04T21:00:00Z", "UTC"), recurrence: ["RRULE:FREQ=WEEKLY;COUNT=4"], updated: "2026-11-05T00:00:00.000Z", organizer: yo },
  ]);
  const ics = serieAIcs(s);
  const [e] = leer(s).eventos;
  ok("DTSTART en UTC (Z)", /DTSTART:20261104T200000Z/.test(ics), ics);
  ok("en la pared, fechas sueltas a las 17:00", JSON.stringify(e.fechas) === JSON.stringify(["2026-11-04", "2026-11-11", "2026-11-18", "2026-11-25"]) && e.horaInicio === "17:00", resumen(e));
});

caso("serie sin zona propia usa la del calendario", () => {
  const s = unaSerie(
    [{ id: "sz001", etag: '"1"', status: "confirmed", summary: "Inglés", start: h("2026-11-05T18:00:00-03:00", undefined), end: h("2026-11-05T19:00:00-03:00", undefined), recurrence: ["RRULE:FREQ=WEEKLY"], organizer: yo }],
    SCL,
  );
  const [e] = leer(s).eventos;
  ok("zona del calendario → semanal en Santiago", s.zona === SCL && e.repeticion === "semanal" && e.horaInicio === "18:00", { zona: s.zona, e: resumen(e) });
  const t = unaSerie([{ id: "sz002", etag: '"1"', status: "confirmed", summary: "X", start: h("2026-11-05T18:00:00-03:00", undefined), end: h("2026-11-05T19:00:00-03:00", undefined), organizer: yo }], null);
  ok("sin zona del calendario → America/Santiago", t.zona === SCL);
});

caso("determinismo", () => {
  const base = natacion();
  const a = serieAIcs(unaSerie(base));
  const r = azar(7);
  let iguales = 0;
  for (let i = 0; i < 20; i++) {
    const copia = structuredClone(base);
    for (let j = copia.length - 1; j > 0; j--) {
      const k = Math.floor(r() * (j + 1));
      [copia[j], copia[k]] = [copia[k], copia[j]];
    }
    if (serieAIcs(unaSerie(copia)) === a) iguales++;
  }
  ok("el mismo JSON en otro orden da el mismo .ics byte a byte (20 órdenes)", iguales === 20, iguales);
  // Las claves de cada objeto en otro orden tampoco importan.
  const alReves = base.map((e) => Object.fromEntries(Object.entries(e).reverse()) as unknown as EvG);
  ok("las claves en otro orden tampoco", serieAIcs(unaSerie(alReves)) === a);
  ok("y el mismo etag", unaSerie(alReves).etag === unaSerie(base).etag);
  ok("dos veces seguidas: igual (no usa la hora actual)", serieAIcs(unaSerie(natacion())) === a);
});

caso("LAST-MODIFIED sólo de piezas ajenas", () => {
  const marcar = (e: EvG): EvG => ({ ...e, extendedProperties: { private: { cfh: huellaPieza(e), otra: "x" } } });
  const [p, v, c, f] = natacion();
  const propias = unaSerie([marcar(p), marcar(v), c, f]);
  const g1 = leer(propias);
  ok("todas propias (la cancelada sin updated) → modificado null y sin DTSTAMP", g1.modificado === null && !/DTSTAMP|LAST-MODIFIED/.test(serieAIcs(propias)), { m: g1.modificado });
  const conAjena = unaSerie([marcar(p), marcar(v), { ...c, updated: "2026-11-08T10:00:00.789Z" }, f]);
  ok("una cancelada ajena → modificado = su updated (en segundos)", leer(conAjena).modificado === "2026-11-08T10:00:00.000Z", leer(conAjena).modificado);
  const vivaAjena = unaSerie([marcar(p), v, c, f]);
  ok("principal propia y día cambiado ajeno → modificado = el del día", leer(vivaAjena).modificado === "2026-11-06T12:00:00.000Z", leer(vivaAjena).modificado);
  // (otro día borrado en el iPhone: cambia lo que lee el panel, y la fantasma sigue siendo fantasma)
  const marcaVieja = unaSerie([{ ...marcar(p), recurrence: [...p.recurrence!, "EXDATE;TZID=America/Santiago:20261216T090000"] }, marcar(v), c, f]);
  ok("una pieza cambiada después de marcarla cuenta como ajena", leer(marcaVieja).modificado === "2026-11-05T12:00:00.000Z", leer(marcaVieja).modificado);
});

caso("etag de la serie", () => {
  const a = unaSerie(natacion()).etag;
  const cambiar = (i: number, cambio: Partial<EvG>) => {
    const l = natacion();
    l[i] = { ...l[i], ...cambio };
    return unaSerie(l).etag;
  };
  ok("estable y con forma g1…", a === unaSerie(natacion()).etag && /^g1[A-Za-z0-9_-]{26}$/.test(a), a);
  ok("cambia si cambia el principal", cambiar(0, { etag: '"10"' }) !== a);
  ok("cambia si cambia un día cambiado", cambiar(1, { etag: '"20"' }) !== a);
  ok("cambia si cambia la cancelada (etag o estado)", cambiar(2, { etag: '"x"' }) !== a);
  ok("cambia si cambia la fantasma", cambiar(3, { etag: '"30"' }) !== a);
  ok("cambia si pasa a sólo lectura", cambiar(0, { locked: true }) !== a);
  const s = unaSerie(natacion());
  ok("etagSerie(serie) = serie.etag", etagSerie(s) === s.etag);
});

caso("qué se descarta y qué es de sólo lectura", () => {
  const cumple: EvG[] = [
    { id: "bday1", etag: '"1"', status: "confirmed", eventType: "birthday", summary: "Cumpleaños de Ana", start: { date: "2026-03-01" }, end: { date: "2026-03-02" }, recurrence: ["RRULE:FREQ=YEARLY"] },
    { id: "bday1_20270301", etag: '"2"', status: "confirmed", eventType: "birthday", recurringEventId: "bday1", originalStartTime: { date: "2027-03-01" }, summary: "Cumple Ana (cambiado)", start: { date: "2027-03-02" }, end: { date: "2027-03-03" } },
  ];
  ok("cumpleaños (eventType) con su excepción: no aparecen", agrupar(cumple, CAL, SCL).size === 0);
  const fromGmail: EvG = { id: "gm1", status: "confirmed", eventType: "fromGmail", summary: "Vuelo", start: h("2026-12-01T10:00:00-03:00"), end: h("2026-12-01T11:00:00-03:00") };
  const normal: EvG = { id: "nn1", status: "confirmed", eventType: "default", summary: "Normal", start: h("2026-12-01T10:00:00-03:00"), end: h("2026-12-01T11:00:00-03:00"), organizer: yo };
  ok("fromGmail fuera; eventType default se queda", [...agrupar([fromGmail, normal], CAL, SCL).values()].map((s) => s.id).join() === "nn1");
  const prueba = idDePrueba("abc123def456ghi789jk");
  ok("el evento de Probar no se expone", agrupar([{ ...normal, id: prueba }, normal], CAL, SCL).size === 1);
  ok("principal cancelado: fuera con sus excepciones", agrupar([{ ...natacion()[0], status: "cancelled" }, natacion()[1]], CAL, SCL).size === 0);
  const ro = (e: Partial<EvG>) => unaSerie([{ ...natacion()[0], ...e }]).soloLectura;
  ok("invitación de otra persona → sólo lectura", ro({ organizer: { email: "otra@gmail.com", self: false } }));
  ok("organizer = el calendario sin self → editable", !ro({ organizer: { email: CAL.toUpperCase() } }));
  ok("organizer self=true con otro correo → editable", !ro({ organizer: { email: "dueno@gmail.com", self: true } }));
  ok("locked → sólo lectura", ro({ locked: true }));
  ok("privateCopy → sólo lectura", ro({ privateCopy: true }));
  ok("repetición que ical.js no entiende → sólo lectura", ro({ recurrence: ["RRULE:FREQ=NUNCA"] }));
  ok("una serie normal es editable", !ro({}));
});

caso("UID repetidos (lápida restaurada desde la papelera)", () => {
  const uid = "ev7@calendario-familiar";
  const pieza = (id: string): EvG => ({ id, etag: '"1"', status: "confirmed", summary: "Dentista", start: h("2026-11-20T10:00:00-03:00"), end: h("2026-11-20T11:00:00-03:00"), organizer: yo });
  const g0 = idGoogleDe(uid, 0);
  const g1 = idGoogleDe(uid, 1);
  const m = agrupar([pieza(g1), pieza(g0)], CAL, SCL);
  const s0 = [...m.values()].find((s) => s.id === g0)!;
  const s1 = [...m.values()].find((s) => s.id === g1)!;
  ok("lo conserva la de menor generación; la otra pasa a id@google.com", s0.uid === uid && s0.gen === 0 && s1.uid === `${g1}@google.com` && s1.gen === null, { s0: s0.uid, s1: s1.uid });
  const ajeno = "7n6f7a9g8a483r95t8en23rf";
  const recreada = idGoogleDe(`${ajeno}@google.com`);
  const m2 = agrupar([pieza(ajeno), pieza(recreada)], CAL, SCL);
  const uids = [...m2.values()].map((s) => s.uid);
  ok("serie de Google recreada desde la pared y la original restaurada: UID distintos", new Set(uids).size === 2 && [...m2.values()].find((s) => s.id === recreada)!.uid === `${ajeno}@google.com`, uids);
});

caso("textoPlano y normRec", () => {
  ok("texto normal queda igual", textoPlano("Llevar 2 < 3 cosas & más") === "Llevar 2 < 3 cosas & más");
  ok("HTML de Google web → texto", textoPlano("<p>Hola</p><p>Mamá &amp; papá</p><ul><li>uno</li><li>dos</li></ul>") === "Hola\nMamá & papá\nuno\ndos", textoPlano("<p>Hola</p><p>Mamá &amp; papá</p><ul><li>uno</li><li>dos</li></ul>"));
  ok("entidades numéricas y &nbsp;", textoPlano("a&nbsp;b &#39;c&#39; &#x41;<br/>") === "a b 'c' A");
  ok("&amp;lt; no se decodifica dos veces", textoPlano("<b>x</b> &amp;lt;") === "x &lt;");
  const n = (l: string[]) => JSON.stringify(normRec(l));
  ok("RRULE: el orden de las partes y de BYDAY no importa", n(["RRULE:FREQ=WEEKLY;BYDAY=WE,MO;COUNT=3"]) === n(["RRULE:COUNT=3;BYDAY=MO,WE;FREQ=WEEKLY"]));
  ok("RRULE: WKST=MO e INTERVAL=1 son por omisión", n(["RRULE:FREQ=WEEKLY;WKST=MO;INTERVAL=1"]) === n(["RRULE:FREQ=WEEKLY"]) && n(["RRULE:FREQ=WEEKLY;WKST=SU;INTERVAL=2"]) !== n(["RRULE:FREQ=WEEKLY;INTERVAL=2"]));
  ok("EXDATE: varios valores en una línea = una línea por valor", n(["EXDATE;TZID=America/Santiago:20261111T090000,20261118T090000"]) === n(["EXDATE;TZID=America/Santiago:20261118T090000", "EXDATE;TZID=America/Santiago:20261111T090000"]));
  ok("EXDATE: TZID y UTC del mismo instante son iguales", n(["EXDATE;TZID=America/Santiago:20261111T090000"]) === n(["EXDATE:20261111T120000Z"]));
  ok("EXDATE: otro instante es distinto", n(["EXDATE:20261111T120000Z"]) !== n(["EXDATE:20261111T130000Z"]));
  ok("UNTIL como instante", n(["RRULE:FREQ=DAILY;UNTIL=20261115T025959Z"]) !== n(["RRULE:FREQ=DAILY;UNTIL=20261115"]));
  ok("inst", inst({ date: "2026-11-04" }) === "D:2026-11-04" && inst(h("2026-11-04T09:00:00-03:00")) === `T:${Date.parse("2026-11-04T12:00:00Z")}|${SCL}` && inst(undefined) === "");
});

// ---------- C1.4 huellaPieza: la predicción calza con lo que guarda Google ----------

/** Desfase de una zona en un instante, como RFC 3339 (lo que hace events.list con timeZone=…). */
function enZonaIso(zona: string, ms: number): string {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
  const hh = p.hour === "24" ? "00" : p.hour;
  const min = Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +hh, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000) / 60000);
  const a = Math.abs(min);
  return `${p.year}-${p.month}-${p.day}T${hh}:${p.minute}:${p.second}${min < 0 ? "-" : "+"}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}

/**
 * PATCH (o insert, con base {}) "como Google": mezcla de objetos, null borra, arreglos reemplazan y
 * extendedProperties.private se mezcla clave por clave; después, lo que devuelve events.list con
 * timeZone=America/Santiago (dateTime con el desfase de Santiago). Con `normalizar`, además: reordena las
 * partes de RRULE, pasa los EXDATE con TZID a UTC y deja la zona tal cual.
 */
function aplicarComoGoogle(base: EvG, cuerpo: Cuerpo, normalizar = false, n = 1): EvG {
  const r = fusionar(base, cuerpo) as EvG & Record<string, unknown>;
  delete r.id;
  r.id = base.id ?? String(cuerpo.id ?? "nuevo");
  r.etag = `"e${n}"`;
  r.updated = new Date(Date.UTC(2026, 10, 9, 12, 0, n)).toISOString();
  r.status ??= "confirmed";
  for (const k of ["start", "end", "originalStartTime"] as const) {
    const t = r[k];
    if (t?.dateTime) r[k] = { ...t, dateTime: enZonaIso(SCL, Date.parse(t.dateTime)) };
  }
  if (normalizar && r.recurrence) {
    r.recurrence = r.recurrence.map((l) => {
      if (/^RRULE:/.test(l)) return "RRULE:" + l.slice(6).split(";").reverse().join(";");
      const m = /^EXDATE;TZID=([^:]+):(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(l);
      if (!m) return l;
      const t = instanteLocal(m[1], +m[2], +m[3], +m[4], +m[5], +m[6], +m[7]);
      return `EXDATE:${new Date(t).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`;
    });
  }
  return r;
}

caso("huellaPieza: la predicción calza con lo que queda en Google", () => {
  const s = unaSerie(natacion());
  const A = serieAIcs(s);
  const g = leerRecurso(A, ctx)!;
  const local = (cambio: (l: Evento[]) => Evento[]) => escribirRecurso(cambio(structuredClone(g.eventos)), ctx, g.uid, A);
  const cambios: [string, (l: Evento[]) => Evento[]][] = [
    ["título", (l) => l.map((e) => (e.externo?.recurrencia ? e : { ...e, titulo: "Natación y clavados" }))],
    ["borrar un día", (l) => l.map((e) => (e.externo?.recurrencia ? e : { ...e, excepciones: [...(e.excepciones ?? []), "2026-12-09"] }))],
    ["hora de término", (l) => l.map((e) => (e.externo?.recurrencia ? e : { ...e, horaFin: "10:45" }))],
    ["nota y lugar", (l) => l.map((e) => (e.externo?.recurrencia ? e : { ...e, nota: "Llevar gorro", lugar: "Piscina municipal" }))],
    ["hasta", (l) => l.map((e) => (e.externo?.recurrencia ? e : { ...e, repetirHasta: "2027-03-31" }))],
    ["lugar del día cambiado", (l) => l.map((e) => (e.externo?.recurrencia ? { ...e, lugar: "Piscina 2" } : e))],
    ["hora del día cambiado", (l) => l.map((e) => (e.externo?.recurrencia ? { ...e, horaInicio: "10:30", horaFin: "11:30" } : e))],
    ["borrar el día cambiado", (l) => l.filter((e) => !e.externo?.recurrencia)],
    ["borrar el día de la fantasma", (l) => l.map((e) => (e.externo?.recurrencia ? e : { ...e, excepciones: [...(e.excepciones ?? []), "2026-12-02"] }))],
  ];
  const piezas = new Map([s.principal!, ...s.vivas, ...s.fantasmas, ...s.canceladas].map((x) => [x.id, x]));
  for (const normalizar of [false, true]) {
    for (const [nombre, f] of cambios) {
      const plan = planear(s, local(f));
      const cuerpos: [EvG, Cuerpo][] = [...(plan.maestro ? [[s.principal!, plan.maestro] as [EvG, Cuerpo]] : []), ...plan.ops.map((o) => [piezas.get(o.id)!, o.cuerpo] as [EvG, Cuerpo])];
      const calzan = cuerpos.map(([b, c]) => {
        const r = aplicarComoGoogle(b, c, normalizar);
        if (c.status !== "cancelled") return esPropia(r);
        // Una excepción cancelada puede volver del listado con pocos campos: es propia si trae la marca
        // (con todos sus campos o sólo con id, estado y originalStartTime) y ajena si no la trae.
        const minima: EvG = { id: r.id, status: r.status, recurringEventId: r.recurringEventId, originalStartTime: { dateTime: r.originalStartTime!.dateTime } };
        return esPropia(r) && esPropia({ ...minima, extendedProperties: r.extendedProperties }) && !esPropia(minima);
      });
      ok(`${normalizar ? "con Google normalizando: " : ""}${nombre} → ${cuerpos.length} cuerpo(s), todos propios al releer`, cuerpos.length > 0 && calzan.every(Boolean), { cuerpos, calzan });
    }
  }
  // Crear: el insert (base {}) y un día cambiado al recrear.
  const nuevo = escribirRecurso(
    [{ id: "e1", titulo: "Dentista", miembros: ["sofi"], fecha: "2026-11-20", todoElDia: false, horaInicio: "10:00", horaFin: "11:00", repeticion: "semanal", excepciones: ["2026-11-27"], externo: { conexion: "c1", uid: "e1@calendario-familiar" } }],
    ctx,
    "e1@calendario-familiar",
    null,
  );
  const cr = planearCreacion(nuevo);
  const ins = cr.cuerpo(0);
  const leido = aplicarComoGoogle({} as EvG, ins, false);
  ok("insert: lo que vuelve es propio", esPropia({ ...leido, organizer: yo, iCalUID: `${ins.id}@google.com` }), { ins, leido });
  ok("insert: con Google normalizando, también", esPropia(aplicarComoGoogle({} as EvG, ins, true)));
  ok("cuerpoInsert = planearCreacion().cuerpo", JSON.stringify(cuerpoInsert(cr.principal, "e1@calendario-familiar", 2)) === JSON.stringify(cr.cuerpo(2)));
});

caso("huellaPieza: nunca calza si cambió algo que lee el panel (1.000 cambios al azar)", () => {
  const r = azar(1234);
  const s = unaSerie(natacion());
  const bases: EvG[] = [s.principal!, s.vivas[0], s.fantasmas[0]].map((e) => ({ ...e, extendedProperties: { private: { cfh: huellaPieza(e) } } }));
  ok("las bases marcadas son propias", bases.every(esPropia));
  const letras = "abcdefghijklmnñopqrstuvwxyzáéíóú0123456789🦄⚽";
  const letra = () => [...letras][Math.floor(r() * [...letras].length)];
  const mover = (t: HoraG | undefined, min: number): HoraG | undefined =>
    t?.dateTime ? { ...t, dateTime: enZonaIso(SCL, Date.parse(t.dateTime) + min * 60_000) } : t?.date ? { date: new Date(Date.parse(`${t.date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) } : { date: "2026-01-01" };
  const cambios: ((e: EvG) => EvG)[] = [
    (e) => ({ ...e, summary: (e.summary ?? "") + letra() }),
    (e) => ({ ...e, summary: letra() + (e.summary ?? "") }),
    (e) => ({ ...e, description: (e.description ?? "") + letra() }),
    (e) => ({ ...e, location: (e.location ?? "") + letra() }),
    (e) => ({ ...e, status: e.status === "tentative" ? "confirmed" : "tentative" }),
    (e) => ({ ...e, start: mover(e.start, 1 + Math.floor(r() * 600)) }),
    (e) => ({ ...e, end: mover(e.end, -(1 + Math.floor(r() * 30))) }),
    (e) => ({ ...e, endTimeUnspecified: !e.endTimeUnspecified }),
    (e) => ({ ...e, start: e.start?.dateTime ? { ...e.start, timeZone: "America/Punta_Arenas" } : e.start }),
    (e) => ({ ...e, recurrence: [...(e.recurrence ?? []), `EXDATE;TZID=America/Santiago:202612${String(10 + Math.floor(r() * 18))}T090000`] }),
    (e) => ({ ...e, recurrence: (e.recurrence ?? ["RRULE:FREQ=DAILY"]).map((l) => (l.startsWith("RRULE") ? `${l};COUNT=${2 + Math.floor(r() * 50)}` : l)) }),
    (e) => ({ ...e, recurrence: e.recurrence?.length ? e.recurrence.slice(1) : ["RRULE:FREQ=MONTHLY"] }),
    (e) => ({ ...e, originalStartTime: mover(e.originalStartTime, 60 * (1 + Math.floor(r() * 48))) }),
  ];
  let calzan = 0;
  let ejemplo: unknown = null;
  for (let i = 0; i < 1000; i++) {
    const b = bases[i % bases.length];
    const c = cambios[Math.floor(r() * cambios.length)](structuredClone(b));
    if (esPropia(c)) {
      calzan++;
      ejemplo ??= { antes: b, despues: c };
    }
  }
  ok("0 de 1.000 cambios siguen pareciendo propios", calzan === 0, { calzan, ejemplo });
  ok("sin marca no es propia; con una marca ajena tampoco", !esPropia({ ...bases[0], extendedProperties: undefined }) && !esPropia({ ...bases[0], extendedProperties: { private: { cfh: "0000000000000000" } } }));
  ok("cambios que el panel no lee no quitan la marca (recordatorios, color, Meet)", esPropia({ ...bases[0], etag: '"99"', updated: "2027-01-01T00:00:00Z", sequence: 9, attendees: [{ email: "a@b.cl" }] }));
});

caso("fantasmas rezagadas (marca cfv del principal)", () => {
  // La serie cambió de título y de lugar desde el panel, y su fantasma del 2-dic no alcanzó a seguirla.
  const base = natacion();
  const [p0, , , f0] = base;
  const ahora = Date.parse("2026-11-08T12:00:00.000Z");
  const nuevo = { ...p0, summary: "🦄 Natación libre", location: "Piscina 2", updated: "2026-11-08T12:00:05.000Z" };
  const marca = marcaFantasmas(p0, nuevo, [f0], ahora);
  ok("la marca: una entrada por campo que cambió (título y lugar), con su hora", typeof marca === "string" && /^[sl]\.[0-9a-f]{12}\.[0-9a-z]+,[sl]\.[0-9a-f]{12}\.[0-9a-z]+$/.test(marca) && marca.includes("s.") && marca.includes("l."), marca);
  const conMarca = (p: EvG, m: string | null | undefined) => ({ ...p, extendedProperties: { private: { cfh: "x", ...(m ? { [MARCA_FANTASMAS]: m } : {}) } } });
  const pM = conMarca(nuevo, marca as string);
  ok("sin fantasmas no hace falta la marca; sin cambios de esos campos, tampoco", marcaFantasmas(p0, nuevo, [], ahora) === undefined && marcaFantasmas(p0, { ...p0, recurrence: ["RRULE:FREQ=WEEKLY"] }, [f0], ahora) === undefined);
  ok("si ya no explica a nadie, se borra (null)", marcaFantasmas(pM, { ...pM, summary: "Otra" }, [], ahora) === null, marcaFantasmas(pM, { ...pM, summary: "Otra" }, [], ahora));
  const s = unaSerie([pM, base[1], base[2], f0]);
  ok("la fantasma con el título y el lugar de antes es rezagada: cuenta como fantasma y no es esFantasma", s.fantasmas.length === 1 && s.vivas.length === 1 && esRezagada(f0, pM) && !esFantasma(f0, pM));
  const g = leer(s);
  ok("…y la pared no la ve como día cambiado (2 eventos, ninguno el 2-dic)", g.eventos.length === 2 && !g.eventos.some((e) => e.fecha === "2026-12-02"), g.eventos.map(resumen));
  ok("a medias (Google ya le pasó el título; el lugar sigue viejo) también", esRezagada({ ...f0, summary: nuevo.summary }, pM));
  ok("con un valor que no es de antes (otro lugar) es un día cambiado", !esRezagada({ ...f0, location: "Patio" }, pM) && unaSerie([pM, { ...f0, location: "Patio" }]).vivas.length === 1);
  ok("si alguien la tocó después del cambio (updated posterior a la marca + margen) es un día cambiado", !esRezagada({ ...f0, updated: "2026-11-08T12:10:00.000Z" }, pM) && esRezagada({ ...f0, updated: "2026-11-08T12:01:00.000Z" }, pM));
  ok("movida de hora, cancelada o sin updated: no es rezagada", !esRezagada({ ...f0, start: h("2026-12-02T10:00:00-03:00"), end: h("2026-12-02T11:00:00-03:00") }, pM) && !esRezagada({ ...f0, updated: undefined }, pM) && unaSerie([pM, { ...f0, status: "cancelled" }]).canceladas.length === 1);
  ok("sin la marca (p. ej. el iPhone borró las extendedProperties) es un día cambiado", !esRezagada(f0, nuevo) && unaSerie([nuevo, f0]).vivas.length === 1);
  // Otro cambio (la hora de término) antes de que se ponga al día: la marca nueva conserva las entradas
  // que todavía la explican y agrega la de la duración.
  const otro = { ...pM, end: h("2026-11-04T10:30:00-03:00") };
  const marca2 = marcaFantasmas(pM, otro, [f0], ahora + 60_000);
  const pM2 = conMarca(otro, marca2 as string);
  ok("un segundo cambio conserva lo que explica a la rezagada y agrega la duración", typeof marca2 === "string" && marca2.split(",").length === 3 && marca2.includes("h.") && esRezagada(f0, pM2), marca2);
  ok("…y una fantasma normal del segundo cambio (título y lugar nuevos, duración vieja) también es rezagada", esRezagada({ ...f0, summary: nuevo.summary, location: "Piscina 2" }, pM2));
  ok("la marca nunca pasa de 24 entradas", (() => {
    let p = p0;
    for (let i = 0; i < 40; i++) {
      const q = { ...p, summary: `T${i}` };
      const m = marcaFantasmas(p, q, [{ ...f0, summary: p.summary }], ahora + i * 1000);
      p = conMarca(q, typeof m === "string" ? m : (p.extendedProperties?.private?.[MARCA_FANTASMAS] ?? null));
    }
    const m = p.extendedProperties?.private?.[MARCA_FANTASMAS] ?? "";
    return m.split(",").length <= 24 && m.length < 1024;
  })());
});

for (const r of resultados) console.log(r);
const malas = resultados.filter((r) => r.startsWith("MAL")).length;
console.log(`\n${resultados.length - malas} OK, ${malas} MAL`);
process.exit(malas ? 1 : 0);
