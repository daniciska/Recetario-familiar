// Cada 5 minutos: sincroniza el calendario conectado de la familia (iCloud o Google Calendar): lo que se
// cambió en los iPhone llega al panel aunque nadie toque la pantalla. Las funciones programadas tienen 30 s.
// Cada cuenta del sitio (la de iCloud y la cuenta de servicio de Google) es de una sola familia: se
// recorren las familias dueñas de las cuentas que están configuradas, sin repetir, con un solo plazo.
import type { Config } from "@netlify/functions";
import { almacen, leerAcceso } from "../../servidor/comun";
import { CLAVE_DUENO_GOOGLE, proveedorConfigurado } from "../../servidor/proveedores";
import { CLAVE_DUENO_ICLOUD, sincronizar } from "../../servidor/sincronizar";

export default async () => {
  const claves = [proveedorConfigurado("icloud") ? CLAVE_DUENO_ICLOUD : null, proveedorConfigurado("google") ? CLAVE_DUENO_GOOGLE : null].filter(
    (k): k is string => !!k,
  );
  if (!claves.length) return new Response("sin cuentas de calendario");
  const store = almacen();
  const familias: string[] = [];
  for (const k of claves) {
    const dueno = (await store.get(k, { type: "json" })) as { familiaId?: unknown } | null;
    if (typeof dueno?.familiaId === "string" && !familias.includes(dueno.familiaId)) familias.push(dueno.familiaId);
  }
  if (!familias.length) return new Response("sin familia conectada");
  const limite = Date.now() + 24_000;
  const resultados = [];
  for (const familiaId of familias) {
    const acceso = await leerAcceso(familiaId);
    for (const c of acceso?.calendarios ?? []) {
      // Las conexiones guardadas antes de Google no traen otro proveedor que "icloud".
      if (!proveedorConfigurado(c.proveedor === "google" ? "google" : "icloud")) continue;
      resultados.push({ conexion: c.id, ...(await sincronizar(familiaId, c, { limite })) });
    }
  }
  console.log("calendario-programado", JSON.stringify(resultados));
  return new Response(JSON.stringify(resultados), { headers: { "content-type": "application/json" } });
};

export const config: Config = { schedule: "*/5 * * * *" };
