// Esquema de salida que se le pide a Gemini para "🎙️ Dictar receta".
//
// Una sola definición genera las dos variantes que acepta la API de Gemini:
//   · ESQUEMA_JSON     → JSON Schema (subconjunto). Va en:
//                         - Interactions API:      response_format: { type: "text", mime_type: "application/json", schema }
//                         - generateContent nuevo:  generationConfig.responseFormat.text: { mimeType: "APPLICATION_JSON", schema }
//                         - generateContent:        generationConfig.responseMimeType = "application/json" + responseJsonSchema
//   · ESQUEMA_OPENAPI  → objeto `Schema` (subconjunto de OpenAPI 3.0): tipos en mayúscula, `nullable`,
//                         `propertyOrdering`. Va en generationConfig.responseSchema (generateContent, forma antigua).
//
// Las listas UNIDADES y CATEGORIAS tienen que ser EXACTAMENTE las de calendario/lib/datos/tipos.ts
// (la prueba lo comprueba leyendo ese archivo).
//
// El orden de las propiedades importa: Gemini escribe el JSON en el orden de las claves del esquema
// ("the model will produce outputs in the same order as the keys in the schema"). Por eso va primero
// la transcripción (el modelo "escucha" antes de ordenar), después si es receta, y en cada ingrediente
// primero `como_lo_dijo` y después la conversión a número + unidad.

export const UNIDADES = [
  "g",
  "kg",
  "ml",
  "l",
  "unidad",
  "taza",
  "cda",
  "cdta",
  "diente",
  "atado",
  "lata",
  "paquete",
  "pizca",
  "al gusto",
] as const;

export const CATEGORIAS = [
  "Verduras y frutas",
  "Carnes y pescados",
  "Lácteos y huevos",
  "Panadería",
  "Despensa",
  "Condimentos y especias",
  "Congelados",
  "Bebidas",
  "Aseo y hogar",
  "Otros",
] as const;

export type UnidadIA = (typeof UNIDADES)[number];
export type CategoriaIA = (typeof CATEGORIAS)[number];

/** Lo que devuelve Gemini (antes de validar). */
export interface IngredienteIA {
  nombre: string;
  como_lo_dijo: string | null;
  cantidad: number | null;
  unidad: UnidadIA;
  estimado: boolean;
  categoria: CategoriaIA;
  nota: string | null;
}

export interface RespuestaIA {
  transcripcion: string;
  es_receta: boolean;
  motivo: string | null;
  nombre: string | null;
  emoji: string | null;
  porciones: number | null;
  porciones_estimadas: boolean;
  tiempo_min: number | null;
  tiempo_estimado: boolean;
  ingredientes: IngredienteIA[];
  pasos: string[];
  secretos: string[];
  nota: string | null;
  dudas: string[];
}

// ---------- Definición única ----------

type Campo =
  | { t: "string" | "number" | "integer" | "boolean"; nulo?: boolean; enum?: readonly string[]; d: string }
  | { t: "array"; d: string; items: Campo }
  | { t: "object"; d?: string; props: [string, Campo][] };

const texto = (d: string, nulo = false): Campo => ({ t: "string", nulo, d });

const INGREDIENTE: Campo = {
  t: "object",
  props: [
    [
      "nombre",
      texto(
        'Nombre chileno corto, primera letra mayúscula, singular si se cuenta ("Cebolla", "Huevo"), sin cantidad ni preparación ("Carne molida", "Choclo desgranado", "Ají de color").',
      ),
    ],
    [
      "como_lo_dijo",
      texto('Palabras exactas con que dijo la cantidad ("un puñadito", "un tarro", "lo que pida", "medio kilo"). null si no dijo cantidad.', true),
    ],
    [
      "cantidad",
      { t: "number", nulo: true, d: 'Número con punto decimal (0.5, 1.5, 0.25). null solo si la unidad es "al gusto".' },
    ],
    ["unidad", { t: "string", enum: UNIDADES, d: "Unidad de la app; ver la tabla de cantidades de la instrucción." }],
    [
      "estimado",
      {
        t: "boolean",
        d: 'true si la cantidad salió de una medida vaga (puñado, chorrito, vaso, pocillo…), de "más o menos/como/unos", de un rango, o si no la dijo y la dedujiste. false si dijo número y medida.',
      },
    ],
    ["categoria", { t: "string", enum: CATEGORIAS, d: "Sección del supermercado para la lista de compras." }],
    ["nota", texto('Preparación ("picada en cubitos"), tamaño del envase ("tarro de 397 g"), "opcional", "para freír". null si nada.', true)],
  ],
};

const RAIZ: Campo = {
  t: "object",
  props: [
    [
      "transcripcion",
      texto(
        'Transcripción fiel de todo lo que se dice sobre la receta, en orden, con puntuación. Sin muletillas excesivas pero sin cambiar palabras ni sentido. "[Parte N]" al comienzo de cada audio si hay varios; "[inaudible]" donde no se entiende.',
      ),
    ],
    ["es_receta", { t: "boolean", d: "true si se explica cómo preparar algo de comer o beber, aunque esté incompleto." }],
    ["motivo", texto("Si es_receta es false: por qué, en una frase. Si es true: null.", true)],
    ["nombre", texto('Nombre del plato como lo dice la familia ("Pastel de choclo"). null si no es receta.', true)],
    ["emoji", texto("Un solo emoji de comida que represente el plato. null si no es receta.", true)],
    [
      "porciones",
      { t: "integer", nulo: true, d: "Personas o unidades que rinde (empanadas, sopaipillas). Si no se dice, estímalo. null si no es receta." },
    ],
    ["porciones_estimadas", { t: "boolean", d: "true si las porciones no se dijeron y las estimaste." }],
    [
      "tiempo_min",
      { t: "integer", nulo: true, d: "Minutos totales de preparación y cocción (sin remojos ni reposos de horas). null si no es receta." },
    ],
    ["tiempo_estimado", { t: "boolean", d: "true si el tiempo total no se dijo y lo calculaste o estimaste." }],
    ["ingredientes", { t: "array", d: "Todos los ingredientes que se usan, en el orden en que se usan.", items: INGREDIENTE }],
    [
      "pasos",
      {
        t: "array",
        d: "Pasos en orden, en imperativo (tú), cortos, con tiempos, temperaturas y señales que se dijeron. Sin numerar.",
        items: { t: "string", d: "Un paso." },
      },
    ],
    ["secretos", { t: "array", d: "Trucos y advertencias que da quien cocina, breves.", items: { t: "string", d: "Un secreto." } }],
    ["nota", texto("Contexto que contó: de quién es la receta, cuándo se hace, con qué se sirve. null si nada.", true)],
    [
      "dudas",
      {
        t: "array",
        d: "Preguntas concretas para la familia sobre lo que faltó o no quedó claro, de la más importante a la menos.",
        items: { t: "string", d: "Una pregunta." },
      },
    ],
  ],
};

// ---------- JSON Schema ----------

type Obj = Record<string, unknown>;

function aJson(c: Campo): Obj {
  if (c.t === "object") {
    return {
      type: "object",
      ...(c.d ? { description: c.d } : {}),
      properties: Object.fromEntries(c.props.map(([k, v]) => [k, aJson(v)])),
      required: c.props.map(([k]) => k), // todas obligatorias (con null cuando no hay valor): menos ramas
      additionalProperties: false,
    };
  }
  if (c.t === "array") return { type: "array", description: c.d, items: aJson(c.items) };
  const s: Obj = { type: c.nulo ? [c.t, "null"] : c.t, description: c.d };
  if (c.enum) s.enum = [...c.enum];
  return s;
}

// ---------- OpenAPI (responseSchema) ----------

function aOpenApi(c: Campo): Obj {
  if (c.t === "object") {
    return {
      type: "OBJECT",
      ...(c.d ? { description: c.d } : {}),
      properties: Object.fromEntries(c.props.map(([k, v]) => [k, aOpenApi(v)])),
      required: c.props.map(([k]) => k),
      propertyOrdering: c.props.map(([k]) => k),
    };
  }
  if (c.t === "array") return { type: "ARRAY", description: c.d, items: aOpenApi(c.items) };
  const s: Obj = { type: c.t.toUpperCase(), description: c.d };
  if (c.nulo) s.nullable = true;
  if (c.enum) {
    s.format = "enum";
    s.enum = [...c.enum];
  }
  return s;
}

export const ESQUEMA_JSON = aJson(RAIZ);
export const ESQUEMA_OPENAPI = aOpenApi(RAIZ);
/** Orden de las claves de primer nivel (para comprobar respuestas y para la doc). */
export const CLAVES = (RAIZ as Extract<Campo, { t: "object" }>).props.map(([k]) => k);
export const CLAVES_INGREDIENTE = (INGREDIENTE as Extract<Campo, { t: "object" }>).props.map(([k]) => k);
