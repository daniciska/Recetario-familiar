// servidor/gemini.ts: configuración (clave, modelos, simulador local, AI Gateway), errores reales de Google,
// sanear(), el cuerpo del pedido, el reinicio de la cuota y pedirReceta/probarClave contra el simulador.
// Sin red ni clave real: la "clave" es de prueba y el simulador escucha en 127.0.0.1.
//   node --experimental-transform-types --no-warnings --import ./pruebas/registrar.mjs pruebas/recetas/gemini.test.ts
import { createHash } from "node:crypto";
import {
  MODELOS_POR_OMISION,
  TIMEOUT_PEDIDO_MS,
  URL_GOOGLE,
  configGemini,
  cuerpoPedido,
  estadoGemini,
  interpretarError,
  pedirReceta,
  probarClave,
  reinicioCuota,
  sanear,
  type ConfigLista,
  type Reloj,
} from "../../servidor/gemini.ts";
import { ESQUEMA_JSON } from "../../servidor/receta-ia/esquema.ts";
import { INSTRUCCION_SISTEMA, partesGenerateContent } from "../../servidor/receta-ia/instruccion.ts";
import { simuladorGemini } from "./mock-gemini.mts";
import { cabecera } from "./audios.ts";
import { CASOS } from "./casos.ts";
import { caso, ok, seccion, terminar } from "./arnes.ts";

type O = Record<string, any>;
// Clave falsa con forma de clave de Google (para probar que nunca se filtra). No es real; se arma en partes
// para que `grep -rn` de claves pegadas por error no marque las pruebas.
const AI = "AI" + "za";
const CLAVE = `${AI}SyPRUEBA-no-es-real_0123456789abcd`;

seccion("configGemini");
{
  const c = (env: Record<string, string>) => configGemini(env) as O;
  ok("sin clave → sin_clave", c({}).motivo === "sin_clave");
  ok("clave en blanco → sin_clave", c({ GEMINI_API_KEY: "   " }).motivo === "sin_clave");
  const g = c({ GEMINI_API_KEY: ` ${CLAVE} ` });
  ok("clave normal → google, clave sin espacios", g.ok && g.via === "google" && g.base === URL_GOOGLE && g.clave === CLAVE, g.via);
  ok("modelos por omisión: 3.8 Flash y 3.5 Flash-Lite", JSON.stringify(g.modelos) === JSON.stringify(MODELOS_POR_OMISION) && MODELOS_POR_OMISION[0] === "gemini-3.8-flash");
  ok("timeout por omisión 180 s", g.timeoutMs === TIMEOUT_PEDIDO_MS && TIMEOUT_PEDIDO_MS === 180_000);
  const l = c({ GEMINI_API_KEY: "x", GEMINI_API_URL: "http://127.0.0.1:9999/" });
  ok("GEMINI_API_URL http://127.0.0.1:x → local (sin / final)", l.via === "local" && l.base === "http://127.0.0.1:9999", l);
  ok("http://localhost:8787 → local", c({ GEMINI_API_KEY: "x", GEMINI_API_URL: "http://localhost:8787" }).via === "local");
  ok("https://atacante.example se ignora → google", c({ GEMINI_API_KEY: "x", GEMINI_API_URL: "https://atacante.example/" }).base === URL_GOOGLE);
  ok("http://localhost.atacante.example se ignora", c({ GEMINI_API_KEY: "x", GEMINI_API_URL: "http://localhost.atacante.example" }).base === URL_GOOGLE);
  ok("http://127.0.0.1.nip.io se ignora", c({ GEMINI_API_KEY: "x", GEMINI_API_URL: "http://127.0.0.1.nip.io:80" }).base === URL_GOOGLE);
  ok("http://127.0.0.1/ruta se ignora", c({ GEMINI_API_KEY: "x", GEMINI_API_URL: "http://127.0.0.1:80/v1beta" }).base === URL_GOOGLE);
  ok("GOOGLE_GEMINI_BASE_URL presente → solo_ai_gateway", c({ GEMINI_API_KEY: "k-netlify", GOOGLE_GEMINI_BASE_URL: "https://gw.example/gemini" }).motivo === "solo_ai_gateway");
  ok("… aunque haya GEMINI_API_URL local", c({ GEMINI_API_KEY: "k", GOOGLE_GEMINI_BASE_URL: "https://gw.example", GEMINI_API_URL: "http://127.0.0.1:1" }).motivo === "solo_ai_gateway");
  ok("clave = NETLIFY_AI_GATEWAY_KEY → solo_ai_gateway", c({ GEMINI_API_KEY: "k-netlify", NETLIFY_AI_GATEWAY_KEY: "k-netlify" }).motivo === "solo_ai_gateway");
  ok("NETLIFY_AI_GATEWAY_KEY distinta de la clave → google", c({ GEMINI_API_KEY: "k-familia", NETLIFY_AI_GATEWAY_KEY: "k-netlify" }).via === "google");
  const gw = c({ GEMINI_API_KEY: "k", GOOGLE_GEMINI_BASE_URL: "https://gw.example/gemini/", GEMINI_USAR_AI_GATEWAY: "1" });
  ok("GEMINI_USAR_AI_GATEWAY=1 con base https → ai_gateway", gw.ok && gw.via === "ai_gateway" && gw.base === "https://gw.example/gemini", gw);
  ok("GEMINI_USAR_AI_GATEWAY=1 con base http → solo_ai_gateway", c({ GEMINI_API_KEY: "k", GOOGLE_GEMINI_BASE_URL: "http://gw.example", GEMINI_USAR_AI_GATEWAY: "1" }).motivo === "solo_ai_gateway");
  ok("GEMINI_USAR_AI_GATEWAY=si → solo_ai_gateway", c({ GEMINI_API_KEY: "k", GOOGLE_GEMINI_BASE_URL: "https://gw.example", GEMINI_USAR_AI_GATEWAY: "si" }).motivo === "solo_ai_gateway");
  const m = c({ GEMINI_API_KEY: "x", GEMINI_MODELOS: " gemini-3.5-flash-lite, Gemini-Malo ,gpt-4o, gemini-3.5-flash-lite,gemini-a,gemini-b,gemini-c,gemini-d" });
  ok("GEMINI_MODELOS: mal escritos fuera, sin repetidos, máx. 4", JSON.stringify(m.modelos) === JSON.stringify(["gemini-3.5-flash-lite", "gemini-a", "gemini-b", "gemini-c"]), m.modelos);
  ok("GEMINI_MODELOS sin nada válido → por omisión", JSON.stringify(c({ GEMINI_API_KEY: "x", GEMINI_MODELOS: "x, y; z" }).modelos) === JSON.stringify(MODELOS_POR_OMISION));
  ok("GEMINI_MODELOS con barra o espacios → fuera", JSON.stringify(c({ GEMINI_API_KEY: "x", GEMINI_MODELOS: "gemini-3.8-flash/../x,gemini 3" }).modelos) === JSON.stringify(MODELOS_POR_OMISION));
  ok("GEMINI_TIMEOUT_MS con base local → se usa", c({ GEMINI_API_KEY: "x", GEMINI_API_URL: "http://127.0.0.1:1", GEMINI_TIMEOUT_MS: "300" }).timeoutMs === 300);
  ok("GEMINI_TIMEOUT_MS fuera de 200–180.000 → 180 s", c({ GEMINI_API_KEY: "x", GEMINI_API_URL: "http://127.0.0.1:1", GEMINI_TIMEOUT_MS: "50" }).timeoutMs === TIMEOUT_PEDIDO_MS);
  ok("GEMINI_TIMEOUT_MS se ignora si la base no es local", c({ GEMINI_API_KEY: "x", GEMINI_TIMEOUT_MS: "300" }).timeoutMs === TIMEOUT_PEDIDO_MS);
  ok("estadoGemini: ok / sin_clave / solo_ai_gateway", estadoGemini({ GEMINI_API_KEY: "x" }) === "ok" && estadoGemini({}) === "sin_clave" && estadoGemini({ GEMINI_API_KEY: "x", GOOGLE_GEMINI_BASE_URL: "https://g" }) === "solo_ai_gateway");
  ok("la configuración no expone la clave al serializar estadoGemini", !JSON.stringify(estadoGemini({ GEMINI_API_KEY: CLAVE })).includes(CLAVE));
}

seccion("interpretarError con cuerpos reales");
{
  const e = (http: number, cuerpo: unknown) => interpretarError(http, cuerpo, CLAVE);
  const g = (code: number, status: string, message: string, details?: unknown[]) => ({ error: { code, message, status, ...(details ? { details } : {}) } });
  const claveMala = g(400, "INVALID_ARGUMENT", "API key not valid. Please pass a valid API key.", [
    { "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "API_KEY_INVALID", domain: "googleapis.com", metadata: { service: "generativelanguage.googleapis.com" } },
  ]);
  ok("400 API_KEY_INVALID (objeto) → clave_invalida", e(400, claveMala).codigo === "clave_invalida");
  ok("400 API_KEY_INVALID en arreglo [{error}] (Interactions) → clave_invalida", e(400, [claveMala]).codigo === "clave_invalida");
  const sinClave = g(403, "PERMISSION_DENIED", "Method doesn't allow unregistered callers (callers without established identity). Please use API Key or other form of API consumer identity to call this API.");
  ok("403 unregistered callers → clave_invalida", e(403, sinClave).codigo === "clave_invalida");
  ok("403 en arreglo → clave_invalida", e(403, [sinClave]).codigo === "clave_invalida");
  const porMinuto = e(
    429,
    g(429, "RESOURCE_EXHAUSTED", "You exceeded your current quota. Please retry in 1.2s.", [
      { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" }] },
      { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "1s" },
    ]),
  );
  ok("429 por minuto → cuota_minuto con esperaMs 1000 (RetryInfo manda)", porMinuto.codigo === "cuota_minuto" && porMinuto.esperaMs === 1000, porMinuto);
  const enTexto = e(429, g(429, "RESOURCE_EXHAUSTED", "Quota exceeded. Please retry in 7.5s."));
  ok("429 sin RetryInfo → espera del texto «retry in 7.5s»", enTexto.codigo === "cuota_minuto" && enTexto.esperaMs === 7500, enTexto);
  ok("429 sin espera → 20 s", e(429, g(429, "RESOURCE_EXHAUSTED", "Too many requests")).esperaMs === 20_000);
  ok("429 con retryDelay 300s → tope 60 s", e(429, g(429, "RESOURCE_EXHAUSTED", "x", [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "300s" }])).esperaMs === 60_000);
  const porDia = e(
    429,
    g(429, "RESOURCE_EXHAUSTED", "You exceeded your current quota. Please retry in 38.5s.", [
      { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] },
      { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "40s" },
    ]),
  );
  ok("429 PerDay → cuota_dia", porDia.codigo === "cuota_dia", porDia);
  const interactions = e(429, { error: { code: "rate_limit_exceeded", message: "Rate limit exceeded. Please retry in 3s." } });
  ok("Interactions {code:'rate_limit_exceeded'} → cuota_minuto 3 s", interactions.codigo === "cuota_minuto" && interactions.esperaMs === 3000, interactions);
  ok("503 high demand → ocupado", e(503, g(503, "UNAVAILABLE", "This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.")).codigo === "ocupado");
  ok("500 INTERNAL → ocupado", e(500, g(500, "INTERNAL", "An internal error has occurred.")).codigo === "ocupado");
  ok("504 DEADLINE_EXCEEDED → ocupado", e(504, g(504, "DEADLINE_EXCEEDED", "The request timed out.")).codigo === "ocupado");
  ok("502 sin JSON (proxy) → ocupado", e(502, null).codigo === "ocupado");
  ok("402 prepago → pago", e(402, g(402, "RESOURCE_EXHAUSTED", "Your Prepay credit balance is depleted.")).codigo === "pago");
  ok(
    "400 FAILED_PRECONDITION país → region",
    e(400, g(400, "FAILED_PRECONDITION", "Gemini API free tier is not available in your country. Please enable billing on your project in Google AI Studio.")).codigo === "region",
  );
  ok(
    "403 FREE_TIER_VERIFICATION_REQUIRED → verificacion",
    e(403, g(403, "PERMISSION_DENIED", "Project 1234 must be verified before it can use the Gemini API Free tier.", [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "FREE_TIER_VERIFICATION_REQUIRED" }])).codigo === "verificacion",
  );
  ok("403 otro → permiso", e(403, g(403, "PERMISSION_DENIED", "The caller does not have permission")).codigo === "permiso");
  ok("404 modelo → modelo", e(404, g(404, "NOT_FOUND", "models/gemini-9 is not found for API version v1beta, or is not supported for generateContent.")).codigo === "modelo");
  ok(
    "400 Unknown name responseFormat → campo",
    e(400, g(400, "INVALID_ARGUMENT", `Invalid JSON payload received. Unknown name "responseFormat" at 'generation_config': Cannot find field.`)).codigo === "campo",
  );
  ok("400 Unsupported MIME type → formato", e(400, g(400, "INVALID_ARGUMENT", "Unsupported MIME type: audio/x-caf")).codigo === "formato");
  ok("400 payload > 20 MB → grande", e(400, g(400, "INVALID_ARGUMENT", "Request payload size exceeds the limit: 20971520 bytes.")).codigo === "grande");
  ok("400 genérico → peticion", e(400, g(400, "INVALID_ARGUMENT", "Request contains an invalid argument.")).codigo === "peticion");
  ok("cuerpo raro (texto) → no lanza", e(400, "hola").codigo === "peticion" && e(500, [null]).codigo === "ocupado");
  const conClave = e(400, g(400, "INVALID_ARGUMENT", `Bad key ${CLAVE} key=${CLAVE}`));
  ok("el detalle va sin la clave", !conClave.detalle.includes(CLAVE) && !conClave.detalle.includes(AI), conClave.detalle);
}

seccion("sanear");
{
  ok("quita la clave dada", !sanear(`hola ${CLAVE} chao`, CLAVE).includes(CLAVE));
  const otra = `${AI}SyA1234567890abcdefghijklmnopqrstu`;
  ok("quita cualquier cosa con forma de clave de Google", sanear(`x ${otra} y`) === "x [clave] y", sanear(`x ${otra} y`));
  ok("quita key=…", sanear("GET /v1beta/models?key=secreto123&x=1") === "GET /v1beta/models?key=[clave]&x=1", sanear("GET /v1beta/models?key=secreto123&x=1"));
  ok("quita x-goog-api-key: …", !sanear("x-goog-api-key: secreto-largo-1234").includes("secreto"), sanear("x-goog-api-key: secreto-largo-1234"));
  ok("quita «key»: «…» en JSON", !sanear('{"key":"secreto-largo-1234"}').includes("secreto"), sanear('{"key":"secreto-largo-1234"}'));
  ok("corta a 500", sanear("a".repeat(2000)).length === 500);
  ok("no lanza con null / objetos", sanear(null) === "" && typeof sanear({ a: 1 }) === "string");
}

seccion("cuerpoPedido");
{
  const parts = partesGenerateContent([{ datos: "QUJD", mime: "audio/webm" }], { fecha: "9 de noviembre de 2026" });
  const a = cuerpoPedido(parts, "responseFormat", 16384) as O;
  const b = cuerpoPedido(parts, "responseJsonSchema", 32768) as O;
  ok("responseFormat.text {APPLICATION_JSON, schema}", a.generationConfig.responseFormat.text.mimeType === "APPLICATION_JSON" && a.generationConfig.responseFormat.text.schema === ESQUEMA_JSON);
  ok("responseFormat sin responseJsonSchema", !("responseJsonSchema" in a.generationConfig) && !("responseMimeType" in a.generationConfig));
  ok("respaldo: responseMimeType application/json + responseJsonSchema", b.generationConfig.responseMimeType === "application/json" && b.generationConfig.responseJsonSchema === ESQUEMA_JSON && !("responseFormat" in b.generationConfig));
  for (const [n, x] of [["A", a], ["B", b]] as const) {
    ok(`${n}: thinkingLevel low`, x.generationConfig.thinkingConfig.thinkingLevel === "low" && !("thinkingBudget" in x.generationConfig.thinkingConfig));
    ok(`${n}: sin temperature/topP/topK`, !/"(temperature|topP|topK)"/.test(JSON.stringify(x.generationConfig)));
    ok(`${n}: systemInstruction = INSTRUCCION_SISTEMA`, x.systemInstruction.parts[0].text === INSTRUCCION_SISTEMA);
    ok(`${n}: un turno user con texto al final`, x.contents.length === 1 && x.contents[0].role === "user" && typeof x.contents[0].parts.at(-1).text === "string");
    ok(`${n}: inlineData con el mime`, x.contents[0].parts.some((p: O) => p.inlineData?.mimeType === "audio/webm"));
    ok(`${n}: sin la clave ni ?key=`, !JSON.stringify(x).includes("key"));
  }
  ok("maxOutputTokens según el pedido", a.generationConfig.maxOutputTokens === 16384 && b.generationConfig.maxOutputTokens === 32768);
}

seccion("reinicioCuota (medianoche del Pacífico + 5 min)");
{
  const r = (iso: string) => new Date(reinicioCuota(Date.parse(iso))).toISOString();
  ok("2026-11-09T20:00Z → 2026-11-10T08:05Z", r("2026-11-09T20:00:00.000Z") === "2026-11-10T08:05:00.000Z", r("2026-11-09T20:00:00.000Z"));
  ok("2026-11-10T07:59Z (23:59 PST) → 2026-11-10T08:05Z", r("2026-11-10T07:59:00.000Z") === "2026-11-10T08:05:00.000Z", r("2026-11-10T07:59:00.000Z"));
  ok("en verano (PDT): 2026-07-01T12:00Z → 2026-07-02T07:05Z", r("2026-07-01T12:00:00.000Z") === "2026-07-02T07:05:00.000Z", r("2026-07-01T12:00:00.000Z"));
  ok("marzo 2027, el día del cambio (23 h): 2027-03-14T09:00Z → 2027-03-15T07:05Z", r("2027-03-14T09:00:00.000Z") === "2027-03-15T07:05:00.000Z", r("2027-03-14T09:00:00.000Z"));
  ok("marzo 2027, la víspera: 2027-03-13T20:00Z → 2027-03-14T08:05Z", r("2027-03-13T20:00:00.000Z") === "2027-03-14T08:05:00.000Z", r("2027-03-13T20:00:00.000Z"));
  ok("noviembre 2027, el día de 25 h: 2027-11-07T07:30Z → 2027-11-08T08:05Z", r("2027-11-07T07:30:00.000Z") === "2027-11-08T08:05:00.000Z", r("2027-11-07T07:30:00.000Z"));
  ok("siempre en el futuro y antes de 26 h", [0, 1, 2, 3, 4, 5].every((d) => {
    const t = Date.parse("2027-03-10T00:00:00Z") + d * 7_200_000 * 5;
    const x = reinicioCuota(t);
    return x > t && x - t <= 26 * 3_600_000;
  }));
}

// ---------- pedirReceta y probarClave contra el simulador ----------
const sim = await simuladorGemini({ clave: CLAVE });
let desfase = 0;
const reloj: Reloj = { ahora: () => Date.now() + desfase, dormir: async (ms) => void (desfase += ms) };
const cfg = (extra: Record<string, string> = {}) => configGemini({ GEMINI_API_KEY: CLAVE, GEMINI_API_URL: sim.url, ...extra }) as ConfigLista;
const audio = { datos: cabecera("webm", 8000, 3), mime: "audio/webm", fecha: "9 de noviembre de 2026" };
const hasta = () => reloj.ahora() + 12 * 60_000;

seccion("pedirReceta (lo básico; los casos de la corrida están en dictados.test.ts)");
await caso("camino feliz", async () => {
  sim.reiniciar();
  const r = await pedirReceta(cfg(), audio, { hasta: hasta(), reloj });
  ok("ok con 3.8 Flash en 1 pedido", r.tipo === "ok" && r.modelo === "gemini-3.8-flash" && r.pedidos === 1, r);
  ok("los datos son la respuesta del modelo", r.tipo === "ok" && JSON.stringify(r.datos) === JSON.stringify(CASOS[0].esperado));
  ok("tokens de audio leídos de usageMetadata", r.tipo === "ok" && r.tokens.audio === 64, r.tipo === "ok" ? r.tokens : r);
  const p = sim.generar()[0];
  ok("la clave fue en la cabecera, no en la URL", p.claveOk && !p.claveEnUrl);
  ok("SHA-256 del audio igual al enviado", p.sha256Audio === createHash("sha256").update(audio.datos).digest("hex"));
  ok("sin faltas en el simulador", sim.faltas.length === 0, sim.faltas);
});
await caso("respuesta con thought", async () => {
  sim.reiniciar();
  sim.guion("*", ["con_thought"]);
  const r = await pedirReceta(cfg(), audio, { hasta: hasta(), reloj });
  ok("las partes thought:true se ignoran", r.tipo === "ok" && JSON.stringify(r.datos) === JSON.stringify(CASOS[0].esperado), r);
});
await caso("se acabó el presupuesto", async () => {
  sim.reiniciar();
  const r = await pedirReceta(cfg(), audio, { hasta: reloj.ahora() + 5_000, reloj });
  ok("sin tiempo → ocupado sin pedir nada", r.tipo === "error" && r.codigo === "ocupado" && r.pedidos === 0 && sim.generar().length === 0, r);
});
await caso("Gemini no responde (plazo de la base local)", async () => {
  sim.reiniciar();
  sim.guion("*", Array.from({ length: 8 }, () => ({ lento: 600 })));
  desfase = 0;
  const r = await pedirReceta(cfg({ GEMINI_TIMEOUT_MS: "200" }), audio, { hasta: hasta(), reloj });
  ok("todo lento → ocupado reintentable con próximo", r.tipo === "error" && r.codigo === "ocupado" && r.reintentable && !!r.proximo, r);
  ok("nunca más de 8 pedidos", sim.generar().length <= 8, sim.generar().length);
});
await caso("servidor caído", async () => {
  const r = await pedirReceta(configGemini({ GEMINI_API_KEY: CLAVE, GEMINI_API_URL: "http://127.0.0.1:9" }) as ConfigLista, audio, { hasta: hasta(), reloj });
  ok("sin conexión → ocupado", r.tipo === "error" && r.codigo === "ocupado", r);
});

seccion("probarClave");
await caso("probar", async () => {
  sim.reiniciar();
  const a = await probarClave(cfg());
  ok("clave buena → ok con el primer modelo", a.ok && a.modelo === "gemini-3.8-flash", a);
  const b = await probarClave(configGemini({ GEMINI_API_KEY: "otra-clave-de-prueba", GEMINI_API_URL: sim.url }));
  ok("clave mala → clave_invalida", !b.ok && b.codigo === "clave_invalida", b);
  const c = await probarClave(configGemini({}));
  ok("sin clave → sin_clave sin pedir nada", !c.ok && c.codigo === "sin_clave");
  const d = await probarClave(cfg({ GEMINI_MODELOS: "gemini-9-nada,gemini-3.5-flash-lite" }));
  ok("primer modelo 404 → prueba el siguiente", d.ok && d.modelo === "gemini-3.5-flash-lite", d);
  const e = await probarClave(cfg({ GEMINI_MODELOS: "gemini-9-nada" }));
  ok("todos 404 → interno", !e.ok && e.codigo === "interno", e);
  ok("probar no gasta generación", sim.generar().length === 0 && sim.pedidos.every((p) => p.metodo === "GET"));
});

await terminar(() => sim.cerrar());
