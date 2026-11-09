// Cuenta de servicio de PRUEBA (nunca una clave real): genera un par RSA nuevo en cada proceso y arma
// el mismo JSON que descarga Google Cloud, en crudo y en base64, para GOOGLE_CUENTA_SERVICIO.
//
//   clavePrueba(opciones?) → ClavePrueba   (sin opciones devuelve siempre la misma, generada una vez)
//   usarClave(c, "json" | "base64")        pone GOOGLE_CUENTA_SERVICIO con esa clave
//   CORREO_PRUEBA, ID_CLAVE_PRUEBA, TOKEN_URI_TRAMPA
//
// El token_uri del JSON es una trampa ("https://ejemplo.invalid/token"): el código tiene que ignorarlo.
import { generateKeyPairSync, type KeyObject } from "node:crypto";

export const CORREO_PRUEBA = "panel@prueba.iam.gserviceaccount.com";
export const ID_CLAVE_PRUEBA = "k1";
export const TOKEN_URI_TRAMPA = "https://ejemplo.invalid/token";

export interface ClavePrueba {
  correo: string;
  idClave: string;
  privada: KeyObject;
  publica: KeyObject; // la que se registra en el simulador de token
  pem: string; // private_key (PKCS#8, con saltos de línea reales)
  archivo: Record<string, unknown>; // el JSON como objeto
  json: string; // el JSON tal cual (con sangría, como lo descarga Google Cloud)
  base64: string; // el mismo JSON en base64
}

export function armarClave(op: { correo?: string; idClave?: string; tokenUri?: string; bits?: number } = {}): ClavePrueba {
  const correo = op.correo ?? CORREO_PRUEBA;
  const idClave = op.idClave ?? ID_CLAVE_PRUEBA;
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: op.bits ?? 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  const proyecto = "prueba-panel-123456";
  const archivo = {
    type: "service_account",
    project_id: proyecto,
    private_key_id: idClave,
    private_key: pem,
    client_email: correo,
    client_id: "123456789012345678901",
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: op.tokenUri ?? TOKEN_URI_TRAMPA,
    auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
    client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${encodeURIComponent(correo)}`,
    universe_domain: "googleapis.com",
  };
  const json = JSON.stringify(archivo, null, 2);
  return { correo, idClave, privada: privateKey, publica: publicKey, pem, archivo, json, base64: Buffer.from(json).toString("base64") };
}

let comun: ClavePrueba | null = null;
/** Sin opciones: la clave de prueba de este proceso (se genera una sola vez). Con opciones: una nueva. */
export function clavePrueba(op?: Parameters<typeof armarClave>[0]): ClavePrueba {
  if (op) return armarClave(op);
  return (comun ??= armarClave());
}

/** Un JSON con campos cambiados (p. ej. otra private_key), en crudo. */
export const jsonCon = (c: ClavePrueba, cambios: Record<string, unknown>) => JSON.stringify({ ...c.archivo, ...cambios }, null, 2);

/** Pone GOOGLE_CUENTA_SERVICIO con la clave, tal cual o en base64. */
export function usarClave(c: ClavePrueba, modo: "json" | "base64" = "json"): void {
  process.env.GOOGLE_CUENTA_SERVICIO = modo === "json" ? c.json : c.base64;
}
