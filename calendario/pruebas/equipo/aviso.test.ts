// Aviso de equipo sin unir a la familia: esFamiliaDeEjemplo (lib/ejemplo.ts) y la marca de «Usar sólo
// en este equipo» (lib/datos/nube.ts), que se olvida al unirse o crear la familia. Lo que se ve en
// pantalla lo prueba el navegador (ver README → Datos → Equipo sin unir).
import { EVENTOS_EJEMPLO, MIEMBROS_EJEMPLO, esFamiliaDeEjemplo, estadoEjemplo } from "@/lib/ejemplo";
import type { EstadoApp } from "@/lib/datos/tipos";
import { caso, fin, ok, seccion } from "../comidas/comun";

// localStorage en memoria (con un interruptor para que falle, como en una ventana privada vieja).
const memoria = new Map<string, string>();
let falla = false;
const revisar = () => {
  if (falla) throw new Error("QuotaExceededError");
};
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => (revisar(), memoria.get(k) ?? null),
  setItem: (k: string, v: string) => (revisar(), void memoria.set(k, String(v))),
  removeItem: (k: string) => (revisar(), void memoria.delete(k)),
};
const N = await import("@/lib/datos/nube");
const MARCA = "calendario-familiar:equipo:solo-aqui";

seccion("esFamiliaDeEjemplo");
const base = estadoEjemplo();
const con = (cambios: Partial<Pick<EstadoApp, "miembros" | "eventos">>) => ({ miembros: base.miembros, eventos: base.eventos, ...cambios });
const renombrar = (ids: string[]) => base.miembros.map((m) => (ids.includes(m.id) ? { ...m, nombre: `${m.nombre} de verdad` } : m));

await caso("ejemplo", () => {
  ok("EVENTOS_EJEMPLO son los ids de los eventos de estadoEjemplo", JSON.stringify([...EVENTOS_EJEMPLO].sort()) === JSON.stringify(base.eventos.map((e) => e.id).sort()));
  ok(
    "MIEMBROS_EJEMPLO son los integrantes de estadoEjemplo",
    JSON.stringify(Object.entries(MIEMBROS_EJEMPLO).sort()) === JSON.stringify(base.miembros.map((m) => [m.id, m.nombre]).sort()),
  );
  ok("la familia de ejemplo tal cual: sí", esFamiliaDeEjemplo(base));
  ok("un nombre cambiado (3 de 4) y los eventos: sí", esFamiliaDeEjemplo(con({ miembros: renombrar(["mie_mama"]) })));
  ok("sin Tomás (3 de 4) y los eventos: sí", esFamiliaDeEjemplo(con({ miembros: base.miembros.filter((m) => m.id !== "mie_tomi") })));
  ok("la mitad justa de los eventos: sí", esFamiliaDeEjemplo(con({ eventos: base.eventos.slice(0, EVENTOS_EJEMPLO.length / 2) })));

  ok("dos nombres cambiados (2 de 4): no", !esFamiliaDeEjemplo(con({ miembros: renombrar(["mie_mama", "mie_papa"]) })));
  ok(
    "el caso del verificador (renombraron a mamá y papá, sin Tomás, una Sofía de verdad, sin eventos): no",
    !esFamiliaDeEjemplo({ miembros: renombrar(["mie_mama", "mie_papa"]).filter((m) => m.id !== "mie_tomi"), eventos: [] }),
  );
  ok("integrantes intactos pero sin los eventos de ejemplo: no", !esFamiliaDeEjemplo(con({ eventos: [] })));
  ok("menos de la mitad de los eventos: no", !esFamiliaDeEjemplo(con({ eventos: base.eventos.slice(0, EVENTOS_EJEMPLO.length / 2 - 1) })));
  ok("los mismos nombres con otros ids: no", !esFamiliaDeEjemplo(con({ miembros: base.miembros.map((m) => ({ ...m, id: `m_${m.id}` })) })));
  ok(
    "integrantes repetidos no cuentan dos veces",
    !esFamiliaDeEjemplo(con({ miembros: [base.miembros[0], base.miembros[0], base.miembros[0], { ...base.miembros[1], nombre: "Juan" }] })),
  );
  ok("ids raros (toString, __proto__) no rompen nada", !esFamiliaDeEjemplo(con({ miembros: [{ ...base.miembros[0], id: "toString" }, { ...base.miembros[1], id: "__proto__" }] })));
  ok("sin integrantes: no", !esFamiliaDeEjemplo(con({ miembros: [] })));
});

seccion("«Usar sólo en este equipo» se olvida al unirse o crear la familia");
await caso("marca", () => {
  memoria.clear();
  ok("al principio no está oculto", N.avisoSinFamiliaOculto() === false);
  N.ocultarAvisoSinFamilia();
  ok("«Usar sólo en este equipo» lo oculta", N.avisoSinFamiliaOculto() === true && memoria.get(MARCA) === "1");
  N.anotarRecienUnido("unido");
  ok("al unirse se olvida", N.avisoSinFamiliaOculto() === false && !memoria.has(MARCA));
  ok("y queda el «Listo»", N.leerRecienUnido() === "unido");

  N.olvidarRecienUnido();
  N.ocultarAvisoSinFamilia();
  N.anotarRecienUnido("creada");
  ok("al crear la familia también se olvida", N.avisoSinFamiliaOculto() === false && N.leerRecienUnido() === "creada");

  memoria.clear();
  N.anotarRecienUnido("unido");
  ok("sin marca, unirse no deja nada raro", !memoria.has(MARCA) && N.leerRecienUnido() === "unido");

  memoria.set(MARCA, "1");
  falla = true;
  let lanzo = false;
  try {
    N.anotarRecienUnido("unido");
    N.ocultarAvisoSinFamilia();
  } catch {
    lanzo = true;
  }
  ok("sin almacenamiento no lanza (try/catch)", !lanzo);
  ok("sin almacenamiento, leer dice «no oculto»", N.avisoSinFamiliaOculto() === false);
  falla = false;
});

fin();
