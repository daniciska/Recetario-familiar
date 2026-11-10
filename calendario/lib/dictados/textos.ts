// Textos de «🎙️ Dictar receta» (español de Chile, tuteo) y cómo se muestra cada dictado: el chip de la
// lista, el aviso de Recetas, los mensajes de cada error y los textos de las pantallas. Todo puro (sin
// React ni red): lo prueba pruebas/recetas/textos.test.ts.

import { ahoraEnSantiago, diaSemana, DIAS_CORTOS, MESES, partes } from "../fechas";
import { MAX_INTENTOS_SOLOS } from "./reglas";
import type { CodigoError, DictadoPublico, RespuestaProbar } from "./tipos";

// ---------- Fechas y duraciones ----------

/** "14:05" en Chile (24 h). */
export const horaChile = (ms: number) => ahoraEnSantiago(new Date(ms)).hora;

/** "2:34" (minutos sin cero adelante); "15:00". */
export function duracion(segundos: number): string {
  const s = Math.max(0, Math.round(segundos));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "02:34": el reloj grande mientras se graba. */
export function mmss(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** "lun 9 nov, 14:05" (hora de Chile). */
export function momentoCorto(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const a = ahoraEnSantiago(new Date(t));
  const { mes, dia } = partes(a.fecha);
  return `${DIAS_CORTOS[diaSemana(a.fecha)].toLowerCase()} ${dia} ${MESES[mes - 1].slice(0, 3)}, ${a.hora}`;
}

/** "9 de noviembre" (o "9 de noviembre de 2025" si no es de este año). `hoy`: AAAA-MM-DD de Chile. */
export function fechaDictado(iso: string, hoy = ahoraEnSantiago().fecha): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const f = ahoraEnSantiago(new Date(t)).fecha;
  const { anio, mes, dia } = partes(f);
  return `${dia} de ${MESES[mes - 1]}${anio === partes(hoy).anio ? "" : ` de ${anio}`}`;
}

/** Cómo se llama un dictado en la lista: el nombre de la receta, o «Audio del lun 9 nov, 14:05 · 2:34», o el archivo. */
export function tituloDictado(d: { nombre?: string; archivo?: string; creado: string; segundos?: number }): string {
  if (d.nombre?.trim()) return d.nombre.trim();
  if (d.archivo?.trim()) return d.archivo.trim();
  const largo = d.segundos ? ` · ${duracion(d.segundos)}` : "";
  return `Audio del ${momentoCorto(d.creado)}${largo}`;
}

// ---------- Errores ----------

const despuesDe = (proximo?: number) => (proximo ? `después de las ${horaChile(proximo)}` : "mañana");
const cercaDe = (proximo?: number) => (proximo ? `cerca de las ${horaChile(proximo)}` : "en unos minutos");

/** Lo que se le dice a la familia por cada error (con la hora de Chile cuando hay `proximo`). */
export const MENSAJES: Record<CodigoError, (proximo?: number) => string> = {
  sin_clave: () =>
    "El audio quedó guardado en la nube. Falta conectar Gemini (la clave GEMINI_API_KEY en Netlify): apenas esté, se pasa a receta solo.",
  solo_ai_gateway: () =>
    "El audio quedó guardado. Netlify ofrece su propia IA, pero cobra créditos y el panel no la usa sin permiso: falta poner la clave de Gemini de la familia en Netlify.",
  clave_invalida: () =>
    "La clave de Gemini no sirve (mal copiada, borrada o bloqueada por Google). Crea otra en aistudio.google.com → Get API key y cámbiala en Netlify. El audio sigue guardado.",
  verificacion: () =>
    "Google pide verificar la cuenta con un teléfono antes de usar el plan gratis. Entra a aistudio.google.com con la cuenta de la clave y sigue los pasos. El audio sigue guardado.",
  region: () => "Google no ofrece el plan gratis de Gemini para esta cuenta o país. Hay que activar la facturación en AI Studio. El audio sigue guardado.",
  sin_saldo: () => "Se acabó el saldo prepagado de Gemini. Hay que cargar saldo en AI Studio. El audio sigue guardado.",
  permiso: () => "Google no dejó usar Gemini con esta clave (permiso denegado). Revisa la cuenta en aistudio.google.com. El audio sigue guardado.",
  cuota_dia: (p) => `Se usó la cuota gratis de Gemini de hoy. El audio está guardado y se procesa solo ${despuesDe(p)}.`,
  ocupado: (p) => `Gemini está ocupado. Se vuelve a intentar solo ${cercaDe(p)}, o toca «Intentar de nuevo».`,
  se_corto: () => "Se cortó mientras Gemini escuchaba. El audio quedó guardado: toca «Intentar de nuevo».",
  formato: () => "Gemini no pudo leer este audio. Grábalo de nuevo o compártelo en otro formato (m4a o mp3).",
  bloqueado: () => "Gemini no quiso procesar este audio. Puedes intentar de nuevo o escribir la receta a mano.",
  incompleta: () => "La respuesta de Gemini llegó incompleta. Toca «Intentar de nuevo»; si vuelve a pasar, dicta la receta en dos audios más cortos.",
  audio_perdido: () => "El audio ya no está en la nube (lo descartaron desde otro equipo).",
  interno: () => "Algo falló en el panel al pedir la receta. El audio sigue guardado: toca «Intentar de nuevo».",
};

/** El mensaje del error de un dictado (o "" si no tiene). */
export const mensajeError = (d: Pick<DictadoPublico, "error">) => (d.error ? MENSAJES[d.error.codigo](d.error.proximo) : "");

// ---------- Situación de cada dictado (chip, aviso y botones) ----------

export type Situacion =
  | "en_cola" // subido: espera a Gemini
  | "escribiendo" // procesando
  | "lista" // listo para revisar
  | "no_receta" // listo, pero Gemini dice que no parece receta
  | "se_reintenta" // cuota_dia, ocupado, se_corto: la app lo vuelve a pedir sola (hasta MAX_INTENTOS_SOLOS)
  | "esperando_gemini" // sin_clave, solo_ai_gateway: falta la clave en Netlify
  | "necesita_ayuda"; // lo demás: la familia tiene que hacer algo

export function situacion(d: Pick<DictadoPublico, "estado" | "esReceta" | "error" | "intentos">): Situacion {
  if (d.estado === "subido") return "en_cola";
  if (d.estado === "procesando") return "escribiendo";
  if (d.estado === "listo") return d.esReceta === false ? "no_receta" : "lista";
  const c = d.error?.codigo;
  if (c === "sin_clave" || c === "solo_ai_gateway") return "esperando_gemini";
  if (c === "cuota_dia") return "se_reintenta";
  if ((c === "ocupado" || c === "se_corto") && d.intentos < MAX_INTENTOS_SOLOS[c]) return "se_reintenta";
  return "necesita_ayuda";
}

export const CHIPS: Record<Situacion, string> = {
  en_cola: "⏳ En cola",
  escribiendo: "🧑‍🍳 Gemini está escribiendo la receta…",
  lista: "✅ Lista para revisar",
  no_receta: "🤔 No parece receta",
  se_reintenta: "⏳ Se reintenta sola",
  esperando_gemini: "⏳ Esperando a Gemini",
  necesita_ayuda: "⚠️ Necesita ayuda",
};

export const chip = (d: Pick<DictadoPublico, "estado" | "esReceta" | "error" | "intentos">) => CHIPS[situacion(d)];

/** Chip de un audio que todavía está sólo en este equipo. */
export const chipLocal = (p: { subiendo?: boolean; rechazo?: unknown }) =>
  p.subiendo ? "⬆️ Subiendo a la nube…" : p.rechazo ? CHIPS.necesita_ayuda : "📱 En este equipo, sin subir";

/** Qué botones lleva la fila de un dictado en «🎙️ Dictadas» (▶️ y 🗑 Descartar van siempre). */
export function botonesDictado(d: Pick<DictadoPublico, "estado" | "esReceta" | "error" | "intentos">): ("revisar" | "revisar_igual" | "otra_version" | "intentar")[] {
  const s = situacion(d);
  if (s === "lista") return ["revisar"];
  if (s === "no_receta") return ["revisar_igual", "otra_version"];
  if (d.estado === "error" && d.error?.codigo !== "audio_perdido") return ["intentar"];
  return [];
}

export interface ResumenDictados {
  listas: number; // para revisar
  enCamino: number; // en cola, escribiendo, se reintenta o esperando a Gemini
  ayuda: number; // necesitan a alguien (o «no parece receta»)
  locales: number; // audios en este equipo sin subir
}

export function resumir(dictados: Pick<DictadoPublico, "estado" | "esReceta" | "error" | "intentos">[], locales = 0): ResumenDictados {
  const r: ResumenDictados = { listas: 0, enCamino: 0, ayuda: 0, locales };
  for (const d of dictados) {
    const s = situacion(d);
    if (s === "lista") r.listas++;
    else if (s === "no_receta" || s === "necesita_ayuda") r.ayuda++;
    else r.enCamino++;
  }
  return r;
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** El botón ancho de arriba de Recetas (null: no hay nada que mostrar). Lo más urgente primero. */
export function textoAviso(r: ResumenDictados): string | null {
  if (r.listas) return `🎙️ ${plural(r.listas, "lista", "listas")} para revisar →`;
  if (r.ayuda) return `🎙️ ${plural(r.ayuda, "receta dictada necesita", "recetas dictadas necesitan")} ayuda →`;
  if (r.locales) return `📱 ${plural(r.locales, "audio", "audios")} en este equipo sin subir →`;
  if (r.enCamino) return `🎙️ Gemini está pasando ${plural(r.enCamino, "receta", "recetas")}…`;
  return null;
}

// ---------- Ajustes: «Probar conexión» ----------

export const TEXTOS_GEMINI = {
  titulo: "🎙️ Recetas por audio (Gemini)",
  explicacion:
    "Gemini (Google) escucha las recetas dictadas y las pasa en limpio. Usa el plan gratis: Google puede guardar los audios y personas de Google pueden escucharlos.",
  probar: "Probar conexión",
  probando: "Probando…",
  conectado: (modelo: string) => `✅ Conectado (${modelo}).`,
  faltaClave:
    "Falta la clave de Gemini. 1) En aistudio.google.com → Get API key, crea una clave. 2) En Netlify → Project configuration → Environment variables, agrega GEMINI_API_KEY y marca «Contains secret values». 3) Vuelve a publicar el sitio. Nunca la pegues en un chat ni en el repositorio.",
  soloAiGateway:
    "Netlify está ofreciendo su propia IA (cobra créditos). Para usar el plan gratis de Google, pon la clave de la familia en Netlify.",
  sinRed: "No hay conexión con la nube. Revisa el wifi e inténtalo de nuevo.",
};

/** El resultado de «Probar conexión» (no gasta cuota). */
export function mensajeProbar(r: RespuestaProbar): string {
  if (r.gemini === "ok") return TEXTOS_GEMINI.conectado(r.modelo);
  if (r.gemini === "sin_clave") return TEXTOS_GEMINI.faltaClave;
  if (r.gemini === "solo_ai_gateway") return TEXTOS_GEMINI.soloAiGateway;
  return MENSAJES[r.gemini]();
}

// ---------- Pantallas ----------

/** Textos de las pantallas (§10 del plan), para que los componentes no los repitan a mano. */
export const TEXTOS = {
  // Recetas
  botonDictar: "🎙️ Dictar receta",
  botonDictarCorto: "🎙️ Dictar",
  vacio: "Todavía no hay recetas. ¿Dictas una? Toca 🎙️ Dictar receta.",
  tituloDictadas: "🎙️ Dictadas",
  // Inicio
  tituloDictar: "🎙️ Dictar receta",
  inicio:
    "Cuenta la receta como si se la explicaras a alguien en la cocina: cómo se llama, para cuántos alcanza, los ingredientes con sus cantidades (aunque sea «al ojo») y los pasos. Gemini la pasa en limpio y tú la revisas antes de guardarla.",
  empezar: "⏺ Empezar a grabar",
  subirAudio: "📎 Subir un audio",
  subirAudioLinea: "Nota de voz de WhatsApp, Notas de Voz, m4a, mp3…",
  whatsappTitulo: "¿Cómo saco una nota de voz de WhatsApp?",
  whatsappPasos: [
    "En WhatsApp, mantén apretada la nota de voz.",
    "Toca Reenviar y después Compartir (↑).",
    "Elige «Guardar en Archivos».",
    "Vuelve aquí, toca 📎 Subir un audio y búscala en Archivos.",
  ],
  privacidad:
    "🔒 Con el plan gratis de Gemini, Google puede guardar estos audios y personas de Google pueden escucharlos para mejorar sus productos. No digas datos personales (RUT, dirección, teléfonos).",
  permisoIphone: "El iPhone te va a pedir permiso para usar el micrófono. En la app de la pantalla de inicio lo pide cada vez que se abre: es normal.",
  sinNube:
    "Para dictar recetas, este equipo tiene que estar conectado a la familia: Familia → ☁️ Compartir entre equipos. Gemini escucha el audio desde la nube.",
  entendido: "Entendido",
  geminiNoConectado:
    "Gemini todavía no está conectado (falta la clave en Netlify). Puedes grabar igual: el audio queda guardado en la nube y se pasa a receta solo cuando esté la clave.",
  micDenegado:
    "No hay permiso para el micrófono. En el iPhone: Ajustes → Apps → Safari → Micrófono → Preguntar o Permitir. También puedes grabar con Notas de Voz y subirlo con 📎.",
  sinMicrofono: "No se encontró un micrófono en este equipo. Graba con Notas de Voz o WhatsApp y súbelo con 📎.",
  sinGrabadora: "Este navegador no puede grabar. Graba con Notas de Voz o WhatsApp y súbelo con 📎.",
  // Archivo
  archivoGrande: "El audio es muy grande (máximo 4 MB).",
  archivoLargo: "La nota dura más de 15 minutos. Graba una más corta.",
  // Grabando
  grabando: "🔴 Grabando",
  enPausa: "⏸ En pausa",
  maximo: "máximo 15:00",
  pausa: "⏸ Pausa",
  seguir: "▶️ Seguir",
  terminar: "⏹ Terminar",
  silencio: "No se escucha nada. ¿El micrófono está tapado o lejos?",
  quedanDos: "Quedan 2 minutos. Si falta, termina aquí y dicta el resto en otro audio.",
  maximoAlcanzado: "Se completó el máximo y la grabación se guardó.",
  interrumpida:
    "La grabación se pausó porque saliste de la app o entró una llamada. Toca ▶️ Seguir para continuar: lo grabado está a salvo.",
  confirmarTerminar: "¿Terminar la grabación? Lo grabado hasta ahora se guarda.",
  terminarYGuardar: "Terminar y guardar",
  seguirGrabando: "Seguir grabando",
  muyCorta: "La grabación quedó muy corta. Inténtalo de nuevo.",
  // Avance
  guardadoEquipo: (segundos?: number) => `✅ Guardado en este equipo${segundos ? ` (${duracion(segundos)})` : ""}`,
  subiendo: "⬆️ Subiendo a la nube…",
  guardadoNube: "✅ Guardado en la nube",
  escribiendo: "🧑‍🍳 Gemini está escribiendo la receta… (suele tardar menos de un minuto)",
  lista: "✅ ¡Lista!",
  revisarReceta: "Revisar receta",
  pieAvance: "Puedes cerrar esta ventana: sigue sola y la encuentras en Recetas → 🎙️ Dictadas.",
  sinConexion: "Sin conexión: el audio está a salvo en este equipo y se sube solo cuando vuelva internet.",
  reintentarAhora: "Reintentar ahora",
  sinCopiaLocal: "Este equipo no pudo guardar el audio. No cierres esta ventana hasta que vuelva internet.",
  guardarCopia: "📤 Guardar una copia en Archivos",
  errorTitulo: "😕 No se pudo pasar en limpio",
  loQueSeEscucho: "📝 Lo que se escuchó",
  noReceta: (motivo?: string) =>
    `🤔 Gemini no encontró una receta en este audio${motivo?.trim() ? `: «${motivo.trim()}»` : ""}. Puedes revisarla igual, pedir otra versión o descartarla.`,
  // Lista de dictados y botones
  revisar: "Revisar",
  revisarIgual: "Revisar igual",
  otraVersion: "Pedir otra versión",
  intentar: "Intentar de nuevo",
  subirAhora: "Subir ahora",
  descartar: "🗑 Descartar",
  cerrar: "Cerrar",
  confirmarDescartar: "¿Descartar este audio? Se borra el audio y lo que escribió Gemini. No se puede deshacer.",
  siDescartar: "Sí, descartar",
  no: "No",
  // Revisar el borrador
  tituloRevisar: "Revisar receta dictada",
  seguisteDondeQuedaste: "Seguiste donde quedaste.",
  recuadroRevisar:
    "Gemini la escuchó y la pasó en limpio. Revisa sobre todo lo marcado con ≈: son cantidades calculadas a partir de lo que se dijo.",
  escucharAudio: "▶️ Escuchar el audio",
  verLoQueSeDijo: "📝 Ver lo que se dijo",
  dudasTitulo: "❓ Dudas de Gemini",
  dudasAyuda: "Respóndelas corrigiendo la receta y márcalas como resueltas. Las que queden se guardan con la receta.",
  resuelta: "✓ Resuelta",
  estimada: "≈ estimada",
  notaIngrediente: "Nota (picada, opcional…)",
  dijo: (como: string) => `Dijo: «${como}»`,
  despues: "Después",
  guardarReceta: "Guardar receta",
  // Detalle y edición de una receta dictada
  porConfirmar: "❓ Por confirmar",
  dictadaEl: (fecha: string) => `🎙️ Dictada el ${fecha}`,
  escucharComo: "▶️ Escuchar cómo la dictaron",
  dijoDetalle: (como: string) => `dijo «${como}»`,
  borrarAudio: "🗑 Borrar el audio (la receta queda)",
  borrarTambienAudio: "Borrar también el audio y lo que se dijo",
  // Escuchar
  audioBorrado: "El audio ya se borró; queda lo que se dijo.",
  noReproduce: "Este equipo no puede reproducir este audio.",
  sinRed: "No hay conexión con la nube.",
  // Respaldo
  respaldo: "Los audios de las recetas dictadas y lo que se dijo quedan en la nube; no van en el respaldo.",
};

/** «≈ 125 g»: la cantidad de un ingrediente estimado lleva «≈» delante. */
export const conAprox = (texto: string, estimado?: boolean) => (estimado && texto ? `≈ ${texto}` : texto);
