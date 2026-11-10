// generarLista (lib/compras.ts) con los espacios: suma las recetas de todos los espacios de cada comida,
// escaladas por las porciones de la comida; lo guardado antes (un ítem) da la misma lista que antes.
import { generarLista, type LineaGenerada } from "@/lib/compras";
import { estadoEjemplo } from "@/lib/ejemplo";
import { itemsLlenos } from "@/lib/comidas";
import type { Ingrediente, PlanComidas, Receta, Unidad } from "@/lib/datos/tipos";
import { caso, fin, igual, ok, seccion } from "./comun";

let n = 0;
const ing = (cantidad: number | null, unidad: Unidad, nombre: string): Ingrediente => ({
  id: `i${n++}`,
  nombre,
  cantidad,
  unidad,
  categoria: "Otros",
});
const R: Receta[] = [
  { id: "cazuela", nombre: "Cazuela", emoji: "🥣", porciones: 4, ingredientes: [ing(1, "kg", "Pollo"), ing(4, "unidad", "Papa"), ing(1, "unidad", "Choclo")], pasos: [] },
  { id: "arroz", nombre: "Arroz graneado", emoji: "🍚", porciones: 4, ingredientes: [ing(400, "g", "Arroz"), ing(1, "unidad", "Zanahoria")], pasos: [] },
  { id: "ensalada", nombre: "Ensalada chilena", emoji: "🥗", porciones: 2, ingredientes: [ing(2, "unidad", "Tomate"), ing(1, "unidad", "Cebolla"), ing(null, "al gusto", "Sal")], pasos: [] },
  { id: "flan", nombre: "Flan", emoji: "🍮", porciones: 6, ingredientes: [ing(1, "l", "Leche"), ing(6, "unidad", "Huevo")], pasos: [] },
];
const LUNES = "2026-11-09";
const linea = (l: LineaGenerada[], nombre: string) => l.find((x) => x.nombre === nombre);
const resumen = (l: LineaGenerada[]) => Object.fromEntries(l.map((x) => [x.nombre, `${x.cantidad ?? "al gusto"} ${x.unidad}`]));

seccion("Lo guardado antes (un ítem por comida)");
await caso("viejo", () => {
  const plan: PlanComidas = {
    "2026-11-09|almuerzo": { recetaId: "cazuela", porciones: 4 },
    "2026-11-10|cena": { recetaId: "cazuela", porciones: 8 },
    "2026-11-11|almuerzo": { texto: "Sobras", porciones: 4 },
    "2026-11-16|almuerzo": { recetaId: "arroz", porciones: 4 }, // otra semana
  };
  const l = generarLista(plan, R, LUNES);
  igual("misma lista que antes: 1 + 2 kg de pollo, 4 + 8 papas, 1 + 2 choclos", resumen(l), { Choclo: "3 unidad", Papa: "12 unidad", Pollo: "3 kg" });
  ok("el texto libre y la otra semana no suman", !linea(l, "Arroz"));
  igual("de qué receta viene", linea(l, "Pollo")?.recetas, ["Cazuela"]);
});

seccion("Varios espacios");
await caso("nuevo", () => {
  const plan: PlanComidas = {
    // Proteína: cazuela; carbohidrato vacío; verduras: ensalada; postre: flan. Para 6.
    "2026-11-09|almuerzo": { recetaId: "cazuela", porciones: 6, mas: [null, { recetaId: "ensalada" }, { recetaId: "flan" }] },
    // Primer espacio vacío; arroz en el segundo; texto libre en el tercero. Para 2.
    "2026-11-10|cena": { porciones: 2, mas: [{ recetaId: "arroz" }, { texto: "Lechuga" }] },
    // Receta que ya no existe: no suma ni rompe.
    "2026-11-11|cena": { recetaId: "borrada", porciones: 4, mas: [{ recetaId: "arroz" }] },
  };
  const l = generarLista(plan, R, LUNES);
  igual("suma todos los espacios escalando por las porciones de la comida", resumen(l), {
    Arroz: "600 g", // 400 g × 2/4 + 400 g × 4/4
    Cebolla: "3 unidad", // 1 × 6/2
    Choclo: "2 unidad", // 1 × 6/4 = 1,5 → 2
    Huevo: "6 unidad", // 6 × 6/6
    Leche: "1 l",
    Papa: "6 unidad", // 4 × 6/4
    Pollo: "1.5 kg",
    Sal: "al gusto al gusto", // sin cantidad: queda "al gusto"
    Tomate: "6 unidad", // 2 × 6/2
    Zanahoria: "2 unidad", // 1 × 2/4 + 1 × 4/4 = 1,5 → 2
  });
  igual("cada ingrediente dice de qué recetas viene", linea(l, "Arroz")?.recetas, ["Arroz graneado"]);
  igual("en orden alfabético", l.map((x) => x.nombre), ["Arroz", "Cebolla", "Choclo", "Huevo", "Leche", "Papa", "Pollo", "Sal", "Tomate", "Zanahoria"]);
  const dos = generarLista({ "2026-11-09|almuerzo": { recetaId: "arroz", porciones: 4, mas: [{ recetaId: "arroz" }] } }, R, LUNES);
  ok("la misma receta en dos espacios cuenta dos veces", linea(dos, "Arroz")?.cantidad === 800, resumen(dos));
});

seccion("Con lo ya comprado");
await caso("descuento", () => {
  const plan: PlanComidas = { "2026-11-09|almuerzo": { recetaId: "cazuela", porciones: 4, mas: [{ recetaId: "arroz" }] } };
  const l = generarLista(plan, R, LUNES, [
    { id: "c1", nombre: "Arroz", cantidad: 250, unidad: "g", categoria: "Despensa", comprado: true, origen: "menu", semana: LUNES },
  ]);
  ok("descuenta lo comprado también de los espacios 2.º en adelante", linea(l, "Arroz")?.cantidad === 150 && linea(l, "Arroz")?.descontado === "250 g", linea(l, "Arroz"));
});

seccion("Datos de ejemplo");
await caso("ejemplo", () => {
  const e = estadoEjemplo();
  const lunes = Object.keys(e.plan).sort()[0].split("|")[0];
  const l = generarLista(e.plan, e.recetas, lunes);
  const conReceta = Object.values(e.plan).flatMap((c) => itemsLlenos(c)).filter((x) => x.recetaId);
  ok("el ejemplo arma una lista con las recetas de sus espacios", l.length > 10 && conReceta.length >= 7, { lineas: l.length, recetas: conReceta.length });
});

fin();
