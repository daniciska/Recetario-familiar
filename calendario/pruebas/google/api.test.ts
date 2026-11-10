// Pruebas de la API del calendario con Google (plan de pruebas C5): GET, /probar, /conectar,
// /desconectar, /sincronizar y la función programada, llamadas como las llama Netlify
// (`default(new Request(…), {params: {accion}})`), contra el simulador de Google y Blobs en memoria.
//
//   cd calendario && node --experimental-transform-types --no-warnings --import ./pruebas/registrar.mjs pruebas/google/api.test.ts
import { respuestas, es } from "./mock-google.mts";
import { armarClave, usarClave } from "./clave-prueba.ts";
import { DUENA, ev, prepararArnes } from "./arnes-api.ts";
import { idGoogleDe, esIdDePrueba } from "../../servidor/google/ids";
import { CLAVE_CAPACIDADES, CLAVE_PRUEBA } from "../../servidor/google/prueba";
import { olvidarTokens } from "../../servidor/google/cuenta";

const a = await prepararArnes();
const { sim, ok, seccion, caso, pedir, C } = a;
const st = C.almacen();
const dueno = { nombre: "Carolina", correo: DUENA, rol: "madre", miembroId: "mama" };
let n = 0;
const nuevoId = () => `c_api${++n}@group.calendar.google.com`;
const vivos = (cal: string) => sim.eventos(cal, { lapidas: false });
const pasos = (r: { datos: any }) => Object.fromEntries(((r.datos?.pasos ?? []) as { clave: string; estado: string }[]).map((p) => [p.clave, p.estado]));
const textos = (r: { datos: any }) => ((r.datos?.pasos ?? []) as { texto: string }[]).map((p) => p.texto).join(" | ");
const restaurarInterruptores = () => {
  Object.assign(sim.interruptores, { finIgualInicio: "ok", endTimeUnspecifiedAceptado: true, lapidaOcupaId: true, reglasRechazadas: [], aclLecturaSoloOwner: false });
  sim.latenciaMs = 0;
  sim.limpiarInyecciones();
};

// ---------------------------------------------------------------------------------------------
seccion("GET: lo que el servidor tiene de Google");
await caso("GET", async () => {
  const fam = await a.familia();
  let r = await pedir(fam, "GET", "");
  ok("con la clave: configurado y el correo de la cuenta de servicio", r.status === 200 && r.datos.servidor.google.configurado === true && r.datos.servidor.google.correo === a.SA, r.datos.servidor);
  ok("sin otraFamilia ni problema", r.datos.servidor.google.otraFamilia === false && r.datos.servidor.google.problema === undefined, r.datos.servidor.google);
  ok("iCloud sin configurar (como antes)", r.datos.servidor.icloud === false && r.datos.servidor.otraFamilia === false, r.datos.servidor);

  usarClave(a.clave, "base64");
  r = await pedir(fam, "GET", "");
  ok("la clave en base64 también sirve", r.datos.servidor.google.configurado === true && r.datos.servidor.google.correo === a.SA, r.datos.servidor.google);

  delete process.env.GOOGLE_CUENTA_SERVICIO;
  r = await pedir(fam, "GET", "");
  ok("sin la variable: no configurado, sin correo ni problema", r.datos.servidor.google.configurado === false && !r.datos.servidor.google.correo && !r.datos.servidor.google.problema, r.datos.servidor.google);

  process.env.GOOGLE_CUENTA_SERVICIO = '{"type":"service_account","client_email":"x@y.iam.gserviceaccount.com","private_key":"-----BEGIN PRIVATE KEY-----\\nMIIabc';
  r = await pedir(fam, "GET", "");
  const g = r.datos.servidor.google;
  ok("clave incompleta: no configurado, con el problema (sin la clave)", g.configurado === false && typeof g.problema === "string" && g.problema.length > 5 && !/MIIabc/.test(JSON.stringify(r.datos)), g);
  usarClave(a.clave);

  await st.setJSON("externos/google", { familiaId: "otra" });
  r = await pedir(fam, "GET", "");
  ok("cuenta tomada por otra familia: otraFamilia y SIN el correo", r.datos.servidor.google.otraFamilia === true && r.datos.servidor.google.correo === undefined, r.datos.servidor.google);
  await st.setJSON("externos/google", { familiaId: fam });
  r = await pedir(fam, "GET", "");
  ok("la propia familia sí lo ve", r.datos.servidor.google.otraFamilia === false && r.datos.servidor.google.correo === a.SA, r.datos.servidor.google);
  await st.delete("externos/google");
});

// ---------------------------------------------------------------------------------------------
seccion("POST /probar");
await caso("probar: validaciones", async () => {
  const fam = await a.familia();
  const cal = a.calendario(nuevoId());
  delete process.env.GOOGLE_CUENTA_SERVICIO;
  let r = await pedir(fam, "POST", "probar", { calendarioId: cal });
  ok("sin clave → 400 SIN_CUENTA con el texto", r.status === 400 && r.datos.codigo === "SIN_CUENTA" && /GOOGLE_CUENTA_SERVICIO/.test(r.datos.error), r);
  usarClave(a.clave);
  r = await pedir(fam, "POST", "probar", { calendarioId: "no es un id" });
  ok("ID inválido → 400 con dónde copiarlo", r.status === 400 && /Integrar el calendario/.test(r.datos.error), r);
  await st.setJSON("externos/google", { familiaId: "otra" });
  r = await pedir(fam, "POST", "probar", { calendarioId: cal });
  ok("cuenta de otra familia → 409", r.status === 409, r);
  await st.delete("externos/google");
  ok("…y no se escribió nada en Google", sim.contadores.escrituras === 0 || vivos(cal).length === 0, sim.contadores);
});

await caso("probar: todo bien (owner)", async () => {
  restaurarInterruptores();
  const fam = await a.familia();
  const cal = a.calendario(nuevoId());
  sim.reiniciarContadores();
  const r = await pedir(fam, "POST", "probar", { calendarioId: cal });
  const p = pasos(r);
  ok("200 y terminado", r.status === 200 && r.datos.terminado === true, r.datos);
  ok(
    "todos los pasos en ✅",
    ["token", "permiso", "zona", "compartir", "escritura", "version", "sinHora", "repeticiones"].every((k) => p[k] === "ok") && !p.marca,
    r.datos.pasos,
  );
  ok("nombre, zona y rol", r.datos.nombre === "Familia" && r.datos.zona === "America/Santiago" && r.datos.rol === "owner", r.datos);
  ok("textos del plan", /La clave de la cuenta de servicio funciona/.test(textos(r)) && /Puede editar «Familia»/.test(textos(r)) && /versión vieja/.test(textos(r)), textos(r));
  ok("no queda ningún evento vivo en Google", vivos(cal).length === 0, vivos(cal));
  ok("los eventos que tocó son de prueba (no del panel)", sim.eventos(cal).every((e: any) => esIdDePrueba(e.id)), sim.eventos(cal).map((e: any) => e.id));
  ok("no queda el blob de la prueba", (await st.get(CLAVE_PRUEBA(fam), { type: "json" })) === null);
  const cap = (await st.get(CLAVE_CAPACIDADES(fam), { type: "json" })) as any;
  ok(
    "capacidades guardadas",
    cap && cap.finIgualInicio === true && cap.sinHoraDeTermino === true && cap.reglaPanel === true && cap.rechazaVersionVieja === true && cap.marcaEstable === true && cap.lapidaOcupaId === true && cap.puedeInvitar === true,
    cap,
  );
  ok("pidió 412 con If-Match viejo y borró con If-Match", sim.registro.some((x) => x.tipo === "events.patch" && x.status === 412) && sim.registro.some((x) => x.tipo === "events.delete" && x.status === 204), sim.registro.map((x) => `${x.tipo}:${x.status}`));
  ok("leyó la ACL (maxResults=1)", sim.registro.some((x) => x.tipo === "acl.list" && /maxResults=1/.test(x.query)), sim.registro.map((x) => x.tipo));
});

await caso("probar: writer, reader, sin compartir, otra zona", async () => {
  restaurarInterruptores();
  const fam = await a.familia();
  let cal = a.calendario(nuevoId(), "writer");
  sim.reiniciarContadores();
  const desde = sim.registro.length;
  let r = await pedir(fam, "POST", "probar", { calendarioId: cal });
  let p = pasos(r);
  ok("writer: compartir ⚠️ (invitaciones a mano) y lo demás ✅", p.compartir === "aviso" && p.permiso === "ok" && p.escritura === "ok" && r.datos.terminado, r.datos.pasos);
  ok("writer: no pidió la ACL", !sim.registro.slice(desde).some((x) => x.tipo === "acl.list"), sim.registro.slice(desde).map((x) => x.tipo));

  cal = a.calendario(nuevoId(), "reader");
  sim.reiniciarContadores();
  r = await pedir(fam, "POST", "probar", { calendarioId: cal });
  p = pasos(r);
  ok("reader: permiso ❌ con el texto de «solo para ver» y no sigue", p.permiso === "error" && /solo para ver/.test(textos(r)) && !p.escritura, r.datos.pasos);
  ok("reader: 0 escrituras", sim.contadores.escrituras === 0, sim.contadores);

  cal = a.calendario(nuevoId(), "writerWithoutPrivateAccess");
  r = await pedir(fam, "POST", "probar", { calendarioId: cal });
  ok("writerWithoutPrivateAccess: permiso ❌", pasos(r).permiso === "error" && /disponible\/ocupado/.test(textos(r)), r.datos.pasos);

  cal = a.calendario(nuevoId(), "none");
  r = await pedir(fam, "POST", "probar", { calendarioId: cal });
  ok("sin compartir: ❌ «No encontramos el calendario o no está compartido con …»", pasos(r).permiso === "error" && /No encontramos el calendario/.test(textos(r)) && textos(r).includes(a.SA), r.datos.pasos);

  cal = a.calendario(nuevoId(), "owner", { zona: "Europe/Madrid" });
  r = await pedir(fam, "POST", "probar", { calendarioId: cal });
  ok("otra zona horaria: ⚠️ con cómo cambiarla", pasos(r).zona === "aviso" && /Europe\/Madrid/.test(textos(r)) && /Santiago/.test(textos(r)) && pasos(r).escritura === "ok", r.datos.pasos);
});

await caso("probar: lo no documentado (interruptores)", async () => {
  const fam = await a.familia();
  restaurarInterruptores();
  sim.interruptores.finIgualInicio = "400";
  let cal = a.calendario(nuevoId());
  let r = await pedir(fam, "POST", "probar", { calendarioId: cal });
  let cap = r.datos.capacidades;
  ok("fin = inicio rechazado, «sin hora de término» aceptado → ✅", pasos(r).sinHora === "ok" && cap?.finIgualInicio === false && cap?.sinHoraDeTermino === true && vivos(cal).length === 0, [r.datos.pasos, cap]);

  sim.interruptores.endTimeUnspecifiedAceptado = false;
  cal = a.calendario(nuevoId());
  r = await pedir(fam, "POST", "probar", { calendarioId: cal });
  cap = r.datos.capacidades;
  ok("los dos rechazados → ⚠️ «ponles una»", pasos(r).sinHora === "aviso" && /ponles una/.test(textos(r)) && cap?.reglaPanel === true && vivos(cal).length === 0, [r.datos.pasos, cap]);

  restaurarInterruptores();
  sim.interruptores.reglasRechazadas = ["BYSETPOS"];
  cal = a.calendario(nuevoId());
  r = await pedir(fam, "POST", "probar", { calendarioId: cal });
  cap = r.datos.capacidades;
  ok("la regla del panel rechazada → repeticiones ⚠️; sin hora sí (medido con PATCH)", pasos(r).repeticiones === "aviso" && pasos(r).sinHora === "ok" && cap?.reglaPanel === false && cap?.sinHoraDeTermino === true && vivos(cal).length === 0, [r.datos.pasos, cap]);

  restaurarInterruptores();
  sim.interruptores.lapidaOcupaId = false;
  cal = a.calendario(nuevoId());
  r = await pedir(fam, "POST", "probar", { calendarioId: cal });
  ok("lápida que no ocupa el id: se mide y se borra lo creado de nuevo", r.datos.capacidades?.lapidaOcupaId === false && vivos(cal).length === 0 && pasos(r).escritura === "ok", [r.datos.capacidades, vivos(cal)]);
  ok("…y no queda el blob", (await st.get(CLAVE_PRUEBA(fam), { type: "json" })) === null);

  restaurarInterruptores();
  sim.inyectar(es.tipo("acl.list"), respuestas.error("requiredAccessLevel"), 1);
  cal = a.calendario(nuevoId());
  r = await pedir(fam, "POST", "probar", { calendarioId: cal });
  ok("owner pero la ACL no se deja leer → compartir ⚠️", pasos(r).compartir === "aviso" && r.datos.capacidades?.puedeInvitar === false, r.datos.pasos);

  restaurarInterruptores();
  // Un Google que ignora If-Match: el PATCH con la versión vieja responde 200 con el evento tal como está.
  const tal = respuestas.status(200, {});
  sim.inyectar(
    (p) => {
      if (p.tipo !== "events.patch" || p.cabeceras["if-match"] !== '"0"') return false;
      tal.cuerpo = sim.evento(p.calId!, p.eventoId!);
      return true;
    },
    tal,
    1,
  );
  cal = a.calendario(nuevoId());
  r = await pedir(fam, "POST", "probar", { calendarioId: cal });
  ok("Google que acepta un cambio sobre una versión vieja → ❌ versión (y lo demás sigue)", pasos(r).version === "error" && pasos(r).escritura === "ok" && vivos(cal).length === 0, r.datos.pasos);
  restaurarInterruptores();
});

await caso("probar: errores de Google", async () => {
  const fam = await a.familia();
  restaurarInterruptores();
  let cal = a.calendario(nuevoId());
  sim.inyectar(es.tipo("events.list"), respuestas.error("accessNotConfigured"), 1);
  let r = await pedir(fam, "POST", "probar", { calendarioId: cal });
  ok("API deshabilitada → ❌ con «habilitar Google Calendar API»", pasos(r).permiso === "error" && /Google Calendar API/.test(textos(r)), r.datos.pasos);

  cal = a.calendario(nuevoId());
  sim.inyectar(es.tipo("events.insert"), respuestas.error("rateLimitExceeded"), 1);
  r = await pedir(fam, "POST", "probar", { calendarioId: cal });
  ok("límite de uso al crear → ❌ «pidió esperar» (no PERMISO), sin blob ni evento", pasos(r).escritura === "error" && /esperar/.test(textos(r)) && vivos(cal).length === 0, [r.datos.pasos, vivos(cal)]);
  ok("…sin blob", (await st.get(CLAVE_PRUEBA(fam), { type: "json" })) === null);

  cal = a.calendario(nuevoId());
  sim.inyectar(es.tipo("events.delete"), respuestas.error("backendError"), 1);
  r = await pedir(fam, "POST", "probar", { calendarioId: cal });
  ok("503 al borrar → ❌ y se borra el evento de prueba igual (sin If-Match)", pasos(r).escritura === "error" && vivos(cal).length === 0 && (await st.get(CLAVE_PRUEBA(fam), { type: "json" })) === null, [r.datos.pasos, vivos(cal)]);

  // Token: cuenta deshabilitada en Google Cloud.
  olvidarTokens();
  sim.token.opciones.deshabilitadas = new Set([a.SA]);
  cal = a.calendario(nuevoId());
  r = await pedir(fam, "POST", "probar", { calendarioId: cal });
  ok("clave deshabilitada → ❌ token y no sigue", pasos(r).token === "error" && Object.keys(pasos(r)).length === 1, r.datos.pasos);
  sim.token.opciones.deshabilitadas = new Set();
  olvidarTokens();
});

await caso("probar: un pedido que no responde → ❌ y limpia", async () => {
  const fam = await a.familia();
  restaurarInterruptores();
  const cal = a.calendario(nuevoId());
  let patches = 0;
  sim.inyectar((p) => p.tipo === "events.patch" && ++patches === 2, respuestas.demora(9000), 1);
  const r = await pedir(fam, "POST", "probar", { calendarioId: cal });
  ok("❌ «no respondió a tiempo» en la escritura", pasos(r).escritura === "error" && /no respondió a tiempo/.test(textos(r)) && r.datos.terminado === true, r.datos.pasos);
  ok("…y borró el evento de prueba y el blob", vivos(cal).length === 0 && (await st.get(CLAVE_PRUEBA(fam), { type: "json" })) === null, vivos(cal));
  restaurarInterruptores();
});

await caso("probar: cortado a la mitad se retoma y limpia", async () => {
  const fam = await a.familia();
  restaurarInterruptores();
  const cal = a.calendario(nuevoId());
  // Google lento (1,3 s por pedido): el plazo de la función (6,5 s) se acaba con el evento de prueba ya creado.
  sim.latenciaMs = 1300;
  const t0 = Date.now();
  let r = await pedir(fam, "POST", "probar", { calendarioId: cal });
  const dur = Date.now() - t0;
  ok("responde dentro del plazo (< 7 s)", dur < 7000, dur);
  ok("terminado: false", r.status === 200 && r.datos.terminado === false, r.datos);
  const restos = (await st.get(CLAVE_PRUEBA(fam), { type: "json" })) as any;
  ok("quedó anotado el evento de prueba (y existe en Google)", restos?.id && sim.evento(cal, restos.id)?.status === "confirmed", [restos, restos && sim.evento(cal, restos.id)]);
  restaurarInterruptores();
  r = await pedir(fam, "POST", "probar", { calendarioId: cal });
  ok("la siguiente termina", r.datos.terminado === true && pasos(r).escritura === "ok", r.datos.pasos);
  ok("…y borró el de la vez anterior: no queda ningún evento vivo", vivos(cal).length === 0 && sim.evento(cal, restos.id)?.status === "cancelled", vivos(cal));
  ok("…ni el blob", (await st.get(CLAVE_PRUEBA(fam), { type: "json" })) === null);
});

// ---------------------------------------------------------------------------------------------
seccion("POST /conectar (google)");
await caso("conectar: validaciones", async () => {
  restaurarInterruptores();
  const fam = await a.familia({ eventos: [ev("a1")] });
  const cal = a.calendario(nuevoId());
  const base = { proveedor: "google", calendarioId: cal, dueno, subirExistentes: true };
  delete process.env.GOOGLE_CUENTA_SERVICIO;
  let r = await pedir(fam, "POST", "conectar", base);
  ok("sin clave → 400 SIN_CUENTA", r.status === 400 && r.datos.codigo === "SIN_CUENTA", r);
  usarClave(a.clave);
  r = await pedir(fam, "POST", "conectar", { ...base, dueno: undefined });
  ok("sin dueño → 400", r.status === 400 && /de quién es el calendario/.test(r.datos.error), r);
  r = await pedir(fam, "POST", "conectar", { ...base, dueno: { ...dueno, correo: "mama-arroba-gmail" } });
  ok("Gmail del dueño inválido → 400", r.status === 400 && /correo no se ve bien/.test(r.datos.error), r);
  r = await pedir(fam, "POST", "conectar", { ...base, dueno: { ...dueno, correo: a.SA } });
  ok("el dueño no puede ser la cuenta de servicio → 400", r.status === 400 && /correo del panel/.test(r.datos.error), r);
  r = await pedir(fam, "POST", "conectar", { ...base, dueno: { ...dueno, rol: "abuela" } });
  ok("rol inválido → 400", r.status === 400 && /Madre, Padre u Otro adulto/.test(r.datos.error), r);
  r = await pedir(fam, "POST", "conectar", { ...base, dueno: { ...dueno, nombre: "   " } });
  ok("sin nombre → 400", r.status === 400, r);
  r = await pedir(fam, "POST", "conectar", { ...base, calendarioId: "https://calendar.google.com/calendar/u/0/r" });
  ok("ID inválido → 400 con dónde copiarlo", r.status === 400 && /Integrar el calendario/.test(r.datos.error), r);
  const reader = a.calendario(nuevoId(), "reader");
  r = await pedir(fam, "POST", "conectar", { ...base, calendarioId: reader });
  ok("reader → 400 PERMISO «solo para ver»", r.status === 400 && r.datos.codigo === "PERMISO" && /solo para ver/.test(r.datos.error), r);
  const sinCompartir = a.calendario(nuevoId(), "none");
  r = await pedir(fam, "POST", "conectar", { ...base, calendarioId: sinCompartir });
  ok("sin compartir → 424 NO_ENCONTRADO", r.status === 424 && r.datos.codigo === "NO_ENCONTRADO", r);
  sim.inyectar(es.tipo("events.list"), respuestas.error("SERVICE_DISABLED"), 1);
  r = await pedir(fam, "POST", "conectar", base);
  ok("API deshabilitada → 400 CONFIGURACION", r.status === 400 && r.datos.codigo === "CONFIGURACION", r);
  await st.setJSON("externos/google", { familiaId: "otra" });
  r = await pedir(fam, "POST", "conectar", base);
  ok("cuenta de otra familia → 409", r.status === 409, r);
  await st.delete("externos/google");
  const acc = await a.acceso(fam);
  ok("nada quedó conectado ni tomado", !(acc.calendarios ?? []).length && (await st.get("externos/google", { type: "json" })) === null, acc.calendarios);
});

await caso("conectar: bien, con el dueño, y la primera sincronización", async () => {
  restaurarInterruptores();
  const sueltas = ev("a3", { titulo: "Reunión", repeticion: "nunca", fechas: ["2026-11-10", "2026-12-08"] });
  const fam = await a.familia({ eventos: [ev("a1"), ev("a2", { repeticion: "semanal", diasSemana: [0, 2], fecha: "2026-11-09" }), sueltas] });
  const cal = a.calendario(nuevoId());
  const embed = `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(cal)}&ctz=America%2FSantiago`;
  const r = await pedir(fam, "POST", "conectar", { proveedor: "google", calendarioId: embed, dueno, subirExistentes: true });
  ok("200 con la conexión", r.status === 200 && r.datos.conexion?.nombre === "Familia", r);
  ok("aviso de las fechas sueltas", Array.isArray(r.datos.avisos) && r.datos.avisos[0] === "1 evento con fechas sueltas quedó solo en la pared.", r.datos);
  const acc = await a.acceso(fam);
  const c = acc.calendarios?.[0];
  ok("conexión google con url = ID (desde la dirección de «Integrar»), nombre y dueño", acc.calendarios.length === 1 && c.proveedor === "google" && c.url === cal && c.nombre === "Familia" && c.dueno?.correo === DUENA && c.dueno?.rol === "madre" && c.dueno?.miembroId === "mama", c);
  ok("la cuenta de servicio queda de esta familia", ((await st.get("externos/google", { type: "json" })) as any)?.familiaId === fam);
  ok("primera sincronización ok", r.datos.resultado?.ok === true, r.datos.resultado);
  const ids = vivos(cal).map((e: any) => e.id);
  ok("a1 y a2 subieron; las fechas sueltas no", ids.includes(idGoogleDe("a1@calendario-familiar")) && ids.includes(idGoogleDe("a2@calendario-familiar")) && !ids.includes(idGoogleDe("a3@calendario-familiar")), ids);
  const evs = await a.eventos(fam);
  ok("la de fechas sueltas quedó soloPanel", evs.find((e) => e.id === "a3")?.soloPanel === true, evs.find((e) => e.id === "a3"));

  const g = await pedir(fam, "GET", "");
  const cx = g.datos.conexiones?.[0];
  ok("GET muestra la conexión google con su ID y dueño", cx?.proveedor === "google" && cx.calendarioId === cal && cx.dueno?.nombre === "Carolina" && cx.eventos === 2 && cx.estado?.error === null, cx);

  const s = await pedir(fam, "POST", "sincronizar", {});
  ok("/sincronizar con google ok", s.status === 200 && s.datos.resultados?.[0]?.ok === true, s.datos);

  // Otra conexión → 409, de cualquier proveedor.
  const otro = a.calendario(nuevoId());
  const r2 = await pedir(fam, "POST", "conectar", { proveedor: "google", calendarioId: otro, dueno, subirExistentes: true });
  ok("con una conexión → 409 «Ya hay un calendario conectado («Familia»)»", r2.status === 409 && /Ya hay un calendario conectado \(«Familia»\)/.test(r2.datos.error), r2);
  process.env.ICLOUD_USUARIO = "familia@icloud.test";
  process.env.ICLOUD_CLAVE_APP = "x";
  process.env.ICLOUD_CALDAV_URL = "http://127.0.0.1:9/";
  const r3 = await pedir(fam, "POST", "conectar", { url: "http://127.0.0.1:9/cal/", subirExistentes: true });
  ok("iCloud con Google conectado → 409 (sin hablar con iCloud)", r3.status === 409 && /Familia/.test(r3.datos.error), r3);
  delete process.env.ICLOUD_USUARIO;
  delete process.env.ICLOUD_CLAVE_APP;
  delete process.env.ICLOUD_CALDAV_URL;

  // Desconectar libera la cuenta de servicio.
  const d = await pedir(fam, "POST", "desconectar", { id: c.id });
  ok("/desconectar → 200", d.status === 200 && d.datos.ok === true, d);
  ok("…libera externos/google", (await st.get("externos/google", { type: "json" })) === null);
  ok("…la conexión ya no está y los eventos quedan sin vínculo", !((await a.acceso(fam)).calendarios ?? []).length && (await a.eventos(fam)).every((e) => !e.externo), await a.eventos(fam));
  ok("…y en Google siguen los eventos", vivos(cal).length === 2, vivos(cal).length);

  // Otra familia ahora sí puede.
  const fam2 = await a.familia();
  const r4 = await pedir(fam2, "POST", "conectar", { proveedor: "google", calendarioId: otro, dueno, subirExistentes: true });
  ok("otra familia puede conectar después", r4.status === 200, r4);
  await pedir(fam2, "POST", "desconectar", { id: (await a.acceso(fam2)).calendarios[0].id });
});

await caso("conectar: subirExistentes=false y una conexión de iCloud", async () => {
  restaurarInterruptores();
  const fam = await a.familia({ eventos: [ev("b1"), ev("b2")] });
  const cal = a.calendario(nuevoId());
  const r = await pedir(fam, "POST", "conectar", { proveedor: "google", calendarioId: cal, dueno, subirExistentes: false });
  ok("200 y sin aviso de fechas sueltas", r.status === 200 && !r.datos.avisos, r.datos);
  const evs = await a.eventos(fam);
  ok("los eventos quedan solo en la pared y no suben", evs.every((e) => e.soloPanel === true) && vivos(cal).length === 0, [evs, vivos(cal).length]);
  await pedir(fam, "POST", "desconectar", { id: (await a.acceso(fam)).calendarios[0].id });

  const icloud = { id: "ic1", proveedor: "icloud", nombre: "Casa", url: "https://caldav.icloud.com/x/", creada: new Date().toISOString() };
  const fam2 = await a.familia({ calendarios: [icloud] });
  const r2 = await pedir(fam2, "POST", "conectar", { proveedor: "google", calendarioId: cal, dueno, subirExistentes: true });
  ok("con iCloud conectado → 409 «Ya hay un calendario de iCloud conectado»", r2.status === 409 && r2.datos.error === "Ya hay un calendario de iCloud conectado", r2);
  await st.setJSON("externos/icloud", { familiaId: fam2 });
  const d = await pedir(fam2, "POST", "desconectar", { id: "ic1" });
  ok("desconectar iCloud libera externos/icloud (como antes)", d.status === 200 && (await st.get("externos/icloud", { type: "json" })) === null, d);
});

await caso("conectar: dos a la vez → una sola conexión", async () => {
  restaurarInterruptores();
  const fam = await a.familia({ eventos: [ev("c1")] });
  const cal = a.calendario(nuevoId());
  sim.latenciaMs = 150;
  const cuerpo = { proveedor: "google", calendarioId: cal, dueno, subirExistentes: true };
  const [x, y] = await Promise.all([pedir(fam, "POST", "conectar", cuerpo), pedir(fam, "POST", "conectar", cuerpo)]);
  sim.latenciaMs = 0;
  const estados = [x.status, y.status].sort();
  const acc = await a.acceso(fam);
  ok("una 200 y otra 409", estados[0] === 200 && estados[1] === 409, [x, y]);
  ok("una sola conexión guardada", (acc.calendarios ?? []).length === 1, acc.calendarios);
  // El estado de la que perdió se borró: sólo queda el de la conexión que quedó.
  const lista = await st.list({ prefix: `externos/estado/${fam}/` });
  ok("un solo estado de sincronización", lista.blobs.length === 1 && lista.blobs[0].key.endsWith(acc.calendarios[0].id), lista.blobs);
  await pedir(fam, "POST", "desconectar", { id: acc.calendarios[0].id });
});

// ---------------------------------------------------------------------------------------------
seccion("Función programada");
await caso("programada: recorre a las dueñas de iCloud y de Google sin repetir", async () => {
  restaurarInterruptores();
  for (const k of ["externos/icloud", "externos/google"]) await st.delete(k);
  delete process.env.GOOGLE_CUENTA_SERVICIO;
  let r = await a.programado();
  ok("sin cuentas → no hace nada", (await r.text()) === "sin cuentas de calendario");
  usarClave(a.clave);
  r = await a.programado();
  ok("con Google pero sin familia → no hace nada", (await r.text()) === "sin familia conectada");

  const cal = a.calendario(nuevoId());
  const famG = await a.familia({ eventos: [ev("p1")] });
  const c = await pedir(famG, "POST", "conectar", { proveedor: "google", calendarioId: cal, dueno, subirExistentes: true });
  const conG = (await a.acceso(famG)).calendarios[0];
  ok("familia con Google conectada", c.status === 200 && conG?.proveedor === "google", c);

  // Una familia dueña de iCloud (con un servidor CalDAV que no responde: su vuelta falla rápido).
  const icloud = { id: "ic2", proveedor: "icloud", nombre: "Casa", url: "http://127.0.0.1:9/cal/", creada: new Date().toISOString() };
  const famI = await a.familia({ calendarios: [icloud] });
  await st.setJSON("externos/icloud", { familiaId: famI });

  r = await a.programado();
  let res = JSON.parse(await r.text());
  ok("sin iCloud configurado: sólo la de Google", res.length === 1 && res[0].conexion === conG.id && res[0].ok === true, res);

  process.env.ICLOUD_USUARIO = "familia@icloud.test";
  process.env.ICLOUD_CLAVE_APP = "x";
  process.env.ICLOUD_CALDAV_URL = "http://127.0.0.1:9/";
  r = await a.programado();
  res = JSON.parse(await r.text());
  ok("con los dos: una vuelta por cada familia", res.length === 2 && res.some((x: any) => x.conexion === conG.id && x.ok) && res.some((x: any) => x.conexion === "ic2"), res);

  // La misma familia dueña de las dos cuentas (p. ej. una marca vieja): no se repite.
  await st.setJSON("externos/icloud", { familiaId: famG });
  r = await a.programado();
  res = JSON.parse(await r.text());
  ok("misma familia en las dos claves → una sola vuelta", res.length === 1 && res[0].conexion === conG.id, res);

  delete process.env.GOOGLE_CUENTA_SERVICIO;
  r = await a.programado();
  res = JSON.parse(await r.text());
  ok("sin la clave de Google: la conexión google no se sincroniza", Array.isArray(res) && res.length === 0, res);
  usarClave(a.clave);
  delete process.env.ICLOUD_USUARIO;
  delete process.env.ICLOUD_CLAVE_APP;
  delete process.env.ICLOUD_CALDAV_URL;
  await st.delete("externos/icloud");
  await pedir(famG, "POST", "desconectar", { id: conG.id });
});

// ---------------------------------------------------------------------------------------------
seccion("Seguridad");
await caso("ningún pedido salió de 127.0.0.1 y la clave no aparece en respuestas", async () => {
  const fam = await a.familia();
  const r = await pedir(fam, "GET", "");
  const texto = JSON.stringify(r.datos);
  ok("la clave privada no está en el GET", !texto.includes("PRIVATE KEY") && !texto.includes(a.clave.pem.slice(40, 80)));
  // Una clave distinta a la registrada en el simulador → Google no la acepta (CLAVE), sin pedidos afuera.
  const otra = armarClave({ correo: "otra@prueba.iam.gserviceaccount.com" });
  usarClave(otra);
  olvidarTokens();
  const cal = a.calendario(nuevoId());
  const p = await pedir(fam, "POST", "probar", { calendarioId: cal });
  ok("cuenta desconocida → ❌ en el paso del token", pasos(p).token === "error", p.datos);
  usarClave(a.clave);
});

await a.fin();
