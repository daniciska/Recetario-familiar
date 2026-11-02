import type {
  CategoriaCompra,
  ComidaPlanificada,
  ItemCompra,
  PlanComidas,
  Receta,
  Unidad,
} from "./datos/tipos";
import { diasDeSemana } from "./fechas";

export const CATEGORIAS: { nombre: CategoriaCompra; emoji: string }[] = [
  { nombre: "Verduras y frutas", emoji: "🥬" },
  { nombre: "Carnes y pescados", emoji: "🥩" },
  { nombre: "Lácteos y huevos", emoji: "🧀" },
  { nombre: "Panadería", emoji: "🥖" },
  { nombre: "Despensa", emoji: "🥫" },
  { nombre: "Condimentos y especias", emoji: "🧂" },
  { nombre: "Congelados", emoji: "🧊" },
  { nombre: "Bebidas", emoji: "🧃" },
  { nombre: "Aseo y hogar", emoji: "🧽" },
  { nombre: "Otros", emoji: "🛒" },
];

export const UNIDADES: { valor: Unidad; nombre: string }[] = [
  { valor: "g", nombre: "g" },
  { valor: "kg", nombre: "kg" },
  { valor: "ml", nombre: "ml" },
  { valor: "l", nombre: "litros" },
  { valor: "unidad", nombre: "unidades" },
  { valor: "taza", nombre: "tazas" },
  { valor: "cda", nombre: "cucharadas" },
  { valor: "cdta", nombre: "cucharaditas" },
  { valor: "diente", nombre: "dientes" },
  { valor: "atado", nombre: "atados" },
  { valor: "lata", nombre: "latas" },
  { valor: "paquete", nombre: "paquetes" },
  { valor: "pizca", nombre: "pizca" },
  { valor: "al gusto", nombre: "al gusto" },
];

/** Palabras clave → categoría, con nombres chilenos. Se revisa en orden. */
const DICCIONARIO: [CategoriaCompra, string[]][] = [
  ["Congelados", ["congelad", "helado", "arvejas congeladas"]],
  [
    "Lácteos y huevos",
    ["leche", "queso", "quesillo", "mantequilla", "crema", "yogur", "manjar", "huevo", "margarina"],
  ],
  [
    "Carnes y pescados",
    [
      "carne", "pollo", "posta", "osobuco", "plateada", "lomo", "pulpa", "cerdo", "chuleta",
      "longaniza", "chorizo", "tocino", "jamón", "jamon", "salchicha", "vienesa", "pescado",
      "merluza", "reineta", "salmón", "salmon", "jurel", "atún", "atun", "camarón", "camaron",
      "pino", "molida", "costilla", "trutro", "pechuga", "vacuno",
    ],
  ],
  [
    "Verduras y frutas",
    [
      "cebolla", "ajo", "tomate", "lechuga", "papa", "zapallo", "choclo", "zanahoria", "pimentón",
      "pimenton", "ají", "aji", "cilantro", "perejil", "albahaca", "apio", "porotos verdes",
      "poroto verde", "acelga", "espinaca", "betarraga", "palta", "limón", "limon", "plátano",
      "platano", "manzana", "naranja", "frutilla", "pepino", "repollo", "brócoli", "brocoli",
      "coliflor", "champiñón", "champinon", "camote", "porotos granados", "arveja", "pera",
      "durazno", "uva", "kiwi", "mandarina", "cebollín", "cebollin", "puerro", "berenjena",
    ],
  ],
  ["Panadería", ["pan", "marraqueta", "hallulla", "pan de molde", "tortilla", "masa"]],
  [
    "Condimentos y especias",
    [
      "sal", "pimienta", "comino", "orégano", "oregano", "merkén", "merken", "paprika", "ají de color",
      "aji de color", "laurel", "canela", "nuez moscada", "caldo", "vinagre", "mostaza", "mayonesa",
      "ketchup", "salsa", "chancho en piedra", "vainilla", "azúcar flor",
    ],
  ],
  ["Bebidas", ["jugo", "bebida", "agua mineral", "vino", "cerveza", "té ", "café"]],
  ["Aseo y hogar", ["detergente", "lavaloza", "papel higiénico", "toalla", "cloro", "esponja", "bolsas", "jabón"]],
  [
    "Despensa",
    [
      "arroz", "fideo", "tallarín", "tallarin", "spaghetti", "harina", "azúcar", "azucar", "aceite",
      "poroto", "lenteja", "garbanzo", "avena", "chuño", "maicena", "polvos de hornear", "levadura",
      "chancaca", "mermelada", "galleta", "cereal", "aceituna", "pasas", "nuez", "almendra",
      "salsa de tomate", "pasta de tomate", "conserva", "mote", "sémola", "semola", "quinoa",
    ],
  ],
];

function sinTildes(t: string) {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function adivinarCategoria(nombre: string): CategoriaCompra {
  const n = ` ${sinTildes(nombre)} `;
  // Primero las coincidencias más largas (evita que "porotos verdes" caiga en Despensa).
  let mejor: { cat: CategoriaCompra; largo: number } | null = null;
  for (const [cat, palabras] of DICCIONARIO) {
    for (const p of palabras) {
      const q = sinTildes(p);
      const exp = new RegExp(`(^|[^a-z])${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
      if (exp.test(n) && (!mejor || q.length > mejor.largo)) mejor = { cat, largo: q.length };
    }
  }
  return mejor?.cat ?? "Otros";
}

// ---------- Unidades ----------

type Base = { unidad: Unidad; factor: number };

/** Unidad base para sumar: g y kg se suman en g; ml y l en ml; taza = 250 ml. */
function base(u: Unidad): Base {
  switch (u) {
    case "kg":
      return { unidad: "g", factor: 1000 };
    case "l":
      return { unidad: "ml", factor: 1000 };
    case "taza":
      return { unidad: "ml", factor: 250 };
    default:
      return { unidad: u, factor: 1 };
  }
}

/** Pasa de vuelta a la unidad más cómoda de leer. */
export function legible(cantidad: number | null, unidad: Unidad): { cantidad: number | null; unidad: Unidad } {
  if (cantidad == null) return { cantidad, unidad };
  if (unidad === "g" && cantidad >= 1000) return { cantidad: cantidad / 1000, unidad: "kg" };
  if (unidad === "ml" && cantidad >= 1000) return { cantidad: cantidad / 1000, unidad: "l" };
  return { cantidad, unidad };
}

/** Redondeo amable para la lista de compras. */
function redondear(c: number, u: Unidad): number {
  if (u === "g" || u === "ml") return c >= 100 ? Math.ceil(c / 50) * 50 : Math.ceil(c / 10) * 10;
  if (u === "kg" || u === "l") return Math.ceil(c * 4) / 4; // de a cuarto
  if (["unidad", "diente", "atado", "lata", "paquete"].includes(u)) return Math.ceil(c - 1e-9);
  return Math.round(c * 4) / 4;
}

const fmtNum = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 2 });

const SINGULAR: Partial<Record<Unidad, [string, string]>> = {
  unidad: ["", ""],
  taza: ["taza", "tazas"],
  cda: ["cda.", "cdas."],
  cdta: ["cdta.", "cdtas."],
  diente: ["diente", "dientes"],
  atado: ["atado", "atados"],
  lata: ["lata", "latas"],
  paquete: ["paquete", "paquetes"],
  pizca: ["pizca", "pizcas"],
  l: ["litro", "litros"],
};

export function textoCantidad(cantidad: number | null, unidad: Unidad): string {
  if (unidad === "al gusto" || cantidad == null) return "al gusto";
  const formas = SINGULAR[unidad];
  const num = fmtNum.format(cantidad);
  if (formas) {
    const palabra = cantidad <= 1 ? formas[0] : formas[1];
    return palabra ? `${num} ${palabra}` : num;
  }
  return `${num} ${unidad}`;
}

// ---------- Escalar recetas ----------

export function escalar(cantidad: number | null, receta: Receta, porciones: number): number | null {
  if (cantidad == null) return null;
  return (cantidad * porciones) / (receta.porciones || 1);
}

// ---------- Generar lista desde el menú ----------

export interface LineaGenerada {
  clave: string;
  nombre: string;
  cantidad: number | null;
  unidad: Unidad;
  categoria: CategoriaCompra;
  recetas: string[];
}

export function claveComida(fecha: string, tipo: string) {
  return `${fecha}|${tipo}`;
}

export function comidasDeSemana(plan: PlanComidas, lunes: string): ComidaPlanificada[] {
  const dias = new Set(diasDeSemana(lunes));
  return Object.entries(plan)
    .filter(([k]) => dias.has(k.split("|")[0]))
    .map(([, v]) => v);
}

export function generarLista(plan: PlanComidas, recetas: Receta[], lunes: string): LineaGenerada[] {
  const porId = new Map(recetas.map((r) => [r.id, r]));
  const acumulado = new Map<string, LineaGenerada>();

  for (const comida of comidasDeSemana(plan, lunes)) {
    const receta = comida.recetaId ? porId.get(comida.recetaId) : undefined;
    if (!receta) continue;
    for (const ing of receta.ingredientes) {
      const b = base(ing.unidad);
      const clave = `${sinTildes(ing.nombre)}|${b.unidad}`;
      const cant = escalar(ing.cantidad, receta, comida.porciones);
      const previo = acumulado.get(clave);
      if (previo) {
        if (cant != null) previo.cantidad = (previo.cantidad ?? 0) + cant * b.factor;
        if (!previo.recetas.includes(receta.nombre)) previo.recetas.push(receta.nombre);
      } else {
        acumulado.set(clave, {
          clave,
          nombre: ing.nombre.trim(),
          cantidad: cant == null ? null : cant * b.factor,
          unidad: b.unidad,
          categoria: ing.categoria,
          recetas: [receta.nombre],
        });
      }
    }
  }

  return [...acumulado.values()]
    .map((l) => {
      const r = legible(l.cantidad, l.unidad);
      return {
        ...l,
        cantidad: r.cantidad == null ? null : redondear(r.cantidad, r.unidad),
        unidad: r.unidad,
      };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

export function agruparPorCategoria<T extends { categoria: CategoriaCompra }>(items: T[]) {
  return CATEGORIAS.map((c) => ({ ...c, items: items.filter((i) => i.categoria === c.nombre) })).filter(
    (g) => g.items.length > 0,
  );
}

export function lineaAItem(l: LineaGenerada, lunes: string, id: string): ItemCompra {
  return {
    id,
    nombre: l.nombre,
    cantidad: l.cantidad,
    unidad: l.unidad,
    categoria: l.categoria,
    comprado: false,
    origen: "menu",
    semana: lunes,
    detalle: l.recetas.join(", "),
  };
}
