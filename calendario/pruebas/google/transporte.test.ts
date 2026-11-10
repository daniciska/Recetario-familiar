// Pruebas de servidor/google/transporte.ts (plan de pruebas C3: contrato del transporte contra el
// simulador) y de servidor/proveedores.ts. Sin red: el token y la API van al simulador en 127.0.0.1.
//
//   cd calendario && node --experimental-transform-types --no-warnings --import ./pruebas/registrar.mjs pruebas/google/transporte.test.ts
import { createServer } from "node:http";
import { iniciarSimulador, respuestas, es, type PedidoVisto, type Rol } from "./mock-google.mts";
import { clavePrueba, usarClave } from "./clave-prueba.ts";
import { ErrorCalDAV, CalDAV } from "../../servidor/caldav";
import { NoSePuedeEscribir, escribirRecurso, huellaGrupo, leerRecurso, uidDe } from "../../servidor/ics";
import { leerCuentaServicio, olvidarTokens, type CuentaServicio } from "../../servidor/google/cuenta";
import { idGoogleDe, uidDesdeId } from "../../servidor/google/ids";
import { agrupar, hrefSerie, serieAIcs, type EvG } from "../../servidor/google/serie";
import { planear } from "../../servidor/google/escritura";
import {
  GoogleCalendar,
  URL_API_GOOGLE,
  baseApiGoogle,
  idCalendarioValido,
  normalizarIdCalendario,
  problemaDeRol,
  rutaCalendario,
} from "../../servidor/google/transporte";
import {
  CLAVE_DUENO_GOOGLE,
  credencialesICloud,
  nombreProveedor,
  proveedorConfigurado,
  textoSinCuenta,
  transporteDe,
} from "../../servidor/proveedores";
import * as transporteGoogle from "../../servidor/google/transporte";
import { credencialesICloud as credencialesMotor } from "../../servidor/sincronizar";
import type { Evento } from "../../lib/datos/tipos";
import type { ConexionCalendario } from "../../servidor/comun";

// ---------- Arnés ----------
let buenas = 0;
let malas = 0;
const ok = (nombre: string, cond: unknown, detalle: unknown = "") => {
  if (cond) buenas++;
  else malas++;
  const d = detalle === "" ? "" : ` · ${(typeof detalle === "string" ? detalle : JSON.stringify(detalle)).slice(0, 600)}`;
  console.log(`${cond ? "OK " : "MAL"} ${nombre}${cond ? "" : d}`);
};
const seccion = (t: string) => console.log(`\n# ${t}`);
async function caso(nombre: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    ok(`${nombre} (lanzó)`, false, `${(e as Error)?.name}: ${(e as Error)?.message}\n${(e as Error)?.stack?.split("\n").slice(1, 4).join("\n")}`);
  }
}
/** Promesa → {valor} o {error}, sin lanzar. */
async function intentar<T>(p: Promise<T>): Promise<{ valor?: T; error?: unknown; ms: number }> {
  const t0 = Date.now();
  try {
    return { valor: await p, ms: Date.now() - t0 };
  } catch (e) {
    return { error: e, ms: Date.now() - t0 };
  }
}
const codigo = (r: { error?: unknown }) =>
  r.error instanceof ErrorCalDAV ? r.error.codigo : r.error instanceof NoSePuedeEscribir ? "NoSePuedeEscribir" : r.error ? `otro: ${String(r.error)}` : "sin error";
const mensaje = (r: { error?: unknown }) => (r.error instanceof Error ? r.error.message : "");
const dormir = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

// Todo pedido del proceso queda anotado: al final se revisa que nada salió de 127.0.0.1.
const urls: string[] = [];
const fetchReal = globalThis.fetch;
globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
  urls.push(String(url instanceof Request ? url.url : url));
  return fetchReal(url, init);
}) as typeof fetch;

// ---------- Simulador, clave y calendarios ----------
const clave = clavePrueba();
const SA = clave.correo;
const DUENA = "mama@gmail.com";
const ZS = "America/Santiago";
const sim = await iniciarSimulador({ cuentas: new Map([[SA, clave.publica]]), semilla: 11 });
process.env.GOOGLE_API_URL = sim.apiUrl;
process.env.GOOGLE_TOKEN_URL = sim.tokenUrl;
const leida = leerCuentaServicio(clave.json);
if (!("cuenta" in leida)) throw new Error(leida.problema);
const cuenta: CuentaServicio = leida.cuenta;

let nCal = 0;
function nuevoCal(rol: Rol | null = "owner", zona = ZS): string {
  const id = `c_t${++nCal}@group.calendar.google.com`;
  sim.crearCalendario(id, { zona, resumen: "Familia", dueno: DUENA });
  if (rol) sim.compartir(id, SA, rol);
  return id;
}
const gc = (op: { hasta?: number; espera?: number } = {}) => new GoogleCalendar(cuenta, baseApiGoogle(), op.espera ?? 8000, op.hasta ?? Date.now() + 20_000);
const hora = (f: string, h: string) => ({ dateTime: `${f}T${h}:00-03:00`, timeZone: ZS });
const semanal = (extra: Record<string, unknown> = {}) => ({
  summary: "🦄 Natación",
  start: hora("2026-11-04", "09:00"),
  end: hora("2026-11-04", "10:00"),
  recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE"],
  ...extra,
});

// Panel
const miembros = [
  { id: "sofi", nombre: "Sofía", color: "#f00", emoji: "🦄" },
  { id: "tomi", nombre: "Tomás", color: "#0f0", emoji: "⚽" },
];
const ctx = { conexion: "c1", miembros, hoy: "2026-11-09" };
let nEv = 0;
function evPanel(parcial: Partial<Evento> = {}): Evento {
  const id = parcial.id ?? `ev${++nEv}x${Date.now().toString(36)}`;
  return {
    id,
    titulo: "Dentista",
    miembros: ["sofi"],
    fecha: "2026-11-20",
    todoElDia: false,
    horaInicio: "10:00",
    horaFin: "11:00",
    repeticion: "nunca",
    externo: { conexion: "c1", uid: `${id}@calendario-familiar` },
    actualizado: "2026-11-09T12:00:00.000Z",
    ...parcial,
  } as Evento;
}
const icsDe = (ev: Evento) => escribirRecurso([ev], ctx, uidDe(ev), null);

/** Lo que ve el motor: listar + traer + leerRecurso. */
async function leer(t: GoogleCalendar, cal: string) {
  const l = await t.listar(cal);
  const { leidos } = await t.traer(cal, [...l.recursos.keys()]);
  return leidos.map((x) => ({ ...x, g: leerRecurso(x.ics, ctx) }));
}
/** Como subirGrupo del motor: lee la serie, cambia el panel y escribe B a partir de lo de Google. */
async function cambiarEnPanel(t: GoogleCalendar, cal: string, uid: string, cambio: (l: Evento[]) => Evento[]) {
  const s = (await leer(t, cal)).find((x) => x.g?.uid === uid);
  if (!s) throw new Error(`no está la serie ${uid}`);
  const local = cambio(structuredClone(s.g!.eventos)).map((e) => ({ ...e, actualizado: "2026-11-09T13:00:00.000Z" }));
  const B = escribirRecurso(local, ctx, uid, s.ics);
  return { r: await intentar(t.actualizar(cal, s.href, B, s.etag)), s, B };
}
const principal = (l: Evento[]) => l.filter((e) => !e.externo?.recurrencia);
const enPrincipal = (f: (e: Evento) => Evento) => (l: Evento[]) => l.map((e) => (e.externo?.recurrencia ? e : f(e)));
const contar = (tipo: string) => sim.contadores.porTipo[tipo] ?? 0;
const escrituras = () => sim.contadores.escrituras;
const vivos = (cal: string) => sim.eventos(cal, { lapidas: false });

// =====================================================================================
seccion("Direcciones, IDs y seguridad");
await caso("base y rutas", async () => {
  const antes = process.env.GOOGLE_API_URL;
  process.env.GOOGLE_API_URL = "https://ejemplo.invalid/calendar/v3/";
  ok("GOOGLE_API_URL externo → se ignora (Google)", baseApiGoogle() === URL_API_GOOGLE);
  process.env.GOOGLE_API_URL = "http://localhost.ejemplo.invalid/";
  ok("…tampoco «localhost.algo»", baseApiGoogle() === URL_API_GOOGLE);
  process.env.GOOGLE_API_URL = antes;
  ok("GOOGLE_API_URL local → se usa", baseApiGoogle() === sim.apiUrl);
  ok("constructor con una base ajena → Google", new GoogleCalendar(cuenta, "https://ejemplo.invalid/v3/").base === URL_API_GOOGLE);
  ok("constructor con base local sin «/» final → se agrega", new GoogleCalendar(cuenta, sim.apiUrl.replace(/\/$/, "")).base === sim.apiUrl);
  ok("ID válidos", ["c_abc123@group.calendar.google.com", "mama@gmail.com", "x.y_z-1@group.calendar.google.com"].every(idCalendarioValido));
  ok("ID inválidos", ["", "sin-arroba", "a@b@c", "a b@c.d", "a/b@c.d", "a@c.d?x", "a#b@c.d", "@x.y", "x@"].every((x) => !idCalendarioValido(x)));
  let lanzo = false;
  try {
    rutaCalendario("../../otra");
  } catch (e) {
    lanzo = e instanceof ErrorCalDAV && e.codigo === "SERVIDOR";
  }
  ok("rutaCalendario con un ID inválido → SERVIDOR", lanzo);
  ok("rutaCalendario codifica el ID", rutaCalendario("c_1@group.calendar.google.com") === "calendars/c_1%40group.calendar.google.com");
  const n = urls.length;
  const r = await intentar(gc().listar("no es un id"));
  ok("listar con un ID inválido → SERVIDOR sin ningún pedido", codigo(r) === "SERVIDOR" && urls.length === n, mensaje(r));
  const t = gc();
  const malas = ["https://ejemplo.invalid/x", "/calendars/x@y.z/events", "calendars/../token", "calendars/x@y.z/../../token", "calendars//x", "otra/cosa", "calendars/a@b.c?x=1"];
  let todas = true;
  for (const m of malas) {
    const x = await intentar(t.pedirJSON("GET", m));
    if (codigo(x) !== "SERVIDOR") todas = false;
  }
  ok("pedirJSON rechaza rutas que no son de un calendario (el token nunca va a otro lado)", todas && urls.length === n);
});

await caso("normalizarIdCalendario", async () => {
  const id = "c_8f3a1b@group.calendar.google.com";
  const casos: [unknown, string | null][] = [
    [`  ${id}  `, id],
    [`https://calendar.google.com/calendar/embed?src=${encodeURIComponent(id)}&ctz=America%2FSantiago`, id],
    [`<iframe src="https://calendar.google.com/calendar/embed?src=${encodeURIComponent(id)}&amp;ctz=America%2FSantiago" style="border: 0" width="800"></iframe>`, id],
    [`https://calendar.google.com/calendar/u/0?cid=${Buffer.from(id).toString("base64").replace(/=+$/, "")}`, id],
    [`https://calendar.google.com/calendar/ical/${encodeURIComponent(id)}/private-abc/basic.ics`, id],
    ["mama@gmail.com", "mama@gmail.com"],
    ["https://calendar.google.com/calendar/u/0/r", null],
    ["no es un id", null],
    [42, null],
  ];
  const fallan = casos.filter(([e, s]) => normalizarIdCalendario(e) !== s);
  ok("ID tal cual, embed?src=, iframe, cid= (base64) y dirección iCal; lo demás → null", !fallan.length, fallan);
});

await caso("redirecciones: no se siguen y el token no sale", async () => {
  let recibidos = 0;
  const otro = createServer((req, res) => {
    recibidos++;
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
  await new Promise<void>((ok) => otro.listen(0, "127.0.0.1", ok));
  const puerto = (otro.address() as { port: number }).port;
  const cal = nuevoCal();
  sim.inyectar(es.tipo("events.list"), respuestas.status(302, undefined, { location: `http://127.0.0.1:${puerto}/robar` }));
  const r = await intentar(gc().listar(cal));
  ok("302 → RED (redirect: error) y el otro servidor no recibe nada", codigo(r) === "RED" && recibidos === 0, [codigo(r), recibidos]);
  await new Promise((ok) => otro.close(ok));
});

// =====================================================================================
seccion("listar: completo o error");
await caso("páginas", async () => {
  const cal = nuevoCal();
  const web = sim.actor("web", cal);
  for (let i = 0; i < 5; i++) web.crear({ summary: `Evento ${i}`, start: hora("2026-11-2" + i, "10:00"), end: hora("2026-11-2" + i, "11:00") });
  sim.reiniciarContadores();
  const una = await gc().listar(cal);
  ok("1 página: 5 recursos, 1 events.list", una.recursos.size === 5 && contar("events.list") === 1, [una.recursos.size, sim.contadores.porTipo]);
  ok("ctag con forma g1:…", /^g1:[A-Za-z0-9_-]{43}$/.test(una.ctag ?? ""), una.ctag);
  for (const modo of [[2, 3], [1, 0, 2, 0, 0, 2], [0, 0, 1, 1, 1, 0, 2]]) {
    sim.paginacion.modo = modo;
    sim.reiniciarContadores();
    const l = await gc().listar(cal);
    const paginas = contar("events.list");
    ok(`páginas ${JSON.stringify(modo)} (con vacías entre medio): los mismos recursos y etags, el mismo ctag`, paginas === modo.length && JSON.stringify([...l.recursos].sort()) === JSON.stringify([...una.recursos].sort()) && l.ctag === una.ctag, [paginas, l.recursos.size]);
  }
  sim.paginacion.modo = "normal";
  // El pedido lleva lo del plan 1.6.
  const q = sim.registro.filter((x) => x.tipo === "events.list").pop()!.query;
  const p = new URLSearchParams(q);
  ok("singleEvents=false, maxResults=2500, timeZone=America/Santiago, fields, sin showDeleted/timeMin/syncToken", p.get("singleEvents") === "false" && p.get("maxResults") === "2500" && p.get("timeZone") === ZS && !!p.get("fields") && !p.has("showDeleted") && !p.has("timeMin") && !p.has("syncToken"), q);
});

await caso("3.000 eventos en páginas de tamaño al azar", async () => {
  const cal = nuevoCal();
  const web = sim.actor("web", cal);
  for (let i = 0; i < 3000; i++) {
    const d = new Date(Date.UTC(2026, 0, 1) + (i % 700) * 86_400_000).toISOString().slice(0, 10);
    web.crear({ summary: `E${i}`, start: hora(d, "08:00"), end: hora(d, "09:00"), ...(i % 10 === 0 ? { recurrence: ["RRULE:FREQ=WEEKLY;COUNT=5"] } : {}) });
  }
  const normal = await gc().listar(cal);
  sim.paginacion.modo = "azar";
  sim.paginacion.probVacia = 0.3;
  sim.reiniciarContadores();
  const azar = await gc({ hasta: Date.now() + 60_000 }).listar(cal);
  const pags = contar("events.list");
  sim.paginacion.modo = "normal";
  ok("los mismos 3.000 recursos y etags que con páginas completas", normal.recursos.size === 3000 && JSON.stringify([...azar.recursos].sort()) === JSON.stringify([...normal.recursos].sort()) && azar.ctag === normal.ctag, [normal.recursos.size, azar.recursos.size, pags]);
  ok("…en más de una página", pags > 1, pags);
});

await caso("roles que no sirven → PERMISO con el texto del rol", async () => {
  const textos: [Rol, RegExp][] = [
    ["freeBusyReader", /compartido solo para ver/],
    ["reader", /compartido solo para ver/],
    ["writerWithoutPrivateAccess", /disponible\/ocupado/],
  ];
  for (const [rol, re] of textos) {
    const cal = nuevoCal(rol);
    sim.actor("web", cal).crear({ summary: "x", start: hora("2026-11-20", "10:00"), end: hora("2026-11-20", "11:00") });
    const r = await intentar(gc().listar(cal));
    ok(`${rol} → PERMISO «${re.source}»`, codigo(r) === "PERMISO" && re.test(mensaje(r)) && mensaje(r).includes("«Familia»"), mensaje(r));
  }
  for (const rol of ["writer", "owner"] as Rol[]) {
    const r = await intentar(gc().listar(nuevoCal(rol)));
    ok(`${rol} → se lista`, !r.error, mensaje(r));
  }
  ok("problemaDeRol: owner/writer null; los otros con el correo del panel", problemaDeRol("owner", "F", SA) === null && problemaDeRol("writer", "F", SA) === null && problemaDeRol("reader", "F", SA)!.includes(SA) && problemaDeRol("none", "F", SA)!.includes("no está compartido"));
});

await caso("calendario no compartido → NO_ENCONTRADO", async () => {
  const r = await intentar(gc().listar(nuevoCal(null)));
  ok("404 → NO_ENCONTRADO con el correo de la cuenta de servicio", codigo(r) === "NO_ENCONTRADO" && mensaje(r).includes(SA), mensaje(r));
  const cal = nuevoCal();
  sim.quitar(cal, SA);
  const c = await intentar(gc().calendario(cal));
  ok("calendario() → NO_ENCONTRADO", codigo(c) === "NO_ENCONTRADO");
});

await caso("plazo que no alcanza a la página 2 → TIEMPO, nunca una parte", async () => {
  const cal = nuevoCal();
  const web = sim.actor("web", cal);
  for (let i = 0; i < 4; i++) web.crear({ summary: `E${i}`, start: hora("2026-11-2" + i, "10:00"), end: hora("2026-11-2" + i, "11:00") });
  await gc().listar(cal); // token listo
  sim.paginacion.modo = [2, 2];
  sim.latenciaMs = 500;
  sim.reiniciarContadores();
  const t = gc({ hasta: Date.now() + 1200 });
  const r = await intentar(t.listar(cal));
  sim.latenciaMs = 0;
  sim.paginacion.modo = "normal";
  ok("TIEMPO (sin Map parcial) después de 1 página", codigo(r) === "TIEMPO" && !r.valor && contar("events.list") === 1, [codigo(r), contar("events.list")]);
  const t2 = gc({ hasta: Date.now() + 600 });
  sim.reiniciarContadores();
  const r2 = await intentar(t2.ctag(cal));
  ok("con menos de 800 ms ni siquiera pide la primera", codigo(r2) === "TIEMPO" && contar("events.list") === 0);
});

await caso("más de 20 páginas → SERVIDOR (demasiado grande)", async () => {
  const cal = nuevoCal();
  const web = sim.actor("web", cal);
  for (let i = 0; i < 22; i++) web.crear({ summary: `E${i}`, start: hora("2026-11-20", "10:00"), end: hora("2026-11-20", "11:00") });
  sim.paginacion.modo = Array(22).fill(1);
  const r = await intentar(gc().listar(cal));
  sim.paginacion.modo = "normal";
  ok("SERVIDOR «demasiado grande»", codigo(r) === "SERVIDOR" && /demasiado grande/.test(mensaje(r)), mensaje(r));
});

await caso("eventos que no son del panel", async () => {
  const cal = nuevoCal();
  sim.actor("cumpleaños", cal).crear({ summary: "Cumpleaños de Ana", fecha: "2026-12-01" });
  sim.actor("invitación", cal).crear({ summary: "Reunión apoderados", start: hora("2026-11-25", "19:00"), end: hora("2026-11-25", "20:00") });
  const l = await leer(gc(), cal);
  ok("el cumpleaños (eventType) no aparece; la invitación sí", l.length === 1 && l[0].g?.eventos[0].titulo === "Reunión apoderados", l.map((x) => x.g?.eventos[0]?.titulo));
});

// =====================================================================================
seccion("ctag, etags y traer");
await caso("ctag y etags", async () => {
  const cal = nuevoCal();
  const web = sim.actor("web", cal);
  const s = web.crear(semanal());
  web.crear({ summary: "Suelto", start: hora("2026-11-20", "10:00"), end: hora("2026-11-20", "11:00") });
  sim.reiniciarContadores();
  const t = gc();
  const c1 = await t.ctag(cal);
  const l1 = await t.listar(cal);
  ok("ctag() y después listar() en la misma instancia: 1 solo events.list", contar("events.list") === 1 && l1.ctag === c1);
  const c2 = await gc().ctag(cal);
  ok("ctag estable si nada cambió (otra instancia)", c2 === c1);
  const hrefS = hrefSerie(cal, s.id);
  web.borrarDia(s.id, "2026-11-11");
  const l3 = await gc().listar(cal);
  ok("un día borrado en la web (excepción cancelada) cambia el ctag y el etag de esa serie, no el de la otra", l3.ctag !== c1 && l3.recursos.get(hrefS) !== l1.recursos.get(hrefS) && [...l3.recursos].filter(([h, e]) => h !== hrefS && l1.recursos.get(h) === e).length === 1);
  sim.actor("iPhone", cal).borrarDia(s.id, "2026-11-18");
  const l4 = await gc().listar(cal);
  ok("un día borrado en el iPhone (EXDATE) también", l4.ctag !== l3.ctag && l4.recursos.get(hrefS) !== l3.recursos.get(hrefS));
  web.editarTitulo(s.id, "🦄 Natación (piscina)");
  const l5 = await gc().listar(cal);
  ok("cambiar el título también", l5.recursos.get(hrefS) !== l4.recursos.get(hrefS));
  // traer
  const t6 = gc();
  const l6 = await t6.listar(cal);
  sim.reiniciarContadores();
  const pedidos = [hrefS, "/calendar/v3/calendars/otro/events/nada", ...[...l6.recursos.keys()].filter((h) => h !== hrefS)];
  const tr = await t6.traer(cal, pedidos, 2500);
  ok("traer: 0 pedidos, completo, los href tal como se pidieron (sin los que no existen) y el mismo etag que listar", sim.contadores.api === 0 && tr.completo && tr.leidos.length === 2 && tr.leidos[0].href === hrefS && tr.leidos.every((x) => x.etag === l6.recursos.get(x.href)), [sim.contadores.api, tr.leidos.map((x) => x.href)]);
  const g = leerRecurso(tr.leidos[0].ics, ctx);
  ok("el .ics se lee con leerRecurso: semanal, con los dos días borrados", g?.eventos[0].repeticion === "semanal" && JSON.stringify(g.eventos[0].excepciones) === JSON.stringify(["2026-11-11", "2026-11-18"]), g?.eventos);
  ok("existe() sin un crear previo → false (sin pedidos)", (await t6.existe(cal, "x.ics")) === false && sim.contadores.api === 0);
});

// =====================================================================================
seccion("Tabla de errores");
await caso("cada fila", async () => {
  const cal = nuevoCal();
  sim.actor("web", cal).crear({ summary: "x", start: hora("2026-11-20", "10:00"), end: hora("2026-11-20", "11:00") });
  const filas: [string, string, RegExp?][] = [
    ["rateLimitExceeded", "SERVIDOR", /límite de uso/],
    ["userRateLimitExceeded", "SERVIDOR", /límite de uso/],
    ["quotaExceeded", "SERVIDOR", /límite de uso/],
    ["dailyLimitExceeded", "SERVIDOR", /límite de uso/],
    ["rateLimit429", "SERVIDOR", /límite de uso/],
    ["accessNotConfigured", "CONFIGURACION", /Google Calendar API/],
    ["SERVICE_DISABLED", "CONFIGURACION", /Google Calendar API/],
    ["requiredAccessLevel", "PERMISO", new RegExp(SA.replace(/\./g, "\\."))],
    ["insufficientPermissions", "PERMISO"],
    ["desconocido", "SERVIDOR"],
    ["forbiddenForNonOrganizer", "SERVIDOR"],
    ["backendError", "SERVIDOR", /500/],
    ["unavailable", "SERVIDOR", /503/],
    ["notFound", "NO_ENCONTRADO"],
    ["timeRangeEmpty", "SERVIDOR"],
    ["deleted", "SERVIDOR"],
  ];
  for (const [tipo, esperado, re] of filas) {
    sim.limpiarInyecciones();
    sim.inyectar(es.tipo("events.list"), respuestas.error(tipo));
    const r = await intentar(gc().listar(cal));
    ok(`${tipo} al listar → ${esperado}`, codigo(r) === esperado && (!re || re.test(mensaje(r))), [codigo(r), mensaje(r)]);
  }
  sim.limpiarInyecciones();
  // Lo mismo en una escritura: un límite de uso nunca es PERMISO.
  const t = gc();
  const ev = evPanel();
  for (const tipo of ["rateLimitExceeded", "rateLimit429", "quotaExceeded", "accessNotConfigured"]) {
    sim.inyectar(es.tipo("events.insert"), respuestas.error(tipo));
    const r = await intentar(t.crear(cal, `${ev.id}.ics`, icsDe(ev)));
    ok(`${tipo} al crear → ${tipo === "accessNotConfigured" ? "CONFIGURACION" : "SERVIDOR"} (nunca PERMISO)`, codigo(r) === (tipo === "accessNotConfigured" ? "CONFIGURACION" : "SERVIDOR"), [codigo(r), mensaje(r)]);
  }
  sim.inyectar(es.tipo("events.insert"), respuestas.error("requiredAccessLevel"));
  const p = await intentar(t.crear(cal, `${ev.id}.ics`, icsDe(ev)));
  ok("requiredAccessLevel al crear → PERMISO (el motor lo deja solo en la pared)", codigo(p) === "PERMISO");
  sim.inyectar(es.tipo("events.list"), respuestas.status(502, "<html>Bad Gateway</html>", { "content-type": "text/html" }));
  const html = await intentar(gc().listar(cal));
  ok("502 con HTML (un proxy) → SERVIDOR", codigo(html) === "SERVIDOR");
  sim.inyectar(es.tipo("events.list"), respuestas.status(200, "esto no es json", { "content-type": "text/plain" }));
  const raro = await intentar(gc().listar(cal));
  ok("200 que no es JSON → SERVIDOR (no un listado vacío)", codigo(raro) === "SERVIDOR", [codigo(raro), mensaje(raro)]);
  sim.inyectar(es.tipo("events.list"), respuestas.status(200, { items: [] }));
  const sinRol = await intentar(gc().listar(cal));
  ok("200 sin accessRole → SERVIDOR (no se puede confirmar que se puede escribir)", codigo(sinRol) === "SERVIDOR");
});

await caso("401, red y demoras", async () => {
  const cal = nuevoCal();
  await gc().listar(cal);
  const antes = sim.token.pedidos;
  sim.inyectar(es.tipo("events.list"), respuestas.error("authError"));
  const r = await intentar(gc().listar(cal));
  ok("401 una vez → se descarta el token, se pide otro y el pedido sale bien", !r.error && sim.token.pedidos === antes + 1, [codigo(r), sim.token.pedidos - antes]);
  sim.inyectar(es.tipo("events.list"), respuestas.error("authError"), 2);
  const r2 = await intentar(gc().listar(cal));
  ok("401 dos veces → CLAVE", codigo(r2) === "CLAVE", mensaje(r2));
  sim.revocarTokens();
  const r3 = await intentar(gc().listar(cal));
  ok("token revocado en Google → se renueva solo", !r3.error, mensaje(r3));
  sim.inyectar(es.tipo("events.list"), respuestas.cortar());
  const r4 = await intentar(gc().listar(cal));
  ok("conexión cortada → RED", codigo(r4) === "RED", mensaje(r4));
  sim.inyectar(es.tipo("events.list"), respuestas.demora(2500));
  const r5 = await intentar(gc({ espera: 400 }).listar(cal));
  ok("Google no responde a tiempo con plazo de sobra → RED", codigo(r5) === "RED" && r5.ms < 1500, [codigo(r5), r5.ms]);
  sim.limpiarInyecciones();
  sim.inyectar(es.tipo("events.list"), respuestas.demora(3000));
  const r6 = await intentar(gc({ hasta: Date.now() + 1300 }).listar(cal));
  ok("…y si lo corta el plazo total → TIEMPO, antes del plazo", codigo(r6) === "TIEMPO" && r6.ms < 1300, [codigo(r6), r6.ms]);
  sim.limpiarInyecciones();
  olvidarTokens();
  sim.token.opciones.deshabilitadas = new Set([SA]);
  const r7 = await intentar(gc().listar(cal));
  sim.token.opciones.deshabilitadas = new Set();
  ok("cuenta de servicio deshabilitada → CLAVE (de cuenta.ts)", codigo(r7) === "CLAVE", mensaje(r7));
});

// =====================================================================================
seccion("crear");
await caso("crear y releer", async () => {
  const cal = nuevoCal();
  const t = gc();
  const ev = evPanel({ titulo: "Natación", repeticion: "semanal", fecha: "2026-11-04", horaInicio: "09:00", horaFin: "10:00", nota: "Llevar gorro", lugar: "Piscina" });
  const uid = uidDe(ev);
  await t.listar(cal);
  sim.reiniciarContadores();
  const r = await t.crear(cal, `${ev.id}.ics`, icsDe(ev));
  const id = idGoogleDe(uid);
  ok("1 insert; href de la serie con el id que sale del UID", r !== "existe" && r.href === hrefSerie(cal, id) && typeof r.etag === "string" && contar("events.insert") === 1 && sim.contadores.api === 1, [r, sim.contadores.porTipo]);
  const g = sim.evento(cal, id);
  ok("en Google: con la marca cfh y sin campos prohibidos", typeof g?.extendedProperties?.private?.cfh === "string" && !("attendees" in g) && g.recurrence?.[0]?.startsWith("RRULE:FREQ=WEEKLY") && g.description === "Llevar gorro");
  const l = await leer(gc(), cal);
  ok("el etag que devolvió crear es el que trae el listado siguiente (el motor no la relee)", r !== "existe" && l[0]?.etag === r.etag, [r, l[0]?.etag]);
  ok("al releer: el mismo UID, la misma huella del panel y modificado null (escritura propia)", l.length === 1 && l[0].g?.uid === uid && huellaGrupo(l[0].g!.eventos, miembros) === huellaGrupo([ev], miembros) && l[0].g!.modificado === null, l[0]?.g);
  ok("uidDesdeId del id creado → el UID del panel, gen 0", uidDesdeId(id)?.uid === uid && uidDesdeId(id)?.gen === 0);
});

await caso("aplica y después falla → la vuelta siguiente no duplica", async () => {
  for (const [que, resp, cod] of [
    ["503", respuestas.aplicarYLuego(respuestas.error("unavailable")), "SERVIDOR"],
    ["corte", respuestas.aplicarYCortar(), "RED"],
  ] as const) {
    const cal = nuevoCal();
    const ev = evPanel({ titulo: `Aplica y falla ${que}` });
    const nombre = `${ev.id}.ics`;
    const t = gc();
    sim.inyectar(es.tipo("events.insert"), resp);
    const r = await intentar(t.crear(cal, nombre, icsDe(ev)));
    ok(`aplica y ${que} → ${cod}`, codigo(r) === cod, [codigo(r), mensaje(r)]);
    const l = await leer(gc(), cal);
    ok(`…la vuelta siguiente lo lista con el UID del panel (se vincula, no se sube de nuevo)`, l.length === 1 && l[0].g?.uid === uidDe(ev), l.map((x) => x.g?.uid));
    const t2 = gc();
    const otra = await t2.crear(cal, nombre, icsDe(ev));
    ok("…y si igual se vuelve a crear: \"existe\" (409 y el evento está vivo) y existe() → true", otra === "existe" && (await t2.existe(cal, nombre)) === true && vivos(cal).length === 1, otra);
  }
});

await caso("lápidas y generaciones", async () => {
  for (const ocupa of [true, false]) {
    sim.interruptores.lapidaOcupaId = ocupa;
    const cal = nuevoCal();
    const ev = evPanel({ titulo: `Lápida ${ocupa}` });
    const uid = uidDe(ev);
    await gc().crear(cal, `${ev.id}.ics`, icsDe(ev));
    sim.actor("web", cal).borrar(idGoogleDe(uid));
    sim.reiniciarContadores();
    const r = await gc().crear(cal, idGoogleDe(uid), icsDe(ev));
    const esperado = ocupa ? idGoogleDe(uid, 1) : idGoogleDe(uid, 0);
    ok(`lapidaOcupaId=${ocupa}: se crea con el id ${ocupa ? "de la generación 1" : "de siempre"}`, r !== "existe" && r.href === hrefSerie(cal, esperado), [r, sim.contadores.porTipo]);
    if (ocupa) ok("…con 409 + GET (lápida) + insert", contar("events.insert") === 2 && contar("events.get") === 1, sim.contadores.porTipo);
    const l = await leer(gc(), cal);
    ok(`…y se relee con el mismo UID del panel`, l.length === 1 && l[0].g?.uid === uid, l.map((x) => x.g?.uid));
  }
  sim.interruptores.lapidaOcupaId = true;
  // Generaciones agotadas.
  const cal = nuevoCal();
  const ev = evPanel({ titulo: "Siempre ocupado" });
  for (let g = 0; g <= 3; g++) sim.poner(cal, { id: idGoogleDe(uidDe(ev), g), status: "cancelled", summary: "x", start: hora("2026-11-20", "10:00"), end: hora("2026-11-20", "11:00") });
  const r = await intentar(gc().crear(cal, "x.ics", icsDe(ev)));
  ok("4 generaciones ocupadas por lápidas → NoSePuedeEscribir «quedó solo en la pared»", codigo(r) === "NoSePuedeEscribir" && /quedó solo en la pared/.test(mensaje(r)), mensaje(r));
});

await caso("3 crear en paralelo con el token por vencer → 1 POST de token", async () => {
  const cal = nuevoCal();
  olvidarTokens();
  sim.token.opciones.expiraSeg = 120; // siempre "por vencer" (< 5 min)
  await gc().listar(cal);
  const antes = sim.token.pedidos;
  const t = gc();
  const evs = [1, 2, 3].map((i) => evPanel({ titulo: `Paralelo ${i}` }));
  const rs = await Promise.all(evs.map((e) => t.crear(cal, `${e.id}.ics`, icsDe(e))));
  sim.token.opciones.expiraSeg = 3599;
  ok("3 creados, 1 pedido de token", rs.every((x) => x !== "existe") && sim.token.pedidos - antes === 1 && vivos(cal).length === 3, sim.token.pedidos - antes);
});

await caso("sin hora de término", async () => {
  const cal = nuevoCal();
  sim.interruptores.finIgualInicio = "400";
  const ev = evPanel({ titulo: "Sin término", horaFin: undefined });
  sim.reiniciarContadores();
  const r = await intentar(gc().crear(cal, `${ev.id}.ics`, icsDe(ev)));
  const g = sim.evento(cal, idGoogleDe(uidDe(ev)));
  ok("finIgualInicio=400 → reintento sin end y con endTimeUnspecified", !r.error && contar("events.insert") === 2 && g?.endTimeUnspecified === true, [codigo(r), mensaje(r), g]);
  const l = await leer(gc(), cal);
  ok("…se relee sin hora de término y como escritura propia", l[0]?.g?.eventos[0].horaFin === undefined && l[0]?.g?.modificado === null && huellaGrupo(l[0].g!.eventos, miembros) === huellaGrupo([ev], miembros), l[0]?.g);
  sim.interruptores.endTimeUnspecifiedAceptado = false;
  const ev2 = evPanel({ titulo: "Sin término 2", horaFin: undefined });
  const r2 = await intentar(gc().crear(cal, `${ev2.id}.ics`, icsDe(ev2)));
  ok("con los dos rechazos → NoSePuedeEscribir «sin hora de término»", codigo(r2) === "NoSePuedeEscribir" && /sin hora de término/.test(mensaje(r2)), mensaje(r2));
  sim.interruptores.finIgualInicio = "ok";
  sim.interruptores.endTimeUnspecifiedAceptado = true;
  sim.inyectar(es.tipo("events.insert"), respuestas.error("timeRangeEmpty"));
  const ev3 = evPanel({ titulo: "Rechazado" });
  const r3 = await intentar(gc().crear(cal, `${ev3.id}.ics`, icsDe(ev3)));
  ok("otro 400 → NoSePuedeEscribir con el mensaje de Google", codigo(r3) === "NoSePuedeEscribir" && /Google Calendar no aceptó "🦄 Rechazado": The specified time range is empty\.$/.test(mensaje(r3)), mensaje(r3));
});

await caso("recrear con días cambiados", async () => {
  const cal = nuevoCal();
  // Una serie de la pared con un día cambiado (lo que pasa al recrear una serie borrada allá).
  const base = evPanel({ titulo: "Natación", repeticion: "semanal", fecha: "2026-11-04", horaInicio: "09:00", horaFin: "10:00", excepciones: ["2026-11-18"] });
  const uid = uidDe(base);
  const cambiado = { ...base, id: `${base.id}-d`, fecha: "2026-11-18", horaInicio: "11:00", horaFin: "12:00", repeticion: "nunca", lugar: "Piscina 2", externo: { conexion: "c1", uid, recurrencia: "2026-11-18" } } as Evento;
  const B = escribirRecurso([base, cambiado], ctx, uid, null);
  ok("(B trae un RECURRENCE-ID)", /RECURRENCE-ID/.test(B));
  const t = gc();
  sim.reiniciarContadores();
  const r = await t.crear(cal, `${base.id}.ics`, B);
  ok("1 insert + 1 instances + 1 PATCH de la instancia", r !== "existe" && contar("events.insert") === 1 && contar("events.instances") === 1 && contar("events.patch") === 1, sim.contadores.porTipo);
  const parche = sim.registro.find((x) => x.tipo === "events.patch");
  ok("…el PATCH de la instancia va sin If-Match (lo creamos recién)", !!parche);
  const l = await leer(gc(), cal);
  const g = l[0]?.g;
  const dia = g?.eventos.find((e) => e.externo?.recurrencia === "2026-11-18");
  ok("se relee con el día cambiado (11:00, Piscina 2) y como escritura propia", dia?.horaInicio === "11:00" && dia?.lugar === "Piscina 2" && g?.modificado === null, g?.eventos);
  ok("…y la misma huella que la pared", huellaGrupo(g!.eventos, miembros) === huellaGrupo([base, cambiado], miembros) && huellaGrupo(g!.eventos, miembros) === huellaGrupo(leerRecurso(B, ctx)!.eventos, miembros));
  ok("sin avisos", t.avisos().length === 0);
  // Un día cambiado que ya no es de la serie (fecha que la regla no genera).
  const cal2 = nuevoCal();
  const base2 = evPanel({ titulo: "Clase", repeticion: "semanal", fecha: "2026-11-04" });
  const uid2 = uidDe(base2);
  const raro = { ...base2, id: `${base2.id}-d`, fecha: "2026-11-19", externo: { conexion: "c1", uid: uid2, recurrencia: "2026-11-19" } } as Evento;
  const B2 = escribirRecurso([base2, raro], ctx, uid2, null).replace(/RECURRENCE-ID;TZID=America\/Santiago:20261118T/, "RECURRENCE-ID;TZID=America/Santiago:20261119T");
  const t2 = gc();
  const r2 = await t2.crear(cal2, "y.ics", B2);
  const av = t2.avisos();
  ok(
    "un día que ya no es de la serie → se crea igual, con aviso «no se encontró ese día en la serie» (no «quedó como un día normal»: ese día no está)",
    r2 !== "existe" && av.length === 1 && /el cambio del día 19-11-2026 no se pudo pasar a Google Calendar \(no se encontró ese día en la serie\)/.test(av[0]),
    [B2.match(/RECURRENCE-ID[^\r\n]*/g), av],
  );
  ok("avisos() vacía la lista", t2.avisos().length === 0);
  // Una falla pasajera (5xx, límite de uso o corte de red) en el GET de instances o en el PATCH del día se
  // reintenta una vez: el día queda cambiado.
  for (const [que, pred, resp] of [
    ["503 en el GET de instances", es.tipo("events.instances"), respuestas.error("unavailable")],
    ["límite de uso en el PATCH del día", es.tipo("events.patch"), respuestas.error("rateLimit429")],
    ["corte de red en el PATCH del día", es.tipo("events.patch"), respuestas.cortar()],
  ] as const) {
    const calR = nuevoCal();
    const baseR = evPanel({ titulo: "Natación", repeticion: "semanal", fecha: "2026-11-04", horaInicio: "09:00", horaFin: "10:00" });
    const uidR = uidDe(baseR);
    const diaR = { ...baseR, id: `${baseR.id}-d`, fecha: "2026-11-18", horaInicio: "11:00", horaFin: "12:00", repeticion: "nunca", lugar: "Piscina 2", externo: { conexion: "c1", uid: uidR, recurrencia: "2026-11-18" } } as Evento;
    const tR = gc();
    const inj = sim.inyectar(pred, resp, 1);
    sim.reiniciarContadores();
    const rR = await intentar(tR.crear(calR, `${baseR.id}.ics`, escribirRecurso([baseR, diaR], ctx, uidR, null)));
    inj.quitar();
    const avR = tR.avisos();
    const gR = (await leer(gc(), calR))[0]?.g;
    const d = gR?.eventos.find((e) => e.externo?.recurrencia === "2026-11-18");
    ok(`${que} → se reintenta una vez y el día queda cambiado, sin aviso`, !rR.error && inj.disparos === 1 && d?.horaInicio === "11:00" && d?.lugar === "Piscina 2" && !avR.length, [codigo(rR), mensaje(rR), sim.contadores.porTipo, avR, gR?.eventos.length]);
  }
});

await caso("crear: presupuesto, sin principal", async () => {
  const cal = nuevoCal();
  const ev = evPanel({ titulo: "Tarde" });
  const t = gc({ hasta: Date.now() + 1000 });
  sim.reiniciarContadores();
  const r = await intentar(t.crear(cal, "x.ics", icsDe(ev)));
  ok("con menos de 1,1 s → TIEMPO sin escribir nada", codigo(r) === "TIEMPO" && sim.contadores.api === 0, [codigo(r), sim.contadores.api]);
  const soloDia = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:x\r\nBEGIN:VEVENT\r\nUID:z@calendario-familiar\r\nRECURRENCE-ID:20261118T120000Z\r\nDTSTART:20261118T120000Z\r\nDTEND:20261118T130000Z\r\nSUMMARY:x\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
  const r2 = await intentar(gc().crear(cal, "z.ics", soloDia));
  ok("un .ics sin evento principal → NoSePuedeEscribir", codigo(r2) === "NoSePuedeEscribir");
});

// =====================================================================================
seccion("actualizar");
await caso("título y día borrado", async () => {
  const cal = nuevoCal();
  const ev = evPanel({ titulo: "Natación", repeticion: "semanal", fecha: "2026-11-04", horaInicio: "09:00", horaFin: "10:00" });
  const uid = uidDe(ev);
  await gc().crear(cal, "n.ics", icsDe(ev));
  const t = gc();
  await t.listar(cal);
  sim.reiniciarContadores();
  const { r } = await cambiarEnPanel(t, cal, uid, enPrincipal((e) => ({ ...e, titulo: "Natación (piscina 2)" })));
  ok("título → 1 PATCH del principal y el etag de la serie", typeof r.valor?.etag === "string" && contar("events.patch") === 1 && sim.contadores.api === 1, [r, sim.contadores.porTipo]);
  const reg = sim.registro.find((x) => x.tipo === "events.patch")!;
  ok("…con ?fields=id,etag,recurrence,updated", new URLSearchParams(reg.query).get("fields") === "id,etag,recurrence,updated", reg.query);
  const l = await leer(gc(), cal);
  ok("…que es el etag que trae el listado siguiente", l[0]?.etag === (r.valor as { etag: string | null } | undefined)?.etag, [r.valor, l[0]?.etag]);
  ok("…se relee con el título nuevo y como escritura propia (sin LAST-MODIFIED)", l[0]?.g?.eventos[0].titulo === "Natación (piscina 2)" && l[0]?.g?.modificado === null, l[0]?.g);
  const t2 = gc();
  sim.reiniciarContadores();
  const { r: r2 } = await cambiarEnPanel(t2, cal, uid, enPrincipal((e) => ({ ...e, excepciones: ["2026-11-11"] })));
  const g = sim.evento(cal, idGoogleDe(uid));
  ok("borrar un día → 1 PATCH con un EXDATE en recurrence", !r2.error && contar("events.patch") === 1 && g.recurrence.some((x: string) => /^EXDATE.*20261111T090000/.test(x)), [codigo(r2), g?.recurrence]);
  const l2 = await leer(gc(), cal);
  ok("…se relee con ese día borrado", JSON.stringify(l2[0]?.g?.eventos[0].excepciones) === JSON.stringify(["2026-11-11"]), l2[0]?.g?.eventos[0]);
  ok("sin avisos de repetición", t2.avisos().length === 0);
  // Sin cambios: 0 pedidos.
  const t3 = gc();
  const s = (await leer(t3, cal))[0];
  sim.reiniciarContadores();
  const r3 = await t3.actualizar(cal, s.href, escribirRecurso(s.g!.eventos, ctx, uid, s.ics), s.etag);
  ok("sin cambios en lo que ve el panel → {etag: null} sin pedidos", JSON.stringify(r3) === JSON.stringify({ etag: null }) && sim.contadores.api === 0, [r3, sim.contadores.api]);
  ok("serie que no está → \"noExiste\"; etag viejo → \"conflicto\" (sin pedidos)", (await t3.actualizar(cal, hrefSerie(cal, "nada123"), s.ics, "x")) === "noExiste" && (await t3.actualizar(cal, s.href, s.ics, "g1viejo")) === "conflicto" && sim.contadores.api === 0);
});

await caso("conflictos y respuestas del primer PATCH", async () => {
  const cal = nuevoCal();
  const ev = evPanel({ titulo: "Clase" });
  const uid = uidDe(ev);
  await gc().crear(cal, "c.ics", icsDe(ev));
  // Alguien lo cambia en la web entre el listado y el PATCH: 412 real.
  const t = gc();
  const s = (await leer(t, cal))[0];
  sim.actor("web", cal).editarTitulo(idGoogleDe(uid), "Clase (web)");
  const local = s.g!.eventos.map((e) => ({ ...e, titulo: "Clase (pared)" }));
  const r = await t.actualizar(cal, s.href, escribirRecurso(local, ctx, uid, s.ics), s.etag);
  ok("If-Match viejo → 412 → \"conflicto\"", r === "conflicto" && sim.evento(cal, idGoogleDe(uid)).summary === "Clase (web)", r);
  const casos: [string, unknown, string][] = [
    ["notFound", respuestas.error("notFound"), "noExiste"],
    ["deleted", respuestas.error("deleted"), "noExiste"],
    ["duplicate (409)", respuestas.error("duplicate"), "conflicto"],
    ["forbiddenForNonOrganizer", respuestas.error("forbiddenForNonOrganizer"), "NoSePuedeEscribir"],
    ["requiredAccessLevel", respuestas.error("requiredAccessLevel"), "PERMISO"],
    ["400 timeRangeEmpty", respuestas.error("timeRangeEmpty"), "NoSePuedeEscribir"],
    ["rateLimitExceeded", respuestas.error("rateLimitExceeded"), "SERVIDOR"],
  ];
  for (const [que, resp, esperado] of casos) {
    const ti = gc();
    const si = (await leer(ti, cal))[0];
    sim.inyectar(es.tipo("events.patch"), resp as never);
    const lo = si.g!.eventos.map((e) => ({ ...e, titulo: `Clase ${que}` }));
    const x = await intentar(ti.actualizar(cal, si.href, escribirRecurso(lo, ctx, uid, si.ics), si.etag));
    const obtenido = typeof x.valor === "string" ? x.valor : codigo(x);
    ok(`${que} en el primer PATCH → ${esperado}`, obtenido === esperado, [obtenido, mensaje(x)]);
  }
  sim.limpiarInyecciones();
  // Una invitación: planear la rechaza antes de pedir nada.
  const inv = sim.actor("invitación", cal).crear({ summary: "Reunión", start: hora("2026-11-26", "19:00"), end: hora("2026-11-26", "20:00") });
  const ti = gc();
  const si = (await leer(ti, cal)).find((x) => x.href === hrefSerie(cal, inv.id))!;
  sim.reiniciarContadores();
  const x = await intentar(ti.actualizar(cal, si.href, escribirRecurso(si.g!.eventos.map((e) => ({ ...e, titulo: "Reunión (pared)" })), ctx, si.g!.uid, si.ics), si.etag));
  ok("invitación editada en la pared → NoSePuedeEscribir «es una invitación», sin pedidos", codigo(x) === "NoSePuedeEscribir" && /invitación/.test(mensaje(x)) && sim.contadores.api === 0, [codigo(x), mensaje(x)]);
});

await caso("sin hora de término al actualizar", async () => {
  const cal = nuevoCal();
  const ev = evPanel({ titulo: "Cita" });
  const uid = uidDe(ev);
  await gc().crear(cal, "c.ics", icsDe(ev));
  sim.interruptores.finIgualInicio = "400";
  const t = gc();
  sim.reiniciarContadores();
  const { r } = await cambiarEnPanel(t, cal, uid, (l) => l.map((e) => ({ ...e, horaFin: undefined })));
  const g = sim.evento(cal, idGoogleDe(uid));
  ok("fin = inicio rechazado → reintento con endTimeUnspecified y end: null (no queda el fin anterior)", !r.error && contar("events.patch") === 2 && g.endTimeUnspecified === true && g.end?.dateTime === g.start?.dateTime, [codigo(r), mensaje(r), g?.start, g?.end]);
  const l = await leer(gc(), cal);
  ok("…se relee sin hora de término, como escritura propia", l[0]?.g?.eventos[0].horaFin === undefined && l[0]?.g?.modificado === null, l[0]?.g);
  sim.interruptores.endTimeUnspecifiedAceptado = false;
  const ev2 = evPanel({ titulo: "Cita 2" });
  await gc().crear(cal, "c2.ics", icsDe(ev2));
  const { r: r2 } = await cambiarEnPanel(gc(), cal, uidDe(ev2), (l) => l.map((e) => ({ ...e, horaInicio: "15:00", horaFin: undefined })));
  ok("cambiar la hora y quitar el término, con los dos rechazos (como al crear) → NoSePuedeEscribir «sin hora de término»", codigo(r2) === "NoSePuedeEscribir" && /sin hora de término/.test(mensaje(r2)) && sim.evento(cal, idGoogleDe(uidDe(ev2))).start.dateTime.includes("T10:00"), [codigo(r2), mensaje(r2)]);
  sim.interruptores.finIgualInicio = "ok";
  sim.interruptores.endTimeUnspecifiedAceptado = true;
  const ev3 = evPanel({ titulo: "Cita 3" });
  await gc().crear(cal, "c3.ics", icsDe(ev3));
  sim.inyectar(es.tipo("events.patch"), respuestas.error("timeRangeEmpty"), 2);
  const { r: r3 } = await cambiarEnPanel(gc(), cal, uidDe(ev3), (l) => l.map((e) => ({ ...e, horaFin: undefined })));
  sim.limpiarInyecciones();
  ok("dos 400 seguidos → NoSePuedeEscribir «sin hora de término»", codigo(r3) === "NoSePuedeEscribir" && /sin hora de término/.test(mensaje(r3)), mensaje(r3));
});

await caso("varias piezas: el principal y un día cambiado", async () => {
  const cal = nuevoCal();
  const web = sim.actor("web", cal);
  const s = web.crear(semanal());
  const dia = web.moverDia(s.id, "2026-11-18", hora("2026-11-18", "11:00"), hora("2026-11-18", "12:00"));
  const uid = `${s.id}@google.com`;
  // (el título del panel va sin el emoji: escribirRecurso lo pone según las personas)
  const cambio = (titulo: string, lugar: string) => (l: Evento[]) =>
    l.map((e) => (e.externo?.recurrencia ? { ...e, lugar } : { ...e, titulo: titulo.replace(/^🦄 /, "") }));
  // Todo bien: 2 PATCH, primero el del día cambiado (si Google pasa el título nuevo del principal a las
  // excepciones, el If-Match del día ya se usó).
  const t = gc();
  sim.reiniciarContadores();
  const { r } = await cambiarEnPanel(t, cal, uid, cambio("🦄 Natación A", "Piscina A"));
  const orden = sim.registro.filter((x) => x.tipo === "events.patch").map((x) => decodeURIComponent(x.ruta.split("/").pop() ?? ""));
  ok("título del principal + lugar del día cambiado → 2 PATCH (primero el día, después el principal)", !r.error && contar("events.patch") === 2 && JSON.stringify(orden) === JSON.stringify([dia.id, s.id]), [codigo(r), mensaje(r), orden]);
  ok("…en Google quedan los dos cambios", sim.evento(cal, s.id).summary === "🦄 Natación A" && sim.evento(cal, dia.id).location === "Piscina A");
  const delPrincipal = (p: PedidoVisto) => p.tipo === "events.patch" && p.eventoId === s.id;
  const delDia = (p: PedidoVisto) => p.tipo === "events.patch" && p.eventoId === dia.id;
  // 412 en la segunda operación (el principal) → "conflicto", con el día ya escrito.
  const t2 = gc();
  sim.inyectar(delPrincipal, respuestas.error("conditionNotMet"));
  const { r: r2 } = await cambiarEnPanel(t2, cal, uid, cambio("🦄 Natación B", "Piscina B"));
  ok("412 en la segunda → \"conflicto\" y el día ya quedó escrito", r2.valor === "conflicto" && sim.evento(cal, s.id).summary === "🦄 Natación A" && sim.evento(cal, dia.id).location === "Piscina B", [r2.valor, codigo(r2)]);
  // 404 en la segunda también es "conflicto" (algo cambió allá); y en la primera (el día) también: la
  // serie sigue ahí, no es "noExiste" (el motor la sacaría del estado).
  sim.inyectar(delPrincipal, respuestas.error("notFound"));
  const { r: r3 } = await cambiarEnPanel(gc(), cal, uid, cambio("🦄 Natación C", "Piscina C"));
  ok("404 en la segunda → \"conflicto\"", r3.valor === "conflicto", [r3.valor, codigo(r3)]);
  sim.inyectar(delDia, respuestas.error("notFound"));
  const { r: r3b } = await cambiarEnPanel(gc(), cal, uid, cambio("🦄 Natación C2", "Piscina C2"));
  ok("404 en el día cambiado (el primer PATCH) → \"conflicto\", sin tocar el principal", r3b.valor === "conflicto" && sim.evento(cal, s.id).summary === "🦄 Natación A", [r3b.valor, codigo(r3b)]);
  // 400 en la segunda: aviso y {etag:null}.
  const t4 = gc();
  sim.inyectar(delPrincipal, respuestas.error("timeRangeEmpty"));
  const { r: r4 } = await cambiarEnPanel(t4, cal, uid, cambio("🦄 Natación D", "Piscina D"));
  const av = t4.avisos();
  ok("400 en la segunda → aviso «no aceptó parte del cambio» y {etag: null}", JSON.stringify(r4.valor) === JSON.stringify({ etag: null }) && av.length === 1 && /parte del cambio/.test(av[0]), [r4.valor, av]);
  // 400 en el día (el primero): se sigue con el principal; aviso y {etag:null}.
  const t4b = gc();
  sim.inyectar(delDia, respuestas.error("timeRangeEmpty"));
  const { r: r4b } = await cambiarEnPanel(t4b, cal, uid, cambio("🦄 Natación D2", "Piscina D2"));
  const av4b = t4b.avisos();
  ok(
    "400 en el día cambiado → el principal igual se escribe; aviso «no aceptó parte del cambio» y {etag: null}",
    JSON.stringify(r4b.valor) === JSON.stringify({ etag: null }) && sim.evento(cal, s.id).summary === "🦄 Natación D2" && sim.evento(cal, dia.id).location === "Piscina D" && av4b.length === 1 && /parte del cambio/.test(av4b[0]),
    [r4b.valor, codigo(r4b), av4b],
  );
  // 503 en la segunda: se lanza (el motor deja de escribir y reintenta).
  sim.inyectar(delPrincipal, respuestas.error("unavailable"));
  const { r: r5 } = await cambiarEnPanel(gc(), cal, uid, cambio("🦄 Natación E", "Piscina E"));
  ok("503 en la segunda → SERVIDOR (se lanza)", codigo(r5) === "SERVIDOR");
  // Borrar el día cambiado → cancelar esa excepción.
  const t6 = gc();
  sim.reiniciarContadores();
  const { r: r6 } = await cambiarEnPanel(t6, cal, uid, (l) => l.filter((e) => !e.externo?.recurrencia).map((e) => ({ ...e, excepciones: [...(e.excepciones ?? []), "2026-11-18"] })));
  ok("borrar el día cambiado → PATCH status cancelled de esa excepción", !r6.error && sim.evento(cal, dia.id).status === "cancelled", [codigo(r6), mensaje(r6), sim.contadores.porTipo]);
  // Mover la serie con un día cambiado vivo → NoSePuedeEscribir (G1), sin pedidos.
  const s2 = web.crear(semanal({ summary: "Inglés" }));
  web.moverDia(s2.id, "2026-11-18", hora("2026-11-18", "11:00"), hora("2026-11-18", "12:00"));
  const t7 = gc();
  await t7.listar(cal);
  sim.reiniciarContadores();
  const { r: r7 } = await cambiarEnPanel(t7, cal, `${s2.id}@google.com`, enPrincipal((e) => ({ ...e, horaInicio: "08:00", horaFin: "09:00" })));
  ok("mover la hora de una serie con días cambiados → NoSePuedeEscribir, sin pedidos", codigo(r7) === "NoSePuedeEscribir" && sim.contadores.api === 0, [codigo(r7), mensaje(r7)]);
});

await caso("repetición que Google no aceptó (serie dividida)", async () => {
  const cal = nuevoCal();
  const web = sim.actor("web", cal);
  const s = web.crear(semanal({ summary: "Taller" }));
  web.esteYLosSiguientes(s.id, "2026-12-09", { summary: "Taller nuevo" });
  sim.interruptores.untilIgnoradoTrasDivision = true;
  const t = gc();
  const { r } = await cambiarEnPanel(t, cal, `${s.id}@google.com`, enPrincipal((e) => ({ ...e, repetirHasta: "2026-11-25" })));
  sim.interruptores.untilIgnoradoTrasDivision = false;
  const av = t.avisos();
  ok("PATCH 200 pero recurrence no cambió → aviso y {etag: null}", JSON.stringify(r.valor) === JSON.stringify({ etag: null }) && av.length === 1 && /no aceptó cambiar la repetición de "Taller"/.test(av[0]), [r.valor, codigo(r), mensaje(r), av]);
  // Google normaliza la regla y los EXDATE: no es un rechazo.
  sim.interruptores.normalizar = true;
  const s2 = web.crear(semanal({ summary: "Coro", recurrence: ["RRULE:WKST=MO;BYDAY=WE;FREQ=WEEKLY"] }));
  const t2 = gc();
  const { r: r2 } = await cambiarEnPanel(t2, cal, `${s2.id}@google.com`, enPrincipal((e) => ({ ...e, excepciones: ["2026-11-11"], repetirHasta: "2027-03-31" })));
  sim.interruptores.normalizar = false;
  ok("con normalizar=true (RRULE reordenada, EXDATE en UTC) → sin aviso", !r2.error && t2.avisos().length === 0, [codigo(r2), mensaje(r2), sim.evento(cal, s2.id).recurrence]);
});

await caso("presupuesto y 401 al escribir", async () => {
  const cal = nuevoCal();
  const ev = evPanel({ titulo: "Presupuesto" });
  const uid = uidDe(ev);
  await gc().crear(cal, "p.ics", icsDe(ev));
  const t = gc({ hasta: Date.now() + 1500 });
  const s = (await leer(t, cal))[0];
  while (t.queda() > 1000) await dormir(25);
  const antes = escrituras();
  sim.reiniciarContadores();
  const x = await intentar(t.actualizar(cal, s.href, escribirRecurso(s.g!.eventos.map((e) => ({ ...e, titulo: "Otro" })), ctx, uid, s.ics), s.etag));
  ok("queda menos de 1,1 s para 1 PATCH → TIEMPO sin ningún pedido", codigo(x) === "TIEMPO" && sim.contadores.api === 0 && escrituras() === 0, [codigo(x), sim.contadores.api, antes]);
  const t2 = gc();
  const s2 = (await leer(t2, cal))[0];
  sim.inyectar(es.tipo("events.patch"), respuestas.error("authError"));
  sim.reiniciarContadores();
  const y = await t2.actualizar(cal, s2.href, escribirRecurso(s2.g!.eventos.map((e) => ({ ...e, titulo: "Con 401" })), ctx, uid, s2.ics), s2.etag);
  ok("401 una vez en el PATCH → se renueva el token y el cambio se aplica una sola vez", typeof (y as { etag?: unknown }).etag === "string" && (y as { etag: string }).etag === (await leer(gc(), cal))[0]?.etag && contar("events.patch") === 2 && escrituras() === 1 && sim.evento(cal, idGoogleDe(uid)).summary.endsWith("Con 401"), [y, sim.contadores]);
});

// =====================================================================================
seccion("borrar");
await caso("borrar", async () => {
  const cal = nuevoCal();
  const ev = evPanel({ titulo: "Borrar" });
  const uid = uidDe(ev);
  await gc().crear(cal, "b.ics", icsDe(ev));
  const t = gc();
  const l = await t.listar(cal);
  const href = hrefSerie(cal, idGoogleDe(uid));
  let ifMatch: unknown;
  const etagAntes = sim.evento(cal, idGoogleDe(uid)).etag;
  sim.inyectar((p: PedidoVisto) => {
    if (p.tipo === "events.delete") ifMatch = p.cabeceras["if-match"];
    return false;
  }, respuestas.status(500));
  const r = await t.borrar(cal, href, l.recursos.get(href)!);
  sim.limpiarInyecciones();
  ok("DELETE con If-Match del principal → \"ok\"", r === "ok" && ifMatch === etagAntes && sim.evento(cal, idGoogleDe(uid)).status === "cancelled", [r, ifMatch]);
  ok("…y ya no está en el listado", !(await gc().listar(cal)).recursos.has(href));
  const t2 = gc();
  const l2 = await t2.listar(cal);
  ok("serie que no está → \"noExiste\"", (await t2.borrar(cal, href, "x")) === "noExiste");
  const ev2 = evPanel({ titulo: "Borrar 2" });
  await gc().crear(cal, "b2.ics", icsDe(ev2));
  const href2 = hrefSerie(cal, idGoogleDe(uidDe(ev2)));
  for (const [que, resp, esperado] of [
    ["deleted (410)", respuestas.error("deleted"), "noExiste"],
    ["notFound", respuestas.error("notFound"), "noExiste"],
    ["conditionNotMet", respuestas.error("conditionNotMet"), "conflicto"],
    ["forbiddenForNonOrganizer", respuestas.error("forbiddenForNonOrganizer"), "NoSePuedeEscribir"],
    ["requiredAccessLevel", respuestas.error("requiredAccessLevel"), "PERMISO"],
    ["userRateLimitExceeded", respuestas.error("userRateLimitExceeded"), "SERVIDOR"],
  ] as const) {
    const ti = gc();
    const li = await ti.listar(cal);
    sim.inyectar(es.tipo("events.delete"), resp);
    const x = await intentar(ti.borrar(cal, href2, li.recursos.get(href2)!));
    const obtenido = typeof x.valor === "string" ? x.valor : codigo(x);
    ok(`${que} → ${esperado}`, obtenido === esperado, [obtenido, mensaje(x)]);
  }
  sim.limpiarInyecciones();
  const t3 = gc();
  const l3 = await t3.listar(cal);
  sim.actor("web", cal).editarTitulo(idGoogleDe(uidDe(ev2)), "Cambiado en la web");
  ok("cambiado en la web después de listar → 412 → \"conflicto\" (no se borra)", (await t3.borrar(cal, href2, l3.recursos.get(href2)!)) === "conflicto" && sim.evento(cal, idGoogleDe(uidDe(ev2))).status === "confirmed");
  ok("etag que no calza → \"conflicto\" sin pedidos", (await t3.borrar(cal, href2, "g1otro")) === "conflicto");
  const inv = sim.actor("invitación", cal).crear({ summary: "Invitación", start: hora("2026-11-26", "19:00"), end: hora("2026-11-26", "20:00") });
  const t4 = gc();
  const l4 = await t4.listar(cal);
  const hi = hrefSerie(cal, inv.id);
  sim.reiniciarContadores();
  const x = await intentar(t4.borrar(cal, hi, l4.recursos.get(hi)!));
  ok("invitación (solo lectura) → NoSePuedeEscribir «solo se puede borrar en Google Calendar», sin pedidos", codigo(x) === "NoSePuedeEscribir" && /solo se puede borrar/.test(mensaje(x)) && sim.contadores.api === 0, mensaje(x));
  void l2;
});

// =====================================================================================
seccion("calendario() y pedirJSON");
await caso("calendario y pedirJSON", async () => {
  const cal = nuevoCal("owner", "Europe/Madrid");
  const c = await gc().calendario(cal);
  ok("calendario(): nombre, zona y rol", c.nombre === "Familia" && c.zona === "Europe/Madrid" && c.rol === "owner", c);
  const cr = await gc().calendario(nuevoCal("reader"));
  ok("calendario() de uno de solo lectura → rol reader (no lanza: lo decide quien conecta)", cr.rol === "reader");
  const t = gc();
  const r = await t.pedirJSON("GET", `${rutaCalendario(cal)}/acl`, { query: { maxResults: "1" } });
  ok("pedirJSON: GET acl → 200 con json", r.status === 200 && Array.isArray(r.json?.items));
  const n = await t.pedirJSON("GET", `${rutaCalendario(cal)}/events/nada12345`);
  ok("pedirJSON: un 404 vuelve como respuesta (status, motivo), no como excepción", n.status === 404 && n.motivo === "notFound" && n.mensaje === "Not Found", n);
  ok("errorDe(404) → NO_ENCONTRADO", t.errorDe(n).codigo === "NO_ENCONTRADO");
  sim.inyectar(es.tipo("acl.list"), respuestas.error("rateLimitExceeded"));
  const lim = await intentar(t.pedirJSON("GET", `${rutaCalendario(cal)}/acl`));
  ok("pedirJSON: límite de uso → SERVIDOR (lanza)", codigo(lim) === "SERVIDOR");
  // El texto es neutro: invitar, quitar o "Probar" no reintentan (lo de «se reintenta solo» lo agrega el motor).
  sim.inyectar(es.tipo("acl.insert"), respuestas.error("rateLimit429"));
  const lim2 = await intentar(t.pedirJSON("POST", `${rutaCalendario(cal)}/acl`, { cuerpo: { role: "reader", scope: { type: "user", value: "abuela@gmail.com" } } }));
  ok(
    "pedirJSON: el texto del límite de uso es neutro (sin «se reintenta solo»), en un 403 usageLimits y en un 429",
    mensaje(lim) === "Google Calendar pidió esperar un momento (límite de uso)." && mensaje(lim2) === mensaje(lim),
    [mensaje(lim), mensaje(lim2)],
  );
  const { LimiteDeUso } = transporteGoogle as Partial<typeof transporteGoogle>;
  ok(
    "…y es un LimiteDeUso (ErrorCalDAV SERVIDOR) con su status, para que el motor diga que se reintenta",
    typeof LimiteDeUso === "function" && lim.error instanceof LimiteDeUso && lim.error.status === 403 && lim2.error instanceof LimiteDeUso && lim2.error.status === 429,
  );
  const conMatch = await t.pedirJSON("PATCH", `${rutaCalendario(cal)}/events/nada12345`, { cuerpo: { summary: "x" }, ifMatch: '"0"' });
  ok("pedirJSON con ifMatch y cuerpo", conMatch.status === 404);
});

// =====================================================================================
seccion("proveedores");
await caso("proveedores.ts", async () => {
  const conGoogle: ConexionCalendario = { id: "c1", proveedor: "google", nombre: "Familia", url: "c_1@group.calendar.google.com", creada: "2026-11-09T00:00:00.000Z" };
  const conICloud: ConexionCalendario = { ...conGoogle, proveedor: "icloud", url: "https://caldav.icloud.com/1/calendars/x/" };
  const viejo = { ...conICloud, proveedor: undefined } as unknown as ConexionCalendario;
  const env = { ...process.env };
  delete process.env.GOOGLE_CUENTA_SERVICIO;
  delete process.env.ICLOUD_USUARIO;
  delete process.env.ICLOUD_CLAVE_APP;
  ok("sin variables: nada configurado y transporteDe → null", !proveedorConfigurado("google") && !proveedorConfigurado("icloud") && transporteDe(conGoogle, 8000, Date.now() + 5000) === null && transporteDe(conICloud, 8000, Date.now() + 5000) === null);
  ok("textoSinCuenta", /GOOGLE_CUENTA_SERVICIO/.test(textoSinCuenta("google")) && textoSinCuenta("icloud") === "Falta configurar la cuenta de iCloud en el servidor (ICLOUD_USUARIO e ICLOUD_CLAVE_APP).");
  for (const modo of ["json", "base64"] as const) {
    usarClave(clave, modo);
    const t = transporteDe(conGoogle, 7000, Date.now() + 9000);
    ok(`GOOGLE_CUENTA_SERVICIO en ${modo} → GoogleCalendar con la base local y los plazos`, t instanceof GoogleCalendar && t.base === sim.apiUrl && t.espera === 7000 && t.correo === SA && proveedorConfigurado("google"));
  }
  process.env.GOOGLE_CUENTA_SERVICIO = '{"type":"service_account","client_email":"x@y.z","private_key":"-----BEGIN PRIVATE KEY-----\\nMIIE';
  ok("clave dañada → no configurado, null y el problema en el texto (sin la clave)", !proveedorConfigurado("google") && transporteDe(conGoogle, 8000, Date.now() + 5000) === null && /no se pudo leer: /.test(textoSinCuenta("google")) && !/MIIE/.test(textoSinCuenta("google")), textoSinCuenta("google"));
  process.env.ICLOUD_USUARIO = " papa@icloud.com ";
  process.env.ICLOUD_CLAVE_APP = "abcd efgh ijkl mnop";
  ok("iCloud configurado → CalDAV (también para conexiones guardadas sin proveedor)", transporteDe(conICloud, 8000, Date.now() + 5000) instanceof CalDAV && transporteDe(viejo, 8000, Date.now() + 5000) instanceof CalDAV && proveedorConfigurado("icloud"));
  for (const extra of [{}, { ICLOUD_CALDAV_URL: "http://127.0.0.1:5232/" }, { ICLOUD_CLAVE_APP: "" }]) {
    Object.assign(process.env, extra);
    ok(`credencialesICloud es la misma que la del motor ${JSON.stringify(extra)}`, JSON.stringify(credencialesICloud()) === JSON.stringify(credencialesMotor()), [credencialesICloud(), credencialesMotor()]);
  }
  ok("nombreProveedor y CLAVE_DUENO_GOOGLE", nombreProveedor("google") === "Google Calendar" && nombreProveedor("icloud") === "iCloud" && CLAVE_DUENO_GOOGLE === "externos/google");
  for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k];
  Object.assign(process.env, env);
});

// =====================================================================================
seccion("planear: días cambiados y BYSETPOS (guarda G1, corregida junto con el transporte)");
await caso("G1 con BYSETPOS y con el mismo inicio", async () => {
  const CAL = "fam@group.calendar.google.com";
  const yo = { email: CAL, self: true };
  const h = (f: string, hh: string) => ({ dateTime: `${f}T${hh}:00-03:00`, timeZone: ZS });
  const serie = (regla: string, inicio: string, viva: string, extra: string[] = []) =>
    [...agrupar(
      [
        { id: "serie01", etag: '"1"', status: "confirmed", summary: "Pago", start: h(inicio, "09:00"), end: h(inicio, "10:00"), recurrence: [regla, ...extra], organizer: yo, updated: "2026-11-01T00:00:00.000Z" },
        { id: `serie01_${viva.replace(/-/g, "")}T120000Z`, etag: '"2"', status: "confirmed", recurringEventId: "serie01", originalStartTime: h(viva, "09:00"), summary: "Pago (movido)", start: h(viva, "11:00"), end: h(viva, "12:00"), organizer: yo, updated: "2026-11-01T00:00:00.000Z" },
      ] as EvG[],
      CAL,
      ZS,
    ).values()][0];
  const intentarPlan = (s: ReturnType<typeof serie>, cambiar: (ics: string) => string) => {
    try {
      return planear(s, cambiar(serieAIcs(s)));
    } catch (e) {
      return e as Error;
    }
  };
  // Del 28 al "30 o el último": Google ya no genera el 28 de marzo (ical.js sí, porque no aplica BYSETPOS).
  const s1 = serie("RRULE:FREQ=MONTHLY;BYMONTHDAY=28", "2027-01-28", "2027-03-28");
  const p1 = intentarPlan(s1, (ics) =>
    ics.replace("RRULE:FREQ=MONTHLY;BYMONTHDAY=28", "RRULE:FREQ=MONTHLY;BYMONTHDAY=28,29,30;BYSETPOS=-1").replace(/(DTSTART;TZID=America\/Santiago:)20270128/, "$120270130").replace(/(DTEND;TZID=America\/Santiago:)20270128/, "$120270130"),
  );
  ok("mover del 28 al «30 o el último» con un día cambiado el 28 de marzo → NoSePuedeEscribir (G1)", p1 instanceof NoSePuedeEscribir && /días cambiados/.test(p1.message), p1 instanceof Error ? p1.message : p1);
  // «El 30 o el último» con días cambiados el 30 de marzo y el 28 de febrero: alargar el "hasta" sí se puede.
  for (const viva of ["2027-03-30", "2027-02-28"]) {
    const s2 = serie("RRULE:FREQ=MONTHLY;BYMONTHDAY=28,29,30;BYSETPOS=-1;UNTIL=20271231T120000Z", "2027-01-30", viva);
    const p2 = intentarPlan(s2, (ics) => ics.replace("UNTIL=20271231T120000Z", "UNTIL=20281231T120000Z"));
    ok(`«30 o el último» con un día cambiado el ${viva}: alargar el "hasta" → se puede`, !(p2 instanceof Error) && !!p2.maestro?.recurrence, p2 instanceof Error ? p2.message : p2);
  }
  // Otra regla con BYSETPOS (último día hábil): no se puede verificar → lo seguro.
  const s3 = serie("RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;UNTIL=20271231T120000Z", "2027-01-29", "2027-02-26");
  const p3 = intentarPlan(s3, (ics) => ics.replace("UNTIL=20271231T120000Z", "UNTIL=20281231T120000Z"));
  ok("último día hábil (BYSETPOS que el panel no escribe) con un día cambiado: cambiar la regla → NoSePuedeEscribir", p3 instanceof NoSePuedeEscribir, p3 instanceof Error ? p3.message : p3);
  // Mismo inicio y misma regla: cambiar sólo la hora de término no mueve ningún día (aunque ical.js no
  // cuente un DTSTART que no calza con la regla, como el martes 3 en una serie de los miércoles).
  const s4 = serie("RRULE:FREQ=WEEKLY;BYDAY=WE", "2026-11-03", "2026-11-03");
  const p4 = intentarPlan(s4, (ics) => ics.replace(/(DTEND;TZID=America\/Santiago:20261103T)100000/, "$1103000"));
  ok("cambiar sólo la hora de término con un día cambiado en el inicio → se puede (1 PATCH del principal)", !(p4 instanceof Error) && !!p4.maestro?.end && !p4.maestro.recurrence, p4 instanceof Error ? p4.message : p4);
});

// =====================================================================================
seccion("Al final");
ok("ningún pedido salió de esta máquina (token y API en 127.0.0.1)", urls.length > 0 && urls.every((u) => u.startsWith("http://127.0.0.1:")), urls.filter((u) => !u.startsWith("http://127.0.0.1:")).slice(0, 5));
const ajenos = sim.token.historial.filter((h) => (h as { reclamos?: { iss?: string } }).reclamos?.iss && (h as { reclamos?: { iss?: string } }).reclamos!.iss !== SA);
ok("todas las aserciones son de la cuenta de servicio de prueba", ajenos.length === 0);

await sim.cerrar();
console.log(`\n${buenas} OK, ${malas} MAL`);
process.exit(malas ? 1 : 0);
