// Pruebas de servidor/google/compartir.ts (addendum: el calendario es del Gmail de un adulto y el panel
// invita a otros como editor o solo lectura por la ACL), contra el simulador. Sin red.
//
//   cd calendario && node --experimental-transform-types --no-warnings --import ./pruebas/registrar.mjs pruebas/google/compartir.test.ts
import { iniciarSimulador, respuestas, es, type PedidoVisto, type Rol } from "./mock-google.mts";
import { clavePrueba } from "./clave-prueba.ts";
import { ErrorCalDAV } from "../../servidor/caldav";
import { leerCuentaServicio } from "../../servidor/google/cuenta";
import { GoogleCalendar, baseApiGoogle } from "../../servidor/google/transporte";
import {
  MAX_PERSONAS,
  NoSePuedeCompartir,
  cambiarPermiso,
  esLimiteDeUso,
  invitar,
  normalizarCorreo,
  permisoDeRol,
  permisos,
  puedeInvitar,
  quitar,
  sinReintento,
  textoSinReintento,
} from "../../servidor/google/compartir";

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
async function intentar<T>(p: Promise<T>): Promise<{ valor?: T; error?: unknown }> {
  try {
    return { valor: await p };
  } catch (e) {
    return { error: e };
  }
}
const codigo = (r: { error?: unknown }) =>
  r.error instanceof NoSePuedeCompartir ? r.error.codigo : r.error instanceof ErrorCalDAV ? r.error.codigo : r.error ? `otro: ${String(r.error)}` : "sin error";

// ---------- Simulador ----------
const clave = clavePrueba();
const SA = clave.correo;
const DUENA = "mama@gmail.com";
const PAPA = "papa@gmail.com";
const sim = await iniciarSimulador({ cuentas: new Map([[SA, clave.publica]]), semilla: 5 });
process.env.GOOGLE_API_URL = sim.apiUrl;
process.env.GOOGLE_TOKEN_URL = sim.tokenUrl;
const leida = leerCuentaServicio(clave.json);
if (!("cuenta" in leida)) throw new Error(leida.problema);
const g = () => new GoogleCalendar(leida.cuenta, baseApiGoogle(), 8000, Date.now() + 20_000);
let n = 0;
function nuevoCal(rol: Rol = "owner") {
  const id = `c_comp${++n}@group.calendar.google.com`;
  sim.crearCalendario(id, { zona: "America/Santiago", resumen: "Familia", dueno: DUENA });
  sim.compartir(id, SA, rol);
  return id;
}
const ctx = { dueno: DUENA, personas: 0 };
const rolDe = (cal: string, correo: string) => sim.acl(cal).find((x) => x.id === `user:${correo}`)?.role ?? "none";

// Todo lo que el panel escribe en la ACL (para revisar que nunca da owner).
const escritosAcl: { tipo: string; cuerpo: unknown; query: string }[] = [];
sim.inyectar(
  (p: PedidoVisto) => {
    if (p.tipo.startsWith("acl.") && p.metodo !== "GET") escritosAcl.push({ tipo: p.tipo, cuerpo: p.cuerpo, query: p.query.toString() });
    return false;
  },
  respuestas.status(500),
  Infinity,
);

// =====================================================================================
seccion("Correos y guardas");
await caso("normalizarCorreo y permisoDeRol", async () => {
  ok("minúsculas y sin espacios", normalizarCorreo("  Tia.Rosa@Gmail.COM ") === "tia.rosa@gmail.com");
  ok("inválidos → null", ["", "sin-arroba", "a@b", "a b@c.cl", "<a@b.cl>", "a@b.cl (yo)", 42, null, `${"x".repeat(250)}@b.cl`].every((x) => normalizarCorreo(x) === null));
  ok("permisoDeRol", permisoDeRol("writer") === "editor" && permisoDeRol("reader") === "lectura" && permisoDeRol("owner") === null && permisoDeRol("freeBusyReader") === null);
});

await caso("guardas antes de pedir nada", async () => {
  const cal = nuevoCal();
  sim.reiniciarContadores();
  const casos: [string, () => Promise<unknown>, string][] = [
    ["correo inválido", () => invitar(g(), cal, "no-es-correo", "editor", ctx), "CORREO_INVALIDO"],
    ["el correo del panel", () => invitar(g(), cal, SA.toUpperCase(), "editor", ctx), "ES_PANEL"],
    ["el Gmail del dueño", () => invitar(g(), cal, " MAMA@gmail.com", "lectura", ctx), "ES_DUENO"],
    ["el Gmail del dueño con puntos y +algo", () => invitar(g(), cal, "ma.ma+panel@gmail.com", "lectura", ctx), "ES_DUENO"],
    ["permiso owner", () => invitar(g(), cal, PAPA, "owner", ctx), "PERMISO_INVALIDO"],
    ["permiso inventado", () => cambiarPermiso(g(), cal, PAPA, "jefe", ctx), "PERMISO_INVALIDO"],
    [`más de ${MAX_PERSONAS} personas`, () => invitar(g(), cal, PAPA, "editor", { dueno: DUENA, personas: MAX_PERSONAS }), "MAXIMO"],
    ["quitar al dueño", () => quitar(g(), cal, DUENA, ctx), "ES_DUENO"],
    ["quitar al panel", () => quitar(g(), cal, SA, ctx), "ES_PANEL"],
    ["cambiar el permiso del dueño", () => cambiarPermiso(g(), cal, DUENA, "lectura", ctx), "ES_DUENO"],
  ];
  for (const [que, fn, esperado] of casos) {
    const r = await intentar(fn());
    ok(`${que} → NoSePuedeCompartir ${esperado}`, codigo(r) === esperado, [codigo(r), (r.error as Error)?.message]);
  }
  ok("…ninguna guarda hizo pedidos a Google", sim.contadores.api === 0, sim.contadores);
  ok("…y la regla del dueño sigue como owner", rolDe(cal, DUENA) === "owner");
});

// =====================================================================================
seccion("permisos");
await caso("permisos según el rol del panel", async () => {
  const cal = nuevoCal("owner");
  await invitar(g(), cal, PAPA, "editor", ctx);
  const p = await permisos(g(), cal);
  ok("owner: puede invitar; reglas de usuario sin la del panel (con la del dueño)", p.puede && JSON.stringify(p.reglas) === JSON.stringify([{ correo: DUENA, rol: "owner" }, { correo: PAPA, rol: "writer" }]), p);
  ok("puedeInvitar (accessRole owner) → true", await puedeInvitar(g(), cal));
  sim.compartir(cal, SA, "writer");
  const w = await permisos(g(), cal);
  ok("writer: Google deja leer la ACL, pero el panel NO puede invitar (puede:false, con las reglas)", !w.puede && w.reglas?.length === 2, w);
  ok("puedeInvitar → false", !(await puedeInvitar(g(), cal)));
  sim.interruptores.aclLecturaSoloOwner = true;
  const w2 = await permisos(g(), cal);
  sim.interruptores.aclLecturaSoloOwner = false;
  ok("writer cuando sólo owner lee la ACL → 403 → {puede:false} (no es error)", !w2.puede && !w2.reglas, w2);
  sim.compartir(cal, SA, "reader");
  const r = await permisos(g(), cal);
  ok("reader → {puede:false}", !r.puede);
  sim.compartir(cal, SA, "owner");
  for (const c of ["a1@gmail.com", "a2@gmail.com", "a3@gmail.com"]) await invitar(g(), cal, c, "lectura", ctx);
  sim.paginacion.modo = [1, 0, 2, 1];
  const pag = await permisos(g(), cal);
  sim.paginacion.modo = "normal";
  ok("ACL en varias páginas (con una vacía): todas las reglas", pag.puede && pag.reglas.length === 5, pag);
  sim.inyectar(es.tipo("acl.list"), respuestas.error("rateLimitExceeded"));
  const lim = await intentar(permisos(g(), cal));
  ok("límite de uso al leer la ACL → SERVIDOR (se lanza; no es «no puede»)", codigo(lim) === "SERVIDOR");
  sim.inyectar(es.tipo("acl.list"), respuestas.error("unavailable"));
  ok("503 → SERVIDOR", codigo(await intentar(permisos(g(), cal))) === "SERVIDOR");
  sim.quitar(cal, SA);
  ok("sin acceso al calendario → NO_ENCONTRADO", codigo(await intentar(permisos(g(), cal))) === "NO_ENCONTRADO");
});

// =====================================================================================
seccion("invitar");
await caso("invitar", async () => {
  const cal = nuevoCal();
  const antes = sim.notificaciones.length;
  const r = await invitar(g(), cal, "  Papa@Gmail.com ", "editor", ctx);
  ok("editor → {modo: panel, regla writer}, en minúsculas", r.modo === "panel" && r.regla.correo === PAPA && r.regla.rol === "writer" && rolDe(cal, PAPA) === "writer", r);
  const nt = sim.notificaciones.slice(antes);
  ok("…con sendNotifications=true (Google le manda el correo)", nt.length === 1 && nt[0].metodo === "insert" && nt[0].enviada && nt[0].correo === PAPA, nt);
  const lec = await invitar(g(), cal, "abuela@gmail.com", "lectura", ctx);
  ok("lectura → reader", lec.modo === "panel" && lec.regla.rol === "reader" && rolDe(cal, "abuela@gmail.com") === "reader");
  const esc = sim.contadores.escriturasAcl;
  const igual = await invitar(g(), cal, PAPA, "editor", ctx);
  ok("invitar de nuevo con el mismo permiso → igual, sin escribir", igual.modo === "panel" && "igual" in igual && igual.igual && sim.contadores.escriturasAcl === esc);
  const cambio = await invitar(g(), cal, PAPA, "lectura", ctx);
  ok("invitar con otro permiso a quien ya está → PATCH (no un insert duplicado)", cambio.modo === "panel" && rolDe(cal, PAPA) === "reader" && sim.contadores.escriturasAcl === esc + 1 && escritosAcl.at(-1)?.tipo === "acl.patch", [cambio, escritosAcl.at(-1)]);
  // Alguien que administra el calendario (otro owner): nunca se toca.
  sim.compartir(cal, "tio@gmail.com", "owner");
  const esc2 = sim.contadores.escriturasAcl;
  const adm = await intentar(invitar(g(), cal, "tio@gmail.com", "lectura", ctx));
  ok("a quien tiene owner → NoSePuedeCompartir ADMINISTRA, sin escribir", codigo(adm) === "ADMINISTRA" && rolDe(cal, "tio@gmail.com") === "owner" && sim.contadores.escriturasAcl === esc2);
  // Carrera: la regla aparece entre la lectura y el insert.
  sim.inyectar((p) => p.tipo === "acl.get" && p.reglaId === "user:prima@gmail.com", respuestas.error("notFound"));
  sim.compartir(cal, "prima@gmail.com", "reader");
  const carrera = await invitar(g(), cal, "prima@gmail.com", "editor", ctx);
  ok("carrera (404 al leer, 409 al insertar) → se vuelve a leer y se cambia con PATCH", carrera.modo === "panel" && rolDe(cal, "prima@gmail.com") === "writer", carrera);
  sim.inyectar((p) => p.tipo === "acl.get" && p.reglaId === "user:tio@gmail.com", respuestas.error("notFound"));
  const carrera2 = await intentar(invitar(g(), cal, "tio@gmail.com", "editor", ctx));
  ok("…y si la que apareció es owner → ADMINISTRA, sin tocarla", codigo(carrera2) === "ADMINISTRA" && rolDe(cal, "tio@gmail.com") === "owner");
  // Límite de uso al escribir: SERVIDOR, nunca "manual".
  sim.inyectar(es.tipo("acl.insert"), respuestas.error("rateLimit429"));
  const lim = await intentar(invitar(g(), cal, "vecina@gmail.com", "lectura", ctx));
  ok("429 al invitar → SERVIDOR (se reintenta), no manual", codigo(lim) === "SERVIDOR");
  sim.inyectar(es.tipo("acl.insert"), respuestas.error("userRateLimitExceeded"));
  ok("403 userRateLimitExceeded → SERVIDOR", codigo(await intentar(invitar(g(), cal, "vecina@gmail.com", "lectura", ctx))) === "SERVIDOR");
  // aclInsertExistente = "actualiza": como se lee antes, no cambia nada.
  sim.interruptores.aclInsertExistente = "actualiza";
  const act = await invitar(g(), cal, "abuela@gmail.com", "editor", ctx);
  sim.interruptores.aclInsertExistente = "409";
  ok("con aclInsertExistente=actualiza también queda bien (se leyó antes: PATCH)", act.modo === "panel" && rolDe(cal, "abuela@gmail.com") === "writer");
});

await caso("invitar sin «administrar el uso compartido» → manual", async () => {
  const cal = nuevoCal("writer");
  const r = await invitar(g(), cal, PAPA, "editor", ctx);
  ok("writer: la ACL se lee pero el insert da 403 → {modo: manual}", r.modo === "manual" && rolDe(cal, PAPA) === "none", r);
  sim.interruptores.aclLecturaSoloOwner = true;
  const r2 = await invitar(g(), cal, PAPA, "editor", ctx);
  sim.interruptores.aclLecturaSoloOwner = false;
  ok("…y si ni siquiera puede leerla → manual", r2.modo === "manual");
  const cal2 = nuevoCal("owner");
  sim.inyectar(es.tipo("acl.insert"), respuestas.error("requiredAccessLevel"));
  const r3 = await invitar(g(), cal2, PAPA, "editor", ctx);
  ok("owner pero Google responde 403 al insertar → manual", r3.modo === "manual");
  sim.inyectar(es.tipo("acl.insert"), respuestas.error("accessNotConfigured"));
  ok("API deshabilitada → CONFIGURACION (no manual)", codigo(await intentar(invitar(g(), cal2, PAPA, "editor", ctx))) === "CONFIGURACION");
});

// =====================================================================================
seccion("cambiarPermiso y quitar");
await caso("cambiarPermiso", async () => {
  const cal = nuevoCal();
  await invitar(g(), cal, PAPA, "editor", ctx);
  const r = await cambiarPermiso(g(), cal, PAPA, "lectura", ctx);
  ok("editor → solo lectura (PATCH)", r.modo === "panel" && rolDe(cal, PAPA) === "reader" && escritosAcl.at(-1)?.tipo === "acl.patch", r);
  const igual = await cambiarPermiso(g(), cal, PAPA, "lectura", ctx);
  ok("mismo permiso → igual, sin escribir", igual.modo === "panel" && "igual" in igual && igual.igual === true);
  const no = await cambiarPermiso(g(), cal, "nadie@gmail.com", "editor", ctx);
  ok("alguien que no está → {modo: noEsta}", no.modo === "noEsta", no);
  sim.compartir(cal, "tio@gmail.com", "owner");
  ok("a quien tiene owner → ADMINISTRA", codigo(await intentar(cambiarPermiso(g(), cal, "tio@gmail.com", "lectura", ctx))) === "ADMINISTRA" && rolDe(cal, "tio@gmail.com") === "owner");
  sim.inyectar(es.tipo("acl.patch"), respuestas.error("notFound"));
  const desaparecio = await cambiarPermiso(g(), cal, PAPA, "editor", ctx);
  ok("la regla desaparece entre medio (404 en el PATCH) → noEsta", desaparecio.modo === "noEsta");
  sim.compartir(cal, SA, "writer");
  ok("panel sin administrar → manual", (await cambiarPermiso(g(), cal, PAPA, "editor", ctx)).modo === "manual");
});

await caso("quitar", async () => {
  const cal = nuevoCal();
  await invitar(g(), cal, PAPA, "editor", ctx);
  const r = await quitar(g(), cal, PAPA, ctx);
  ok("quitar → DELETE, ya no tiene acceso", r.modo === "panel" && !("yaNoEstaba" in r && r.yaNoEstaba) && rolDe(cal, PAPA) === "none", r);
  const otra = await quitar(g(), cal, PAPA, ctx);
  ok("quitar a quien ya no estaba → ok (yaNoEstaba)", otra.modo === "panel" && "yaNoEstaba" in otra && otra.yaNoEstaba === true);
  await invitar(g(), cal, "abuela@gmail.com", "lectura", ctx);
  sim.inyectar(es.tipo("acl.delete"), respuestas.error("notFound"));
  const r404 = await quitar(g(), cal, "abuela@gmail.com", ctx);
  ok("404 en el DELETE → ok (yaNoEstaba)", r404.modo === "panel" && "yaNoEstaba" in r404 && r404.yaNoEstaba === true);
  sim.compartir(cal, "tio@gmail.com", "owner");
  ok("quitar a quien tiene owner → ADMINISTRA (sigue owner)", codigo(await intentar(quitar(g(), cal, "tio@gmail.com", ctx))) === "ADMINISTRA" && rolDe(cal, "tio@gmail.com") === "owner");
  await invitar(g(), cal, "prima@gmail.com", "lectura", ctx);
  sim.compartir(cal, SA, "writer");
  ok("panel sin administrar → manual (la regla sigue)", (await quitar(g(), cal, "prima@gmail.com", ctx)).modo === "manual" && rolDe(cal, "prima@gmail.com") === "reader");
});

// Google responde el mismo 404 a «esa persona no tiene regla» y a «el panel ya no ve el calendario»
// (revisión, hallazgos 4 y 6): antes de decir «ya no estaba» / «no está» se confirma el calendario.
await caso("quitar y cambiarPermiso cuando el panel ya no ve el calendario", async () => {
  const cal = nuevoCal();
  await invitar(g(), cal, PAPA, "editor", ctx);
  sim.quitar(cal, SA);
  const q = await intentar(quitar(g(), cal, PAPA, ctx));
  ok("quitar sin acceso al calendario → NO_ENCONTRADO (no «yaNoEstaba»), la regla sigue", codigo(q) === "NO_ENCONTRADO" && rolDe(cal, PAPA) === "writer", [q.valor, codigo(q)]);
  const p = await intentar(cambiarPermiso(g(), cal, PAPA, "lectura", ctx));
  ok("cambiarPermiso sin acceso al calendario → NO_ENCONTRADO (no «noEsta»)", codigo(p) === "NO_ENCONTRADO" && rolDe(cal, PAPA) === "writer", [p.valor, codigo(p)]);
  // El acceso se pierde entre la lectura de la regla y la escritura (404 en el DELETE / PATCH).
  sim.compartir(cal, SA, "owner");
  sim.inyectar((x) => x.tipo === "acl.delete" && (sim.quitar(cal, SA), true), respuestas.error("notFound"));
  const q2 = await intentar(quitar(g(), cal, PAPA, ctx));
  ok("…404 en el DELETE porque se perdió el acceso entre medio → NO_ENCONTRADO", codigo(q2) === "NO_ENCONTRADO" && rolDe(cal, PAPA) === "writer", [q2.valor, codigo(q2)]);
  sim.compartir(cal, SA, "owner");
  sim.inyectar((x) => x.tipo === "acl.patch" && (sim.quitar(cal, SA), true), respuestas.error("notFound"));
  const p2 = await intentar(cambiarPermiso(g(), cal, PAPA, "lectura", ctx));
  ok("…404 en el PATCH porque se perdió el acceso entre medio → NO_ENCONTRADO", codigo(p2) === "NO_ENCONTRADO" && rolDe(cal, PAPA) === "writer", [p2.valor, codigo(p2)]);
  // Con el calendario a la vista, un 404 sigue siendo «no tiene regla» (con un solo pedido más).
  sim.compartir(cal, SA, "owner");
  sim.reiniciarContadores();
  const nadie = await quitar(g(), cal, "nadie@gmail.com", ctx);
  ok("quitar a quien no tiene regla (calendario a la vista) → yaNoEstaba, con 2 pedidos", nadie.modo === "panel" && "yaNoEstaba" in nadie && nadie.yaNoEstaba === true && sim.contadores.api === 2, [nadie, sim.contadores]);
  sim.reiniciarContadores();
  const nuevo = await invitar(g(), cal, "vecina2@gmail.com", "lectura", ctx);
  ok("invitar a alguien nuevo no agrega el pedido de confirmación (GET regla + insert)", nuevo.modo === "panel" && sim.contadores.api === 2, sim.contadores);
});

// Nada reintenta solo estos pedidos (revisión, hallazgo 7): un límite de uso dice «vuelve a intentarlo».
await caso("textoSinReintento", async () => {
  const cal = nuevoCal();
  sim.inyectar(es.tipo("acl.insert"), respuestas.error("rateLimitExceeded"));
  const lim = await intentar(invitar(g(), cal, "vecina@gmail.com", "lectura", ctx));
  const t = lim.error instanceof ErrorCalDAV ? textoSinReintento(lim.error) : "";
  ok("403 rateLimitExceeded al invitar → «vuelve a intentarlo en un minuto», sin «se reintenta solo»", /vuelve a intentarlo en un minuto/.test(t) && !/se reintenta solo/.test(t), t);
  sim.inyectar(es.tipo("acl.delete"), respuestas.error("rateLimit429"));
  await invitar(g(), cal, "vecina@gmail.com", "lectura", ctx);
  const lim2 = await intentar(quitar(g(), cal, "vecina@gmail.com", ctx));
  ok("429 al quitar → esLimiteDeUso y el mismo texto", esLimiteDeUso(lim2.error) && /vuelve a intentarlo en un minuto/.test(textoSinReintento(lim2.error as ErrorCalDAV)), codigo(lim2));
  const neutro = new ErrorCalDAV("Google Calendar pidió esperar un momento (límite de uso).", 403, "SERVIDOR");
  ok("con un texto neutro del transporte: «…(límite de uso): vuelve a intentarlo en un minuto.»", textoSinReintento(neutro) === "Google Calendar pidió esperar un momento (límite de uso): vuelve a intentarlo en un minuto.", textoSinReintento(neutro));
  const token = new ErrorCalDAV("Google respondió 429: inténtalo en unos minutos", 429, "SERVIDOR");
  ok("si ya dice que se intente de nuevo, queda igual", textoSinReintento(token) === token.message, textoSinReintento(token));
  const otros = [
    new ErrorCalDAV("Google Calendar no aceptó el pedido (403 desconocido).", 403, "SERVIDOR"),
    new ErrorCalDAV("No encontramos el calendario o no está compartido con x.", 404, "NO_ENCONTRADO"),
    new ErrorCalDAV("Google Calendar respondió 503: inténtalo en unos minutos", 503, "SERVIDOR"),
  ];
  ok("lo que no es límite de uso queda igual", otros.every((e) => !esLimiteDeUso(e) && textoSinReintento(e) === e.message));
  ok("sinReintento: el mismo error (status y código) con el texto nuevo; lo demás, el mismo objeto", (() => {
    const x = sinReintento(lim.error) as ErrorCalDAV;
    return x instanceof ErrorCalDAV && x.status === 403 && x.codigo === "SERVIDOR" && x.message === t && sinReintento(otros[0]) === otros[0];
  })());
});

// =====================================================================================
seccion("Al final");
ok(
  "el panel nunca dio owner ni tocó la regla del dueño o la propia (todas las escrituras de la ACL)",
  escritosAcl.length > 0 &&
    escritosAcl.every((x) => {
      const c = x.cuerpo as { role?: string; scope?: { value?: string } } | null;
      return !c || (c.role !== "owner" && c.scope?.value !== DUENA && c.scope?.value !== SA);
    }),
  escritosAcl.filter((x) => (x.cuerpo as { role?: string } | null)?.role === "owner"),
);
ok("los insert van con sendNotifications=true", escritosAcl.filter((x) => x.tipo === "acl.insert").every((x) => /sendNotifications=true/.test(x.query)));

await sim.cerrar();
console.log(`\n${buenas} OK, ${malas} MAL`);
process.exit(malas ? 1 : 0);
