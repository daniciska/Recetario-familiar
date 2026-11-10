// Piezas comunes de las suites de pruebas/recetas/: resultados OK/MAL y el resumen final.
//   import { ok, seccion, caso, info, terminar } from "./arnes.ts";
//   ok("nombre", condición, detalle?)   imprime "OK …" o "MAL … · detalle"
//   await caso("nombre", async () => …) si lanza, cuenta como MAL (con la pila) y sigue
//   info("texto")                       línea "·   texto" (ni OK ni MAL)
//   await terminar(antes?)              corre `antes` (cerrar simuladores), imprime el resumen y sale (1 si hubo MAL)

let buenas = 0;
let malas = 0;

export function ok(nombre: string, cond: unknown, detalle: unknown = ""): boolean {
  if (cond) buenas++;
  else malas++;
  const d = detalle === "" ? "" : ` · ${(typeof detalle === "string" ? detalle : JSON.stringify(detalle) ?? String(detalle)).slice(0, 900)}`;
  console.log(`${cond ? "OK " : "MAL"} ${nombre}${cond ? "" : d}`);
  return !!cond;
}

export const seccion = (t: string) => console.log(`\n# ${t}`);
export const info = (t: string) => console.log(`·   ${t}`);
export const cuantas = () => ({ buenas, malas });

export async function caso(nombre: string, fn: () => Promise<void> | void) {
  try {
    await fn();
  } catch (e) {
    const x = e as Error;
    ok(`${nombre} (lanzó)`, false, `${x?.name}: ${x?.message}\n${x?.stack?.split("\n").slice(1, 6).join("\n")}`);
  }
}

export async function terminar(antes?: () => Promise<unknown> | unknown): Promise<never> {
  try {
    await antes?.();
  } catch (e) {
    ok("cerrar al final (lanzó)", false, String(e));
  }
  console.log(`— ${buenas} OK, ${malas} MAL`);
  process.exit(malas ? 1 : 0);
}
