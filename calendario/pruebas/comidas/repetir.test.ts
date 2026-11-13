// «Repetir la semana pasada» y su «Deshacer» (lib/comidas.ts → repetirSemana / deshacerRepetir):
// deshacer quita exactamente las comidas que se copiaron, y sólo las que siguen como se copiaron.
import { claveComida, deshacerRepetir, repetirSemana } from "@/lib/comidas";
import { normalizarGuardado } from "@/lib/datos/normalizar";
import { estadoEjemplo } from "@/lib/ejemplo";
import type { ComidaPlanificada, PlanComidas } from "@/lib/datos/tipos";
import { caso, fin, igual, igualJSON, json, ok, seccion } from "./comun";

const base = estadoEjemplo().ajustes;
/** Lo que vuelve de la nube (o del localStorage) después de guardar: JSON + normalizar. */
const deLaNube = (p: PlanComidas): PlanComidas => normalizarGuardado({ plan: json(p) }, base).plan;

const SEMANA = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];
const k = claveComida;

/** Semana pasada con varias comidas y esta semana con una ya puesta (que no se pisa). */
function planInicial(): PlanComidas {
  return {
    [k("2026-11-02", "almuerzo")]: { recetaId: "rec_charquican", porciones: 4, mas: [{ texto: "Arroz" }, null, { texto: "Fruta" }] },
    [k("2026-11-02", "desayuno")]: { texto: "Pan con palta", porciones: 4 },
    [k("2026-11-03", "cena")]: { texto: "Sopa", porciones: 2 },
    [k("2026-11-05", "colacion")]: { texto: "Sin colación", porciones: 4 },
    [k("2026-11-08", "once")]: { texto: "Sopaipillas", porciones: 6 },
    // Esta semana: el martes ya tenía cena (no se copia ni se deshace).
    [k("2026-11-10", "cena")]: { texto: "Ya había", porciones: 4 },
  };
}

seccion("repetirSemana devuelve lo que copió");
await caso("copias", () => {
  const plan = planInicial();
  const r = repetirSemana(plan, SEMANA);
  ok("copia 4 (la cena del martes ya estaba)", r.copiadas === 4, r.copiadas);
  igual(
    "copias: exactamente las claves que se pusieron",
    Object.keys(r.copias).sort(),
    [k("2026-11-09", "almuerzo"), k("2026-11-09", "desayuno"), k("2026-11-12", "colacion"), k("2026-11-15", "once")].sort(),
  );
  ok("cada copia es igual a lo que quedó en el plan", Object.entries(r.copias).every(([c, v]) => JSON.stringify(v) === JSON.stringify(r.plan[c])));
  ok("las copias no comparten objetos con el plan", Object.entries(r.copias).every(([c, v]) => v !== r.plan[c] && (v.mas === undefined || v.mas !== r.plan[c].mas)));
  r.plan[k("2026-11-09", "almuerzo")].mas![0]!.texto = "Puré";
  ok("cambiar el plan después no cambia las copias guardadas para deshacer", r.copias[k("2026-11-09", "almuerzo")].mas![0]!.texto === "Arroz");
  ok("el plan original no se toca", Object.keys(plan).length === 6 && !plan[k("2026-11-09", "almuerzo")]);
});

seccion("Deshacer enseguida");
await caso("deshacer", () => {
  const plan = planInicial();
  const r = repetirSemana(plan, SEMANA);
  const d = deshacerRepetir(r.plan, r.copias);
  ok("quita las 4 copiadas", d.quitadas === 4 && d.cambiadas === 0, d);
  igual("el plan vuelve a ser exactamente el de antes", d.plan, plan);
  const otra = deshacerRepetir(d.plan, r.copias);
  ok("deshacer otra vez no hace nada", otra.quitadas === 0 && otra.cambiadas === 0, otra);
  igual("y el plan sigue igual", otra.plan, plan);
});

seccion("Deshacer después de pasar por la nube (JSON + normalizar, otro orden de claves)");
await caso("nube", () => {
  const plan = deLaNube(planInicial());
  const r = repetirSemana(plan, SEMANA);
  const vuelta = deLaNube(r.plan);
  // Otro orden de claves en una comida (otro equipo la escribió así): sigue siendo la misma.
  const almuerzo = vuelta[k("2026-11-09", "almuerzo")];
  vuelta[k("2026-11-09", "almuerzo")] = { mas: almuerzo.mas, porciones: almuerzo.porciones, recetaId: almuerzo.recetaId } as ComidaPlanificada;
  const d = deshacerRepetir(vuelta, r.copias);
  ok("quita las 4 aunque vuelvan normalizadas y con otro orden", d.quitadas === 4 && d.cambiadas === 0, d);
  igualJSON("queda lo de antes", d.plan, plan);
});

seccion("Si alguien las cambió entretanto, ésas no se tocan");
await caso("cambiadas", () => {
  const plan = planInicial();
  const r = repetirSemana(plan, SEMANA);
  const despues: PlanComidas = { ...r.plan };
  // Alguien cambió las porciones del almuerzo copiado del lunes…
  despues[k("2026-11-09", "almuerzo")] = { ...despues[k("2026-11-09", "almuerzo")], porciones: 6 };
  // …otro cambió el texto del desayuno copiado…
  despues[k("2026-11-09", "desayuno")] = { texto: "Tostadas", porciones: 4 };
  // …otro quitó la once copiada del domingo…
  delete despues[k("2026-11-15", "once")];
  // …y alguien puso una comida nueva en otro espacio y cambió la que ya había.
  despues[k("2026-11-11", "almuerzo")] = { texto: "Cazuela", porciones: 4 };
  despues[k("2026-11-10", "cena")] = { texto: "Ya había, cambiada", porciones: 4 };
  const d = deshacerRepetir(despues, r.copias);
  ok("sólo quita la colación (la única copiada que sigue igual)", d.quitadas === 1, d);
  ok("cuenta 2 cambiadas (la quitada no cuenta)", d.cambiadas === 2, d);
  ok("la colación copiada salió", !(k("2026-11-12", "colacion") in d.plan));
  igual("el almuerzo con otras porciones se queda", d.plan[k("2026-11-09", "almuerzo")], despues[k("2026-11-09", "almuerzo")]);
  igual("el desayuno cambiado se queda", d.plan[k("2026-11-09", "desayuno")], { texto: "Tostadas", porciones: 4 });
  ok("la once quitada sigue quitada (no vuelve)", !(k("2026-11-15", "once") in d.plan));
  igual("la comida nueva de otro espacio se queda", d.plan[k("2026-11-11", "almuerzo")], { texto: "Cazuela", porciones: 4 });
  igual("la que ya había (y cambiaron) se queda", d.plan[k("2026-11-10", "cena")], { texto: "Ya había, cambiada", porciones: 4 });
  igual(
    "la semana pasada queda entera",
    Object.keys(d.plan).filter((c) => c < "2026-11-09"),
    Object.keys(plan).filter((c) => c < "2026-11-09"),
  );
  // Si después alguien la deja igual que la copia, cuenta como la copia (no hay cómo distinguirlas).
  const igualQueCopia = deshacerRepetir({ ...despues, [k("2026-11-09", "desayuno")]: { texto: "Pan con palta", porciones: 4 } }, r.copias);
  ok("una que volvió a quedar igual a la copia sí sale", !(k("2026-11-09", "desayuno") in igualQueCopia.plan));
});

seccion("Conflicto al guardar: el cambio se vuelve a aplicar sobre lo último (como actualizar() en lib/store.tsx)");
await caso("conflicto", () => {
  const plan = planInicial();
  // Primer intento sobre lo que había en este equipo…
  const primero = repetirSemana(plan, SEMANA);
  ok("primer intento: 4 copias", primero.copiadas === 4);
  // …pero otro equipo ya había puesto el desayuno del lunes: se vuelve a aplicar sobre lo último.
  const ultimo: PlanComidas = { ...plan, [k("2026-11-09", "desayuno")]: { texto: "Huevos", porciones: 4 } };
  const segundo = repetirSemana(ultimo, SEMANA);
  ok("segundo intento: 3 copias (el desayuno del otro no se pisa)", segundo.copiadas === 3 && !(k("2026-11-09", "desayuno") in segundo.copias));
  // Deshacer con las copias del intento que quedó guardado: el desayuno del otro equipo se queda.
  const d = deshacerRepetir(segundo.plan, segundo.copias);
  ok("quita las 3 suyas", d.quitadas === 3 && d.cambiadas === 0, d);
  igual("el desayuno del otro equipo se queda", d.plan[k("2026-11-09", "desayuno")], { texto: "Huevos", porciones: 4 });
  igual("queda como estaba antes de repetir", d.plan, ultimo);
});

seccion("Nada que copiar");
await caso("vacío", () => {
  const r = repetirSemana({}, SEMANA);
  ok("0 copias y copias vacío", r.copiadas === 0 && Object.keys(r.copias).length === 0);
  const d = deshacerRepetir({ [k("2026-11-09", "cena")]: { texto: "Sopa", porciones: 4 } }, r.copias);
  ok("deshacer sin copias no quita nada", d.quitadas === 0 && Object.keys(d.plan).length === 1);
});

fin();
