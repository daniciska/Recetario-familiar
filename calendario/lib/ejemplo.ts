import type { EstadoApp, Ingrediente, Receta, Unidad, CategoriaCompra } from "./datos/tipos";
import { adivinarCategoria, claveComida } from "./compras";
import { hoy, lunesDe, sumarDias } from "./fechas";

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

export const COLORES_MIEMBRO = [
  "#E76F51", // coral
  "#2A9D8F", // verde agua
  "#E9B03B", // mostaza
  "#7C6CF2", // lavanda
  "#E86A92", // frambuesa
  "#3D8BD9", // azul
  "#5FAE4E", // verde
  "#9C6B4E", // canela
];

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

export function estadoEjemplo(): EstadoApp {
  const lunes = lunesDe(hoy());
  const d = (i: number) => sumarDias(lunes, i);
  const m = { mama: "mie_mama", papa: "mie_papa", sofi: "mie_sofi", tomi: "mie_tomi" };

  const plan: EstadoApp["plan"] = {};
  const poner = (dia: number, tipo: string, recetaId: string | undefined, porciones = 4, texto?: string) => {
    plan[claveComida(d(dia), tipo)] = { recetaId, porciones, texto };
  };
  poner(0, "almuerzo", "rec_charquican");
  poner(1, "almuerzo", "rec_cazuela");
  poner(2, "cena", "rec_porotos_riendas");
  poner(3, "almuerzo", undefined, 4, "Sobras de porotos");
  poner(4, "once", "rec_sopaipillas");
  poner(5, "desayuno", "rec_tostadas_palta");
  poner(5, "almuerzo", "rec_pastel_choclo", 6);
  poner(6, "almuerzo", undefined, 4, "Donde la abuela 👵");
  poner(6, "once", "rec_tostadas_palta");

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
      { id: "ev_cumple", titulo: "Cumple de la Tía Ana 🎂", miembros: [m.mama, m.papa, m.sofi, m.tomi], fecha: d(5), todoElDia: true, repeticion: "nunca" },
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
      { id: nuevoId("tar"), titulo: "Regar las plantas", miembroId: m.sofi, hecha: false, creada: new Date().toISOString() },
      { id: nuevoId("tar"), titulo: "Ordenar la pieza", miembroId: m.tomi, hecha: false, creada: new Date().toISOString() },
      { id: nuevoId("tar"), titulo: "Cambiar sábanas", miembroId: m.mama, hecha: false, creada: new Date().toISOString() },
      { id: nuevoId("tar"), titulo: "Llevar el auto a revisión técnica", miembroId: m.papa, hecha: false, creada: new Date().toISOString() },
      { id: nuevoId("tar"), titulo: "Pasear al perro", miembroId: m.tomi, hecha: true, creada: new Date().toISOString() },
      { id: nuevoId("tar"), titulo: "Comprar regalo Tía Ana", hecha: false, creada: new Date().toISOString() },
    ],
  };
}
