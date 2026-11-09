// Pruebas de servidor/google/cuenta.ts (plan de pruebas C1.2): lectura de GOOGLE_CUENTA_SERVICIO,
// JWT, tokens (caché, pedidos simultáneos, renovación), desfase de reloj y tabla de errores, contra
// el simulador local del endpoint de token (mock-token.mts). Sin red: todo va a 127.0.0.1.
//
//   cd calendario && node --experimental-transform-types --no-warnings --import ./pruebas/registrar.mjs pruebas/google/cuenta.test.ts
import { createPrivateKey, generateKeyPairSync, verify } from "node:crypto";
import { iniciarMockToken, type OpcionesToken } from "./mock-token.mts";
import { clavePrueba, jsonCon, usarClave, CORREO_PRUEBA, TOKEN_URI_TRAMPA, type ClavePrueba } from "./clave-prueba.ts";
import { ErrorCalDAV } from "../../servidor/caldav";
import {
  ALCANCE,
  URL_TOKEN,
  cuentaGoogle,
  descartarToken,
  firmarAsercion,
  leerCuentaServicio,
  localhost,
  olvidarTokens,
  tokenDeAcceso,
  urlTokenGoogle,
  type CuentaServicio,
} from "../../servidor/google/cuenta";

// ---------- Arnés mínimo ----------
const resultados: string[] = [];
const ok = (nombre: string, cond: unknown, detalle: unknown = "") => {
  const d = detalle === "" ? "" : ` · ${(typeof detalle === "string" ? detalle : JSON.stringify(detalle)).slice(0, 400)}`;
  resultados.push(`${cond ? "OK " : "MAL"} ${nombre}${d}`);
};
async function caso(nombre: string, fn: () => Promise<void> | void) {
  try {
    await fn();
  } catch (e) {
    ok(`${nombre} (lanzó)`, false, `${(e as Error)?.name}: ${(e as Error)?.message}`);
  }
}
/** Promesa → {valor} o {error}, sin lanzar. */
async function resultado<T>(p: Promise<T>): Promise<{ valor?: T; error?: ErrorCalDAV | Error; ms: number }> {
  const t0 = Date.now();
  try {
    return { valor: await p, ms: Date.now() - t0 };
  } catch (e) {
    return { error: e as Error, ms: Date.now() - t0 };
  }
}
const codigo = (r: { error?: unknown }) => (r.error instanceof ErrorCalDAV ? r.error.codigo : r.error ? `no-ErrorCalDAV: ${String(r.error)}` : "sin error");
const lejos = () => Date.now() + 20_000;

const clave = clavePrueba();
const otra = clavePrueba({ correo: CORREO_PRUEBA }); // mismo correo, otro par de claves
const cuerpoPem = clave.pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
/** ¿El texto deja ver algún pedazo de la clave? (ventanas de 16 caracteres del cuerpo del PEM) */
function filtraClave(texto: string): boolean {
  if (/PRIVATE KEY|MII[A-Za-z0-9+/]{8}/.test(texto)) return true;
  for (let i = 0; i + 16 <= cuerpoPem.length; i += 8) if (texto.includes(cuerpoPem.slice(i, i + 16))) return true;
  return false;
}
const cuentaDe = (json: string): CuentaServicio => {
  const r = leerCuentaServicio(json);
  if (!("cuenta" in r)) throw new Error("no se pudo leer la clave de prueba: " + r.problema);
  return r.cuenta;
};
const c = cuentaDe(clave.json);

// Fetch con registro: guarda la URL de cada pedido; `interceptar` puede responder en vez de la red.
const fetchReal = globalThis.fetch;
const urls: string[] = [];
let interceptar: ((url: string, init: RequestInit) => Response | Promise<Response>) | null = null;
const inits: RequestInit[] = [];
globalThis.fetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
  const u = String(url instanceof Request ? url.url : url);
  urls.push(u);
  inits.push(init);
  if (interceptar) return interceptar(u, init);
  return fetchReal(url, init);
}) as typeof fetch;

/** Un simulador nuevo, apuntado por GOOGLE_TOKEN_URL, con la caché y el desfase olvidados. */
async function nuevoMock(op: Partial<OpcionesToken> = {}, cuentas: [string, ClavePrueba][] = [[CORREO_PRUEBA, clave]]) {
  const m = await iniciarMockToken({ cuentas: new Map(cuentas.map(([k, v]) => [k, v.publica])), ...op });
  process.env.GOOGLE_TOKEN_URL = m.url;
  olvidarTokens();
  abiertos.push(m);
  return m;
}
const abiertos: { cerrar: () => Promise<void> }[] = [];

// ---------- 1. Lectura de la variable ----------

await caso("lectura", () => {
  const conLiterales = jsonCon(clave, { private_key: clave.pem.replace(/\n/g, "\\n") });
  const enUnaLinea = jsonCon(clave, { private_key: clave.pem.replace(/\n/g, " ") });
  const base64Partido = (clave.base64.match(/.{1,76}/g) ?? []).join("\n"); // como `base64` en Linux
  const variantes: [string, string][] = [
    ["JSON tal cual", clave.json],
    ["base64", clave.base64],
    ["base64 con saltos de línea", base64Partido],
    ['"\\n" literales en private_key', conLiterales],
    ["private_key en una sola línea", enUnaLinea],
    ["JSON con espacios alrededor y CRLF", `\n  ${clave.json.replace(/\n/g, "\r\n")}  \n`],
    ["JSON de una sola línea", JSON.stringify(clave.archivo)],
  ];
  for (const [nombre, valor] of variantes) {
    const r = leerCuentaServicio(valor);
    const bien = "cuenta" in r && r.cuenta.correo === CORREO_PRUEBA && r.cuenta.idClave === "k1" && r.cuenta.clave.asymmetricKeyType === "rsa";
    ok(`lee ${nombre}`, bien, "problema" in r ? r.problema : "");
  }
  // La clave leída es la misma que se generó (firma verificable con la pública).
  const firma = firmarAsercion(cuentaDe(conLiterales), 1_700_000_000).split(".");
  ok(
    "la clave con \\n literales firma igual que la original",
    verify("sha256", Buffer.from(`${firma[0]}.${firma[1]}`), clave.publica, Buffer.from(firma[2], "base64url")),
  );
  const sinId = leerCuentaServicio(jsonCon(clave, { private_key_id: undefined }));
  ok("sin private_key_id también sirve (kid opcional)", "cuenta" in sinId && sinId.cuenta.idClave === undefined);

  const { privateKey: ec } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pemEc = ec.export({ type: "pkcs8", format: "pem" }) as string;
  const problemas: [string, string, RegExp][] = [
    ["JSON dañado", "{nope", /incompleto o dañado/],
    ["JSON cortado a la mitad", clave.json.slice(0, 1200), /incompleto o dañado/],
    ["base64 de un JSON cortado", Buffer.from(clave.json.slice(0, 1200)).toString("base64"), /incompleto o dañado/],
    ["texto cualquiera", "hola, esta es la clave", /no es el JSON/],
    ["un arreglo", "[1,2,3]", /no es el JSON/],
    ["PEM incompleto (solo una parte)", jsonCon(clave, { private_key: clave.pem.slice(0, 600) }), /incompleta/],
    ["PEM con cuerpo inválido", jsonCon(clave, { private_key: "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n" }), /dañada/],
    ["PEM al que le falta el medio", jsonCon(clave, { private_key: clave.pem.slice(0, 300) + clave.pem.slice(-300) }), /dañada|incompleta/],
    ["sin private_key", jsonCon(clave, { private_key: undefined }), /falta la clave privada/],
    ["sin client_email", jsonCon(clave, { client_email: "" }), /client_email/],
    ["client_email sin @", jsonCon(clave, { client_email: "panel" }), /client_email/],
    ["otro type", jsonCon(clave, { type: "user" }), /service_account/],
    ["credencial de una persona", JSON.stringify({ type: "authorized_user", client_id: "x", client_secret: "y", refresh_token: "z" }), /de una persona/],
    ["cliente OAuth", JSON.stringify({ installed: { client_id: "x.apps.googleusercontent.com", client_secret: "y" } }), /cliente OAuth/],
    ["clave EC (no RSA)", jsonCon(clave, { private_key: pemEc }), /no es RSA/],
  ];
  for (const [nombre, valor, esperado] of problemas) {
    let r: ReturnType<typeof leerCuentaServicio>;
    try {
      r = leerCuentaServicio(valor);
    } catch (e) {
      ok(`problema: ${nombre}`, false, `lanzó ${(e as Error).message}`);
      continue;
    }
    const texto = "problema" in r ? r.problema : "";
    ok(`problema: ${nombre}`, "problema" in r && esperado.test(texto) && !filtraClave(texto) && texto.length < 160, texto);
  }
});

await caso("cuentaGoogle", () => {
  delete process.env.GOOGLE_CUENTA_SERVICIO;
  ok("sin variable → null", cuentaGoogle() === null);
  process.env.GOOGLE_CUENTA_SERVICIO = "   \n ";
  ok("variable en blanco → null", cuentaGoogle() === null);
  usarClave(clave, "json");
  const a = cuentaGoogle();
  const b = cuentaGoogle();
  ok("JSON → cuenta", !!a && "cuenta" in a && a.cuenta.correo === CORREO_PRUEBA);
  ok("memo: el mismo objeto mientras no cambie la variable", a === b && !!a && "cuenta" in a && !!b && "cuenta" in b && a.cuenta === b.cuenta);
  usarClave(clave, "base64");
  const d = cuentaGoogle();
  ok("base64 → cuenta (se vuelve a leer al cambiar)", !!d && "cuenta" in d && d !== a && d.cuenta.correo === CORREO_PRUEBA);
  process.env.GOOGLE_CUENTA_SERVICIO = clave.json.slice(0, 900);
  const e = cuentaGoogle();
  ok("variable dañada → problema sin la clave", !!e && "problema" in e && !filtraClave(e.problema), e);
  usarClave(clave, "json");
});

await caso("localhost", () => {
  const tabla: [string | undefined, boolean][] = [
    ["http://127.0.0.1:4321/token", true],
    ["http://localhost:4321/calendar/v3/", true],
    ["http://localhost/", true],
    ["  http://127.0.0.1:1/  ", true],
    [undefined, false],
    ["", false],
    ["https://127.0.0.1:4321/token", false],
    ["http://127.0.0.1:4321", false],
    ["http://localhost.evil.example/", false],
    ["http://127.0.0.1@evil.example/", false],
    ["http://127.0.0.1.evil.example/", false],
    ["http://[::1]:4321/", false],
    ["http://evil.example/?h=http://127.0.0.1/", false],
    ["https://oauth2.googleapis.com/token", false],
  ];
  const malas = tabla.filter(([v, esperado]) => (localhost(v) !== null) !== esperado);
  ok("localhost() solo acepta http://127.0.0.1 o localhost", malas.length === 0, malas);
});

// ---------- 2. JWT ----------

await caso("jwt", () => {
  const jwt = firmarAsercion(c, 1_700_000_000);
  const [h, r, f] = jwt.split(".");
  const enc = JSON.parse(Buffer.from(h, "base64url").toString());
  const rec = JSON.parse(Buffer.from(r, "base64url").toString());
  ok("encabezado {alg: RS256, typ: JWT, kid}", JSON.stringify(enc) === JSON.stringify({ alg: "RS256", typ: "JWT", kid: "k1" }), enc);
  ok(
    "reclamos {iss, scope = calendar.events + calendar.acls, aud, iat, exp = iat + 3600}",
    JSON.stringify(rec) === JSON.stringify({ iss: CORREO_PRUEBA, scope: ALCANCE, aud: URL_TOKEN, iat: 1_700_000_000, exp: 1_700_003_600 }),
    rec,
  );
  ok(
    "ALCANCE = los dos alcances separados por un espacio",
    ALCANCE === "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.acls",
  );
  ok("base64url sin relleno", !/[=+/]/.test(jwt));
  ok("firma RS256 verificable con la clave pública", verify("sha256", Buffer.from(`${h}.${r}`), clave.publica, Buffer.from(f, "base64url")));
});

// ---------- 3. Tokens: caché, simultáneos, renovación ----------

await caso("cache", async () => {
  const m = await nuevoMock();
  const [a, b, d] = await Promise.all([tokenDeAcceso(c, lejos()), tokenDeAcceso(c, lejos()), tokenDeAcceso(c, lejos())]);
  ok("3 pedidos simultáneos → 1 POST y el mismo token", a.startsWith("ya29.") && a === b && b === d && m.mock.pedidos === 1, { pedidos: m.mock.pedidos });
  const h = m.mock.historial[0];
  ok(
    "el simulador recibió el JWT documentado",
    h?.encabezado?.kid === "k1" &&
      h?.correo === CORREO_PRUEBA &&
      h?.alcances.join(" ") === ALCANCE &&
      h?.reclamos?.aud === URL_TOKEN &&
      Math.abs(Number(h?.reclamos?.iat) - Date.now() / 1000) < 5 &&
      Number(h?.reclamos?.exp) - Number(h?.reclamos?.iat) === 3600,
    h,
  );
  ok("el token sirve en la API simulada (verificar)", m.mock.verificar(`Bearer ${a}`)?.correo === CORREO_PRUEBA);
  const e = await tokenDeAcceso(c, lejos());
  ok("la caché responde sin volver a pedir", e === a && m.mock.pedidos === 1, { pedidos: m.mock.pedidos });
  const otraLectura = cuentaDe(clave.json); // otro objeto, misma cuenta y misma clave
  ok("otra lectura de la misma clave usa la misma caché", (await tokenDeAcceso(otraLectura, lejos())) === a && m.mock.pedidos === 1);
  descartarToken(c);
  const g = await tokenDeAcceso(c, lejos());
  ok("descartarToken obliga a pedir otro", g !== a && m.mock.pedidos === 2, { pedidos: m.mock.pedidos });
  // Se cambió la clave (misma cuenta): no se sigue usando el token de la clave vieja.
  m.mock.opciones.cuentas.set(CORREO_PRUEBA, otra.publica);
  const nueva = cuentaDe(jsonCon(clave, { private_key: otra.pem }));
  const t2 = await tokenDeAcceso(nueva, lejos());
  ok("clave nueva de la misma cuenta → token nuevo", t2 !== g && m.mock.pedidos === 3, { pedidos: m.mock.pedidos });
  m.mock.opciones.cuentas.set(CORREO_PRUEBA, clave.publica);
});

await caso("renovar", async () => {
  const m = await nuevoMock({ expiraSeg: 240 }); // vence en 4 min: menos que el margen de 5
  const a = await tokenDeAcceso(c, lejos());
  const b = await tokenDeAcceso(c, lejos());
  ok("un token al que le quedan menos de 5 min se renueva", a !== b && m.mock.pedidos === 2, { pedidos: m.mock.pedidos });
  m.mock.opciones.expiraSeg = 3599;
  const d = await tokenDeAcceso(c, lejos());
  const e = await tokenDeAcceso(c, lejos());
  ok("uno de 1 hora no", d === e && m.mock.pedidos === 3, { pedidos: m.mock.pedidos });
});

await caso("simultaneos con plazos distintos", async () => {
  const m = await nuevoMock({ demoraMs: 900 });
  const largo = resultado(tokenDeAcceso(c, lejos()));
  await new Promise((r) => setTimeout(r, 20));
  const corto = await resultado(tokenDeAcceso(c, Date.now() + 600));
  const l = await largo;
  ok(
    "el que tiene menos plazo se corta con TIEMPO a tiempo; el otro recibe el token; 1 POST",
    codigo(corto) === "TIEMPO" && corto.ms < 600 && typeof l.valor === "string" && m.mock.pedidos === 1,
    { corto: codigo(corto), ms: corto.ms, largo: l.error?.message, pedidos: m.mock.pedidos },
  );
});

// ---------- 4. Errores de la clave ----------

await caso("firma con otra clave", async () => {
  const m = await nuevoMock();
  const mala = cuentaDe(jsonCon(clave, { private_key: otra.pem }));
  const r = await resultado(tokenDeAcceso(mala, lejos()));
  ok(
    "firma con otra clave → CLAVE (Invalid JWT Signature), sin la clave en el texto",
    codigo(r) === "CLAVE" && /Invalid JWT Signature/.test(r.error?.message ?? "") && /¿Se borró o deshabilitó/.test(r.error?.message ?? "") && !filtraClave(r.error?.message ?? ""),
    r.error?.message,
  );
  ok("…y no se reintenta (1 POST)", m.mock.pedidos === 1, m.mock.pedidos);
});

await caso("cuentas que no sirven", async () => {
  const m = await nuevoMock({ deshabilitadas: new Set(["deshabilitada@prueba.iam.gserviceaccount.com"]), borradas: new Set(["borrada@prueba.iam.gserviceaccount.com"]) });
  m.mock.opciones.cuentas.set("deshabilitada@prueba.iam.gserviceaccount.com", clave.publica);
  m.mock.opciones.cuentas.set("borrada@prueba.iam.gserviceaccount.com", clave.publica);
  const casos: [string, string, RegExp][] = [
    ["cuenta inexistente", "fantasma@prueba.iam.gserviceaccount.com", /account not found/],
    ["cuenta deshabilitada", "deshabilitada@prueba.iam.gserviceaccount.com", /disabled/],
    ["cuenta borrada", "borrada@prueba.iam.gserviceaccount.com", /deleted/],
  ];
  for (const [nombre, correo, esperado] of casos) {
    const r = await resultado(tokenDeAcceso(cuentaDe(jsonCon(clave, { client_email: correo })), lejos()));
    ok(`${nombre} → CLAVE`, codigo(r) === "CLAVE" && esperado.test(r.error?.message ?? "") && r.error instanceof ErrorCalDAV && r.error.status === 400, r.error?.message);
  }
});

// ---------- 5. Reloj desfasado ----------

for (const [nombre, desfaseSeg] of [
  ["atrasado 2 h", 7200],
  ["adelantado 2 h", -7200],
] as const) {
  await caso(`reloj ${nombre}`, async () => {
    const m = await nuevoMock({ desfaseSeg });
    const r = await resultado(tokenDeAcceso(c, lejos()));
    ok(`reloj local ${nombre} → 1 rechazo, 1 reintento y token`, typeof r.valor === "string" && m.mock.pedidos === 2 && m.mock.historial[0]?.respuesta === 400 && m.mock.historial[1]?.respuesta === 200, {
      error: r.error?.message,
      pedidos: m.mock.pedidos,
    });
    descartarToken(c);
    await tokenDeAcceso(c, lejos());
    ok(`reloj ${nombre}: el desfase aprendido sirve para el siguiente token (1 POST)`, m.mock.pedidos === 3, m.mock.pedidos);
  });
}

await caso("plazo rechazado dos veces", async () => {
  const plazo = {
    status: 400,
    json: { error: "invalid_grant", error_description: "Invalid JWT: Token must be a short-lived token (60 minutes) and in a reasonable timeframe." },
  };
  const m = await nuevoMock({ falla: () => plazo });
  const r = await resultado(tokenDeAcceso(c, lejos()));
  ok("rechazo por plazo también después de corregir la hora → CLAVE «por la hora del servidor», 2 POST", codigo(r) === "CLAVE" && /hora del servidor/.test(r.error?.message ?? "") && m.mock.pedidos === 2, {
    e: r.error?.message,
    pedidos: m.mock.pedidos,
  });
  const m2 = await nuevoMock({ falla: () => ({ ...plazo, cabeceras: { date: "no es una fecha" } }) });
  const r2 = await resultado(tokenDeAcceso(c, lejos()));
  ok("rechazo por plazo sin cabecera Date legible → CLAVE sin reintento", codigo(r2) === "CLAVE" && m2.mock.pedidos === 1, { e: r2.error?.message, pedidos: m2.mock.pedidos });
});

// ---------- 6. Google con problemas ----------

await caso("servidor", async () => {
  const m = await nuevoMock({ falla5xx: 1 });
  const r = await resultado(tokenDeAcceso(c, lejos()));
  ok("503 → SERVIDOR (status 503)", codigo(r) === "SERVIDOR" && r.error instanceof ErrorCalDAV && r.error.status === 503, r.error?.message);
  const r2 = await resultado(tokenDeAcceso(c, lejos()));
  ok("una falla no deja la caché envenenada: el siguiente pide de nuevo y sale bien", typeof r2.valor === "string" && m.mock.pedidos === 2, { pedidos: m.mock.pedidos });

  const casos: [string, OpcionesToken["falla"], string][] = [
    ["429", () => ({ status: 429, json: { error: "rate_limit_exceeded" } }), "SERVIDOR"],
    ["502 que no es JSON", () => ({ status: 502, texto: "<html>Bad Gateway</html>" }), "SERVIDOR"],
    ["200 sin access_token", () => ({ status: 200, json: { token_type: "Bearer" } }), "SERVIDOR"],
    ["400 desconocido", () => ({ status: 400, json: { error: "invalid_request", error_description: "Bad Request" } }), "SERVIDOR"],
    ["redirección (redirect: error)", () => ({ status: 302, cabeceras: { location: "http://127.0.0.1:9/otra" } }), "RED"],
    ["conexión cortada", () => "cortar", "RED"],
  ];
  for (const [nombre, falla, esperado] of casos) {
    const mm = await nuevoMock({ falla });
    const x = await resultado(tokenDeAcceso(c, lejos()));
    ok(`${nombre} → ${esperado}`, codigo(x) === esperado && mm.mock.pedidos === 1, { codigo: codigo(x), e: x.error?.message, pedidos: mm.mock.pedidos });
  }
});

await caso("alcance", async () => {
  // Un Google que no conoce calendar.acls: invalid_scope → SERVIDOR (no es culpa de la clave).
  const m = await nuevoMock({ alcancesConocidos: ["https://www.googleapis.com/auth/calendar.events"] });
  const r = await resultado(tokenDeAcceso(c, lejos()));
  ok("invalid_scope → SERVIDOR", codigo(r) === "SERVIDOR" && m.mock.historial[0]?.respuesta === 400, r.error?.message);
});

await caso("plazos", async () => {
  const m = await nuevoMock({ demoraMs: 1500 });
  const r = await resultado(tokenDeAcceso(c, Date.now() + 600));
  ok("demora de 1,5 s con 300 ms disponibles → TIEMPO en menos de 1 s", codigo(r) === "TIEMPO" && r.ms < 1000, { codigo: codigo(r), ms: r.ms });
  const antes = m.mock.pedidos;
  const r2 = await resultado(tokenDeAcceso(c, Date.now() + 200));
  ok("sin plazo suficiente → TIEMPO sin ningún POST", codigo(r2) === "TIEMPO" && m.mock.pedidos === antes, { codigo: codigo(r2), pedidos: m.mock.pedidos - antes });
  const m2 = await nuevoMock({ demoraMs: 4000 });
  const r3 = await resultado(tokenDeAcceso(c, lejos()));
  ok(
    "Google no responde en 3 s (con plazo de sobra) → RED «no respondió a tiempo»",
    codigo(r3) === "RED" && /no respondió a tiempo/.test(r3.error?.message ?? "") && r3.ms >= 2900 && r3.ms < 3800 && m2.mock.pedidos === 1,
    { codigo: codigo(r3), ms: r3.ms },
  );
  const cerrado = await nuevoMock();
  await cerrado.cerrar();
  const r4 = await resultado(tokenDeAcceso(c, lejos()));
  ok("puerto cerrado → RED", codigo(r4) === "RED", { codigo: codigo(r4), e: r4.error?.message });
});

// ---------- 7. Adónde va la aserción ----------

await caso("destino", async () => {
  olvidarTokens();
  urls.length = 0;
  inits.length = 0;
  interceptar = () => new Response(JSON.stringify({ access_token: "ya29.de-google", expires_in: 3599 }), { status: 200, headers: { "content-type": "application/json" } });
  try {
    for (const externo of ["https://evil.example.com/token", "http://localhost.evil.example/token", "http://127.0.0.1@evil.example/token", TOKEN_URI_TRAMPA]) {
      process.env.GOOGLE_TOKEN_URL = externo;
      ok(`GOOGLE_TOKEN_URL externo se ignora: ${externo}`, urlTokenGoogle() === URL_TOKEN);
    }
    process.env.GOOGLE_TOKEN_URL = "https://evil.example.com/token";
    const t = await tokenDeAcceso(c, lejos());
    const init = inits[0] ?? {};
    const cuerpo = new URLSearchParams(String(init.body ?? ""));
    const cab = new Headers(init.headers);
    ok(
      "con un GOOGLE_TOKEN_URL externo y el token_uri trampa del JSON, la aserción va sólo a oauth2.googleapis.com",
      t === "ya29.de-google" && urls.length === 1 && urls[0] === URL_TOKEN && !urls.some((u) => u.includes("evil") || u.includes("ejemplo.invalid")),
      urls,
    );
    ok(
      "POST x-www-form-urlencoded con grant_type jwt-bearer, redirect: error",
      init.method === "POST" &&
        /^application\/x-www-form-urlencoded/.test(cab.get("content-type") ?? "") &&
        cuerpo.get("grant_type") === "urn:ietf:params:oauth:grant-type:jwt-bearer" &&
        (cuerpo.get("assertion") ?? "").split(".").length === 3 &&
        init.redirect === "error" &&
        init.signal instanceof AbortSignal,
      { metodo: init.method, ct: cab.get("content-type"), redirect: init.redirect },
    );
    delete process.env.GOOGLE_TOKEN_URL;
    ok("sin GOOGLE_TOKEN_URL → Google", urlTokenGoogle() === URL_TOKEN);
  } finally {
    interceptar = null;
  }
});

// ---------- 8. Nada filtra la clave ni el token ----------

await caso("textos", async () => {
  const m = await nuevoMock();
  const t = await tokenDeAcceso(c, lejos());
  const mala = cuentaDe(jsonCon(clave, { private_key: otra.pem }));
  const textos: string[] = [];
  for (const falla of [undefined, () => ({ status: 503, json: {} }), () => "cortar" as const]) {
    m.mock.opciones.falla = falla;
    olvidarTokens();
    const r = await resultado(tokenDeAcceso(falla ? c : mala, lejos()));
    if (r.error) textos.push(r.error.message);
  }
  ok("ningún mensaje de error trae la clave ni el token", textos.length === 3 && textos.every((x) => !filtraClave(x) && !x.includes(t) && !x.includes("ya29")), textos);
  ok("CuentaServicio no expone el PEM en JSON", !filtraClave(JSON.stringify(c)) && !filtraClave(String(c.clave)));
  // La clave se puede exportar (es un KeyObject normal), pero eso nunca pasa en el servidor.
  ok("la clave es un KeyObject privado RSA", c.clave.type === "private" && createPrivateKey(clave.pem).asymmetricKeyType === "rsa");
});

// ---------- Fin ----------
for (const m of abiertos) await m.cerrar().catch(() => {});
globalThis.fetch = fetchReal;
console.log(resultados.join("\n"));
const malas = resultados.filter((r) => r.startsWith("MAL")).length;
console.log(`\n${resultados.length - malas} OK, ${malas} MAL`);
process.exit(malas ? 1 : 0);
