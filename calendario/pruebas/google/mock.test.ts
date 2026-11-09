// Pruebas del simulador de Google Calendar (pruebas/google/mock-google.mts) contra lo DOCUMENTADO.
// Cada regla importante del simulador tiene aquí al menos un caso. Las claves RSA se generan aquí mismo.
//
// Correr desde calendario/:
//   node --experimental-transform-types --no-warnings --import ./pruebas/registrar.mjs pruebas/google/mock.test.ts
// Imprime "OK …" / "MAL …" y termina con código 1 si hubo algún MAL.
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { iniciarSimulador, respuestas, es, INTERRUPTORES_POR_OMISION, idInstancia, type Simulador, type Interruptores } from "./mock-google.mts";

// ─── Arnés ───
let malas = 0;
let buenas = 0;
const ok = (nombre: string, cond: unknown, detalle: unknown = "") => {
  if (cond) buenas++;
  else malas++;
  const d = detalle === "" ? "" : " · " + (typeof detalle === "string" ? detalle : JSON.stringify(detalle)).slice(0, 500);
  console.log(`${cond ? "OK " : "MAL"} ${nombre}${cond ? "" : d}`);
};
const seccion = (t: string) => console.log(`\n# ${t}`);

const AL = (...s: string[]) => s.map((x) => "https://www.googleapis.com/auth/" + x);
const SA = "panel@prueba.iam.gserviceaccount.com";
const DUENA = "mama@gmail.com";
const PAPA = "papa@gmail.com";
const ZS = "America/Santiago";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const otra = generateKeyPairSync("rsa", { modulusLength: 2048 });

function jwt(clave: KeyObject, reclamos: Record<string, unknown>) {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const datos = `${b({ alg: "RS256", typ: "JWT", kid: "k1" })}.${b(reclamos)}`;
  return `${datos}.${sign("sha256", Buffer.from(datos), clave).toString("base64url")}`;
}

type Resp = { status: number; json: any; cab: Headers };
type Op = { query?: Record<string, string> | [string, string][]; cuerpo?: unknown; crudo?: string; ifMatch?: string; cal?: string; signal?: AbortSignal; sinAuth?: boolean; auth?: string };
function cliente(sim: Simulador, token: string, calPorOmision: () => string) {
  return async (metodo: string, ruta: string, op: Op = {}): Promise<Resp> => {
    const qs = op.query ? "?" + new URLSearchParams(op.query as any).toString() : "";
    const url = `${sim.apiUrl}calendars/${encodeURIComponent(op.cal ?? calPorOmision())}${ruta}${qs}`;
    const h: Record<string, string> = {};
    if (!op.sinAuth) h.authorization = op.auth ?? `Bearer ${token}`;
    if (op.cuerpo !== undefined || op.crudo !== undefined) h["content-type"] = "application/json";
    if (op.ifMatch !== undefined) h["if-match"] = op.ifMatch;
    const r = await fetch(url, { method: metodo, headers: h, body: op.crudo ?? (op.cuerpo === undefined ? undefined : JSON.stringify(op.cuerpo)), signal: op.signal });
    const t = await r.text();
    let json: any = null;
    try {
      json = t ? JSON.parse(t) : null;
    } catch {
      json = t;
    }
    return { status: r.status, json, cab: r.headers };
  };
}
const motivo = (r: Resp) => r.json?.error?.errors?.[0]?.reason;
const mensaje = (r: Resp) => r.json?.error?.message;
const ids = (r: Resp) => (r.json?.items ?? []).map((x: any) => x.id);
const hora = (f: string, h: string) => ({ dateTime: `${f}T${h}:00-03:00`, timeZone: ZS });
const evento = (id: string, extra: Record<string, unknown> = {}) => ({ id, summary: "Evento " + id, start: hora("2026-11-20", "10:00"), end: hora("2026-11-20", "11:00"), ...extra });
const semanal = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  summary: "🦄 Natación",
  start: hora("2026-11-04", "09:00"),
  end: hora("2026-11-04", "10:00"),
  recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE"],
  ...extra,
});

const sim = await iniciarSimulador({ cuentas: new Map([[SA, publicKey]]), semilla: 7 });
let nCal = 0;
let calActual = "";
function nuevoCal(op: { zona?: string; rolSA?: any; resumen?: string } = {}) {
  calActual = `c_prueba${++nCal}@group.calendar.google.com`;
  sim.crearCalendario(calActual, { zona: op.zona ?? ZS, resumen: op.resumen ?? "Familia", dueno: DUENA });
  if (op.rolSA !== null) sim.compartir(calActual, SA, op.rolSA ?? "owner");
  return calActual;
}
const tokSA = sim.tokenPara(SA, AL("calendar.events", "calendar.acls"));
const g = cliente(sim, tokSA, () => calActual);
async function con<T>(cambios: Partial<Interruptores>, fn: () => Promise<T>): Promise<T> {
  const antes = { ...sim.interruptores };
  Object.assign(sim.interruptores, cambios);
  try {
    return await fn();
  } finally {
    Object.assign(sim.interruptores, antes);
  }
}
async function todasLasPaginas(ruta: string, query: Record<string, string>, cliente_ = g) {
  const paginas: Resp[] = [];
  let pt: string | undefined;
  for (let i = 0; i < 400; i++) {
    const r = await cliente_("GET", ruta, { query: { ...query, ...(pt ? { pageToken: pt } : {}) } });
    paginas.push(r);
    pt = r.json?.nextPageToken;
    if (r.status !== 200 || !pt) break;
  }
  return paginas;
}

// ═══════════════ 1. Token y autenticación ═══════════════
seccion("Token y autenticación");
{
  nuevoCal();
  const ahora = Math.floor(Date.now() / 1000);
  const pedirToken = (clave: KeyObject, scope: string, iss = SA) =>
    fetch(sim.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt(clave, { iss, scope, aud: "https://oauth2.googleapis.com/token", iat: ahora, exp: ahora + 3600 }) }),
    });
  const r = await pedirToken(privateKey, AL("calendar.events", "calendar.acls").join(" "));
  const tj = await r.json();
  ok("POST /token con JWT RS256 válido (calendar.events + calendar.acls) → 200 access_token", r.status === 200 && typeof tj.access_token === "string" && tj.token_type === "Bearer", tj);
  ok("el /token comparte puerto con la API y se cuenta", sim.contadores.token === 1 && sim.token.pedidos === 1 && sim.tokenUrl.startsWith(sim.url), [sim.contadores.token, sim.tokenUrl]);
  const real = cliente(sim, tj.access_token, () => calActual);
  ok("la API acepta el Bearer emitido por /token", (await real("GET", "/events")).status === 200);
  ok("…y la ACL, porque el alcance incluye calendar.acls", (await real("GET", "/acl")).status === 200);
  const mala = await pedirToken(otra.privateKey, AL("calendar.events").join(" "));
  ok("JWT firmado con otra clave → 400 invalid_grant (de mock-token)", mala.status === 400 && (await mala.json()).error === "invalid_grant");
  sim.token.revocar(tj.access_token);
  const rev = await real("GET", "/events");
  ok("token revocado → 401 authError con WWW-Authenticate", rev.status === 401 && motivo(rev) === "authError" && /Bearer/.test(rev.cab.get("www-authenticate") ?? ""), rev.json);
  const sin = await g("GET", "/events", { sinAuth: true });
  ok("sin Authorization → 401 required (Login Required.)", sin.status === 401 && motivo(sin) === "required", sin.json);
  const basura = await g("GET", "/events", { auth: "Bearer ya29.inventado" });
  ok("Bearer desconocido → 401 authError (Invalid Credentials)", basura.status === 401 && motivo(basura) === "authError" && mensaje(basura) === "Invalid Credentials");
  const soloEv = cliente(sim, sim.tokenPara(SA, AL("calendar.events")), () => calActual);
  const aclSinAlc = await soloEv("GET", "/acl");
  ok("alcance calendar.events sin calendar.acls → acl.list 403 insufficientPermissions", aclSinAlc.status === 403 && motivo(aclSinAlc) === "insufficientPermissions" && aclSinAlc.json.error.details?.[0]?.reason === "ACCESS_TOKEN_SCOPE_INSUFFICIENT", aclSinAlc.json);
  const calGet = await soloEv("GET", "");
  ok("calendars.get con solo calendar.events → 403 insufficientPermissions (discovery)", calGet.status === 403 && motivo(calGet) === "insufficientPermissions");
  const ro = cliente(sim, sim.tokenPara(SA, AL("calendar.readonly")), () => calActual);
  ok("calendar.readonly: events.list 200", (await ro("GET", "/events")).status === 200);
  const roIns = await ro("POST", "/events", { cuerpo: evento("lectura001") });
  ok("calendar.readonly: insert → 403 insufficientPermissions", roIns.status === 403 && motivo(roIns) === "insufficientPermissions");
  const acls = cliente(sim, sim.tokenPara(SA, AL("calendar.acls")), () => calActual);
  ok("solo calendar.acls: events.list → 403 insufficientPermissions", motivo(await acls("GET", "/events")) === "insufficientPermissions");
  const todo = cliente(sim, sim.tokenPara(SA, AL("calendar")), () => calActual);
  const cg = await todo("GET", "");
  ok("alcance calendar cubre todo: calendars.get 200 con timeZone y summary", cg.status === 200 && cg.json.timeZone === ZS && cg.json.summary === "Familia", cg.json);
}

// ═══════════════ 2. ACL → acceso y accessRole ═══════════════
seccion("ACL → acceso y accessRole");
{
  nuevoCal({ rolSA: null });
  const r = await g("GET", "/events");
  ok("calendario sin regla para la cuenta de servicio → 404 notFound", r.status === 404 && motivo(r) === "notFound", r.json);
  ok("calendario que no existe → 404 notFound", (await g("GET", "/events", { cal: "noexiste@group.calendar.google.com" })).status === 404);
  for (const rol of ["freeBusyReader", "reader", "writerWithoutPrivateAccess", "writer", "owner"] as const) {
    sim.compartir(calActual, SA, rol);
    const l = await g("GET", "/events");
    ok(`regla ${rol} → events.list accessRole "${rol}"`, l.status === 200 && l.json.accessRole === rol, l.json?.accessRole);
  }
  sim.quitar(calActual, SA);
  ok("quitar la regla → 404 en el pedido siguiente", (await g("GET", "/events")).status === 404);
}

// ═══════════════ 3. events.list: forma de la respuesta y timeZone ═══════════════
seccion("events.list: respuesta y timeZone");
{
  nuevoCal();
  await g("POST", "/events", { cuerpo: evento("forma00001") });
  const l = await g("GET", "/events");
  const j = l.json;
  ok("trae kind, etag, summary, updated, timeZone, accessRole, defaultReminders e items", j.kind === "calendar#events" && /^".*"$/.test(j.etag) && j.summary === "Familia" && typeof j.updated === "string" && j.timeZone === ZS && j.accessRole === "owner" && Array.isArray(j.defaultReminders) && j.items.length === 1, j);
  ok("una sola página: nextSyncToken y sin nextPageToken", typeof j.nextSyncToken === "string" && !("nextPageToken" in j));
  ok("sin timeZone: los dateTime con el desfase del calendario (-03:00)", j.items[0].start.dateTime === "2026-11-20T10:00:00-03:00", j.items[0].start);
  const m = await g("GET", "/events", { query: { timeZone: "Europe/Madrid" } });
  ok("timeZone=Europe/Madrid: dateTime con +01:00 (el mismo instante), timeZone del evento intacto", m.json.items[0].start.dateTime === "2026-11-20T14:00:00+01:00" && m.json.items[0].start.timeZone === ZS && m.json.timeZone === ZS, m.json.items[0].start);
  const u = await g("GET", "/events", { query: { timeZone: "UTC" } });
  ok("timeZone=UTC: dateTime en Z", u.json.items[0].start.dateTime === "2026-11-20T13:00:00Z", u.json.items[0].start);
  ok("timeZone inválida → 400", (await g("GET", "/events", { query: { timeZone: "Marte/Olympus" } })).status === 400);
  nuevoCal({ zona: "Europe/Madrid", resumen: "Otra" });
  const o = await g("GET", "/events");
  ok("la respuesta trae la zona y el nombre de ESE calendario (configurables)", o.json.timeZone === "Europe/Madrid" && o.json.summary === "Otra", o.json);
  const ev = await g("POST", "/events", { cuerpo: { id: "madrid0001", summary: "x", start: { dateTime: "2026-11-20T10:00:00Z" }, end: { dateTime: "2026-11-20T11:00:00Z" } } });
  ok("evento suelto sin timeZone en un calendario de Madrid: dateTime con +01:00", ev.json.start.dateTime === "2026-11-20T11:00:00+01:00" && !("timeZone" in ev.json.start), ev.json.start);
}

// ═══════════════ 4. Paginación ═══════════════
seccion("Paginación");
{
  nuevoCal();
  for (let i = 0; i < 25; i++) sim.poner(calActual, evento(`pag${String(i).padStart(5, "0")}`));
  const ps = await todasLasPaginas("/events", { maxResults: "10" });
  ok("25 eventos con maxResults=10 → páginas de 10, 10 y 5", ps.map((p) => p.json.items.length).join(",") === "10,10,5", ps.map((p) => p.json.items?.length));
  ok("nextPageToken en todas menos la última; nextSyncToken solo en la última", ps.slice(0, -1).every((p) => p.json.nextPageToken && !p.json.nextSyncToken) && !ps.at(-1)!.json.nextPageToken && ps.at(-1)!.json.nextSyncToken);
  ok("cada página trae accessRole/timeZone/summary", ps.every((p) => p.json.accessRole === "owner" && p.json.timeZone === ZS && p.json.summary === "Familia"));
  const repetida = await g("GET", "/events", { query: { maxResults: "10", pageToken: ps[0].json.nextPageToken } });
  ok("el mismo pageToken dos veces da la misma página", JSON.stringify(ids(repetida)) === JSON.stringify(ids(ps[1])));
  const otraConsulta = await g("GET", "/events", { query: { maxResults: "10", showDeleted: "true", pageToken: ps[0].json.nextPageToken } });
  ok("pageToken con otros parámetros que la primera página → 400", otraConsulta.status === 400, otraConsulta.json);
  sim.vencerPaginas();
  const vencida = await g("GET", "/events", { query: { maxResults: "10", pageToken: ps[0].json.nextPageToken } });
  ok("pageToken vencido → 400", vencida.status === 400 && motivo(vencida) === "invalid", vencida.json);
  ok("maxResults=0 → 400", (await g("GET", "/events", { query: { maxResults: "0" } })).status === 400);
  ok("maxResults=abc → 400", (await g("GET", "/events", { query: { maxResults: "abc" } })).status === 400);

  sim.paginacion.modo = [0, 3, 0];
  const exp = await todasLasPaginas("/events", { maxResults: "10" });
  ok("modo [0,3,0]: páginas vacías y cortas con nextPageToken (0,3,0,10,10,2)", exp.map((p) => p.json.items.length).join(",") === "0,3,0,10,10,2" && exp.slice(0, -1).every((p) => p.json.nextPageToken), exp.map((p) => p.json.items.length));

  nuevoCal();
  for (let i = 0; i < 300; i++) sim.poner(calActual, evento(`azr${String(i).padStart(5, "0")}`));
  sim.paginacion.modo = "azar";
  const az = await todasLasPaginas("/events", { maxResults: "50" });
  const todos = az.flatMap((p) => ids(p));
  ok("modo azar: la unión de las páginas es exactamente el calendario (300, sin repetidos)", todos.length === 300 && new Set(todos).size === 300, todos.length);
  ok("modo azar: hay páginas más cortas que maxResults (y siguen con nextPageToken)", az.slice(0, -1).some((p) => p.json.items.length < 50) && az.slice(0, -1).every((p) => p.json.nextPageToken), az.map((p) => p.json.items.length));
  ok("modo azar: nextSyncToken solo en la última página", az.slice(0, -1).every((p) => !p.json.nextSyncToken) && !!az.at(-1)!.json.nextSyncToken);
  sim.paginacion.modo = "normal";

  nuevoCal();
  for (let i = 0; i < 2600; i++) sim.poner(calActual, evento(`big${String(i).padStart(5, "0")}`));
  const grande = await g("GET", "/events", { query: { maxResults: "5000", fields: "nextPageToken,items(id)" } });
  ok("maxResults=5000 → nunca más de 2500 por página", grande.json.items.length === 2500 && !!grande.json.nextPageToken, grande.json.items.length);
  const def = await g("GET", "/events", { query: { fields: "items(id)" } });
  ok("sin maxResults: 250 por página", def.json.items.length === 250, def.json.items.length);
}

// ═══════════════ 5. syncToken ═══════════════
seccion("syncToken");
{
  nuevoCal();
  for (const id of ["sinc000001", "sinc000002", "sinc000003"]) await g("POST", "/events", { cuerpo: evento(id) });
  const base = await g("GET", "/events");
  const st = base.json.nextSyncToken;
  for (const extra of [{ timeMin: "2026-01-01T00:00:00Z" }, { timeMax: "2027-01-01T00:00:00Z" }, { q: "x" }, { iCalUID: "a@google.com" }, { orderBy: "updated" }, { updatedMin: "2026-01-01T00:00:00Z" }, { privateExtendedProperty: "a=b" }] as Record<string, string>[]) {
    const r = await g("GET", "/events", { query: { syncToken: st, ...extra } });
    ok(`syncToken + ${Object.keys(extra)[0]} → 400`, r.status === 400, r.json);
  }
  await g("PATCH", "/events/sinc000001", { cuerpo: { summary: "cambiado" } });
  await g("DELETE", "/events/sinc000002");
  const inc = await g("GET", "/events", { query: { syncToken: st } });
  const porId = Object.fromEntries((inc.json.items ?? []).map((x: any) => [x.id, x]));
  ok("incremental: solo lo cambiado, y el borrado como cancelled", inc.status === 200 && inc.json.items.length === 2 && porId.sinc000001?.summary === "cambiado" && porId.sinc000002?.status === "cancelled", inc.json);
  ok("incremental: nextSyncToken nuevo", inc.json.nextSyncToken && inc.json.nextSyncToken !== st);
  sim.invalidarSync(calActual);
  const v = await g("GET", "/events", { query: { syncToken: inc.json.nextSyncToken } });
  ok("syncToken invalidado → 410 fullSyncRequired", v.status === 410 && motivo(v) === "fullSyncRequired", v.json);
}

// ═══════════════ 6. fields ═══════════════
seccion("fields (respuesta parcial)");
{
  nuevoCal();
  await g("POST", "/events", { cuerpo: evento("campos0001", { location: "Piscina", extendedProperties: { private: { cfh: "abc", otra: "x" } } }) });
  await g("POST", "/events", { cuerpo: evento("campos0002") });
  const r = await g("GET", "/events", { query: { fields: "accessRole,items(id,start/dateTime)" } });
  const it = r.json.items[0];
  ok("items(id,start/dateTime): solo esos campos (y sus padres)", r.status === 200 && Object.keys(r.json).sort().join() === "accessRole,items" && Object.keys(it).sort().join() === "id,start" && Object.keys(it.start).join() === "dateTime", r.json);
  const pag = await g("GET", "/events", { query: { maxResults: "1", fields: "accessRole,items(id)" } });
  ok("sin nextPageToken en la máscara, no viene aunque haya más páginas", pag.status === 200 && !("nextPageToken" in pag.json) && pag.json.items.length === 1, pag.json);
  const cfh = await g("GET", "/events/campos0001", { query: { fields: "id,extendedProperties/private/cfh" } });
  ok("extendedProperties/private/cfh (mapa) en get", cfh.status === 200 && JSON.stringify(cfh.json) === JSON.stringify({ id: "campos0001", extendedProperties: { private: { cfh: "abc" } } }), cfh.json);
  const plan =
    "accessRole,timeZone,summary,nextPageToken,items(id,etag,status,summary,description,location,start,end,endTimeUnspecified,recurrence,recurringEventId,originalStartTime,iCalUID,created,updated,sequence,eventType,locked,privateCopy,organizer,attendees(email),extendedProperties)";
  const rp = await g("GET", "/events", { query: { singleEvents: "false", maxResults: "2500", timeZone: ZS, fields: plan } });
  ok("la máscara del plan (1.6) es válida", rp.status === 200 && rp.json.items.length === 2, rp.json);
  ok("comodín items(start/*) es válido", (await g("GET", "/events", { query: { fields: "items(start/*)" } })).status === 200);
  for (const malo of ["items(idd)", "acessRole,items(id)", "items(start/dateTiem)", "summary/x", "items(extendedProperties/private/cfh/x)", "items(id", "items(attendees(mail))", "nextPageTokn"]) {
    const x = await g("GET", "/events", { query: { fields: malo } });
    ok(`fields=${malo} → 400 invalidParameter`, x.status === 400 && motivo(x) === "invalidParameter" && x.json.error.errors[0].location === "fields", x.json);
  }
  const pm = await g("PATCH", "/events/campos0002", { cuerpo: { summary: "nuevo" }, query: { fields: "id,etag,updated,summary" } });
  ok("fields también proyecta la respuesta de un PATCH", pm.status === 200 && Object.keys(pm.json).sort().join() === "etag,id,summary,updated" && pm.json.summary === "nuevo", pm.json);
  const pmMalo = await g("PATCH", "/events/campos0002", { cuerpo: { summary: "otro" }, query: { fields: "id,etagg" } });
  const despues = sim.evento(calActual, "campos0002");
  ok("PATCH con fields inválido → 400 y no se aplica", pmMalo.status === 400 && despues.summary === "nuevo", [pmMalo.status, despues.summary]);
}

// ═══════════════ 7. insert ═══════════════
seccion("events.insert");
{
  nuevoCal();
  for (const [id, que] of [["ABCDE12", "mayúsculas"], ["abc_d1234", "guion bajo"], ["abcd", "4 caracteres"], ["w2345", "letra fuera de a-v"], ["a".repeat(1025), "1025 caracteres"]]) {
    const r = await g("POST", "/events", { cuerpo: evento(id) });
    ok(`id inválido (${que}) → 400`, r.status === 400 && motivo(r) === "invalid", r.json);
  }
  ok("id de 1024 caracteres base32hex → 200", (await g("POST", "/events", { cuerpo: evento("v".repeat(1024)) })).status === 200);
  sim.reloj.fijar(Date.parse("2026-11-09T12:00:00.000Z"));
  const r = await g("POST", "/events", { cuerpo: evento("nuevo00001") });
  const j = r.json;
  ok("insert: iCalUID = id@google.com", j.iCalUID === "nuevo00001@google.com", j.iCalUID);
  ok("insert: organizer = {email: calId, self: true}; creator = la cuenta de servicio", j.organizer.email === calActual && j.organizer.self === true && j.creator.email === SA, [j.organizer, j.creator]);
  ok("insert: created y updated del reloj inyectable", j.created === "2026-11-09T12:00:00.000Z" && j.updated === "2026-11-09T12:00:00.000Z", [j.created, j.updated]);
  ok("insert: etag entre comillas, status confirmed, sequence 0, eventType default", /^"\d+"$/.test(j.etag) && j.status === "confirmed" && j.sequence === 0 && j.eventType === "default" && r.cab.get("etag") === j.etag, j);
  sim.reloj.real();
  const otraVez = await g("PATCH", "/events/nuevo00001", { cuerpo: { summary: "x" } });
  ok("cada cambio da un etag nuevo", otraVez.json.etag !== j.etag);
  const dup = await g("POST", "/events", { cuerpo: evento("nuevo00001") });
  ok("id ocupado → 409 duplicate 'The requested identifier already exists.'", dup.status === 409 && motivo(dup) === "duplicate" && mensaje(dup) === "The requested identifier already exists.", dup.json);
  await g("DELETE", "/events/nuevo00001");
  const lap = await g("POST", "/events", { cuerpo: evento("nuevo00001") });
  ok("lápida con lapidaOcupaId=true (omisión) → 409", lap.status === 409 && motivo(lap) === "duplicate");
  await con({ lapidaOcupaId: false }, async () => {
    const x = await g("POST", "/events", { cuerpo: evento("nuevo00001", { summary: "revivido" }) });
    ok("lápida con lapidaOcupaId=false → 200 y queda viva", x.status === 200 && sim.evento(calActual, "nuevo00001").status === "confirmed" && sim.evento(calActual, "nuevo00001").summary === "revivido", x.json);
  });
  const att = await g("POST", "/events", { cuerpo: evento("invita0001", { attendees: [{ email: PAPA }] }) });
  ok("attendees desde una cuenta de servicio → 403 forbiddenForServiceAccounts", att.status === 403 && motivo(att) === "forbiddenForServiceAccounts", att.json);
  const sinZona = await g("POST", "/events", { cuerpo: { id: "serie00001", summary: "s", start: { dateTime: "2026-11-04T12:00:00Z" }, end: { dateTime: "2026-11-04T13:00:00Z" }, recurrence: ["RRULE:FREQ=DAILY"] } });
  ok("serie con dateTime en Z y sin timeZone → 400 'Missing time zone definition for start time.'", sinZona.status === 400 && mensaje(sinZona) === "Missing time zone definition for start time.", sinZona.json);
  const sinDesfase = await g("POST", "/events", { cuerpo: { id: "suelto0001", start: { dateTime: "2026-11-04T12:00:00" }, end: { dateTime: "2026-11-04T13:00:00" } } });
  ok("dateTime sin desfase ni timeZone → 400 Missing time zone definition", sinDesfase.status === 400 && /Missing time zone definition/.test(mensaje(sinDesfase)), sinDesfase.json);
  const conTz = await g("POST", "/events", { cuerpo: { id: "suelto0002", start: { dateTime: "2026-11-04T12:00:00", timeZone: ZS }, end: { dateTime: "2026-11-04T13:00:00", timeZone: ZS } } });
  ok("dateTime sin desfase pero con timeZone → 200 (hora de reloj en esa zona)", conTz.status === 200 && conTz.json.start.dateTime === "2026-11-04T12:00:00-03:00", conTz.json.start);
  ok("suelto en Z sin timeZone → 200", (await g("POST", "/events", { cuerpo: { id: "suelto0003", start: { dateTime: "2026-11-04T12:00:00Z" }, end: { dateTime: "2026-11-04T13:00:00Z" } } })).status === 200);
  const mezcla = await g("POST", "/events", { cuerpo: { id: "mescla0001", start: { date: "2026-11-04" }, end: hora("2026-11-04", "10:00") } });
  ok("date mezclado con dateTime → 400", mezcla.status === 400 && /both be date or both be dateTime/.test(mensaje(mezcla)), mezcla.json);
  const ambos = await g("POST", "/events", { cuerpo: { id: "mesca00002", start: { date: "2026-11-04", dateTime: "2026-11-04T10:00:00Z" }, end: { date: "2026-11-05" } } });
  ok("start con date y dateTime a la vez → 400", ambos.status === 400);
  const alReves = await g("POST", "/events", { cuerpo: { id: "reves00001", start: hora("2026-11-04", "10:00"), end: hora("2026-11-04", "09:00") } });
  ok("end < start → 400 timeRangeEmpty", alReves.status === 400 && motivo(alReves) === "timeRangeEmpty", alReves.json);
  const igual = await g("POST", "/events", { cuerpo: { id: "igual00001", start: hora("2026-11-04", "10:00"), end: hora("2026-11-04", "10:00") } });
  ok("end == start con finIgualInicio=ok (omisión) → 200", igual.status === 200, igual.json);
  await con({ finIgualInicio: "400" }, async () => {
    const x = await g("POST", "/events", { cuerpo: { id: "igual00002", start: hora("2026-11-04", "10:00"), end: hora("2026-11-04", "10:00") } });
    ok("end == start con finIgualInicio=400 → 400 timeRangeEmpty", x.status === 400 && motivo(x) === "timeRangeEmpty", x.json);
    const y = await g("POST", "/events", { cuerpo: { id: "igual00003", start: hora("2026-11-04", "10:00"), endTimeUnspecified: true } });
    ok("…pero endTimeUnspecified sin end sigue aceptado (end = start)", y.status === 200 && y.json.end.dateTime === y.json.start.dateTime && y.json.endTimeUnspecified === true, y.json);
  });
  await con({ endTimeUnspecifiedAceptado: false }, async () => {
    const x = await g("POST", "/events", { cuerpo: { id: "sinfin0001", start: hora("2026-11-04", "10:00"), endTimeUnspecified: true } });
    ok("endTimeUnspecifiedAceptado=false: sin end → 400 Missing end time.", x.status === 400 && mensaje(x) === "Missing end time.", x.json);
  });
  for (const [linea, que] of [
    ["RRULE:FREQ=SOMETIMES", "FREQ desconocida"],
    ["RRULE:BYDAY=MO", "sin FREQ"],
    ["RRULE:FREQ=WEEKLY;FOO=1", "parte desconocida"],
    ["RRULE:FREQ=WEEKLY;COUNT=3;UNTIL=20261231T000000Z", "COUNT y UNTIL"],
    ["RRULE:FREQ=WEEKLY;BYDAY=XX", "BYDAY inválido"],
    ["DTSTART:20261104T090000Z", "línea DTSTART"],
    ["EXDATE;TZID=Marte/Base:20261111T090000", "TZID desconocido"],
    ["EXDATE:2026-11-11", "valor mal escrito"],
  ]) {
    const x = await g("POST", "/events", { cuerpo: semanal("regla" + Math.random().toString(32).slice(2, 8).replace(/[^a-v0-9]/g, "a"), { recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE", linea].filter((l, i) => i === 0 ? !linea.startsWith("RRULE") : true) }) });
    ok(`recurrence con ${que} → 400 Invalid recurrence rule.`, x.status === 400 && mensaje(x) === "Invalid recurrence rule.", [linea, x.json]);
  }
  const fin = semanal("ultimo0001", { start: hora("2026-01-30", "10:00"), end: hora("2026-01-30", "11:00"), recurrence: ["RRULE:FREQ=MONTHLY;BYMONTHDAY=28,29,30;BYSETPOS=-1;COUNT=6"] });
  ok("regla del panel (BYSETPOS=-1 con BYMONTHDAY=28,29,30) se acepta por omisión", (await g("POST", "/events", { cuerpo: fin })).status === 200);
  await con({ reglasRechazadas: [/BYSETPOS=-1/] }, async () => {
    const x = await g("POST", "/events", { cuerpo: { ...fin, id: "ultimo0002" } });
    ok("…y con reglasRechazadas=[/BYSETPOS=-1/] → 400", x.status === 400 && mensaje(x) === "Invalid recurrence rule.", x.json);
  });
  ok("eventType distinto de default → 400", (await g("POST", "/events", { cuerpo: evento("tipo000001", { eventType: "birthday" }) })).status === 400);
  ok("cuerpo que no es JSON → 400 parseError", motivo(await g("POST", "/events", { crudo: "{no-json" })) === "parseError");
  // sequence
  await g("POST", "/events", { cuerpo: evento("secuen0001") });
  const s1 = await g("PATCH", "/events/secuen0001", { cuerpo: { start: hora("2026-11-21", "10:00"), end: hora("2026-11-21", "11:00") } });
  ok("cambiar la hora sube sequence (0 → 1)", s1.json.sequence === 1, s1.json.sequence);
  const s0 = await g("PATCH", "/events/secuen0001", { cuerpo: { summary: "x", sequence: 0 } });
  ok("sequence menor al guardado → 400 'Invalid sequence value…'", s0.status === 400 && /^Invalid sequence value/.test(mensaje(s0)), s0.json);
  ok("sequence igual → 200", (await g("PATCH", "/events/secuen0001", { cuerpo: { summary: "y", sequence: 1 } })).status === 200);
}

// ═══════════════ 8. Lápidas, get y delete ═══════════════
seccion("Lápidas, get y delete");
{
  nuevoCal();
  await g("POST", "/events", { cuerpo: evento("lapida0001", { location: "Casa" }) });
  await g("POST", "/events", { cuerpo: evento("lapida0002") });
  const etag = sim.evento(calActual, "lapida0001").etag;
  const malo = await g("DELETE", "/events/lapida0001", { ifMatch: '"0"' });
  ok("DELETE con If-Match distinto → 412 conditionNotMet", malo.status === 412 && motivo(malo) === "conditionNotMet", malo.json);
  const d = await g("DELETE", "/events/lapida0001", { ifMatch: etag });
  ok("DELETE con el etag vigente → 204 sin cuerpo", d.status === 204 && d.json === null);
  const l = await g("GET", "/events");
  ok("sin showDeleted el borrado no se lista", JSON.stringify(ids(l)) === JSON.stringify(["lapida0002"]), ids(l));
  const ls = await g("GET", "/events", { query: { showDeleted: "true" } });
  ok("con showDeleted=true se lista como cancelled", ls.json.items.find((x: any) => x.id === "lapida0001")?.status === "cancelled");
  const gt = await g("GET", "/events/lapida0001");
  ok("get devuelve la lápida: status cancelled y sus datos", gt.status === 200 && gt.json.status === "cancelled" && gt.json.location === "Casa" && gt.json.summary === "Evento lapida0001", gt.json);
  const otra = await g("DELETE", "/events/lapida0001");
  ok("DELETE de algo ya borrado → 410 deleted", otra.status === 410 && motivo(otra) === "deleted", otra.json);
  const nunca = await g("DELETE", "/events/nuncaexisti");
  ok("DELETE de algo que nunca existió → 404 notFound", nunca.status === 404 && motivo(nunca) === "notFound");
  ok("get de algo que nunca existió → 404", (await g("GET", "/events/nuncaexisti")).status === 404);
  // serie con excepciones
  await g("POST", "/events", { cuerpo: semanal("serie00001") });
  const del1 = await g("DELETE", "/events/serie00001_20261111T120000Z");
  const pat = await g("PATCH", "/events/serie00001_20261118T120000Z", { cuerpo: { summary: "🦄 Natación (piscina 2)" } });
  ok("DELETE de una instancia → 204; PATCH de otra → 200", del1.status === 204 && pat.status === 200, [del1.status, pat.json]);
  const sf = await g("GET", "/events", { query: { singleEvents: "false" } });
  const st = Object.fromEntries(sf.json.items.map((x: any) => [x.id, x.status]));
  ok("singleEvents=false trae el principal, la excepción CANCELADA y la viva (sin showDeleted)", st.serie00001 === "confirmed" && st.serie00001_20261111T120000Z === "cancelled" && st.serie00001_20261118T120000Z === "confirmed", st);
  const exc = sf.json.items.find((x: any) => x.id === "serie00001_20261111T120000Z");
  ok("la excepción cancelada trae recurringEventId y originalStartTime", exc.recurringEventId === "serie00001" && exc.originalStartTime.dateTime === "2026-11-11T09:00:00-03:00", exc);
  await g("DELETE", "/events/serie00001");
  const tras = await g("GET", "/events");
  ok("borrar el principal se lleva sus excepciones: nada de la serie sin showDeleted", !ids(tras).some((x: string) => x.startsWith("serie00001")), ids(tras));
  const trasS = await g("GET", "/events", { query: { showDeleted: "true" } });
  const serie = trasS.json.items.filter((x: any) => x.id.startsWith("serie00001"));
  ok("con showDeleted aparecen las 3 piezas, todas cancelled", serie.length === 3 && serie.every((x: any) => x.status === "cancelled"), serie.map((x: any) => [x.id, x.status]));
  ok("instancia de un principal borrado → 404", (await g("GET", "/events/serie00001_20261125T120000Z")).status === 404);
}

// ═══════════════ 9. Ids de instancia e instances ═══════════════
seccion("Ids de instancia e instances");
{
  nuevoCal();
  await g("POST", "/events", { cuerpo: semanal("inst000001", { recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE", "EXDATE;TZID=America/Santiago:20261202T090000"] }) });
  const i1 = await g("GET", "/events/inst000001_20261111T120000Z");
  ok("<id>_<UTC>Z de un día de la regla → 200 aunque la excepción no exista", i1.status === 200 && i1.json.recurringEventId === "inst000001" && i1.json.originalStartTime.dateTime === "2026-11-11T09:00:00-03:00" && i1.json.start.dateTime === "2026-11-11T09:00:00-03:00" && !("recurrence" in i1.json), i1.json);
  ok("idInstancia() arma el mismo id", idInstancia("inst000001", { dateTime: "2026-11-11T09:00:00-03:00" }) === "inst000001_20261111T120000Z");
  ok("día que no es de la regla (jueves) → 404", (await g("GET", "/events/inst000001_20261112T120000Z")).status === 404);
  ok("hora que no es la de la regla → 404", (await g("GET", "/events/inst000001_20261111T130000Z")).status === 404);
  ok("formato de día completo en una serie con hora → 404", (await g("GET", "/events/inst000001_20261111")).status === 404);
  const ex = await g("GET", "/events/inst000001_20261202T120000Z");
  ok("instancia sacada por EXDATE: get → cancelled", ex.status === 200 && ex.json.status === "cancelled", ex.json);
  ok("…y DELETE → 410", (await g("DELETE", "/events/inst000001_20261202T120000Z")).status === 410);
  await g("POST", "/events", { cuerpo: { id: "anual00001", summary: "Navidad", start: { date: "2026-12-25" }, end: { date: "2026-12-26" }, recurrence: ["RRULE:FREQ=YEARLY"] } });
  const an = await g("GET", "/events/anual00001_20271225");
  ok("<id>_<YYYYMMDD> de una serie de día completo → 200", an.status === 200 && an.json.start.date === "2027-12-25" && an.json.end.date === "2027-12-26" && an.json.originalStartTime.date === "2027-12-25", an.json);
  ok("…otro día → 404", (await g("GET", "/events/anual00001_20271226")).status === 404);
  const rango = { timeMin: "2026-11-01T00:00:00-03:00", timeMax: "2026-12-31T00:00:00-03:00" };
  const ins = await g("GET", "/events/inst000001/instances", { query: rango });
  ok("instances?timeMin&timeMax: las 8 instancias (sin la del EXDATE), cada una con id y etag", ins.status === 200 && ins.json.items.length === 8 && ins.json.items.every((x: any) => /^inst000001_\d{8}T\d{6}Z$/.test(x.id) && /^"/.test(x.etag)) && !ids(ins).includes("inst000001_20261202T120000Z"), ids(ins));
  await g("DELETE", "/events/inst000001_20261111T120000Z");
  await g("PATCH", "/events/inst000001_20261118T120000Z", { cuerpo: { location: "Piscina 2" } });
  const ins2 = await g("GET", "/events/inst000001/instances", { query: rango });
  ok("instances: la cancelada no sale sin showDeleted; la cambiada sí, con su etag propio", ins2.json.items.length === 7 && ins2.json.items.find((x: any) => x.id === "inst000001_20261118T120000Z")?.location === "Piscina 2" && ins2.json.items.find((x: any) => x.id === "inst000001_20261118T120000Z").etag !== sim.evento(calActual, "inst000001").etag, ids(ins2));
  const ins3 = await g("GET", "/events/inst000001/instances", { query: { ...rango, showDeleted: "true" } });
  ok("instances con showDeleted=true incluye la cancelada", ins3.json.items.length === 8 && ins3.json.items.find((x: any) => x.id === "inst000001_20261111T120000Z")?.status === "cancelled");
  const os = await g("GET", "/events/inst000001/instances", { query: { originalStart: "2026-11-25T09:00:00-03:00" } });
  ok("instances?originalStart → solo esa", os.json.items.length === 1 && os.json.items[0].id === "inst000001_20261125T120000Z", ids(os));
  // cambio de hora de Chile (sábado 4 de abril de 2026 a las 24:00 vuelve a -04:00)
  await g("POST", "/events", { cuerpo: { id: "horario001", summary: "h", start: hora("2026-03-25", "17:00"), end: hora("2026-03-25", "18:00"), recurrence: ["RRULE:FREQ=WEEKLY;COUNT=5"] } });
  const dst = await g("GET", "/events/horario001/instances");
  const horas = dst.json.items.map((x: any) => x.start.dateTime);
  ok("la regla se expande en la hora de reloj de la serie: 17:00 antes y después del cambio de hora", horas.length === 5 && horas.every((h: string) => h.slice(11, 19) === "17:00:00") && horas[0].endsWith("-03:00") && horas[4].endsWith("-04:00"), horas);
  await g("POST", "/events", { cuerpo: { id: "ultimodia1", summary: "u", start: hora("2026-01-30", "10:00"), end: hora("2026-01-30", "11:00"), recurrence: ["RRULE:FREQ=MONTHLY;BYMONTHDAY=28,29,30;BYSETPOS=-1;COUNT=6"] } });
  const ud = await g("GET", "/events/ultimodia1/instances");
  ok("BYMONTHDAY=28,29,30;BYSETPOS=-1: 30-ene, 28-feb, 30-mar, 30-abr, 30-may, 30-jun", ud.json.items.map((x: any) => x.start.dateTime.slice(0, 10)).join() === "2026-01-30,2026-02-28,2026-03-30,2026-04-30,2026-05-30,2026-06-30", ud.json.items.map((x: any) => x.start.dateTime));
  await g("POST", "/events", { cuerpo: { id: "martes0001", summary: "m", start: hora("2026-11-03", "17:00"), end: hora("2026-11-03", "18:00"), recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=2"] } });
  const ma = await g("GET", "/events/martes0001/instances");
  ok("DTSTART fuera de la regla (martes con BYDAY=WE): como ical.js, no cuenta (inicioCuentaSiempre=false)", ma.json.items.map((x: any) => x.start.dateTime.slice(0, 10)).join() === "2026-11-04,2026-11-11", ma.json.items.map((x: any) => x.start.dateTime));
  await con({ inicioCuentaSiempre: true }, async () => {
    const m2 = await g("GET", "/events/martes0001/instances");
    ok("…con inicioCuentaSiempre=true (RFC 5545) el martes es la primera", m2.json.items[0].start.dateTime.slice(0, 10) === "2026-11-03", m2.json.items.map((x: any) => x.start.dateTime));
  });
  const vir = sim.instancias(calActual, "inst000001", Date.parse("2026-11-01T00:00:00Z"), Date.parse("2026-12-01T00:00:00Z"));
  ok("sim.instancias(): vista cruda de la serie", vir.length === 3 && vir.some((x) => x.location === "Piscina 2"), vir.map((x) => x.id));
}

// ═══════════════ 10. PATCH y PUT ═══════════════
seccion("PATCH y PUT");
{
  nuevoCal();
  await g("POST", "/events", { cuerpo: evento("patch00001", { location: "Casa", description: "nota", extendedProperties: { private: { a: "1" } } }) });
  const p1 = await g("PATCH", "/events/patch00001", { cuerpo: { summary: "otro" } });
  ok("PATCH mezcla: cambia summary y conserva location y description", p1.json.summary === "otro" && p1.json.location === "Casa" && p1.json.description === "nota");
  const p2 = await g("PATCH", "/events/patch00001", { cuerpo: { location: null } });
  ok("null borra la clave", p2.status === 200 && !("location" in p2.json), p2.json);
  const p3 = await g("PATCH", "/events/patch00001", { cuerpo: { extendedProperties: { private: { b: "2" } } } });
  ok("extendedProperties.private se mezcla clave por clave", JSON.stringify(p3.json.extendedProperties) === JSON.stringify({ private: { a: "1", b: "2" } }), p3.json.extendedProperties);
  const p4 = await g("PATCH", "/events/patch00001", { cuerpo: { extendedProperties: { private: { a: null } } } });
  ok("…y null borra una sola clave", JSON.stringify(p4.json.extendedProperties) === JSON.stringify({ private: { b: "2" } }), p4.json.extendedProperties);
  await g("POST", "/events", { cuerpo: semanal("patch00002", { recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE", "EXDATE;TZID=America/Santiago:20261111T090000"] }) });
  const p5 = await g("PATCH", "/events/patch00002", { cuerpo: { recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=3"] } });
  ok("los arreglos se reemplazan enteros (recurrence)", JSON.stringify(p5.json.recurrence) === JSON.stringify(["RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=3"]), p5.json.recurrence);
  const e0 = p4.json.etag;
  const m412 = await g("PATCH", "/events/patch00001", { cuerpo: { summary: "z" }, ifMatch: '"123"' });
  ok("If-Match distinto → 412 conditionNotMet (location If-Match)", m412.status === 412 && motivo(m412) === "conditionNotMet" && m412.json.error.errors[0].location === "If-Match" && sim.evento(calActual, "patch00001").summary === "otro", m412.json);
  const bien = await g("PATCH", "/events/patch00001", { cuerpo: { summary: "z" }, ifMatch: e0 });
  ok("If-Match igual → 200 y etag nuevo", bien.status === 200 && bien.json.etag !== e0);
  ok("If-Match: * siempre calza", (await g("PATCH", "/events/patch00001", { cuerpo: { summary: "w" }, ifMatch: "*" })).status === 200);
  const aDia = await g("PATCH", "/events/patch00001", { cuerpo: { start: { date: "2026-11-20" }, end: { date: "2026-11-21" } } });
  ok("pasar a día completo sin poner dateTime:null → 400 (PATCH mezcla start)", aDia.status === 400, aDia.json);
  const aDia2 = await g("PATCH", "/events/patch00001", { cuerpo: { start: { date: "2026-11-20", dateTime: null, timeZone: null }, end: { date: "2026-11-21", dateTime: null, timeZone: null } } });
  ok("…con dateTime:null y timeZone:null → 200 de día completo", aDia2.status === 200 && JSON.stringify(aDia2.json.start) === JSON.stringify({ date: "2026-11-20" }), aDia2.json.start);
  // instancias virtuales (serie infinita con un EXDATE)
  await g("POST", "/events", { cuerpo: semanal("patch00003", { recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE", "EXDATE;TZID=America/Santiago:20261111T090000"] }) });
  const metag = sim.evento(calActual, "patch00003").etag;
  const v412 = await g("PATCH", "/events/patch00003_20261118T120000Z", { cuerpo: { summary: "x" }, ifMatch: '"999"' });
  ok("instanciaIfMatch=acepta: PATCH de instancia virtual con If-Match ajeno → 412", v412.status === 412);
  const vok = await g("PATCH", "/events/patch00003_20261118T120000Z", { cuerpo: { location: "Piscina 2" }, ifMatch: metag });
  ok("…con el etag del principal (el de la instancia) → 200 y la materializa", vok.status === 200 && vok.json.id === "patch00003_20261118T120000Z" && vok.json.recurringEventId === "patch00003" && vok.json.location === "Piscina 2", vok.json);
  const lista = await g("GET", "/events");
  ok("la excepción materializada aparece en el listado (singleEvents=false)", ids(lista).includes("patch00003_20261118T120000Z"));
  await con({ instanciaIfMatch: "412" }, async () => {
    const a = await g("PATCH", "/events/patch00003_20261125T120000Z", { cuerpo: { summary: "x" }, ifMatch: sim.evento(calActual, "patch00003").etag });
    const b = await g("PATCH", "/events/patch00003_20261125T120000Z", { cuerpo: { summary: "x" } });
    ok("instanciaIfMatch=412: con If-Match → 412; sin If-Match → 200", a.status === 412 && b.status === 200, [a.status, b.status]);
  });
  await con({ instanciaIfMatch: "ignora" }, async () => {
    const a = await g("PATCH", "/events/patch00003_20261209T120000Z", { cuerpo: { summary: "x" }, ifMatch: '"ninguno"' });
    ok("instanciaIfMatch=ignora: If-Match ajeno igual pasa", a.status === 200, a.status);
  });
  const canc = await g("PATCH", "/events/patch00003_20261216T120000Z", { cuerpo: { status: "cancelled" } });
  const l2 = await g("GET", "/events");
  ok("PATCH status:cancelled sobre una instancia → excepción cancelada en el listado", canc.status === 200 && l2.json.items.find((x: any) => x.id === "patch00003_20261216T120000Z")?.status === "cancelled", canc.json);
  const fueraRegla = await g("PATCH", "/events/patch00003_20261111T120000Z", { cuerpo: { summary: "x" } });
  ok("PATCH de una instancia sacada por EXDATE → 404 (no se puede revivir así)", fueraRegla.status === 404, fueraRegla.json);
  // ajenas y bloqueadas
  const inv = sim.actor("invitación", calActual).crear({ id: "ajena00001", summary: "Cumple de la prima", start: hora("2026-11-22", "15:00"), end: hora("2026-11-22", "18:00") });
  const pa = await g("PATCH", `/events/${inv.id}`, { cuerpo: { summary: "otro" } });
  ok("invitación (organizer.self=false): cambiar summary → 403 forbiddenForNonOrganizer", pa.status === 403 && motivo(pa) === "forbiddenForNonOrganizer", pa.json);
  const pb = await g("PATCH", `/events/${inv.id}`, { cuerpo: { extendedProperties: { private: { cfh: "x" } } } });
  ok("…pero sus extendedProperties.private sí", pb.status === 200, pb.json);
  const pc = await g("PUT", `/events/${inv.id}`, { cuerpo: { summary: inv.summary, start: inv.start, end: inv.end } });
  ok("PUT de la invitación sin attendees (= valores por omisión) → 403 forbiddenForNonOrganizer", pc.status === 403 && motivo(pc) === "forbiddenForNonOrganizer", pc.json);
  sim.poner(calActual, { ...evento("bloque0001"), locked: true });
  const lk = await g("PATCH", "/events/bloque0001", { cuerpo: { summary: "x" } });
  const lk2 = await g("PATCH", "/events/bloque0001", { cuerpo: { colorId: "5" } });
  ok("locked: summary → 403; colorId → 200", lk.status === 403 && motivo(lk) === "forbiddenForNonOrganizer" && lk2.status === 200, [lk.json, lk2.status]);
  // PUT
  await g("POST", "/events", { cuerpo: evento("put0000001", { location: "Casa", description: "nota", extendedProperties: { private: { cfh: "1" } } }) });
  const etagPut = sim.evento(calActual, "put0000001").etag;
  const pu412 = await g("PUT", "/events/put0000001", { cuerpo: { summary: "s", start: hora("2026-11-20", "10:00"), end: hora("2026-11-20", "11:00") }, ifMatch: '"x"' });
  ok("PUT con If-Match distinto → 412", pu412.status === 412);
  const pu = await g("PUT", "/events/put0000001", { cuerpo: { summary: "s", start: hora("2026-11-20", "10:00"), end: hora("2026-11-20", "11:00") }, ifMatch: etagPut });
  ok("PUT reemplaza el recurso entero: location, description y extendedProperties desaparecen", pu.status === 200 && pu.json.summary === "s" && !("location" in pu.json) && !("description" in pu.json) && !("extendedProperties" in pu.json) && pu.json.iCalUID === "put0000001@google.com", pu.json);
  // rol reader
  sim.compartir(calActual, SA, "reader");
  for (const [m, ruta, cuerpo] of [["POST", "/events", evento("lector0001")], ["PATCH", "/events/put0000001", { summary: "x" }], ["PUT", "/events/put0000001", { summary: "x", start: hora("2026-11-20", "10:00"), end: hora("2026-11-20", "11:00") }], ["DELETE", "/events/put0000001", undefined]] as const) {
    const x = await g(m, ruta, { cuerpo });
    ok(`rol reader: ${m} → 403 requiredAccessLevel "You need to have writer access to this calendar."`, x.status === 403 && motivo(x) === "requiredAccessLevel" && mensaje(x) === "You need to have writer access to this calendar.", x.json);
  }
  sim.compartir(calActual, SA, "owner");
}

// ═══════════════ 11. Detalles según el rol ═══════════════
seccion("Detalles según el rol");
{
  nuevoCal();
  await g("POST", "/events", { cuerpo: evento("privado001", { summary: "Secreto", visibility: "private", location: "Casa" }) });
  await g("POST", "/events", { cuerpo: semanal("publico001", { recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=3"] }) });
  for (const [rol, ve] of [["reader", false], ["writerWithoutPrivateAccess", false], ["writer", true], ["owner", true]] as const) {
    sim.compartir(calActual, SA, rol);
    const l = await g("GET", "/events");
    const p = l.json.items.find((x: any) => x.id === "privado001");
    ok(`${rol}: el evento privado ${ve ? "con" : "sin"} detalles`, ve ? p.summary === "Secreto" && p.location === "Casa" : !("summary" in p) && !("location" in p) && !!p.start, p);
  }
  sim.compartir(calActual, SA, "freeBusyReader");
  const fb = await g("GET", "/events");
  ok("freeBusyReader: como singleEvents=true (instancias, sin principal) y sin detalles", fb.status === 200 && fb.json.accessRole === "freeBusyReader" && fb.json.items.length === 4 && fb.json.items.every((x: any) => !("summary" in x) && !("recurrence" in x)) && ids(fb).filter((x: string) => x.startsWith("publico001_")).length === 3, fb.json.items);
  sim.compartir(calActual, SA, "owner");
}

// ═══════════════ 12. Fallas inyectables ═══════════════
seccion("Fallas inyectables");
{
  nuevoCal();
  sim.inyectar(es.tipo("events.list"), respuestas.error("authError"));
  const a = await g("GET", "/events");
  const b = await g("GET", "/events");
  ok("401 una vez: el primer listado 401 authError, el segundo 200", a.status === 401 && motivo(a) === "authError" && b.status === 200, [a.status, b.status]);
  const casos: [string, number, string, string?][] = [
    ["rateLimitExceeded", 403, "rateLimitExceeded", "usageLimits"],
    ["userRateLimitExceeded", 403, "userRateLimitExceeded", "usageLimits"],
    ["quotaExceeded", 403, "quotaExceeded", "usageLimits"],
    ["dailyLimitExceeded", 403, "dailyLimitExceeded", "usageLimits"],
    ["accessNotConfigured", 403, "accessNotConfigured", "usageLimits"],
    ["SERVICE_DISABLED", 403, "forbidden", "global"],
    ["requiredAccessLevel", 403, "requiredAccessLevel", "calendar"],
    ["forbiddenForNonOrganizer", 403, "forbiddenForNonOrganizer", "calendar"],
    ["forbiddenForServiceAccounts", 403, "forbiddenForServiceAccounts", "calendar"],
    ["desconocido", 403, "motivoQueNadieConoce", "calendar"],
    ["rateLimit429", 429, "rateLimitExceeded", "usageLimits"],
    ["backendError", 500, "backendError"],
    ["unavailable", 503, "backendError"],
  ];
  for (const [tipo, status, reason, domain] of casos) {
    sim.inyectar(es.tipo("events.patch"), respuestas.error(tipo));
    const x = await g("PATCH", "/events/cualquiera1", { cuerpo: {} });
    ok(`inyectar ${tipo} → ${status} ${reason}${domain ? " (" + domain + ")" : ""}`, x.status === status && motivo(x) === reason && (!domain || x.json.error.errors[0].domain === domain), x.json);
  }
  sim.inyectar(es.todo(), respuestas.error("accessNotConfigured"));
  const anc = await g("GET", "/events");
  ok("accessNotConfigured trae details SERVICE_DISABLED (y domain usageLimits)", anc.json.error.details?.[0]?.reason === "SERVICE_DISABLED" && anc.json.error.errors[0].domain === "usageLimits");
  sim.inyectar(es.todo(), respuestas.error("SERVICE_DISABLED"));
  const sd = await g("GET", "/events");
  ok("variante SERVICE_DISABLED solo en details (motivo genérico en errors[])", sd.json.error.details?.[0]?.reason === "SERVICE_DISABLED" && sd.json.error.errors[0].reason === "forbidden");
  sim.inyectar(es.tipo("events.patch"), respuestas.status(503));
  const listar = await g("GET", "/events");
  ok("el predicado elige: un GET no se ve afectado por una falla de PATCH", listar.status === 200);
  sim.limpiarInyecciones();
  const dos = sim.inyectar(es.tipo("events.list"), respuestas.status(500), 2);
  const st = [await g("GET", "/events"), await g("GET", "/events"), await g("GET", "/events")].map((x) => x.status);
  ok("veces=2: dos fallas y después normal; disparos=2", st.join() === "500,500,200" && dos.disparos === 2, st);
  // demora que respeta el signal
  const antes = sim.contadores.escrituras;
  sim.inyectar(es.tipo("events.insert"), respuestas.demora(1500));
  const t0 = Date.now();
  let corto = false;
  try {
    await g("POST", "/events", { cuerpo: evento("demora0001"), signal: AbortSignal.timeout(200) });
  } catch {
    corto = true;
  }
  const dt = Date.now() - t0;
  await new Promise((r) => setTimeout(r, 1500));
  ok("demora: el cliente corta a los 200 ms (no espera 1,5 s) y el insert NO se aplica", corto && dt < 900 && sim.evento(calActual, "demora0001") === null && sim.contadores.escrituras === antes, [corto, dt, sim.evento(calActual, "demora0001")?.id]);
  sim.inyectar(es.tipo("events.insert"), respuestas.demora(300));
  const t1 = Date.now();
  const lento = await g("POST", "/events", { cuerpo: evento("demora0002") });
  ok("demora sin corte: responde después y se aplica", lento.status === 200 && Date.now() - t1 >= 290 && sim.evento(calActual, "demora0002") !== null);
  sim.inyectar(es.tipo("events.insert"), respuestas.aplicarYLuego(respuestas.error("unavailable")));
  const ay = await g("POST", "/events", { cuerpo: evento("aplica0001") });
  ok("aplicarYLuego(503): responde 503 pero el evento quedó creado", ay.status === 503 && sim.evento(calActual, "aplica0001")?.status === "confirmed", ay.status);
  ok("…y el insert siguiente con ese id → 409 (lo que ve el transporte al reintentar)", (await g("POST", "/events", { cuerpo: evento("aplica0001") })).status === 409);
  sim.inyectar(es.tipo("events.patch"), respuestas.aplicarYCortar());
  let cortado = false;
  try {
    await g("PATCH", "/events/aplica0001", { cuerpo: { summary: "aplicado" } });
  } catch {
    cortado = true;
  }
  ok("aplicarYCortar: el cliente ve la conexión cortada pero el PATCH se aplicó", cortado && sim.evento(calActual, "aplica0001").summary === "aplicado");
  sim.inyectar(es.tipo("events.insert"), respuestas.cortar());
  let cortado2 = false;
  try {
    await g("POST", "/events", { cuerpo: evento("corta00001") });
  } catch {
    cortado2 = true;
  }
  ok("cortar: conexión cortada y nada aplicado", cortado2 && sim.evento(calActual, "corta00001") === null);
  sim.latenciaMs = 150;
  const t2 = Date.now();
  await g("GET", "/events");
  ok("latenciaMs demora cada pedido", Date.now() - t2 >= 145);
  sim.latenciaMs = 0;
}

// ═══════════════ 13. Interruptores (lo no documentado) ═══════════════
seccion("Interruptores");
{
  const esperados: Partial<Interruptores> = {
    lapidaOcupaId: true,
    finIgualInicio: "ok",
    endTimeUnspecifiedAceptado: true,
    exdateAExcepcionCancelada: false,
    propagarTituloAExcepciones: false,
    cambioReglaExcepciones: "conservar",
    untilIgnoradoTrasDivision: false,
    normalizar: false,
    fantasmasAlLeer: false,
    instanciaIfMatch: "acepta",
    extendedPropsSeConservan: true,
  };
  ok("valores por omisión de PRUEBAS-google.md §B", Object.entries(esperados).every(([k, v]) => (INTERRUPTORES_POR_OMISION as any)[k] === v && (sim.interruptores as any)[k] === v), sim.interruptores);
  nuevoCal();
  await con({ normalizar: true }, async () => {
    const r = await g("POST", "/events", { cuerpo: semanal("normal0001", { recurrence: ["RRULE:BYDAY=WE;WKST=MO;FREQ=WEEKLY", "EXDATE;TZID=America/Santiago:20261111T090000,20261118T090000"] }) });
    ok("normalizar: RRULE reordenada sin WKST=MO y EXDATE TZID → UTC uno por línea", JSON.stringify(r.json.recurrence) === JSON.stringify(["RRULE:FREQ=WEEKLY;BYDAY=WE", "EXDATE:20261111T120000Z", "EXDATE:20261118T120000Z"]), r.json.recurrence);
  });
  const sinN = await g("POST", "/events", { cuerpo: semanal("normal0002", { recurrence: ["RRULE:BYDAY=WE;WKST=MO;FREQ=WEEKLY"] }) });
  ok("sin normalizar: recurrence tal cual", JSON.stringify(sinN.json.recurrence) === JSON.stringify(["RRULE:BYDAY=WE;WKST=MO;FREQ=WEEKLY"]), sinN.json.recurrence);
  await con({ exdateAExcepcionCancelada: true }, async () => {
    const r = await g("POST", "/events", { cuerpo: semanal("ocultar001", { recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE", "EXDATE;TZID=America/Santiago:20261111T090000"] }) });
    const l = await g("GET", "/events");
    ok("exdateAExcepcionCancelada: el EXDATE sale de recurrence y queda una excepción cancelada", JSON.stringify(r.json.recurrence) === JSON.stringify(["RRULE:FREQ=WEEKLY;BYDAY=WE"]) && l.json.items.find((x: any) => x.id === "ocultar001_20261111T120000Z")?.status === "cancelled", [r.json.recurrence, ids(l)]);
    const i = await g("GET", "/events/ocultar001/instances", { query: { timeMax: "2026-11-30T00:00:00Z" } });
    ok("…y la instancia sigue oculta", !ids(i).includes("ocultar001_20261111T120000Z") && i.json.items.length === 3, ids(i));
  });
  for (const propagar of [false, true]) {
    await con({ propagarTituloAExcepciones: propagar }, async () => {
      const id = propagar ? "titulo0002" : "titulo0001";
      await g("POST", "/events", { cuerpo: semanal(id) });
      await g("PATCH", `/events/${id}_20261111T120000Z`, { cuerpo: { location: "Piscina 2" } });
      await g("PATCH", `/events/${id}_20261118T120000Z`, { cuerpo: { summary: "Otro título" } });
      await g("PATCH", `/events/${id}`, { cuerpo: { summary: "Natación y clavados" } });
      const a = sim.evento(calActual, `${id}_20261111T120000Z`);
      const b = sim.evento(calActual, `${id}_20261118T120000Z`);
      ok(`propagarTituloAExcepciones=${propagar}: ${propagar ? "la excepción con el título viejo lo toma" : "las excepciones no cambian"}; la de título propio nunca`, (propagar ? a.summary === "Natación y clavados" : a.summary === "🦄 Natación") && b.summary === "Otro título", [a.summary, b.summary]);
    });
  }
  for (const modo of ["conservar", "borrar"] as const) {
    await con({ cambioReglaExcepciones: modo }, async () => {
      const id = modo === "conservar" ? "cambreg001" : "cambreg002";
      await g("POST", "/events", { cuerpo: semanal(id) });
      await g("PATCH", `/events/${id}_20261118T120000Z`, { cuerpo: { location: "Piscina 2" } });
      await g("PATCH", `/events/${id}`, { cuerpo: { start: hora("2026-11-05", "09:00"), end: hora("2026-11-05", "10:00"), recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TH"] } });
      const queda = sim.evento(calActual, `${id}_20261118T120000Z`);
      ok(`cambioReglaExcepciones=${modo}: la excepción que la regla nueva ya no genera ${modo === "conservar" ? "se conserva" : "se borra"}`, modo === "conservar" ? queda?.location === "Piscina 2" : queda === null, queda);
    });
  }
  for (const ignorar of [false, true]) {
    await con({ untilIgnoradoTrasDivision: ignorar }, async () => {
      const id = ignorar ? "divid00002" : "divid00001";
      await g("POST", "/events", { cuerpo: semanal(id) });
      sim.actor("web", calActual).esteYLosSiguientes(id, "2026-11-25", { summary: "Natación nueva" });
      const antes = sim.evento(calActual, id).recurrence;
      const r = await g("PATCH", `/events/${id}`, { cuerpo: { recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261231T030000Z"] } });
      const despues = sim.evento(calActual, id).recurrence;
      ok(`untilIgnoradoTrasDivision=${ignorar}: PATCH 200 y la regla ${ignorar ? "NO cambia" : "cambia"}`, r.status === 200 && (ignorar ? JSON.stringify(despues) === JSON.stringify(antes) : despues[0].includes("UNTIL=20261231T030000Z")), [antes, despues]);
    });
  }
  await con({ fantasmasAlLeer: true, probFantasma: 1 }, async () => {
    nuevoCal();
    await g("POST", "/events", { cuerpo: semanal("fantas0001") });
    const l1 = await g("GET", "/events");
    const f = l1.json.items.filter((x: any) => x.recurringEventId === "fantas0001");
    const m = sim.evento(calActual, "fantas0001");
    ok("fantasmasAlLeer: aparece una excepción idéntica a su instancia (mismo summary, misma hora original)", f.length === 1 && f[0].summary === m.summary && f[0].start.dateTime === f[0].originalStartTime.dateTime && f[0].status === "confirmed", f);
  });
  // los que se prueban en otras secciones: lapidaOcupaId, finIgualInicio, endTimeUnspecifiedAceptado, instanciaIfMatch (7, 10), extendedPropsSeConservan (14)
}

// ═══════════════ 14. Actores ═══════════════
seccion("Actores");
{
  nuevoCal();
  const web = sim.actor("web", calActual);
  const s = web.crear(semanal("navega0001", { extendedProperties: { private: { cfh: "h1" } } }));
  ok("web.crear: organizer self y creator = dueña", s.organizer.self === true && s.creator.email === DUENA, s);
  const bd = web.borrarDia(s.id, "2026-11-18");
  ok("web.borrarDia: excepción cancelada <id>_<UTC>Z y SIN EXDATE en el principal", bd.id === "navega0001_20261118T120000Z" && bd.status === "cancelled" && !sim.evento(calActual, s.id).recurrence.some((l: string) => l.startsWith("EXDATE")), [bd, sim.evento(calActual, s.id).recurrence]);
  const l = await g("GET", "/events");
  ok("…y events.list la trae como cancelada", l.json.items.find((x: any) => x.id === bd.id)?.status === "cancelled");
  const ed = web.editar(s.id, { description: "Traer toalla\ny gorro <azul> & lentes" });
  ok("web: la descripción queda en HTML", ed.description === "Traer toalla<br>y gorro &lt;azul&gt; &amp; lentes", ed.description);
  const md = web.moverDia(s.id, "2026-11-11", hora("2026-11-11", "10:00"), hora("2026-11-11", "11:00"));
  ok("web.moverDia: excepción viva con la hora nueva y la original intacta", md.status === "confirmed" && md.start.dateTime === "2026-11-11T10:00:00-03:00" && md.originalStartTime.dateTime === "2026-11-11T09:00:00-03:00");
  const nueva = web.esteYLosSiguientes(s.id, "2026-11-25", { summary: "Natación (horario nuevo)" });
  const orig = sim.evento(calActual, s.id);
  ok("web.esteYLosSiguientes: serie nueva <id>_R<inicio UTC> con iCalUID nuevo", nueva.id === "navega0001_R20261125T120000" && nueva.iCalUID === "navega0001_R20261125T120000@google.com" && nueva.iCalUID !== orig.iCalUID && nueva.summary === "Natación (horario nuevo)" && nueva.start.dateTime === "2026-11-25T09:00:00-03:00", nueva);
  ok("…y la original queda con UNTIL (fin del día anterior en Santiago, en UTC)", orig.recurrence[0] === "RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261125T025959Z", orig.recurrence);
  const io = sim.instancias(calActual, s.id);
  ok("…la original ya no genera días desde el 25-nov", io.every((x) => x.start.dateTime < "2026-11-25") && io.length === 2, io.map((x) => x.start.dateTime));
  web.borrar(nueva.id);
  ok("web.borrar deja lápida", sim.evento(calActual, nueva.id).status === "cancelled");
  web.restaurar(nueva.id);
  const re = await g("GET", "/events");
  ok("web.restaurar: la lápida vuelve a estar viva y se lista", sim.evento(calActual, nueva.id).status === "confirmed" && ids(re).includes(nueva.id));

  const iphone = sim.actor("iPhone", calActual);
  const ip = iphone.crear(semanal("iphone0001", { summary: "Inglés", extendedProperties: { private: { cfh: "h2" } } }));
  ok("iPhone.crear: iCalUID tipo UUID (no @google.com)", /^[0-9A-F-]{36}$/.test(ip.iCalUID), ip.iCalUID);
  iphone.borrarDia(ip.id, "2026-11-11");
  iphone.borrarDia(ip.id, "2026-11-25");
  const rec = sim.evento(calActual, ip.id).recurrence;
  ok("iPhone.borrarDia: EXDATE;TZID=America/Santiago con varios valores en una línea", JSON.stringify(rec) === JSON.stringify(["RRULE:FREQ=WEEKLY;BYDAY=WE", "EXDATE;TZID=America/Santiago:20261111T090000,20261125T090000"]), rec);
  const ii = await g("GET", `/events/${ip.id}/instances`, { query: { timeMax: "2026-12-01T00:00:00Z" } });
  ok("…y las dos instancias quedan fuera", ii.json.items.length === 2 && !ids(ii).includes(`${ip.id}_20261111T120000Z`) && !ids(ii).includes(`${ip.id}_20261125T120000Z`), ids(ii));
  ok("iPhone con extendedPropsSeConservan=true: conserva extendedProperties", sim.evento(calActual, ip.id).extendedProperties?.private?.cfh === "h2");
  await con({ extendedPropsSeConservan: false }, async () => {
    iphone.editarTitulo(ip.id, "Inglés avanzado");
    const e = sim.evento(calActual, ip.id);
    ok("iPhone.editarTitulo con extendedPropsSeConservan=false: cambia el summary y se pierden las extendedProperties", e.summary === "Inglés avanzado" && !("extendedProperties" in e), e);
  });
  const inv = sim.actor("invitación", calActual).crear({ summary: "Asado", start: hora("2026-11-28", "13:00"), end: hora("2026-11-28", "17:00") }, "tia.rosa@gmail.com");
  ok("invitación: organizer.self=false con el correo de otra persona, y attendees", inv.organizer.self === false && inv.organizer.email === "tia.rosa@gmail.com" && inv.attendees.some((a: any) => a.self && a.email === calActual), inv);
  const cu = sim.actor("cumpleaños", calActual).crear({ summary: "Cumpleaños de Sofía", fecha: "2026-12-03" });
  ok("cumpleaños: eventType birthday, día completo, RRULE:FREQ=YEARLY", cu.eventType === "birthday" && cu.start.date === "2026-12-03" && cu.recurrence[0] === "RRULE:FREQ=YEARLY", cu);
  const def = await g("GET", "/events", { query: { eventTypes: "default" } });
  const tod = await g("GET", "/events");
  ok("eventTypes=default lo deja fuera; sin filtro, events.list lo trae", !ids(def).includes(cu.id) && ids(tod).includes(cu.id));
}

// ═══════════════ 15. ACL ═══════════════
seccion("ACL");
{
  nuevoCal();
  const l = await g("GET", "/acl");
  const reglas = Object.fromEntries(l.json.items.map((x: any) => [x.id, x.role]));
  ok("acl.list (owner): kind calendar#acl, la dueña y la cuenta de servicio como owner, nextSyncToken", l.status === 200 && l.json.kind === "calendar#acl" && reglas[`user:${DUENA}`] === "owner" && reglas[`user:${SA}`] === "owner" && !!l.json.nextSyncToken, l.json);
  const ins = await g("POST", "/acl", { cuerpo: { role: "writer", scope: { type: "user", value: PAPA } } });
  ok("acl.insert → 200 con id user:<correo>", ins.status === 200 && ins.json.id === `user:${PAPA}` && ins.json.role === "writer" && ins.json.kind === "calendar#aclRule" && /^"/.test(ins.json.etag), ins.json);
  ok("…registra sendNotifications (por omisión true)", JSON.stringify(sim.notificaciones.at(-1)) === JSON.stringify({ metodo: "insert", calId: calActual, regla: `user:${PAPA}`, correo: PAPA, rol: "writer", enviada: true }), sim.notificaciones.at(-1));
  const dup = await g("POST", "/acl", { cuerpo: { role: "reader", scope: { type: "user", value: PAPA } } });
  ok("acl.insert de una regla que ya existe → 409 (aclInsertExistente=409)", dup.status === 409 && motivo(dup) === "duplicate");
  await con({ aclInsertExistente: "actualiza" }, async () => {
    const x = await g("POST", "/acl", { cuerpo: { role: "reader", scope: { type: "user", value: PAPA } }, query: { sendNotifications: "false" } });
    ok("…con aclInsertExistente=actualiza → 200 y cambia el rol; sendNotifications=false se registra", x.status === 200 && x.json.role === "reader" && sim.notificaciones.at(-1)?.enviada === false, x.json);
  });
  const tokPapa = sim.tokenPara(PAPA, AL("calendar"));
  const papa = cliente(sim, tokPapa, () => calActual);
  ok("el rol de la ACL define el accessRole de events.list (papá: reader)", (await papa("GET", "/events")).json.accessRole === "reader");
  const ruta = `/acl/${encodeURIComponent(`user:${PAPA}`)}`;
  const pa = await g("PATCH", ruta, { cuerpo: { role: "writer" } });
  ok("acl.patch → 200 role writer, y papá ve accessRole writer", pa.status === 200 && pa.json.role === "writer" && (await papa("GET", "/events")).json.accessRole === "writer" && sim.notificaciones.at(-1)?.metodo === "patch", pa.json);
  const ge = await g("GET", ruta);
  ok("acl.get de user:<correo> codificado", ge.status === 200 && ge.json.role === "writer" && ge.json.scope.value === PAPA);
  const up = await g("PUT", ruta, { cuerpo: { role: "reader", scope: { type: "user", value: PAPA } } });
  ok("acl.update → 200 role reader; papá no puede escribir eventos (403 requiredAccessLevel)", up.status === 200 && up.json.role === "reader" && motivo(await papa("POST", "/events", { cuerpo: evento("papa000001") })) === "requiredAccessLevel");
  const cambioScope = await g("PUT", ruta, { cuerpo: { role: "reader", scope: { type: "user", value: "otro@gmail.com" } } });
  ok("acl.update no puede cambiar el scope → 400", cambioScope.status === 400);
  const de = await g("DELETE", ruta);
  ok("acl.delete → 204; get → 404; list sin showDeleted no la trae; papá → 404", de.status === 204 && (await g("GET", ruta)).status === 404 && !ids(await g("GET", "/acl")).includes(`user:${PAPA}`) && (await papa("GET", "/events")).status === 404);
  const sd = await g("GET", "/acl", { query: { showDeleted: "true" } });
  ok("con showDeleted la regla borrada aparece con role none", sd.json.items.find((x: any) => x.id === `user:${PAPA}`)?.role === "none");
  ok("acl.delete de algo que no existe → 404", (await g("DELETE", `/acl/${encodeURIComponent("user:nadie@gmail.com")}`)).status === 404);
  const dueno = await g("PATCH", `/acl/${encodeURIComponent(`user:${DUENA}`)}`, { cuerpo: { role: "reader" } });
  const duenoDel = await g("DELETE", `/acl/${encodeURIComponent(`user:${DUENA}`)}`);
  ok("la regla de la dueña de los datos no se cambia ni se borra → 403", dueno.status === 403 && duenoDel.status === 403 && sim.rolDe(calActual, DUENA) === "owner", [dueno.json, duenoDel.json]);
  const propia = await g("DELETE", `/acl/${encodeURIComponent(`user:${SA}`)}`);
  ok("la cuenta de servicio no puede cambiar su propia regla → 403 cannotChangeOwnAcl", propia.status === 403 && motivo(propia) === "cannotChangeOwnAcl", propia.json);
  ok("scope.value que no es correo → 400", (await g("POST", "/acl", { cuerpo: { role: "reader", scope: { type: "user", value: "no-es-correo" } } })).status === 400);
  ok("role inexistente → 400", (await g("POST", "/acl", { cuerpo: { role: "jefe", scope: { type: "user", value: "a@b.cl" } } })).status === 400);
  for (const c of ["x1@gmail.com", "x2@gmail.com", "x3@gmail.com"]) await g("POST", "/acl", { cuerpo: { role: "reader", scope: { type: "user", value: c } } });
  const pags = await todasLasPaginas("/acl", { maxResults: "1" });
  ok("acl.list paginado (maxResults=1): una regla por página y todas al final", pags.length === 5 && pags.slice(0, -1).every((p) => p.json.items.length === 1 && p.json.nextPageToken) && pags.flatMap((p) => ids(p)).length === 5, pags.map((p) => ids(p)));
  // cuenta de servicio sin owner
  sim.compartir(calActual, SA, "writer");
  const lw = await g("GET", "/acl");
  ok("writer PUEDE leer la ACL (documentado: «This role can also see ACLs»)", lw.status === 200, lw.json);
  const iw = await g("POST", "/acl", { cuerpo: { role: "reader", scope: { type: "user", value: "y@gmail.com" } } });
  ok("writer no puede escribir la ACL → 403 forbidden", iw.status === 403 && motivo(iw) === "forbidden", iw.json);
  await con({ aclLecturaSoloOwner: true, motivoAclSinOwner: "requiredAccessLevel" }, async () => {
    const x = await g("GET", "/acl");
    ok("aclLecturaSoloOwner=true: writer tampoco lee la ACL (403, motivo configurable)", x.status === 403 && motivo(x) === "requiredAccessLevel", x.json);
  });
  sim.compartir(calActual, SA, "reader");
  ok("reader no lee la ACL → 403", (await g("GET", "/acl")).status === 403);
  sim.compartir(calActual, SA, "owner");
  sim.quitar(calActual, SA);
  ok("quitar el acceso a la cuenta de servicio → 404 en eventos y en ACL", (await g("GET", "/events")).status === 404 && (await g("GET", "/acl")).status === 404);
}

// ═══════════════ 16. Formas que usa el transporte (plan 1.6) y casos raros ═══════════════
seccion("Formas del transporte y casos raros");
{
  nuevoCal();
  const ins = await g("POST", "/events", { cuerpo: evento("trans00001"), query: { fields: "id,etag" } });
  ok("insert ?fields=id,etag → solo id y etag (y la cabecera ETag)", ins.status === 200 && Object.keys(ins.json).sort().join() === "etag,id" && ins.cab.get("etag") === ins.json.etag, ins.json);
  await g("DELETE", "/events/trans00001");
  const gs = await g("GET", "/events/trans00001", { query: { fields: "id,status" } });
  ok("get ?fields=id,status de una lápida → {id, status: cancelled} (lo que mira crear tras un 409)", JSON.stringify(gs.json) === JSON.stringify({ id: "trans00001", status: "cancelled" }), gs.json);
  const cal = await g("GET", "/events", { query: { maxResults: "1", fields: "accessRole,summary,timeZone" } });
  ok("calendario(): events?maxResults=1&fields=accessRole,summary,timeZone", JSON.stringify(cal.json) === JSON.stringify({ summary: "Familia", timeZone: ZS, accessRole: "owner" }), cal.json);
  // excepción sin principal (invitación a una sola instancia de una serie ajena)
  sim.poner(calActual, { id: "ajenaserie_20261120T130000Z", summary: "Reunión de apoderados", recurringEventId: "ajenaserie", originalStartTime: hora("2026-11-20", "10:00"), start: hora("2026-11-20", "10:00"), end: hora("2026-11-20", "11:00"), organizer: { email: "profe@colegio.cl" } });
  const sf = await g("GET", "/events");
  const se = await g("GET", "/events", { query: { singleEvents: "true", timeMin: "2026-11-01T00:00:00Z", timeMax: "2026-12-01T00:00:00Z" } });
  ok("excepción sin principal en el calendario: se lista con singleEvents=false y =true", ids(sf).includes("ajenaserie_20261120T130000Z") && ids(se).includes("ajenaserie_20261120T130000Z"), [ids(sf), ids(se)]);
  // ACL: el id de la regla no distingue mayúsculas
  await g("POST", "/acl", { cuerpo: { role: "reader", scope: { type: "user", value: "Tia.Rosa@Gmail.com" } } });
  const gm = await g("GET", `/acl/${encodeURIComponent("user:Tia.Rosa@gmail.com")}`);
  ok("acl: la regla se guarda en minúsculas y se encuentra sin distinguir mayúsculas", gm.status === 200 && gm.json.id === "user:tia.rosa@gmail.com" && gm.json.scope.value === "tia.rosa@gmail.com", gm.json);
  // BYSETPOS (RFC 5545; ical.js solo no lo hace bien)
  const casos: [string, string, string, string][] = [
    ["2026-01-05", "RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=1;COUNT=4", "2026-02-02,2026-03-02,2026-04-01,2026-05-01", "primer día hábil (el de enero cae antes del inicio)"],
    ["2026-01-30", "RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;COUNT=4", "2026-01-30,2026-02-27,2026-03-31,2026-04-30", "último día hábil"],
    ["2026-11-04", "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;BYSETPOS=-1;COUNT=3", "2026-11-06,2026-11-13,2026-11-20", "semanal, el último de la semana"],
    ["2028-02-29", "RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=28,29;BYSETPOS=-1;COUNT=5", "2028-02-29,2029-02-28,2030-02-28,2031-02-28,2032-02-29", "anual del 29 de febrero (como lo escribe el panel)"],
  ];
  let n = 0;
  for (const [f, regla, esperado, que] of casos) {
    const id = `setpos000${++n}`;
    await g("POST", "/events", { cuerpo: { id, summary: que, start: hora(f, "10:00"), end: hora(f, "11:00"), recurrence: [regla] } });
    const r = await g("GET", `/events/${id}/instances`, { query: { timeMax: "2033-01-01T00:00:00Z" } });
    const dias = r.json.items.map((x: any) => x.start.dateTime.slice(0, 10)).join();
    ok(`BYSETPOS: ${que}`, dias === esperado, [regla, dias]);
  }
  ok("BYSETPOS: el id de una instancia elegida se resuelve; uno descartado no", (await g("GET", "/events/setpos0004_20290228T130000Z")).status === 200 && (await g("GET", "/events/setpos0004_20280228T130000Z")).status === 404);
}

// ═══════════════ 17. Contadores y varios ═══════════════
seccion("Contadores y varios");
{
  nuevoCal();
  sim.reiniciarContadores();
  await g("GET", "/events");
  await g("POST", "/events", { cuerpo: evento("conta00001") });
  await g("PATCH", "/events/conta00001", { cuerpo: { summary: "x" } });
  await g("GET", "/events/nadanadanada");
  ok("contadores: api, porTipo, escrituras (solo las aplicadas) y status", sim.contadores.api === 4 && sim.contadores.porTipo["events.list"] === 1 && sim.contadores.porTipo["events.insert"] === 1 && sim.contadores.porTipo["events.patch"] === 1 && sim.contadores.escrituras === 2 && sim.contadores.status["404"] === 1, sim.contadores);
  ok("registro: un renglón por pedido con su status", sim.registro.length === 4 && sim.registro[3].status === 404 && sim.registro[0].tipo === "events.list");
  sim.reiniciarContadores();
  sim.actor("web", calActual).crear(evento("actor00001"));
  sim.eventos(calActual);
  ok("los actores y las vistas crudas no cuentan como pedidos", sim.contadores.api === 0);
  const crudo = sim.eventos(calActual);
  crudo[0].summary = "mutado";
  ok("sim.eventos() entrega copias", sim.evento(calActual, crudo[0].id).summary !== "mutado");
  const rz = await fetch(`${sim.apiUrl}calendars/${encodeURIComponent(calActual)}/events`, { headers: { authorization: `Bearer ${tokSA}`, "accept-encoding": "gzip" } });
  ok("respuestas comprimidas con gzip si el cliente lo acepta (fetch las descomprime)", rz.headers.get("content-encoding") === "gzip" && (await rz.json()).kind === "calendar#events");
  const n404 = await fetch(`${sim.url}otra/cosa`);
  ok("rutas desconocidas → 404 JSON", n404.status === 404);
}

await sim.cerrar();
console.log(`\n${buenas} OK, ${malas} MAL`);
process.exitCode = malas ? 1 : 0;
