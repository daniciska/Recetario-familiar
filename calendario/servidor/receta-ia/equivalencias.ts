// Tabla de equivalencias chilenas: cómo se dice → cantidad + unidad de la app + si es estimado.
// Se usa (1) para escribir la tabla dentro de la instrucción de sistema y (2) en el servidor, para
// arreglar unidades que Gemini devuelva fuera del enum (p. ej. "tarro", "vaso", "gramos").
//
// Criterio de `estimado`:
//   false → dijo el número y una medida que la app ya tiene (taza, cda, kg…) o un envase que se
//           mantiene como envase (1 lata, 1 paquete): la cantidad es la que dijo.
//   true  → la cantidad sale de convertir una medida vaga o casera (puñado, chorrito, vaso, pocillo,
//           "caja de leche" → 1 l), de "más o menos / como / unos", o de un rango.
// Equivalencias de volumen: 1 taza = 250 ml (lo que usa lib/compras.ts para sumar; la "cup" de EE. UU.
// es 240 ml, ~4 % menos, irrelevante en cocina casera), 1 cda = 15 ml, 1 cdta = 5 ml.

import type { UnidadIA } from "./esquema";

export interface Equivalencia {
  dice: string; // cómo se dice (ejemplos)
  cantidad: number | null;
  unidad: UnidadIA;
  estimado: boolean;
  nota?: string; // lo que va en `nota` del ingrediente o una aclaración para el modelo
  texto?: string; // en vez de "cantidad unidad" en la tabla
  confianza: "alta" | "media" | "baja";
  fuente?: string;
}

export const EQUIVALENCIAS: { grupo: string; filas: Equivalencia[] }[] = [
  {
    grupo: "Medidas de cocina (se quedan como están)",
    filas: [
      { dice: '"una taza", "una taza de té llena"', cantidad: 1, unidad: "taza", estimado: false, confianza: "alta" },
      { dice: '"media taza"', cantidad: 0.5, unidad: "taza", estimado: false, confianza: "alta" },
      { dice: '"un cuarto de taza"', cantidad: 0.25, unidad: "taza", estimado: false, confianza: "alta" },
      { dice: '"tres cuartos de taza"', cantidad: 0.75, unidad: "taza", estimado: false, confianza: "alta" },
      { dice: '"taza y media"', cantidad: 1.5, unidad: "taza", estimado: false, confianza: "alta" },
      { dice: '"una cucharada" (sopera)', cantidad: 1, unidad: "cda", estimado: false, nota: "15 ml", confianza: "alta" },
      { dice: '"una cucharadita", "cucharita", "cuchara de té"', cantidad: 1, unidad: "cdta", estimado: false, nota: "5 ml", confianza: "alta" },
      { dice: '"cucharada colmada", "cucharada bien llena", "taza colmada"', cantidad: 1, unidad: "cda", estimado: true, texto: "el mismo número y medida", confianza: "media" },
      { dice: '"cucharada de postre"', cantidad: 2, unidad: "cdta", estimado: true, nota: "≈ 10 ml", confianza: "media" },
      { dice: '"cuchara de café", "cucharita de café"', cantidad: 0.5, unidad: "cdta", estimado: true, confianza: "media" },
      { dice: '"una pizca", "una pizquita", "dos pizcas"', cantidad: 1, unidad: "pizca", estimado: false, nota: "la pizca ya es una unidad de la app", confianza: "alta" },
    ],
  },
  {
    grupo: "Medidas vagas → medibles (estimado = true)",
    filas: [
      { dice: '"un puñado"', cantidad: 0.5, unidad: "taza", estimado: true, nota: "hierbas: picadas", confianza: "media" },
      { dice: '"un puñadito"', cantidad: 0.25, unidad: "taza", estimado: true, confianza: "media" },
      { dice: '"un chorrito" (aceite, vinagre, limón, vino, pisco, leche)', cantidad: 1, unidad: "cda", estimado: true, confianza: "media" },
      { dice: '"un chorrito" de esencia (vainilla)', cantidad: 1, unidad: "cdta", estimado: true, confianza: "media" },
      { dice: '"el tarro (de leche condensada) lleno de leche", "una medida del tarro"', cantidad: 300, unidad: "ml", estimado: true, nota: "397 g de leche condensada ≈ 300 ml", confianza: "media" },
      { dice: '"un chorro", "un buen chorro"', cantidad: 0.25, unidad: "taza", estimado: true, nota: "≈ 60 ml", confianza: "baja" },
      { dice: '"un poquito" de una especia (comino, orégano, ají de color, merkén)', cantidad: 0.5, unidad: "cdta", estimado: true, confianza: "media" },
      { dice: '"un poquito" de un líquido o de azúcar, harina, queso', cantidad: 1, unidad: "cda", estimado: true, confianza: "baja" },
      { dice: '"un vaso"', cantidad: 1, unidad: "taza", estimado: true, nota: "vaso de bebida 200–250 ml", confianza: "media" },
      { dice: '"un pocillo", "una tacita"', cantidad: 0.5, unidad: "taza", estimado: true, nota: "taza chica de té o café; las fuentes van de 80 a 150 ml. Si es ingrediente principal, agrega una duda", confianza: "baja" },
      { dice: '"un cucharón" (caldo, leche)', cantidad: 0.5, unidad: "taza", estimado: true, nota: "≈ 120 ml", confianza: "baja" },
      { dice: '"una nuez de mantequilla", "un trocito de mantequilla"', cantidad: 1, unidad: "cda", estimado: true, nota: "≈ 15 g", confianza: "media" },
      { dice: '"unas ramitas" (cilantro, perejil)', cantidad: 0.25, unidad: "atado", estimado: true, confianza: "baja" },
      { dice: '"unos 3", "como medio kilo", "más o menos 2 tazas"', cantidad: null, unidad: "unidad", estimado: true, texto: "el número y la medida que dijo", confianza: "alta" },
      { dice: '"dos o tres papas" (rango)', cantidad: 3, unidad: "unidad", estimado: true, nota: "el valor mayor; el rango queda en como_lo_dijo", confianza: "media" },
      { dice: '"un par"', cantidad: 2, unidad: "unidad", estimado: true, confianza: "alta" },
    ],
  },
  {
    grupo: "Sin cantidad (cantidad = null, unidad = \"al gusto\", estimado = false)",
    filas: [
      { dice: '"al gusto", "a gusto", "al ojo", "a ojo", "lo que pida", "lo que admita", "lo necesario", "harto", "bastante"', cantidad: null, unidad: "al gusto", estimado: false, nota: "si es un ingrediente principal, como la harina de una masa o la leche de una salsa, agrega una duda pidiendo una cantidad aproximada", confianza: "alta" },
      { dice: '"aceite para freír"', cantidad: null, unidad: "al gusto", estimado: false, nota: "nota: \"para freír\"", confianza: "alta" },
    ],
  },
  {
    grupo: "Peso y volumen dichos (estimado = false)",
    filas: [
      { dice: '"un kilo"', cantidad: 1, unidad: "kg", estimado: false, confianza: "alta" },
      { dice: '"kilo y medio"', cantidad: 1.5, unidad: "kg", estimado: false, confianza: "alta" },
      { dice: '"medio kilo"', cantidad: 500, unidad: "g", estimado: false, confianza: "alta" },
      { dice: '"un cuarto" (de kilo), "un cuarto de carne molida", "un cuarto de queso"', cantidad: 250, unidad: "g", estimado: false, confianza: "alta" },
      { dice: '"tres cuartos" (de kilo)', cantidad: 750, unidad: "g", estimado: false, confianza: "alta" },
      { dice: '"un litro"', cantidad: 1, unidad: "l", estimado: false, confianza: "alta" },
      { dice: '"medio litro"', cantidad: 500, unidad: "ml", estimado: false, confianza: "alta" },
      { dice: '"un cuarto de litro"', cantidad: 250, unidad: "ml", estimado: false, confianza: "alta" },
      { dice: '"250 cc", "250 centímetros cúbicos"', cantidad: 250, unidad: "ml", estimado: false, confianza: "alta" },
      { dice: '"una docena"', cantidad: 12, unidad: "unidad", estimado: false, confianza: "alta" },
      { dice: '"media docena"', cantidad: 6, unidad: "unidad", estimado: false, confianza: "alta" },
      { dice: 'OJO: "un cuarto de pollo" es una presa, no 250 g', cantidad: 1, unidad: "unidad", estimado: false, nota: "nombre: \"Cuarto de pollo\"", confianza: "alta" },
    ],
  },
  {
    grupo: "Envases (la cantidad es la cuenta de envases; estimado = false; el tamaño va en nota)",
    filas: [
      { dice: '"un tarro de leche condensada"', cantidad: 1, unidad: "lata", estimado: false, nota: "tarro de 397 g", confianza: "alta", fuente: "https://www.jumbo.cl/leche-condensada-nestle-lata-397-g/p" },
      { dice: '"un tarro de jurel"', cantidad: 1, unidad: "lata", estimado: false, nota: "lata de 425 g, 300 g drenado", confianza: "media", fuente: "https://www.jumbo.cl/jurel-san-jose-lata-425-g-al-natural-con-omega-3/p" },
      { dice: '"un tarrito de crema"', cantidad: 1, unidad: "lata", estimado: false, nota: "tarro de 157 g", confianza: "alta", fuente: "https://www.jumbo.cl/crema-de-leche-nestle-lata-157-g-2/p" },
      { dice: '"una lata de atún", "un tarro de duraznos", "un tarro de leche evaporada"', cantidad: 1, unidad: "lata", estimado: false, nota: "sin tamaño: varía", confianza: "alta" },
      { dice: '"un paquete de fideos" (tallarines, espirales)', cantidad: 1, unidad: "paquete", estimado: false, nota: "paquete de 400 g", confianza: "alta", fuente: "https://www.jumbo.cl/spaghetti-n-5-carozzi-bolsa-400-g-2/p" },
      { dice: '"un pan / un paquete de mantequilla"', cantidad: 1, unidad: "paquete", estimado: false, nota: "250 g; también hay de 125 g", confianza: "media", fuente: "https://www.jumbo.cl/mantequilla-con-sal-colun-250-g/p" },
      { dice: '"un sobre" (levadura, gelatina, polvos de hornear), "una bolsa", "una caja", "una cajita"', cantidad: 1, unidad: "paquete", estimado: false, nota: "nota: \"sobre\" / \"cajita\"…", confianza: "alta" },
      { dice: '"una caja de leche"', cantidad: 1, unidad: "l", estimado: true, nota: "las cajas de leche son de 1 litro", confianza: "media" },
      { dice: '"un cubito de caldo"', cantidad: 1, unidad: "unidad", estimado: false, nota: "nombre: \"Caldo en cubo\"", confianza: "alta" },
    ],
  },
  {
    grupo: "Cosas que se cuentan (unidad, diente, atado; estimado = false)",
    filas: [
      { dice: '"una cebolla (grande)", "un huevo", "una papa", "un choclo", "un limón"', cantidad: 1, unidad: "unidad", estimado: false, nota: "tamaño en nota; \"el jugo de un limón\" → 1 Limón, nota \"el jugo\"", confianza: "alta" },
      { dice: '"una marraqueta", "una hallulla"', cantidad: 1, unidad: "unidad", estimado: false, nota: "\"una marraqueta\" puede ser 2 o 4 pancitos: en una encuesta Cadem de 2024, el 60 % dijo que una unidad son 2; si importa, agrega una duda", confianza: "media", fuente: "https://www.13.cl/programas/entretencion/actualidad/cuanto-es-una-marraqueta-encuesta-despeja-la-eterna-duda-de-los" },
      { dice: '"un diente de ajo"', cantidad: 1, unidad: "diente", estimado: false, confianza: "alta" },
      { dice: '"una cabeza de ajo"', cantidad: 1, unidad: "unidad", estimado: false, nota: "nombre: \"Cabeza de ajo\"", confianza: "alta" },
      { dice: '"un atado de cilantro / perejil / acelga / espinaca / cebollín"', cantidad: 1, unidad: "atado", estimado: false, confianza: "alta" },
      { dice: '"un trozo de zapallo", "una presa de pollo", "una hoja de laurel", "una rama de romero"', cantidad: 1, unidad: "unidad", estimado: false, nota: "el envase o la pieza va en el nombre: \"Trozo de zapallo\", \"Hoja de laurel\"", confianza: "alta" },
    ],
  },
];

/** Horno: palabras → °C (se escriben con ≈ en el paso). */
export const HORNO: [string, string][] = [
  ["suave / bajo", "≈ 160 °C"],
  ["moderado / medio", "≈ 180 °C"],
  ["caliente / fuerte", "≈ 200 °C"],
  ["muy caliente / al máximo", "≈ 220 °C"],
];

/** Tabla en texto para la instrucción de sistema. */
export function tablaEnTexto(): string {
  const fmt = (e: Equivalencia) => {
    const cant = e.texto ?? (e.cantidad == null ? `null "${e.unidad}"` : `${e.cantidad} ${e.unidad}`);
    return `- ${e.dice} → ${cant}${e.estimado ? ", estimado" : ""}${e.nota ? ` (${e.nota})` : ""}`;
  };
  const partes = EQUIVALENCIAS.map((g) => `${g.grupo}:\n${g.filas.map(fmt).join("\n")}`);
  partes.push(`Horno (en el paso, con ≈ y lo que dijo): ${HORNO.map(([a, b]) => `${a} ${b}`).join("; ")}.`);
  return partes.join("\n\n");
}

// ---------- Para el servidor: unidades fuera del enum ----------

/** Unidad escrita de otra forma → unidad de la app, factor y si queda estimada. Se busca sin tildes y en minúscula. */
export const SINONIMOS_UNIDAD: [RegExp, UnidadIA, number, boolean][] = [
  [/^(g|gr|grs|gramos?)$/, "g", 1, false],
  [/^(kg|kgs|kilos?|kilogramos?)$/, "kg", 1, false],
  [/^(ml|cc|c\.c\.|mililitros?|centimetros? cubicos?)$/, "ml", 1, false],
  [/^(l|lt|lts|litros?)$/, "l", 1, false],
  [/^(u|un|und|unid|unidades|piezas?|presas?|trozos?|rodajas?|hojas?|ramas?|ramitas?|cabezas?)$/, "unidad", 1, false],
  [/^(tazas?|tz)$/, "taza", 1, false],
  [/^(cdas?\.?|cucharadas?|cucharadas? soperas?)$/, "cda", 1, false],
  [/^(cdtas?\.?|cucharaditas?|cucharitas?)$/, "cdta", 1, false],
  [/^dientes?$/, "diente", 1, false],
  [/^atados?$/, "atado", 1, false],
  [/^(latas?|tarros?|tarritos?|conservas?)$/, "lata", 1, false],
  [/^(paquetes?|bolsas?|bolsitas?|sobres?|cajas?|cajitas?|panes?)$/, "paquete", 1, false],
  [/^(pizcas?|pizquitas?)$/, "pizca", 1, false],
  [/^(a gusto|al gusto|c\/n|cn|cantidad necesaria|al ojo|a ojo|lo que pida|lo necesario)$/, "al gusto", 1, false],
  [/^docenas?$/, "unidad", 12, false],
  [/^(vasos?)$/, "taza", 1, true],
  [/^(pocillos?|tacitas?|cucharon(es)?)$/, "taza", 0.5, true],
  [/^(punados?)$/, "taza", 0.5, true],
  [/^(punaditos?)$/, "taza", 0.25, true],
  [/^(chorritos?)$/, "cda", 1, true],
  [/^(chorros?)$/, "taza", 0.25, true],
];
