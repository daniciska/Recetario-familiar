// La «nota» de un ingrediente (preparación o envase: «picada en cubitos», «tarro de 397 g») cuando un
// equipo con la versión anterior corrige ese ingrediente. Ese equipo no conoce la nota (su normalizar la
// descarta) y guarda la receta entera; PUT /api/datos/recetas se la repone con conservarCamposNuevos.
// El «≈» (estimado) y «cómo lo dijo» dejan de valer si cambió la cantidad, la unidad o el nombre; la nota
// no: sigue describiendo ese ingrediente (el editor viejo conserva el id de cada fila).
import { conservarCamposNuevos } from "@/servidor/conservar";
import { guardarRecetaVieja, recetasViejas, type IngredienteViejo } from "../recetas/viejo";
import { caso, fin, igual, json, ok, seccion } from "./comun";

type O = Record<string, unknown>;
const GUARDADA = [
  {
    id: "rec_x",
    nombre: "Pie de limón",
    emoji: "🥧",
    porciones: 8,
    pasos: [],
    ingredientes: [
      { id: "i1", nombre: "Leche condensada", cantidad: 1, unidad: "lata", categoria: "Despensa", nota: "tarro de 397 g" },
      { id: "i2", nombre: "Cebolla", cantidad: 2, unidad: "unidad", categoria: "Verduras y frutas", nota: "picada en cubitos", comoLoDijo: "un par", estimado: true },
      { id: "i3", nombre: "Limón", cantidad: 4, unidad: "unidad", categoria: "Verduras y frutas", nota: "sólo el jugo", comoLoDijo: "unos cuatro", estimado: true },
    ],
  },
];

/** Lo que manda la tablet vieja después de cambiar los ingredientes de la receta con `f`. */
function editarEnTabletVieja(f: (i: IngredienteViejo) => IngredienteViejo) {
  const v = recetasViejas(json(GUARDADA));
  return guardarRecetaVieja(v, { ...v[0], ingredientes: v[0].ingredientes.map(f) });
}
const ingredientes = (r: unknown) => ((r as O[])[0].ingredientes as O[]).map((i) => json(i));

seccion("La tablet vieja corrige un ingrediente: la nota se conserva");
await caso("cantidad", () => {
  const llega = editarEnTabletVieja((i) => (i.id === "i2" ? { ...i, cantidad: 3 } : i));
  ok("lo que manda la tablet vieja no trae notas (su normalizar las descarta)", ingredientes(llega).every((i) => !("nota" in i)));
  const [, cebolla] = ingredientes(conservarCamposNuevos(json(GUARDADA), llega));
  igual("3 cebollas: sigue «picada en cubitos»; el «≈» y «un par» ya no valen", cebolla, {
    id: "i2",
    nombre: "Cebolla",
    cantidad: 3,
    unidad: "unidad",
    categoria: "Verduras y frutas",
    nota: "picada en cubitos",
  });
});

await caso("unidad", () => {
  const [leche] = ingredientes(conservarCamposNuevos(json(GUARDADA), editarEnTabletVieja((i) => (i.id === "i1" ? { ...i, unidad: "unidad" } : i))));
  ok("cambia la unidad de la leche condensada: sigue «tarro de 397 g»", leche.unidad === "unidad" && leche.nota === "tarro de 397 g", leche);
});

await caso("nombre", () => {
  const [leche, , limon] = ingredientes(
    conservarCamposNuevos(
      json(GUARDADA),
      editarEnTabletVieja((i) => (i.id === "i1" ? { ...i, nombre: "Leche condensada Nestlé" } : i.id === "i3" ? { ...i, nombre: "Limón de pica" } : i)),
    ),
  );
  ok("corrige el nombre de la leche condensada: sigue «tarro de 397 g»", leche.nombre === "Leche condensada Nestlé" && leche.nota === "tarro de 397 g", leche);
  ok("corrige el nombre del limón: sigue «sólo el jugo», sin «≈» ni «unos cuatro»", limon.nota === "sólo el jugo" && !("estimado" in limon) && !("comoLoDijo" in limon), limon);
});

seccion("Lo demás, como antes");
await caso("sin cambios", () => {
  const r = conservarCamposNuevos(json(GUARDADA), editarEnTabletVieja((i) => i));
  igual("si no tocó el ingrediente, recupera todo (nota, «≈» y cómo lo dijo)", ingredientes(r), json(GUARDADA[0].ingredientes));
  const [, cebolla, limon] = ingredientes(conservarCamposNuevos(json(GUARDADA), editarEnTabletVieja((i) => (i.id === "i2" ? { ...i, cantidad: 3 } : i))));
  ok("corregir uno no le quita nada a los demás", limon.estimado === true && limon.comoLoDijo === "unos cuatro" && limon.nota === "sólo el jugo" && cebolla.nota === "picada en cubitos");
});

await caso("ingrediente nuevo o con nota propia", () => {
  const v = recetasViejas(json(GUARDADA));
  const conNuevo = guardarRecetaVieja(v, { ...v[0], ingredientes: [...v[0].ingredientes, { id: "i9", nombre: "Huevo", cantidad: 3, unidad: "unidad", categoria: "Lácteos y huevos" }] });
  igual("un ingrediente nuevo queda como llegó", ingredientes(conservarCamposNuevos(json(GUARDADA), conNuevo))[3], { id: "i9", nombre: "Huevo", cantidad: 3, unidad: "unidad", categoria: "Lácteos y huevos" });
  const propia = [{ ...json(GUARDADA[0]), ingredientes: [{ ...json(GUARDADA[0].ingredientes[1]), cantidad: 5, nota: "en pluma" }] }];
  ok("si ya viene una nota, se deja la que vino", ingredientes(conservarCamposNuevos(json(GUARDADA), propia))[0].nota === "en pluma");
  const raro = [{ ...json(GUARDADA[0]), ingredientes: [{ id: "i2" }, null, { id: "i3", nombre: 7 }] }];
  igual(
    "un ingrediente dañado (sin nombre) con el mismo id no recupera nada ni se rompe",
    ingredientes(conservarCamposNuevos(json(GUARDADA), raro)),
    [{ id: "i2" }, null, { id: "i3", nombre: 7 }],
  );
});

fin();
