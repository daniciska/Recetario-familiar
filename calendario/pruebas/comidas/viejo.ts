// La app ANTES de los espacios por comida (commit f056550, nov 2026), copiada tal cual para simular
// un equipo que sigue con esa versión (la tablet de la pared, un teléfono sin recargar): cómo lee el
// plan (normalizar) y qué guarda con cada cosa que se puede hacer en el menú. No se usa en la app.
//
//   lib/datos/normalizar.ts → planViejo (con sus ayudantes)
//   components/VistaComidas.tsx → asignarViejo ("poner"), guardarPorcionesViejo, repetirSemanaVieja
//   components/VistaRecetas.tsx → borrarRecetaVieja ("borrar": también sale del menú)

type Obj = Record<string, unknown>;
interface ComidaVieja {
  recetaId?: string;
  texto?: string;
  porciones: number;
}
export type PlanViejo = Record<string, ComidaVieja>;

const CLAVE_PLAN = /^\d{4}-\d{2}-\d{2}\|(desayuno|colacion|almuerzo|once|cena)$/;
const esObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const txtOpc = (x: unknown): string | undefined => (typeof x === "string" && x.trim() ? x : undefined);
const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

/** lib/datos/normalizar.ts, function plan() de la versión anterior. */
export function planViejo(x: unknown): PlanViejo {
  const p: PlanViejo = {};
  if (!esObj(x)) return p;
  for (const [k, v] of Object.entries(x)) {
    if (!CLAVE_PLAN.test(k) || !esObj(v)) continue;
    const c: ComidaVieja = {
      recetaId: txtOpc(v.recetaId),
      texto: txtOpc(v.texto),
      porciones: Math.max(1, Math.round(num(v.porciones) ?? 4)),
    };
    if (c.recetaId || c.texto) p[k] = c;
  }
  return p;
}

/** AsignarComida.poner: elegir una receta, un atajo o un texto (c) o "Quitar" (null). */
export function asignarViejo(plan: PlanViejo, clave: string, c: ComidaVieja | null): PlanViejo {
  const n = { ...plan };
  if (c) n[clave] = c;
  else delete n[clave];
  return n;
}

/** AsignarComida, botón "Guardar porciones": poner({ ...actual, porciones }). */
export function guardarPorcionesViejo(plan: PlanViejo, clave: string, porciones: number): PlanViejo {
  return asignarViejo(plan, clave, { ...plan[clave], porciones });
}

const sumarDias = (f: string, n: number) => {
  const d = new Date(f + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** VistaComidas.repetirSemanaPasada (los días de la semana que se ve). */
export function repetirSemanaVieja(plan: PlanViejo, dias: string[]): PlanViejo {
  const nuevo = { ...plan };
  for (const f of dias)
    for (const t of ["desayuno", "colacion", "almuerzo", "once", "cena"]) {
      const prev = plan[`${sumarDias(f, -7)}|${t}`];
      const k = `${f}|${t}`;
      if (prev && !nuevo[k]) nuevo[k] = { ...prev };
    }
  return nuevo;
}

/** VistaRecetas, borrar una receta: también sale del menú. */
export function borrarRecetaVieja(plan: PlanViejo, recetaId: string): PlanViejo {
  return Object.fromEntries(Object.entries(plan).filter(([, c]) => c.recetaId !== recetaId));
}
