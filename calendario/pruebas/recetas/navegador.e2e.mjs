// «🎙️ Dictar receta» de punta a punta en un Chrome de verdad (manual: no es *.test, correr.sh no la corre).
//
// Levanta el simulador de Gemini (mock-gemini.mts, en un puerto libre) y `netlify dev --offline` con las
// funciones reales (api-dictados, la función en segundo plano dictados-proceso-background, api-datos…) y
// Blobs local, y maneja la app ya compilada (out/) con Playwright: un tablet 1366×1024, un iPhone 390×844
// (otro equipo de la misma familia) y un equipo sin nube. El micrófono es el falso de Chromium, que toca un
// tono generado con ffmpeg. Nunca usa una clave real: GEMINI_API_KEY es "clave-de-prueba" y GEMINI_API_URL
// apunta al simulador (el código sólo acepta http://127.0.0.1 o localhost).
//
// netlify dev corre dos veces: primero SIN clave de Gemini (mensajes de «falta la clave», el audio queda
// guardado) y después CON la clave de prueba (el mismo audio se pasa a receta solo). Las familias se crean
// con CLAVE_CREACION, así no se borra nada de lo que haya en el Blobs local (.netlify/).
//
// Desde calendario/, con out/ recién compilado (comparte .next/ y out/ con quien compile a la vez):
//   npm run build && node --experimental-transform-types --no-warnings --import ./pruebas/registrar.mjs \
//     pruebas/recetas/navegador.e2e.mjs [--puerto 8900] [--capturas <carpeta>] [--salida <archivo.txt>]
// Necesita /usr/bin/google-chrome, Playwright (global) y ffmpeg. netlify-cli se toma de la caché de npx
// (NETLIFY_CLI="…" para usar otro). Imprime OK/MAL por comprobación y sale con 1 si hubo algún MAL.

import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CASOS } from "./casos.ts";
import { simuladorGemini } from "./mock-gemini.mts";

const arg = (n, def) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : def;
};
const PUERTO = Number(arg("--puerto", "8900"));
const CAPTURAS = arg("--capturas", mkdtempSync(join(tmpdir(), "dictar-capturas-")));
const SALIDA = arg("--salida", join(CAPTURAS, "salida.txt"));
const NETLIFY = (process.env.NETLIFY_CLI ?? "npx --offline -y netlify-cli@27.16.3").split(" ");
const CHROME = "/usr/bin/google-chrome";
const URL_APP = `http://localhost:${PUERTO}`;
const CLAVE = "clave-de-prueba"; // falsa: la del simulador
const CLAVE_CREACION = `e2e-${Date.now().toString(36)}`;
mkdirSync(CAPTURAS, { recursive: true });
writeFileSync(SALIDA, `navegador.e2e.mjs · ${new Date().toISOString()}\n`);

// ---------- Resultados ----------
let buenas = 0;
let malas = 0;
const linea = (t) => {
  console.log(t);
  appendFileSync(SALIDA, t + "\n");
};
const ok = (n, c, d) => {
  if (c) buenas++;
  else malas++;
  linea(`${c ? "OK " : "MAL"} ${n}${!c && d !== undefined ? " · " + String(typeof d === "string" ? d : JSON.stringify(d)).replace(/\s+/g, " ").slice(0, 400) : ""}`);
};
const info = (t) => linea(`· ${t}`);
const seccion = (t) => linea(`\n## ${t}`);
async function caso(nombre, fn) {
  try {
    await fn();
  } catch (e) {
    malas++;
    linea(`MAL ${nombre}: excepción · ${String(e?.message ?? e).split("\n").slice(0, 3).join(" ").slice(0, 400)}`);
  }
}
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(CHROME)) {
  linea("MAL sin /usr/bin/google-chrome: no se puede probar en el navegador");
  process.exit(1);
}
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

// ---------- Audios ----------
const dirAudios = mkdtempSync(join(tmpdir(), "dictar-audios-"));
const ff = (...a) => execFileSync("ffmpeg", ["-v", "error", "-y", ...a]);
const VOZ = join(dirAudios, "voz.wav");
const OPUS = join(dirAudios, "PTT-20261109-WA0001.opus");
ff("-f", "lavfi", "-i", "sine=frequency=300:duration=120", "-ar", "48000", "-ac", "1", VOZ);
ff("-f", "lavfi", "-i", "sine=frequency=330:duration=20", "-ac", "1", "-c:a", "libopus", "-b:a", "16k", "-application", "voip", "-f", "ogg", OPUS);

// ---------- Simulador de Gemini y netlify dev ----------
const sim = await simuladorGemini({ clave: CLAVE });
info(`simulador de Gemini en ${sim.url}`);
const caso_ = (n) => CASOS.find((c) => c.id.startsWith(n)).esperado;
const PEBRE = caso_("05"), POSTRE = caso_("03"), CALZONES = caso_("10"), TALLARINES = caso_("06"), PASTEL = caso_("01");

let dev = null;
let logDev = "";
async function levantar(conClave) {
  const env = { ...process.env, NODE_OPTIONS: "", BROWSER: "none", CLAVE_CREACION, GEMINI_API_URL: sim.url, GEMINI_TIMEOUT_MS: "20000" };
  for (const k of ["GEMINI_API_KEY", "GEMINI_MODELOS", "GEMINI_USAR_AI_GATEWAY", "GOOGLE_GEMINI_BASE_URL", "NETLIFY_AI_GATEWAY_KEY", "GOOGLE_API_KEY", "GOOGLE_VERTEX_BASE_URL"])
    delete env[k];
  if (conClave) env.GEMINI_API_KEY = CLAVE;
  dev = spawn(
    NETLIFY[0],
    [...NETLIFY.slice(1), "dev", "--offline", "--dir", "out", "--functions", "netlify/functions", "--port", String(PUERTO), "--functions-port", String(PUERTO + 1), "--no-open", "--skip-gitignore"],
    { env, detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  const anotar = (b) => {
    logDev += b.toString();
    appendFileSync(join(CAPTURAS, "netlify-dev.log"), b);
  };
  dev.stdout.on("data", anotar);
  dev.stderr.on("data", anotar);
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${URL_APP}/api/salud`);
      if (r.status === 200 || r.status === 503) return (await r.json()).gemini;
    } catch {
      /* todavía no */
    }
    await dormir(1000);
  }
  throw new Error("netlify dev no respondió en 2 minutos");
}
async function bajar() {
  if (!dev) return;
  try {
    process.kill(-dev.pid, "SIGTERM");
  } catch {
    /* ya terminó */
  }
  await Promise.race([new Promise((r) => dev.once("exit", r)), dormir(8000)]);
  try {
    process.kill(-dev.pid, "SIGKILL");
  } catch {
    /* ya terminó */
  }
  dev = null;
  await dormir(1000);
}
process.on("exit", () => {
  try {
    if (dev) process.kill(-dev.pid, "SIGKILL");
  } catch {
    /* nada */
  }
});

const api = async (ruta, { token, metodo = "GET", cuerpo, cabeceras = {} } = {}) => {
  const r = await fetch(URL_APP + ruta, {
    method: metodo,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(cuerpo !== undefined ? { "content-type": "application/json" } : {}), ...cabeceras },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  return r;
};

// ---------- Navegador ----------
const navegador = await chromium.launch({
  executablePath: CHROME,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${VOZ}`, "--autoplay-policy=no-user-gesture-required"],
});
const errores = [];
const DIAS = Array.from({ length: 16 }, (_, i) => new Date(Date.now() + (i - 8) * 864e5).toISOString().slice(0, 10));
async function contexto(nombre, op, sesion) {
  const c = await navegador.newContext({ locale: "es-CL", timezoneId: "America/Santiago", permissions: ["microphone"], ...op });
  // El clima (api.open-meteo.com) no se alcanza desde aquí: se responde algo fijo.
  await c.route("**/api.open-meteo.com/**", (r) =>
    r.fulfill({
      json: {
        current: { temperature_2m: 22, weather_code: 1 },
        daily: { time: DIAS, weather_code: DIAS.map(() => 2), temperature_2m_max: DIAS.map(() => 27), temperature_2m_min: DIAS.map(() => 11), precipitation_probability_max: DIAS.map(() => 10) },
      },
    }),
  );
  if (sesion)
    await c.addInitScript((s) => {
      if (!localStorage.getItem("calendario-familiar:nube")) localStorage.setItem("calendario-familiar:nube", s);
    }, JSON.stringify(sesion));
  const p = await c.newPage();
  p.on("pageerror", (e) => errores.push(`${nombre}: ${e.message}`));
  p.on("console", (m) => m.type() === "error" && !/open-meteo|Failed to load resource/.test(m.text()) && errores.push(`${nombre} consola: ${m.text()}`));
  return { c, p };
}
const TABLET = { viewport: { width: 1366, height: 1024 } };
const IPHONE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
};
const foto = async (p, nombre) => {
  await dormir(450); // que termine la animación de la ventana
  await p.screenshot({ path: join(CAPTURAS, `${nombre}.png`) });
};
const dialogo = (p) => p.locator("[role=dialog]").last();
const ver = async (loc, ms = 10_000) => {
  try {
    await loc.first().waitFor({ state: "visible", timeout: ms });
    return true;
  } catch {
    return false;
  }
};
/** Espera a que `loc` deje de verse (o no esté). */
const oculto = async (loc, ms = 10_000) => {
  try {
    await loc.first().waitFor({ state: "hidden", timeout: ms });
    return true;
  } catch {
    return false;
  }
};
const texto = async (loc) => (await loc.innerText().catch(() => "")).replace(/\s+/g, " ");
async function abrir(p, hash) {
  await p.goto(`${URL_APP}/${hash}`, { waitUntil: "domcontentloaded" });
  await p.locator("main").first().waitFor({ timeout: 20_000 });
  await dormir(800);
}
const botonDictar = (p) => p.getByRole("button", { name: /🎙️ Dictar/ }).first();
const aviso = (p) => p.locator("section > button.bg-acento-suave").first();
async function grabar(p, segundos) {
  const d = dialogo(p);
  await d.getByRole("button", { name: "⏺ Empezar a grabar" }).click();
  await d.getByText("🔴 Grabando").waitFor({ timeout: 10_000 });
  await dormir(segundos * 1000);
}
const terminar = (p) => dialogo(p).getByRole("button", { name: "⏹ Terminar" }).click();
const cerrarDialogo = (p) => dialogo(p).getByRole("button", { name: "Cerrar" }).first().click();
const listaDictados = async (token) => (await (await api("/api/dictados", { token })).json()).dictados ?? [];
const generados = () => sim.generar();
/** La fila (div.grid) del ingrediente que se llama `nombre` en el editor abierto. */
async function filaIngrediente(e, nombre) {
  const entradas = e.locator('input[aria-label="Ingrediente"]');
  const n = await entradas.count();
  for (let i = 0; i < n; i++) if ((await entradas.nth(i).inputValue()) === nombre) return entradas.nth(i).locator("xpath=..");
  throw new Error(`no está el ingrediente ${nombre}`);
}
async function hasta(fn, ms = 8000) {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await dormir(400)) if (await fn()) return true;
  return false;
}

let tablet, iphone, familia;
try {
  seccion("Preparación");
  const g0 = await levantar(false);
  ok("netlify dev sin clave: /api/salud dice sin_clave", g0 === "sin_clave", g0);
  const rf = await api("/api/familia", { metodo: "POST", cuerpo: { nombre: "Familia E2E", nombreEquipo: "Tablet" }, cabeceras: { "x-clave-creacion": CLAVE_CREACION } });
  familia = await rf.json();
  ok("familia creada (api-familia real)", rf.status === 201 && !!familia.token, familia);
  const inv = await (await api("/api/invitar", { metodo: "POST", token: familia.token })).json();
  const unido = await (await api("/api/unirse", { metodo: "POST", cuerpo: { codigo: inv.codigo, nombreEquipo: "iPhone" } })).json();
  ok("el iPhone se une con un código", !!unido.token, unido);
  const sesionTablet = { token: familia.token, equipoId: familia.equipoId, familia: familia.familia };
  const sesionIphone = { token: unido.token, equipoId: unido.equipoId, familia: unido.familia };

  // ---------------------------------------------------------------------------------------------
  seccion("Sin nube y sin clave de Gemini");
  await caso("sin nube", async () => {
    const { c, p } = await contexto("sin-nube", TABLET);
    await abrir(p, "#recetas");
    await botonDictar(p).click();
    const ok1 = await ver(dialogo(p).getByText(/tiene que estar conectado a la familia/));
    await foto(p, "tablet-01-sin-nube");
    ok("sin nube: el botón explica cómo conectar", ok1, await texto(dialogo(p)));
    await dialogo(p).getByRole("button", { name: "Entendido" }).click();
    await c.close();
  });

  tablet = await contexto("tablet", TABLET, sesionTablet);
  await caso("con nube y sin clave", async () => {
    const p = tablet.p;
    // Colores claros para las capturas (de noche el tema automático pasa a oscuro); va a toda la familia.
    await abrir(p, "#ajustes");
    await p.getByRole("button", { name: "☀️ Claro" }).click();
    await dormir(800);
    await abrir(p, "#recetas");
    await ver(p.getByText("Charquicán"), 20_000);
    ok("recetas de ejemplo cargadas en la familia nueva", await ver(p.getByText("Charquicán"), 1000));
    const btn = await texto(botonDictar(p));
    ok("botón «🎙️ Dictar receta» en el tablet", btn.includes("🎙️ Dictar receta"), btn);
    await foto(p, "tablet-02-recetas");
    await botonDictar(p).click();
    ok("aviso: Gemini todavía no está conectado", await ver(dialogo(p).getByText(/Gemini todavía no está conectado/)), await texto(dialogo(p)));
    const t = await texto(dialogo(p));
    ok("inicio: explicación, grabar, subir, WhatsApp y privacidad", /como si se la explicaras/.test(t) && /⏺ Empezar a grabar/.test(t) && /📎 Subir un audio/.test(t) && /nota de voz de WhatsApp/.test(t) && /personas de Google/.test(t), t);
    await foto(p, "tablet-03-inicio-sin-clave");
    await grabar(p, 4);
    await terminar(p);
    const llego = await ver(dialogo(p).getByText("✅ Guardado en la nube"), 30_000);
    ok("grabado sin clave: queda guardado en la nube", llego, await texto(dialogo(p)));
    ok("…y dice que falta conectar Gemini", await ver(dialogo(p).getByText(/Falta conectar Gemini \(la clave GEMINI_API_KEY en Netlify\)/), 15_000), await texto(dialogo(p)));
    ok("…con el paso «⏳ Esperando a Gemini»", (await texto(dialogo(p))).includes("⏳ Esperando a Gemini"));
    await foto(p, "tablet-04-esperando-gemini");
    await cerrarDialogo(p);
    ok("aviso en Recetas: «Gemini está pasando 1 receta…»", await ver(p.getByText("🎙️ Gemini está pasando 1 receta…"), 10_000), await texto(aviso(p)));
    ok("sin clave no se llamó a Gemini", generados().length === 0, generados().length);
  });

  await caso("Familia → Gemini sin clave", async () => {
    const p = tablet.p;
    await abrir(p, "#ajustes");
    const s = p.locator("div.rounded-3xl", { hasText: "🎙️ Recetas por audio (Gemini)" }).first();
    await s.scrollIntoViewIfNeeded();
    const orden = await p.evaluate(() => {
      const h = [...document.querySelectorAll("h2")].map((x) => x.textContent ?? "");
      return [h.findIndex((x) => x.includes("Compartir entre equipos")), h.findIndex((x) => x.includes("Recetas por audio"))];
    });
    ok("la sección de Gemini va justo después de «Compartir entre equipos»", orden[0] >= 0 && orden[1] === orden[0] + 1, orden);
    await s.getByRole("button", { name: "Probar conexión" }).click();
    ok("Probar conexión sin clave: explica cómo ponerla (sin pedirla en el chat)", await ver(s.getByText(/Falta la clave de Gemini.*Nunca la pegues/)), await texto(s));
    await foto(p, "tablet-05-ajustes-sin-clave");
    ok("respaldo: los audios no van en el respaldo", await ver(p.getByText(/no van en el respaldo/), 2000));
  });

  // ---------------------------------------------------------------------------------------------
  seccion("Con la clave de prueba");
  await bajar();
  const g1 = await levantar(true);
  ok("netlify dev con clave: /api/salud dice ok", g1 === "ok", g1);
  await caso("el audio sin clave se pasa a receta solo", async () => {
    const p = tablet.p;
    sim.guion("*", [{ respuesta: PASTEL }]);
    await abrir(p, "#recetas");
    const listo = await ver(p.getByText("🎙️ 1 lista para revisar →"), 60_000);
    ok("al volver la clave, la app lo reintenta sola y queda «1 lista para revisar»", listo, await texto(aviso(p)));
    ok("…con un solo pedido a Gemini", generados().length === 1, generados().length);
    const corrio = /Queueing background function dictados-proceso-background/.test(logDev);
    ok("netlify dev corrió la función en segundo plano (dictados-proceso-background)", corrio, logDev.match(/.*background.*/g)?.slice(0, 3));
  });
  await caso("Familia → Probar conexión con clave", async () => {
    const p = tablet.p;
    await abrir(p, "#ajustes");
    const s = p.locator("div.rounded-3xl", { hasText: "🎙️ Recetas por audio (Gemini)" }).first();
    await s.scrollIntoViewIfNeeded();
    await s.getByRole("button", { name: "Probar conexión" }).click();
    ok("✅ Conectado (gemini-3.8-flash).", await ver(s.getByText("✅ Conectado (gemini-3.8-flash).")), await texto(s));
    await foto(p, "tablet-06-ajustes-ok");
    ok("probar no gastó generación", generados().length === 1, generados().length);
  });

  iphone = await contexto("iphone", IPHONE, sesionIphone);
  await caso("dictada en el tablet, revisada en el iPhone", async () => {
    const p = iphone.p;
    await abrir(p, "#recetas");
    ok("iPhone: «1 lista para revisar»", await ver(p.getByText("🎙️ 1 lista para revisar →"), 30_000), await texto(aviso(p)));
    const btn = await texto(botonDictar(p));
    ok("iPhone: el botón dice «🎙️ Dictar»", btn.trim() === "🎙️ Dictar", btn);
    await foto(p, "iphone-01-recetas");
    await aviso(p).click();
    const d = dialogo(p);
    ok("lista 🎙️ Dictadas con el chip «✅ Lista para revisar»", await ver(d.getByText("✅ Lista para revisar")), await texto(d));
    await foto(p, "iphone-02-dictadas");
    await d.getByRole("button", { name: "Revisar", exact: true }).click();
    const e = dialogo(p);
    ok("iPhone: editor «Revisar receta dictada»", await ver(e.getByText("Revisar receta dictada")), await texto(e));
    await foto(p, "iphone-03-revisar");
    const ing = e.getByRole("heading", { name: "Ingredientes" });
    await ing.scrollIntoViewIfNeeded();
    await foto(p, "iphone-04-revisar-ingredientes");
    const ancho = await p.evaluate(() => document.documentElement.scrollWidth);
    ok("iPhone: el editor no se sale por el costado", ancho <= 390, ancho);
    await e.getByRole("button", { name: "Guardar receta" }).click();
    ok("iPhone: la receta dictada queda en el recetario (con 🎙️)", await ver(p.locator("button", { hasText: "🎙️" }).filter({ hasText: "Pastel de choclo" }), 15_000));
    ok("iPhone: el aviso desaparece", await oculto(p.getByText(/lista para revisar/), 5000));
  });

  // ---------------------------------------------------------------------------------------------
  seccion("Grabar en el tablet (E1, E10)");
  let idPebre = "";
  await caso("grabar, revisar y guardar", async () => {
    const p = tablet.p;
    sim.reiniciar();
    sim.guion("*", [{ respuesta: PEBRE }]);
    await abrir(p, "#recetas");
    await botonDictar(p).click();
    ok("con clave no aparece el aviso de Gemini sin conectar", !(await ver(dialogo(p).getByText(/Gemini todavía no está conectado/), 2500)));
    await grabar(p, 2.5);
    const t0 = await texto(dialogo(p));
    ok("grabando: 🔴 Grabando, mm:ss, máximo 15:00, Pausa y Terminar", /00:0\d/.test(t0) && /máximo 15:00/.test(t0) && /⏸ Pausa/.test(t0) && /⏹ Terminar/.test(t0), t0);
    await foto(p, "tablet-07-grabando");
    await dialogo(p).getByRole("button", { name: "⏸ Pausa" }).click();
    ok("pausa: «⏸ En pausa» y «▶️ Seguir»", await ver(dialogo(p).getByText("⏸ En pausa"), 3000));
    await dialogo(p).getByRole("button", { name: "▶️ Seguir" }).click();
    await p.keyboard.press("Escape");
    ok("Escape mientras graba: «¿Terminar la grabación?»", await ver(dialogo(p).getByText("¿Terminar la grabación? Lo grabado hasta ahora se guarda."), 3000));
    await foto(p, "tablet-08-confirmar-terminar");
    await dialogo(p).getByRole("button", { name: "Seguir grabando" }).click();
    await dormir(2000);
    await terminar(p);
    const lista = await ver(dialogo(p).getByText("✅ ¡Lista!"), 25_000);
    ok("«✅ ¡Lista!» en menos de 25 s", lista, await texto(dialogo(p)));
    const t1 = await texto(dialogo(p));
    ok("avance: guardado en este equipo (con duración) y en la nube", /✅ Guardado en este equipo \(0:0\d\)/.test(t1) && t1.includes("✅ Guardado en la nube"), t1);
    await foto(p, "tablet-09-lista");
    const ds = await listaDictados(familia.token);
    idPebre = ds.find((x) => x.nombre === "Pebre")?.id ?? "";
    const a = await api(`/api/dictados/${idPebre}/audio`, { token: familia.token });
    const bytes = new Uint8Array(await a.arrayBuffer());
    ok("el audio en la nube es un WebM (cabecera EBML 1A45DFA3), content-type audio/webm", bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3 && a.headers.get("content-type") === "audio/webm", [a.status, a.headers.get("content-type"), bytes.length]);
    const ped = generados().at(-1);
    ok("a Gemini: audio/webm, clave en la cabecera y no en la URL", ped?.mime === "audio/webm" && ped.claveOk && !ped.claveEnUrl, ped);
    await dialogo(p).getByRole("button", { name: "Revisar receta" }).click();
    const e = dialogo(p);
    await e.getByText("Revisar receta dictada").waitFor({ timeout: 10_000 });
    const te = await texto(e);
    ok("revisar: recuadro de Gemini, escuchar y ver lo que se dijo", /Revisa sobre todo lo marcado con ≈/.test(te) && /▶️ Escuchar el audio/.test(te) && /📝 Ver lo que se dijo/.test(te), te.slice(0, 300));
    const estimadas = await e.locator('button[aria-pressed="true"]', { hasText: "≈ estimada" }).count();
    ok("revisar: ingredientes con «≈ estimada» marcada", estimadas >= 2, estimadas);
    ok("revisar: «Dijo: «unos cuatro tomates»»", te.includes("Dijo: «unos cuatro tomates»"), te.slice(0, 300));
    ok("revisar: sin «🗑 Borrar» (es un borrador)", !/🗑 Borrar\b/.test(te.replace("🗑 Descartar", "")));
    const conDudas = await ver(e.getByText("❓ Dudas de Gemini"), 1000);
    ok("revisar: sección «❓ Dudas de Gemini»", conDudas, te.slice(0, 300));
    await foto(p, "tablet-10-revisar");
    await e.getByRole("heading", { name: "Ingredientes" }).scrollIntoViewIfNeeded();
    await foto(p, "tablet-10b-revisar-ingredientes");
    // Corregir a mano la cantidad del tomate: deja de ser estimada.
    const filaTomate = await filaIngrediente(e, "Tomate");
    await filaTomate.getByLabel("Cantidad").fill("5");
    ok("cambiar a mano la cantidad apaga «≈ estimada»", (await filaTomate.getByRole("button", { name: "≈ estimada" }).getAttribute("aria-pressed")) === "false");
    const nDudas = await e.getByRole("button", { name: "✓ Resuelta" }).count();
    if (nDudas) await e.getByRole("button", { name: "✓ Resuelta" }).first().click();
    ok("✓ Resuelta quita la duda", (await e.getByRole("button", { name: "✓ Resuelta" }).count()) === nDudas - 1, nDudas);
    // Cerrar con «Después» y volver: sigue donde quedó.
    await e.getByRole("button", { name: "Después" }).click();
    await aviso(p).click();
    await dialogo(p).getByRole("button", { name: "Revisar", exact: true }).click();
    ok("al volver a revisar: «Seguiste donde quedaste.»", await ver(dialogo(p).getByText("Seguiste donde quedaste."), 10_000));
    const filaTomate2 = await filaIngrediente(dialogo(p), "Tomate");
    ok("…con la cantidad corregida", (await filaTomate2.getByLabel("Cantidad").inputValue()) === "5");
    await dialogo(p).getByRole("button", { name: "Guardar receta" }).click();
    ok("la receta dictada aparece en la grilla", await ver(p.locator("button", { hasText: "Pebre" }).filter({ hasText: "🎙️" }), 15_000));
    ok("el dictado sale de la lista (guardado)", await hasta(async () => !(await listaDictados(familia.token)).some((x) => x.id === idPebre)));
  });

  await caso("detalle de la receta dictada", async () => {
    const p = tablet.p;
    await p.locator("button", { hasText: "Pebre" }).filter({ hasText: "🎙️" }).first().click();
    const d = dialogo(p);
    await d.getByText("Preparación").waitFor();
    const t = await texto(d);
    ok("detalle: «≈» en las cantidades estimadas y «dijo «…»»", /≈ 1 cda\./.test(t) && /dijo «un chorrito»/.test(t), t.slice(0, 400));
    const tomate = await texto(d.locator("li", { hasText: "Tomate" }).first());
    ok("detalle: la cantidad corregida a mano no lleva ≈", /^5 Tomate/.test(tomate.trim()), tomate);
    ok("detalle: nota del ingrediente después del nombre", / — picado/.test(t), t.slice(0, 400));
    ok("detalle: «🎙️ Dictada el …» y escuchar", /🎙️ Dictada el \d+ de [a-z]+/.test(t) && t.includes("▶️ Escuchar cómo la dictaron"), t.slice(-400));
    await foto(p, "tablet-11-detalle");
    const antes = await texto(d.locator("li", { hasText: "Aceite" }).first());
    await d.getByRole("button", { name: "Más" }).first().click();
    await d.getByRole("button", { name: "Más" }).first().click();
    const despues = await texto(d.locator("li", { hasText: "Aceite" }).first());
    ok("detalle: el ≈ se mantiene al escalar las porciones", /≈/.test(antes) && /≈/.test(despues) && antes !== despues, [antes, despues]);
    await d.getByRole("button", { name: "▶️ Escuchar cómo la dictaron" }).click();
    const audio = d.locator("audio").first();
    await audio.waitFor({ timeout: 15_000 });
    const info_ = await audio.evaluate(
      (a) =>
        new Promise((ok) => {
          const fin = () => ok({ src: a.src.slice(0, 5), duracion: a.duration, error: a.error?.code ?? null });
          if (a.readyState >= 1) return fin();
          a.addEventListener("loadedmetadata", fin, { once: true });
          a.addEventListener("error", fin, { once: true });
          setTimeout(fin, 8000);
        }),
    );
    ok("escuchar: <audio> con src blob: y duración > 0", info_.src === "blob:" && info_.duracion > 0 && info_.error === null, info_);
    await d.locator("details", { hasText: "📝 Ver lo que se dijo" }).locator("summary").click();
    ok("ver lo que se dijo (desde la nube, ya guardada)", await ver(d.locator("details p.whitespace-pre-wrap"), 10_000), await texto(d.locator("details").first()));
    await foto(p, "tablet-12-escuchar");
    await d.getByRole("button", { name: "Cerrar" }).first().click();
  });

  // ---------------------------------------------------------------------------------------------
  seccion("Cerrar mientras Gemini trabaja (E5) y subir un archivo (E2)");
  await caso("cerrar mientras Gemini escucha", async () => {
    const p = tablet.p;
    sim.guion("*", [{ lento: 9000, luego: { respuesta: POSTRE } }]);
    await botonDictar(p).click();
    await grabar(p, 3.5);
    await terminar(p);
    await ver(dialogo(p).getByText("✅ Guardado en la nube"), 20_000);
    ok("mientras Gemini escribe se ve «🧑‍🍳 Gemini está escribiendo la receta…»", await ver(dialogo(p).getByText(/Gemini está escribiendo la receta/), 5000));
    ok("pie: «Puedes cerrar esta ventana…»", await ver(dialogo(p).getByText(/Puedes cerrar esta ventana/), 1000));
    await foto(p, "tablet-13-escribiendo");
    await dialogo(p).getByRole("button", { name: "Cerrar" }).first().click();
    ok("aviso «🎙️ Gemini está pasando 1 receta…»", await ver(p.getByText("🎙️ Gemini está pasando 1 receta…"), 8000), await texto(aviso(p)));
    await foto(p, "tablet-14-aviso-pasando");
    ok("…que pasa a «🎙️ 1 lista para revisar →»", await ver(p.getByText("🎙️ 1 lista para revisar →"), 45_000), await texto(aviso(p)));
  });
  await caso("subir una nota de voz de WhatsApp (.opus)", async () => {
    const p = tablet.p;
    sim.guion("*", [{ respuesta: CALZONES }]);
    await botonDictar(p).click();
    await dialogo(p).locator('input[type="file"]').setInputFiles(OPUS);
    ok("archivo .opus: «✅ ¡Lista!»", await ver(dialogo(p).getByText("✅ ¡Lista!"), 25_000), await texto(dialogo(p)));
    const ped = generados().at(-1);
    ok("a Gemini como audio/ogg", ped?.mime === "audio/ogg", ped?.mime);
    await cerrarDialogo(p);
    ok("aviso «🎙️ 2 listas para revisar →»", await ver(p.getByText("🎙️ 2 listas para revisar →"), 10_000), await texto(aviso(p)));
  });

  // ---------------------------------------------------------------------------------------------
  seccion("Errores (E4)");
  const subirConGuion = async (acciones) => {
    const p = tablet.p;
    sim.guion("*", acciones);
    await botonDictar(p).click();
    await dialogo(p).locator('input[type="file"]').setInputFiles(OPUS);
    await ver(dialogo(p).getByText("✅ Guardado en la nube"), 20_000);
  };
  await caso("cuota del día agotada (429 diario en los dos modelos)", async () => {
    const p = tablet.p;
    await subirConGuion(["429dia", "429dia"]);
    const t = dialogo(p).getByText(/Se usó la cuota gratis de Gemini de hoy\. El audio está guardado y se procesa solo después de las \d{2}:\d{2}\./);
    ok("mensaje de cuota con la hora de Chile", await ver(t, 25_000), await texto(dialogo(p)));
    ok("…título «😕 No se pudo pasar en limpio» y botones Intentar de nuevo y Descartar", (await texto(dialogo(p))).includes("😕 No se pudo pasar en limpio") && (await ver(dialogo(p).getByRole("button", { name: "Intentar de nuevo" }), 1000)) && (await ver(dialogo(p).getByRole("button", { name: "🗑 Descartar" }), 1000)));
    await foto(p, "tablet-15-cuota-dia");
    await cerrarDialogo(p);
  });
  let idClave = "";
  await caso("clave inválida", async () => {
    const p = tablet.p;
    await subirConGuion(["clave"]);
    ok("mensaje «La clave de Gemini no sirve…»", await ver(dialogo(p).getByText(/La clave de Gemini no sirve/), 25_000), await texto(dialogo(p)));
    await foto(p, "tablet-16-clave-invalida");
    idClave = (await listaDictados(familia.token)).find((x) => x.error?.codigo === "clave_invalida")?.id ?? "";
    await cerrarDialogo(p);
  });
  await caso("audio sin receta y «Pedir otra versión»", async () => {
    const p = tablet.p;
    await subirConGuion(["no_receta"]);
    const d = dialogo(p);
    ok("«🤔 Gemini no encontró una receta en este audio: «…»»", await ver(d.getByText(/🤔 Gemini no encontró una receta en este audio: «/), 25_000), await texto(d));
    ok("…con Revisar igual y Pedir otra versión", (await ver(d.getByRole("button", { name: "Revisar igual" }), 1000)) && (await ver(d.getByRole("button", { name: "Pedir otra versión" }), 1000)));
    await foto(p, "tablet-17-no-receta");
    sim.guion("*", [{ respuesta: TALLARINES }]);
    await d.getByRole("button", { name: "Pedir otra versión" }).click();
    ok("otra versión: «✅ ¡Lista!»", await ver(d.getByText("✅ ¡Lista!"), 25_000), await texto(d));
    await cerrarDialogo(p);
  });
  await caso("lista 🎙️ Dictadas en el tablet y descartar (E7)", async () => {
    const p = tablet.p;
    await aviso(p).click();
    const d = dialogo(p);
    await d.getByText("🎙️ Dictadas").first().waitFor();
    const t = await texto(d);
    ok("chips: lista, se reintenta sola (cuota) y necesita ayuda (clave)", t.includes("✅ Lista para revisar") && t.includes("⏳ Se reintenta sola") && t.includes("⚠️ Necesita ayuda"), t.slice(0, 500));
    ok("la fila con error muestra el mensaje y «Intentar de nuevo»", /La clave de Gemini no sirve/.test(t) && (await d.getByRole("button", { name: "Intentar de nuevo" }).count()) >= 2);
    await foto(p, "tablet-18-dictadas");
    const primera = d.locator("li").first();
    await primera.getByRole("button", { name: "▶️ Escuchar el audio" }).click();
    ok("▶️ en la fila: aparece el reproductor", await ver(primera.locator("audio"), 15_000));
    const fila = d.locator("li", { hasText: "La clave de Gemini no sirve" }).first();
    await fila.getByRole("button", { name: "🗑 Descartar" }).click();
    ok("descartar pide confirmar", await ver(fila.getByText(/¿Descartar este audio\?/), 2000));
    await fila.getByRole("button", { name: "Sí, descartar" }).click();
    ok("descartado: la fila desaparece", await oculto(d.getByText(/La clave de Gemini no sirve/), 10_000));
    const a = await api(`/api/dictados/${idClave}/audio`, { token: familia.token });
    ok("descartado: el audio da 410", a.status === 410 && !!idClave, [a.status, idClave]);
    await d.getByRole("button", { name: "Cerrar" }).first().click();
  });

  // ---------------------------------------------------------------------------------------------
  seccion("Sin conexión (E3)");
  await caso("grabar sin internet y subir al volver", async () => {
    const p = tablet.p;
    sim.guion("*", [{ respuesta: PASTEL }]);
    await botonDictar(p).click();
    await grabar(p, 3.5);
    await tablet.c.setOffline(true);
    await terminar(p);
    ok("sin red: «Sin conexión: el audio está a salvo en este equipo…»", await ver(dialogo(p).getByText(/Sin conexión: el audio está a salvo en este equipo/), 30_000), await texto(dialogo(p)));
    const enIdb = await p.evaluate(
      () =>
        new Promise((ok) => {
          const r = indexedDB.open("calendario-familiar-dictados", 1);
          r.onsuccess = () => {
            const q = r.result.transaction("resumen").objectStore("resumen").count();
            q.onsuccess = () => {
              ok(q.result);
              r.result.close();
            };
            q.onerror = () => ok(-1);
          };
          r.onerror = () => ok(-1);
        }),
    );
    ok("sin red: IndexedDB tiene el audio", enIdb === 1, enIdb);
    await foto(p, "tablet-19-sin-conexion");
    await tablet.c.setOffline(false);
    let sola = await ver(dialogo(p).getByText("✅ Guardado en la nube"), 15_000);
    if (!sola) {
      info("el evento «online» no llegó en 15 s: se toca «Reintentar ahora»");
      await dialogo(p).getByRole("button", { name: "Reintentar ahora" }).click();
    }
    ok("al volver internet se sube solo", sola);
    ok("…y queda lista", await ver(dialogo(p).getByText("✅ ¡Lista!"), 40_000), await texto(dialogo(p)));
    await dormir(500);
    const enIdb2 = await p.evaluate(
      () =>
        new Promise((ok) => {
          const r = indexedDB.open("calendario-familiar-dictados", 1);
          r.onsuccess = () => {
            const q = r.result.transaction("resumen").objectStore("resumen").count();
            q.onsuccess = () => ok(q.result);
          };
        }),
    );
    ok("la copia del equipo se borra cuando la nube confirma", enIdb2 === 0, enIdb2);
    await cerrarDialogo(p);
  });

  // ---------------------------------------------------------------------------------------------
  seccion("Menú con una receta dictada");
  await caso("la receta dictada en un espacio del menú y en la lista de compras", async () => {
    const p = tablet.p;
    await abrir(p, "#comidas");
    const celda = p.locator('button[aria-label^="Cena:"]').first();
    await celda.click();
    const d = dialogo(p);
    await d.getByPlaceholder("🔎 Buscar receta…").fill("Pebre");
    await d.locator("button", { hasText: "Pebre" }).first().click();
    if (await ver(dialogo(p).getByRole("button", { name: "Listo" }), 1500)) await dialogo(p).getByRole("button", { name: "Listo" }).click();
    const etiqueta = await p.locator('button[aria-label^="Cena:"]').first().getAttribute("aria-label");
    ok("la cena tiene el Pebre dictado", /Pebre/.test(etiqueta ?? ""), etiqueta);
    await foto(p, "tablet-20-menu");
    await p.getByRole("button", { name: /Generar lista de compras/ }).click();
    const g = dialogo(p);
    await g.getByText(/Compras del menú/).waitFor();
    const fila = g.locator("button", { hasText: "Aceite" }).first();
    await fila.scrollIntoViewIfNeeded();
    const t = await texto(g);
    ok("la vista previa de la lista marca con «≈» lo estimado", /≈ \d/.test(t), t.slice(0, 400));
    await foto(p, "tablet-21-lista-compras");
    await g.getByRole("button", { name: "Cerrar" }).first().click();
  });

  // ---------------------------------------------------------------------------------------------
  seccion("Con PIN (E9)");
  await caso("con PIN, «Dictar» lo pide", async () => {
    const p = tablet.p;
    await abrir(p, "#ajustes");
    const teclear = async (titulo) => {
      const t = p.locator(`[aria-label="${titulo}"]`);
      await t.waitFor({ timeout: 5000 });
      for (const n of "1234") await t.getByRole("button", { name: n, exact: true }).click();
    };
    await p.getByRole("button", { name: "Definir PIN" }).click();
    await teclear("Elige un PIN de 4 dígitos");
    await teclear("Repite el PIN");
    ok("PIN guardado", await ver(p.getByText("✓ PIN guardado."), 5000));
    await p.getByRole("button", { name: "Sí", exact: true }).click(); // que este equipo lo pida
    await abrir(p, "#recetas");
    await botonDictar(p).click();
    ok("«🎙️ Dictar receta» pide el PIN", await ver(p.locator('[aria-label="Ingresa el PIN"]'), 5000));
    await foto(p, "tablet-22-pin");
    await teclear("Ingresa el PIN");
    ok("con el PIN correcto se abre «Dictar receta»", await ver(dialogo(p).getByText(/Cuenta la receta como si/), 5000));
    await dialogo(p).getByRole("button", { name: "Cerrar" }).first().click();
  });

  // ---------------------------------------------------------------------------------------------
  seccion("Dictar desde el iPhone");
  await caso("iPhone: inicio, grabar y lista", async () => {
    const p = iphone.p;
    sim.guion("*", [{ respuesta: POSTRE }]);
    await abrir(p, "#recetas");
    await botonDictar(p).click();
    const d = dialogo(p);
    ok("iPhone: avisa que va a pedir permiso para el micrófono", await ver(d.getByText(/El iPhone te va a pedir permiso/), 5000));
    ok("iPhone: el selector de archivos va sin accept (para elegir el .opus)", (await d.locator('input[type="file"]').getAttribute("accept")) === null);
    await foto(p, "iphone-05-dictar");
    await grabar(p, 3.5);
    await foto(p, "iphone-06-grabando");
    await terminar(p);
    ok("iPhone: «✅ ¡Lista!»", await ver(d.getByText("✅ ¡Lista!"), 25_000), await texto(d));
    await foto(p, "iphone-07-lista");
    await d.getByRole("button", { name: "Revisar receta" }).click();
    await dialogo(p).getByText("Revisar receta dictada").waitFor();
    await dialogo(p).getByRole("button", { name: "Después" }).click();
    await aviso(p).click();
    await foto(p, "iphone-08-dictadas");
    await dialogo(p).getByRole("button", { name: "Cerrar" }).first().click();
  });

  seccion("Al final");
  ok("el simulador no anotó faltas en los pedidos", sim.faltas.length === 0, sim.faltas);
  ok("sin errores de página", errores.length === 0, errores);
  info(`${generados().length} pedidos a generateContent; capturas en ${CAPTURAS}`);
} catch (e) {
  malas++;
  linea(`MAL excepción: ${String(e?.stack ?? e).slice(0, 800)}`);
} finally {
  await navegador.close().catch(() => {});
  await bajar();
  await sim.cerrar();
  linea(`\n— ${buenas} OK, ${malas} MAL`);
  process.exit(malas ? 1 : 0);
}
