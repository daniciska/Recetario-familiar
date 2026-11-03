// Cada 5 minutos: sincroniza el calendario de iCloud de la familia (lo que se cambió en los iPhone
// llega al panel aunque nadie toque la pantalla). Las funciones programadas tienen 30 s.
import type { Config } from "@netlify/functions";
import { almacen, leerAcceso } from "../../servidor/comun";
import { CLAVE_DUENO_ICLOUD, credencialesICloud, sincronizar } from "../../servidor/sincronizar";

export default async () => {
  if (!credencialesICloud()) return new Response("sin cuenta de iCloud");
  const dueno = (await almacen().get(CLAVE_DUENO_ICLOUD, { type: "json" })) as { familiaId: string } | null;
  if (!dueno) return new Response("sin familia conectada");
  const acceso = await leerAcceso(dueno.familiaId);
  const limite = Date.now() + 24_000;
  const resultados = [];
  for (const c of acceso?.calendarios ?? []) resultados.push(await sincronizar(dueno.familiaId, c, { limite }));
  console.log("calendario-programado", JSON.stringify(resultados));
  return new Response(JSON.stringify(resultados), { headers: { "content-type": "application/json" } });
};

export const config: Config = { schedule: "*/5 * * * *" };
