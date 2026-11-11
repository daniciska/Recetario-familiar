// Fantasmas rezagadas (marca cfv del principal) y el plazo de una vuelta: los 5 detalles de la revisión
// de 5734981 y lo que encontraron los verificadores de su primer arreglo, de punta a punta (motor real +
// transporte real + simulador + Blobs en memoria, ver h.ts).
//   1. Si Google rechaza el principal de una serie, la segunda vuelta de la misma sincronización la relee
//      aunque haya rezagadas de otra serie o eventos nuevos que suban (reserva RESERVA_RELEER).
//   2. Un cambio posterior de la serie no deja a las rezagadas como días cambiados cuando Google les pasa
//      el título (y les sube `updated`): se extienden por id, sin pisar un día que alguien cambió de verdad
//      (ni uno que la web deja con el valor de antes justo después: (d)).
//   3. Las fantasmas en línea, como en 5734981 (si caben). El etag de la serie no cuenta las fantasmas, así
//      que se prevé aunque se pongan al día más tarde: borrar en la pared justo después de un cambio no
//      hace volver el evento, con 1 a 4 fantasmas y latencia de hasta 900 ms (a).
//   4. Una rezagada que falla siempre (500) no bloquea a las demás ni deja la sincronización pendiente, y
//      un error pasajero no las deja olvidadas: la sincronización siguiente no toma el atajo (c).
//   5. Una rezagada que Google rechaza (400) se avisa una vez y no se reintenta mientras su etag no cambie
//      (marca n.<id>.<etag>), también con más de 8 en una serie (b) y con el plazo justo (e); sigue siendo
//      rezagada (la pared no ve nada distinto), así que lo que la familia cambie o borre después en esa
//      serie no se pierde ni vuelve (6).
//
//   cd calendario && node --experimental-transform-types --no-warnings --import ./pruebas/registrar.mjs pruebas/google/rezagadas.test.ts
import { createHash } from "node:crypto";
import * as h from "../h.ts";
import { respuestas, type PedidoVisto } from "./mock-google.mts";
import type { Evento } from "../../lib/datos/tipos.ts";

const { ok, seccion, caso, ev, gid } = h;
const sim = await h.arrancar({ semilla: 11 });
type Con = ReturnType<typeof h.conexionGoogle>;
const avisosDe = async (fam: string, con: Con) => (await h.estado(fam, con))?.avisos ?? [];
const invalido = () => respuestas.status(400, { error: { code: 400, message: "Invalid value", errors: [{ reason: "invalid", message: "Invalid value" }] } });
const caido = () => respuestas.status(500, { error: { code: 500, message: "Backend Error", errors: [{ reason: "backendError", message: "Backend Error" }] } });
const limite = () => respuestas.status(429, { error: { code: 429, message: "Rate Limit Exceeded", errors: [{ reason: "rateLimitExceeded", message: "Rate Limit Exceeded" }] } });
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
          const m = /^([sdlhi]\.[0-9a-f]{12}\.)([0-9a-z]+)$/.exec(x);
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
  // cambiado de verdad. El segundo cambio vuelve a anotar la entrada de «Sala 1» de la marca con su hasta
  // de antes y extiende sólo a las 3 rezagadas, por su id: ese día no pasa a parecer rezagada.
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

await caso("(d) un día que la web deja con el valor de antes justo después del segundo cambio no se pisa", async () => {
  // El primer arreglo extendía por valor la entrada «Sala 1» de la marca al segundo cambio: un jueves que
  // alguien dejaba a propósito en «Sala 1» en Google web dentro de esos 2 min pasaba por rezagada, la pared
  // no lo mostraba y la programada lo «ponía al día» a «Sala v1» (se perdía el cambio de la web).
  const { cal, con, fam } = await teatro("t7", 3);
  await dejarRezagadas(cal, con, fam, "t7", { lugar: "Sala v1" });
  envejecer(cal, "t7", 300_000);
  await dejarRezagadas(cal, con, fam, "t7", { titulo: "Teatro musical" });
  const dia = jueves(6);
  sim.actor("web", cal).editarDia(gid("t7"), dia, { location: "Sala 1" });
  const suyo = () => excepciones(cal, "t7").find((e) => String(e.originalStartTime?.dateTime ?? "").startsWith(dia));
  ok("hay 3 rezagadas y el día de la web", excepciones(cal, "t7").filter((e) => e.location === "Sala 1").length === 4 && !!suyo());
  await h.sync(fam, con, 24_000);
  await h.sync(fam, con, 24_000);
  const dias = await diasEnPared(fam);
  ok(
    "el día de la web sigue en «Sala 1» (Google y pared, como día cambiado); las 3 rezagadas al día; todo calza",
    suyo()?.location === "Sala 1" &&
      dias.length === 1 &&
      dias[0].lugar === "Sala 1" &&
      excepciones(cal, "t7").filter((e) => e.id !== suyo()?.id).every((e) => e.location === "Sala v1" && e.summary === "🦄 Teatro musical") &&
      !(await h.comparar(fam, con)).length,
    { suyo: suyo()?.location, dias: dias.map(h.resumen), exc: excepciones(cal, "t7").map((e) => [e.summary, e.location]) },
  );
});

await caso("(d) un día movido de hora que la web toca no impide que las rezagadas sigan siéndolo", async () => {
  // El primer arreglo no extendía la marca si algún día cambiado tenía el valor de antes y se había tocado
  // después del hasta viejo, aunque ese día (movido de hora) nunca pudiera ser rezagada: las 4 quedaban
  // como días cambiados «Teatro v2 · Sala 1» para siempre. Con la extensión por id no importa.
  sim.interruptores.propagarTituloAExcepciones = true;
  try {
    const { cal, con, fam } = await teatro("t8", 4);
    const web = sim.actor("web", cal);
    const d6 = jueves(6);
    web.moverDia(gid("t8"), d6, { dateTime: `${d6}T15:00:00-03:00`, timeZone: "America/Santiago" }, { dateTime: `${d6}T16:00:00-03:00`, timeZone: "America/Santiago" });
    await h.sync(fam, con, 24_000);
    const movido = () => excepciones(cal, "t8").find((e) => e.start?.dateTime?.includes("T15:00"));
    const enSala1 = () => excepciones(cal, "t8").filter((e) => e.location === "Sala 1" && e.id !== movido()?.id).length;
    const fantasmas = new Set(excepciones(cal, "t8").filter((e) => e.id !== movido()?.id).map((e) => e.id));
    await h.cambiarEvento(fam, "t8", { lugar: "Sala v1" });
    await sinFantasmas(fam, con, "t8", [movido()!.id]);
    ok("4 rezagadas con «Sala 1» y el día movido como día cambiado", enSala1() === 4 && fantasmas.size === 4 && (await diasEnPared(fam)).length === 1, (await diasEnPared(fam)).map(h.resumen));
    envejecer(cal, "t8", 300_000);
    web.editar(movido()!.id, { description: "Traer entrada" });
    await sinFantasmas(fam, con, "t8", [movido()!.id]);
    await h.cambiarEvento(fam, "t8", { titulo: "Teatro v2" });
    await sinFantasmas(fam, con, "t8", [movido()!.id]);
    ok("después del segundo cambio la pared sólo muestra el día movido (las 4 siguen rezagadas)", (await diasEnPared(fam)).length === 1 && enSala1() === 4, (await diasEnPared(fam)).map(h.resumen));
    await h.sync(fam, con, 24_000);
    ok("…y la programada las pone al día (Sala v1); el día movido conserva su nota; todo calza", enSala1() === 0 && (await diasEnPared(fam)).length === 1 && sim.evento(cal, movido()!.id).description === "Traer entrada" && !(await h.comparar(fam, con)).length, {
      n: enSala1(),
      dias: (await diasEnPared(fam)).map(h.resumen),
      dif: await h.comparar(fam, con),
    });
  } finally {
    sim.interruptores.propagarTituloAExcepciones = false;
  }
});

// =====================================================================================
seccion("3. Fantasmas en línea como en 5734981, y el etag previsto aunque no quepan");

await caso("(a) cambiar la serie y borrarla enseguida en la pared, con 1 a 4 fantasmas: se borra (no vuelve)", async () => {
  // El primer arreglo exigía 2,5 s de margen para mandar las fantasmas en línea, lo que casi nunca cabía en
  // la sincronización normal: la serie quedaba con etag null y, si la familia la borraba antes de que otra
  // sincronización la releyera, el motor lo veía como «cambió en los dos lados», ganaba Google y el evento
  // volvía. Con 4 fantasmas (nunca en línea) pasaba también en 5734981. Ahora el etag no cuenta las
  // fantasmas: se prevé apenas se escribe el principal.
  for (const [k, lat] of [
    [1, 900],
    [3, 400],
    [4, 0],
    [4, 900],
  ] as const) {
    const id = `b${k}x${lat}`;
    const { cal, con, fam } = await teatro(id, k);
    await h.cambiarEvento(fam, id, { titulo: "Teatro musical" });
    const r1 = await conLatencia(lat, () => h.sync(fam, con, 6500));
    const rec = Object.entries((await h.estado(fam, con))?.recursos ?? {}).find(([u]) => u.startsWith(id))?.[1];
    const enPared = async () => (await h.leerEventos(fam)).filter((e) => e.id === id || (e.externo?.uid ?? "").startsWith(id));
    await h.guardarEventos(fam, (l) => l.filter((e) => e.id !== id && !(e.externo?.uid ?? "").startsWith(id)));
    const r2 = await conLatencia(lat, () => h.sync(fam, con, 6500));
    ok(
      `${k} fantasma(s), latencia ${lat} ms: el etag quedó previsto y el borrado llega a Google en la sincronización siguiente`,
      r1.ok && !!rec?.etag && r2.ok && !(await enPared()).length && sim.evento(cal, gid(id))?.status === "cancelled",
      { r1, etag: rec?.etag ?? null, r2, pared: (await enPared()).map(h.resumen), google: sim.evento(cal, gid(id))?.status },
    );
    await h.sync(fam, con, 24_000);
    ok(`${k} fantasma(s), latencia ${lat} ms: …y sigue así tras la programada`, !(await enPared()).length);
  }
});

await caso("3 series con 2 fantasmas cada una, un evento borrado, otro editado y 2 nuevos, latencia 400 ms", async () => {
  // Las fantasmas en línea gastan plazo y lo nuevo de la vuelta («Dentista», «Pediatra») puede quedar para
  // la sincronización siguiente, como en 5734981 (el margen que se probó para evitarlo traía (a)). Nada se
  // pierde ni se ve distinto: la pared sin días cambiados y, a más tardar en la siguiente, todo en Google.
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
  const est = await h.estado(fam, con);
  ok(
    "en la sincronización normal suben los 3 títulos, el borrado y el editado; las 3 series con etag previsto; la pared sin días cambiados",
    r.ok &&
      series.every((id, k) => sim.evento(cal, gid(id))?.summary === `🦄 Serie ${k + 1} musical`) &&
      !sube("Borrar") &&
      sube("Editado") &&
      series.every((id) => !!Object.entries(est?.recursos ?? {}).find(([u]) => u.startsWith(id))?.[1]?.etag) &&
      !(await diasEnPared(fam)).length,
    { r, porTipo: sim.contadores.porTipo, dias: (await diasEnPared(fam)).map(h.resumen) },
  );
  await h.sync(fam, con, 6500);
  ok(
    "…y a más tardar la siguiente sube «Dentista» y «Pediatra» y pone al día las 6 fantasmas; todo calza",
    sube("Dentista") && sube("Pediatra") && series.every((id, k) => excepciones(cal, id).every((e) => e.summary === `🦄 Serie ${k + 1} musical`)) && !(await h.comparar(fam, con)).length,
    await h.comparar(fam, con),
  );
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

await caso("(c) un error pasajero en una vuelta que no escribe nada más no deja las rezagadas olvidadas", async () => {
  // La web cambia otro evento (así la normal lista) y Google responde 429 una vez, o 500 a las 3 rezagadas.
  // Antes nada más se escribía, el ctag del listado calzaba y las sincronizaciones siguientes tomaban el
  // atajo: las rezagadas seguían con el título viejo (en Google y en los iPhone) hasta que cambiara otra cosa.
  // Ahora listar deja el ctag sin calzar mientras queden rezagadas; un límite de uso deja la vuelta pendiente.
  for (const [modo, veces] of [
    ["429", 1],
    ["500", 3],
  ] as const) {
    const id = `c${modo}`;
    const otro = `o${modo}`;
    const x = await teatro(id, 3, [ev(otro, { titulo: "Otro", fecha: "2026-11-25" })]);
    await dejarRezagadas(x.cal, x.con, x.fam, id, { titulo: "Teatro de títeres" });
    const viejas = () => excepciones(x.cal, id).filter((e) => e.summary === "🦄 Teatro").length;
    ok(`${modo}: 3 rezagadas`, viejas() === 3, viejas());
    sim.actor("web", x.cal).editar(gid(otro), { location: "Casa" });
    const inj = sim.inyectar((p: PedidoVisto) => p.tipo === "events.patch" && p.eventoId !== gid(id), modo === "429" ? limite() : caido(), veces);
    await h.sync(x.fam, x.con, 6500).finally(() => inj.quitar());
    const hist = [];
    for (let i = 0; i < 2; i++) {
      sim.reiniciarContadores();
      const r = await h.sync(x.fam, x.con, 6500);
      hist.push({ ok: r.ok, pendiente: (await h.estado(x.fam, x.con))?.pendiente, listados: sim.contadores.porTipo["events.list"] ?? 0, viejas: viejas() });
    }
    ok(
      `${modo} ×${veces}: sin otro cambio, a más tardar la sincronización siguiente las pone al día; sin quedar pendiente ni dar más vueltas; todo calza`,
      inj.disparos === veces && hist[0].viejas === 0 && hist.every((y) => y.ok && y.pendiente === false && y.listados === 1) && !(await h.comparar(x.fam, x.con)).length,
      { disparos: inj.disparos, hist, dif: await h.comparar(x.fam, x.con) },
    );
  }
});

/** La marca cfv tiene a esa pieza como rechazada (n.<huella del id>.<huella de su etag>). */
const rechazadaEnMarca = (cal: string, id: string, x: { id: string; etag?: string }) => {
  const hv = (v: string) => createHash("sha256").update(v).digest("hex").slice(0, 12);
  return (sim.evento(cal, gid(id))?.extendedProperties?.private?.cfv ?? "").split(",").includes(`n.${hv(x.id)}.${hv(x.etag ?? "")}`);
};

await caso("5. Google rechaza (400) el PATCH de una rezagada", async () => {
  // 5734981: se reintentaba y avisaba en cada sincronización que no fuera el atajo, por un día que nadie
  // tocó y que la pared no mostraba. f6411fd: un aviso, pero se excluía de la marca y pasaba a verse como
  // día cambiado sin que el motor releyera la serie (el cambio siguiente de la familia se perdía). Ahora:
  // un aviso, se anota como rechazada y sigue sin verse; no se reintenta.
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
    "las otras 2 al día; ese día sigue sin verse como cambiado (es una rezagada); nada pendiente y 1 listado por sincronización",
    viejas().length === 1 && !dias.length && !(await h.comparar(fam, con)).length && h1.every((x) => x.ok && x.pendiente === false && x.listados === 1),
    { dias: dias.map(h.resumen), dif: await h.comparar(fam, con), h1 },
  );
  ok("la marca de la serie la tiene como rechazada, con su etag (n.…)", rechazadaEnMarca(cal, "t5", viejas()[0]), sim.evento(cal, gid("t5"))?.extendedProperties);
});

await caso("5c. Un día rechazado vuelve a intentarse si su etag cambia", async () => {
  const { cal, con, fam, viejas, mala } = await tresRezagadas("t5c");
  const rechazo = sim.inyectar((p: PedidoVisto) => p.tipo === "events.patch" && p.eventoId === mala.id, invalido(), 999);
  const h1 = [];
  const tocar = () => sim.poner(cal, { ...sim.evento(cal, mala.id), etag: undefined }); // otro etag, mismo `updated`
  try {
    for (let i = 0; i < 2; i++) h1.push(await otraNormal(fam, con, i));
    ok("rechazada una vez", rechazo.disparos === 1 && rechazadaEnMarca(cal, "t5c", sim.evento(cal, mala.id)), rechazo.disparos);
    tocar();
    for (let i = 2; i < 4; i++) h1.push(await otraNormal(fam, con, i));
  } finally {
    rechazo.quitar();
  }
  const conAviso = h1.filter((x) => x.avisos.some((a) => /Invalid value/.test(a))).length;
  ok("con otro etag se intenta una vez más (y se avisa de nuevo), y queda anotada con el etag nuevo", rechazo.disparos === 2 && conAviso === 2 && rechazadaEnMarca(cal, "t5c", sim.evento(cal, mala.id)), { disparos: rechazo.disparos, conAviso, h1 });
  tocar();
  await otraNormal(fam, con, 4);
  ok("si Google la acepta, queda al día; todo calza", viejas().length === 0 && !(await diasEnPared(fam)).length && !(await h.comparar(fam, con)).length, viejas().length);
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
  ok("un aviso, un solo PATCH rechazado; ese día sigue sin verse como cambiado; todo calza", conAviso === 1 && rechazo.disparos === 1 && !(await diasEnPared(fam)).length && !(await h.comparar(fam, con)).length && rechazadaEnMarca(cal, "t6", f), {
    conAviso,
    disparos: rechazo.disparos,
    h1,
    dias: (await diasEnPared(fam)).map(h.resumen),
  });
});

await caso("(b) 10 rezagadas rechazadas en una serie: un aviso, sin reintentos ni bucle", async () => {
  // El primer arreglo guardaba a lo más 8 excluidas: las que sobraban volvían a intentarse, el PATCH de
  // exclusión sacaba a otras y así en cada sincronización (pendiente para siempre, 3 listados, avisos de
  // nuevo y la pared distinta de Google). Ahora las rechazadas no se descartan nunca.
  const { cal, con, fam } = await teatro("t9", 10);
  await dejarRezagadas(cal, con, fam, "t9", { titulo: "Teatro de títeres" });
  const viejas = () => excepciones(cal, "t9").filter((e) => e.summary === "🦄 Teatro").length;
  ok("10 rezagadas", viejas() === 10, viejas());
  const rechazo = sim.inyectar((p: PedidoVisto) => p.tipo === "events.patch" && p.eventoId !== gid("t9"), invalido(), 9999);
  const h1 = [];
  try {
    for (let i = 0; i < 4; i++) h1.push({ ...(await otraNormal(fam, con, i)), rechazados: rechazo.disparos });
  } finally {
    rechazo.quitar();
  }
  const conAviso = h1.filter((x) => x.avisos.some((a) => /no aceptó el cambio del día/.test(a))).length;
  const cfv = sim.evento(cal, gid("t9"))?.extendedProperties?.private?.cfv ?? "";
  ok("cada PATCH rechazado una sola vez y el aviso en una sola sincronización", rechazo.disparos === 10 && h1[0].rechazados === 10 && conAviso === 1, { disparos: rechazo.disparos, conAviso, h1 });
  ok(
    "las 10 rechazadas en la marca; ningún día cambiado en la pared; nada pendiente y 1 listado por sincronización",
    cfv.split(",").filter((x) => x.startsWith("n.")).length === 10 && !(await diasEnPared(fam)).length && !(await h.comparar(fam, con)).length && h1.every((x) => x.ok && x.pendiente === false && x.listados === 1),
    { cfv, dias: (await diasEnPared(fam)).length, h1 },
  );
});

await caso("(e) con el plazo justo (2 series con 6 fantasmas, latencia 400 ms) el aviso sale una vez", async () => {
  // La exclusión iba al final de pendientes() y con el plazo justo no alcanzaba: el aviso y el PATCH
  // rechazado se repetían 2 o 3 sincronizaciones. Ahora se reserva su plazo antes de intentar cada rezagada.
  const cal = h.nuevoCalendario();
  const con = h.conexionGoogle(cal);
  const ids = ["e6a", "e6b"];
  const fam = await h.familia(ids.map((id, k) => ev(id, { titulo: `Serie ${k}`, repeticion: "semanal", fecha: "2026-11-12", repetirHasta: "2027-06-28", lugar: "Sala", horaInicio: `1${k}:00`, horaFin: `1${k}:30` })));
  await h.sync(fam, con, 24_000);
  const web = sim.actor("web", cal);
  for (const id of ids) for (let i = 0; i < 6; i++) web.editarDia(gid(id), jueves(i), {});
  await h.sync(fam, con, 24_000);
  const exc = (id: string) => excepciones(cal, id).sort((a, b) => String(a.originalStartTime?.dateTime).localeCompare(String(b.originalStartTime?.dateTime)));
  const malas = new Set(ids.map((id) => exc(id)[0].id));
  const rechazo = sim.inyectar((p: PedidoVisto) => p.tipo === "events.patch" && malas.has(String(p.eventoId)), invalido(), 9999);
  for (const [k, id] of ids.entries()) await h.cambiarEvento(fam, id, { titulo: `Serie ${k} nueva` });
  const hist = [];
  try {
    for (let i = 0; i < 5; i++) {
      if (i) await h.guardarEventos(fam, (l) => [...l, ev(`e6s${i}`, { titulo: `Suelto ${i}`, fecha: `2026-12-0${i + 1}` })]);
      const antes = rechazo.disparos;
      const r = await conLatencia(400, () => h.sync(fam, con, i === 4 ? 24_000 : 6500));
      const est = await h.estado(fam, con);
      hist.push({ ok: r.ok, pendiente: est?.pendiente, rechazados: rechazo.disparos - antes, avisos: (est?.avisos ?? []).filter((a) => /Invalid value/.test(a)).length });
    }
  } finally {
    rechazo.quitar();
  }
  ok("los 2 días rechazados: cada uno se intenta una vez y el aviso sale en una sola sincronización", rechazo.disparos === 2 && hist.filter((x) => x.avisos).length === 1, hist);
  ok(
    "al final, una rezagada vieja por serie (la rechazada), sin verse en la pared; nada pendiente; todo calza",
    ids.every((id, k) => exc(id).filter((e) => e.summary === `🦄 Serie ${k}`).length === 1) && !(await diasEnPared(fam)).length && hist.slice(-2).every((x) => x.ok && x.pendiente === false) && !(await h.comparar(fam, con)).length,
    { hist, dif: await h.comparar(fam, con) },
  );
});

seccion("6. Lo que la familia cambia o borra después de un rechazo no se pierde ni vuelve");
// f6411fd excluía la rechazada con un PATCH del principal que la dejaba como día cambiado visible en Google
// sin que el motor releyera la serie: el cambio siguiente de la familia a esa serie se revertía (planear:
// «un día cambiado no se puede volver a la normalidad desde la pared») y una serie borrada volvía.

await caso("6a. Google rechaza una fantasma y la familia vuelve a cambiar (o borra) la serie antes de la sincronización siguiente", async () => {
  // n ≤ 3: en línea; 12: al final de la vuelta.
  for (const [n, segundo, lat] of [
    [2, "lugar", 0],
    [1, "titulo", 400],
    [3, "borrar", 900],
    [12, "lugar", 400],
  ] as const) {
    const id = `r${n}${segundo[0]}`;
    const tag = `${n} fantasma(s), latencia ${lat}, ${segundo}`;
    const { cal, con, fam } = await teatro(id, n);
    const mala = excepciones(cal, id).sort((a, b) => String(a.originalStartTime?.dateTime).localeCompare(String(b.originalStartTime?.dateTime)))[0];
    const rechazo = sim.inyectar((p: PedidoVisto) => p.tipo === "events.patch" && p.eventoId === mala.id, invalido(), 9999);
    try {
      await h.cambiarEvento(fam, id, { titulo: "Teatro v2" });
      await conLatencia(lat, () => h.sync(fam, con, 6500));
      if (segundo === "borrar") await h.guardarEventos(fam, (l) => l.filter((e) => e.id !== id));
      else await h.cambiarEvento(fam, id, segundo === "lugar" ? { lugar: "Sala 9" } : { titulo: "Teatro v3" });
      await conLatencia(lat, () => h.sync(fam, con, 6500));
      for (let i = 0; i < 2; i++) await h.sync(fam, con, 24_000);
    } finally {
      rechazo.quitar();
    }
    const pared = (await h.leerEventos(fam)).find((e) => e.id === id);
    const g = sim.evento(cal, gid(id));
    if (segundo === "borrar") ok(`${tag}: lo que la familia borró no vuelve y se borra en Google`, !pared && g?.status === "cancelled", { pared: pared && h.resumen(pared), g: g?.status });
    else {
      const [titulo, lugar] = segundo === "lugar" ? ["Teatro v2", "Sala 9"] : ["Teatro v3", "Sala 1"];
      ok(`${tag}: el segundo cambio sigue en la pared y llegó a Google`, pared?.titulo === titulo && pared?.lugar === lugar && g?.summary === `🦄 ${titulo}` && g?.location === lugar, {
        pared: pared && h.resumen(pared),
        g: `${g?.summary}|${g?.location}`,
      });
    }
    ok(`${tag}: el PATCH rechazado no se repite y todo calza`, rechazo.disparos === 1 && !(await h.comparar(fam, con)).length, { disparos: rechazo.disparos, dif: await h.comparar(fam, con) });
  }
});

await caso("6b. La familia cambia la serie justo cuando Google rechaza una rezagada", async () => {
  // Otro equipo guarda mientras corre la sincronización, en el momento en que llega el PATCH rechazado
  // (pendientes(), o en línea con un cambio de la nota que se sube en la misma vuelta).
  for (const enLinea of [false, true]) {
    const id = enLinea ? "cbl" : "cbp";
    const { cal, con, fam } = await teatro(id, 2);
    await dejarRezagadas(cal, con, fam, id, { titulo: "Teatro de títeres" });
    const mala = excepciones(cal, id).filter((e) => e.summary === "🦄 Teatro")[0];
    const rechazo = sim.inyectar((p: PedidoVisto) => p.tipo === "events.patch" && p.eventoId === mala.id, invalido(), 9999);
    let hecho = false;
    h.hookFetch(async (m: string, u: string) => {
      if (!hecho && m === "PATCH" && u.includes(encodeURIComponent(mala.id))) {
        hecho = true;
        await h.cambiarEvento(fam, id, { lugar: "Sala 9" });
      }
    });
    try {
      if (enLinea) await h.cambiarEvento(fam, id, { nota: "Traer abrigo" });
      await h.sync(fam, con, 6500);
      h.hookFetch(null);
      for (let i = 0; i < 2; i++) await h.sync(fam, con, 24_000);
    } finally {
      h.hookFetch(null);
      rechazo.quitar();
    }
    const pared = (await h.leerEventos(fam)).find((e) => e.id === id);
    const g = sim.evento(cal, gid(id));
    ok(
      `${enLinea ? "en línea" : "al final de la vuelta"}: el cambio hecho durante la sincronización llega a Google${enLinea ? " (y la nota sigue)" : ""}; todo calza`,
      hecho && pared?.lugar === "Sala 9" && g?.location === "Sala 9" && (!enLinea || (pared?.nota === "Traer abrigo" && /Traer abrigo/.test(g?.description ?? ""))) && !(await h.comparar(fam, con)).length,
      { hecho, pared: pared && h.resumen(pared), g: `${g?.location}|${g?.description}`, dif: await h.comparar(fam, con) },
    );
  }
});

await caso("6c. Google rechaza una rezagada en una sincronización corta y después la familia borra la serie", async () => {
  // Sin plazo para una segunda vuelta (4 s): si la anotación cambiara el etag de la serie, el motor quedaría
  // con el viejo y el borrado se tomaría como «cambió en los dos lados» (el evento volvería).
  for (const ms of [4000, 6500]) {
    const id = `cb${ms}`;
    const { cal, con, fam } = await teatro(id, 1);
    await dejarRezagadas(cal, con, fam, id, { titulo: "Teatro de títeres" });
    const mala = excepciones(cal, id)[0];
    const rechazo = sim.inyectar((p: PedidoVisto) => p.tipo === "events.patch" && p.eventoId === mala.id, invalido(), 9999);
    try {
      await h.sync(fam, con, ms);
      await h.guardarEventos(fam, (l) => l.filter((e) => e.id !== id));
      await h.sync(fam, con, 6500);
      await h.sync(fam, con, 24_000);
    } finally {
      rechazo.quitar();
    }
    const pared = (await h.leerEventos(fam)).filter((e) => e.id === id || e.externo?.uid.startsWith(id));
    ok(`${ms} ms: lo que la familia borró no vuelve y se borra en Google`, !pared.length && sim.evento(cal, gid(id))?.status === "cancelled", { pared: pared.map(h.resumen), g: sim.evento(cal, gid(id))?.status });
  }
});

seccion("Al final");
ok("ningún pedido salió de esta máquina", h.urlsVistas.length > 0 && h.urlsVistas.every((u) => u.startsWith("http://127.0.0.1:")));
await h.terminar();
