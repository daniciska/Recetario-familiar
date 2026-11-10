// Pruebas de la API de personas del calendario de Google (addendum: el calendario es del Gmail de un
// adulto, el "dueño", y desde el panel se invita a otros como editor o solo lectura por la ACL):
// GET /personas, POST /invitar, /permiso, /quitar y /dueno, contra el simulador y Blobs en memoria.
//
//   cd calendario && node --experimental-transform-types --no-warnings --import ./pruebas/registrar.mjs pruebas/google/compartir-api.test.ts
import { respuestas, es } from "./mock-google.mts";
import { DUENA, PAPA, ev, prepararArnes } from "./arnes-api.ts";

const a = await prepararArnes();
const { sim, ok, seccion, caso, pedir } = a;
const dueno = { nombre: "Carolina", correo: DUENA, rol: "madre", miembroId: "mama" };
let n = 0;
const nuevoId = () => `c_per${++n}@group.calendar.google.com`;
const rolEn = (cal: string, correo: string) => sim.acl(cal).find((x: any) => x.id === `user:${correo}`)?.role ?? "none";
const guardadas = async (fam: string) => ((await a.acceso(fam)).calendarios?.[0]?.personas ?? []) as any[];

// Todo lo que el panel escribe en la ACL (para revisar que nunca da owner ni toca al dueño).
const escritosAcl: { tipo: string; cuerpo: any; regla?: string; query: string }[] = [];
sim.inyectar(
  (p) => {
    if (p.tipo.startsWith("acl.") && p.metodo !== "GET") escritosAcl.push({ tipo: p.tipo, cuerpo: p.cuerpo, regla: p.reglaId, query: p.query.toString() });
    return false;
  },
  respuestas.status(500),
  Infinity,
);

/** Una familia conectada a un calendario nuevo (la cuenta de servicio con ese rol). */
async function conectada(rol: "owner" | "writer" = "owner") {
  const fam = await a.familia({ eventos: [ev("x1")] });
  const cal = a.calendario(nuevoId(), rol);
  const r = await pedir(fam, "POST", "conectar", { proveedor: "google", calendarioId: cal, dueno, subirExistentes: true });
  if (r.status !== 200) throw new Error("no conectó: " + JSON.stringify(r));
  return { fam, cal };
}
const liberar = async (fam: string) => {
  const c = (await a.acceso(fam)).calendarios?.[0];
  if (c) await pedir(fam, "POST", "desconectar", { id: c.id });
};

// ---------------------------------------------------------------------------------------------
seccion("Sin calendario de Google conectado");
await caso("sin conexión", async () => {
  const fam = await a.familia();
  for (const [m, acc] of [["GET", "personas"], ["POST", "invitar"], ["POST", "permiso"], ["POST", "quitar"], ["POST", "dueno"]] as const) {
    const r = await pedir(fam, m, acc, m === "POST" ? { correo: PAPA, nombre: "Rodrigo", rol: "padre", permiso: "editor" } : undefined);
    ok(`${m} /${acc} → 404`, r.status === 404 && /Google Calendar conectado/.test(r.datos.error), r);
  }
});

// ---------------------------------------------------------------------------------------------
seccion("Con «administrar el uso compartido» (owner): el panel invita");
await caso("invitar, cambiar y quitar", async () => {
  const { fam, cal } = await conectada("owner");
  let r = await pedir(fam, "GET", "personas");
  ok("GET /personas: puede invitar, dueño, lista vacía (sin la regla del dueño ni la del panel)", r.status === 200 && r.datos.puedeInvitar === true && r.datos.dueno?.correo === DUENA && r.datos.personas.length === 0, r.datos);
  ok("…el dueño aparece como dueño en Google y viene el correo del panel", r.datos.duenoEnGoogle === true && r.datos.correoPanel === a.SA, r.datos);

  sim.notificaciones.length = 0;
  r = await pedir(fam, "POST", "invitar", { nombre: "Rodrigo", correo: " Papa@Gmail.com ", rol: "padre", permiso: "editor", miembroId: "papa" });
  ok("invitar al papá como editor → 200 modo panel", r.status === 200 && r.datos.modo === "panel" && r.datos.persona?.correo === PAPA && r.datos.persona.permiso === "editor", r);
  ok("…en Google queda writer", rolEn(cal, PAPA) === "writer", sim.acl(cal));
  ok("…Google le manda el correo (sendNotifications)", sim.notificaciones.some((x) => x.correo === PAPA && x.enviada), sim.notificaciones);
  let g = await guardadas(fam);
  ok("…guardado en el panel (minúsculas, rol, miembro, modo panel)", g.length === 1 && g[0].correo === PAPA && g[0].rol === "padre" && g[0].miembroId === "papa" && g[0].modo === "panel" && g[0].nombre === "Rodrigo", g);

  r = await pedir(fam, "POST", "invitar", { nombre: "Abuela Marta", correo: "abuela@gmail.com", rol: "adulto", permiso: "lectura" });
  ok("invitar a la abuela como solo lectura → reader", r.status === 200 && rolEn(cal, "abuela@gmail.com") === "reader", [r, sim.acl(cal)]);

  r = await pedir(fam, "GET", "personas");
  const ps = r.datos.personas as any[];
  ok("GET /personas: las dos, ok, con su permiso real", ps.length === 2 && ps.every((p) => p.estado === "ok" && p.guardada) && ps.find((p) => p.correo === PAPA)?.permiso === "editor" && ps.find((p) => p.correo === "abuela@gmail.com")?.permiso === "lectura", ps);

  const antes = sim.contadores.escriturasAcl;
  r = await pedir(fam, "POST", "invitar", { nombre: "Rodrigo", correo: PAPA, rol: "padre", permiso: "editor" });
  ok("invitar de nuevo con el mismo permiso → igual, sin escribir", r.status === 200 && r.datos.igual === true && sim.contadores.escriturasAcl === antes, [r, sim.contadores]);
  g = await guardadas(fam);
  ok("…sin duplicarlo", g.filter((p) => p.correo === PAPA).length === 1, g);

  r = await pedir(fam, "POST", "permiso", { correo: PAPA, permiso: "lectura" });
  ok("/permiso → solo lectura", r.status === 200 && r.datos.modo === "panel" && rolEn(cal, PAPA) === "reader", [r, sim.acl(cal)]);
  g = await guardadas(fam);
  ok("…guardado", g.find((p) => p.correo === PAPA)?.permiso === "lectura", g);

  r = await pedir(fam, "POST", "quitar", { correo: "abuela@gmail.com" });
  ok("/quitar → 200 y en Google ya no está", r.status === 200 && r.datos.modo === "panel" && rolEn(cal, "abuela@gmail.com") === "none", [r, sim.acl(cal)]);
  g = await guardadas(fam);
  ok("…ni en el panel", !g.some((p) => p.correo === "abuela@gmail.com"), g);
  r = await pedir(fam, "POST", "quitar", { correo: "abuela@gmail.com" });
  ok("quitar a quien ya no estaba → 200 yaNoEstaba", r.status === 200 && r.datos.yaNoEstaba === true, r);

  r = await pedir(fam, "POST", "permiso", { correo: "nadie@gmail.com", permiso: "editor" });
  ok("/permiso de alguien sin acceso → 404 NO_ESTA", r.status === 404 && r.datos.codigo === "NO_ESTA", r);

  // Cambios hechos en Google Calendar: la lista los muestra.
  sim.compartir(cal, "tio@gmail.com", "writer");
  sim.quitar(cal, PAPA);
  r = await pedir(fam, "GET", "personas");
  const vista = r.datos.personas as any[];
  ok("una regla agregada en Google → «compartido en Google Calendar»", vista.some((p) => p.correo === "tio@gmail.com" && p.estado === "google" && p.permiso === "editor" && !p.guardada), vista);
  ok("una persona invitada que ya no está en Google → «ya no tiene acceso»", vista.some((p) => p.correo === PAPA && p.estado === "sinAcceso"), vista);
  r = await pedir(fam, "POST", "invitar", { nombre: "Rodrigo", correo: PAPA, rol: "padre", permiso: "editor" });
  ok("se puede volver a invitar", r.status === 200 && rolEn(cal, PAPA) === "writer", r);
  r = await pedir(fam, "POST", "permiso", { correo: "tio@gmail.com", permiso: "lectura" });
  ok("se puede cambiar el permiso de alguien compartido en Google", r.status === 200 && rolEn(cal, "tio@gmail.com") === "reader", r);
  r = await pedir(fam, "POST", "quitar", { correo: "tio@gmail.com" });
  ok("…y quitarlo", r.status === 200 && rolEn(cal, "tio@gmail.com") === "none", r);

  ok("nunca se escribió owner ni se tocó la regla del dueño", escritosAcl.every((x) => x.cuerpo?.role !== "owner" && x.regla !== `user:${DUENA}`), escritosAcl);
  ok("todas las inserciones con sendNotifications=true", escritosAcl.filter((x) => x.tipo === "acl.insert").every((x) => /sendNotifications=true/.test(x.query)), escritosAcl);
  await liberar(fam);
});

await caso("guardas (antes de escribir en Google)", async () => {
  const { fam, cal } = await conectada("owner");
  const antes = sim.contadores.escriturasAcl;
  const base = { nombre: "Alguien", correo: "alguien@gmail.com", rol: "adulto", permiso: "editor" };
  const casos: [string, Record<string, unknown>, string | RegExp][] = [
    ["el dueño", { ...base, correo: DUENA }, "ES_DUENO"],
    ["el dueño con puntos y +algo", { ...base, correo: "m.a.m.a+familia@gmail.com" }, "ES_DUENO"],
    ["la cuenta de servicio", { ...base, correo: a.SA }, "ES_PANEL"],
    ["correo inválido", { ...base, correo: "alguien-arroba" }, "CORREO_INVALIDO"],
    ["permiso owner", { ...base, permiso: "owner" }, "PERMISO_INVALIDO"],
    ["sin permiso", { ...base, permiso: undefined }, "PERMISO_INVALIDO"],
  ];
  for (const [nombre, cuerpo, cod] of casos) {
    const r = await pedir(fam, "POST", "invitar", cuerpo);
    ok(`invitar a ${nombre} → 400 ${cod}`, r.status === 400 && r.datos.codigo === cod, r);
  }
  let r = await pedir(fam, "POST", "invitar", { ...base, nombre: "  " });
  ok("sin nombre → 400", r.status === 400 && /nombre/.test(r.datos.error), r);
  r = await pedir(fam, "POST", "invitar", { ...base, rol: "hijo" });
  ok("rol inválido → 400", r.status === 400 && /Madre, Padre u Otro adulto/.test(r.datos.error), r);
  r = await pedir(fam, "POST", "quitar", { correo: DUENA });
  ok("quitar al dueño → 400 ES_DUENO", r.status === 400 && r.datos.codigo === "ES_DUENO", r);
  r = await pedir(fam, "POST", "permiso", { correo: DUENA, permiso: "lectura" });
  ok("cambiar el permiso del dueño → 400 ES_DUENO", r.status === 400 && r.datos.codigo === "ES_DUENO", r);
  ok("…nada se escribió en Google", sim.contadores.escriturasAcl === antes, sim.contadores);
  ok("…ni en el panel", (await guardadas(fam)).length === 0, await guardadas(fam));

  // Quien administra en Google (owner) no se toca desde el panel.
  sim.compartir(cal, "admin@gmail.com", "owner");
  r = await pedir(fam, "POST", "permiso", { correo: "admin@gmail.com", permiso: "lectura" });
  ok("cambiar a alguien que administra → 400 ADMINISTRA", r.status === 400 && r.datos.codigo === "ADMINISTRA" && rolEn(cal, "admin@gmail.com") === "owner", r);
  r = await pedir(fam, "POST", "quitar", { correo: "admin@gmail.com" });
  ok("quitar a alguien que administra → 400 ADMINISTRA", r.status === 400 && r.datos.codigo === "ADMINISTRA" && rolEn(cal, "admin@gmail.com") === "owner", r);
  r = await pedir(fam, "GET", "personas");
  ok("…se ve como «compartido en Google» sin permiso de panel (administra)", r.datos.personas.some((p: any) => p.correo === "admin@gmail.com" && p.estado === "google" && p.permiso === null && p.rolGoogle === "owner"), r.datos.personas);

  // Máximo de personas.
  for (let i = 0; i < 20; i++) {
    const x = await pedir(fam, "POST", "invitar", { nombre: `P${i}`, correo: `p${i}@gmail.com`, rol: "adulto", permiso: "lectura" });
    if (x.status !== 200) ok(`invitar P${i}`, false, x);
  }
  r = await pedir(fam, "POST", "invitar", { nombre: "P20", correo: "p20@gmail.com", rol: "adulto", permiso: "lectura" });
  ok("la persona 21 → 400 MAXIMO, sin escribir en Google", r.status === 400 && r.datos.codigo === "MAXIMO" && rolEn(cal, "p20@gmail.com") === "none", r);
  ok("…guardadas: 20", (await guardadas(fam)).length === 20);
  r = await pedir(fam, "POST", "invitar", { nombre: "P3", correo: "p3@gmail.com", rol: "adulto", permiso: "editor" });
  ok("con 20, cambiar a una que ya está sí se puede", r.status === 200 && rolEn(cal, "p3@gmail.com") === "writer", r);
  await liberar(fam);
});

await caso("errores de Google al compartir", async () => {
  const { fam, cal } = await conectada("owner");
  sim.inyectar(es.tipo("acl.insert"), respuestas.error("rateLimitExceeded"), 1);
  let r = await pedir(fam, "POST", "invitar", { nombre: "Rodrigo", correo: PAPA, rol: "padre", permiso: "editor" });
  ok("límite de uso → 424 SERVIDOR (no «manual»), nada guardado", r.status === 424 && r.datos.codigo === "SERVIDOR" && (await guardadas(fam)).length === 0, r);
  sim.inyectar(es.tipo("acl.list"), respuestas.error("backendError"), 1);
  r = await pedir(fam, "GET", "personas");
  ok("GET /personas con Google caído → 200 con aviso y lo guardado", r.status === 200 && typeof r.datos.aviso === "string" && r.datos.puedeInvitar === false && Array.isArray(r.datos.personas), r.datos);
  sim.quitar(cal, a.SA);
  r = await pedir(fam, "POST", "invitar", { nombre: "Rodrigo", correo: PAPA, rol: "padre", permiso: "editor" });
  ok("sin acceso al calendario → 424 NO_ENCONTRADO", r.status === 424 && r.datos.codigo === "NO_ENCONTRADO", r);
  await liberar(fam);
});

// ---------------------------------------------------------------------------------------------
seccion("Con «ver los detalles del evento» (writer): invitaciones a mano");
await caso("manual", async () => {
  const { fam, cal } = await conectada("writer");
  let r = await pedir(fam, "GET", "personas");
  ok("GET /personas: no puede invitar (aunque writer lee la ACL)", r.status === 200 && r.datos.puedeInvitar === false && Array.isArray(r.datos.personas), r.datos);
  const antes = sim.contadores.escriturasAcl;
  r = await pedir(fam, "POST", "invitar", { nombre: "Rodrigo", correo: PAPA, rol: "padre", permiso: "editor" });
  ok("invitar → 200 modo manual, con el dueño para los pasos", r.status === 200 && r.datos.modo === "manual" && r.datos.dueno?.nombre === "Carolina", r);
  ok("…Google no cambió", rolEn(cal, PAPA) === "none" && sim.contadores.escriturasAcl - antes <= 1, [sim.acl(cal), sim.contadores]);
  let g = await guardadas(fam);
  ok("…guardada en modo manual", g.length === 1 && g[0].modo === "manual" && g[0].permiso === "editor", g);
  r = await pedir(fam, "GET", "personas");
  ok("…se ve «pendiente»", r.datos.personas.some((p: any) => p.correo === PAPA && p.estado === "pendiente"), r.datos.personas);
  // El dueño lo hace a mano en Google: pasa a ok.
  sim.compartir(cal, PAPA, "writer");
  r = await pedir(fam, "GET", "personas");
  ok("hecho a mano en Google → ok con su permiso", r.datos.personas.some((p: any) => p.correo === PAPA && p.estado === "ok" && p.permiso === "editor"), r.datos.personas);
  r = await pedir(fam, "POST", "permiso", { correo: PAPA, permiso: "lectura" });
  ok("/permiso → manual (Google no cambia)", r.status === 200 && r.datos.modo === "manual" && rolEn(cal, PAPA) === "writer", r);
  r = await pedir(fam, "POST", "quitar", { correo: PAPA });
  ok("/quitar → manual; sale de la lista del panel", r.status === 200 && r.datos.modo === "manual" && (await guardadas(fam)).length === 0 && rolEn(cal, PAPA) === "writer", r);
  r = await pedir(fam, "GET", "personas");
  ok("…y se ve como «compartido en Google Calendar» mientras siga allá", r.datos.personas.some((p: any) => p.correo === PAPA && p.estado === "google"), r.datos.personas);

  // Si la ACL no se deja leer (writer con Google más estricto): todo queda manual.
  sim.interruptores.aclLecturaSoloOwner = true;
  r = await pedir(fam, "POST", "invitar", { nombre: "Abuela", correo: "abuela@gmail.com", rol: "adulto", permiso: "lectura" });
  ok("ACL ilegible → invitar manual", r.status === 200 && r.datos.modo === "manual", r);
  r = await pedir(fam, "GET", "personas");
  ok("GET /personas sin ACL: lo guardado, «pendiente»", r.status === 200 && r.datos.puedeInvitar === false && r.datos.personas.length === 1 && r.datos.personas[0].estado === "pendiente" && r.datos.duenoEnGoogle === null, r.datos);
  sim.interruptores.aclLecturaSoloOwner = false;
  g = await guardadas(fam);
  ok("guardadas: la abuela, manual", g.length === 1 && g[0].modo === "manual", g);
  await liberar(fam);
});

// ---------------------------------------------------------------------------------------------
seccion("Revisión: estados de las personas y casos de borde");

// Hallazgos 4 y 6: el 404 de un calendario que el panel ya no ve no es «esa persona no tiene regla».
await caso("quitar y /permiso cuando el panel ya no ve el calendario", async () => {
  const { fam, cal } = await conectada("owner");
  await pedir(fam, "POST", "invitar", { nombre: "Rodrigo", correo: PAPA, rol: "padre", permiso: "editor", miembroId: "papa" });
  sim.quitar(cal, a.SA);
  let r = await pedir(fam, "POST", "quitar", { correo: PAPA });
  ok("/quitar → 424 NO_ENCONTRADO (no «ya no ve el calendario»)", r.status === 424 && r.datos.codigo === "NO_ENCONTRADO" && !r.datos.yaNoEstaba, r);
  ok("…sigue con acceso en Google y sigue guardado en el panel", rolEn(cal, PAPA) === "writer" && (await guardadas(fam)).some((p) => p.correo === PAPA), [sim.acl(cal), await guardadas(fam)]);
  r = await pedir(fam, "POST", "permiso", { correo: PAPA, permiso: "lectura" });
  ok("/permiso → 424 NO_ENCONTRADO (no NO_ESTA «invítala de nuevo»)", r.status === 424 && r.datos.codigo === "NO_ENCONTRADO", r);
  ok("…nada cambió", rolEn(cal, PAPA) === "writer" && (await guardadas(fam)).find((p) => p.correo === PAPA)?.permiso === "editor", await guardadas(fam));
  sim.compartir(cal, a.SA, "owner");
  r = await pedir(fam, "POST", "quitar", { correo: PAPA });
  ok("con el acceso de vuelta, /quitar funciona", r.status === 200 && r.datos.modo === "panel" && !r.datos.yaNoEstaba && rolEn(cal, PAPA) === "none" && (await guardadas(fam)).length === 0, r);
  await liberar(fam);
});

// Hallazgo 5: invitaciones simultáneas cerca del máximo no recortan en silencio a la recién invitada.
await caso("invitaciones simultáneas cerca del máximo", async () => {
  const { fam, cal } = await conectada("owner");
  for (let i = 0; i < 18; i++) {
    const x = await pedir(fam, "POST", "invitar", { nombre: `P${i}`, correo: `p${i}@gmail.com`, rol: "adulto", permiso: "lectura" });
    if (x.status !== 200) ok(`invitar P${i}`, false, x);
  }
  const rs = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => pedir(fam, "POST", "invitar", { nombre: `Q${i}`, correo: `q${i}@gmail.com`, rol: "adulto", permiso: "editor" })));
  const aceptadas = rs.filter((x) => x.status === 200).map((x) => x.datos.persona.correo as string);
  let g = await guardadas(fam);
  const perdidas = aceptadas.filter((c) => !g.some((p) => p.correo === c));
  ok("toda persona respondida con 200 queda guardada (nadie se recorta)", aceptadas.length > 0 && perdidas.length === 0, { aceptadas, perdidas, guardadas: g.length });
  ok("…y con su nombre (no como «compartido en Google»)", aceptadas.every((c) => g.find((p) => p.correo === c)?.nombre?.startsWith("Q")), g.slice(-6));
  ok("…lo guardado calza con la ACL", g.every((p) => rolEn(cal, p.correo) !== "none") && g.length === 18 + aceptadas.length, g.length);
  const total = g.length;
  let r = await pedir(fam, "POST", "permiso", { correo: "p0@gmail.com", permiso: "editor" });
  g = await guardadas(fam);
  ok("un /permiso después tampoco recorta la lista", r.status === 200 && g.length === total, [r.status, g.length]);
  r = await pedir(fam, "POST", "invitar", { nombre: "Otra", correo: "otra@gmail.com", rol: "adulto", permiso: "lectura" });
  ok("pasado el máximo, la siguiente → 400 MAXIMO sin escribir en Google", r.status === 400 && r.datos.codigo === "MAXIMO" && rolEn(cal, "otra@gmail.com") === "none", r);
  // Con la lista sobre el máximo, volver a invitar a alguien ya guardado («Invitar ahora», otro permiso)
  // no agrega a nadie: no choca con el máximo.
  r = await pedir(fam, "POST", "invitar", { nombre: "Q0", correo: "q0@gmail.com", rol: "adulto", permiso: "lectura" });
  g = await guardadas(fam);
  ok("…pero volver a invitar a una ya guardada sí se puede (sin agregar a nadie)", r.status === 200 && r.datos.modo === "panel" && rolEn(cal, "q0@gmail.com") === "reader" && g.length === total && g.find((p) => p.correo === "q0@gmail.com")?.permiso === "lectura", [r, g.length]);
  await liberar(fam);
});

// Hallazgo 7: nada reintenta solo invitar, /permiso ni /quitar.
await caso("límite de uso: «vuelve a intentarlo en un minuto»", async () => {
  const { fam } = await conectada("owner");
  const sinPromesa = (r: { datos: any }) => /vuelve a intentarlo en un minuto/.test(r.datos?.error ?? "") && !/se reintenta solo/.test(r.datos?.error ?? "");
  sim.inyectar(es.tipo("acl.insert"), respuestas.error("rateLimitExceeded"), 1);
  let r = await pedir(fam, "POST", "invitar", { nombre: "Rodrigo", correo: PAPA, rol: "padre", permiso: "editor" });
  ok("invitar con límite de uso → 424 SERVIDOR que pide volver a intentarlo (sin «se reintenta solo»)", r.status === 424 && r.datos.codigo === "SERVIDOR" && sinPromesa(r), r);
  await pedir(fam, "POST", "invitar", { nombre: "Rodrigo", correo: PAPA, rol: "padre", permiso: "editor" });
  sim.inyectar(es.tipo("acl.patch"), respuestas.error("rateLimit429"), 1);
  r = await pedir(fam, "POST", "permiso", { correo: PAPA, permiso: "lectura" });
  ok("/permiso con 429 → lo mismo", r.status === 424 && sinPromesa(r), r);
  sim.inyectar(es.tipo("acl.delete"), respuestas.error("userRateLimitExceeded"), 1);
  r = await pedir(fam, "POST", "quitar", { correo: PAPA });
  ok("/quitar con límite de uso → lo mismo, y sigue guardado", r.status === 424 && sinPromesa(r) && (await guardadas(fam)).length === 1, r);
  sim.inyectar(es.tipo("acl.list"), respuestas.error("rateLimitExceeded"), 1);
  r = await pedir(fam, "GET", "personas");
  ok("GET /personas con límite de uso → aviso que pide volver a intentarlo", r.status === 200 && /vuelve a intentarlo en un minuto/.test(r.datos.aviso ?? "") && !/se reintenta solo/.test(r.datos.aviso ?? ""), r.datos);
  await liberar(fam);
});

// Hallazgo 8: una persona manual cuando el panel ya puede invitar → «sinInvitar» («Invitar ahora»).
await caso("manual y después el panel puede invitar → sinInvitar", async () => {
  const { fam, cal } = await conectada("writer");
  await pedir(fam, "POST", "invitar", { nombre: "Rodrigo", correo: PAPA, rol: "padre", permiso: "editor", miembroId: "papa" });
  await pedir(fam, "POST", "invitar", { nombre: "Abuela", correo: "abuela@gmail.com", rol: "adulto", permiso: "lectura" });
  let r = await pedir(fam, "GET", "personas");
  ok("con writer: las dos «pendiente»", r.datos.puedeInvitar === false && r.datos.personas.length === 2 && r.datos.personas.every((p: any) => p.estado === "pendiente"), r.datos.personas);
  // La dueña sigue el consejo: «Realizar cambios y administrar el uso compartido».
  sim.compartir(cal, a.SA, "owner");
  r = await pedir(fam, "GET", "personas");
  const papa = r.datos.personas.find((p: any) => p.correo === PAPA);
  ok("con owner: puedeInvitar y la persona manual queda «sinInvitar» con el permiso pedido", r.datos.puedeInvitar === true && papa?.estado === "sinInvitar" && papa.permiso === "editor" && papa.rolGoogle === null && papa.modo === "manual" && papa.miembroId === "papa", r.datos.personas);
  ok("…la otra también", r.datos.personas.find((p: any) => p.correo === "abuela@gmail.com")?.estado === "sinInvitar", r.datos.personas);
  // «Invitar ahora»: la interfaz manda lo guardado. Aunque no venga el miembroId, se conserva.
  r = await pedir(fam, "POST", "invitar", { nombre: papa.nombre, correo: papa.correo, rol: papa.rol, permiso: papa.permiso });
  ok("«Invitar ahora» → 200 modo panel, writer en Google", r.status === 200 && r.datos.modo === "panel" && rolEn(cal, PAPA) === "writer", r);
  const g = await guardadas(fam);
  ok("…la misma persona actualizada en su lugar (sin duplicar, modo panel, conserva su miembroId)", g.length === 2 && g[0].correo === PAPA && g[0].modo === "panel" && g[0].miembroId === "papa" && g[0].permiso === "editor", g);
  ok("…con la fecha de la invitación nueva", g[0].invitada === r.datos.persona.invitada && r.datos.persona.miembroId === "papa", [g[0], r.datos.persona]);
  r = await pedir(fam, "GET", "personas");
  ok("…y se ve «ok»", r.datos.personas.find((p: any) => p.correo === PAPA)?.estado === "ok", r.datos.personas);
  r = await pedir(fam, "POST", "invitar", { nombre: "Rodrigo", correo: PAPA, rol: "padre", permiso: "editor", miembroId: "sofi" });
  ok("un miembroId que sí viene reemplaza al guardado", (await guardadas(fam))[0].miembroId === "sofi", await guardadas(fam));
  await liberar(fam);
});

// Hallazgo 10: persona manual que ya tenía en Google una regla de otro permiso.
await caso("manual con una regla de otro permiso → pendiente (con rolGoogle) o sinInvitar", async () => {
  const { fam, cal } = await conectada("writer");
  sim.compartir(cal, PAPA, "freeBusyReader");
  sim.compartir(cal, "abuela@gmail.com", "reader");
  for (const [correo, permiso] of [[PAPA, "editor"], ["abuela@gmail.com", "editor"], ["tio@gmail.com", "editor"], ["admin@gmail.com", "lectura"]]) {
    const x = await pedir(fam, "POST", "invitar", { nombre: correo.split("@")[0], correo, rol: "adulto", permiso });
    ok(`invitar a ${correo} como ${permiso} → manual`, x.status === 200 && x.datos.modo === "manual", x);
  }
  // La dueña lo hace a mano en Google: al tío con lo pedido, y a otro le da «administrar».
  sim.compartir(cal, "tio@gmail.com", "writer");
  sim.compartir(cal, "admin@gmail.com", "owner");
  let r = await pedir(fam, "GET", "personas");
  const ver = (c: string) => r.datos.personas.find((p: any) => p.correo === c);
  ok("disponible/ocupado y se pidió editor → «pendiente», rolGoogle freeBusyReader, permiso pedido", ver(PAPA)?.estado === "pendiente" && ver(PAPA).rolGoogle === "freeBusyReader" && ver(PAPA).permiso === "editor", ver(PAPA));
  ok("solo lectura y se pidió editor → «pendiente», rolGoogle reader", ver("abuela@gmail.com")?.estado === "pendiente" && ver("abuela@gmail.com").rolGoogle === "reader" && ver("abuela@gmail.com").permiso === "editor", ver("abuela@gmail.com"));
  ok("ya tiene lo pedido → «ok»", ver("tio@gmail.com")?.estado === "ok" && ver("tio@gmail.com").permiso === "editor", ver("tio@gmail.com"));
  ok("quien administra (owner) ya tiene más que lo pedido → «ok»", ver("admin@gmail.com")?.estado === "ok" && ver("admin@gmail.com").rolGoogle === "owner", ver("admin@gmail.com"));
  sim.compartir(cal, a.SA, "owner");
  r = await pedir(fam, "GET", "personas");
  ok("con owner → «sinInvitar» (con rolGoogle)", ver(PAPA)?.estado === "sinInvitar" && ver(PAPA).rolGoogle === "freeBusyReader" && ver("abuela@gmail.com")?.estado === "sinInvitar", r.datos.personas);
  r = await pedir(fam, "POST", "invitar", { nombre: "papa", correo: PAPA, rol: "adulto", permiso: "editor" });
  ok("«Invitar ahora» → PATCH a writer y queda «ok»", r.status === 200 && r.datos.modo === "panel" && rolEn(cal, PAPA) === "writer" && (await pedir(fam, "GET", "personas")).datos.personas.find((p: any) => p.correo === PAPA)?.estado === "ok", [r, sim.acl(cal)]);
  await liberar(fam);
});

// ---------------------------------------------------------------------------------------------
seccion("POST /dueno");
await caso("dueño", async () => {
  const { fam } = await conectada("owner");
  await pedir(fam, "POST", "invitar", { nombre: "Rodrigo", correo: PAPA, rol: "padre", permiso: "editor" });
  let r = await pedir(fam, "POST", "dueno", { nombre: "Caro", correo: "mama@gmail.com", rol: "madre" });
  ok("corregir el nombre del dueño → 200", r.status === 200 && r.datos.dueno?.nombre === "Caro", r);
  const c = (await a.acceso(fam)).calendarios[0];
  ok("…guardado (sin miembroId si no viene)", c.dueno?.nombre === "Caro" && c.dueno.miembroId === undefined, c.dueno);
  r = await pedir(fam, "POST", "dueno", { nombre: "Caro", correo: "no-es-correo", rol: "madre" });
  ok("correo inválido → 400", r.status === 400, r);
  r = await pedir(fam, "POST", "dueno", { nombre: "Caro", correo: a.SA, rol: "madre" });
  ok("la cuenta de servicio → 400", r.status === 400, r);
  r = await pedir(fam, "POST", "dueno", { nombre: "Caro", correo: "mama@gmail.com", rol: "tia" });
  ok("rol inválido → 400", r.status === 400, r);
  r = await pedir(fam, "POST", "dueno", { nombre: "Rodrigo", correo: PAPA, rol: "padre", miembroId: "papa" });
  ok("el dueño pasa a ser alguien de la lista → sale de la lista", r.status === 200 && !(await guardadas(fam)).some((p) => p.correo === PAPA), await guardadas(fam));
  r = await pedir(fam, "GET", "personas");
  ok("…y Google dice que no es dueño (duenoEnGoogle false)", r.datos.dueno?.correo === PAPA && r.datos.duenoEnGoogle === false, r.datos);
  ok("…mientras la verdadera dueña aparece como «compartido en Google»", r.datos.personas.some((p: any) => p.correo === DUENA && p.estado === "google" && p.rolGoogle === "owner"), r.datos.personas);
  r = await pedir(fam, "POST", "dueno", { nombre: "Carolina", correo: DUENA, rol: "madre", miembroId: "mama" });
  ok("volver a la dueña real", r.status === 200, r);
  await liberar(fam);
});

await a.fin();
