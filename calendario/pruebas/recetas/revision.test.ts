// lib/dictados/revision.ts: la revisión de un borrador que queda en el equipo (y vale sólo para esa versión
// del borrador) y cómo se limpia una receta antes de guardarla. Los borradores son los de verdad: los 10
// casos de casos.ts pasados por normalizar() y aRecetaApp() del servidor.
//   node --experimental-transform-types --no-warnings --import ./pruebas/registrar.mjs pruebas/recetas/revision.test.ts
import { adivinarCategoria } from "../../lib/compras.ts";
import { normalizarReceta } from "../../lib/datos/normalizar.ts";
import type { Ingrediente, Receta } from "../../lib/datos/tipos.ts";
import { borradorVacio, borrarRevision, claveRevision, guardarRevision, leerRevision, limpiarIngrediente, limpiarReceta } from "../../lib/dictados/revision.ts";
import { aRecetaApp, normalizar } from "../../servidor/receta-ia/normalizar-receta.ts";
import { isDeepStrictEqual } from "node:util";
import { caso, ok, seccion, terminar } from "./arnes.ts";
import { CASOS } from "./casos.ts";

const igual = (n: string, a: unknown, b: unknown) => ok(n, JSON.stringify(a) === JSON.stringify(b), { obtenido: a, esperado: b });

/** Un localStorage en memoria (o que falla, para los equipos sin almacenamiento o llenos). */
function almacen(falla: "" | "leer" | "escribir" = "") {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => {
      if (falla === "leer") throw new Error("SecurityError");
      return m.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (falla === "escribir") throw new Error("QuotaExceededError");
      m.set(k, v);
    },
    removeItem: (k: string) => void m.delete(k),
  };
}

const ID = "abcdefghijkmnopqrstuvwxy";
let n = 0;
const borradores: Receta[] = CASOS.filter((c) => c.esperado.es_receta).map((c, i) => {
  const id = ID.slice(0, 23) + "23456789abcdefghijk"[i]; // un id válido distinto por caso (ID_DICTADO)
  const b = normalizar(c.esperado, { adivinarCategoria, nuevoId: (p) => `${p}_${(n++).toString(36)}` });
  return aRecetaApp(b, { id, fecha: "2026-11-09T17:05:00.000Z", segundos: 95 });
});
const dict = (r: Receta, actualizado = "2026-11-09T17:06:00.000Z") => ({ id: r.dictado!.id, actualizado });

seccion("Revisión guardada en el equipo");
await caso("guardar y volver a leer", () => {
  const a = almacen();
  const r = borradores[0];
  const d = dict(r);
  ok("no hay nada al empezar", leerRevision(d, a) === null);
  const cambiada: Receta = { ...r, nombre: "Pastel de choclo de la Nona", ingredientes: r.ingredientes.map((i, k) => (k === 0 ? { ...i, cantidad: 5, estimado: undefined } : i)) };
  ok("guardarRevision da true", guardarRevision(d, cambiada, a));
  ok("con la clave calendario-familiar:revision:<id>", a.m.has(claveRevision(d.id)) && claveRevision(d.id) === `calendario-familiar:revision:${d.id}`);
  const leida = leerRevision(d, a);
  igual("se lee lo corregido (igual que al normalizarlo)", leida, normalizarReceta(cambiada));
  ok("la cantidad corregida a mano ya no es estimada", leida?.ingredientes[0].cantidad === 5 && !("estimado" in (leida?.ingredientes[0] ?? {})));
  ok("otra versión del borrador (otro `actualizado`): no sirve", leerRevision(dict(r, "2026-11-09T18:00:00.000Z"), a) === null);
  borrarRevision(d.id, a);
  ok("borrarRevision la quita", leerRevision(d, a) === null && a.m.size === 0);
});
await caso("datos dañados o ajenos", () => {
  const a = almacen();
  const r = borradores[1];
  const d = dict(r);
  a.m.set(claveRevision(d.id), "{no es json");
  ok("JSON dañado → null", leerRevision(d, a) === null);
  a.m.set(claveRevision(d.id), JSON.stringify({ actualizado: d.actualizado, receta: { ...r, id: "rec_otra" } }));
  ok("receta con otro id → null", leerRevision(d, a) === null);
  a.m.set(claveRevision(d.id), JSON.stringify({ actualizado: d.actualizado, receta: "hola" }));
  ok("algo que no es receta → null", leerRevision(d, a) === null);
  a.m.set(claveRevision(d.id), JSON.stringify(null));
  ok("null → null", leerRevision(d, a) === null);
});
await caso("sin almacenamiento", () => {
  const r = borradores[2];
  const d = dict(r);
  ok("si leer falla: null (no lanza)", leerRevision(d, almacen("leer")) === null);
  ok("si escribir falla (equipo lleno): false (no lanza)", guardarRevision(d, r, almacen("escribir")) === false);
  ok("sin localStorage: null y false", leerRevision(d, null) === null && guardarRevision(d, r, null) === false);
  borrarRevision(d.id, null);
  ok("borrar sin almacenamiento no lanza", true);
});

seccion("Limpiar antes de guardar");
await caso("ingrediente", () => {
  const base: Ingrediente = { id: "ing_1", nombre: "  Zapallo ", cantidad: 500, unidad: "g", categoria: "Verduras y frutas" };
  igual("una de antes queda igual (sólo el nombre recortado, sin claves nuevas)", limpiarIngrediente(base), { ...base, nombre: "Zapallo" });
  igual("estimado con cantidad se queda", limpiarIngrediente({ ...base, estimado: true }).estimado, true);
  ok("estimado sin cantidad se cae", !("estimado" in limpiarIngrediente({ ...base, cantidad: null, unidad: "al gusto", estimado: true })));
  const l = limpiarIngrediente({ ...base, nota: "  en cubos  ", comoLoDijo: " un buen trozo " });
  ok("nota y «cómo lo dijo» recortadas", l.nota === "en cubos" && l.comoLoDijo === "un buen trozo", l);
  const vacios = limpiarIngrediente({ ...base, nota: "   ", comoLoDijo: "", estimado: undefined });
  igual("notas vacías y estimado undefined no dejan claves", Object.keys(vacios), ["id", "nombre", "cantidad", "unidad", "categoria"]);
  ok("nota de más de 200 se corta", limpiarIngrediente({ ...base, nota: "x".repeat(250) }).nota?.length === 200);
});
await caso("receta", () => {
  const r = borradores[0];
  const sucia: Receta = {
    ...r,
    nombre: "  Pastel  ",
    tiempoMin: 0,
    nota: "   ",
    dudas: ["  ¿Cuántos choclos?  ", "", "   "],
    ingredientes: [...r.ingredientes, { id: "ing_vacio", nombre: "  ", cantidad: null, unidad: "g", categoria: "Otros" }],
    pasos: [...r.pasos, "   ", ""],
  };
  const l = limpiarReceta(sucia);
  ok("nombre recortado", l.nombre === "Pastel");
  ok("minutos 0 → sin la clave", !("tiempoMin" in l));
  ok("nota vacía → sin la clave", !("nota" in l));
  igual("dudas recortadas, sin vacías", l.dudas, ["¿Cuántos choclos?"]);
  ok("sin el ingrediente sin nombre", !l.ingredientes.some((i) => i.id === "ing_vacio") && l.ingredientes.length === r.ingredientes.length);
  ok("sin pasos vacíos", l.pasos.length === r.pasos.length);
  igual("conserva el enlace al dictado", l.dictado, r.dictado);
  ok("sin dudas → sin la clave", !("dudas" in limpiarReceta({ ...r, dudas: ["  "] })));
  igual("minutos redondeados", limpiarReceta({ ...r, tiempoMin: 44.6 }).tiempoMin, 45);
});
await caso("lo que se guarda pasa por el normalizador de la app sin cambios", () => {
  const malos: string[] = [];
  for (const r of borradores) {
    const l = limpiarReceta(r);
    // Mismo contenido (el orden de las claves no importa; las claves con undefined no se guardan).
    if (!isDeepStrictEqual(JSON.parse(JSON.stringify(normalizarReceta(l))), JSON.parse(JSON.stringify(l)))) malos.push(r.nombre);
  }
  ok(`los ${borradores.length} borradores de casos.ts`, malos.length === 0 && borradores.length >= 8, malos);
  ok("…con «≈» (estimado), «cómo lo dijo», nota y dudas", borradores.some((r) => r.ingredientes.some((i) => i.estimado && i.comoLoDijo && i.nota)) && borradores.some((r) => r.dudas?.length));
});
await caso("borrador vacío", () => {
  let k = 0;
  const v = borradorVacio({ id: ID, nombre: undefined, emoji: undefined, creado: "2026-11-09T17:05:00.000Z", segundos: 12 }, () => ({ id: `ing_${k++}`, nombre: "", cantidad: null, unidad: "g", categoria: "Otros" }));
  ok("id rec_<id> y enlace al dictado", v.id === `rec_${ID}` && v.dictado?.id === ID && v.dictado.segundos === 12, v);
  ok("nombre «Receta dictada», 4 porciones", v.nombre === "Receta dictada" && v.porciones === 4);
  igual("pasa por el normalizador de la app", normalizarReceta(v)?.dictado, v.dictado);
});

await terminar();
