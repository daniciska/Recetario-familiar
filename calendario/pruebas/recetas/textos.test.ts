// lib/dictados/textos.ts: un texto para cada error (con la hora de Chile), el chip y los botones de cada
// estado, el aviso de Recetas, «Probar conexión» y los textos de las pantallas.
//   node --experimental-transform-types --no-warnings --import ./pruebas/registrar.mjs pruebas/recetas/textos.test.ts
import {
  CHIPS,
  MENSAJES,
  TEXTOS,
  TEXTOS_GEMINI,
  botonesDictado,
  chip,
  chipLocal,
  conAprox,
  duracion,
  fechaDictado,
  horaChile,
  mensajeError,
  mensajeProbar,
  mmss,
  momentoCorto,
  resumir,
  situacion,
  textoAviso,
  tituloDictado,
  type Situacion,
} from "../../lib/dictados/textos.ts";
import { MAX_INTENTOS_SOLOS } from "../../lib/dictados/reglas.ts";
import { ERRORES_REINTENTABLES, esReintentable, type CodigoError, type DictadoPublico, type EstadoDictado } from "../../lib/dictados/tipos.ts";
import { reinicioCuota } from "../../servidor/gemini.ts";
import { caso, ok, seccion, terminar } from "./arnes.ts";

const igual = (n: string, a: unknown, b: unknown) => ok(n, JSON.stringify(a) === JSON.stringify(b), { obtenido: a, esperado: b });
const CODIGOS: CodigoError[] = [
  "sin_clave",
  "solo_ai_gateway",
  "clave_invalida",
  "verificacion",
  "region",
  "sin_saldo",
  "permiso",
  "cuota_dia",
  "ocupado",
  "se_corto",
  "formato",
  "bloqueado",
  "incompleta",
  "audio_perdido",
  "interno",
];
const textoBueno = (t: unknown) => typeof t === "string" && t.trim().length > 10 && !/undefined|NaN|null|\[object/.test(t) && t === t.trim();
const d = (estado: EstadoDictado, extra: Partial<DictadoPublico> = {}): DictadoPublico => ({
  id: "abcdefghijkmnopqrstuvwxy",
  estado,
  creado: "2026-11-09T17:05:00.000Z",
  actualizado: "2026-11-09T17:05:00.000Z",
  equipoId: "eq",
  mime: "audio/webm",
  bytes: 1000,
  origen: "grabacion",
  intentos: 1,
  ...extra,
});
const conError = (codigo: CodigoError, extra: Partial<DictadoPublico> = {}) => d("error", { error: { codigo, reintentable: esReintentable(codigo) }, ...extra });

seccion("Horas, fechas y duraciones (Chile)");
await caso("horas", () => {
  igual("horaChile en noviembre (UTC−3)", horaChile(Date.parse("2026-11-10T08:05:00Z")), "05:05");
  igual("horaChile en julio (UTC−4)", horaChile(Date.parse("2026-07-01T16:00:00Z")), "12:00");
  igual("horaChile a medianoche da 00 (no 24)", horaChile(Date.parse("2026-07-01T04:30:00Z")), "00:30");
  igual("horaChile de la tarde en 24 h", horaChile(Date.parse("2026-11-09T20:59:00Z")), "17:59");
  igual("duracion 154 s", duracion(154), "2:34");
  igual("duracion 15 min", duracion(900), "15:00");
  igual("duracion redondea y no baja de 0", [duracion(4.6), duracion(-3)], ["0:05", "0:00"]);
  igual("mmss para el reloj grande", [mmss(0), mmss(65.9), mmss(899)], ["00:00", "01:05", "14:59"]);
  igual("momentoCorto", momentoCorto("2026-11-09T17:05:00.000Z"), "lun 9 nov, 14:05");
  igual("momentoCorto pasada la medianoche de Chile es el día siguiente", momentoCorto("2026-11-10T03:30:00.000Z"), "mar 10 nov, 00:30");
  igual("momentoCorto de algo que no es fecha", momentoCorto("ayer"), "");
  igual("fechaDictado del mismo año", fechaDictado("2026-11-09T17:05:00.000Z", "2026-12-01"), "9 de noviembre");
  igual("fechaDictado de otro año", fechaDictado("2025-03-02T17:05:00.000Z", "2026-12-01"), "2 de marzo de 2025");
  igual("tituloDictado con nombre", tituloDictado({ nombre: " Charquicán ", archivo: "x.opus", creado: "2026-11-09T17:05:00.000Z" }), "Charquicán");
  igual("tituloDictado con archivo", tituloDictado({ archivo: "PTT-20261109-WA0001.opus", creado: "2026-11-09T17:05:00.000Z", segundos: 20 }), "PTT-20261109-WA0001.opus");
  igual("tituloDictado de una grabación", tituloDictado({ creado: "2026-11-09T17:05:00.000Z", segundos: 154 }), "Audio del lun 9 nov, 14:05 · 2:34");
  igual("tituloDictado sin duración", tituloDictado({ creado: "2026-11-09T17:05:00.000Z" }), "Audio del lun 9 nov, 14:05");
});

seccion("Un texto para cada error");
await caso("errores", () => {
  igual("MENSAJES tiene exactamente los 15 códigos", Object.keys(MENSAJES).sort(), [...CODIGOS].sort());
  for (const c of CODIGOS) {
    ok(`${c}: texto sin hora`, textoBueno(MENSAJES[c]()), MENSAJES[c]());
    ok(`${c}: texto con hora`, textoBueno(MENSAJES[c](Date.parse("2026-11-10T08:05:00Z"))), MENSAJES[c](1));
    ok(`${c}: no nombra la clave ni la muestra`, !/AI[z]a|key=/.test(MENSAJES[c]()));
  }
  const p = reinicioCuota(Date.parse("2026-11-09T20:00:00Z"));
  igual("cuota_dia: hasta la medianoche del Pacífico + 5 min, en hora de Chile", MENSAJES.cuota_dia(p), "Se usó la cuota gratis de Gemini de hoy. El audio está guardado y se procesa solo después de las 05:05.");
  igual("ocupado con hora", MENSAJES.ocupado(Date.parse("2026-11-09T17:15:00Z")), "Gemini está ocupado. Se vuelve a intentar solo cerca de las 14:15, o toca «Intentar de nuevo».");
  ok("cuota_dia y ocupado sin hora siguen siendo frases", MENSAJES.cuota_dia().endsWith("solo mañana.") && MENSAJES.ocupado().includes("en unos minutos"));
  igual(
    "sin_clave dice dónde va la clave (sin pedirla)",
    MENSAJES.sin_clave(),
    "El audio quedó guardado en la nube. Falta conectar Gemini (la clave GEMINI_API_KEY en Netlify): apenas esté, se pasa a receta solo.",
  );
  igual("audio_perdido", MENSAJES.audio_perdido(), "El audio ya no está en la nube (lo descartaron desde otro equipo).");
  igual("mensajeError de un dictado con error", mensajeError(conError("se_corto")), MENSAJES.se_corto());
  igual("mensajeError sin error", mensajeError(d("listo")), "");
  igual("los reintentables son los del plan", [...ERRORES_REINTENTABLES].sort(), ["cuota_dia", "incompleta", "interno", "ocupado", "se_corto", "sin_clave", "solo_ai_gateway"]);
});

seccion("Chip y botones de cada estado");
await caso("chips", () => {
  const casos: [string, DictadoPublico, Situacion, string][] = [
    ["subido", d("subido"), "en_cola", "⏳ En cola"],
    ["procesando", d("procesando"), "escribiendo", "🧑‍🍳 Gemini está escribiendo la receta…"],
    ["listo", d("listo", { esReceta: true }), "lista", "✅ Lista para revisar"],
    ["listo sin esReceta", d("listo"), "lista", "✅ Lista para revisar"],
    ["no parece receta", d("listo", { esReceta: false, motivo: "Es una conversación" }), "no_receta", "🤔 No parece receta"],
    ["sin_clave", conError("sin_clave"), "esperando_gemini", "⏳ Esperando a Gemini"],
    ["solo_ai_gateway", conError("solo_ai_gateway"), "esperando_gemini", "⏳ Esperando a Gemini"],
    ["cuota_dia", conError("cuota_dia", { intentos: 30 }), "se_reintenta", "⏳ Se reintenta sola"],
    ["ocupado", conError("ocupado"), "se_reintenta", "⏳ Se reintenta sola"],
    ["se_corto", conError("se_corto"), "se_reintenta", "⏳ Se reintenta sola"],
    ["ocupado demasiadas veces", conError("ocupado", { intentos: MAX_INTENTOS_SOLOS.ocupado }), "necesita_ayuda", "⚠️ Necesita ayuda"],
    ["se_corto demasiadas veces", conError("se_corto", { intentos: MAX_INTENTOS_SOLOS.se_corto }), "necesita_ayuda", "⚠️ Necesita ayuda"],
  ];
  for (const c of CODIGOS.filter((x) => !["sin_clave", "solo_ai_gateway", "cuota_dia", "ocupado", "se_corto"].includes(x)))
    casos.push([c, conError(c), "necesita_ayuda", "⚠️ Necesita ayuda"]);
  for (const [n, x, s, texto] of casos) ok(`${n} → ${texto}`, situacion(x) === s && chip(x) === texto, { situacion: situacion(x), chip: chip(x) });
  ok("error sin detalle → necesita ayuda", situacion(d("error")) === "necesita_ayuda");
  ok("todos los chips tienen texto", Object.values(CHIPS).every((t) => t.length > 3));
  igual("chip de un audio sólo en el equipo", [chipLocal({}), chipLocal({ subiendo: true }), chipLocal({ rechazo: { mensaje: "x", reintentar: false } })], [
    "📱 En este equipo, sin subir",
    "⬆️ Subiendo a la nube…",
    "⚠️ Necesita ayuda",
  ]);
  igual("botones: lista → Revisar", botonesDictado(d("listo")), ["revisar"]);
  igual("botones: no parece receta → Revisar igual, Pedir otra versión", botonesDictado(d("listo", { esReceta: false })), ["revisar_igual", "otra_version"]);
  igual("botones: con error → Intentar de nuevo", botonesDictado(conError("clave_invalida")), ["intentar"]);
  igual("botones: audio perdido → nada (sólo Descartar)", botonesDictado(conError("audio_perdido")), []);
  igual("botones: en cola o con Gemini → nada", [botonesDictado(d("subido")), botonesDictado(d("procesando"))], [[], []]);
});

seccion("Aviso de Recetas");
await caso("aviso", () => {
  igual("nada → sin aviso", textoAviso(resumir([])), null);
  igual("una lista", textoAviso(resumir([d("listo")])), "🎙️ 1 lista para revisar →");
  igual("dos listas (y otras en camino)", textoAviso(resumir([d("listo"), d("listo"), d("subido")])), "🎙️ 2 listas para revisar →");
  igual("una en camino", textoAviso(resumir([d("procesando")])), "🎙️ Gemini está pasando 1 receta…");
  igual("tres en camino (cola, Gemini, esperando clave)", textoAviso(resumir([d("subido"), d("procesando"), conError("sin_clave")])), "🎙️ Gemini está pasando 3 recetas…");
  igual("una necesita ayuda", textoAviso(resumir([conError("clave_invalida"), d("subido")])), "🎙️ 1 receta dictada necesita ayuda →");
  igual("dos necesitan ayuda (una no parece receta)", textoAviso(resumir([conError("formato"), d("listo", { esReceta: false })])), "🎙️ 2 recetas dictadas necesitan ayuda →");
  igual("audios en el equipo", [textoAviso(resumir([], 1)), textoAviso(resumir([d("subido")], 2))], ["📱 1 audio en este equipo sin subir →", "📱 2 audios en este equipo sin subir →"]);
  igual("resumir cuenta todo", resumir([d("listo"), conError("ocupado"), conError("bloqueado"), d("listo", { esReceta: false })], 3), { listas: 1, enCamino: 1, ayuda: 2, locales: 3 });
});

seccion("Probar conexión y textos de las pantallas");
await caso("pantallas", () => {
  igual("ok", mensajeProbar({ gemini: "ok", modelo: "gemini-3.8-flash" }), "✅ Conectado (gemini-3.8-flash).");
  ok("sin_clave: los 3 pasos, sin pedir la clave en el chat", mensajeProbar({ gemini: "sin_clave" }) === TEXTOS_GEMINI.faltaClave && /GEMINI_API_KEY/.test(TEXTOS_GEMINI.faltaClave) && /Nunca la pegues/.test(TEXTOS_GEMINI.faltaClave));
  igual("solo_ai_gateway", mensajeProbar({ gemini: "solo_ai_gateway" }), TEXTOS_GEMINI.soloAiGateway);
  igual("los demás usan MENSAJES", mensajeProbar({ gemini: "clave_invalida" }), MENSAJES.clave_invalida());
  const malos: string[] = [];
  for (const [k, v] of Object.entries({ ...TEXTOS, ...TEXTOS_GEMINI })) {
    const t = typeof v === "function" ? (v as (x: unknown) => string)(k === "conectado" ? "gemini-3.8-flash" : k === "guardadoEquipo" ? 154 : "un puñadito") : v;
    const lista = Array.isArray(t) ? t : [t];
    if (!lista.every((x) => typeof x === "string" && x.trim().length >= 2 && !/undefined|NaN/.test(x))) malos.push(k);
  }
  ok("todos los textos de las pantallas tienen algo", malos.length === 0, malos);
  igual("guardadoEquipo con y sin duración", [TEXTOS.guardadoEquipo(154), TEXTOS.guardadoEquipo()], ["✅ Guardado en este equipo (2:34)", "✅ Guardado en este equipo"]);
  igual("noReceta con y sin motivo", [TEXTOS.noReceta(" Es una conversación "), TEXTOS.noReceta()], [
    "🤔 Gemini no encontró una receta en este audio: «Es una conversación». Puedes revisarla igual, pedir otra versión o descartarla.",
    "🤔 Gemini no encontró una receta en este audio. Puedes revisarla igual, pedir otra versión o descartarla.",
  ]);
  igual("dijo", [TEXTOS.dijo("un puñadito"), TEXTOS.dijoDetalle("un puñadito")], ["Dijo: «un puñadito»", "dijo «un puñadito»"]);
  igual("dictadaEl", TEXTOS.dictadaEl(fechaDictado("2026-11-09T17:05:00.000Z", "2026-11-10")), "🎙️ Dictada el 9 de noviembre");
  ok("la privacidad del plan gratis se avisa", /personas de Google pueden escucharlos/.test(TEXTOS.privacidad) && /RUT/.test(TEXTOS.privacidad));
  ok("4 pasos para sacar la nota de WhatsApp", TEXTOS.whatsappPasos.length === 4);
  igual("conAprox", [conAprox("125 g", true), conAprox("125 g", false), conAprox("", true)], ["≈ 125 g", "125 g", ""]);
});

await terminar();
