// normalizar.ts → plan(): lo guardado antes de los espacios se lee igual que antes, el formato nuevo
// (primer espacio en la raíz + `mas`) se conserva y lo dañado se repara sin caerse.
import { normalizarGuardado, normalizarRespaldo } from "@/lib/datos/normalizar";
import { estadoEjemplo } from "@/lib/ejemplo";
import { itemsDe } from "@/lib/comidas";
import type { PlanComidas } from "@/lib/datos/tipos";
import { planViejo } from "./viejo";
import { caso, fin, igual, igualJSON, json, ok, seccion } from "./comun";

const base = estadoEjemplo().ajustes;
const plan = (x: unknown): PlanComidas => normalizarGuardado({ plan: x }, base).plan;

/** Un plan como lo guardaba la versión anterior (un ítem por comida), con sus rarezas. */
const VIEJO = {
  "2026-11-09|almuerzo": { recetaId: "rec_charquican", porciones: 4 },
  "2026-11-09|colacion": { texto: "Manzana y yogur", porciones: 2 },
  "2026-11-10|almuerzo": { recetaId: "rec_cazuela", texto: undefined, porciones: 4.4 },
  "2026-11-11|cena": { recetaId: "rec_porotos", porciones: 0 },
  "2026-11-12|once": { texto: "  ", porciones: 4 }, // vacío: no queda
  "2026-11-13|merienda": { texto: "No es un tipo", porciones: 4 }, // clave rara: no queda
  "2026-11-14|almuerzo": "dañado",
  "2026-11-15|almuerzo": { texto: "Donde la abuela 👵" }, // sin porciones
};

seccion("Lo guardado antes de los espacios");
await caso("viejo", () => {
  igual("se lee exactamente igual que con el normalizar anterior", plan(VIEJO), planViejo(VIEJO));
  igualJSON("y queda guardado igual (sin la clave mas)", plan(VIEJO), planViejo(VIEJO));
  ok("ninguna comida trae mas", Object.values(plan(VIEJO)).every((c) => !("mas" in c)));
  const p = plan(VIEJO);
  igual("cada comida queda en su primer espacio (almuerzo)", itemsDe(p["2026-11-09|almuerzo"], "almuerzo"), [{ recetaId: "rec_charquican" }, null, null, null]);
  igual("colación: el texto en el primero de 3", itemsDe(p["2026-11-09|colacion"], "colacion"), [{ texto: "Manzana y yogur" }, null, null]);
  ok("porciones reparadas como antes (4.4 → 4, 0 → 1, sin valor → 4)", p["2026-11-10|almuerzo"].porciones === 4 && p["2026-11-11|cena"].porciones === 1 && p["2026-11-15|almuerzo"].porciones === 4);
});

seccion("Formato nuevo");
await caso("nuevo", () => {
  const nuevo = {
    "2026-11-09|almuerzo": { recetaId: "rec_charquican", porciones: 4, mas: [null, { texto: "Ensalada" }, { recetaId: "rec_flan" }] },
    "2026-11-09|desayuno": { texto: "Pan con palta", porciones: 4, mas: [{ texto: "Plátano" }, { texto: "Leche" }, { texto: "Té" }] },
    "2026-11-10|cena": { porciones: 3, mas: [{ texto: "Arroz" }] }, // primer espacio vacío
  };
  igual("se conserva tal cual", plan(nuevo), {
    "2026-11-09|almuerzo": { recetaId: "rec_charquican", texto: undefined, porciones: 4, mas: [null, { texto: "Ensalada" }, { recetaId: "rec_flan" }] },
    "2026-11-09|desayuno": { recetaId: undefined, texto: "Pan con palta", porciones: 4, mas: [{ texto: "Plátano" }, { texto: "Leche" }, { texto: "Té" }] },
    "2026-11-10|cena": { recetaId: undefined, texto: undefined, porciones: 3, mas: [{ texto: "Arroz" }] },
  });
  igualJSON("ida y vuelta por JSON", plan(json(plan(nuevo))), nuevo);
  igual("normalizar dos veces da lo mismo", plan(plan(nuevo)), plan(nuevo));
});

seccion("Dañado o raro");
await caso("dañado", () => {
  const raro = {
    a: 1,
    "2026-11-09|almuerzo": { recetaId: "r1", porciones: 4, mas: "no es lista" },
    "2026-11-09|cena": { recetaId: "r1", porciones: 4, mas: [5, "texto", { recetaId: 7 }, { texto: "  " }, {}, { texto: "Fruta", extra: 1 }, null, null] },
    "2026-11-10|cena": { porciones: 4, mas: [null, {}, { texto: "" }] }, // nada de nada: se quita
    "2026-11-11|cena": { porciones: 4, mas: Array.from({ length: 30 }, (_, i) => ({ texto: `x${i}` })) },
    "2026-11-12|cena": { texto: "Sopa", porciones: 4, mas: [] },
  };
  const p = plan(raro);
  igual("mas que no es lista: se ignora", p["2026-11-09|almuerzo"], { recetaId: "r1", texto: undefined, porciones: 4 });
  igual("ítems dañados → vacíos; campos extra fuera; vacíos del final fuera", p["2026-11-09|cena"].mas, [null, null, null, null, null, { texto: "Fruta" }]);
  ok("comida sin nada en ningún espacio: se quita", !("2026-11-10|cena" in p));
  ok("máximo 12 ítems por comida", p["2026-11-11|cena"].mas!.length === 11, p["2026-11-11|cena"].mas!.length);
  ok("mas vacío: sin la clave", !("mas" in p["2026-11-12|cena"]));
  ok("no se cae con cualquier cosa", [null, 3, "x", [], [1, 2]].every((x) => Object.keys(plan(x)).length === 0));
});

seccion("Respaldo");
await caso("respaldo", () => {
  const e = estadoEjemplo();
  const r = normalizarRespaldo(json(e), base);
  ok("el respaldo con el formato nuevo se carga", "estado" in r);
  if ("estado" in r) igualJSON("el plan del ejemplo (con varios ítems) vuelve igual", r.estado.plan, e.plan);
  ok("el ejemplo tiene comidas con varios ítems", Object.values(e.plan).some((c) => (c.mas?.length ?? 0) >= 2));
});

fin();
