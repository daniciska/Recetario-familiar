// La app ANTES de las recetas dictadas (commit f056550, nov 2026), copiada tal cual para simular un
// equipo que sigue con esa versión (la tablet de la pared antes de su recarga, un iPhone sin recargar):
// cómo lee las recetas (normalizar) y qué manda al guardarlas. No se usa en la app.
//
//   lib/datos/normalizar.ts      → recetasViejas (receta() e ingrediente() con sus ayudantes)
//   components/VistaRecetas.tsx  → guardarRecetaVieja (EditorReceta.guardar), borrarRecetaVieja
//   lib/datos/repositorioNube.ts → cuerpoViejo (guardar(): sin `esquema`)
import { CATEGORIAS, UNIDADES } from "../../lib/compras.ts";

type Obj = Record<string, unknown>;
export interface IngredienteViejo {
  id: string;
  nombre: string;
  cantidad: number | null;
  unidad: string;
  categoria: string;
}
export interface RecetaVieja {
  id: string;
  nombre: string;
  emoji: string;
  foto?: string;
  porciones: number;
  tiempoMin?: number;
  ingredientes: IngredienteViejo[];
  pasos: string[];
  nota?: string;
}

const UNIDADES_OK = new Set<string>(UNIDADES.map((u) => u.valor));
const CATEGORIAS_OK = new Set<string>(CATEGORIAS.map((c) => c.nombre));
const esObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const txt = (x: unknown, def = ""): string => (typeof x === "string" ? x : def);
const txtOpc = (x: unknown): string | undefined => (typeof x === "string" && x.trim() ? x : undefined);
const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
let contador = 0;
const idNuevo = (p: string) => `${p}_r${Date.now().toString(36)}${(contador++).toString(36)}`;
const id = (x: unknown, p: string) => (typeof x === "string" && x ? x : idNuevo(p));
function lista<T>(x: unknown, f: (y: unknown) => T | null): T[] {
  return Array.isArray(x) ? x.map(f).filter((y): y is T => y !== null) : [];
}

function ingrediente(x: unknown): IngredienteViejo | null {
  if (!esObj(x)) return null;
  const unidad = UNIDADES_OK.has(x.unidad as string) ? (x.unidad as string) : "unidad";
  const c = num(x.cantidad);
  return {
    id: id(x.id, "ing"),
    nombre: txt(x.nombre),
    cantidad: unidad === "al gusto" || c == null || c < 0 ? null : c,
    unidad,
    categoria: CATEGORIAS_OK.has(x.categoria as string) ? (x.categoria as string) : "Otros",
  };
}

function receta(x: unknown): RecetaVieja | null {
  if (!esObj(x)) return null;
  const porciones = num(x.porciones);
  const tiempo = num(x.tiempoMin);
  const foto = txt(x.foto);
  return {
    id: id(x.id, "rec"),
    nombre: txt(x.nombre, "Receta sin nombre"),
    emoji: txt(x.emoji, "🍲") || "🍲",
    foto: /^(data:image\/|https?:\/\/|\/)/.test(foto) ? foto : undefined,
    porciones: porciones && porciones > 0 ? Math.round(porciones) : 4,
    tiempoMin: tiempo && tiempo > 0 ? Math.round(tiempo) : undefined,
    ingredientes: lista(x.ingredientes, ingrediente),
    pasos: lista(x.pasos, (p) => (typeof p === "string" ? p : null)),
    nota: txtOpc(x.nota),
  };
}

/** normalizarGuardado(...).recetas de la versión anterior. */
export const recetasViejas = (x: unknown): RecetaVieja[] => lista(x, receta);

/** EditorReceta.guardar: el editor parte de la receta ya normalizada ({...r}) y hace upsert por id. */
export function guardarRecetaVieja(recetas: RecetaVieja[], r: RecetaVieja): RecetaVieja[] {
  const limpia: RecetaVieja = {
    ...r,
    nombre: r.nombre.trim(),
    tiempoMin: r.tiempoMin && r.tiempoMin > 0 ? Math.round(r.tiempoMin) : undefined,
    ingredientes: r.ingredientes.filter((i) => i.nombre.trim()).map((i) => ({ ...i, nombre: i.nombre.trim() })),
    pasos: r.pasos.map((p) => p.trim()).filter(Boolean),
  };
  return recetas.some((x) => x.id === limpia.id) ? recetas.map((x) => (x.id === limpia.id ? limpia : x)) : [...recetas, limpia];
}

/** EditorReceta.borrar (la parte de recetas). */
export const borrarRecetaVieja = (recetas: RecetaVieja[], recetaId: string) => recetas.filter((x) => x.id !== recetaId);

/** RepositorioNube.guardar(): el cuerpo de PUT /api/datos/:clave, sin `esquema`. */
export const cuerpoViejo = (datos: unknown, versionBase: number) => ({ datos, versionBase });
