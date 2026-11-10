// "🎙️ Dictar receta": tipos y topes que comparten el servidor (servidor/dictados.ts) y la app (lib/dictados/*).
// Sin dependencias de ejecución: el servidor lo importa con ruta relativa y la app con "@/lib/dictados/tipos".

import type { Receta } from "../datos/tipos";

// ---------- Topes ----------

/** Bytes por audio. Netlify acepta ≈ 4,5 MB binarios por pedido (6 MB en base64). */
export const MAX_AUDIO = 4_000_000;
/** 15 minutos. */
export const MAX_SEGUNDOS = 900;
/** Dictados sin guardar ni descartar por familia. */
export const MAX_PENDIENTES = 20;
/** Lo genera el equipo (subida idempotente): 24 caracteres del alfabeto de idAzar() de servidor/comun.ts. */
export const ID_DICTADO = /^[a-km-z2-9]{24}$/;
export const ALFABETO_ID = "abcdefghijkmnopqrstuvwxyz23456789";

// Grabadora del panel (lib/dictados/grabadora.ts).
export const GRABACION_MAX_SEG = 900;
export const GRABACION_AVISO_SEG = 780;
export const GRABACION_MAX_BYTES = 3_900_000;
/** Menos que esto es un toque sin querer: «La grabación quedó muy corta». */
export const GRABACION_MIN_SEG = 3;
/** Sin sonido durante esto: «No se escucha nada…». */
export const GRABACION_SILENCIO_SEG = 10;

// ---------- Estados y errores ----------

/**
 * subido: el audio está en la nube y espera a Gemini · procesando: la función en segundo plano lo tiene ·
 * listo: hay borrador para revisar (o "no parece receta") · error: ver `error.codigo`; el audio sigue guardado.
 */
export type EstadoDictado = "subido" | "procesando" | "listo" | "error";

export type CodigoError =
  | "sin_clave" // falta GEMINI_API_KEY en Netlify
  | "solo_ai_gateway" // sólo está la clave que inyecta Netlify AI Gateway (cobra créditos): no se usa sin permiso
  | "clave_invalida"
  | "verificacion" // Google pide verificar la cuenta (FREE_TIER_VERIFICATION_REQUIRED)
  | "region" // plan gratis no disponible en el país o la cuenta
  | "sin_saldo" // prepago agotado (402)
  | "permiso" // otro 403
  | "cuota_dia" // se acabó la cuota diaria de todos los modelos: se reintenta después de `proximo`
  | "ocupado" // 429 por minuto, 5xx, red o demora: se reintenta cerca de `proximo`
  | "se_corto" // la corrida no terminó dentro de su plazo
  | "formato" // Gemini no pudo leer el audio
  | "bloqueado" // filtros de seguridad de Gemini
  | "incompleta" // respuesta cortada o dañada sin nada que rescatar
  | "audio_perdido" // el audio ya no está en Blobs (lo descartaron)
  | "interno"; // error del panel (pedido mal armado, modelos mal escritos…)

/** Los que se arreglan solos o reintentando (la app vuelve a pedir `procesar`); el resto necesita a la familia. */
export const ERRORES_REINTENTABLES: readonly CodigoError[] = ["sin_clave", "solo_ai_gateway", "cuota_dia", "ocupado", "se_corto", "incompleta", "interno"];
export const esReintentable = (c: CodigoError) => ERRORES_REINTENTABLES.includes(c);

/** Lo que dicen /api/salud y GET /api/dictados de la clave de Gemini (nunca su valor). */
export type EstadoGemini = "ok" | "sin_clave" | "solo_ai_gateway";

export interface ErrorDictado {
  codigo: CodigoError;
  reintentable: boolean;
  /** epoch ms: no antes de esto (cuota_dia: medianoche del Pacífico + 5 min; ocupado: ≈ 10 min). */
  proximo?: number;
}

/** Un dictado como lo ven los equipos de la familia. */
export interface DictadoPublico {
  id: string;
  estado: EstadoDictado;
  creado: string; // ISO
  actualizado: string; // ISO
  equipoId: string; // equipo que lo subió
  mime: string; // lo que se detectó en los bytes (lo que va a Gemini)
  bytes: number;
  segundos?: number;
  archivo?: string; // nombre del archivo, si se subió uno
  origen: "grabacion" | "archivo";
  intentos: number; // corridas de Gemini
  modelo?: string;
  ms?: number; // lo que tardó Gemini
  nombre?: string; // del borrador
  emoji?: string;
  esReceta?: boolean; // false: "no parece receta"
  motivo?: string; // por qué no parece receta
  error?: ErrorDictado;
  // Sólo en GET /api/dictados/:id:
  borrador?: Receta; // id "rec_<id>", con comoLoDijo/estimado/nota/dudas/dictado
  avisos?: string[]; // para la familia ("No venían las porciones: quedó en 4.")
  revisar?: Record<string, string>; // id del ingrediente → por qué revisarlo
  transcripcion?: string;
}

// ---------- Respuestas de la API ----------

/**
 * Por qué PUT /api/dictados/:id respondió 409 (va en `motivo`, junto al `error` para mostrar), para que el
 * equipo sepa qué hacer con su copia del audio: "ya_guardada" → la nube ya lo tiene y la receta está en
 * Recetas (la copia sobra); "lleno" → hay MAX_PENDIENTES sin revisar (se reintenta cuando haya cupo);
 * "otro_audio" → ese id ya es de otro audio (no se reintenta).
 */
export type MotivoRechazo = "ya_guardada" | "lleno" | "otro_audio";

/** GET /api/dictados */
export interface ListaDictados {
  dictados: DictadoPublico[]; // del más nuevo al más viejo, sin borrador, avisos, revisar ni transcripción
  gemini: EstadoGemini;
}

/** GET /api/dictados/:id/texto */
export interface TextoDictado {
  transcripcion: string;
  modelo?: string;
  fecha: string; // ISO: cuándo se subió el audio
  segundos?: number;
  recetaId?: string;
}

/** POST /api/dictados/probar */
export type RespuestaProbar = { gemini: "ok"; modelo: string } | { gemini: Exclude<CodigoError, "se_corto" | "audio_perdido"> };

/** GET /api/salud */
export interface Salud {
  blobs: boolean;
  gemini: EstadoGemini;
}
