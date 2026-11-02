import type { EstadoApp } from "./datos/tipos";
import { hoy } from "./fechas";

/** Descarga todo como un archivo .json (se puede volver a cargar en Familia → Cargar respaldo). */
export function descargarRespaldo(estado: EstadoApp) {
  const blob = new Blob([JSON.stringify(estado, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = `calendario-familiar-${hoy()}.json`;
  enlace.click();
  URL.revokeObjectURL(url);
}
