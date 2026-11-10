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
  sePuedeRevisar,
  situacion,
  textoAviso,
  textoMicrofono,
  tituloDictado,
  vistaAvance,
  type Situacion,
  type SubidaVista,
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
  // Hallazgo 0: el borrador de rescate (Gemini cortó: sin ingredientes ni pasos) dice «Toca «Pedir otra versión»».
  igual("botones: borrador de rescate → Revisar y Pedir otra versión", botonesDictado(d("listo", { esReceta: true, rescate: true })), ["revisar", "otra_version"]);
  igual("botones: un listo normal no ofrece otra versión", botonesDictado(d("listo", { esReceta: true, rescate: false })), ["revisar"]);
  ok("el texto del rescate nombra el botón que aparece", TEXTOS.rescate.includes(`«${TEXTOS.otraVersion}»`), TEXTOS.rescate);
});

seccion("Aviso de Recetas");
await caso("aviso", () => {
  igual("nada → sin aviso", textoAviso(resumir([])), null);
  igual("una lista", textoAviso(resumir([d("listo")])), "🎙️ 1 lista para revisar →");
  igual("dos listas (y otras en camino)", textoAviso(resumir([d("listo"), d("listo"), d("subido")])), "🎙️ 2 listas para revisar →");
  igual("una en camino", textoAviso(resumir([d("procesando")])), "🎙️ Gemini está pasando 1 receta…");
  igual("dos en camino (cola y Gemini); la que espera la clave no se cuenta como «pasando»", textoAviso(resumir([d("subido"), d("procesando"), conError("sin_clave")])), "🎙️ Gemini está pasando 2 recetas…");
  // Hallazgo 26: lo que espera dice qué espera (no «Gemini está pasando…»).
  igual("esperando la clave (puede durar días)", textoAviso(resumir([conError("sin_clave")])), "⏳ 1 receta dictada espera que conecten Gemini (falta la clave) →");
  igual("dos esperando la clave (una con solo_ai_gateway)", textoAviso(resumir([conError("sin_clave"), conError("solo_ai_gateway")])), "⏳ 2 recetas dictadas esperan que conecten Gemini (falta la clave) →");
  const p1 = reinicioCuota(Date.parse("2026-11-09T20:00:00Z"));
  igual(
    "cuota del día: con la hora en que se pasa sola",
    textoAviso(resumir([d("error", { error: { codigo: "cuota_dia", reintentable: true, proximo: p1 }, intentos: 2 })])),
    "⏳ 1 receta dictada espera la cuota de Gemini (se pasa sola después de las 05:05) →",
  );
  igual("cuota del día sin hora", textoAviso(resumir([conError("cuota_dia")])), "⏳ 1 receta dictada espera la cuota de Gemini (se pasa sola mañana) →");
  igual("ocupado o se cortó: se reintenta sola", textoAviso(resumir([conError("ocupado"), conError("se_corto")])), "⏳ 2 recetas dictadas se reintentan solas en unos minutos →");
  ok("ningún aviso de espera dice que Gemini está pasando la receta", [conError("sin_clave"), conError("cuota_dia"), conError("ocupado")].every((x) => !/está pasando/.test(textoAviso(resumir([x])) ?? "")));
  igual("en camino va antes que las que esperan", textoAviso(resumir([conError("sin_clave"), d("subido")])), "🎙️ Gemini está pasando 1 receta…");
  igual("una necesita ayuda", textoAviso(resumir([conError("clave_invalida"), d("subido")])), "🎙️ 1 receta dictada necesita ayuda →");
  igual("dos necesitan ayuda (una no parece receta)", textoAviso(resumir([conError("formato"), d("listo", { esReceta: false })])), "🎙️ 2 recetas dictadas necesitan ayuda →");
  igual("audios en el equipo", [textoAviso(resumir([], 1)), textoAviso(resumir([d("subido")], 2))], ["📱 1 audio en este equipo sin subir →", "📱 2 audios en este equipo sin subir →"]);
  igual("resumir cuenta todo", resumir([d("listo"), conError("ocupado"), conError("bloqueado"), d("listo", { esReceta: false }), d("subido"), conError("sin_clave"), conError("cuota_dia")], 3), {
    listas: 1,
    enCamino: 1,
    reintento: 1,
    cuota: 1,
    esperando: 1,
    ayuda: 2,
    locales: 3,
  });
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

seccion("Micrófono sin permiso (iPhone y tablet Android o Fire)");
await caso("microfono", () => {
  // Hallazgo 28: en la pared (Chrome, Silk o Fully Kiosk) no sirven los pasos del iPhone.
  const android = textoMicrofono("permiso", false);
  const iphone = textoMicrofono("permiso", true);
  ok("iPhone o iPad: los pasos de Ajustes → Safari", /iPhone/.test(iphone) && /Safari → Micrófono/.test(iphone), iphone);
  ok("Android o Fire: Chrome, Silk y Fully Kiosk, sin los pasos del iPhone", /Chrome/.test(android) && /Silk/.test(android) && /Fully Kiosk/.test(android) && !/iPhone|Safari/.test(android), android);
  ok("los dos ofrecen subir un audio con 📎", /📎/.test(android) && /📎/.test(iphone));
  igual("los demás motivos", [textoMicrofono("sin_microfono", false), textoMicrofono("sin_soporte", true), textoMicrofono("otro", false)], [TEXTOS.sinMicrofono, TEXTOS.sinGrabadora, TEXTOS.micOtro]);
});

seccion("Ventana de dictar: «a salvo», «Puedes cerrar» y cuándo preguntar antes de cerrar");
await caso("avance", () => {
  const sinRed: SubidaVista = { e: "sin_conexion" };
  const lleno: SubidaVista = { e: "rechazo", motivo: "lleno", mensaje: "Hay 20 recetas dictadas sin revisar." };
  const rechazado: SubidaVista = { e: "rechazo", motivo: "rechazado", mensaje: "El audio es muy grande (máximo 4 MB)." };
  const yaGuardada: SubidaVista = { e: "rechazo", motivo: "ya_guardada", mensaje: "Ya está en Recetas." };
  const v = (enEquipo: boolean | null, subida: SubidaVista | null, dictado: DictadoPublico | null = null) => vistaAvance({ enEquipo, subida, dictado });
  // Hallazgos 10 y 21: sin copia en el equipo (IndexedDB falló) el audio sólo está en la ventana.
  for (const [n, s] of [["sin conexión", sinRed], ["lleno", lleno], ["subiendo", { e: "subiendo" }], ["rechazado", rechazado]] as [string, SubidaVista][]) {
    const x = v(false, s);
    ok(`sin copia y ${n}: cerrar pregunta, ofrece la copia y no dice «Puedes cerrar»`, x.enRiesgo && x.copia && !x.pie, x);
  }
  const sinCopiaSinRed = v(false, sinRed);
  ok("sin copia y sin conexión: no dice «a salvo en este equipo»", !!sinCopiaSinRed.sinConexion && !/a salvo|en este equipo y/.test(sinCopiaSinRed.sinConexion), sinCopiaSinRed.sinConexion);
  ok("el aviso rojo sin copia dice «No la cierres» y no «Puedes cerrar»", /No la cierres/.test(TEXTOS.sinCopiaLocal) && !/Puedes cerrar/.test(TEXTOS.sinCopiaLocal));
  ok("…y no habla de internet (también sale con «lleno»)", !/vuelva internet/.test(TEXTOS.sinCopiaLocal));
  const conCopia = v(true, sinRed);
  ok("con copia y sin conexión: «a salvo en este equipo», «Puedes cerrar» y sin preguntar", conCopia.sinConexion === TEXTOS.sinConexion && conCopia.pie && !conCopia.enRiesgo && !conCopia.copia, conCopia);
  ok("con copia y «lleno»: sigue sola (se sube cuando haya cupo)", v(true, lleno).pie && !v(true, lleno).enRiesgo);
  ok("con copia y subiendo: sigue sola", v(true, { e: "subiendo" }).pie);
  ok("todavía guardando la copia: no dice «a salvo» ni «Puedes cerrar»", !v(null, sinRed).pie && v(null, sinRed).sinConexion === TEXTOS.sinConexionSinCopia && !v(null, { e: "subiendo" }).pie);
  ok("rechazado (muy grande, formato): no sigue sola", !v(true, rechazado).pie);
  ok("ya estaba en la nube (ya_guardada): nada en riesgo", !v(false, yaGuardada).enRiesgo && !v(false, yaGuardada).pie);
  ok("sin copia pero ya en la nube: nada en riesgo", !v(false, { e: "ok" }, d("subido")).enRiesgo && v(false, { e: "ok" }, d("subido")).pie);
  // Hallazgo 25: «Puedes cerrar esta ventana: sigue sola» sólo cuando de verdad sigue sola.
  const pie = (x: DictadoPublico) => v(true, { e: "ok" }, x).pie;
  ok("en cola, escribiendo, se reintenta o esperando la clave: «sigue sola»", [d("subido"), d("procesando"), conError("cuota_dia"), conError("ocupado"), conError("sin_clave")].every(pie));
  const sinPie: [string, DictadoPublico][] = [
    ["clave inválida", conError("clave_invalida")],
    ["formato", conError("formato")],
    ["bloqueado", conError("bloqueado")],
    ["audio perdido", conError("audio_perdido")],
    ["incompleta", conError("incompleta")],
    ["ocupado demasiadas veces", conError("ocupado", { intentos: MAX_INTENTOS_SOLOS.ocupado })],
    ["no parece receta", d("listo", { esReceta: false })],
    ["lista", d("listo")],
  ];
  for (const [n, x] of sinPie) ok(`${n}: sin «Puedes cerrar…»`, !pie(x), situacion(x));
  ok("con un dictado en la nube no se repite el aviso de sin conexión", v(true, sinRed, d("subido")).sinConexion === null);
});

seccion("Revisar sólo un borrador de verdad");
await caso("revisar", () => {
  // Hallazgo 16: desde una lista vieja, el dictado fresco puede estar en cola (pidieron otra versión) sin borrador.
  const borrador = { id: "rec_x", nombre: "Pebre", emoji: "🌶️", porciones: 4, ingredientes: [], pasos: [] };
  ok("listo con borrador → se abre", sePuedeRevisar(d("listo", { borrador })));
  ok("en cola o con Gemini (otra versión pedida en otro equipo) → no", !sePuedeRevisar(d("subido")) && !sePuedeRevisar(d("procesando")));
  ok("listo sin borrador (la lista no lo trae) → no", !sePuedeRevisar(d("listo")));
  ok("con error o sin dictado → no", !sePuedeRevisar(conError("formato")) && !sePuedeRevisar(null));
});

await terminar();
