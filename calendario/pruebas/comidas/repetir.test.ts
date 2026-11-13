// «Repetir la semana pasada» y su «Deshacer» (lib/comidas.ts → repetirSemana / deshacerRepetir / crearFila):
// deshacer quita exactamente las comidas que se copiaron, y sólo las que siguen como se copiaron; los dos
// se guardan de a uno, para que el servidor no los reciba al revés.
import { claveComida, crearFila, deshacerRepetir, repetirSemana } from "@/lib/comidas";
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

seccion("crearFila: «Repetir» y «Deshacer» de a uno");
await caso("fila", async () => {
  const fila = crearFila();
  const orden: string[] = [];
  let soltar!: () => void;
  ok("vacía: no está ocupada", !fila.ocupada());
  const a = fila.poner(async () => {
    orden.push("a empieza");
    await new Promise<void>((r) => (soltar = r));
    orden.push("a termina");
    return 1;
  });
  igual("con la fila vacía empieza en el acto (en el mismo toque)", orden, ["a empieza"]);
  ok("mientras corre, está ocupada", fila.ocupada());
  const b = fila.poner(async () => {
    orden.push("b empieza");
    throw new Error("falla b");
  });
  const c = fila.poner(async () => {
    orden.push("c empieza");
    return "c";
  });
  await Promise.resolve();
  await Promise.resolve();
  igual("la segunda espera que termine la primera", orden, ["a empieza"]);
  soltar();
  igual("a devuelve lo suyo", await a, 1);
  ok("b falla y lo dice", await b.then(() => false, (e: Error) => e.message === "falla b"));
  igual("c corre aunque b falló, y devuelve lo suyo", await c, "c");
  igual("en el orden en que se pusieron", orden, ["a empieza", "a termina", "b empieza", "c empieza"]);
  await Promise.resolve();
  ok("al final queda libre", !fila.ocupada());
  const d: string[] = [];
  void fila.poner(async () => void d.push("d"));
  igual("libre otra vez: empieza en el acto", d, ["d"]);
  const e = fila.poner(() => {
    throw new Error("sin promesa");
  });
  ok("una op que lanza sin promesa no rompe la fila", await e.then(() => false, (x: Error) => x.message === "sin promesa"));
  ok("y la fila sigue andando", (await fila.poner(async () => 7)) === 7);
});

/**
 * Modelo del guardado en la nube: el servidor acepta un plan sólo si `versionBase` es la suya (si no, 409 con
 * lo último) y aquí se elige en qué orden le llegan. `actualizar` es el de lib/store.tsx: aplica el cambio
 * en el equipo, lo manda con la versión que conoce y, si hay conflicto, lo vuelve a aplicar sobre lo último.
 */
function nube(inicial: PlanComidas) {
  const srv = { datos: json(inicial), version: 1 };
  const enCamino: { valor: PlanComidas; base: number; responder: (r: { status: number; datos: PlanComidas; version: number }) => void }[] = [];
  let local = json(inicial);
  let version = 1;
  const actualizar = async (fn: (p: PlanComidas) => PlanComidas) => {
    for (let intento = 0; ; intento++) {
      const valor = fn(local);
      local = valor;
      const r = await new Promise<{ status: number; datos: PlanComidas; version: number }>((responder) =>
        enCamino.push({ valor: json(valor), base: version, responder }),
      );
      if (r.status === 200) {
        version = r.version;
        return true;
      }
      if (r.status === 409 && intento < 4) {
        local = deLaNube(r.datos);
        version = r.version;
        continue;
      }
      return false;
    }
  };
  /** El servidor atiende el pedido que está en la posición `i` de los que van en camino. */
  const llega = async (i: number) => {
    const [p] = enCamino.splice(i, 1);
    if (p.base === srv.version) {
      srv.datos = p.valor;
      srv.version++;
      p.responder({ status: 200, datos: p.valor, version: srv.version });
    } else p.responder({ status: 409, datos: json(srv.datos), version: srv.version });
    for (let n = 0; n < 20; n++) await Promise.resolve();
  };
  return { srv, enCamino, actualizar, llega, local: () => local };
}

/** «Repetir» y «Deshacer» como en components/VistaComidas.tsx; con `fila` = null, sin fila (como antes). */
function botones(actualizar: (fn: (p: PlanComidas) => PlanComidas) => Promise<boolean>, fila: ReturnType<typeof crearFila> | null) {
  const poner = <T>(op: () => Promise<T>) => (fila ? fila.poner(op) : op());
  type Rep = { final?: PlanComidas | null; listo: Promise<PlanComidas | null>; primeras: () => PlanComidas };
  const repetir = (): Rep => {
    let copias: PlanComidas = {};
    const rep: Rep = {
      primeras: () => copias,
      listo: poner(async () => {
        const g = actualizar((p) => {
          const r = repetirSemana(p, SEMANA);
          copias = r.copias;
          return r.plan;
        });
        const f = (await g) ? copias : null;
        rep.final = f;
        return f;
      }),
    };
    return rep;
  };
  const deshacer = (rep: Rep) =>
    poner(async () => {
      // Sin fila se usaban las copias de ese momento; con fila, las del intento que quedó guardado.
      const copias = fila ? (rep.final !== undefined ? rep.final : await rep.listo) : rep.primeras();
      if (!copias) return null;
      let r = { quitadas: 0, cambiadas: 0 };
      const ok = await actualizar((p) => {
        const d = deshacerRepetir(p, copias);
        r = d;
        return d.plan;
      });
      return ok ? r : null;
    });
  return { repetir, deshacer };
}

const copiadasEn = (p: PlanComidas, antes: PlanComidas) => Object.keys(p).filter((c) => !(c in antes)).length;

seccion("Carrera: «Deshacer» tocado mientras «Repetir» todavía se guarda, y el servidor recibe primero el «Deshacer»");
await caso("carrera sin fila", async () => {
  const antes = planInicial();
  const n = nube(antes);
  const b = botones(n.actualizar, null);
  const rep = b.repetir();
  await Promise.resolve();
  const des = b.deshacer(rep);
  await Promise.resolve();
  ok("sin fila salen los dos guardados a la vez", n.enCamino.length === 2, n.enCamino.length);
  await n.llega(1); // el de «Deshacer» llega primero
  const r = await des;
  ok("«Deshacer» dice que quitó las 4", r?.quitadas === 4, r);
  await n.llega(0); // el de «Repetir» llega después: 409 y se vuelve a aplicar encima…
  await n.llega(0);
  await rep.listo;
  ok("…y así las copias volvían (el defecto que encontró la verificadora)", copiadasEn(n.srv.datos, antes) === 4, copiadasEn(n.srv.datos, antes));
});
await caso("carrera con fila", async () => {
  const antes = planInicial();
  const n = nube(antes);
  const fila = crearFila();
  const b = botones(n.actualizar, fila);
  const rep = b.repetir();
  ok("«Repetir» sale en el acto", n.enCamino.length === 1);
  const des = b.deshacer(rep);
  for (let i = 0; i < 10; i++) await Promise.resolve();
  ok("con fila, «Deshacer» espera: sigue habiendo un solo guardado en camino", n.enCamino.length === 1, n.enCamino.length);
  ok("la fila está ocupada (el aviso dice «Quitando las comidas copiadas…»)", fila.ocupada());
  await n.llega(0);
  ok("terminado «Repetir», sale el «Deshacer»", n.enCamino.length === 1);
  await n.llega(0);
  const r = await des;
  ok("«Deshacer» quitó las 4", r?.quitadas === 4 && r.cambiadas === 0, r);
  igualJSON("en la nube quedó como antes de repetir", n.srv.datos, antes);
  igualJSON("y en el equipo también", n.local(), antes);
});
await caso("al revés: «Repetir» otra vez mientras «Deshacer» se guarda", async () => {
  const antes = planInicial();
  const n = nube(antes);
  const fila = crearFila();
  const b = botones(n.actualizar, fila);
  const rep = b.repetir();
  await n.llega(0);
  await rep.listo;
  const des = b.deshacer(rep);
  ok("«Deshacer» sale en el acto (la fila estaba libre)", n.enCamino.length === 1);
  const rep2 = b.repetir();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  ok("el segundo «Repetir» espera", n.enCamino.length === 1);
  await n.llega(0);
  await des;
  await n.llega(0);
  const c2 = await rep2.listo;
  ok("el segundo «Repetir» copió las 4 de nuevo", c2 !== null && Object.keys(c2).length === 4);
  ok("y quedan en la nube (lo último que tocó la mamá)", copiadasEn(n.srv.datos, antes) === 4, copiadasEn(n.srv.datos, antes));
});
await caso("conflicto con otro equipo mientras «Deshacer» espera", async () => {
  const antes = planInicial();
  const n = nube(antes);
  // Otro equipo pone el desayuno del lunes antes de que llegue el «Repetir».
  const otro = { ...antes, [k("2026-11-09", "desayuno")]: { texto: "Huevos", porciones: 4 } };
  n.srv.datos = json(otro);
  n.srv.version++;
  const fila = crearFila();
  const b = botones(n.actualizar, fila);
  const rep = b.repetir();
  const des = b.deshacer(rep);
  await n.llega(0); // 409: se vuelve a aplicar sobre lo del otro equipo (3 copias)
  await n.llega(0);
  igual("el último intento de «Repetir» copió 3", Object.keys((await rep.listo) ?? {}).length, 3);
  await n.llega(0);
  const r = await des;
  ok("«Deshacer» quita esas 3", r?.quitadas === 3 && r.cambiadas === 0, r);
  igualJSON("en la nube queda lo del otro equipo, sin copias", n.srv.datos, otro);
});
await caso("«Repetir» no se guarda: «Deshacer» no hace nada", async () => {
  const antes = planInicial();
  const n = nube(antes);
  const fila = crearFila();
  const b = botones(n.actualizar, fila);
  const rep = b.repetir();
  const des = b.deshacer(rep);
  // Cinco conflictos seguidos: actualizar se rinde (en la app, el plan vuelve a lo guardado y sale el aviso).
  for (let i = 0; i < 5; i++) {
    n.srv.version++;
    await n.llega(0);
  }
  ok("«Repetir» no quedó guardado", (await rep.listo) === null);
  ok("«Deshacer» no manda nada", (await des) === null && n.enCamino.length === 0, n.enCamino.length);
});

seccion("Nada que copiar");
await caso("vacío", () => {
  const r = repetirSemana({}, SEMANA);
  ok("0 copias y copias vacío", r.copiadas === 0 && Object.keys(r.copias).length === 0);
  const d = deshacerRepetir({ [k("2026-11-09", "cena")]: { texto: "Sopa", porciones: 4 } }, r.copias);
  ok("deshacer sin copias no quita nada", d.quitadas === 0 && Object.keys(d.plan).length === 1);
});

fin();
