// Simulador de la API de Gemini (generativelanguage.googleapis.com) para probar sin clave real ni red.
// Escucha en 127.0.0.1. Rutas:
//   POST /v1beta/models/{m}:generateContent   valida el pedido como la API y responde según el guion
//   GET  /v1beta/models/{m}                   "probar la clave" (no gasta generación)
//
// Validaciones (lo que la API rechaza da el error real; lo que la API tolera pero el panel no debería
// mandar queda anotado en `faltas`):
//   sin x-goog-api-key → 403 PERMISSION_DENIED "unregistered callers"; clave mala → 400 API_KEY_INVALID
//   (cuerpos copiados de SP/gemini-api/prueba-host.txt); ?key= en la URL → falta; cuerpo > 20 MB → 400;
//   inlineData.mimeType fuera de los 13 documentados (+ mimesExtra) → 400 "Unsupported MIME type: x";
//   base64 inválido → 400 (y se anota el SHA-256 del audio decodificado); thinkingLevel "minimal" en
//   gemini-3.8-flash → 400; thinkingBudget junto con thinkingLevel → 400; temperature/topP/topK → falta
//   ("silently ignored"); último part del turno que no sea texto no vacío → 400; salida estructurada:
//   responseFormat.text {mimeType "APPLICATION_JSON", schema} o responseMimeType "application/json" +
//   responseJsonSchema (con `sinResponseFormat`, responseFormat da el 400 'Unknown name "responseFormat"');
//   esquema ≠ ESQUEMA_JSON o systemInstruction ≠ INSTRUCCION_SISTEMA → falta.
//
// Guion: cola de acciones por modelo ("*" = cualquiera); cada generateContent toma la primera que calce.
// Sin guion responde "ok". Acciones:
//   "ok" | {respuesta: obj}   CASOS[0].esperado (o la respuesta dada), con usageMetadata AUDIO = 32 × segundos
//   "no_receta"               CASOS 07 (es_receta false)
//   "429min" "429dia"         QuotaFailure PerMinute (retryDelay "1s") / PerDay (retryDelay "40s")
//   "503" "500" "504"         "high demand" / INTERNAL / DEADLINE_EXCEEDED
//   "clave" "verificacion" "region" "402" "404" "rechaza_mime"
//   "max_tokens"              finishReason MAX_TOKENS con el JSON cortado (empieza por la transcripción)
//   "safety" "bloqueo_prompt" finishReason SAFETY sin texto / promptFeedback.blockReason PROHIBITED_CONTENT
//   "json_malo"               JSON roto que trae la transcripción · "texto_basura": texto sin JSON
//   "con_thought"             una parte thought:true antes del JSON
//   {lento: ms, luego?}       demora la respuesta (respeta que el cliente corte)
//
// Uso en pruebas:
//   const g = await simuladorGemini({ clave: "clave-de-prueba" });  g.url, g.pedidos, g.faltas, g.guion("*", ["503"]), g.cerrar()
// Por línea de comandos (prueba en el navegador, desde calendario/):
//   node --experimental-transform-types --no-warnings --import ./pruebas/registrar.mjs pruebas/recetas/mock-gemini.mts --puerto 8787 --clave clave-de-prueba
//   POST /__guion  [{"modelo":"*","accion":"503"}, …]   ·   GET /__pedidos   ·   POST /__reiniciar
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";
import { ESQUEMA_JSON } from "../../servidor/receta-ia/esquema.ts";
import { INSTRUCCION_SISTEMA } from "../../servidor/receta-ia/instruccion.ts";
import { CASOS } from "./casos.ts";

export type Accion =
  | "ok"
  | "no_receta"
  | "429min"
  | "429dia"
  | "503"
  | "500"
  | "504"
  | "clave"
  | "verificacion"
  | "region"
  | "402"
  | "404"
  | "max_tokens"
  | "safety"
  | "bloqueo_prompt"
  | "json_malo"
  | "texto_basura"
  | "con_thought"
  | "rechaza_mime"
  | { respuesta: unknown }
  | { lento: number; luego?: Accion };

export interface Pedido {
  metodo: string;
  ruta: string;
  modelo?: string;
  claveOk: boolean;
  claveEnUrl: boolean;
  bytes: number;
  status?: number;
  mime?: string;
  sha256Audio?: string;
  bytesAudio?: number;
  maxTokens?: number;
  thinkingLevel?: string;
  forma?: "responseFormat" | "responseJsonSchema" | null;
  esquemaExacto?: boolean;
  instruccionExacta?: boolean;
  temperature?: unknown;
  ultimoTextoNoVacio?: boolean;
  contexto?: string; // texto del primer part (<contexto>…)
  accion?: string;
}

export interface OpcionesSimulador {
  clave: string;
  /** MIME que se aceptan además de los 13 documentados (p. ej. "audio/mp4"). */
  mimesExtra?: string[];
  /** Imita una API que todavía no conoce generationConfig.responseFormat. */
  sinResponseFormat?: boolean;
  /** Respuesta de "ok" (por omisión, CASOS[0].esperado). */
  respuesta?: unknown;
  puerto?: number;
}

export const MIMES_DOCUMENTADOS = [
  "audio/wav",
  "audio/mp3",
  "audio/aiff",
  "audio/aac",
  "audio/ogg",
  "audio/flac",
  "audio/mpeg",
  "audio/m4a",
  "audio/l16",
  "audio/opus",
  "audio/alaw",
  "audio/mulaw",
  "audio/webm",
];
const MODELOS = new Set(["gemini-3.8-flash", "gemini-3.5-flash-lite"]);
const NO_RECETA = CASOS.find((c) => c.id.startsWith("07"))!.esperado;

const errorGoogle = (code: number, status: string, message: string, details?: unknown[]) => ({
  error: { code, message, status, ...(details ? { details } : {}) },
});
const CUERPO_CLAVE_MALA = errorGoogle(400, "INVALID_ARGUMENT", "API key not valid. Please pass a valid API key.", [
  { "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "API_KEY_INVALID", domain: "googleapis.com", metadata: { service: "generativelanguage.googleapis.com" } },
  { "@type": "type.googleapis.com/google.rpc.LocalizedMessage", locale: "en-US", message: "API key not valid. Please pass a valid API key." },
]);
const CUERPO_SIN_CLAVE = errorGoogle(
  403,
  "PERMISSION_DENIED",
  "Method doesn't allow unregistered callers (callers without established identity). Please use API Key or other form of API consumer identity to call this API.",
);
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export async function simuladorGemini(op: OpcionesSimulador) {
  const pedidos: Pedido[] = [];
  const faltas: string[] = [];
  const cola: { modelo: string; accion: Accion }[] = [];
  const mimes = new Set([...MIMES_DOCUMENTADOS, ...(op.mimesExtra ?? [])]);
  let respuesta = op.respuesta ?? CASOS[0].esperado;
  let puerto = 0;

  const leer = (req: IncomingMessage) =>
    new Promise<Buffer>((ok, mal) => {
      const trozos: Buffer[] = [];
      req.on("data", (t: Buffer) => trozos.push(t));
      req.on("end", () => ok(Buffer.concat(trozos)));
      req.on("error", mal);
    });
  const enviar = (res: ServerResponse, p: Pedido | null, status: number, cuerpo: unknown) => {
    if (p) p.status = status;
    if (res.destroyed) return;
    res.writeHead(status, { "content-type": "application/json; charset=UTF-8" });
    res.end(JSON.stringify(cuerpo));
  };

  async function atender(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${puerto}`);
    const cuerpo = await leer(req);

    // --- Control (sólo por línea de comandos) ---
    if (url.pathname === "/__guion" && req.method === "POST") {
      const lista = JSON.parse(cuerpo.toString("utf8") || "[]") as { modelo?: string; accion: Accion }[];
      for (const g of lista) cola.push({ modelo: g.modelo ?? "*", accion: g.accion });
      return enviar(res, null, 200, { ok: true, cola: cola.length });
    }
    if (url.pathname === "/__pedidos") return enviar(res, null, 200, { pedidos, faltas, cola });
    if (url.pathname === "/__reiniciar" && req.method === "POST") {
      pedidos.length = 0;
      faltas.length = 0;
      cola.length = 0;
      return enviar(res, null, 200, { ok: true });
    }

    const clave = req.headers["x-goog-api-key"];
    const p: Pedido = {
      metodo: req.method ?? "",
      ruta: url.pathname,
      claveOk: clave === op.clave,
      claveEnUrl: url.searchParams.has("key") || url.search.includes(op.clave),
      bytes: cuerpo.length,
    };
    pedidos.push(p);
    if (p.claveEnUrl) faltas.push("la clave viajó en la URL (?key=)");
    if (!clave) return enviar(res, p, 403, CUERPO_SIN_CLAVE);
    if (!p.claveOk) return enviar(res, p, 400, CUERPO_CLAVE_MALA);

    const mm = /^\/v1beta\/models\/([^/:]+)(:generateContent)?$/.exec(url.pathname);
    if (!mm) return enviar(res, p, 404, errorGoogle(404, "NOT_FOUND", `Not found: ${url.pathname}`));
    const modelo = decodeURIComponent(mm[1]);
    p.modelo = modelo;
    if (!mm[2]) {
      if (req.method !== "GET") return enviar(res, p, 405, errorGoogle(405, "METHOD_NOT_ALLOWED", "Method not allowed"));
      return MODELOS.has(modelo)
        ? enviar(res, p, 200, { name: `models/${modelo}`, baseModelId: modelo, version: "001", inputTokenLimit: 1048576, outputTokenLimit: 65536 })
        : enviar(res, p, 404, errorGoogle(404, "NOT_FOUND", `models/${modelo} is not found for API version v1beta, or is not supported for generateContent.`));
    }
    if (req.method !== "POST") return enviar(res, p, 405, errorGoogle(405, "METHOD_NOT_ALLOWED", "Method not allowed"));
    if (cuerpo.length > 20 * 1024 * 1024) return enviar(res, p, 400, errorGoogle(400, "INVALID_ARGUMENT", "Request payload size exceeds the limit: 20971520 bytes."));
    let j: Record<string, any>;
    try {
      j = JSON.parse(cuerpo.toString("utf8"));
    } catch {
      return enviar(res, p, 400, errorGoogle(400, "INVALID_ARGUMENT", "Invalid JSON payload received."));
    }
    if (!MODELOS.has(modelo))
      return enviar(res, p, 404, errorGoogle(404, "NOT_FOUND", `models/${modelo} is not found for API version v1beta, or is not supported for generateContent.`));

    const gc = j.generationConfig ?? {};
    const turno = Array.isArray(j.contents) ? j.contents.at(-1) : undefined;
    const parts: any[] = Array.isArray(turno?.parts) ? turno.parts : [];
    const audio = parts.find((x) => x?.inlineData)?.inlineData;
    p.maxTokens = gc.maxOutputTokens;
    p.thinkingLevel = gc.thinkingConfig?.thinkingLevel;
    p.temperature = gc.temperature;
    p.contexto = typeof parts[0]?.text === "string" ? parts[0].text : undefined;
    p.ultimoTextoNoVacio = typeof parts.at(-1)?.text === "string" && parts.at(-1).text.trim().length > 0;
    p.instruccionExacta = j.systemInstruction?.parts?.[0]?.text === INSTRUCCION_SISTEMA;
    if (!p.instruccionExacta) faltas.push("la instrucción de sistema no es INSTRUCCION_SISTEMA");
    if ("temperature" in gc || "topP" in gc || "topK" in gc) faltas.push("mandó temperature/topP/topK (se ignoran desde 3.6)");
    if (turno?.role !== "user") faltas.push("el turno no es de role user");

    if (gc.responseFormat !== undefined) {
      if (op.sinResponseFormat)
        return enviar(
          res,
          p,
          400,
          errorGoogle(400, "INVALID_ARGUMENT", `Invalid JSON payload received. Unknown name "responseFormat" at 'generation_config': Cannot find field.`, [
            { "@type": "type.googleapis.com/google.rpc.BadRequest", fieldViolations: [{ field: "generation_config", description: `Invalid JSON payload received. Unknown name "responseFormat" at 'generation_config': Cannot find field.` }] },
          ]),
        );
      const t = gc.responseFormat?.text;
      p.forma = t?.mimeType === "APPLICATION_JSON" && t?.schema ? "responseFormat" : null;
      p.esquemaExacto = isDeepStrictEqual(t?.schema, ESQUEMA_JSON);
    } else if (gc.responseMimeType === "application/json" && gc.responseJsonSchema) {
      p.forma = "responseJsonSchema";
      p.esquemaExacto = isDeepStrictEqual(gc.responseJsonSchema, ESQUEMA_JSON);
    } else p.forma = null;
    if (!p.forma) faltas.push("sin salida estructurada");
    else if (!p.esquemaExacto) faltas.push("el esquema no es ESQUEMA_JSON");

    if (!p.ultimoTextoNoVacio)
      return enviar(res, p, 400, errorGoogle(400, "INVALID_ARGUMENT", "The last content of the user turn must contain non-empty text."));
    if (gc.thinkingConfig?.thinkingBudget !== undefined && gc.thinkingConfig?.thinkingLevel !== undefined)
      return enviar(res, p, 400, errorGoogle(400, "INVALID_ARGUMENT", "You can only set either thinking_budget or thinking_level, not both."));
    if (modelo === "gemini-3.8-flash" && p.thinkingLevel === "minimal")
      return enviar(res, p, 400, errorGoogle(400, "INVALID_ARGUMENT", "Thinking level minimal is not supported for this model."));
    if (!audio) return enviar(res, p, 400, errorGoogle(400, "INVALID_ARGUMENT", "Request contains an invalid argument."));
    p.mime = audio.mimeType;
    const datos = String(audio.data ?? "");
    if (!BASE64.test(datos) || datos.length % 4 !== 0)
      return enviar(res, p, 400, errorGoogle(400, "INVALID_ARGUMENT", "Invalid value at 'contents[0].parts[2].inline_data.data' (TYPE_BYTES), Base64 decoding failed."));
    const bytesAudio = Buffer.from(datos, "base64");
    p.bytesAudio = bytesAudio.length;
    p.sha256Audio = createHash("sha256").update(bytesAudio).digest("hex");
    if (!mimes.has(String(audio.mimeType))) return enviar(res, p, 400, errorGoogle(400, "INVALID_ARGUMENT", `Unsupported MIME type: ${audio.mimeType}`));

    const i = cola.findIndex((g) => g.modelo === "*" || g.modelo === modelo);
    let accion: Accion = i >= 0 ? cola.splice(i, 1)[0].accion : "ok";
    if (typeof accion === "object" && "lento" in accion) {
      await new Promise((ok) => setTimeout(ok, (accion as { lento: number }).lento));
      accion = accion.luego ?? "ok";
    }
    p.accion = typeof accion === "string" ? accion : "respuesta";
    if (res.destroyed || !res.socket || res.socket.destroyed) {
      p.status = 499;
      return; // el cliente ya cortó (plazo)
    }

    const segundos = Math.max(1, Math.round(bytesAudio.length / 4000)); // ≈ 32 kbps
    const uso = {
      promptTokenCount: 4300 + segundos * 32,
      candidatesTokenCount: 1200,
      thoughtsTokenCount: 300,
      totalTokenCount: 5800 + segundos * 32,
      promptTokensDetails: [
        { modality: "TEXT", tokenCount: 4300 },
        { modality: "AUDIO", tokenCount: segundos * 32 },
      ],
    };
    const exito = (textos: { text: string; thought?: boolean }[], finishReason = "STOP") =>
      enviar(res, p, 200, { candidates: [{ content: { role: "model", parts: textos }, finishReason, index: 0 }], usageMetadata: uso, modelVersion: modelo, responseId: `r${pedidos.length}` });
    const cuota = (porDia: boolean) =>
      enviar(
        res,
        p,
        429,
        errorGoogle(429, "RESOURCE_EXHAUSTED", `You exceeded your current quota, please check your plan and billing details. Please retry in ${porDia ? "38.5" : "1.2"}s.`, [
          {
            "@type": "type.googleapis.com/google.rpc.QuotaFailure",
            violations: [
              {
                quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests",
                quotaId: porDia ? "GenerateRequestsPerDayPerProjectPerModel-FreeTier" : "GenerateRequestsPerMinutePerProjectPerModel-FreeTier",
                quotaDimensions: { model: modelo, location: "global" },
                quotaValue: porDia ? "20" : "5",
              },
            ],
          },
          { "@type": "type.googleapis.com/google.rpc.Help", links: [{ description: "Learn more about Gemini API quotas", url: "https://ai.google.dev/gemini-api/docs/rate-limits" }] },
          { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: porDia ? "40s" : "1s" },
        ]),
      );

    if (typeof accion === "object" && "respuesta" in accion) return exito([{ text: JSON.stringify(accion.respuesta) }]);
    switch (accion) {
      case "ok":
        return exito([{ text: JSON.stringify(respuesta) }]);
      case "no_receta":
        return exito([{ text: JSON.stringify(NO_RECETA) }]);
      case "con_thought":
        return exito([{ text: "Primero transcribo el audio y después ordeno la receta…", thought: true }, { text: JSON.stringify(respuesta) }]);
      case "429min":
        return cuota(false);
      case "429dia":
        return cuota(true);
      case "503":
        return enviar(res, p, 503, errorGoogle(503, "UNAVAILABLE", "This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later."));
      case "500":
        return enviar(res, p, 500, errorGoogle(500, "INTERNAL", "An internal error has occurred. Please retry or report in https://developers.generativeai.google/guide/troubleshooting"));
      case "504":
        return enviar(res, p, 504, errorGoogle(504, "DEADLINE_EXCEEDED", "The request timed out. Please try again."));
      case "clave":
        return enviar(res, p, 400, CUERPO_CLAVE_MALA);
      case "verificacion":
        return enviar(
          res,
          p,
          403,
          errorGoogle(403, "PERMISSION_DENIED", "Project 123456789012 must be verified before it can use the Gemini API Free tier. Please verify your account in Google AI Studio.", [
            { "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "FREE_TIER_VERIFICATION_REQUIRED", domain: "googleapis.com" },
          ]),
        );
      case "region":
        return enviar(res, p, 400, errorGoogle(400, "FAILED_PRECONDITION", "Gemini API free tier is not available in your country. Please enable billing on your project in Google AI Studio."));
      case "402":
        return enviar(res, p, 402, errorGoogle(402, "RESOURCE_EXHAUSTED", "Your Prepay credit balance is depleted. Please add credits in Google AI Studio."));
      case "404":
        return enviar(res, p, 404, errorGoogle(404, "NOT_FOUND", `models/${modelo} is not found for API version v1beta, or is not supported for generateContent.`));
      case "rechaza_mime":
        return enviar(res, p, 400, errorGoogle(400, "INVALID_ARGUMENT", `Unsupported MIME type: ${audio.mimeType}`));
      case "max_tokens":
        return exito([{ text: JSON.stringify(respuesta).slice(0, 900) }], "MAX_TOKENS");
      case "safety":
        return enviar(res, p, 200, { candidates: [{ finishReason: "SAFETY", content: { parts: [] }, safetyRatings: [{ category: "HARM_CATEGORY_DANGEROUS_CONTENT", probability: "HIGH" }] }], usageMetadata: uso });
      case "bloqueo_prompt":
        return enviar(res, p, 200, { promptFeedback: { blockReason: "PROHIBITED_CONTENT" }, usageMetadata: uso });
      case "json_malo": {
        const t = JSON.stringify(respuesta);
        return exito([{ text: `${t.slice(0, t.indexOf('"es_receta"') + 15)} ¡uy!` }]);
      }
      case "texto_basura":
        return exito([{ text: "Lo siento, no puedo ayudar con eso." }]);
    }
  }

  const servidor = createServer((req, res) => {
    atender(req, res).catch((e) => {
      faltas.push(`el simulador falló: ${String(e)}`);
      if (!res.headersSent) enviar(res, null, 500, errorGoogle(500, "INTERNAL", "simulador"));
    });
  });
  await new Promise<void>((ok) => servidor.listen(op.puerto ?? 0, "127.0.0.1", ok));
  puerto = (servidor.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${puerto}`,
    pedidos,
    faltas,
    /** Agrega acciones al guion de un modelo ("*" = cualquiera). */
    guion(modelo: string, acciones: Accion[]) {
      for (const accion of acciones) cola.push({ modelo, accion });
    },
    cola,
    /** Cambia la respuesta de "ok". */
    responder(r: unknown) {
      respuesta = r;
    },
    /** Los generateContent (sin las pruebas de clave). */
    generar: () => pedidos.filter((x) => x.ruta.endsWith(":generateContent")),
    reiniciar() {
      pedidos.length = 0;
      faltas.length = 0;
      cola.length = 0;
      respuesta = op.respuesta ?? CASOS[0].esperado;
    },
    cerrar: () =>
      new Promise<void>((ok) => {
        servidor.closeAllConnections?.();
        servidor.close(() => ok());
      }),
  };
}
export type Simulador = Awaited<ReturnType<typeof simuladorGemini>>;

// ---------- Línea de comandos ----------
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (n: string) => {
    const i = process.argv.indexOf(n);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const s = await simuladorGemini({
    clave: arg("--clave") ?? "clave-de-prueba",
    puerto: Number(arg("--puerto") ?? 8787),
    mimesExtra: arg("--mimes-extra")?.split(","),
    sinResponseFormat: process.argv.includes("--sin-response-format"),
  });
  console.log(`Simulador de Gemini en ${s.url} (clave de prueba; Ctrl+C para salir)`);
}
