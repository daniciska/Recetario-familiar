// Proveedores de calendario conectado: iCloud (CalDAV, servidor/caldav.ts) y Google Calendar (API v3 con
// una cuenta de servicio, servidor/google/transporte.ts). El motor (servidor/sincronizar.ts) sólo conoce
// el contrato `Transporte`: recursos .ics con su etag, escrituras condicionales y avisos opcionales.
//
// API:
//   interface Transporte
//   credencialesICloud()                         Apple ID y contraseña de app (ICLOUD_USUARIO, ICLOUD_CLAVE_APP)
//   CLAVE_DUENO_GOOGLE                           blob con la familia que usa la cuenta de servicio del sitio
//   nombreProveedor(p)                           "Google Calendar" | "iCloud" (para los textos)
//   proveedorConfigurado(p)                      ¿están las credenciales del servidor?
//   textoSinCuenta(p)                            el error SIN_CUENTA para la familia
//   transporteDe(conexion, espera, hasta)        el transporte de esa conexión, o null si falta la credencial
//
// servidor/google/* nunca importa servidor/sincronizar.ts (así no hay ciclos).

import { CalDAV, URL_ICLOUD } from "./caldav";
import { cuentaGoogle } from "./google/cuenta";
import { GoogleCalendar, baseApiGoogle } from "./google/transporte";
import type { ConexionCalendario } from "./comun";

export interface Transporte {
  ctag(url: string): Promise<string | null>;
  listar(url: string): Promise<{ ctag: string | null; recursos: Map<string, string> }>;
  traer(url: string, hrefs: string[], margen?: number): Promise<{ leidos: { href: string; etag: string; ics: string }[]; completo: boolean }>;
  existe(url: string, nombre: string): Promise<boolean>;
  crear(url: string, nombre: string, ics: string): Promise<{ href: string; etag: string | null } | "existe">;
  actualizar(url: string, href: string, ics: string, etag: string): Promise<{ etag: string | null } | "conflicto" | "noExiste">;
  borrar(url: string, href: string, etag: string): Promise<"ok" | "conflicto" | "noExiste">;
  /** Avisos para la familia acumulados en esta vuelta (se vacían al leerlos). */
  avisos?(): string[];
  /**
   * Al final de la vuelta, con el tiempo que quede: lo que el calendario dejó para después (Google: los
   * días de una serie que no alcanzaron a seguir un cambio). true si queda trabajo para la vuelta siguiente.
   * Nunca lanza un ErrorCalDAV. (CalDAV no lo tiene.)
   */
  pendientes?(url: string): Promise<boolean>;
}

type Proveedor = ConexionCalendario["proveedor"];

/** Apple ID y contraseña de app del panel (variables de entorno del sitio, nunca en el repositorio). */
export function credencialesICloud(): { usuario: string; clave: string; base: string } | null {
  const usuario = process.env.ICLOUD_USUARIO?.trim();
  const clave = process.env.ICLOUD_CLAVE_APP?.replace(/\s+/g, "");
  if (!usuario || !clave) return null;
  // ICLOUD_CALDAV_URL sólo sirve para probar con un servidor CalDAV local.
  return { usuario, clave, base: process.env.ICLOUD_CALDAV_URL?.trim() || URL_ICLOUD };
}

/** Qué familia usa la cuenta de servicio de Google del sitio (sólo puede ser una). */
export const CLAVE_DUENO_GOOGLE = "externos/google";

export const nombreProveedor = (p: Proveedor): string => (p === "google" ? "Google Calendar" : "iCloud");

/** ¿El servidor tiene la credencial de ese proveedor (y se puede leer)? */
export function proveedorConfigurado(p: Proveedor): boolean {
  if (p === "google") {
    const g = cuentaGoogle();
    return !!g && "cuenta" in g;
  }
  return !!credencialesICloud();
}

/** El texto para la familia cuando falta la credencial del proveedor (código SIN_CUENTA). */
export function textoSinCuenta(p: Proveedor): string {
  if (p === "google") {
    const g = cuentaGoogle();
    if (g && "problema" in g) return `La clave de Google del servidor (GOOGLE_CUENTA_SERVICIO) no se pudo leer: ${g.problema}.`;
    return "Falta configurar la cuenta de servicio de Google en el servidor (GOOGLE_CUENTA_SERVICIO).";
  }
  return "Falta configurar la cuenta de iCloud en el servidor (ICLOUD_USUARIO e ICLOUD_CLAVE_APP).";
}

/**
 * El transporte de una conexión, o null si falta la credencial. Las conexiones guardadas antes de
 * Google no traen otro proveedor que "icloud": todo lo que no es "google" es iCloud.
 * @param espera máximo por pedido (ms)
 * @param hasta  plazo total (Date.now())
 */
export function transporteDe(c: ConexionCalendario, espera: number, hasta: number): Transporte | null {
  if (c.proveedor === "google") {
    const g = cuentaGoogle();
    return g && "cuenta" in g ? new GoogleCalendar(g.cuenta, baseApiGoogle(), espera, hasta) : null;
  }
  const cred = credencialesICloud();
  return cred ? new CalDAV(cred.usuario, cred.clave, cred.base, espera, hasta) : null;
}
