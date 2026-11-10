// Compatibilidad del menú por espacios con lo guardado antes y con los equipos que siguen con la
// versión anterior (la tablet de la pared puede tardar en recargar).
//
// Formato: `plan["fecha|tipo"]` sigue siendo la comida, con el primer espacio en `recetaId`/`texto`
// (lo único que entiende la versión anterior) y los demás en `mas`. El normalizar viejo descarta
// `mas` y las comidas con el primer espacio vacío, y la app vieja guarda el plan entero: sin ayuda,
// un equipo viejo que cambia cualquier cosa del menú borraría los demás espacios de todas las comidas.
// La ayuda va en el servidor (PUT /api/datos/plan sin `esquema` ≥ 2 → conservarItemsPlan); estas
// pruebas lo demuestran con la función, con el servidor simulado sobre las piezas reales de
// servidor/comun.ts (Blobs en memoria, versiones y 409) y, cuando ya esté conectado, con
// netlify/functions/api-datos.mts de verdad.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { reiniciarBlobs } from "@netlify/blobs";
import * as C from "@/servidor/comun";
import { conservarItemsPlan, itemsDe, ponerItem, ponerComida, quitarRecetaDelPlan } from "@/lib/comidas";
import { normalizarGuardado } from "@/lib/datos/normalizar";
import { estadoEjemplo } from "@/lib/ejemplo";
import type { PlanComidas } from "@/lib/datos/tipos";
import { asignarViejo, borrarRecetaVieja, guardarPorcionesViejo, planViejo, repetirSemanaVieja, type PlanViejo } from "./viejo";
import { caso, fin, igual, igualJSON, json, ok, seccion } from "./comun";

const ajustes = estadoEjemplo().ajustes;
const planNuevo = (x: unknown): PlanComidas => normalizarGuardado({ plan: x }, ajustes).plan;
const SEMANA = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];

/** Lo que hay en la nube, escrito por un equipo con la versión nueva. */
const GUARDADO: PlanComidas = {
  // Varios espacios, el primero lleno.
  "2026-11-09|almuerzo": { recetaId: "rec_charquican", porciones: 4, mas: [null, { texto: "Ensalada de tomate" }, { texto: "Fruta" }] },
  "2026-11-09|colacion": { texto: "Manzana", porciones: 2, mas: [{ texto: "Mandarina" }, { texto: "Galletas" }] },
  // Primer espacio vacío: la versión anterior no la ve.
  "2026-11-10|cena": { porciones: 4, mas: [{ texto: "Arroz" }, { texto: "Ensalada" }] },
  // Como antes: un solo ítem.
  "2026-11-11|almuerzo": { recetaId: "rec_cazuela", porciones: 4 },
  // Semana pasada, para "Repetir semana".
  "2026-11-02|almuerzo": { recetaId: "rec_pastel", porciones: 6, mas: [null, { texto: "Ensalada chilena" }] },
};

/** Todos los ítems de todas las comidas, como texto, para comparar qué se perdió. */
function todosLosItems(p: PlanComidas): string[] {
  const r: string[] = [];
  for (const [k, c] of Object.entries(p))
    for (const [i, x] of [c, ...(c.mas ?? [])].entries()) if (x && (x.recetaId || x.texto)) r.push(`${k}#${i}=${x.recetaId ?? x.texto}`);
  return r.sort();
}

// ---------------------------------------------------------------------------------------------
seccion("1. Lo guardado hoy (un ítem por comida) se ve en el primer espacio");
await caso("datos de hoy", () => {
  const hoy = { "2026-11-11|almuerzo": { recetaId: "rec_cazuela", porciones: 4 }, "2026-11-12|colacion": { texto: "Fruta", porciones: 2 } };
  const p = planNuevo(hoy);
  igual("almuerzo: la receta en Proteína (primer espacio)", itemsDe(p["2026-11-11|almuerzo"], "almuerzo"), [{ recetaId: "rec_cazuela" }, null, null, null]);
  igual("colación: el texto en el primero de 3", itemsDe(p["2026-11-12|colacion"], "colacion"), [{ texto: "Fruta" }, null, null]);
  // Un equipo nuevo cambia otra comida: las de antes quedan escritas igual que antes (sin "mas").
  const tras = ponerItem(p, "2026-11-13|cena", "cena", 1, { texto: "Puré" }, 4);
  igualJSON("al cambiar otra comida, lo de antes se guarda igual que antes", { a: tras["2026-11-11|almuerzo"], b: tras["2026-11-12|colacion"] }, { a: hoy["2026-11-11|almuerzo"], b: hoy["2026-11-12|colacion"] });
  igualJSON("una comida nueva de un solo ítem se guarda con el formato de antes", ponerItem({}, "k", "once", 0, { texto: "Té" }, 4).k, { texto: "Té", porciones: 4 });
});

// ---------------------------------------------------------------------------------------------
seccion("2. Qué ve un equipo con la versión anterior");
await caso("ve el primer espacio", () => {
  const v = planViejo(json(GUARDADO));
  igual("ve el primer espacio de cada comida", v["2026-11-09|almuerzo"], { recetaId: "rec_charquican", texto: undefined, porciones: 4 });
  igual("la colación, con su primer ítem", v["2026-11-09|colacion"], { recetaId: undefined, texto: "Manzana", porciones: 2 });
  ok("no ve la comida que tiene vacío el primer espacio", !("2026-11-10|cena" in v));
  ok("ni los demás espacios (su normalizar descarta mas)", Object.values(v).every((c) => !("mas" in c)));
});

await caso("sin protección", () => {
  // Lo que guardaría hoy un equipo viejo al cambiar UNA comida (la app vieja guarda el plan entero).
  const v = planViejo(json(GUARDADO));
  const guardaria = asignarViejo(v, "2026-11-12|once", { texto: "Pan con palta", porciones: 4 });
  const perdidos = todosLosItems(GUARDADO).filter((x) => !todosLosItems(planNuevo(json(guardaria))).includes(x));
  ok(
    "sin la protección del servidor, el equipo viejo borraría todos los espacios 2.º en adelante (por eso hace falta)",
    perdidos.length === 7,
    perdidos,
  );
});

// ---------------------------------------------------------------------------------------------
seccion("3. conservarItemsPlan: lo que hace el servidor con lo que manda un equipo viejo");

/** Lo que queda en la nube si un equipo viejo, partiendo de GUARDADO, hace `op` y el servidor lo protege. */
const conProteccion = (op: (v: PlanViejo) => PlanViejo): PlanComidas => {
  const v = planViejo(json(GUARDADO));
  return planNuevo(json(conservarItemsPlan(json(GUARDADO), json(op(v)))));
};

await caso("cada cosa que hace un equipo viejo", () => {
  const nada = conProteccion((v) => v);
  igualJSON("guardar sin cambios (o cambiar otra cosa): queda todo igual", nada, planNuevo(json(GUARDADO)));

  const otra = conProteccion((v) => asignarViejo(v, "2026-11-12|once", { texto: "Pan con palta", porciones: 4 }));
  igualJSON("poner una comida nueva: se agrega y no se pierde nada", { ...otra }, { ...planNuevo(json(GUARDADO)), "2026-11-12|once": { texto: "Pan con palta", porciones: 4 } });

  const cambia = conProteccion((v) => asignarViejo(v, "2026-11-09|almuerzo", { recetaId: "rec_porotos", porciones: 4 }));
  igualJSON("cambiar el plato (primer espacio): cambia sólo ése", cambia["2026-11-09|almuerzo"], {
    recetaId: "rec_porotos",
    porciones: 4,
    mas: [null, { texto: "Ensalada de tomate" }, { texto: "Fruta" }],
  });

  const porciones = conProteccion((v) => guardarPorcionesViejo(v, "2026-11-09|colacion", 3));
  igualJSON("«Guardar porciones»: cambian las de toda la comida", porciones["2026-11-09|colacion"], { texto: "Manzana", porciones: 3, mas: [{ texto: "Mandarina" }, { texto: "Galletas" }] });

  const quita = conProteccion((v) => asignarViejo(v, "2026-11-09|almuerzo", null));
  igualJSON("«Quitar» (lo único que ve es el primero): se vacía el primero, el resto queda", quita["2026-11-09|almuerzo"], {
    porciones: 4,
    mas: [null, { texto: "Ensalada de tomate" }, { texto: "Fruta" }],
  });

  const invisible = conProteccion((v) => asignarViejo(v, "2026-11-10|cena", { texto: "Sopa", porciones: 4 }));
  igualJSON("llenar una comida que veía vacía (primer espacio vacío): se agrega al primero", invisible["2026-11-10|cena"], {
    texto: "Sopa",
    porciones: 4,
    mas: [{ texto: "Arroz" }, { texto: "Ensalada" }],
  });
  igualJSON("la comida que no ve sigue ahí si no la toca", nada["2026-11-10|cena"], GUARDADO["2026-11-10|cena"]);

  const repite = conProteccion((v) => repetirSemanaVieja(v, SEMANA));
  ok("«Repetir semana»: no se pierde nada", todosLosItems(GUARDADO).every((x) => todosLosItems(repite).includes(x)), todosLosItems(repite));
  igualJSON("…y la semana copiada trae lo que el equipo viejo ve (el primer espacio)", repite["2026-11-09|almuerzo"], GUARDADO["2026-11-09|almuerzo"]);

  const borra = conProteccion((v) => borrarRecetaVieja(v, "rec_charquican"));
  igualJSON("borrar una receta: sale del primer espacio y el resto queda", borra["2026-11-09|almuerzo"], {
    porciones: 4,
    mas: [null, { texto: "Ensalada de tomate" }, { texto: "Fruta" }],
  });
  igual("…y borrarla en un equipo nuevo la saca de todos los espacios", quitarRecetaDelPlan(planNuevo(json(GUARDADO)), "rec_charquican")["2026-11-09|almuerzo"], {
    porciones: 4,
    mas: [null, { texto: "Ensalada de tomate" }, { texto: "Fruta" }],
  });
});

await caso("bordes", () => {
  const prev = json(GUARDADO);
  const entr = json(planViejo(json(GUARDADO)));
  const copiaPrev = json(prev);
  const copiaEntr = json(entr);
  conservarItemsPlan(prev, entr);
  ok("no cambia lo que recibe", JSON.stringify(prev) === JSON.stringify(copiaPrev) && JSON.stringify(entr) === JSON.stringify(copiaEntr));
  const sinMas = { "2026-11-11|almuerzo": { recetaId: "rec_cazuela", porciones: 4 } };
  igual("si lo guardado no tiene espacios extra, devuelve lo que llegó (contenido igual)", conservarItemsPlan(sinMas, {}), {});
  for (const [n, p, e] of [
    ["previo null", null, { a: 1 }],
    ["previo lista", [], { a: 1 }],
    ["entrante null", GUARDADO, null],
    ["entrante texto", GUARDADO, "x"],
    ["entrante lista", GUARDADO, [1]],
  ] as [string, unknown, unknown][])
    ok(`${n}: devuelve el entrante tal cual`, conservarItemsPlan(p, e) === e);
  const raro = conservarItemsPlan({ k: { porciones: 4, mas: [5, "x", { texto: " " }] }, j: "dañado" }, {});
  igual("mas sin ningún ítem lleno o comidas dañadas: no repone nada", raro, {});
  const nuevoYaTrae = conservarItemsPlan(prev, { "2026-11-09|almuerzo": { recetaId: "x", porciones: 4, mas: [{ texto: "Otra" }] } }) as PlanComidas;
  igual("si lo que llega ya trae mas, no se toca", nuevoYaTrae["2026-11-09|almuerzo"].mas, [{ texto: "Otra" }]);
});

await caso("al azar", () => {
  // 400 cambios seguidos de equipos viejos y nuevos (semilla fija). Lo que un equipo viejo no ve
  // (espacios 2.º en adelante) nunca se pierde por su culpa, y su cambio en el primer espacio queda.
  let semilla = 20261110;
  const azar = (n: number) => {
    semilla = (semilla * 1103515245 + 12345) % 2 ** 31;
    return semilla % n;
  };
  const claves = ["2026-11-09|almuerzo", "2026-11-09|cena", "2026-11-10|colacion", "2026-11-10|desayuno", "2026-11-11|once"];
  const tipoDe = (k: string) => k.split("|")[1] as "almuerzo";
  const item = () => (azar(4) === 0 ? null : azar(2) ? { recetaId: `rec_${azar(3)}` } : { texto: `t${azar(5)}` });
  let nube: PlanComidas = planNuevo(json(GUARDADO));
  let fallas = 0;
  let viejos = 0;
  for (let i = 0; i < 400; i++) {
    const k = claves[azar(claves.length)];
    if (azar(2)) {
      nube = planNuevo(json(ponerItem(nube, k, tipoDe(k), azar(4), item(), 1 + azar(6))));
      continue;
    }
    viejos++;
    const antes = todosLosItems(nube).filter((x) => !x.includes("#0="));
    const v = planViejo(json(nube));
    const op = azar(4);
    const it = item();
    const despues =
      op === 0
        ? asignarViejo(v, k, it ? { ...it, porciones: 4 } : null)
        : op === 1 && v[k]
          ? guardarPorcionesViejo(v, k, 1 + azar(8))
          : op === 2
            ? borrarRecetaVieja(v, `rec_${azar(3)}`)
            : repetirSemanaVieja(v, SEMANA);
    nube = planNuevo(json(conservarItemsPlan(json(nube), json(despues))));
    const ahora = todosLosItems(nube);
    if (!antes.every((x) => ahora.includes(x))) fallas++;
    if (op === 0 && (it ? nube[k]?.[it.recetaId ? "recetaId" : "texto"] !== (it.recetaId ?? it.texto) : nube[k]?.recetaId || nube[k]?.texto)) fallas++;
  }
  ok(`${viejos} cambios de equipos viejos entre cambios de equipos nuevos: nunca se pierde un espacio y su cambio queda`, fallas === 0 && viejos > 100, { fallas, viejos });
});

// ---------------------------------------------------------------------------------------------
seccion("4. Con el servidor simulado (servidor/comun.ts real, Blobs en memoria, versiones y 409)");

/**
 * Lo que se propone para netlify/functions/api-datos.mts, PUT /api/datos/:clave (ver «pendientes»):
 * antes de guardarColeccion, si es el plan y el equipo no manda esquema ≥ 2, reponer los espacios.
 */
async function putServidor(fam: string, clave: "plan", body: { datos: unknown; versionBase?: number; esquema?: number }) {
  if (clave === "plan" && !(Number(body.esquema) >= 2)) {
    const previa = await C.leerColeccion(fam, "plan");
    if (previa && previa.version === Number(body.versionBase ?? 0)) body.datos = conservarItemsPlan(previa.datos, body.datos);
  }
  const r = await C.guardarColeccion(fam, clave, body.datos, Number(body.versionBase ?? 0));
  if (!r.ok) return { status: 409, datos: { conflicto: true, datos: r.actual.datos, version: r.actual.version } };
  return { status: 200, datos: { version: r.version } as { version: number; datos?: unknown } };
}

type Put = (body: { datos: unknown; versionBase: number; esquema?: number }) => Promise<{ status: number; datos: { version: number; datos?: unknown } }>;
type Get = () => Promise<{ datos: unknown; version: number }>;

/**
 * Un equipo como la app de verdad: guarda la colección entera con su versión y, si otro guardó antes
 * (409), toma lo último, lo normaliza con SU normalizar y vuelve a aplicar el cambio (lib/store.tsx).
 */
function equipo(viejo: boolean, put: Put, get: Get) {
  const normalizar = (x: unknown) => (viejo ? planViejo(x) : planNuevo(x)) as PlanComidas;
  let plan: PlanComidas = {};
  let version = 0;
  return {
    async cargar() {
      const c = await get();
      plan = normalizar(json(c.datos));
      version = c.version;
    },
    get plan() {
      return plan;
    },
    async cambiar(fn: (p: PlanComidas) => PlanComidas) {
      for (let intento = 0; intento < 5; intento++) {
        const valor = fn(plan);
        const r = await put({ datos: json(valor), versionBase: version, ...(viejo ? {} : { esquema: 2 }) });
        if (r.status === 200) {
          plan = valor;
          version = r.datos.version;
          return true;
        }
        plan = normalizar(json(r.datos.datos));
        version = r.datos.version;
      }
      return false;
    },
  };
}

await caso("servidor simulado", async () => {
  reiniciarBlobs();
  const fam = "fsimulada";
  await C.almacen().setJSON(`datos/${fam}/plan`, { datos: json(GUARDADO), version: 1 });
  const estados: number[] = [];
  const put: Put = async (b) => {
    const r = await putServidor(fam, "plan", b);
    estados.push(r.status);
    return r;
  };
  const get: Get = async () => (await C.leerColeccion(fam, "plan"))!;
  const nube = async () => planNuevo((await get()).datos);

  const viejo = equipo(true, put, get);
  const nuevo = equipo(false, put, get);
  await viejo.cargar();
  await nuevo.cargar();

  ok("el equipo viejo guarda un cambio", await viejo.cambiar((p) => asignarViejo(p as PlanViejo, "2026-11-12|once", { texto: "Pan con palta", porciones: 4 })));
  const tras1 = await nube();
  ok("no se perdió ningún espacio", todosLosItems(GUARDADO).every((x) => todosLosItems(tras1).includes(x)), todosLosItems(tras1));
  igual("y quedó el cambio", tras1["2026-11-12|once"], { recetaId: undefined, texto: "Pan con palta", porciones: 4 });

  // El nuevo parte de la versión 1: choca (409), toma lo último y vuelve a aplicar su cambio encima.
  ok("el equipo nuevo llena un espacio (con choque de versión)", await nuevo.cambiar((p) => ponerItem(p, "2026-11-09|almuerzo", "almuerzo", 1, { texto: "Puré" }, 4)));
  igual("…chocó una vez y lo volvió a aplicar", estados.slice(-2), [409, 200]);
  const tras2 = await nube();
  igualJSON("quedaron los dos cambios", { a: tras2["2026-11-09|almuerzo"], b: tras2["2026-11-12|once"] }, {
    a: { recetaId: "rec_charquican", porciones: 4, mas: [{ texto: "Puré" }, { texto: "Ensalada de tomate" }, { texto: "Fruta" }] },
    b: { texto: "Pan con palta", porciones: 4 },
  });

  // Ahora el viejo está atrasado: su guardado choca, vuelve a leer (sin los espacios) y repite. El
  // servidor repone desde la versión de la que partió el reintento.
  ok("el equipo viejo, atrasado, cambia el plato principal (con choque)", await viejo.cambiar((p) => asignarViejo(p as PlanViejo, "2026-11-09|almuerzo", { recetaId: "rec_porotos", porciones: 4 })));
  igual("…chocó una vez y lo volvió a aplicar", estados.slice(-2), [409, 200]);
  const tras3 = await nube();
  igualJSON("cambió el primer espacio y los demás (incluido el «Puré» recién puesto) siguen", tras3["2026-11-09|almuerzo"], {
    recetaId: "rec_porotos",
    porciones: 4,
    mas: [{ texto: "Puré" }, { texto: "Ensalada de tomate" }, { texto: "Fruta" }],
  });
  ok("el resto sigue completo", ["2026-11-09|colacion", "2026-11-10|cena", "2026-11-02|almuerzo"].every((k) => JSON.stringify(tras3[k]) === JSON.stringify(planNuevo(json(GUARDADO))[k])));

  // Un equipo nuevo SÍ puede vaciar espacios a propósito: el servidor no se los repone.
  await nuevo.cargar();
  ok("el equipo nuevo vacía el postre", await nuevo.cambiar((p) => ponerItem(p, "2026-11-09|almuerzo", "almuerzo", 3, null, 4)));
  igualJSON("…y queda vacío (esquema 2: sin reponer)", (await nube())["2026-11-09|almuerzo"].mas, [{ texto: "Puré" }, { texto: "Ensalada de tomate" }]);
  ok("el equipo nuevo quita una comida entera", await nuevo.cambiar((p) => ponerComida(p, "2026-11-10|cena", null)));
  ok("…y queda quitada", !("2026-11-10|cena" in (await nube())));
});

// ---------------------------------------------------------------------------------------------
seccion("5. Con netlify/functions/api-datos.mts de verdad");
// API_DATOS_MTS (sólo para verificar esta sección con una copia del handler) cambia qué archivo se prueba.
const rutaApi = process.env.API_DATOS_MTS ? new URL(`file://${process.env.API_DATOS_MTS}`) : new URL("../../netlify/functions/api-datos.mts", import.meta.url);
const fuente = readFileSync(rutaApi, "utf8");
if (!fuente.includes("conservarItemsPlan")) {
  console.log(
    "PENDIENTE api-datos.mts todavía no repone los espacios del plan para equipos viejos (y repositorioNube.ts no manda esquema: 2). " +
      "Cuando se conecte (ver pendientes), esta sección lo prueba con el handler real.",
  );
} else {
  await caso("handler real", async () => {
    reiniciarBlobs();
    const fam = "fhandler";
    await C.almacen().setJSON(`acceso/${fam}`, {
      familia: { id: fam, nombre: "Familia de prueba" },
      equipos: { pared: { nombre: "Pared", huella: createHash("sha256").update("s1").digest("hex"), creado: new Date().toISOString() } },
      versiones: {},
    });
    await C.almacen().setJSON(`datos/${fam}/plan`, { datos: json(GUARDADO), version: 1 });
    const handler = (await import(rutaApi.href)).default as unknown as (req: Request, ctx: unknown) => Promise<Response>;
    const pedir = async (metodo: "GET" | "PUT", cuerpo?: unknown) => {
      const r = await handler(
        new Request(`http://localhost/api/datos${metodo === "PUT" ? "/plan" : "?claves=plan"}`, {
          method: metodo,
          headers: { authorization: `Bearer ${fam}.pared.s1`, "content-type": "application/json" },
          body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
        }),
        { params: metodo === "PUT" ? { clave: "plan" } : {} },
      );
      return { status: r.status, datos: (await r.json()) as any };
    };
    const estados: number[] = [];
    const put: Put = async (b) => {
      const r = await pedir("PUT", b);
      estados.push(r.status);
      return r;
    };
    const get: Get = async () => (await pedir("GET")).datos.colecciones.plan;
    const nube = async () => planNuevo((await get()).datos);
    const viejo = equipo(true, put, get);
    const nuevo = equipo(false, put, get);
    await viejo.cargar();
    await nuevo.cargar();
    ok("handler: el equipo viejo guarda", await viejo.cambiar((p) => asignarViejo(p as PlanViejo, "2026-11-09|almuerzo", { recetaId: "rec_porotos", porciones: 4 })));
    const t1 = await nube();
    ok("handler: no se perdió ningún espacio 2.º en adelante", todosLosItems(GUARDADO).filter((x) => !x.endsWith("#0=rec_charquican")).every((x) => todosLosItems(t1).includes(x)), todosLosItems(t1));
    ok("handler: cambió el primer espacio", t1["2026-11-09|almuerzo"].recetaId === "rec_porotos");
    ok("handler: el equipo nuevo (esquema 2, con choque) vacía el postre", await nuevo.cambiar((p) => ponerItem(p, "2026-11-09|almuerzo", "almuerzo", 3, null, 4)));
    igual("handler: los pedidos (el nuevo chocó una vez)", estados, [200, 409, 200]);
    igualJSON("handler: queda vacío", (await nube())["2026-11-09|almuerzo"], { recetaId: "rec_porotos", porciones: 4, mas: [null, { texto: "Ensalada de tomate" }] });
  });
}

fin();
