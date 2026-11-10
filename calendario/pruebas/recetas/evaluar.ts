// Califica una respuesta de Gemini (cruda) contra las comprobaciones de un caso, y valida contra el
// subconjunto de JSON Schema que usa ESQUEMA_JSON (type con "null", enum, required, properties,
// additionalProperties: false, items). Sin dependencias.

import type { Caso, CompIng, Comprobaciones, Rango } from "./casos";

type O = Record<string, any>;
const sinTildes = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const re = (s: string) => new RegExp(s, "i");
const reN = (s: string) => new RegExp(sinTildes(s), "i"); // sobre texto sin tildes

// ---------- Validador del subconjunto ----------

export function validarEsquema(valor: unknown, esquema: O, ruta = "$"): string[] {
  const errores: string[] = [];
  const tipos: string[] = Array.isArray(esquema.type) ? esquema.type : [esquema.type];
  const tipoDe = (v: unknown) =>
    v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "number" ? (Number.isInteger(v) ? "integer" : "number") : typeof v;
  const t = tipoDe(valor);
  const calza = tipos.some((x) => x === t || (x === "number" && t === "integer"));
  if (!calza) return [`${ruta}: tipo ${t}, se esperaba ${tipos.join("|")}`];
  if (esquema.enum && valor !== null && !esquema.enum.includes(valor)) errores.push(`${ruta}: "${String(valor)}" fuera del enum`);
  if (t === "object") {
    const v = valor as O;
    for (const k of esquema.required ?? []) if (!(k in v)) errores.push(`${ruta}.${k}: falta`);
    for (const [k, sub] of Object.entries(esquema.properties ?? {})) if (k in v) errores.push(...validarEsquema(v[k], sub as O, `${ruta}.${k}`));
    if (esquema.additionalProperties === false)
      for (const k of Object.keys(v)) if (!(k in (esquema.properties ?? {}))) errores.push(`${ruta}.${k}: clave de más`);
  }
  if (t === "array" && esquema.items) (valor as unknown[]).forEach((x, n) => errores.push(...validarEsquema(x, esquema.items, `${ruta}[${n}]`)));
  return errores;
}

// ---------- Comprobaciones ----------

const BASE: Record<string, [string, number]> = { g: ["g", 1], kg: ["g", 1000], ml: ["ml", 1], l: ["ml", 1000] };

function rango(nombre: string, valor: unknown, r: Rango | undefined, base?: string): string | null {
  if (r === undefined) return null;
  if (r === null) return valor === null ? null : `${nombre}: se esperaba null y vino ${JSON.stringify(valor)}`;
  if (typeof valor !== "number") return `${nombre}: no es número (${JSON.stringify(valor)})`;
  let v = valor;
  if (r.base !== undefined) {
    const b = base ? BASE[base] : undefined;
    if (!b) return `${nombre}: unidad ${base} no es de peso/volumen`;
    v = valor * b[1];
    const [a, z] = Array.isArray(r.base) ? r.base : [r.base * 0.98, r.base * 1.02];
    return v >= a && v <= z ? null : `${nombre}: ${v} ${b[0]} fuera de ${a}–${z}`;
  }
  if (r.igual !== undefined && Math.abs(v - r.igual) > 1e-6) return `${nombre}: ${v} ≠ ${r.igual}`;
  if (r.entre && (v < r.entre[0] || v > r.entre[1])) return `${nombre}: ${v} fuera de ${r.entre[0]}–${r.entre[1]}`;
  return null;
}

function compIng(lista: O[], c: CompIng): string[] {
  const candidatos = lista.filter((i) => reN(c.n).test(sinTildes(String(i?.nombre ?? ""))));
  if (!candidatos.length) return [`falta ingrediente /${c.n}/`];
  // Basta con que UNO de los que calzan cumpla todo (p. ej. dos líneas de azúcar).
  let mejor: string[] | null = null;
  for (const i of candidatos) {
    const e: string[] = [];
    if (c.u && !c.u.includes(i.unidad)) e.push(`/${c.n}/ unidad ${i.unidad} ∉ [${c.u.join(", ")}]`);
    const r = rango(`/${c.n}/ cantidad`, i.cantidad, c.c, i.unidad);
    if (r) e.push(r);
    if (c.e !== undefined && i.estimado !== c.e) e.push(`/${c.n}/ estimado=${i.estimado}, se esperaba ${c.e}`);
    if (c.cat && !c.cat.includes(i.categoria)) e.push(`/${c.n}/ categoría ${i.categoria} ∉ [${c.cat.join(", ")}]`);
    if (c.nota && !re(c.nota).test(`${i.nota ?? ""} ${i.nombre ?? ""}`)) e.push(`/${c.n}/ nota sin /${c.nota}/`);
    if (!e.length) return [];
    if (!mejor || e.length < mejor.length) mejor = e;
  }
  return mejor ?? [];
}

export function comprobar(r: O, c: Comprobaciones): string[] {
  const e: string[] = [];
  const push = (x: string | null) => x && e.push(x);
  const ings: O[] = Array.isArray(r?.ingredientes) ? r.ingredientes : [];
  const pasos: string[] = Array.isArray(r?.pasos) ? r.pasos.map(String) : [];
  const dudas: string[] = Array.isArray(r?.dudas) ? r.dudas.map(String) : [];
  const secretos: string[] = Array.isArray(r?.secretos) ? r.secretos.map(String) : [];
  const trans = String(r?.transcripcion ?? "");

  if (c.es_receta !== undefined && r?.es_receta !== c.es_receta) e.push(`es_receta=${r?.es_receta}, se esperaba ${c.es_receta}`);
  push(rango("porciones", r?.porciones, c.porciones));
  if (c.porciones_estimadas !== undefined && r?.porciones_estimadas !== c.porciones_estimadas)
    e.push(`porciones_estimadas=${r?.porciones_estimadas}, se esperaba ${c.porciones_estimadas}`);
  push(rango("tiempo_min", r?.tiempo_min, c.tiempo_min));
  if (c.tiempo_estimado !== undefined && r?.tiempo_estimado !== c.tiempo_estimado)
    e.push(`tiempo_estimado=${r?.tiempo_estimado}, se esperaba ${c.tiempo_estimado}`);
  if (c.ing) {
    if (c.ing.length === 0 && ings.length) e.push(`se esperaban 0 ingredientes y vinieron ${ings.length}`);
    for (const ci of c.ing) e.push(...compIng(ings, ci));
  }
  for (const s of c.sin_ing ?? []) {
    const hay = ings.find((i) => reN(s).test(sinTildes(String(i?.nombre ?? ""))));
    if (hay) e.push(`no debería estar: ${hay.nombre}`);
  }
  if (c.pasos_min !== undefined && pasos.length < c.pasos_min) e.push(`pasos: ${pasos.length} < ${c.pasos_min}`);
  if (c.pasos_min === 0 && pasos.length) e.push(`se esperaban 0 pasos`);
  for (const s of c.pasos_re ?? []) if (!pasos.some((p) => re(s).test(p))) e.push(`ningún paso con /${s}/`);
  for (const s of c.pasos_no ?? []) if (pasos.some((p) => re(s).test(p))) e.push(`un paso tiene /${s}/`);
  if (c.dudas_min !== undefined && dudas.length < c.dudas_min) e.push(`dudas: ${dudas.length} < ${c.dudas_min}`);
  for (const s of c.dudas_re ?? []) if (!dudas.some((d) => reN(s).test(sinTildes(d)))) e.push(`ninguna duda con /${s}/`);
  for (const s of c.secretos_re ?? []) if (!secretos.some((d) => re(s).test(d))) e.push(`ningún secreto con /${s}/`);
  for (const s of c.trans_re ?? []) if (!re(s).test(trans)) e.push(`transcripción sin /${s}/`);
  for (const s of c.trans_no ?? []) if (re(s).test(trans)) e.push(`transcripción con /${s}/`);
  if (c.nombre_re && !re(c.nombre_re).test(String(r?.nombre ?? ""))) e.push(`nombre "${r?.nombre}" sin /${c.nombre_re}/`);
  if (c.nota_re && !re(c.nota_re).test(`${r?.nota ?? ""} ${secretos.join(" ")}`)) e.push(`nota sin /${c.nota_re}/`);
  if (c.emoji && !c.emoji.includes(r?.emoji)) e.push(`emoji ${r?.emoji} ∉ ${c.emoji.join(" ")}`);
  return e;
}

/** Errores (fallan la prueba) y avisos (deseables) de una respuesta para un caso. */
export function evaluar(caso: Caso, r: O, esquema?: O) {
  const errores = [...(esquema ? validarEsquema(r, esquema) : []), ...comprobar(r, caso.comprobaciones)];
  const avisos = caso.deseables ? comprobar(r, caso.deseables) : [];
  return { errores, avisos };
}
