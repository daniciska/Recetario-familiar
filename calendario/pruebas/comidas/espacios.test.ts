// Espacios por comida (lib/comidas.ts): la constante ESPACIOS_COMIDA y los ayudantes que leen, arman
// y cambian los ítems de una comida.
import {
  ESPACIOS_COMIDA,
  TIPOS_COMIDA,
  SIN_COLACION,
  armarComida,
  atajosComida,
  claveComida,
  copiarComida,
  emojiComida,
  esComidaEntera,
  itemsDe,
  itemsLlenos,
  itemsVisibles,
  nombreComida,
  nombreItem,
  nombresComida,
  ponerComida,
  ponerItem,
  quitarRecetaDelPlan,
  repetirSemana,
} from "@/lib/comidas";
import { claveComida as claveDesdeCompras } from "@/lib/compras";
import type { ComidaPlanificada, PlanComidas, Receta } from "@/lib/datos/tipos";
import { caso, fin, igual, igualJSON, json, ok, seccion } from "./comun";

const receta = (id: string, nombre: string, emoji = "🍲"): Receta => ({ id, nombre, emoji, porciones: 4, ingredientes: [], pasos: [] });
const recetas = new Map<string, Receta>([
  ["rec_cazuela", receta("rec_cazuela", "Cazuela", "🥣")],
  ["rec_arroz", receta("rec_arroz", "Arroz graneado", "🍚")],
  ["rec_flan", receta("rec_flan", "Flan", "🍮")],
]);

seccion("ESPACIOS_COMIDA (lo que pidió la familia)");
await caso("constante", () => {
  const e = ESPACIOS_COMIDA;
  igual("desayuno: 4 espacios libres con ejemplos Pan, Fruta, Lácteo, Bebida", e.desayuno.map((x) => [x.nombre, x.ejemplo]), [
    [undefined, "Pan"],
    [undefined, "Fruta"],
    [undefined, "Lácteo"],
    [undefined, "Bebida"],
  ]);
  igual("colación: 3 espacios libres con ejemplos Fruta, Fruta, Carbohidrato", e.colacion.map((x) => [x.nombre, x.ejemplo]), [
    [undefined, "Fruta"],
    [undefined, "Fruta"],
    [undefined, "Carbohidrato"],
  ]);
  igual("almuerzo: Proteína, Carbohidrato, Verduras, Postre", e.almuerzo.map((x) => x.nombre), ["Proteína", "Carbohidrato", "Verduras", "Postre"]);
  igual("cena: Proteína, Carbohidrato, Verduras", e.cena.map((x) => x.nombre), ["Proteína", "Carbohidrato", "Verduras"]);
  igual("once: 1 espacio libre (la familia no dijo nada)", e.once.map((x) => x.nombre), [undefined]);
  ok("cada tipo de comida tiene espacios", TIPOS_COMIDA.every((t) => ESPACIOS_COMIDA[t.id].length >= 1));
  ok("cada espacio tiene ejemplo y atajos", Object.values(e).flat().every((x) => x.ejemplo && x.atajos.length > 0));
  igual("atajos de la colación entera: sólo «Sin colación»", atajosComida("colacion"), [SIN_COLACION]);
  ok("atajos de comida entera para el resto (Comemos fuera…)", atajosComida("almuerzo").includes("Comemos fuera") && atajosComida("cena").includes("Sobras"));
  ok("claveComida sigue saliendo de lib/compras (mismo valor)", claveDesdeCompras === claveComida && claveComida("2026-11-10", "cena") === "2026-11-10|cena");
});

seccion("itemsDe / itemsLlenos / armarComida");
await caso("leer", () => {
  igual("sin comida: todos vacíos (almuerzo = 4)", itemsDe(undefined, "almuerzo"), [null, null, null, null]);
  igual("lo guardado antes (un ítem) queda en el primer espacio", itemsDe({ recetaId: "rec_cazuela", porciones: 4 }, "almuerzo"), [
    { recetaId: "rec_cazuela" },
    null,
    null,
    null,
  ]);
  igual("texto libre de antes, en la colación", itemsDe({ texto: "Manzana y yogur", porciones: 2 }, "colacion"), [{ texto: "Manzana y yogur" }, null, null]);
  igual(
    "con mas: cada uno en su espacio (sin porciones ni mas dentro de los ítems)",
    itemsDe({ recetaId: "rec_cazuela", porciones: 4, mas: [null, { texto: "Ensalada" }] }, "cena"),
    [{ recetaId: "rec_cazuela" }, null, { texto: "Ensalada" }],
  );
  igual(
    "más ítems que espacios: se muestran todos (once tiene 1)",
    itemsDe({ texto: "Té", porciones: 4, mas: [{ texto: "Pan" }, { texto: "Queque" }] }, "once"),
    [{ texto: "Té" }, { texto: "Pan" }, { texto: "Queque" }],
  );
  igual("vacíos al final de sobra se quitan", itemsDe({ texto: "Té", porciones: 4, mas: [null, null, null] }, "once"), [{ texto: "Té" }]);
  igual("primer espacio vacío", itemsDe({ porciones: 4, mas: [{ texto: "Arroz" }] }, "almuerzo"), [null, { texto: "Arroz" }, null, null]);
  igual(
    "itemsLlenos: sólo los llenos, en orden",
    itemsLlenos({ porciones: 4, mas: [{ texto: "Arroz" }, null, { recetaId: "rec_flan" }] }),
    [{ texto: "Arroz" }, { recetaId: "rec_flan" }],
  );
  igual("itemsLlenos de nada", itemsLlenos(undefined), []);
});

await caso("armar", () => {
  igual("todo vacío → null", armarComida([null, null, null], 4), null);
  igualJSON("sólo el primero: sin mas (igual que antes)", armarComida([{ recetaId: "rec_cazuela" }, null, null, null], 5), { recetaId: "rec_cazuela", porciones: 5 });
  ok("sólo el primero: ni siquiera la clave mas", !("mas" in armarComida([{ texto: "Sopa" }, null], 4)!));
  igual("varios", armarComida([{ recetaId: "rec_cazuela" }, null, { texto: "Ensalada" }, { recetaId: "rec_flan" }], 4), {
    recetaId: "rec_cazuela",
    porciones: 4,
    mas: [null, { texto: "Ensalada" }, { recetaId: "rec_flan" }],
  });
  igual("primero vacío", armarComida([null, { texto: "Arroz" }], 3), { porciones: 3, mas: [{ texto: "Arroz" }] });
  igual("ítems vacíos ({} o texto vacío) cuentan como vacíos", armarComida([{}, { texto: "" }, { texto: "Jalea" }], 4), { porciones: 4, mas: [null, { texto: "Jalea" }] });
  const c: ComidaPlanificada = { recetaId: "rec_cazuela", porciones: 4, mas: [null, { texto: "Ensalada" }] };
  igual("ida y vuelta: armarComida(itemsDe(c)) = c", armarComida(itemsDe(c, "almuerzo"), c.porciones), c);
});

seccion("ponerItem / ponerComida");
await caso("poner", () => {
  const k = claveComida("2026-11-10", "almuerzo");
  let p: PlanComidas = {};
  p = ponerItem(p, k, "almuerzo", 0, { recetaId: "rec_cazuela" }, 4);
  igual("llenar el primero en un día vacío", p[k], { recetaId: "rec_cazuela", porciones: 4 });
  p = ponerItem(p, k, "almuerzo", 3, { recetaId: "rec_flan" }, 4);
  igual("llenar el postre deja vacíos los del medio", p[k], { recetaId: "rec_cazuela", porciones: 4, mas: [null, null, { recetaId: "rec_flan" }] });
  p = ponerItem(p, k, "almuerzo", 0, { texto: "Pollo arvejado" }, 6);
  igual("cambiar el primero no toca los demás (y guarda las porciones)", p[k], { texto: "Pollo arvejado", porciones: 6, mas: [null, null, { recetaId: "rec_flan" }] });
  p = ponerItem(p, k, "almuerzo", 0, null, 6);
  igual("vaciar el primero deja el postre", p[k], { porciones: 6, mas: [null, null, { recetaId: "rec_flan" }] });
  p = ponerItem(p, k, "almuerzo", 3, null, 6);
  ok("vaciar el último ítem quita la comida", !(k in p), p);
  const otro = { [claveComida("2026-11-11", "cena")]: { texto: "Sopa", porciones: 4 } };
  const p2 = ponerItem(otro, k, "almuerzo", 1, { texto: "Arroz" }, 4);
  igual("no cambia el plan de entrada", otro, { [claveComida("2026-11-11", "cena")]: { texto: "Sopa", porciones: 4 } });
  ok("las otras comidas quedan iguales (misma referencia)", p2[claveComida("2026-11-11", "cena")] === otro[claveComida("2026-11-11", "cena")]);

  // Dos equipos llenan espacios distintos de la misma comida: el store vuelve a aplicar el cambio
  // sobre lo último guardado (ConflictoVersion), así que los dos quedan.
  const base: PlanComidas = { [k]: { recetaId: "rec_cazuela", porciones: 4 } };
  const deA = ponerItem(base, k, "almuerzo", 1, { texto: "Arroz" }, 4);
  const deBsobreA = ponerItem(deA, k, "almuerzo", 3, { texto: "Fruta" }, 4);
  igual("cambios de dos equipos en espacios distintos no se pisan", deBsobreA[k], {
    recetaId: "rec_cazuela",
    porciones: 4,
    mas: [{ texto: "Arroz" }, null, { texto: "Fruta" }],
  });
  igual("ponerComida(null) quita", ponerComida(deBsobreA, k, null), {});
  igual("ponerComida reemplaza entera (atajo «Comemos fuera»)", ponerComida(deBsobreA, k, { texto: "Comemos fuera", porciones: 4 })[k], {
    texto: "Comemos fuera",
    porciones: 4,
  });
});

seccion("copiarComida / repetirSemana");
await caso("repetir", () => {
  const c: ComidaPlanificada = { recetaId: "rec_cazuela", porciones: 4, mas: [{ texto: "Arroz" }, null] };
  const d = copiarComida(c);
  igual("copia igual", d, c);
  d.mas![0]!.texto = "Puré";
  ok("copia independiente (cambiar la copia no cambia el original)", c.mas![0]!.texto === "Arroz");
  const plan: PlanComidas = {
    "2026-11-02|almuerzo": c,
    "2026-11-03|cena": { texto: "Sopa", porciones: 4 },
    "2026-11-10|cena": { texto: "Ya había", porciones: 4 },
  };
  const dias = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];
  const r = repetirSemana(plan, dias);
  ok("copia 1 comida (la otra ya tenía algo ese día y no se pisa)", r.copiadas === 1, r.copiadas);
  igual("con todos sus espacios", r.plan["2026-11-09|almuerzo"], c);
  ok("no comparte los ítems con la semana pasada", r.plan["2026-11-09|almuerzo"].mas !== c.mas);
  igual("lo que había se queda", r.plan["2026-11-10|cena"], { texto: "Ya había", porciones: 4 });
});

seccion("quitarRecetaDelPlan (al borrar una receta)");
await caso("quitar receta", () => {
  const plan: PlanComidas = {
    a: { recetaId: "rec_cazuela", porciones: 4 },
    b: { recetaId: "rec_cazuela", porciones: 4, mas: [null, { texto: "Ensalada" }, { recetaId: "rec_flan" }] },
    c: { texto: "Sopa", porciones: 4, mas: [{ recetaId: "rec_cazuela" }] },
    d: { recetaId: "rec_arroz", porciones: 4 },
  };
  const r = quitarRecetaDelPlan(plan, "rec_cazuela");
  ok("la comida que sólo tenía esa receta se quita", !("a" in r));
  igual("en el primer espacio: los demás quedan en su lugar", r.b, { porciones: 4, mas: [null, { texto: "Ensalada" }, { recetaId: "rec_flan" }] });
  igual("en otro espacio: también sale", r.c, { texto: "Sopa", porciones: 4 });
  ok("las que no la tienen quedan iguales", r.d === plan.d);
});

seccion("Para mostrar");
await caso("nombres", () => {
  const c: ComidaPlanificada = { recetaId: "rec_cazuela", porciones: 4, mas: [null, { texto: "Ensalada" }, { recetaId: "rec_flan" }] };
  igual("nombresComida en orden y sin vacíos", nombresComida(c, recetas), ["Cazuela", "Ensalada", "Flan"]);
  ok("nombreComida en una línea", nombreComida(c, recetas) === "Cazuela · Ensalada · Flan", nombreComida(c, recetas));
  ok("nombreComida de lo de antes (un ítem) = como antes", nombreComida({ texto: "Sobras", porciones: 4 }, recetas) === "Sobras");
  ok("emojiComida: el de la primera receta", emojiComida(c, recetas) === "🥣");
  ok("emojiComida sin recetas: undefined", emojiComida({ texto: "Fruta", porciones: 2 }, recetas) === undefined);
  ok("emojiComida salta recetas borradas", emojiComida({ recetaId: "rec_borrada", porciones: 2, mas: [{ recetaId: "rec_flan" }] }, recetas) === "🍮");
  const huerfana: ComidaPlanificada = { recetaId: "rec_borrada", porciones: 4, mas: [{ texto: "Arroz" }] };
  ok("receta borrada: sin nombre", nombreItem({ recetaId: "rec_borrada" }, recetas) === "");
  igual("receta borrada: no sale en los nombres", nombresComida(huerfana, recetas), ["Arroz"]);
  igual("itemsVisibles: la receta borrada cuenta como vacío", itemsVisibles(huerfana, "almuerzo", recetas), [null, { texto: "Arroz" }, null, null]);
  ok("receta borrada pero con texto: se ve el texto", nombreItem({ recetaId: "rec_borrada", texto: "Charquicán" }, recetas) === "Charquicán");
  igual("los ítems devueltos son copias (json igual)", json(itemsDe(c, "almuerzo")), itemsDe(c, "almuerzo"));
});

await caso("comida entera (atajo para toda la comida: sin espacios por llenar)", () => {
  // Lo que deja «Para toda la comida» (ponerTodo en VistaComidas): un solo ítem, en el primer espacio.
  const entera = (tipo: "colacion" | "almuerzo" | "cena" | "desayuno", texto: string) =>
    ponerComida({}, "k", { texto, porciones: 4 }).k;
  ok("«Sin colación» es la colación entera", esComidaEntera(entera("colacion", SIN_COLACION), "colacion"));
  for (const a of atajosComida("almuerzo")) ok(`«${a}» es el almuerzo entero`, esComidaEntera(entera("almuerzo", a), "almuerzo"));
  ok("«Delivery» en la cena y en el desayuno también", esComidaEntera(entera("cena", "Delivery"), "cena") && esComidaEntera(entera("desayuno", "Delivery"), "desayuno"));
  ok("escrito a mano con otras mayúsculas o espacios, igual", esComidaEntera({ texto: "  comemos FUERA ", porciones: 4 }, "almuerzo"));
  ok("«Sin colación» no es un atajo del almuerzo", !esComidaEntera(entera("almuerzo", SIN_COLACION), "almuerzo"));
  ok("un texto cualquiera en el primer espacio no lo es («Pollo»)", !esComidaEntera(entera("almuerzo", "Pollo"), "almuerzo"));
  ok("con otro espacio lleno ya no es la comida entera", !esComidaEntera({ texto: "Comemos fuera", porciones: 4, mas: [{ texto: "Arroz" }] }, "almuerzo"));
  ok("en otro espacio que no es el primero, tampoco", !esComidaEntera({ porciones: 4, mas: [{ texto: "Delivery" }] }, "almuerzo"));
  ok("una receta con ese nombre no cuenta (es una receta)", !esComidaEntera({ recetaId: "rec_cazuela", texto: "Sobras", porciones: 4 }, "almuerzo"));
  ok("vacía o sin comida: no", !esComidaEntera(undefined, "almuerzo") && !esComidaEntera({ porciones: 4 }, "almuerzo"));
  ok(
    "con una receta borrada en otro espacio (se ve vacío), sí",
    esComidaEntera({ texto: "Sobras", porciones: 4, mas: [{ recetaId: "rec_borrada" }] }, "almuerzo", recetas) &&
      !esComidaEntera({ texto: "Sobras", porciones: 4, mas: [{ recetaId: "rec_cazuela" }] }, "almuerzo", recetas),
  );
});

fin();
