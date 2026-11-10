// Fantasmas rezagadas (marca cfv del principal) y el plazo de una vuelta: los 5 detalles de la revisión
// de 5734981, de punta a punta (motor real + transporte real + simulador + Blobs en memoria, ver h.ts).
//   1. Si Google rechaza el principal de una serie, la segunda vuelta de la misma sincronización la relee
//      aunque haya rezagadas de otra serie o eventos nuevos que suban (reserva RESERVA_RELEER).
//   2. Un cambio posterior de la serie no deja a las rezagadas como días cambiados cuando Google les pasa
//      el título (y les sube `updated`); sin pisar un día que alguien cambió de verdad.
//   3. Las fantasmas en línea no se comen el plazo de lo demás de la vuelta (MARGEN_EN_LINEA).
//   4. Una rezagada que falla siempre (500) no bloquea a las demás ni deja la sincronización pendiente.
//   5. Una rezagada que Google rechaza (400) se avisa una vez, no se reintenta y queda como día cambiado.
//
//   cd calendario && node --experimental-transform-types --no-warnings --import ./pruebas/registrar.mjs pruebas/google/rezagadas.test.ts
import * as h from "../h.ts";
import { respuestas, type PedidoVisto } from "./mock-google.mts";
import type { Evento } from "../../lib/datos/tipos.ts";

const { ok, seccion, caso, ev, gid } = h;
const sim = await h.arrancar({ semilla: 11 });
type Con = ReturnType<typeof h.conexionGoogle>;
const avisosDe = async (fam: string, con: Con) => (await h.estado(fam, con))?.avisos ?? [];
const invalido = () => respuestas.status(400, { error: { code: 400, message: "Invalid value", errors: [{ reason: "invalid", message: "Invalid value" }] } });
const caido = () => respuestas.status(500, { error: { code: 500, message: "Backend Error", errors: [{ reason: "backendError", message: "Backend Error" }] } });
/** Jueves desde el 19-nov-2026 (días de la serie «Teatro»). */
const jueves = (i: number) => new Date(Date.parse("2026-11-19T12:00:00Z") + i * 7 * 86_400_000).toISOString().slice(0, 10);
const excepciones = (cal: string, id: string) => h.vivos(cal).filter((e) => e.recurringEventId === gid(id));
const diasEnPared = async (fam: string) => (await h.leerEventos(fam)).filter((e) => e.externo?.recurrencia);
const conLatencia = async <T>(ms: number, f: () => Promise<T>): Promise<T> => {
  sim.latenciaMs = ms;
  try {
    return await f();
  } finally {
    sim.latenciaMs = 0;
  }
};

/** Una serie semanal «Teatro» (Sala 1) con `n` fantasmas (la web «edita» n jueves sin cambiar nada) y la pared al día. */
async function teatro(id: string, n: number, otros: Evento[] = []) {
  const cal = h.nuevoCalendario();
  const con = h.conexionGoogle(cal);
  const fam = await h.familia([
    ev(id, { titulo: "Teatro", repeticion: "semanal", fecha: "2026-11-12", repetirHasta: "2027-06-28", lugar: "Sala 1", horaInicio: "10:00", horaFin: "11:00" }),
    ...otros,
  ]);
  await h.sync(fam, con, 24_000);
  const web = sim.actor("web", cal);
  for (let i = 0; i < n; i++) web.editarDia(gid(id), jueves(i), {});
  await h.sync(fam, con, 24_000);
  return { cal, con, fam };
}

/**
 * Cambia la serie en la pared y sincroniza con las fantasmas caídas (500): el principal se escribe (con
 * la marca cfv) y sus fantasmas quedan rezagadas. `salvo`: ids de fantasmas que sí se ponen al día.
 */
async function dejarRezagadas(cal: string, con: Con, fam: string, id: string, cambio: Partial<Evento>, salvo: string[] = []) {
  await h.cambiarEvento(fam, id, cambio);
  await sinFantasmas(fam, con, id, salvo);
}
/** Una sincronización (24 s) en la que Google responde 500 al PATCH de las fantasmas de esa serie (salvo `salvo`). */
async function sinFantasmas(fam: string, con: Con, id: string, salvo: string[] = []) {
  const inj = sim.inyectar((p: PedidoVisto) => p.tipo === "events.patch" && p.eventoId !== gid(id) && !salvo.includes(String(p.eventoId)), caido(), 999);
  try {
    return await h.sync(fam, con, 24_000);
  } finally {
    inj.quitar();
  }
}

/**
 * Como si todo lo de esa serie hubiera pasado hace `ms`: corre hacia atrás el `updated` de sus piezas y
 * el «hasta» de las entradas de su marca cfv (sin cambiar los etag: el motor no ve nada distinto).
 */
function envejecer(cal: string, id: string, ms: number) {
  const atras = (iso: string) => new Date(Date.parse(iso) - ms).toISOString();
  for (const e of h.vivos(cal).filter((x) => x.id === gid(id) || x.recurringEventId === gid(id))) {
    const ext = e.extendedProperties as { private?: Record<string, string> } | undefined;
    const cfv = ext?.private?.cfv;
    const nueva =
      cfv &&
      cfv
        .split(",")
        .map((x) => {
          const m = /^([sdlh]\.[0-9a-f]{12}\.)([0-9a-z]+)$/.exec(x);
          return m ? m[1] + (parseInt(m[2], 36) - Math.round(ms / 1000)).toString(36) : x;
        })
        .join(",");
    sim.poner(cal, { ...e, updated: atras(String(e.updated)), ...(nueva ? { extendedProperties: { ...ext, private: { ...ext!.private, cfv: nueva } } } : {}) });
  }
}

// =====================================================================================
seccion("1. La segunda vuelta que deja la pared como Google cabe en la misma sincronización");

await caso("Google rechaza el principal y otra serie tiene rezagadas", async () => {
  // «Teatro» con 8 rezagadas (de un cambio de título anterior) y «Piano» con un día cambiado. En la pared
  // cambian el título de «Piano» y el lugar de su día; Google rechaza (400) el principal después de
  // escribir el día. Antes, pendientes() gastaba el plazo en las rezagadas de «Teatro» (latencia 400 ms) y
  // la segunda vuelta no cabía: la pared seguía con «Piano con la tía» hasta la sincronización siguiente.
  const piano = ev("p1", { titulo: "Piano", repeticion: "semanal", fecha: "2026-11-16", horaInicio: "17:00", horaFin: "18:00" });
  const { cal, con, fam } = await teatro("t1", 8, [piano]);
  sim.actor("web", cal).moverDia(gid("p1"), "2026-11-23", { dateTime: "2026-11-23T19:00:00-03:00", timeZone: "America/Santiago" }, { dateTime: "2026-11-23T20:00:00-03:00", timeZone: "America/Santiago" });
  await h.sync(fam, con, 24_000);
  await dejarRezagadas(cal, con, fam, "t1", { titulo: "Teatro musical" });
  const viejas = () => excepciones(cal, "t1").filter((e) => e.summary === "🦄 Teatro").length;
  ok("«Teatro» quedó con 8 rezagadas y la pared sin días cambiados de «Teatro»", viejas() === 8 && !(await diasEnPared(fam)).some((e) => e.externo?.uid.startsWith("t1")), viejas());
  await h.cambiarEvento(fam, "p1", { titulo: "Piano con la tía" });
  const dia = (await diasEnPared(fam)).find((e) => e.externo?.uid.startsWith("p1"))!;
  await h.cambiarEvento(fam, dia.id, { lugar: "Casa de la tía" });
  const inj = sim.inyectar((p: PedidoVisto) => p.tipo === "events.patch" && p.eventoId === gid("p1"), invalido(), 20);
  const r = await conLatencia(400, () => h.sync(fam, con, 6500)).finally(() => inj.quitar());
  const l = await h.leerEventos(fam);
  const avisos = await avisosDe(fam, con);
  const dif = (await h.comparar(fam, con)).filter((d) => d.startsWith("p1"));
  ok(
    "latencia 400 ms: en la misma sincronización la pared vuelve a «Piano» (como Google), con el aviso de Google",
    r.ok && l.find((e) => e.id === "p1")?.titulo === "Piano" && !dif.length && avisos.some((a) => /no aceptó "🦄 Piano con la tía": Invalid value/.test(a)),
    { r, avisos, piano: l.filter((e) => e.externo?.uid.startsWith("p1")).map(h.resumen), dif, viejas: viejas() },
  );
  const r2 = await h.sync(fam, con, 24_000);
  ok("…y la programada termina las rezagadas de «Teatro», sin días cambiados de más", r2.ok && viejas() === 0 && (await diasEnPared(fam)).length === 1 && !(await h.comparar(fam, con)).length, {
    r2,
    viejas: viejas(),
    dias: (await diasEnPared(fam)).map(h.resumen),
  });
});

await caso("Google rechaza el principal y en la misma tanda hay eventos nuevos", async () => {
  // Latencia 700 ms y 3 eventos nuevos: subirlos después del rechazo se comía el plazo de la segunda
  // vuelta. Ahora esperan a esa vuelta (TiempoSinEmpezar), que relee «Piano» y después los sube.
  const cal = h.nuevoCalendario();
  const con = h.conexionGoogle(cal);
  const fam = await h.familia([ev("p2", { titulo: "Piano", repeticion: "semanal", fecha: "2026-11-16", horaInicio: "17:00", horaFin: "18:00" })]);
  await h.sync(fam, con, 24_000);
  sim.actor("web", cal).moverDia(gid("p2"), "2026-11-23", { dateTime: "2026-11-23T19:00:00-03:00", timeZone: "America/Santiago" }, { dateTime: "2026-11-23T20:00:00-03:00", timeZone: "America/Santiago" });
  await h.sync(fam, con, 24_000);
  await h.cambiarEvento(fam, "p2", { titulo: "Piano con la tía" });
  const dia = (await diasEnPared(fam))[0];
  await h.cambiarEvento(fam, dia.id, { lugar: "Casa de la tía" });
  await h.guardarEventos(fam, (l) => [...l, ...[0, 1, 2].map((i) => ev(`x${i}`, { titulo: `Nuevo ${i}`, fecha: "2026-11-27" }))]);
  const inj = sim.inyectar((p: PedidoVisto) => p.tipo === "events.patch" && p.eventoId === gid("p2"), invalido(), 20);
  const r = await conLatencia(700, () => h.sync(fam, con, 6500)).finally(() => inj.quitar());
  const l = await h.leerEventos(fam);
  const dif = (await h.comparar(fam, con)).filter((d) => d.startsWith("p2"));
  ok(
    "latencia 700 ms: en la misma sincronización la pared vuelve a «Piano», con el aviso",
    r.ok && l.find((e) => e.id === "p2")?.titulo === "Piano" && !dif.length && (await avisosDe(fam, con)).some((a) => a.includes("Invalid value")),
    { r, avisos: await avisosDe(fam, con), dif },
  );
  await h.sync(fam, con, 24_000);
  ok("…y a más tardar la siguiente sube los 3 nuevos; todo calza", h.vivos(cal).filter((e) => /Nuevo/.test(e.summary ?? "")).length === 3 && !(await h.comparar(fam, con)).length, await h.comparar(fam, con));
});

// =====================================================================================
seccion("2. Un segundo cambio de la serie con rezagadas del primero (Google les pasa el título)");

await caso("las rezagadas que Google toca al aplicar el segundo cambio siguen siendo rezagadas", async () => {
  // Primer cambio (lugar) con 4 rezagadas; «pasan» 5 minutos (la marca ya no cubre algo tocado ahora); el
  // segundo cambio (título) lo aplica Google también a las excepciones y les sube `updated`. Antes esas 4
  // quedaban como días cambiados «Teatro v2 · Sala 1» para siempre (en la pared y en los iPhone), sin aviso.
  sim.interruptores.propagarTituloAExcepciones = true;
  try {
    const { cal, con, fam } = await teatro("t2", 4);
    await dejarRezagadas(cal, con, fam, "t2", { lugar: "Sala v1" });
    const enSala1 = () => excepciones(cal, "t2").filter((e) => e.location === "Sala 1").length;
    ok("4 rezagadas con «Sala 1»", enSala1() === 4, enSala1());
    envejecer(cal, "t2", 300_000);
    await sinFantasmas(fam, con, "t2");
    ok("…que siguen sin verse como días cambiados", enSala1() === 4 && !(await diasEnPared(fam)).length);
    await dejarRezagadas(cal, con, fam, "t2", { titulo: "Teatro v2" });
    ok(
      "después del segundo cambio: Google les pasó el título, siguen en «Sala 1» y la pared no muestra días cambiados",
      excepciones(cal, "t2").every((e) => e.summary === "🦄 Teatro v2") && enSala1() === 4 && !(await diasEnPared(fam)).length && !(await h.comparar(fam, con)).length,
      { exc: excepciones(cal, "t2").map((e) => [e.summary, e.location, e.updated]), dias: (await diasEnPared(fam)).map(h.resumen), dif: await h.comparar(fam, con) },
    );
    const r = await h.sync(fam, con, 24_000);
    ok(
      "…y la programada las pone al día: todas «Teatro v2 · Sala v1», sin días cambiados y la pared calza con Google",
      r.ok && enSala1() === 0 && excepciones(cal, "t2").every((e) => e.location === "Sala v1") && !(await diasEnPared(fam)).length && !(await h.comparar(fam, con)).length,
      { r, exc: excepciones(cal, "t2").map((e) => [e.summary, e.location]), dias: (await diasEnPared(fam)).map(h.resumen) },
    );
  } finally {
    sim.interruptores.propagarTituloAExcepciones = false;
  }
});

await caso("…sin pisar un día que alguien volvió al valor de antes", async () => {
  // Igual, pero en el iPhone alguien deja un día (ya al día, «Sala v1») de nuevo en «Sala 1»: es un día
  // cambiado de verdad. El segundo cambio vuelve a anotar la entrada de «Sala 1» de la marca; si la
  // extendiera, ese día pasaría a parecer rezagada y se pisaría. No se extiende.
  const { cal, con, fam } = await teatro("t3", 4);
  const primero = excepciones(cal, "t3").sort((a, b) => String(a.id).localeCompare(String(b.id)))[0];
  await dejarRezagadas(cal, con, fam, "t3", { lugar: "Sala v1" }, [primero.id]);
  ok("el primer día quedó al día y los otros 3, rezagados", sim.evento(cal, primero.id).location === "Sala v1" && excepciones(cal, "t3").filter((e) => e.location === "Sala 1").length === 3);
  envejecer(cal, "t3", 300_000);
  sim.actor("iPhone", cal).editar(primero.id, { location: "Sala 1" });
  await sinFantasmas(fam, con, "t3");
  const visto = async () => (await diasEnPared(fam)).find((e) => e.externo?.recurrencia && e.lugar === "Sala 1");
  ok("la pared muestra ese día como cambiado («Sala 1») y las otras 3 siguen rezagadas", !!(await visto()) && (await diasEnPared(fam)).length === 1 && excepciones(cal, "t3").filter((e) => e.location === "Sala 1").length === 4, (await diasEnPared(fam)).map(h.resumen));
  await h.cambiarEvento(fam, "t3", { titulo: "Teatro v2" });
  await h.sync(fam, con, 24_000);
  await h.sync(fam, con, 24_000);
  ok(
    "después del segundo cambio y otra sincronización: ese día sigue en «Sala 1» (en Google y en la pared) y las 3 rezagadas están al día",
    sim.evento(cal, primero.id).location === "Sala 1" &&
      !!(await visto()) &&
      excepciones(cal, "t3").filter((e) => e.id !== primero.id).every((e) => e.location === "Sala v1" && e.summary === "🦄 Teatro v2") &&
      !(await h.comparar(fam, con)).length,
    { exc: excepciones(cal, "t3").map((e) => [e.id === primero.id, e.summary, e.location]), dias: (await diasEnPared(fam)).map(h.resumen), dif: await h.comparar(fam, con) },
  );
});

// =====================================================================================
seccion("3. Las fantasmas en línea no se comen el plazo de lo demás");

await caso("3 series con 2 fantasmas cada una, un evento borrado, otro editado y 2 nuevos, latencia 400 ms", async () => {
  // Antes, con ≤3 fantasmas por serie se ponían al día en la misma pasada que el principal si alcanzaban
  // justo, y «Dentista» y «Pediatra» (nuevos) quedaban para la sincronización siguiente.
  const cal = h.nuevoCalendario();
  const con = h.conexionGoogle(cal);
  const series = ["s1", "s2", "s3"];
  const fam = await h.familia([
    ...series.map((id, k) => ev(id, { titulo: `Serie ${k + 1}`, repeticion: "semanal", fecha: "2026-11-12", repetirHasta: "2027-06-28", lugar: `Sala ${k + 1}` })),
    ev("b1", { titulo: "Borrar", fecha: "2026-11-21" }),
    ev("e1", { titulo: "Editar", fecha: "2026-11-22" }),
  ]);
  await h.sync(fam, con, 24_000);
  const web = sim.actor("web", cal);
  for (const id of series) for (let i = 0; i < 2; i++) web.editarDia(gid(id), jueves(2 * i), {});
  await h.sync(fam, con, 24_000);
  for (const [k, id] of series.entries()) await h.cambiarEvento(fam, id, { titulo: `Serie ${k + 1} musical` });
  await h.guardarEventos(fam, (l) => [...l.filter((e) => e.id !== "b1"), ev("n1", { titulo: "Dentista", fecha: "2026-11-20" }), ev("n2", { titulo: "Pediatra", fecha: "2026-11-25" })]);
  await h.cambiarEvento(fam, "e1", { titulo: "Editado" });
  const r = await conLatencia(400, () => h.sync(fam, con, 6500));
  const sube = (t: string) => h.vivos(cal).some((e) => (e.summary ?? "").endsWith(t));
  ok(
    "en la sincronización normal suben los 3 títulos, el borrado, el editado, «Dentista» y «Pediatra»; la pared sin días cambiados y como Google",
    r.ok &&
      series.every((id, k) => sim.evento(cal, gid(id))?.summary === `🦄 Serie ${k + 1} musical`) &&
      !sube("Borrar") &&
      sube("Editado") &&
      sube("Dentista") &&
      sube("Pediatra") &&
      !(await diasEnPared(fam)).length &&
      !(await h.comparar(fam, con)).length,
    { r, porTipo: sim.contadores.porTipo, dif: await h.comparar(fam, con) },
  );
  await h.sync(fam, con, 24_000);
  ok("…y la programada pone al día las 6 fantasmas", series.every((id, k) => excepciones(cal, id).every((e) => e.summary === `🦄 Serie ${k + 1} musical`)) && !(await h.comparar(fam, con)).length);
});

// =====================================================================================
seccion("4 y 5. Una rezagada que Google no deja poner al día");

/** «Teatro» con 3 rezagadas de un cambio de título; devuelve también la más próxima (la primera que se intenta). */
async function tresRezagadas(id: string) {
  const x = await teatro(id, 3);
  await dejarRezagadas(x.cal, x.con, x.fam, id, { titulo: "Teatro de títeres" });
  const viejas = () => excepciones(x.cal, id).filter((e) => e.summary === "🦄 Teatro");
  const mala = viejas().sort((a, b) => String(a.originalStartTime?.dateTime).localeCompare(String(b.originalStartTime?.dateTime)))[0];
  return { ...x, viejas, mala };
}
/** Una sincronización normal con algo nuevo en la pared (así no es el atajo): {pendiente, listados, avisos}. */
async function otraNormal(fam: string, con: Con, i: number) {
  await h.guardarEventos(fam, (l) => [...l, ev(`suelto${i}`, { titulo: `Suelto ${i}`, fecha: `2026-12-0${i + 1}` })]);
  sim.reiniciarContadores();
  const r = await h.sync(fam, con, 6500);
  const est = await h.estado(fam, con);
  return { ok: r.ok, pendiente: est?.pendiente, listados: sim.contadores.porTipo["events.list"] ?? 0, avisos: est?.avisos ?? [] };
}

await caso("4. Google responde 500 siempre al PATCH de una rezagada", async () => {
  // Antes: pendientes() se detenía en ella (la más próxima, la primera de la cola), las otras 2 nunca se
  // ponían al día, la sincronización quedaba «pendiente» para siempre y daba 3 vueltas (3 listados).
  const { cal, con, fam, viejas, mala } = await tresRezagadas("t4");
  ok("3 rezagadas", viejas().length === 3, viejas().length);
  const falla = sim.inyectar((p: PedidoVisto) => p.tipo === "events.patch" && p.eventoId === mala.id, caido(), 999);
  const h1 = [];
  try {
    for (let i = 0; i < 3; i++) h1.push(await otraNormal(fam, con, i));
  } finally {
    falla.quitar();
  }
  ok(
    "las otras 2 se ponen al día; ninguna sincronización queda pendiente por ella ni lista el calendario más de una vez",
    viejas().length === 1 && viejas()[0].id === mala.id && h1.every((x) => x.ok && x.pendiente === false && x.listados === 1),
    { viejas: viejas().map((e) => e.id), h1 },
  );
  ok("mientras tanto la pared no la muestra como día cambiado", !(await diasEnPared(fam)).length && !(await h.comparar(fam, con)).length);
  await otraNormal(fam, con, 3);
  ok("sin la falla, la próxima que lista el calendario la termina", viejas().length === 0 && !(await diasEnPared(fam)).length && !(await h.comparar(fam, con)).length, viejas().length);
});

await caso("5. Google rechaza (400) el PATCH de una rezagada", async () => {
  // Antes: se reintentaba y avisaba en cada sincronización que no fuera el atajo, por un día que nadie
  // tocó y que la pared no mostraba. Ahora: un aviso, se excluye de la marca y pasa a verse como día
  // cambiado (igual que en Google y en los iPhone); no se reintenta.
  const { cal, con, fam, viejas, mala } = await tresRezagadas("t5");
  const rechazo = sim.inyectar((p: PedidoVisto) => p.tipo === "events.patch" && p.eventoId === mala.id, invalido(), 999);
  const h1 = [];
  try {
    for (let i = 0; i < 3; i++) h1.push(await otraNormal(fam, con, i));
  } finally {
    rechazo.quitar();
  }
  const conAviso = h1.filter((x) => x.avisos.some((a) => /no aceptó el cambio del día .* de "🦄 Teatro de títeres": Invalid value/.test(a))).length;
  ok("el aviso sale en una sola sincronización y el PATCH rechazado no se repite", conAviso === 1 && rechazo.disparos === 1, { conAviso, disparos: rechazo.disparos, h1 });
  const dias = await diasEnPared(fam);
  ok(
    "las otras 2 al día; ese día se ve como cambiado (con el título viejo), igual que en Google; nada pendiente",
    viejas().length === 1 && dias.length === 1 && dias[0].titulo === "Teatro" && !(await h.comparar(fam, con)).length && h1.every((x) => x.ok && x.pendiente === false),
    { dias: dias.map(h.resumen), dif: await h.comparar(fam, con), h1 },
  );
  ok("la marca de la serie lo tiene excluido (x.…)", /(^|,)x\.[0-9a-f]{12}($|,)/.test(sim.evento(cal, gid("t5"))?.extendedProperties?.private?.cfv ?? ""), sim.evento(cal, gid("t5"))?.extendedProperties);
});

await caso("5b. Google rechaza (400) a una fantasma en línea", async () => {
  // Una sola fantasma, con plazo de sobra: se pone al día en la misma pasada que el principal. Si Google la
  // rechaza, el aviso sale una vez y no vuelve en las sincronizaciones siguientes.
  const { cal, con, fam } = await teatro("t6", 1);
  const f = excepciones(cal, "t6")[0];
  await h.cambiarEvento(fam, "t6", { titulo: "Teatro de sombras" });
  const rechazo = sim.inyectar((p: PedidoVisto) => p.tipo === "events.patch" && p.eventoId === f.id, invalido(), 999);
  const h1 = [];
  try {
    sim.reiniciarContadores();
    const r = await h.sync(fam, con, 24_000);
    h1.push({ ok: r.ok, avisos: await avisosDe(fam, con) });
    for (let i = 0; i < 2; i++) h1.push(await otraNormal(fam, con, i));
  } finally {
    rechazo.quitar();
  }
  const conAviso = h1.filter((x) => x.avisos.some((a) => /Invalid value/.test(a))).length;
  ok("un aviso, un solo PATCH rechazado; ese día se ve como cambiado, como en Google", conAviso === 1 && rechazo.disparos === 1 && (await diasEnPared(fam)).length === 1 && !(await h.comparar(fam, con)).length, {
    conAviso,
    disparos: rechazo.disparos,
    h1,
    dias: (await diasEnPared(fam)).map(h.resumen),
  });
});

seccion("Al final");
ok("ningún pedido salió de esta máquina", h.urlsVistas.length > 0 && h.urlsVistas.every((u) => u.startsWith("http://127.0.0.1:")));
await h.terminar();
