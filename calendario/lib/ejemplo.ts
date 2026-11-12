import type { EstadoApp, Ingrediente, Receta, Unidad, CategoriaCompra, TipoComida } from "./datos/tipos";
import { adivinarCategoria } from "./compras";
import { armarComida, claveComida } from "./comidas";
import { hoy, lunesDe, sumarDias } from "./fechas";
import { COLORES_MIEMBRO } from "./colores";

let n = 0;
export function nuevoId(prefijo = "id"): string {
  n++;
  const azar =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefijo}_${Date.now().toString(36)}${n}${azar}`;
}

function ing(cantidad: number | null, unidad: Unidad, nombre: string, categoria?: CategoriaCompra): Ingrediente {
  return { id: nuevoId("ing"), cantidad, unidad, nombre, categoria: categoria ?? adivinarCategoria(nombre) };
}

export { COLORES_MIEMBRO };

export const EMOJIS_MIEMBRO = ["👩", "👨", "👧", "👦", "👵", "👴", "🧒", "👶", "🐶", "🐱", "⭐", "🌻", "⚽", "🎸", "📚", "🦄"];

function recetasEjemplo(): Receta[] {
  return [
    {
      id: "rec_pastel_choclo",
      nombre: "Pastel de choclo",
      emoji: "🌽",
      porciones: 6,
      tiempoMin: 90,
      ingredientes: [
        ing(1.5, "kg", "Choclo desgranado"),
        ing(500, "g", "Carne molida"),
        ing(3, "unidad", "Cebolla"),
        ing(1, "kg", "Trutro de pollo"),
        ing(3, "unidad", "Huevo"),
        ing(100, "g", "Aceitunas negras"),
        ing(80, "g", "Pasas"),
        ing(1, "atado", "Albahaca"),
        ing(250, "ml", "Leche"),
        ing(2, "cda", "Azúcar"),
        ing(1, "cdta", "Comino"),
        ing(null, "al gusto", "Sal"),
      ],
      pasos: [
        "Muele el choclo con la albahaca y un poco de leche. Cocínalo a fuego bajo, revolviendo, hasta que espese (unos 20 min). Sazona con sal.",
        "Para el pino: sofríe la cebolla picada en cubitos, agrega la carne molida, comino, sal y cocina hasta que esté jugoso.",
        "Cuece el pollo y desmenúzalo. Cuece los huevos duros.",
        "En una fuente de greda pon el pino, el pollo, huevo en rodajas, aceitunas y pasas.",
        "Cubre con la pastelera de choclo, espolvorea azúcar y hornea a 200 °C hasta dorar (30–40 min).",
      ],
    },
    {
      id: "rec_cazuela",
      nombre: "Cazuela de vacuno",
      emoji: "🍲",
      porciones: 4,
      tiempoMin: 120,
      ingredientes: [
        ing(1, "kg", "Osobuco"),
        ing(4, "unidad", "Papa"),
        ing(4, "unidad", "Trozo de zapallo", "Verduras y frutas"),
        ing(2, "unidad", "Choclo"),
        ing(150, "g", "Porotos verdes"),
        ing(1, "unidad", "Zanahoria"),
        ing(1, "unidad", "Cebolla"),
        ing(100, "g", "Arroz"),
        ing(1, "atado", "Cilantro"),
        ing(1, "cdta", "Orégano"),
        ing(null, "al gusto", "Sal"),
      ],
      pasos: [
        "Cuece la carne en agua con cebolla, zanahoria y orégano por 1 hora y media, sacando la espuma.",
        "Agrega las papas y el zapallo; a los 10 minutos el choclo en rodajas y el arroz.",
        "Al final suma los porotos verdes y cocina 5 minutos más.",
        "Sirve un trozo de cada cosa por plato y termina con cilantro picado.",
      ],
    },
    {
      id: "rec_charquican",
      nombre: "Charquicán",
      emoji: "🥘",
      porciones: 4,
      tiempoMin: 45,
      ingredientes: [
        ing(400, "g", "Carne molida"),
        ing(6, "unidad", "Papa"),
        ing(500, "g", "Zapallo camote"),
        ing(1, "unidad", "Cebolla"),
        ing(1, "unidad", "Zanahoria"),
        ing(200, "g", "Choclo desgranado"),
        ing(150, "g", "Arvejas congeladas", "Congelados"),
        ing(2, "diente", "Ajo"),
        ing(4, "unidad", "Huevo"),
        ing(1, "cdta", "Ají de color"),
        ing(null, "al gusto", "Sal"),
      ],
      pasos: [
        "Sofríe la cebolla, el ajo y la zanahoria rallada. Agrega la carne y el ají de color.",
        "Suma las papas y el zapallo en cubos con un poco de agua; cocina tapado hasta que estén blandos.",
        "Agrega choclo y arvejas, y muele a medias con un tenedor.",
        "Sirve con un huevo frito encima.",
      ],
    },
    {
      id: "rec_porotos_riendas",
      nombre: "Porotos con riendas",
      emoji: "🫘",
      porciones: 6,
      tiempoMin: 100,
      ingredientes: [
        ing(500, "g", "Porotos tórtola", "Despensa"),
        ing(200, "g", "Tallarines"),
        ing(300, "g", "Zapallo camote"),
        ing(1, "unidad", "Cebolla"),
        ing(1, "unidad", "Pimentón rojo"),
        ing(150, "g", "Longaniza"),
        ing(1, "cdta", "Ají de color"),
        ing(1, "cdta", "Comino"),
        ing(null, "al gusto", "Sal"),
      ],
      pasos: [
        "Deja remojando los porotos la noche anterior.",
        "Cuécelos en agua nueva con el zapallo en trozos por 1 hora.",
        "Haz una fritanga con cebolla, pimentón, ají de color, comino y la longaniza; agrégala a la olla.",
        "Suma los tallarines quebrados y cocina hasta que estén listos. Debe quedar espesito.",
      ],
    },
    {
      id: "rec_tostadas_palta",
      nombre: "Tostadas con palta y huevo",
      emoji: "🥑",
      porciones: 4,
      tiempoMin: 15,
      ingredientes: [
        ing(4, "unidad", "Marraqueta"),
        ing(2, "unidad", "Palta"),
        ing(4, "unidad", "Huevo"),
        ing(1, "unidad", "Tomate"),
        ing(null, "al gusto", "Sal"),
      ],
      pasos: [
        "Tuesta las marraquetas partidas.",
        "Muele la palta con sal y unas gotas de limón si tienes.",
        "Haz los huevos revueltos o a la copa.",
        "Arma: pan, palta, tomate en rodajas y huevo.",
      ],
    },
    {
      id: "rec_sopaipillas",
      nombre: "Sopaipillas",
      emoji: "🟠",
      porciones: 6,
      tiempoMin: 50,
      ingredientes: [
        ing(500, "g", "Harina"),
        ing(250, "g", "Zapallo camote"),
        ing(60, "g", "Mantequilla"),
        ing(1, "cdta", "Polvos de hornear"),
        ing(1, "l", "Aceite"),
        ing(null, "al gusto", "Sal"),
      ],
      pasos: [
        "Cuece el zapallo y muélelo en puré.",
        "Mezcla harina, polvos de hornear y sal; agrega el zapallo y la mantequilla derretida.",
        "Amasa, estira a 0,5 cm, corta círculos y pínchalos con un tenedor.",
        "Fríe en aceite caliente hasta dorar. Para la once, con pebre o pasadas en chancaca.",
      ],
    },
  ];
}

/** Los integrantes inventados de `estadoEjemplo` (id → nombre). */
export const MIEMBROS_EJEMPLO: Readonly<Record<string, string>> = { mie_mama: "Carolina", mie_papa: "Felipe", mie_sofi: "Sofía", mie_tomi: "Tomás" };

/** Los ids de los eventos inventados de `estadoEjemplo` (una prueba revisa que sean los mismos). */
export const EVENTOS_EJEMPLO: readonly string[] = [
  "ev_colegio",
  "ev_colegio_ma",
  "ev_colegio_mi",
  "ev_colegio_ju",
  "ev_colegio_vi",
  "ev_futbol",
  "ev_ballet",
  "ev_pilates",
  "ev_reunion",
  "ev_dentista",
  "ev_feria",
  "ev_cumple",
  "ev_vacaciones",
  "ev_basura",
  "ev_almuerzo_abuela",
  "ev_arriendo",
];

/**
 * ¿Lo que se ve sigue siendo la familia de ejemplo? Hacen falta las dos señales: la mayoría de sus
 * integrantes con su id y su nombre de fábrica (3 de 4) y al menos la mitad de sus eventos (por id).
 * Un nombre solo no basta: una familia de verdad puede tener una Sofía o un Tomás, y la que usa el
 * panel sin nube cambia los integrantes y borra los eventos inventados.
 */
export function esFamiliaDeEjemplo(estado: Pick<EstadoApp, "miembros" | "eventos">): boolean {
  // (lo heredado de Object, como "toString", nunca es un texto igual al nombre)
  const integrantes = new Set(estado.miembros.filter((m) => MIEMBROS_EJEMPLO[m.id] === m.nombre).map((m) => m.id));
  if (integrantes.size * 2 <= Object.keys(MIEMBROS_EJEMPLO).length) return false;
  const eventos = new Set(estado.eventos.map((e) => e.id));
  return EVENTOS_EJEMPLO.filter((id) => eventos.has(id)).length * 2 >= EVENTOS_EJEMPLO.length;
}

export function estadoEjemplo(): EstadoApp {
  const lunes = lunesDe(hoy());
  const d = (i: number) => sumarDias(lunes, i);
  const m = { mama: "mie_mama", papa: "mie_papa", sofi: "mie_sofi", tomi: "mie_tomi" };

  const plan: EstadoApp["plan"] = {};
  const ahoraIso = new Date().toISOString();
  // Cada ítem es un id de receta ("rec_…"), un texto o null (espacio vacío), en el orden de
  // ESPACIOS_COMIDA (almuerzo: proteína, carbohidrato, verduras, postre).
  const poner = (dia: number, tipo: TipoComida, items: (string | null)[], porciones = 4) => {
    const c = armarComida(
      items.map((x) => (x === null ? null : x.startsWith("rec_") ? { recetaId: x } : { texto: x })),
      porciones,
    );
    if (c) plan[claveComida(d(dia), tipo)] = c;
  };
  poner(0, "desayuno", ["Pan con palta", "Plátano", "Leche", "Té"]);
  poner(0, "colacion", ["Manzana", "Mandarina", "Galletas"], 2);
  // El charquicán ya trae la carne, la papa y las verduras.
  poner(0, "almuerzo", ["rec_charquican", null, "Ensalada de tomate", "Fruta"]);
  poner(1, "almuerzo", ["rec_cazuela"]);
  poner(1, "cena", ["Huevos revueltos", "Pan", "Ensalada"]);
  poner(2, "colacion", ["Plátano", "Uvas", "Sándwich de quesillo"], 2);
  poner(2, "cena", ["rec_porotos_riendas", null, "Ensalada chilena"]);
  poner(3, "almuerzo", ["Sobras de porotos"]);
  poner(4, "once", ["rec_sopaipillas"]);
  poner(5, "desayuno", ["rec_tostadas_palta", "Fruta picada", "Yogur", "Café"]);
  poner(5, "almuerzo", ["rec_pastel_choclo", null, "Ensalada chilena", "Jalea"], 6);
  poner(6, "almuerzo", ["Donde la abuela 👵"]);
  poner(6, "once", ["rec_tostadas_palta"]);

  return {
    version: 1,
    ajustes: {
      nombreFamilia: "Familia Rojas",
      ciudad: "Santiago",
      latitud: -33.4489,
      longitud: -70.6693,
      tema: "auto",
      nocheDesde: "20:30",
      nocheHasta: "07:00",
    },
    miembros: [
      { id: m.mama, nombre: "Carolina", color: COLORES_MIEMBRO[0], emoji: "👩" },
      { id: m.papa, nombre: "Felipe", color: COLORES_MIEMBRO[1], emoji: "👨" },
      { id: m.sofi, nombre: "Sofía", color: COLORES_MIEMBRO[3], emoji: "👧" },
      { id: m.tomi, nombre: "Tomás", color: COLORES_MIEMBRO[2], emoji: "👦" },
    ],
    eventos: [
      { id: "ev_colegio", titulo: "Colegio", miembros: [m.sofi, m.tomi], fecha: d(0), todoElDia: false, horaInicio: "08:00", horaFin: "15:30", repeticion: "semanal", repetirHasta: undefined, nota: "Llevar colación" },
      { id: "ev_colegio_ma", titulo: "Colegio", miembros: [m.sofi, m.tomi], fecha: d(1), todoElDia: false, horaInicio: "08:00", horaFin: "15:30", repeticion: "semanal" },
      { id: "ev_colegio_mi", titulo: "Colegio", miembros: [m.sofi, m.tomi], fecha: d(2), todoElDia: false, horaInicio: "08:00", horaFin: "13:00", repeticion: "semanal" },
      { id: "ev_colegio_ju", titulo: "Colegio", miembros: [m.sofi, m.tomi], fecha: d(3), todoElDia: false, horaInicio: "08:00", horaFin: "15:30", repeticion: "semanal" },
      { id: "ev_colegio_vi", titulo: "Colegio", miembros: [m.sofi, m.tomi], fecha: d(4), todoElDia: false, horaInicio: "08:00", horaFin: "13:00", repeticion: "semanal" },
      { id: "ev_futbol", titulo: "Fútbol", miembros: [m.tomi], fecha: d(1), todoElDia: false, horaInicio: "17:00", horaFin: "18:30", repeticion: "semanal", nota: "Canilleras y botella de agua" },
      { id: "ev_ballet", titulo: "Ballet", miembros: [m.sofi], fecha: d(3), todoElDia: false, horaInicio: "16:30", horaFin: "17:30", repeticion: "semanal" },
      { id: "ev_pilates", titulo: "Pilates", miembros: [m.mama], fecha: d(0), todoElDia: false, horaInicio: "19:00", horaFin: "20:00", repeticion: "semanal" },
      { id: "ev_reunion", titulo: "Reunión clienta", miembros: [m.mama], fecha: d(2), todoElDia: false, horaInicio: "10:00", horaFin: "11:00", repeticion: "nunca" },
      { id: "ev_dentista", titulo: "Dentista", miembros: [m.tomi, m.papa], fecha: d(2), todoElDia: false, horaInicio: "16:00", horaFin: "16:45", repeticion: "nunca", nota: "Clínica dental, 3er piso" },
      { id: "ev_feria", titulo: "Feria", miembros: [m.papa], fecha: d(5), todoElDia: false, horaInicio: "09:30", horaFin: "11:00", repeticion: "semanal" },
      { id: "ev_cumple", titulo: "Cumple de la Tía Ana 🎂", miembros: [m.mama, m.papa, m.sofi, m.tomi], fecha: d(5), todoElDia: true, repeticion: "anual", cuentaRegresiva: true },
      { id: "ev_vacaciones", titulo: "Vacaciones en La Serena 🏖️", miembros: [m.mama, m.papa, m.sofi, m.tomi], fecha: d(26), todoElDia: true, repeticion: "nunca", cuentaRegresiva: true },
      { id: "ev_basura", titulo: "Sacar la basura", miembros: [m.papa], fecha: d(3), todoElDia: false, horaInicio: "21:00", repeticion: "semanal" },
      { id: "ev_almuerzo_abuela", titulo: "Almuerzo donde la abuela", miembros: [m.mama, m.papa, m.sofi, m.tomi], fecha: d(6), todoElDia: false, horaInicio: "13:30", horaFin: "17:00", repeticion: "nunca" },
      { id: "ev_arriendo", titulo: "Pagar cuentas", miembros: [m.papa], fecha: d(4), todoElDia: true, repeticion: "mensual" },
    ],
    recetas: recetasEjemplo(),
    plan,
    compras: [
      { id: nuevoId("com"), nombre: "Papel higiénico", cantidad: 1, unidad: "paquete", categoria: "Aseo y hogar", comprado: false, origen: "manual" },
      { id: nuevoId("com"), nombre: "Yogur", cantidad: 8, unidad: "unidad", categoria: "Lácteos y huevos", comprado: false, origen: "manual" },
      { id: nuevoId("com"), nombre: "Plátanos", cantidad: 1, unidad: "kg", categoria: "Verduras y frutas", comprado: true, origen: "manual" },
    ],
    tareas: [
      { id: nuevoId("tar"), titulo: "Hacer la cama", miembroId: m.sofi, hecha: false, creada: ahoraIso, repetir: "diaria", estrellas: 1, momento: "manana" },
      { id: nuevoId("tar"), titulo: "Hacer la cama", miembroId: m.tomi, hecha: false, creada: ahoraIso, repetir: "diaria", estrellas: 1, momento: "manana" },
      { id: nuevoId("tar"), titulo: "Poner la mesa", miembroId: m.tomi, hecha: false, creada: ahoraIso, repetir: "dias", dias: [0, 2, 4], estrellas: 2, momento: "tarde" },
      { id: nuevoId("tar"), titulo: "Regar las plantas", miembroId: m.sofi, hecha: false, creada: ahoraIso, repetir: "dias", dias: [1, 4], estrellas: 1, momento: "tarde" },
      { id: nuevoId("tar"), titulo: "Sacar la basura", hecha: false, creada: ahoraIso, repetir: "dias", dias: [0, 3], estrellas: 2, momento: "noche" },
      { id: nuevoId("tar"), titulo: "Ordenar la pieza", miembroId: m.tomi, hecha: false, creada: new Date().toISOString(), estrellas: 2 },
      { id: nuevoId("tar"), titulo: "Cambiar sábanas", miembroId: m.mama, hecha: false, creada: new Date().toISOString() },
      { id: nuevoId("tar"), titulo: "Llevar el auto a revisión técnica", miembroId: m.papa, hecha: false, creada: new Date().toISOString() },
      { id: nuevoId("tar"), titulo: "Pasear al perro", miembroId: m.tomi, hecha: true, creada: new Date().toISOString() },
      { id: nuevoId("tar"), titulo: "Comprar regalo Tía Ana", hecha: false, creada: new Date().toISOString() },
    ],
    premios: [
      { id: "pre_helado", titulo: "Helado", emoji: "🍦", costo: 10 },
      { id: "pre_juegos", titulo: "30 minutos de videojuegos", emoji: "🎮", costo: 15, miembroId: m.tomi },
      { id: "pre_pelicula", titulo: "Elegir la película del viernes", emoji: "🎬", costo: 20 },
      { id: "pre_parque", titulo: "Ir al parque con papá", emoji: "🛝", costo: 25 },
    ],
    estrellas: [
      { id: nuevoId("est"), miembroId: m.sofi, cantidad: 12, motivo: "Semana pasada", fecha: ahoraIso },
      { id: nuevoId("est"), miembroId: m.tomi, cantidad: 7, motivo: "Semana pasada", fecha: ahoraIso },
    ],
  };
}
