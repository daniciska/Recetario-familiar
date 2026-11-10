// La respuesta de Gemini → borrador → Receta de la app (servidor/receta-ia/normalizar-receta.ts), con los
// 10 casos chilenos de casos.ts, respuestas malas, JSON cortado y los controles negativos de evaluar.ts.
// Es el puerto de la suite del prototipo (SP/prompt-esquema/prueba.test.ts, 163 OK); lo que allí probaba
// la Interactions API y peticion.ts no se copió al repositorio (se usa generateContent: ver gemini.test.ts).
//   node --experimental-transform-types --no-warnings --import ./pruebas/registrar.mjs pruebas/recetas/normalizar-receta.test.ts
import { adivinarCategoria, escalar } from "../../lib/compras.ts";
import * as N from "../../lib/datos/normalizar.ts";
import type { Ajustes, Receta } from "../../lib/datos/tipos.ts";
import { CLAVES, ESQUEMA_JSON } from "../../servidor/receta-ia/esquema.ts";
import { partesGenerateContent, textoPrueba } from "../../servidor/receta-ia/instruccion.ts";
import {
  AVISO_RESCATE,
  aRecetaApp,
  borradorRescate,
  interpretar,
  normalizar,
  numero,
  rescatarTranscripcion,
  type BorradorReceta,
} from "../../servidor/receta-ia/normalizar-receta.ts";
import { CASOS } from "./casos.ts";
import { evaluar } from "./evaluar.ts";
import { info, ok, seccion, terminar } from "./arnes.ts";

type O = Record<string, any>;
const op = { adivinarCategoria, nuevoId: (p: string) => `${p}_t${Math.random().toString(36).slice(2, 8)}` };
const ajustesBase: Ajustes = { nombreFamilia: "F", ciudad: "Santiago", latitud: -33.45, longitud: -70.66, tema: "auto", nocheDesde: "22:00", nocheHasta: "07:00" };
const ENLACE = { id: "abcdefghijkmnopqrstuvwxy", fecha: "2026-11-09T17:05:00.000Z", segundos: 154.4 };
const CAMPOS_NUEVOS = ["dudas", "dictado", "comoLoDijo", "estimado", "nota"];
const sinCamposNuevos = (r: Receta) =>
  JSON.parse(
    JSON.stringify(r, function (k, v) {
      // `nota` de la receta existía antes; sólo se quita la del ingrediente.
      if (k === "nota" && this && "unidad" in this) return undefined;
      return CAMPOS_NUEVOS.includes(k) && k !== "nota" ? undefined : v;
    }),
  );
// normalizar.ts de la app: ¿ya conoce los campos nuevos? (lo agrega otra etapa del plan, §3).
const normalizarApp = (r: unknown): Receta => N.normalizarGuardado({ recetas: [r] }, ajustesBase).recetas[0];
const appConoceCamposNuevos = (() => {
  const r = normalizarApp({ id: "x", nombre: "x", emoji: "🍲", porciones: 1, ingredientes: [], pasos: [], dudas: ["¿?"] });
  return Array.isArray(r.dudas);
})();

// ---------- C. Casos: el esperado cumple el esquema y sus propias comprobaciones ----------
seccion("C. Casos de prueba");
ok("C0 hay entre 8 y 10 casos", CASOS.length >= 8 && CASOS.length <= 10, CASOS.length);
for (const c of CASOS) {
  const { errores, avisos } = evaluar(c, c.esperado, ESQUEMA_JSON);
  ok(`C ${c.id}: esperado válido y cumple las comprobaciones`, errores.length === 0, errores);
  ok(`C ${c.id}: esperado cumple los deseables`, avisos.length === 0, avisos);
  ok(`C ${c.id}: claves en el orden del esquema`, JSON.stringify(Object.keys(c.esperado)) === JSON.stringify(CLAVES));
}

// ---------- D. Gemini simulado: respuesta → normalizar → Receta de la app ----------
seccion("D. Respuesta → borrador → Receta");
if (!appConoceCamposNuevos) info("lib/datos/normalizar.ts todavía no conserva los campos nuevos (etapa 1 del plan): se compara sin ellos");
for (const c of CASOS) {
  const r = interpretar(JSON.stringify(c.esperado));
  const b = r.ok ? normalizar(r.datos, op) : null;
  ok(`D ${c.id}: simulado → borrador`, !!b && b.esReceta === c.esperado.es_receta, b?.avisos);
  if (!b) continue;
  const revisar = b.ingredientes.filter((x) => x.revisar).map((x) => `${x.nombre}: ${x.revisar}`);
  ok(`D ${c.id}: ningún ingrediente marcado "revisar"`, revisar.length === 0, revisar);
  ok(`D ${c.id}: cantidad null ⇔ "al gusto"`, b.ingredientes.every((x) => (x.cantidad === null) === (x.unidad === "al gusto")));
  if (!b.esReceta) {
    ok(`D ${c.id}: no-receta trae motivo y transcripción`, !!b.motivo && b.transcripcion.length > 10);
    continue;
  }
  const rec = aRecetaApp(b, ENLACE);
  const vuelta = normalizarApp(rec);
  const esperado = appConoceCamposNuevos ? JSON.parse(JSON.stringify(rec)) : sinCamposNuevos(rec);
  ok(`D ${c.id}: la Receta pasa intacta por normalizar.ts de la app`, JSON.stringify(vuelta) === JSON.stringify(esperado), { vuelta, esperado });
  ok(`D ${c.id}: id rec_<id del dictado> y enlace al dictado`, rec.id === `rec_${ENLACE.id}` && rec.dictado?.id === ENLACE.id && rec.dictado.segundos === 154);
  ok(`D ${c.id}: estimado sólo con cantidad`, rec.ingredientes.every((i) => i.estimado === undefined || (i.estimado === true && i.cantidad != null)));
  const cambiadas = b.ingredientes
    .map((x) => [x.nombre, x.categoria, c.esperado.ingredientes.find((y) => y.nombre === x.nombre)?.categoria] as const)
    .filter(([, a, z]) => z && a !== z);
  if (cambiadas.length) info(`${c.id}: categoría de la app ≠ la de Gemini → ${cambiadas.map(([n, a, z]) => `${n}: ${z} → ${a}`).join("; ")}`);
}

// ---------- E. Respuestas malas ----------
seccion("E. Respuestas malas");
{
  const base = (ing: O[], extra: O = {}) => ({ ...CASOS[0].esperado, ingredientes: ing, ...extra });
  const uno = (x: O, extra: O = {}) =>
    normalizar(base([{ nombre: "Cebolla", como_lo_dijo: null, estimado: false, categoria: "Otros", nota: null, ...x }], extra), op).ingredientes[0];
  let x = uno({ cantidad: 1, unidad: "tarro" });
  ok("E1 'tarro' → lata", x.unidad === "lata" && x.cantidad === 1, x);
  x = uno({ cantidad: 500, unidad: "gramos" });
  ok("E2 'gramos' → g", x.unidad === "g" && x.cantidad === 500, x);
  x = uno({ cantidad: 2, unidad: "vaso" });
  ok("E3 'vaso' → taza, estimado", x.unidad === "taza" && x.cantidad === 2 && x.estimado === true, x);
  x = uno({ cantidad: 1, unidad: "docena" });
  ok("E4 'docena' → 12 unidad", x.unidad === "unidad" && x.cantidad === 12, x);
  x = uno({ cantidad: 3, unidad: "xyz" });
  ok("E5 unidad desconocida → unidad + revisar", x.unidad === "unidad" && /desconocida/.test(x.revisar ?? ""), x);
  x = uno({ cantidad: -2, unidad: "taza" });
  ok("E6 cantidad negativa → al gusto + revisar", x.cantidad === null && x.unidad === "al gusto" && /mal/.test(x.revisar ?? ""), x);
  x = uno({ cantidad: 0, unidad: "g" });
  ok("E7 cantidad 0 → al gusto", x.cantidad === null && x.unidad === "al gusto", x);
  x = uno({ cantidad: "1 1/2", unidad: "taza" });
  ok("E8 '1 1/2' → 1.5", x.cantidad === 1.5, x);
  x = uno({ cantidad: "2-3", unidad: "unidad" });
  ok("E9 rango '2-3' → 3 estimado", x.cantidad === 3 && x.estimado === true, x);
  x = uno({ cantidad: 3, unidad: "al gusto" });
  ok("E10 número con 'al gusto' → null", x.cantidad === null, x);
  x = uno({ cantidad: null, unidad: "pizca" });
  ok("E11 pizca sin número → 1 pizca", x.cantidad === 1 && x.unidad === "pizca", x);
  x = uno({ cantidad: 5000, unidad: "kg" });
  ok("E12 5000 kg → revisar (muy alta)", /alta/.test(x.revisar ?? ""), x);
  x = uno({ cantidad: 333.333, unidad: "g" });
  ok("E13 g se redondea a entero", x.cantidad === 333, x);
  x = uno({ cantidad: 0.3333, unidad: "taza" });
  ok("E14 taza a 2 decimales", x.cantidad === 0.33, x);
  x = uno({ nombre: "Chocolate", cantidad: 10, unidad: "kg" });
  ok("E15 ingrediente que no está en la transcripción → revisar", /transcripci/.test(x.revisar ?? ""), x);
  x = uno({ nombre: "chuchoca", cantidad: 1, unidad: "taza", categoria: "Despensa" });
  ok("E16 sin palabra en el diccionario de la app → queda la categoría de Gemini", x.categoria === "Despensa", x);
  x = uno({ nombre: "Azúcar flor", cantidad: null, unidad: "al gusto", categoria: "Despensa" });
  ok("E17 con palabra en el diccionario → manda la app (azúcar flor)", x.categoria === adivinarCategoria("Azúcar flor"), x);
  x = uno({ nombre: "Cebolla", cantidad: 1, unidad: "unidad", categoria: "Inventada" });
  ok("E18 categoría fuera del enum → adivinarCategoria", x.categoria === "Verduras y frutas", x);
  x = uno({ cantidad: 1, unidad: "cda", como_lo_dijo: "un chorrito", estimado: "si" });
  ok("E19 estimado no booleano → se deduce de como_lo_dijo", x.estimado === true, x);
  x = uno({ nombre: "Merkén", cantidad: 0.5, unidad: "cdta", categoria: "Especias" });
  ok("E19b Merkén con categoría inventada → «Condimentos y especias»", x.categoria === "Condimentos y especias", x);

  const dobles = normalizar(
    base([
      { nombre: "Cebolla", como_lo_dijo: "dos", cantidad: 2, unidad: "unidad", estimado: false, categoria: "Verduras y frutas", nota: "para el pino" },
      { nombre: "cebollas", como_lo_dijo: "otra", cantidad: 1, unidad: "unidad", estimado: false, categoria: "Verduras y frutas", nota: "para la pastelera" },
    ]),
    op,
  );
  ok("E20 misma cosa dos veces → se suma (2 + 1 = 3)", dobles.ingredientes.length === 1 && dobles.ingredientes[0].cantidad === 3, dobles.ingredientes);

  let b = normalizar(base([], { porciones: 0, porciones_estimadas: false, pasos: ["x"] }), op);
  ok("E21 porciones 0 → 4 estimadas + duda", b.porciones === 4 && b.porcionesEstimadas && b.dudas.some((d) => /personas/.test(d)), b);
  b = normalizar(base(CASOS[0].esperado.ingredientes, { porciones: 500 }), op);
  ok("E22 porciones 500 → 100 + aviso", b.porciones === 100 && b.avisos.some((a) => /altas/.test(a)), b.avisos);
  b = normalizar(base(CASOS[0].esperado.ingredientes, { porciones: "6", tiempo_min: 99999 }), op);
  ok("E23 porciones '6' → 6; tiempo 99999 → se quita", b.porciones === 6 && b.tiempoMin === undefined && b.avisos.some((a) => /imposible/.test(a)), b);
  b = normalizar(base(CASOS[0].esperado.ingredientes, { porciones: 2.6, tiempo_min: -5 }), op);
  ok("E24 porciones 2.6 → 3; tiempo negativo → sin tiempo", b.porciones === 3 && b.tiempoMin === undefined, b);
  b = normalizar(base([], { es_receta: true, pasos: [] }), op);
  ok("E25 es_receta true sin nada → no es receta + aviso", !b.esReceta && b.avisos.length > 0, b);
  b = normalizar(base(CASOS[0].esperado.ingredientes, { es_receta: false, motivo: "x" }), op);
  ok("E26 es_receta false con ingredientes → no es receta, con aviso", !b.esReceta && b.avisos.some((a) => /dijo que no/.test(a)), b.avisos);
  b = normalizar(base(CASOS[0].esperado.ingredientes, { emoji: "Pastel 🌽🌽" }), op);
  ok("E27 emoji con texto → el primer emoji", b.emoji === "🌽", b.emoji);
  b = normalizar(base(CASOS[0].esperado.ingredientes, { emoji: "👩‍🍳 rico" }), op);
  ok("E28 emoji con ZWJ se mantiene entero", b.emoji === "👩‍🍳", b.emoji);
  b = normalizar(base(CASOS[0].esperado.ingredientes, { emoji: "x", nombre: "Cazuela de vacuno" }), op);
  ok("E29 sin emoji → por el nombre", b.emoji === "🍲", b.emoji);
  b = normalizar(base(CASOS[0].esperado.ingredientes, { pasos: ["1. Pica la cebolla.", "Paso 2: Sofríe.", "Paso 2: Sofríe.", "- Agrega sal.", "  "] }), op);
  ok("E30 pasos: sin números, viñetas, vacíos ni repetidos", JSON.stringify(b.pasos) === JSON.stringify(["Pica la cebolla.", "Sofríe.", "Agrega sal."]), b.pasos);
  b = normalizar(base(CASOS[0].esperado.ingredientes, { pasos: Array.from({ length: 70 }, (_, n) => `Paso ${n + 1}: haz ${n}`) }), op);
  ok("E31 70 pasos → 40 + aviso", b.pasos.length === 40 && b.avisos.some((a) => /40 pasos/.test(a)), b.pasos.length);
  b = normalizar(base(CASOS[0].esperado.ingredientes, { nombre: "pastel‮ de\u0007 choclo  " }), op);
  ok("E32 nombre sin caracteres de control ni bidi, con mayúscula", b.nombre === "Pastel de choclo", b.nombre);
  b = normalizar(base(CASOS[0].esperado.ingredientes, { nombre: null }), op);
  ok("E33 sin nombre → 'Receta sin nombre' + duda", b.nombre === "Receta sin nombre" && b.dudas.some((d) => /llama/.test(d)), b.dudas);
  for (const raro of [null, "texto", [1, 2], 42, {}]) {
    const r = normalizar(raro, op);
    ok(`E34 entrada ${JSON.stringify(raro)} → borrador seguro`, r.esReceta === false && Array.isArray(r.ingredientes) && typeof r.nombre === "string");
  }
  const nums: [unknown, number | null][] = [["½", 0.5], ["1½", 1.5], ["1,5", 1.5], ["3/4", 0.75], ["dos", 2], ["media", 0.5], ["abc", null], [Number.NaN, null], ["≈ 2", 2]];
  for (const [entrada, esperado] of nums) ok(`E35 numero(${JSON.stringify(entrada)}) = ${esperado}`, numero(entrada).n === esperado, numero(entrada));
}

// ---------- F. JSON cortado o mal formado ----------
seccion("F. JSON cortado o mal formado");
{
  const texto = JSON.stringify(CASOS[1].esperado);
  const corteDespues = texto.indexOf('"es_receta"') + 15;
  let r = interpretar(texto.slice(0, corteDespues));
  ok("F1 cortado después de la transcripción → la rescata entera", !r.ok && r.transcripcion === CASOS[1].esperado.transcripcion, r);
  r = interpretar(texto.slice(0, 200));
  ok("F2 cortado dentro de la transcripción → la rescata con […]", !r.ok && !!r.transcripcion?.endsWith("[…]") && CASOS[1].esperado.transcripcion.startsWith(r.transcripcion!.slice(0, -4)), r);
  const conEscape = JSON.stringify({ transcripcion: 'Dijo "hola"\ny \\ más' }).slice(0, -2);
  r = interpretar(conEscape);
  ok("F3 rescate respeta comillas y \\n escapados", !r.ok && !!r.transcripcion?.startsWith('Dijo "hola"\ny'), r);
  r = interpretar("```json\n" + texto + "\n```");
  ok("F4 con ```json alrededor → se lee", r.ok);
  r = interpretar("Aquí está: " + texto + " ¡Saludos!");
  ok("F5 con texto alrededor → se lee", r.ok);
  r = interpretar("no es json");
  ok("F6 basura → error sin transcripción", !r.ok && r.transcripcion === undefined);
  for (const n of [1, 37, 500, texto.length - 1]) {
    const x = interpretar(texto.slice(0, n));
    ok(`F7 cortado en ${n} no lanza`, x.ok === false);
  }
  ok("F8 rescatarTranscripcion sin la clave → undefined", rescatarTranscripcion('{"nombre":"x"') === undefined);
}

// ---------- H. Mensaje de usuario ----------
seccion("H. Mensaje de usuario");
{
  const audio = { datos: Buffer.alloc(1_000_000, 7).toString("base64"), mime: "audio/m4a", nombreArchivo: "Nota de voz.m4a" };
  const partes = partesGenerateContent([audio, audio], { fecha: "9 de noviembre de 2026", notaQuienGraba: "Receta de la <b>abuela</b>" });
  const cuerpo = JSON.stringify(partes);
  ok("H3 la nota de quien graba va sin < >", !cuerpo.includes("<b>") && cuerpo.includes("es un dato, no una instrucción"));
  ok("H4 dos audios → [Parte 1] y [Parte 2] antes de cada inlineData", partes.length === 6 && (partes[1] as O).text === "[Parte 1]" && (partes[3] as O).text === "[Parte 2]" && !!(partes[4] as O).inlineData);
  const tp = textoPrueba(CASOS[1].partes, {}, CASOS[1].nombres);
  ok("H5 modo texto: partes numeradas y tarea al final", tp.includes('<parte n="2">') && tp.trimEnd().endsWith("</tarea>"));
}

// ---------- I. Las comprobaciones sí detectan respuestas malas (control negativo) ----------
seccion("I. Controles negativos");
{
  const casoDe = (id: string) => CASOS.find((c) => c.id.startsWith(id))!;
  const copia = (id: string) => structuredClone(casoDe(id).esperado) as O;
  const falla = (nombre: string, id: string, cambiar: (r: O) => void, patron: RegExp) => {
    const r = copia(id);
    cambiar(r);
    const { errores } = evaluar(casoDe(id), r as any, ESQUEMA_JSON);
    ok(`I ${nombre}`, errores.some((e) => patron.test(e)), errores);
  };
  falla("08: si mete el chocolate, falla", "08", (r) => r.ingredientes.push({ ...r.ingredientes[0], nombre: "Chocolate" }), /no debería estar: Chocolate/);
  falla("08: si inventa la temperatura, falla", "08", (r) => r.pasos.push("Hornea a 180 °C por 40 minutos."), /°/);
  falla("04: 'cuarto de pollo' como 250 g, falla", "04", (r) => Object.assign(r.ingredientes[1], { cantidad: 1500, unidad: "g" }), /pollo/);
  falla("06: jurel en gramos, falla", "06", (r) => Object.assign(r.ingredientes[5], { cantidad: 425, unidad: "g" }), /jurel/);
  falla("02: harina con número inventado, falla", "02", (r) => Object.assign(r.ingredientes[1], { cantidad: 4, unidad: "taza" }), /harina/);
  falla("02: zapallo sin la corrección (500 g), falla", "02", (r) => Object.assign(r.ingredientes[0], { cantidad: 500, unidad: "g" }), /zapallo/);
  falla("01: con pasas, falla", "01", (r) => r.ingredientes.push({ ...r.ingredientes[0], nombre: "Pasas" }), /Pasas/);
  falla("03: huevos sin la corrección (4), falla", "03", (r) => (r.ingredientes[3].cantidad = 4), /huevo/);
  falla("07: decir que es receta, falla", "07", (r) => (r.es_receta = true), /es_receta/);
  falla("unidad fuera del enum, falla el esquema", "05", (r) => (r.ingredientes[0].unidad = "tarro"), /enum/);
  falla("clave de más, falla el esquema", "05", (r) => (r.extra = 1), /de más/);
  falla("falta una clave, falla el esquema", "05", (r) => delete r.dudas, /falta/);
}

// ---------- J. aRecetaApp ----------
seccion("J. aRecetaApp (borrador → Receta con los campos nuevos)");
{
  const b = normalizar(CASOS[1].esperado, op); // sopaipillas: zapallo estimado, harina "lo que pida"
  const rec = aRecetaApp(b, ENLACE);
  ok("J1 id rec_<id del dictado>", rec.id === "rec_abcdefghijkmnopqrstuvwxy", rec.id);
  ok("J2 enlace al dictado {id, fecha, segundos redondeados}", JSON.stringify(rec.dictado) === JSON.stringify({ id: ENLACE.id, fecha: ENLACE.fecha, segundos: 154 }), rec.dictado);
  ok("J3 los ids de los ingredientes son los del borrador (para `revisar`)", rec.ingredientes.every((i, n) => i.id === b.ingredientes[n].id));
  const zapallo = rec.ingredientes.find((i) => /zapallo/i.test(i.nombre));
  ok("J4 cantidad estimada → estimado: true con su comoLoDijo", zapallo?.estimado === true && zapallo.cantidad != null && !!zapallo.comoLoDijo, zapallo);
  const harina = rec.ingredientes.find((i) => /harina/i.test(i.nombre));
  ok("J5 «lo que pida» → al gusto, sin estimado", harina?.cantidad === null && harina.unidad === "al gusto" && harina.estimado === undefined, harina);
  ok("J6 las dudas de Gemini van en la receta", Array.isArray(rec.dudas) && rec.dudas.length >= CASOS[1].esperado.dudas.length, rec.dudas);

  const conSecretos = aRecetaApp({ ...b, nota: "De la Lela.", secretos: ["que no hierva", "usar zapallo camote"] }, ENLACE);
  ok("J7 los secretos van a la nota", conSecretos.nota === "De la Lela.\n\nSecretos: que no hierva · usar zapallo camote", conSecretos.nota);
  const soloSecretos = aRecetaApp({ ...b, nota: undefined, secretos: ["que no hierva"] }, ENLACE);
  ok("J8 sin nota, sólo secretos", soloSecretos.nota === "Secretos: que no hierva", soloSecretos.nota);
  const sinNada = aRecetaApp({ ...b, nota: undefined, secretos: [] }, ENLACE);
  ok("J9 sin nota ni secretos → sin clave nota", !("nota" in sinNada));

  const raro: BorradorReceta = {
    ...b,
    ingredientes: [
      { id: "ing_1", nombre: "Sal", cantidad: null, unidad: "al gusto", categoria: "Condimentos y especias", estimado: true, comoLoDijo: "  " },
      { id: "ing_2", nombre: "Agua", cantidad: 2, unidad: "taza", categoria: "Bebidas", estimado: false, nota: "x".repeat(400), comoLoDijo: "y".repeat(400) },
      { id: "ing_3", nombre: "Leche", cantidad: 3, unidad: "al gusto", categoria: "Lácteos y huevos", estimado: true },
    ],
  };
  const r2 = aRecetaApp(raro, ENLACE);
  ok("J10 estimado sin cantidad se cae", !("estimado" in r2.ingredientes[0]), r2.ingredientes[0]);
  ok("J11 comoLoDijo vacío no aparece", !("comoLoDijo" in r2.ingredientes[0]));
  ok("J12 estimado false no aparece", !("estimado" in r2.ingredientes[1]));
  ok("J13 nota y comoLoDijo se recortan a 200", r2.ingredientes[1].nota?.length === 200 && r2.ingredientes[1].comoLoDijo?.length === 200);
  ok("J14 «al gusto» con número → cantidad null y sin estimado", r2.ingredientes[2].cantidad === null && !("estimado" in r2.ingredientes[2]), r2.ingredientes[2]);

  const conTiempo = aRecetaApp({ ...b, tiempoMin: 45, tiempoEstimado: true, dudas: ["¿Cuánta harina?"] }, ENLACE);
  ok("J15 tiempo estimado → duda de tiempo", conTiempo.dudas?.at(-1) === "¿Cuánto se demora en total? Puse ≈ 45 min.", conTiempo.dudas);
  const yaPregunta = aRecetaApp({ ...b, tiempoMin: 45, tiempoEstimado: true, dudas: ["¿Cuántos minutos va al horno?"] }, ENLACE);
  ok("J16 si ya hay una duda de tiempo, no se repite", yaPregunta.dudas?.length === 1, yaPregunta.dudas);
  const tiempoDicho = aRecetaApp({ ...b, tiempoMin: 45, tiempoEstimado: false, dudas: [] }, ENLACE);
  ok("J17 tiempo dicho y sin dudas → sin clave dudas, con tiempoMin", !("dudas" in tiempoDicho) && tiempoDicho.tiempoMin === 45, tiempoDicho);
  const muchas = aRecetaApp({ ...b, dudas: Array.from({ length: 30 }, (_, n) => `¿Duda ${n}? ${"z".repeat(400)}`) }, ENLACE);
  ok("J18 ≤ 20 dudas de ≤ 300", muchas.dudas?.length === 20 && muchas.dudas.every((q) => q.length <= 300));
  const sinSeg = aRecetaApp(b, { id: ENLACE.id, fecha: ENLACE.fecha });
  ok("J19 sin segundos → dictado sin segundos", JSON.stringify(sinSeg.dictado) === JSON.stringify({ id: ENLACE.id, fecha: ENLACE.fecha }));
  ok("J20 claves sin valor no aparecen (JSON = objeto)", JSON.stringify(Object.keys(rec)) === JSON.stringify(Object.keys(JSON.parse(JSON.stringify(rec)))));

  const vuelta = normalizarApp(rec);
  if (appConoceCamposNuevos)
    ok("J21 el resultado pasa por normalizar.ts de la app sin cambios (con los campos nuevos)", JSON.stringify(vuelta) === JSON.stringify(rec), { vuelta, rec });
  else {
    ok("J21 el resultado pasa por normalizar.ts de la app (sin los campos nuevos, que agrega la etapa 1)", JSON.stringify(vuelta) === JSON.stringify(sinCamposNuevos(rec)), { vuelta });
    info("J21: falta repetir con los campos nuevos cuando normalizar.ts los conserve");
  }
  const normalizarReceta = (N as Record<string, unknown>).normalizarReceta as ((x: unknown) => Receta | null) | undefined;
  if (normalizarReceta) ok("J22 normalizarReceta(aRecetaApp(b)) no cambia nada", JSON.stringify(normalizarReceta(rec)) === JSON.stringify(rec));
  else info("J22 omitido: normalizarReceta todavía no existe en lib/datos/normalizar.ts (etapa 1)");

  // Escalar una cantidad estimada es un número normal (compras.ts no cambia).
  const z = conTiempo.ingredientes.find((i) => i.estimado && i.cantidad != null);
  if (z) ok("J23 escalar() trata la cantidad estimada como un número", escalar(z.cantidad, conTiempo, conTiempo.porciones * 2) === z.cantidad! * 2);
}

// ---------- K. Borrador de rescate ----------
seccion("K. Borrador de rescate");
{
  const b = borradorRescate("Bueno, la cazuela de la abuela… [se corta]\u0007");
  ok("K1 receta mínima: «Receta dictada», 🍲, 4 porciones, sin ingredientes ni pasos", b.esReceta && b.nombre === "Receta dictada" && b.emoji === "🍲" && b.porciones === 4 && !b.ingredientes.length && !b.pasos.length);
  ok("K2 lleva la transcripción limpia y el aviso", b.transcripcion === "Bueno, la cazuela de la abuela… [se corta]" && b.avisos[0] === AVISO_RESCATE);
  const r = aRecetaApp(b, ENLACE);
  ok("K3 aRecetaApp del rescate es una Receta válida", r.id === `rec_${ENLACE.id}` && r.porciones === 4 && r.ingredientes.length === 0, r);
}

// ---------- L. Arreglos de la revisión ----------
seccion("L. Números en pasos, cantidades chicas, cercas y porciones");
{
  const base = (ing: O[], extra: O = {}) => ({ ...CASOS[0].esperado, ingredientes: ing, ...extra });
  const uno = (x: O) => normalizar(base([{ nombre: "Cebolla", como_lo_dijo: null, estimado: false, categoria: "Otros", nota: null, ...x }]), op).ingredientes[0];

  // Rangos, decimales y horas al comienzo de un paso no son numeración.
  let b = normalizar(
    base(CASOS[0].esperado.ingredientes, {
      pasos: ["10-15 minutos al horno moderado.", "1.5 litros de agua hirviendo encima.", "2-3 gotas de limón.", "1:30 horas a fuego lento.", "10 – 15 min más.", "2. Revuelve.", "3) Sirve.", "1.- Pica la cebolla.", "Paso 4 - Hornea.", "5 - 6 papas."],
      secretos: ["2-3 gotas de limón evitan que se oxide.", "1,5 kilos rinden más.", "1. Que no hierva."],
      dudas: ["1.5 o 2 tazas de harina?"],
    }),
    op,
  );
  ok(
    "L1 pasos: «10-15 min», «1.5 litros», «2-3 gotas», «1:30 horas», «10 – 15 min» y «5 - 6 papas» quedan enteros",
    JSON.stringify(b.pasos) ===
      JSON.stringify(["10-15 minutos al horno moderado.", "1.5 litros de agua hirviendo encima.", "2-3 gotas de limón.", "1:30 horas a fuego lento.", "10 – 15 min más.", "Revuelve.", "Sirve.", "Pica la cebolla.", "Hornea.", "5 - 6 papas."]),
    b.pasos,
  );
  ok("L2 secretos y dudas: lo mismo", JSON.stringify(b.secretos) === JSON.stringify(["2-3 gotas de limón evitan que se oxide.", "1,5 kilos rinden más.", "Que no hierva."]) && b.dudas[0] === "1.5 o 2 tazas de harina?", [b.secretos, b.dudas]);

  // Cantidades que se redondean a 0: nunca 0,25 de la unidad grande.
  let x = uno({ cantidad: 0.004, unidad: "l" });
  ok("L3 0.004 l → 4 ml (menos de 1 l va en ml), sin revisar", x.cantidad === 4 && x.unidad === "ml" && !x.revisar, x);
  x = uno({ cantidad: 0.5, unidad: "kg" });
  ok("L4 0.5 kg → 500 g", x.cantidad === 500 && x.unidad === "g", x);
  x = uno({ cantidad: 1.5, unidad: "kg" });
  ok("L5 1.5 kg se queda en kg", x.cantidad === 1.5 && x.unidad === "kg", x);
  x = uno({ cantidad: 0.0001, unidad: "kg" });
  ok("L6 0.0001 kg (0,1 g) → al gusto + revisar «venía mal», no 0,25 kg", x.cantidad === null && x.unidad === "al gusto" && /venía mal \(0\.0001 kg\)/.test(x.revisar ?? ""), x);
  x = uno({ cantidad: 0.004, unidad: "cdta" });
  ok("L7 0.004 cdta → al gusto + revisar, no 0,25 cdta", x.cantidad === null && x.unidad === "al gusto" && /venía mal/.test(x.revisar ?? ""), x);
  x = uno({ cantidad: 0.3, unidad: "g" });
  ok("L8 0.3 g → al gusto + revisar (antes quedaba en 1 g)", x.cantidad === null && /venía mal/.test(x.revisar ?? ""), x);
  x = uno({ cantidad: 0.001, unidad: "pizca" });
  ok("L9 0.001 pizca → 1 pizca, marcada para revisar", x.cantidad === 1 && x.unidad === "pizca" && /venía mal/.test(x.revisar ?? ""), x);
  const juntos = normalizar(
    base([
      { nombre: "Cebolla", como_lo_dijo: null, cantidad: 0.5, unidad: "kg", estimado: false, categoria: "Verduras y frutas", nota: null },
      { nombre: "Cebolla", como_lo_dijo: null, cantidad: 200, unidad: "g", estimado: false, categoria: "Verduras y frutas", nota: null },
    ]),
    op,
  ).ingredientes;
  ok("L10 0.5 kg + 200 g del mismo ingrediente → 700 g", juntos.length === 1 && juntos[0].cantidad === 700 && juntos[0].unidad === "g", juntos);

  // Las cercas de código se quitan sin volver atrás (antes: 4 s con 60.000 espacios).
  const raro = `{"transcripcion":"hola","nombre":"x"${" ".repeat(60_000)}}`;
  let t0 = performance.now();
  let r = interpretar(raro);
  const ms = performance.now() - t0;
  ok("L11 JSON con 60.000 espacios antes de la llave final → se lee en menos de 150 ms", r.ok && ms < 150, Math.round(ms));
  t0 = performance.now();
  r = interpretar("```json\n" + raro.slice(0, -1) + "x".repeat(10) + " ".repeat(60_000) + "?");
  ok("L12 … y uno roto igual de raro tampoco tarda", !r.ok && performance.now() - t0 < 150, Math.round(performance.now() - t0));
  r = interpretar("```JSON\n{\"a\":1}\n```");
  ok("L13 ```JSON … ``` se sigue leyendo", r.ok && (r.datos as O).a === 1, r);
  r = interpretar("```\n{\"a\":2}```");
  ok("L14 ``` sin json y sin salto final", r.ok && (r.datos as O).a === 2, r);

  // Porciones = personas: muchas porciones suelen ser las unidades que salen.
  b = normalizar(base(CASOS[0].esperado.ingredientes, { porciones: 40, porciones_estimadas: false, dudas: [] }), op);
  ok("L15 porciones 40 → duda «¿Son 40 personas, o son las unidades que salen?»", b.porciones === 40 && b.dudas.some((q) => /¿Son 40 personas, o son las unidades que salen\?/.test(q)), b.dudas);
  b = normalizar(base(CASOS[0].esperado.ingredientes, { porciones: 40, porciones_estimadas: false, dudas: ["¿Para cuántas personas alcanzan las 40?"] }), op);
  ok("L16 … si Gemini ya preguntó por las personas, no se repite", b.dudas.length === 1, b.dudas);
  b = normalizar(base(CASOS[0].esperado.ingredientes, { porciones: 12, porciones_estimadas: false, dudas: [] }), op);
  ok("L17 12 porciones → sin esa duda", !b.dudas.some((q) => /personas/.test(q)), b.dudas);
  b = normalizar(base(CASOS[0].esperado.ingredientes, { porciones: 30, porciones_estimadas: true, dudas: [] }), op);
  ok("L18 30 estimadas → una sola duda de porciones (la de las unidades)", b.dudas.filter((q) => /personas/.test(q)).length === 1 && /¿Son 30 personas/.test(b.dudas[0]), b.dudas);
  for (const c of CASOS.filter((y) => /salen como/i.test(y.partes.join(" ")))) {
    ok(`L19 ${c.id}: «salen como…» → porciones en personas (≤ 12), estimadas, y lo que sale en la nota`, c.esperado.porciones! <= 12 && c.esperado.porciones_estimadas && /salen como \d+/i.test(c.esperado.nota ?? ""), c.esperado.porciones);
  }
}

await terminar();
