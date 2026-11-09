// Pruebas de la infraestructura de pruebas: ganchos de módulos (hooks.mjs), Blobs en memoria
// (blobs-mock.mjs) y el simulador de token montado dentro de otro servidor (google/mock-token.mts).
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { resolve as resolver } from "./hooks.mjs";
import { getStore, reiniciarBlobs } from "@netlify/blobs";
import { almacen, cambiarAcceso, leerAcceso } from "@/servidor/comun";
import { ErrorCalDAV } from "../servidor/caldav";
import { crearMockToken } from "./google/mock-token";
import { clavePrueba } from "./google/clave-prueba";
import { firmarAsercion, leerCuentaServicio } from "@/servidor/google/cuenta";

const resultados: string[] = [];
const ok = (nombre: string, cond: unknown, detalle: unknown = "") =>
  resultados.push(`${cond ? "OK " : "MAL"} ${nombre}${detalle === "" ? "" : ` · ${JSON.stringify(detalle).slice(0, 300)}`}`);
async function caso(nombre: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    ok(`${nombre} (lanzó)`, false, String(e));
  }
}

// ---------- hooks.mjs ----------
await caso("hooks", async () => {
  const padre = import.meta.url;
  const raiz = new URL("../", import.meta.url);
  const visto: string[] = [];
  const next = async (spec: string) => {
    visto.push(spec);
    return { url: spec };
  };
  const r = async (spec: string) => (await resolver(spec, { parentURL: padre, conditions: [], importAttributes: {} }, next)) as { url: string; shortCircuit?: boolean };
  const blobs = await r("@netlify/blobs");
  ok("@netlify/blobs → pruebas/blobs-mock.mjs", blobs.shortCircuit === true && blobs.url === new URL("./blobs-mock.mjs", import.meta.url).href, blobs);
  const tabla: [string, string][] = [
    ["@/servidor/comun", new URL("servidor/comun.ts", raiz).href],
    ["../servidor/caldav", new URL("servidor/caldav.ts", raiz).href],
    ["./google/mock-token", new URL("./google/mock-token.mts", import.meta.url).href],
    ["@/lib/datos", new URL("lib/datos/index.ts", raiz).href],
    ["@/servidor/ics.ts", new URL("servidor/ics.ts", raiz).href],
  ];
  for (const [spec, esperado] of tabla) {
    const x = await r(spec);
    ok(`resuelve ${spec}`, x.url === esperado, { obtenido: x.url, esperado });
  }
  for (const spec of ["ical.js", "node:fs", "./hooks.mjs", "fast-xml-parser"]) {
    const x = await r(spec);
    ok(`deja pasar ${spec}`, x.url === spec, x);
  }
  ok("sin rutas absolutas de esta máquina en hooks.mjs", !/\/home\/|\/tmp\//.test(await (await import("node:fs/promises")).readFile(fileURLToPath(new URL("./hooks.mjs", import.meta.url)), "utf8")));
  ok("los imports reales funcionan (sin extensión, @/ y .mts)", typeof leerCuentaServicio === "function" && typeof crearMockToken === "function" && new ErrorCalDAV("x", 0, "CONFIGURACION").codigo === "CONFIGURACION");
});

// ---------- blobs-mock.mjs ----------
await caso("blobs", async () => {
  reiniciarBlobs();
  const st = getStore("prueba");
  const a = await st.setJSON("k", { x: 1 }, { onlyIfNew: true });
  const b = await st.setJSON("k", { x: 2 }, { onlyIfNew: true });
  ok("setJSON onlyIfNew", a.modified && typeof a.etag === "string" && !b.modified && b.etag === undefined, { a, b });
  const g = await st.getWithMetadata("k", { type: "json" });
  const c = await st.setJSON("k", { x: 3 }, { onlyIfMatch: g?.etag });
  const d = await st.setJSON("k", { x: 4 }, { onlyIfMatch: g?.etag });
  const e = await st.setJSON("nuevo", { x: 1 }, { onlyIfMatch: '"e0"' });
  ok("setJSON onlyIfMatch (y no crea si no existe)", c.modified && c.etag !== g?.etag && !d.modified && !e.modified && (await st.get("nuevo")) === null);
  ok("get: texto por omisión, json con type", (await st.get("k")) === '{"x":3}' && (await st.get("k", { type: "json" })).x === 3);
  const f = await st.getWithMetadata("k", { type: "json" });
  ok("getWithMetadata {data, etag, metadata}", f?.data.x === 3 && f?.etag === c.etag && typeof f?.metadata === "object");
  await st.set("bin", new Uint8Array([1, 2, 3]).buffer, { metadata: { tipo: "image/png" } });
  const bin = await st.getWithMetadata("bin", { type: "arrayBuffer" });
  ok("set binario con metadata", bin && new Uint8Array(bin.data as ArrayBuffer).join(",") === "1,2,3" && bin.metadata.tipo === "image/png");
  await st.setJSON("dir/a", 1);
  await st.setJSON("dir/sub/b", 2);
  const l = await st.list({ prefix: "dir/" });
  const ld = await st.list({ prefix: "dir/", directories: true });
  let paginas = 0;
  for await (const p of st.list({ prefix: "dir/", paginate: true })) paginas += p.blobs.length;
  ok("list con prefix, directories y paginate", l.blobs.length === 2 && ld.blobs.length === 1 && ld.directories[0] === "dir/sub" && paginas === 2, { l, ld });
  await st.delete("k");
  ok("delete", (await st.get("k")) === null && (await st.getWithMetadata("k")) === null);
  ok("almacenes separados", (await getStore({ name: "otro" }).get("dir/a")) === null);
  const ops: string[] = [];
  (globalThis as { __blobsHook?: unknown }).__blobsHook = async (op: string, k: string) => void ops.push(`${op} ${k}`);
  await st.get("dir/a");
  await st.setJSON("dir/a", 5);
  (globalThis as { __blobsHook?: unknown }).__blobsHook = async (op: string) => {
    if (op === "setJSON") throw new Error("Blobs caído");
  };
  let cayo = false;
  await st.setJSON("dir/a", 6).catch(() => (cayo = true));
  delete (globalThis as { __blobsHook?: unknown }).__blobsHook;
  ok("gancho __blobsHook (ver y lanzar)", ops.join("|") === "get dir/a|setJSON dir/a" && cayo && (await st.get("dir/a", { type: "json" })) === 5, ops);
  (globalThis as { __blobsSinEtag?: boolean }).__blobsSinEtag = true;
  const sinEtag = await st.getWithMetadata("dir/a", { type: "json" });
  delete (globalThis as { __blobsSinEtag?: boolean }).__blobsSinEtag;
  ok("__blobsSinEtag imita al simulador local", sinEtag?.etag === undefined && sinEtag?.data === 5);
  // El código del servidor usa el mock (con ETag y con el candado del simulador local).
  await cambiarAcceso("f1", (x) => ({ ...(x ?? { familia: { id: "f1", nombre: "Prueba" }, equipos: {}, versiones: {} }), calendarios: [] }));
  await cambiarAcceso("f1", (x) => ({ ...x!, familia: { ...x!.familia, nombre: "Cambiada" } }));
  ok("cambiarAcceso/leerAcceso del servidor sobre el mock", (await leerAcceso("f1"))?.familia.nombre === "Cambiada" && !!(await almacen().get("acceso/f1", { type: "json" })));
});

// ---------- mock-token montado en otro servidor ----------
await caso("mock-token montado", async () => {
  const clave = clavePrueba();
  const cuenta = leerCuentaServicio(clave.json);
  if (!("cuenta" in cuenta)) throw new Error(cuenta.problema);
  const mock = crearMockToken({ cuentas: new Map([[clave.correo, clave.publica]]) });
  const server = createServer(async (req, res) => {
    if (await mock.atender(req, res)) return;
    let cuerpo = "";
    for await (const x of req) cuerpo += x; // el mock no lo leyó: le toca a la API
    const info = mock.verificar(req.headers.authorization);
    res.writeHead(info ? 200 : 401, { "content-type": "application/json" });
    res.end(JSON.stringify({ api: true, cuerpo, correo: info?.correo ?? null }));
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", () => ok()));
  const a = server.address();
  const base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  try {
    const iat = Math.floor(Date.now() / 1000);
    const t = await fetch(`${base}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: firmarAsercion(cuenta.cuenta, iat) }).toString(),
    });
    const tj = (await t.json()) as { access_token?: string; expires_in?: number };
    ok("POST /token → access_token", t.status === 200 && tj.access_token?.startsWith("ya29.") && tj.expires_in === 3599 && mock.pedidos === 1 && mock.emitidos === 1, tj);
    const api = await fetch(`${base}/calendar/v3/calendars/x/events`, { method: "POST", headers: { authorization: `Bearer ${tj.access_token}` }, body: "hola" });
    const aj = (await api.json()) as { api: boolean; cuerpo: string; correo: string | null };
    ok("otra ruta: atender devuelve false sin leer el cuerpo; verificar acepta el token", api.status === 200 && aj.api && aj.cuerpo === "hola" && aj.correo === clave.correo, aj);
    const info = mock.verificar(tj.access_token);
    ok("verificar devuelve correo y alcances", info?.alcances.includes("https://www.googleapis.com/auth/calendar.acls") && info?.alcances.includes("https://www.googleapis.com/auth/calendar.events"), info);
    mock.revocar(tj.access_token);
    const r401 = await fetch(`${base}/calendar/v3/x`, { headers: { authorization: `Bearer ${tj.access_token}` } });
    ok("revocar → la API responde 401", r401.status === 401 && mock.verificar(tj.access_token) === null);
    ok("verificar rechaza tokens inventados", mock.verificar("Bearer ya29.inventado") === null && mock.verificar(undefined) === null);
    mock.reiniciar();
    ok("reiniciar deja los contadores en 0", mock.pedidos === 0 && mock.emitidos === 0 && mock.historial.length === 0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((ok) => server.close(() => ok()));
  }
});

console.log(resultados.join("\n"));
const malas = resultados.filter((r) => r.startsWith("MAL")).length;
console.log(`\n${resultados.length - malas} OK, ${malas} MAL`);
process.exit(malas ? 1 : 0);
