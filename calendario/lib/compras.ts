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

/**
 * Palabras clave → categoría, con nombres chilenos.
 * Cada palabra calza también en plural ("papa" → "papas", "limón" → "limones").
 * Con "*" al final calza como raíz ("congelad*" → congelado, congeladas…).
 */
const DICCIONARIO: [CategoriaCompra, string[]][] = [
  ["Congelados", ["congelad*", "helado", "arvejas congeladas", "humita", "hielo"]],
  [
    "Lácteos y huevos",
    [
      "leche", "queso", "quesillo", "mantequilla", "crema", "yogur", "yogurt", "yoghurt", "manjar", "huevo",
      "margarina", "mozzarella", "ricotta", "leche condensada", "leche evaporada",
    ],
  ],
  [
    "Carnes y pescados",
    [
      "carne", "pollo", "posta", "osobuco", "plateada", "lomo", "pulpa", "cerdo", "chuleta",
      "longaniza", "chorizo", "tocino", "jamón", "salchicha", "vienesa", "pescado", "merluza",
      "reineta", "salmón", "jurel", "atún", "camarón", "pino", "molida", "costilla", "costillar",
      "trutro", "pechuga", "vacuno", "congrio", "corvina", "chorito", "macha", "almeja", "ostión",
      "jaiba", "loco", "pulpo", "calamar", "marisco", "pavo", "asiento", "tapapecho",
      "sobrecostilla", "huachalomo", "malaya", "pernil", "prieta", "panceta", "salame",
      "hamburguesa", "filete", "abastero", "punta de ganso", "lomo vetado", "sardina", "entraña",
      "palanca", "punta de picana",
    ],
  ],
  [
    "Verduras y frutas",
    [
      "cebolla", "ajo", "tomate", "lechuga", "papa", "zapallo", "zapallito", "choclo",
      "zanahoria", "pimentón", "ají", "cilantro", "perejil", "albahaca", "apio", "porotos verdes",
      "poroto verde", "acelga", "espinaca", "betarraga", "palta", "limón", "plátano", "manzana",
      "naranja", "frutilla", "pepino", "repollo", "brócoli", "coliflor", "champiñón", "camote",
      "porotos granados", "arveja", "pera", "durazno", "uva", "kiwi", "mandarina", "cebollín",
      "puerro", "berenjena", "haba", "rábano", "melón", "sandía", "piña", "cereza", "ciruela",
      "damasco", "zucchini", "espárrago", "jengibre", "romero", "menta", "chirimoya", "lúcuma",
      "membrillo", "alcachofa", "frambuesa", "arándano", "mora", "papaya", "ciboulette",
      "tomillo", "hongo", "rabanito", "pimiento",
    ],
  ],
  ["Panadería", ["pan", "marraqueta", "hallulla", "pan de molde", "pan amasado", "tortilla", "masa", "dobladita"]],
  [
    "Condimentos y especias",
    [
      "sal", "pimienta", "comino", "orégano", "merkén", "paprika", "ají de color", "laurel",
      "canela", "nuez moscada", "caldo", "vinagre", "mostaza", "mayonesa", "ketchup", "salsa",
      "chancho en piedra", "pebre", "vainilla", "esencia de vainilla", "azúcar flor", "aliño",
      "curry", "ajo en polvo", "ajo granulado", "clavo de olor",
    ],
  ],
  ["Bebidas", ["jugo", "bebida", "agua", "agua mineral", "vino", "cerveza", "té", "café", "néctar", "pisco", "nescafé", "milo"]],
  [
    "Aseo y hogar",
    [
      "detergente", "lavaloza", "papel higiénico", "toalla", "toalla de papel", "cloro", "esponja",
      "bolsa", "bolsa de basura", "jabón", "suavizante", "servilleta", "lavalozas", "papel aluminio",
      "papel de aluminio", "pañal", "shampoo", "champú",
    ],
  ],
  [
    "Despensa",
    [
      "arroz", "fideo", "tallarín", "spaghetti", "espagueti", "harina", "azúcar", "aceite", "poroto",
      "lenteja", "garbanzo", "avena", "chuño", "maicena", "polvos de hornear", "polvo de hornear",
      "levadura", "chancaca", "mermelada", "galleta", "cereal", "aceituna", "pasas", "nuez", "nueces",
      "almendra", "salsa de tomate", "pasta de tomate", "conserva", "mote", "sémola", "quinoa",
      "miel", "chocolate", "maíz", "maní", "mantequilla de maní", "pan rallado", "coco rallado", "coco",
      "cacao", "granola", "endulzante", "huesillo", "cochayuyo", "pepinillo", "uva pasa", "uvas pasas",
      "palmito", "paté", "cóctel de frutas", "coctel de frutas",
    ],
  ],
];

/** Minúsculas, sin tildes y sin espacios de sobra. */
export function sinTildes(t: string) {
  return t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const escapar = (q: string) => q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const PATRONES: { cat: CategoriaCompra; largo: number; exp: RegExp; congelado: boolean }[] = DICCIONARIO.flatMap(
  ([cat, palabras]) =>
    palabras.map((p) => {
      const raiz = p.endsWith("*");
      const q = sinTildes(raiz ? p.slice(0, -1) : p);
      const fin = raiz ? "" : "(?:s|es)?(?=[^a-z]|$)";
      // En las frases, la primera palabra también puede ir en plural: "clavos de olor", "ajíes de color".
      const cuerpo = q.split(" ").map(escapar).join(" ").replace(/^(\S+) /, "$1(?:s|es)? ");
      return { cat, largo: q.length, exp: new RegExp(`(^|[^a-z])${cuerpo}${fin}`), congelado: q === "congelad" };
    }),
);

/** Envases al comienzo del nombre: "bolsa de pan" es pan, "lata de atún" es atún. */
const ENVASE = /^(bolsas?|bolsitas?|paquetes?|cajas?|cajitas?|mallas?|tarros?|frascos?|sobres?|latas?|botellas?|potes?|bandejas?) de (.+)$/;
/** "Duraznos en conserva / en almíbar" son de la despensa. "En lata" o "en tarro" no cambian nada, igual que "lata de…". */
const EN_CONSERVA = / en (conserva|almibar)( |$)/;

/**
 * Adivina la categoría por el nombre. En español el producto va primero ("yogur de frutilla",
 * "caldo de pollo"), así que gana la palabra que aparece antes; si empatan, la más larga
 * ("porotos verdes" le gana a "poroto"). "Congelado" en cualquier parte manda a Congelados y
 * "en conserva" a Despensa. Un envase al comienzo ("bolsa de…") no cuenta como producto.
 */
export function adivinarCategoria(nombre: string): CategoriaCompra {
  const limpio = sinTildes(nombre);
  if (EN_CONSERVA.test(limpio) && !/congelad/.test(limpio) && categoriaPorPalabras(limpio) !== "Bebidas") return "Despensa";
  const envase = limpio.match(ENVASE);
  if (envase) {
    const cat = categoriaPorPalabras(envase[2]);
    if (cat !== "Otros") return cat;
  }
  return categoriaPorPalabras(limpio);
}

function categoriaPorPalabras(limpio: string): CategoriaCompra {
  const n = ` ${limpio} `;
  let mejor: { cat: CategoriaCompra; largo: number; pos: number } | null = null;
  for (const p of PATRONES) {
    const m = p.exp.exec(n);
    if (!m) continue;
    if (p.congelado) return "Congelados";
    const pos = m.index + m[1].length;
    if (!mejor || pos < mejor.pos || (pos === mejor.pos && p.largo > mejor.largo)) mejor = { cat: p.cat, largo: p.largo, pos };
  }
  return mejor?.cat ?? "Otros";
}

/** Clave para sumar ingredientes: sin tildes, espacios simples y en singular ("Huevos" = "huevo"). */
export function claveIngrediente(nombre: string): string {
  return sinTildes(nombre).split(" ").map(singular).join(" ");
}

function singular(w: string): string {
  if (w.length <= 3) return w; // sal, ajo, pan, té
  let s = w.endsWith("s") ? w.slice(0, -1) : w; // tomates → tomate
  if (s.length > 3 && /[lnrdjy]e$/.test(s)) s = s.slice(0, -1); // limone → limon, pane → pan
  if (/ie$/.test(s)) s = s.slice(0, -1); // ajíes → aji
  return s.replace(/z$/, "ce"); // nuez = nueces, arroz = arroces
}

// ---------- Unidades ----------

/**
 * Equivalencias de tazas y cucharadas para poder sumarlas con g o ml.
 * Se busca por el comienzo del nombre (el producto va primero).
 */
const EQUIVALENCIAS: [string, "ml" | "g", number][] = (
  [
  // líquidos: 1 taza = 250 ml
  ["leche", "ml", 250],
  ["agua", "ml", 250],
  ["aceite", "ml", 250],
  ["caldo", "ml", 250],
  ["crema", "ml", 250],
  ["jugo", "ml", 250],
  ["vino", "ml", 250],
  ["vinagre", "ml", 250],
  ["salsa de soya", "ml", 250],
  // sólidos: gramos por taza
  ["arroz", "g", 200],
  ["harina", "g", 140],
  ["azucar flor", "g", 120],
  ["azucar granulada", "g", 200],
  ["azucar", "g", 200],
  ["avena", "g", 90],
  ["maicena", "g", 130],
  ["pan rallado", "g", 110],
  ["queso rallado", "g", 100],
  ["coco rallado", "g", 80],
  ["choclo", "g", 160],
  ["arveja", "g", 150],
  ["poroto", "g", 180],
  ["lenteja", "g", 190],
  ["garbanzo", "g", 180],
  ["quinoa", "g", 170],
  ["mote", "g", 180],
  ["nueces", "g", 120],
  ["pasas", "g", 150],
  ["leche en polvo", "g", 130],
  ] as [string, "ml" | "g", number][]
)
  .map(([p, u, n]) => [claveIngrediente(p), u, n] as [string, "ml" | "g", number])
  .sort((a, b) => b[0].length - a[0].length); // la coincidencia más larga primero

/** Polvos, cubos, condensada, moscada…: no tienen la densidad del ingrediente base. */
const SIN_EQUIVALENCIA = /(^| )(polvo|cubo|condensad|moscad|granulad)/;

const MEDIDA_EN_CDTA: Partial<Record<Unidad, number>> = { taza: 48, cda: 3, cdta: 1 };

type Base = { unidad: Unidad; factor: number };

/** Unidad base para sumar: g y kg en g; ml y l en ml; tazas y cucharadas en g/ml si se sabe, o en cdta. */
function base(u: Unidad, clave = ""): Base {
  if (u === "kg") return { unidad: "g", factor: 1000 };
  if (u === "l") return { unidad: "ml", factor: 1000 };
  const enCdta = MEDIDA_EN_CDTA[u];
  if (enCdta) {
    const eq = EQUIVALENCIAS.find(([p]) => clave === p || clave.startsWith(p + " "));
    // Una coincidencia genérica ("leche") no vale para "leche en polvo" o "nuez moscada"; los
    // "polvos de hornear" de la harina no cambian su densidad.
    let resto = eq ? clave.slice(eq[0].length) : "";
    // "Harina con/sin polvos (de/para hornear)": los polvos no cambian la densidad de la harina.
    if (eq?.[0] === "harina") resto = resto.replace(/ (con|sin) polvo( (de|para) hornear)?(?= |$)/, "");
    const valida = eq && (eq[0] === clave || !SIN_EQUIVALENCIA.test(resto));
    if (eq && valida) return { unidad: eq[1], factor: (eq[2] / 48) * enCdta };
    return { unidad: "cdta", factor: enCdta };
  }
  return { unidad: u, factor: 1 };
}

/** Pasa de la unidad base a la más cómoda de leer. */
export function legible(cantidad: number | null, unidad: Unidad): { cantidad: number | null; unidad: Unidad } {
  if (cantidad == null) return { cantidad, unidad };
  if (unidad === "g" && cantidad >= 1000) return { cantidad: cantidad / 1000, unidad: "kg" };
  if (unidad === "ml" && cantidad >= 1000) return { cantidad: cantidad / 1000, unidad: "l" };
  if (unidad === "cdta" && cantidad >= 48) return { cantidad: cantidad / 48, unidad: "taza" };
  if (unidad === "cdta" && cantidad >= 3) return { cantidad: cantidad / 3, unidad: "cda" };
  return { cantidad, unidad };
}

/**
 * Cantidad para mostrar a partir de la unidad base, redondeada. Gramos y ml se redondean antes de
 * pasar a kg/l (así 990 g da "1 kg" y no "1.000 g"); cucharaditas, después de pasar a cda o taza
 * (así sale "1,5 cdas." y no "1,58 cdas.").
 */
function paraMostrar(cantidad: number | null, unidad: Unidad): { cantidad: number | null; unidad: Unidad } {
  if (cantidad == null) return { cantidad, unidad };
  if (unidad === "cdta") {
    const r = legible(cantidad, unidad);
    return { cantidad: redondear(r.cantidad!, r.unidad), unidad: r.unidad };
  }
  return legible(redondear(cantidad, unidad), unidad);
}

/** Redondeo amable para la lista de compras (siempre hacia arriba: mejor que sobre). */
function redondear(c: number, u: Unidad): number {
  if (c <= 0) return 0;
  if (u === "g" || u === "ml") {
    const paso = c < 100 ? 10 : c < 1000 ? 50 : 100;
    return Math.ceil(c / paso - 1e-9) * paso;
  }
  if (["unidad", "diente", "atado", "lata", "paquete"].includes(u)) return Math.ceil(c - 1e-9);
  return Math.ceil(c * 4 - 1e-9) / 4; // kg, l, tazas, cucharadas, pizcas: de a cuarto
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
  /** Ya está todo comprado (marcado en el carro): parte desmarcada. */
  yaComprado?: boolean;
  /** Cuánto se descontó por estar ya comprado, para mostrarlo. */
  descontado?: string;
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

/** Clave de suma de un ingrediente o de un ítem de la lista: nombre en singular + unidad base. */
function claveSuma(nombre: string, unidad: Unidad): { clave: string; b: Base } {
  const n = claveIngrediente(nombre);
  const b = base(unidad, n);
  return { clave: `${n}|${b.unidad}`, b };
}

/**
 * Junta los ingredientes del menú de la semana, escalados por porciones y sumados.
 * Si se pasa la lista de compras, descuenta lo que ya está comprado de esa semana.
 */
export function generarLista(
  plan: PlanComidas,
  recetas: Receta[],
  lunes: string,
  compras: ItemCompra[] = [],
): LineaGenerada[] {
  const porId = new Map(recetas.map((r) => [r.id, r]));
  const acumulado = new Map<string, LineaGenerada>();

  for (const comida of comidasDeSemana(plan, lunes)) {
    const receta = comida.recetaId ? porId.get(comida.recetaId) : undefined;
    if (!receta) continue;
    for (const ing of receta.ingredientes) {
      if (!ing.nombre.trim()) continue;
      const { clave, b } = claveSuma(ing.nombre, ing.unidad);
      const cant = escalar(ing.cantidad, receta, comida.porciones);
      const previo = acumulado.get(clave);
      if (previo) {
        if (cant != null) previo.cantidad = (previo.cantidad ?? 0) + cant * b.factor;
        if (!previo.recetas.includes(receta.nombre)) previo.recetas.push(receta.nombre);
      } else {
        acumulado.set(clave, {
          clave,
          nombre: ing.nombre.trim().replace(/\s+/g, " "),
          cantidad: cant == null ? null : cant * b.factor,
          unidad: b.unidad,
          categoria: ing.categoria,
          recetas: [receta.nombre],
        });
      }
    }
  }

  // Lo que ya se compró de esta semana (en unidad base).
  const comprado = new Map<string, number | null>();
  for (const c of compras) {
    if (c.origen !== "menu" || c.semana !== lunes || !c.comprado) continue;
    const { clave, b } = claveSuma(c.nombre, c.unidad);
    const previo = comprado.get(clave);
    const cant = c.cantidad == null ? null : c.cantidad * b.factor;
    comprado.set(clave, cant == null ? (previo ?? null) : (previo ?? 0) + cant);
  }

  return [...acumulado.values()]
    .map((l) => {
      let cantidad = l.cantidad;
      let yaComprado = false;
      let descontado: string | undefined;
      if (comprado.has(l.clave)) {
        const ya = comprado.get(l.clave);
        if (cantidad == null || ya == null) yaComprado = true;
        else {
          const r = paraMostrar(ya, l.unidad);
          descontado = textoCantidad(r.cantidad, r.unidad);
          cantidad = cantidad - ya;
          if (cantidad <= 1e-9) {
            cantidad = 0;
            yaComprado = true;
          }
        }
      }
      const r = paraMostrar(cantidad, l.unidad);
      return { ...l, cantidad: r.cantidad, unidad: r.unidad, yaComprado, descontado };
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
