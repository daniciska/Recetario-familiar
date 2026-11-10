// Ayudantes de las suites de pruebas/comidas: OK / MAL por línea y salida con código 1 si hubo MAL.
import { isDeepStrictEqual } from "node:util";

let buenas = 0;
let malas = 0;

export function ok(nombre: string, cond: unknown, detalle: unknown = "") {
  if (cond) buenas++;
  else malas++;
  const d = detalle === "" ? "" : ` · ${(typeof detalle === "string" ? detalle : JSON.stringify(detalle)).slice(0, 900)}`;
  console.log(`${cond ? "OK " : "MAL"} ${nombre}${cond ? "" : d}`);
}

/** Igualdad profunda (las claves con undefined cuentan, como en la memoria de la app). */
export function igual(nombre: string, obtenido: unknown, esperado: unknown) {
  ok(nombre, isDeepStrictEqual(obtenido, esperado), { obtenido, esperado });
}

/** Igualdad de lo que queda guardado (JSON: sin las claves con undefined). */
export function igualJSON(nombre: string, obtenido: unknown, esperado: unknown) {
  ok(nombre, isDeepStrictEqual(JSON.parse(JSON.stringify(obtenido)), JSON.parse(JSON.stringify(esperado))), { obtenido, esperado });
}

export async function caso(nombre: string, fn: () => unknown | Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    ok(`${nombre} (lanzó)`, false, `${(e as Error)?.name}: ${(e as Error)?.message}\n${(e as Error)?.stack?.split("\n").slice(1, 5).join("\n")}`);
  }
}

export const seccion = (t: string) => console.log(`\n# ${t}`);

export function fin(): never {
  console.log(`\n${buenas} OK, ${malas} MAL`);
  process.exit(malas ? 1 : 0);
}

/** Copia profunda por JSON (lo que viaja a la nube o al localStorage). */
export const json = <T>(x: T): T => JSON.parse(JSON.stringify(x));
