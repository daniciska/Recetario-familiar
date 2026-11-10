// Etapa 1 de «Dictar receta»: los campos nuevos de las recetas (comoLoDijo, estimado y nota en cada
// ingrediente; dudas y dictado en la receta) se guardan y se leen, los datos de hoy siguen sirviendo tal
// cual, y un equipo con la versión anterior (que no los conoce y guarda la colección entera) no los borra.
// Usa lib/datos/normalizar.ts, servidor/conservar.ts, netlify/functions/api-datos.mts y
// lib/datos/repositorioNube.ts de verdad, con Blobs en memoria (blobs-mock) y fetch apuntando al handler.
//   node --experimental-transform-types --no-warnings --import ./pruebas/registrar.mjs pruebas/recetas/datos.test.ts
import { reiniciarBlobs } from "@netlify/blobs";
import * as C from "../../servidor/comun.ts";
import { CAMPOS_INGREDIENTE_NUEVOS, CAMPOS_RECETA_NUEVOS, conservarCamposNuevos } from "../../servidor/conservar.ts";
import { normalizarGuardado, normalizarReceta, normalizarRespaldo } from "../../lib/datos/normalizar.ts";
import { RepositorioNube } from "../../lib/datos/repositorioNube.ts";
import { ConflictoVersion } from "../../lib/datos/repositorio.ts";
import { escalar, generarLista } from "../../lib/compras.ts";
import { estadoEjemplo } from "../../lib/ejemplo.ts";
import type { Ajustes, Ingrediente, PlanComidas, Receta } from "../../lib/datos/tipos.ts";
import { borrarRecetaVieja, cuerpoViejo, guardarRecetaVieja, recetasViejas, type RecetaVieja } from "./viejo.ts";
import { caso, info, ok, seccion, terminar } from "./arnes.ts";

type O = Record<string, any>;
const json = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const igual = (n: string, a: unknown, b: unknown) => ok(n, JSON.stringify(a) === JSON.stringify(b), { obtenido: a, esperado: b });
const ajustes: Ajustes = estadoEjemplo().ajustes;
const normalizar = (recetas: unknown): Receta[] => normalizarGuardado({ recetas }, ajustes).recetas;
const ID = "qc9txsrdz45e6fnma3f2s8yy"; // 24 caracteres del alfabeto de idAzar()

const DICTADA: Receta = {
  id: `rec_${ID}`,
  nombre: "Charquicán",
  emoji: "🍲",
  porciones: 4,
  tiempoMin: 45,
  ingredientes: [
    { id: "ing_1", nombre: "Zapallo", cantidad: 500, unidad: "g", categoria: "Verduras y frutas", comoLoDijo: "un buen trozo", estimado: true, nota: "en cubos" },
    { id: "ing_2", nombre: "Papas", cantidad: 6, unidad: "unidad", categoria: "Verduras y frutas", comoLoDijo: "unas seis" },
    { id: "ing_3", nombre: "Sal", cantidad: null, unidad: "al gusto", categoria: "Condimentos y especias", comoLoDijo: "lo que pida" },
  ],
  pasos: ["Pica todo.", "Cuece a fuego lento."],
  nota: "Secretos: con harto zapallo",
  dudas: ["¿Cuánta cebolla?", "¿Lleva carne?"],
  dictado: { id: ID, fecha: "2026-11-09T17:05:00.000Z", segundos: 154 },
};
const OTRA: Receta = { id: "rec_otra", nombre: "Porotos", emoji: "🫘", porciones: 4, ingredientes: [], pasos: [] };

// ---------------------------------------------------------------------------------------------
seccion("A. Los datos de hoy siguen sirviendo");
await caso("A", () => {
  const hoy = json(estadoEjemplo().recetas);
  ok("A0 hay recetas de ejemplo", hoy.length >= 3, hoy.length);
  const nuevo = normalizar(hoy);
  const viejo = recetasViejas(hoy);
  igual("A1 las recetas de ejemplo dan lo mismo que con el normalizar anterior (JSON)", nuevo, viejo);
  ok(
    "A2 …y con las mismas claves, sin ninguna nueva",
    nuevo.every((r, n) => JSON.stringify(Object.keys(r)) === JSON.stringify(Object.keys(viejo[n]))) &&
      nuevo.every((r) => r.ingredientes.every((i, k) => JSON.stringify(Object.keys(i)) === JSON.stringify(Object.keys(viejo[nuevo.indexOf(r)].ingredientes[k])))),
  );
  ok("A3 ninguna receta de antes trae dudas ni dictado", nuevo.every((r) => !("dudas" in r) && !("dictado" in r)));
  ok("A4 ningún ingrediente de antes trae comoLoDijo, estimado ni nota", nuevo.every((r) => r.ingredientes.every((i) => !("comoLoDijo" in i) && !("estimado" in i) && !("nota" in i))));
  // Casos raros de antes: siguen igual que con el normalizar anterior.
  const raras = [
    { nombre: "Sin id" },
    { id: "r1", nombre: 5, porciones: -2, tiempoMin: 0, ingredientes: [null, 3, { nombre: "Harina", cantidad: -1, unidad: "kilo" }], pasos: ["a", 4, null] },
    { id: "r2", foto: "javascript:alert(1)", nota: "   ", ingredientes: "no", pasos: {} },
    { id: "r3", ingredientes: [{ id: "i", nombre: "Sal", cantidad: 3, unidad: "al gusto", categoria: "Inventada" }] },
    "texto",
    null,
  ];
  // Los ids que inventa cada normalizar (rec_r…, ing_r…) llevan la hora: no se comparan.
  const sinIdsNuevos = (x: unknown) => JSON.parse(JSON.stringify(x, (k, v) => (k === "id" && /^(rec|ing)_r[0-9a-z]+$/.test(v) ? "(nuevo)" : v)));
  const n2 = sinIdsNuevos(normalizar(raras));
  const v2 = sinIdsNuevos(recetasViejas(raras));
  igual("A5 datos dañados de antes: el mismo resultado que antes", n2, v2);
  const respaldo = { version: 1, miembros: [], eventos: [], recetas: hoy };
  const r = normalizarRespaldo(respaldo, ajustes);
  igual("A6 un respaldo de hoy se restaura igual", "estado" in r ? r.estado.recetas : r, viejo);
});

// ---------------------------------------------------------------------------------------------
seccion("B. normalizar.ts conserva los campos nuevos");
await caso("B", () => {
  const [d] = normalizar([json(DICTADA)]);
  igual("B1 una receta dictada pasa sin cambios (también el orden de las claves)", d, json(DICTADA));
  igual("B2 normalizar dos veces da lo mismo", normalizar(json([d])), [d]);
  const conVacios = normalizarReceta({
    id: "x",
    ingredientes: [
      { id: "a", nombre: "Harina", cantidad: null, unidad: "g", estimado: true, comoLoDijo: "   ", nota: "" },
      { id: "b", nombre: "Leche", cantidad: 1, unidad: "al gusto", estimado: true },
      { id: "c", nombre: "Azúcar", cantidad: 100, unidad: "g", estimado: "true", comoLoDijo: 7, nota: ["x"] },
      { id: "e", nombre: "Agua", cantidad: 1, unidad: "l", estimado: false },
    ],
    dudas: [],
  })!;
  ok("B3 estimado con cantidad null se cae", !("estimado" in conVacios.ingredientes[0]), conVacios.ingredientes[0]);
  ok("B4 estimado con «al gusto» se cae (y la cantidad queda null)", conVacios.ingredientes[1].cantidad === null && !("estimado" in conVacios.ingredientes[1]));
  ok("B5 estimado que no es true se cae", !("estimado" in conVacios.ingredientes[2]) && !("estimado" in conVacios.ingredientes[3]));
  ok("B6 comoLoDijo y nota vacíos o que no son texto no aparecen", conVacios.ingredientes.every((i) => !("comoLoDijo" in i) && !("nota" in i)), conVacios.ingredientes);
  ok("B7 dudas vacías → sin la clave", !("dudas" in conVacios));
  const largo = normalizarReceta({
    id: "y",
    ingredientes: [{ id: "a", nombre: "Ají", cantidad: 1, unidad: "unidad", comoLoDijo: `  ${"p".repeat(250)}  `, nota: "n".repeat(201) }],
    dudas: ["  ¿Una?  ", 5, "", null, ...Array.from({ length: 30 }, (_, n) => `¿Duda ${n}? ${"z".repeat(400)}`)],
  })!;
  ok("B8 comoLoDijo sin espacios a los lados y de 200 como mucho", largo.ingredientes[0].comoLoDijo === "p".repeat(200));
  ok("B9 nota del ingrediente de 200 como mucho", largo.ingredientes[0].nota?.length === 200);
  ok("B10 dudas: sólo texto, sin espacios a los lados, ≤ 20 de ≤ 300", largo.dudas?.length === 20 && largo.dudas[0] === "¿Una?" && largo.dudas.every((q) => q.length <= 300), largo.dudas?.slice(0, 3));
  ok("B11 dudas que no son lista → sin la clave", !("dudas" in normalizarReceta({ id: "z", dudas: "¿?" })!));
  const enlaces: [string, unknown, unknown][] = [
    ["id de 23", { id: ID.slice(1), fecha: "x" }, undefined],
    ["id con mayúsculas", { id: ID.toUpperCase(), fecha: "x" }, undefined],
    ["id con «l» (no está en el alfabeto)", { id: `l${ID.slice(1)}`, fecha: "x" }, undefined],
    ["id con 0 o 1", { id: `0${ID.slice(1)}`, fecha: "x" }, undefined],
    ["id que no es texto", { id: 5 }, undefined],
    ["no es objeto", ID, undefined],
    ["segundos negativos", { id: ID, fecha: "f", segundos: -3 }, { id: ID, fecha: "f" }],
    ["segundos con decimales", { id: ID, fecha: "f", segundos: 154.6 }, { id: ID, fecha: "f", segundos: 155 }],
    ["sin fecha", { id: ID }, { id: ID, fecha: "" }],
    ["fecha larguísima", { id: ID, fecha: "9".repeat(100) }, { id: ID, fecha: "9".repeat(40) }],
    ["con claves de más", { id: ID, fecha: "f", audio: "datos", segundos: 3 }, { id: ID, fecha: "f", segundos: 3 }],
  ];
  for (const [n, dictado, esperado] of enlaces) igual(`B12 dictado ${n}`, normalizarReceta({ id: "w", dictado })!.dictado, esperado);
  ok("B13 dictado inválido → sin la clave", !("dictado" in normalizarReceta({ id: "w", dictado: { id: "malo" } })!));
  ok("B14 normalizarReceta de algo que no es objeto → null", normalizarReceta(null) === null && normalizarReceta([DICTADA]) === null && normalizarReceta("x") === null);
  const resp = normalizarRespaldo({ version: 1, miembros: [], eventos: [], recetas: [json(DICTADA), json(OTRA)] }, ajustes);
  igual("B15 un respaldo con recetas dictadas las conserva", "estado" in resp ? resp.estado.recetas : resp, normalizar([json(DICTADA), json(OTRA)]));
  ok("B16 el equipo viejo lee una receta dictada sin caerse (y sin los campos nuevos)", (() => {
    const v = recetasViejas([json(DICTADA)])[0] as O;
    return v.nombre === "Charquicán" && !("dudas" in v) && !("dictado" in v) && v.ingredientes.length === 3 && !("estimado" in v.ingredientes[0]);
  })());
});

// ---------------------------------------------------------------------------------------------
seccion("C. conservarCamposNuevos (lo que hace el servidor con lo que manda un equipo viejo)");
await caso("C", () => {
  igual("C0 campos que se reponen", [CAMPOS_RECETA_NUEVOS, CAMPOS_INGREDIENTE_NUEVOS], [["dudas", "dictado"], ["comoLoDijo", "estimado", "nota"]]);
  const previas = json([DICTADA, OTRA]);
  const copia = JSON.stringify(previas);
  // Lo que manda un equipo viejo que cambió el nombre de OTRA receta.
  const viejo = recetasViejas(previas).map((r) => (r.id === "rec_otra" ? { ...r, nombre: "Porotos con riendas" } : r));
  const copiaViejo = JSON.stringify(viejo);
  const r = conservarCamposNuevos(previas, viejo) as O[];
  const d = r.find((x) => x.id === DICTADA.id)!;
  igual("C1 repone dudas y dictado", [d.dudas, d.dictado], [DICTADA.dudas, DICTADA.dictado]);
  igual("C2 repone comoLoDijo, estimado y nota de cada ingrediente", d.ingredientes, json(DICTADA.ingredientes));
  igual("C3 la receta dictada queda igual que antes del guardado del equipo viejo", normalizar([d]), normalizar([json(DICTADA)]));
  ok("C4 lo que cambió el equipo viejo se queda", r.find((x) => x.id === "rec_otra")?.nombre === "Porotos con riendas");
  ok("C5 no cambia lo guardado ni lo que llegó", JSON.stringify(previas) === copia && JSON.stringify(viejo) === copiaViejo);

  // El equipo viejo corrige el zapallo a 700 g: el «≈» y «cómo lo dijo» ya no valen; las papas siguen.
  const corregido = recetasViejas(previas).map((x) =>
    x.id === DICTADA.id ? { ...x, nombre: "Charquicán de la abuela", ingredientes: x.ingredientes.map((i) => (i.id === "ing_1" ? { ...i, cantidad: 700 } : i)) } : x,
  );
  const r2 = (conservarCamposNuevos(previas, corregido) as O[])[0];
  igual("C6 cantidad corregida → ese ingrediente pierde estimado y comoLoDijo (la nota sigue)", r2.ingredientes[0], { id: "ing_1", nombre: "Zapallo", cantidad: 700, unidad: "g", categoria: "Verduras y frutas", nota: "en cubos" });
  ok("C7 …los demás ingredientes los conservan", r2.ingredientes[1].comoLoDijo === "unas seis" && r2.ingredientes[2].comoLoDijo === "lo que pida");
  ok("C8 …y la receta conserva dudas y dictado aunque cambió el nombre", r2.nombre === "Charquicán de la abuela" && r2.dudas?.length === 2 && r2.dictado?.id === ID);
  const otroNombre = recetasViejas(previas).map((x) =>
    x.id === DICTADA.id ? { ...x, ingredientes: x.ingredientes.map((i) => (i.id === "ing_2" ? { ...i, nombre: "Papas chilotas" } : i.id === "ing_3" ? { ...i, unidad: "pizca" } : i)) } : x,
  );
  const r3 = (conservarCamposNuevos(previas, otroNombre) as O[])[0];
  ok("C9 nombre o unidad cambiados → ese ingrediente no recupera «cómo lo dijo»", !("comoLoDijo" in r3.ingredientes[1]) && !("comoLoDijo" in r3.ingredientes[2]), r3.ingredientes);
  ok("C10 …el que no cambió sí", r3.ingredientes[0].estimado === true);

  const conNuevos = recetasViejas(previas).map((x) => (x.id === DICTADA.id ? { ...x, ingredientes: [...x.ingredientes, { id: "ing_9", nombre: "Choclo", cantidad: 2, unidad: "unidad", categoria: "Verduras y frutas" }] } : x));
  conNuevos.push({ id: "rec_nueva", nombre: "Queque", emoji: "🍰", porciones: 8, ingredientes: [], pasos: [] } as RecetaVieja);
  const r4 = conservarCamposNuevos(previas, conNuevos) as O[];
  igual("C11 un ingrediente nuevo queda como llegó", r4[0].ingredientes[3], { id: "ing_9", nombre: "Choclo", cantidad: 2, unidad: "unidad", categoria: "Verduras y frutas" });
  igual("C12 una receta nueva queda como llegó", r4[2], conNuevos[2]);
  const r5 = conservarCamposNuevos(previas, borrarRecetaVieja(recetasViejas(previas), DICTADA.id)) as O[];
  ok("C13 una receta borrada por el equipo viejo no revive", r5.length === 1 && r5[0].id === "rec_otra");
  const conPropias = [{ ...json(DICTADA), dudas: ["¿Otra?"], ingredientes: [{ ...json(DICTADA.ingredientes[0]), comoLoDijo: "harto" }] }];
  const r6 = (conservarCamposNuevos(previas, conPropias) as O[])[0];
  ok("C14 si ya vienen, se dejan como vinieron", r6.dudas[0] === "¿Otra?" && r6.ingredientes[0].comoLoDijo === "harto");
  const raro = [null, 5, "x", { nombre: "sin id" }, { id: DICTADA.id, ingredientes: "no" }, { id: DICTADA.id, ingredientes: [null, { id: "ing_1" }] }];
  const r7 = conservarCamposNuevos(previas, raro) as unknown[];
  ok("C15 entradas dañadas pasan sin caerse", r7.length === 6 && r7[0] === null && r7[1] === 5 && r7[2] === "x", r7);
  ok("C16 receta sin lista de ingredientes: sólo dudas y dictado", (r7[4] as O).ingredientes === "no" && (r7[4] as O).dictado?.id === ID);
  ok("C17 ingrediente con el mismo id pero otro contenido no recupera nada", JSON.stringify((r7[5] as O).ingredientes) === JSON.stringify([null, { id: "ing_1" }]));
  for (const [n, p, e] of [
    ["lo guardado no es lista", { a: 1 }, viejo],
    ["lo que llega no es lista", previas, { a: 1 }],
    ["no hay nada guardado", null, viejo],
  ] as [string, unknown, unknown][])
    ok(`C18 ${n}: devuelve lo que llegó tal cual`, conservarCamposNuevos(p, e) === e);
  const previasRaras = [null, { id: 5, dudas: ["x"] }, { id: DICTADA.id, dudas: undefined, dictado: DICTADA.dictado, ingredientes: [null, { id: 3 }] }];
  const r8 = (conservarCamposNuevos(previasRaras, recetasViejas([json(DICTADA)])) as O[])[0];
  ok("C19 lo guardado dañado no rompe nada (y una clave sin valor no se repone)", !("dudas" in r8) && r8.dictado?.id === ID, r8);
});

// ---------------------------------------------------------------------------------------------
seccion("D. El servidor de verdad (api-datos.mts) con un equipo al día y uno con la versión anterior");
// fetch → el handler, como Netlify (context.params.clave); localStorage en memoria para RepositorioNube.
const handler = (await import("../../netlify/functions/api-datos.mts")).default as unknown as (req: Request, ctx: unknown) => Promise<Response>;
const enviados: { metodo: string; ruta: string; cuerpo: O | null; status: number }[] = [];
const memoria = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => memoria.get(k) ?? null,
    setItem: (k: string, v: string) => void memoria.set(k, String(v)),
    removeItem: (k: string) => void memoria.delete(k),
  },
});
globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(entrada), "http://sitio.test");
  const req = new Request(url, init);
  const texto = init?.body === undefined ? null : await req.clone().text();
  const clave = /^\/api\/datos\/([^/]+)$/.exec(url.pathname)?.[1];
  const r = await handler(req, { params: clave ? { clave } : {} });
  enviados.push({ metodo: req.method, ruta: url.pathname + url.search, cuerpo: texto ? JSON.parse(texto) : null, status: r.status });
  return r;
}) as typeof fetch;

reiniciarBlobs();
const FAM = "fdatos";
await C.almacen().setJSON(`acceso/${FAM}`, { familia: { id: FAM, nombre: "Familia de prueba" }, equipos: {}, versiones: {} });
const { token, equipoId } = await C.nuevoEquipo(FAM, "iPad");
const { token: tokenViejo } = await C.nuevoEquipo(FAM, "Pared (versión anterior)");
const sesion = { token, equipoId, familia: { id: FAM, nombre: "Familia de prueba" } };
const enNube = async () => (await C.leerColeccion(FAM, "recetas")) as { datos: O[]; version: number };
const dictadaEnNube = async () => (await enNube()).datos.find((x) => x.id === DICTADA.id);
/** El equipo viejo: lee la nube con su normalizar, cambia algo y manda la colección entera sin `esquema`. */
async function equipoViejo(cambio: (rs: RecetaVieja[]) => RecetaVieja[], base?: number) {
  const g = await fetch("/api/datos?claves=recetas", { headers: { authorization: `Bearer ${tokenViejo}` } });
  const col = ((await g.json()) as O).colecciones.recetas as { datos: unknown; version: number };
  const r = await fetch("/api/datos/recetas", {
    method: "PUT",
    headers: { authorization: `Bearer ${tokenViejo}`, "content-type": "application/json" },
    body: JSON.stringify(cuerpoViejo(cambio(recetasViejas(col.datos)), base ?? col.version)),
  });
  return { status: r.status, datos: (await r.json()) as O };
}
async function pedir(metodo: string, ruta: string, cuerpo: unknown) {
  const r = await fetch(ruta, { method: metodo, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(cuerpo) });
  return { status: r.status, datos: (await r.json()) as O };
}

await caso("D", async () => {
  const repo = new RepositorioNube(sesion);
  ok("D0 el equipo al día parte sin datos en la nube", (await repo.cargar()) === null);
  await repo.guardar("recetas", [json(DICTADA), json(OTRA)]);
  const put = enviados.filter((e) => e.metodo === "PUT").at(-1)!;
  ok("D1 RepositorioNube.guardar manda esquema: 2", put.cuerpo?.esquema === 2 && put.cuerpo.versionBase === 0 && put.status === 200, put);
  igual("D2 la receta dictada queda completa en la nube", await dictadaEnNube(), json(DICTADA));

  const v1 = await equipoViejo((rs) => guardarRecetaVieja(rs, { ...rs.find((x) => x.id === "rec_otra")!, nombre: "Porotos con riendas" }));
  ok("D3 el equipo viejo guarda OTRA receta (200)", v1.status === 200, v1);
  igual("D4 …y la dictada sigue entera (dudas, dictado, ≈, cómo lo dijo, nota)", await dictadaEnNube(), json(DICTADA));
  ok("D5 …y su cambio quedó", (await enNube()).datos.find((x) => x.id === "rec_otra")?.nombre === "Porotos con riendas");

  const v2 = await equipoViejo((rs) => {
    const d = rs.find((x) => x.id === DICTADA.id)!;
    return guardarRecetaVieja(rs, { ...d, porciones: 6, ingredientes: d.ingredientes.map((i) => (i.id === "ing_1" ? { ...i, cantidad: 700 } : i)) });
  });
  const d2 = await dictadaEnNube();
  ok("D6 el equipo viejo edita la receta dictada (200)", v2.status === 200);
  ok("D7 …conserva dudas y dictado", JSON.stringify([d2.dudas, d2.dictado]) === JSON.stringify([DICTADA.dudas, DICTADA.dictado]), d2);
  igual("D8 …el zapallo corregido a 700 g ya no es «≈» (sigue «en cubos»)", d2.ingredientes[0], { id: "ing_1", nombre: "Zapallo", cantidad: 700, unidad: "g", categoria: "Verduras y frutas", nota: "en cubos" });
  ok("D9 …las papas siguen con «unas seis» y las porciones cambiaron", d2.ingredientes[1].comoLoDijo === "unas seis" && d2.porciones === 6);

  const antes = await enNube();
  const v3 = await equipoViejo((rs) => rs.map((x) => (x.id === DICTADA.id ? { ...x, nombre: "Pisado" } : x)), antes.version - 1);
  ok("D10 con una versión vieja da 409 con lo último", v3.status === 409 && v3.datos.version === antes.version, v3.status);
  ok("D11 …lo que devuelve es lo guardado (con los campos nuevos), sin mezclar", JSON.stringify(v3.datos.datos) === JSON.stringify(antes.datos));
  igual("D12 …y en la nube no cambió nada", await enNube(), antes);

  // El equipo al día resuelve las dudas (las borra a propósito): con esquema 2 no se reponen. Su versión
  // quedó atrás (guardó el viejo): el primer intento choca, como en el store, y se rehace encima.
  let choco = false;
  const sinDudas = (rs: Receta[]) => rs.map((x) => (x.id === DICTADA.id ? (({ dudas: _, ...resto }) => resto)(x) : x));
  try {
    await repo.guardar("recetas", sinDudas(normalizar((await enNube()).datos)));
  } catch (e) {
    choco = e instanceof ConflictoVersion;
    await repo.guardar("recetas", sinDudas(normalizar((e as ConflictoVersion).datos)));
  }
  ok("D13 el equipo al día chocó una vez (409) y rehízo su cambio", choco);
  const d3 = await dictadaEnNube();
  ok("D14 con esquema 2 sí se pueden borrar las dudas", !("dudas" in d3) && d3.dictado?.id === ID, d3);

  // Un equipo viejo no las devuelve: ya no están en lo guardado.
  await equipoViejo((rs) => rs);
  ok("D15 un guardado viejo después no hace volver las dudas resueltas", !("dudas" in (await dictadaEnNube())));

  const v4 = await equipoViejo((rs) => borrarRecetaVieja(rs, DICTADA.id));
  ok("D16 el equipo viejo borra la receta dictada y no revive", v4.status === 200 && !(await dictadaEnNube()));

  // Reemplazar todo (respaldo de la versión anterior o datos de ejemplo): no se mezcla, a propósito.
  await repo.cargar();
  await repo.guardar("recetas", [json(DICTADA)]);
  const todo = await pedir("PUT", "/api/datos", { estado: { recetas: recetasViejas([json(DICTADA)]) } });
  ok("D17 PUT /api/datos (reemplazar todo) responde 200", todo.status === 200, todo);
  const d4 = await dictadaEnNube();
  ok("D18 …y guarda lo que llegó, sin reponer nada", !("dudas" in d4) && !("dictado" in d4) && !("estimado" in d4.ingredientes[0]), d4);

  // esquema 3 (una versión futura) no es un equipo viejo; un esquema que no es número sí.
  await C.guardarColeccion(FAM, "recetas", [json(DICTADA)], (await enNube()).version);
  const base = (await enNube()).version;
  const e3 = await pedir("PUT", "/api/datos/recetas", { datos: recetasViejas([json(DICTADA)]), versionBase: base, esquema: 3 });
  ok("D19 con esquema 3 se guarda tal cual (sin reponer)", e3.status === 200 && !("dudas" in (await dictadaEnNube())));
  await C.guardarColeccion(FAM, "recetas", [json(DICTADA)], (await enNube()).version);
  const ex = await pedir("PUT", "/api/datos/recetas", { datos: recetasViejas([json(DICTADA)]), versionBase: (await enNube()).version, esquema: "nuevo" });
  igual("D20 con un esquema que no es número se repone (equipo viejo)", ex.status === 200 ? await dictadaEnNube() : ex, json(DICTADA));

  // Otras colecciones no se tocan.
  const ev = [{ id: "ev1", titulo: "Dentista", fecha: "2026-11-12", todoElDia: true, miembros: [], repeticion: "nunca" }];
  const pe = await pedir("PUT", "/api/datos/eventos", { datos: ev, versionBase: 0 });
  igual("D21 eventos sin esquema se guardan tal cual", pe.status === 200 ? (await C.leerColeccion(FAM, "eventos"))?.datos : pe, ev);

  // El menú: la protección de los espacios (conservarItemsPlan, ver pruebas/comidas) también está conectada.
  const plan = { "2026-11-09|almuerzo": { recetaId: DICTADA.id, porciones: 4, mas: [{ texto: "Arroz" }, { texto: "Ensalada" }] } };
  await pedir("PUT", "/api/datos/plan", { datos: plan, versionBase: 0, esquema: 2 });
  const viejoPlan = { "2026-11-09|almuerzo": { recetaId: "rec_otra", porciones: 4 } };
  const pp = await pedir("PUT", "/api/datos/plan", { datos: viejoPlan, versionBase: 1 });
  igual("D22 plan sin esquema: se reponen los espacios 2.º en adelante", pp.status === 200 ? (await C.leerColeccion(FAM, "plan"))?.datos : pp, {
    "2026-11-09|almuerzo": { recetaId: "rec_otra", porciones: 4, mas: [{ texto: "Arroz" }, { texto: "Ensalada" }] },
  });

  // 400 guardados al azar de dos equipos (uno viejo y uno al día) con choques: lo dictado nunca se pierde
  // mientras nadie lo borre a propósito.
  await C.guardarColeccion(FAM, "recetas", [json(DICTADA), json(OTRA)], (await enNube()).version);
  let semilla = 7;
  const azar = () => ((semilla = (semilla * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  let perdidas = 0;
  let choques = 0;
  for (let n = 0; n < 400; n++) {
    const actual = await enNube();
    const base = azar() < 0.2 ? actual.version - 1 : actual.version; // a veces parte de una versión vieja
    if (azar() < 0.5) {
      const r = await equipoViejo((rs) => rs.map((x) => (x.id === "rec_otra" ? { ...x, porciones: 1 + Math.floor(azar() * 8) } : x)), base);
      if (r.status === 409) choques++;
    } else {
      const r = await pedir("PUT", "/api/datos/recetas", { datos: normalizar(actual.datos).map((x) => (x.id === "rec_otra" ? { ...x, nombre: `Porotos ${n}` } : x)), versionBase: base, esquema: 2 });
      if (r.status === 409) choques++;
    }
    if (JSON.stringify(await dictadaEnNube()) !== JSON.stringify(json(DICTADA))) perdidas++;
  }
  ok(`D23 400 guardados mezclados (${choques} choques): la receta dictada nunca perdió nada`, perdidas === 0 && choques > 0, { perdidas, choques });
});

// ---------------------------------------------------------------------------------------------
seccion("E. Cantidades estimadas en compras");
await caso("E", () => {
  const z = DICTADA.ingredientes[0];
  ok("E1 escalar(): 500 g «≈» de 4 a 8 porciones = 1000 g (un número normal)", escalar(z.cantidad, DICTADA, 8) === 1000);
  ok("E2 escalar() deja «al gusto» en null", escalar(DICTADA.ingredientes[2].cantidad, DICTADA, 8) === null);
  const lunes = "2026-11-09";
  const plan: PlanComidas = { "2026-11-09|almuerzo": { recetaId: DICTADA.id, porciones: 8 } };
  const l = generarLista(plan, [DICTADA], lunes);
  const zap = l.find((x) => x.nombre === "Zapallo");
  ok("E3 generarLista: Zapallo 1 kg", zap?.cantidad === 1 && zap.unidad === "kg", zap);
  ok("E4 …marcado como estimado", zap?.estimado === true);
  const papas = l.find((x) => x.nombre === "Papas");
  ok("E5 Papas 12, sin la marca", papas?.cantidad === 12 && !("estimado" in papas), papas);
  const sal = l.find((x) => x.nombre === "Sal");
  ok("E6 Sal queda «al gusto» (null) y sin la marca", sal?.cantidad === null && !("estimado" in sal!), sal);
  const exacta: Receta = { ...OTRA, id: "rec_sopa", nombre: "Sopa", ingredientes: [{ id: "s1", nombre: "Zapallo", cantidad: 500, unidad: "g", categoria: "Verduras y frutas" } as Ingrediente] };
  const l2 = generarLista({ ...plan, "2026-11-10|cena": { recetaId: "rec_sopa", porciones: 4 } }, [DICTADA, exacta], lunes);
  const zap2 = l2.find((x) => x.nombre === "Zapallo");
  ok("E7 una estimada sumada con una exacta: 1,5 kg y sigue marcada", zap2?.cantidad === 1.5 && zap2.estimado === true, zap2);
  const l3 = generarLista({ "2026-11-10|cena": { recetaId: "rec_sopa", porciones: 4 } }, [exacta], lunes);
  ok("E8 sin recetas dictadas, ninguna línea trae la marca (la lista de hoy no cambia)", l3.every((x) => !("estimado" in x)), l3);
});

// ---------------------------------------------------------------------------------------------
seccion("F. Tamaño");
{
  const muchas = Array.from({ length: 150 }, (_, n) => ({ ...json(DICTADA), id: `rec_${n}`, dudas: Array.from({ length: 20 }, () => "¿".padEnd(300, "x")) }));
  const tam = JSON.stringify(normalizar(muchas)).length;
  ok(`F1 150 recetas dictadas con 20 dudas largas cada una caben en una colección (${tam} de ${C.MAX_COLECCION})`, tam < C.MAX_COLECCION);
  info("la transcripción no va en la receta (queda en Blobs), por eso la colección no crece con lo que se dijo");
}

await terminar();
