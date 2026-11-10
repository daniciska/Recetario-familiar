// Abrir la versión nueva sin red en un equipo que guardó con la versión anterior.
//
// Un equipo con la versión anterior (sin `esquema`) guarda en su localStorage lo que él mismo mandó
// (sin `mas` en el menú, sin dudas/dictado/«≈»/nota en las recetas) junto con la versión que el servidor
// le dio a lo MEZCLADO: api-datos.mts le repone lo que su normalizar descarta y sólo responde {version}.
// Si después ese equipo abre con la versión nueva justo cuando GET /api/datos no responde (wifi
// despertando, más de 15 s), abre con esa copia incompleta. Antes conservaba las versiones guardadas:
// /api/cambios devolvía las mismas, la revisión no traía nada y el siguiente guardado (esquema 2, que el
// servidor guarda tal cual) borraba los espacios 2.º en adelante y los campos de las recetas dictadas.
// Ahora RepositorioNube.cargar() olvida las versiones al abrir con la copia (sin persistirlo): la primera
// revisión con red trae todo, y un guardado antes de esa revisión va con versionBase 0 → 409 → el store
// rehace el cambio sobre lo último.
//
// Usa RepositorioNube, api-datos.mts y api-cambios.mts de verdad, con Blobs en memoria y un localStorage
// por equipo.
import { reiniciarBlobs } from "@netlify/blobs";
import * as C from "@/servidor/comun";
import { RepositorioNube } from "@/lib/datos/repositorioNube";
import { ConflictoVersion } from "@/lib/datos/repositorio";
import { normalizarGuardado } from "@/lib/datos/normalizar";
import { ponerItem } from "@/lib/comidas";
import { estadoEjemplo } from "@/lib/ejemplo";
import type { ClaveColeccion, EstadoApp, PlanComidas, Receta } from "@/lib/datos/tipos";
import { asignarViejo, planViejo } from "./viejo";
import { guardarRecetaVieja, recetasViejas } from "../recetas/viejo";
import { caso, fin, igual, igualJSON, json, ok, seccion } from "./comun";

type Manejador = (req: Request, ctx: unknown) => Promise<Response>;
const apiDatos = (await import("@/netlify/functions/api-datos.mts")).default as unknown as Manejador;
const apiCambios = (await import("@/netlify/functions/api-cambios.mts")).default as unknown as Manejador;
const ajustes = estadoEjemplo().ajustes;
const CLAVE_SESION = "calendario-familiar:nube";

// ---------- Un localStorage por equipo, la red y la versión anterior ----------
const memorias: Record<string, Map<string, string>> = {};
let equipo = "telefono";
const memoria = () => (memorias[equipo] ??= new Map());
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => memoria().get(k) ?? null,
    setItem: (k: string, v: string) => void memoria().set(k, String(v)),
    removeItem: (k: string) => void memoria().delete(k),
  },
  document: { hidden: false, visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
  window: { addEventListener() {}, removeEventListener() {} },
});
let sinRed = false;
let versionAnterior = false; // simula la versión anterior: no manda `esquema`
const pedidos: { metodo: string; ruta: string; versionBase?: number; status: number }[] = [];
globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
  if (sinRed) throw new TypeError("Failed to fetch");
  const url = new URL(String(entrada), "http://sitio.test");
  let body = init?.body;
  let versionBase: number | undefined;
  if (typeof body === "string") {
    const o = JSON.parse(body);
    if (versionAnterior) delete o.esquema;
    versionBase = o.versionBase;
    body = JSON.stringify(o);
  }
  const req = new Request(url, { ...init, body });
  const clave = /^\/api\/datos\/([^/]+)$/.exec(url.pathname)?.[1];
  const r = url.pathname === "/api/cambios" ? await apiCambios(req, {}) : await apiDatos(req, { params: clave ? { clave } : {} });
  pedidos.push({ metodo: req.method, ruta: url.pathname + url.search, versionBase, status: r.status });
  return r;
}) as typeof fetch;

const esperar = async (cond: () => boolean, ms = 1500) => {
  for (const fin = Date.now() + ms; !cond() && Date.now() < fin; ) await new Promise((r) => setTimeout(r, 10));
};

// ---------- Lo que hay en la nube ----------
const ID = "qc9txsrdz45e6fnma3f2s8yy";
const PLAN: PlanComidas = {
  "2026-11-09|almuerzo": { recetaId: "rec_a", porciones: 4, mas: [{ texto: "Arroz" }, { texto: "Ensalada" }, { texto: "Fruta" }] },
  "2026-11-10|cena": { porciones: 4, mas: [{ texto: "Puré" }] },
};
const DICTADA = {
  id: "rec_a",
  nombre: "Charquicán",
  emoji: "🍲",
  porciones: 4,
  ingredientes: [{ id: "i1", nombre: "Zapallo", cantidad: 500, unidad: "g", categoria: "Verduras y frutas", comoLoDijo: "un trozo", estimado: true, nota: "en cubos" }],
  pasos: [],
  dudas: ["¿Cuánta cebolla?"],
  dictado: { id: ID, fecha: "2026-11-09T10:00:00Z" },
} as unknown as Receta;
const OTRA = { id: "rec_b", nombre: "Porotos", emoji: "🫘", porciones: 4, ingredientes: [], pasos: [] } as unknown as Receta;

interface Familia {
  fam: string;
  enNube: (c: ClaveColeccion) => Promise<{ datos: unknown; version: number } | null>;
}

/**
 * El teléfono (al día) guarda el menú con espacios y una receta dictada; después la tablet, con la
 * versión ANTERIOR, carga, pone la once del 11 y renombra la otra receta. Deja a la tablet con su
 * copia incompleta guardada bajo las versiones de lo mezclado.
 */
async function prepararTabletVieja(): Promise<Familia> {
  reiniciarBlobs();
  for (const k of Object.keys(memorias)) delete memorias[k];
  const fam = "f" + Math.random().toString(36).slice(2, 10);
  await C.almacen().setJSON(`acceso/${fam}`, { familia: { id: fam, nombre: "F" }, equipos: {}, versiones: {} });
  const sesion = (t: { token: string; equipoId: string }) => ({ token: t.token, equipoId: t.equipoId, familia: { id: fam, nombre: "F" } });
  const tel = await C.nuevoEquipo(fam, "Teléfono");
  const tab = await C.nuevoEquipo(fam, "Tablet");

  equipo = "telefono";
  localStorage.setItem(CLAVE_SESION, JSON.stringify(sesion(tel)));
  const repoTel = new RepositorioNube(sesion(tel));
  await repoTel.cargar();
  await repoTel.guardar("plan", json(PLAN));
  await repoTel.guardar("recetas", json([DICTADA, OTRA]));

  equipo = "tablet";
  versionAnterior = true;
  localStorage.setItem(CLAVE_SESION, JSON.stringify(sesion(tab)));
  const viejo = new RepositorioNube(sesion(tab));
  const e = (await viejo.cargar()) as unknown as { plan: unknown; recetas: unknown };
  await viejo.guardar("plan", asignarViejo(planViejo(e.plan), "2026-11-11|once", { texto: "Té", porciones: 4 }) as unknown as PlanComidas);
  const rs = recetasViejas(e.recetas);
  await viejo.guardar("recetas", guardarRecetaVieja(rs, { ...rs.find((r) => r.id === "rec_b")!, nombre: "Porotos granados" }) as unknown as Receta[]);
  versionAnterior = false;

  return { fam, enNube: (c) => C.leerColeccion(fam, c) as Promise<{ datos: unknown; version: number } | null> };
}

/** La tablet recarga con la versión nueva (su sesión y su copia, como quedaron en su localStorage). */
const tabletNueva = () => {
  equipo = "tablet";
  return new RepositorioNube(JSON.parse(localStorage.getItem(CLAVE_SESION)!));
};

/** Como store.actualizar: guarda; ante un 409 toma lo último de la nube y rehace el cambio encima. */
async function actualizar<K extends ClaveColeccion>(repo: RepositorioNube, estado: EstadoApp, clave: K, fn: (v: EstadoApp[K]) => EstadoApp[K]) {
  let conflictos = 0;
  for (let intento = 0; intento < 5; intento++) {
    const valor = fn(estado[clave]);
    try {
      await repo.guardar(clave, valor);
      estado[clave] = valor;
      return conflictos;
    } catch (e) {
      if (!(e instanceof ConflictoVersion)) throw e;
      conflictos++;
      estado[clave] = normalizarGuardado({ [clave]: e.datos } as Partial<EstadoApp>, estado.ajustes)[clave];
    }
  }
  throw new Error("no se pudo guardar en 5 intentos");
}

const dictadaEn = (datos: unknown) => (datos as Receta[]).find((r) => r.id === "rec_a");

// ---------------------------------------------------------------------------------------------
seccion("Lo que dejó la versión anterior (el punto de partida)");
await caso("punto de partida", async () => {
  const { enNube } = await prepararTabletVieja();
  const plan = (await enNube("plan"))!;
  igualJSON("la nube conserva los espacios (los repuso el servidor)", (plan.datos as PlanComidas)["2026-11-09|almuerzo"], PLAN["2026-11-09|almuerzo"]);
  igualJSON("…y la receta dictada entera", dictadaEn((await enNube("recetas"))!.datos), DICTADA);
  const copia = JSON.parse(localStorage.getItem("calendario-familiar:v1:plan")!);
  ok("la copia de la tablet quedó sin los espacios (lo que ella mandó)…", copia["2026-11-09|almuerzo"] && !("mas" in copia["2026-11-09|almuerzo"]), copia);
  ok("…bajo la versión de lo mezclado", JSON.parse(localStorage.getItem(CLAVE_SESION)!).versiones?.plan === plan.version);
});

// ---------------------------------------------------------------------------------------------
seccion("Abre sin red y la red vuelve antes del primer guardado");
await caso("revisión", async () => {
  const { enNube } = await prepararTabletVieja();
  sinRed = true;
  const repo = tabletNueva();
  let estado = normalizarGuardado((await repo.cargar())!, ajustes);
  ok("abre con la copia del equipo (sin red)", estado.plan["2026-11-09|almuerzo"]?.recetaId === "rec_a" && !estado.plan["2026-11-09|almuerzo"]?.mas);
  const versionesAntes = JSON.parse(localStorage.getItem(CLAVE_SESION)!).versiones;

  sinRed = false;
  let cambios = 0;
  const desuscribir = repo.suscribir((n) => {
    cambios++;
    estado = normalizarGuardado(n, ajustes);
  });
  repo.revisar();
  await esperar(() => cambios > 0);
  ok("la primera revisión con red trae lo de la nube", cambios === 1, { cambios });
  igualJSON("…con los espacios del almuerzo", estado.plan["2026-11-09|almuerzo"], PLAN["2026-11-09|almuerzo"]);
  igualJSON("…la cena que sólo tiene espacios 2.º en adelante", estado.plan["2026-11-10|cena"], PLAN["2026-11-10|cena"]);
  igualJSON("…y la receta dictada entera", dictadaEn(estado.recetas), DICTADA);
  ok("…sin perder lo que puso la tablet vieja", estado.plan["2026-11-11|once"]?.texto === "Té" && estado.recetas.find((r) => r.id === "rec_b")?.nombre === "Porotos granados");
  ok("abrir sin red no reescribió las versiones guardadas en el equipo (se olvidan sólo en memoria)", versionesAntes?.plan > 0 && versionesAntes?.recetas > 0, versionesAntes);

  repo.revisar();
  await new Promise((r) => setTimeout(r, 100));
  ok("la revisión siguiente no vuelve a traer nada", cambios === 1, { cambios });

  // Alguien en la tablet (ya al día) pone algo en otra comida y edita la otra receta.
  ok("guardar el menú no choca (ya tiene las versiones de la nube)", (await actualizar(repo, estado, "plan", (p) => ponerItem(p, "2026-11-12|cena", "cena", 0, { texto: "Sopa" }, 4))) === 0);
  await actualizar(repo, estado, "recetas", (rs) => rs.map((r) => (r.id === "rec_b" ? { ...r, porciones: 6 } : r)));
  const plan = (await enNube("plan"))!.datos as PlanComidas;
  igualJSON("en la nube siguen los espacios del almuerzo", plan["2026-11-09|almuerzo"], PLAN["2026-11-09|almuerzo"]);
  igualJSON("…y la cena del 10", plan["2026-11-10|cena"], PLAN["2026-11-10|cena"]);
  ok("…con la sopa nueva y el té de la tablet vieja", plan["2026-11-12|cena"]?.texto === "Sopa" && plan["2026-11-11|once"]?.texto === "Té", plan);
  const recetas = (await enNube("recetas"))!.datos as Receta[];
  igualJSON("en la nube la receta dictada sigue entera (dudas, dictado, ≈, cómo lo dijo, nota)", dictadaEn(recetas), DICTADA);
  ok("…y la otra receta tiene los dos cambios", JSON.stringify(recetas.find((r) => r.id === "rec_b")).includes('"porciones":6') && recetas.find((r) => r.id === "rec_b")?.nombre === "Porotos granados");
  desuscribir();
});

// ---------------------------------------------------------------------------------------------
seccion("Abre sin red y guarda apenas vuelve la red (antes de cualquier revisión)");
await caso("guardado", async () => {
  const { enNube } = await prepararTabletVieja();
  sinRed = true;
  const repo = tabletNueva();
  const estado = normalizarGuardado((await repo.cargar())!, ajustes);
  sinRed = false;
  pedidos.length = 0;

  const c1 = await actualizar(repo, estado, "plan", (p) => ponerItem(p, "2026-11-12|cena", "cena", 0, { texto: "Sopa" }, 4));
  const primerPut = pedidos.find((p) => p.metodo === "PUT");
  ok("el primer guardado va con versionBase 0 y recibe 409 (no pisa la nube)", c1 === 1 && primerPut?.versionBase === 0 && primerPut.status === 409, { c1, primerPut });
  const plan = (await enNube("plan"))!.datos as PlanComidas;
  igualJSON("se rehízo sobre lo último: siguen los espacios del almuerzo", plan["2026-11-09|almuerzo"], PLAN["2026-11-09|almuerzo"]);
  igualJSON("…y la cena del 10", plan["2026-11-10|cena"], PLAN["2026-11-10|cena"]);
  ok("…con la sopa nueva y el té de la tablet vieja", plan["2026-11-12|cena"]?.texto === "Sopa" && plan["2026-11-11|once"]?.texto === "Té", plan);

  const c2 = await actualizar(repo, estado, "recetas", (rs) => rs.map((r) => (r.id === "rec_b" ? { ...r, porciones: 6 } : r)));
  ok("con las recetas, lo mismo (409 y se rehace)", c2 === 1, { c2 });
  const recetas = (await enNube("recetas"))!.datos as Receta[];
  igualJSON("la receta dictada sigue entera en la nube", dictadaEn(recetas), DICTADA);
  ok("…y la otra receta tiene los dos cambios", recetas.find((r) => r.id === "rec_b")?.porciones === 6 && recetas.find((r) => r.id === "rec_b")?.nombre === "Porotos granados");
});

// ---------------------------------------------------------------------------------------------
seccion("Sin la versión anterior de por medio: nada cambia");
await caso("con red", async () => {
  await prepararTabletVieja();
  const repo = tabletNueva();
  const estado = normalizarGuardado((await repo.cargar())!, ajustes);
  igualJSON("con red abre con lo de la nube (como siempre)", estado.plan["2026-11-09|almuerzo"], PLAN["2026-11-09|almuerzo"]);
  ok("…y guarda sin chocar", (await actualizar(repo, estado, "plan", (p) => ponerItem(p, "2026-11-12|cena", "cena", 0, { texto: "Sopa" }, 4))) === 0);
});

await caso("copia completa", async () => {
  const { enNube } = await prepararTabletVieja();
  // El teléfono (siempre al día) tiene una copia completa; abre sin red y vuelve la red.
  equipo = "telefono";
  sinRed = true;
  const repo = new RepositorioNube(JSON.parse(localStorage.getItem(CLAVE_SESION)!));
  const local = normalizarGuardado((await repo.cargar())!, ajustes);
  igualJSON("abre con su copia, que tiene los espacios", local.plan["2026-11-09|almuerzo"], PLAN["2026-11-09|almuerzo"]);
  sinRed = false;
  let estado: EstadoApp | null = null;
  let cambios = 0;
  const desuscribir = repo.suscribir((n) => {
    cambios++;
    estado = normalizarGuardado(n, ajustes);
  });
  repo.revisar();
  await esperar(() => cambios > 0);
  ok("la primera revisión con red trae todo una vez", cambios === 1, { cambios });
  const nube = normalizarGuardado({ plan: (await enNube("plan"))!.datos, recetas: (await enNube("recetas"))!.datos } as Partial<EstadoApp>, ajustes);
  igual("…y lo que trae es lo de la nube (con lo que cambió la tablet vieja después)", [estado!.plan, estado!.recetas], [nube.plan, nube.recetas]);
  repo.revisar();
  await new Promise((r) => setTimeout(r, 100));
  ok("la siguiente no trae nada", cambios === 1, { cambios });
  desuscribir();
});

fin();
