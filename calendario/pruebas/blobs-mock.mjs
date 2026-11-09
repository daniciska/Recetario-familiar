// Netlify Blobs en memoria para las pruebas (hooks.mjs redirige "@netlify/blobs" aquí).
// Imita la API de @netlify/blobs 11 que usa el servidor:
//   getStore(nombre | {name}) → { get, getWithMetadata, getMetadata, set, setJSON, delete, list }
//   - get(k, {type})          → null si no existe; type "json" | "text" (por omisión) | "arrayBuffer" | "blob".
//   - setJSON/set(k, v, {onlyIfNew | onlyIfMatch, metadata}) → {modified, etag?}; ETag nuevo en cada escritura.
//   - list({prefix, directories}) → {blobs: [{key, etag}], directories: []}.
// Los almacenes se comparten por todo el proceso (globalThis.__blobs).
// Ganchos para las pruebas:
//   globalThis.__blobsHook = async (operacion, clave, valor, almacen) => { … }  se espera antes de cada
//     operación: sirve para demorar, contar o lanzar un error (p. ej. simular que Blobs se cae).
//   globalThis.__blobsSinEtag = true  → getWithMetadata no entrega etag (como el simulador local de Netlify).
//   reiniciarBlobs()                  → borra todo.
const almacenes = (globalThis.__blobs ??= new Map());
let n = 0;

const gancho = () => globalThis.__blobsHook;

/** Bytes guardados → el tipo pedido. */
function convertir(x, tipo) {
  if (tipo === "json") return JSON.parse(x.bytes.toString("utf8"));
  if (tipo === "arrayBuffer") return x.bytes.buffer.slice(x.bytes.byteOffset, x.bytes.byteOffset + x.bytes.byteLength);
  if (tipo === "blob") return new Blob([x.bytes]);
  return x.bytes.toString("utf8");
}

async function aBytes(v) {
  if (typeof v === "string") return Buffer.from(v, "utf8");
  if (v instanceof ArrayBuffer) return Buffer.from(new Uint8Array(v));
  if (ArrayBuffer.isView(v)) return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
  if (v instanceof Blob) return Buffer.from(await v.arrayBuffer());
  throw new TypeError("blobs-mock: tipo de dato no soportado");
}

function validarClave(k) {
  if (typeof k !== "string" || k === "" || k.startsWith("/") || k.length > 600) throw new Error(`blobs-mock: clave inválida ${JSON.stringify(k)}`);
}

export function getStore(opciones) {
  const nombre = typeof opciones === "string" ? opciones : opciones?.name;
  if (!nombre) throw new Error("blobs-mock: falta el nombre del almacén");
  if (!almacenes.has(nombre)) almacenes.set(nombre, new Map());
  const m = almacenes.get(nombre);

  async function escribir(k, bytes, o = {}) {
    validarClave(k);
    const x = m.get(k);
    if (o.onlyIfNew && o.onlyIfMatch) throw new Error("blobs-mock: onlyIfNew y onlyIfMatch no van juntos");
    if (o.onlyIfNew && x) return { modified: false };
    if (o.onlyIfMatch && (!x || x.etag !== o.onlyIfMatch)) return { modified: false };
    const etag = `"e${++n}"`;
    m.set(k, { bytes, etag, metadata: o.metadata ?? {} });
    return { modified: true, etag };
  }

  return {
    async get(k, o = {}) {
      await gancho()?.("get", k, undefined, nombre);
      const x = m.get(k);
      return x ? convertir(x, o.type) : null;
    },
    async getWithMetadata(k, o = {}) {
      await gancho()?.("getWithMetadata", k, undefined, nombre);
      const x = m.get(k);
      if (!x) return null;
      return { data: convertir(x, o.type), etag: globalThis.__blobsSinEtag ? undefined : x.etag, metadata: structuredClone(x.metadata) };
    },
    async getMetadata(k) {
      await gancho()?.("getMetadata", k, undefined, nombre);
      const x = m.get(k);
      return x ? { etag: globalThis.__blobsSinEtag ? undefined : x.etag, metadata: structuredClone(x.metadata) } : null;
    },
    async setJSON(k, v, o = {}) {
      await gancho()?.("setJSON", k, v, nombre);
      return escribir(k, Buffer.from(JSON.stringify(v), "utf8"), o);
    },
    async set(k, v, o = {}) {
      await gancho()?.("set", k, v, nombre);
      return escribir(k, await aBytes(v), o);
    },
    async delete(k) {
      await gancho()?.("delete", k, undefined, nombre);
      m.delete(k);
    },
    // Como en la API real: con paginate devuelve un AsyncIterable (no una promesa).
    list(o = {}) {
      const pagina = async () => {
        await gancho()?.("list", o.prefix ?? "", undefined, nombre);
        const prefijo = o.prefix ?? "";
        const blobs = [];
        const directorios = new Set();
        for (const [key, x] of [...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
          if (!key.startsWith(prefijo)) continue;
          const resto = key.slice(prefijo.length);
          if (o.directories && resto.includes("/")) directorios.add(prefijo + resto.slice(0, resto.indexOf("/")));
          else blobs.push({ key, etag: x.etag });
        }
        return { blobs, directories: [...directorios] };
      };
      if (o.paginate) return (async function* () { yield await pagina(); })();
      return pagina();
    },
  };
}

/** Borra todos los almacenes (para empezar una prueba desde cero). */
export function reiniciarBlobs() {
  almacenes.clear();
}
