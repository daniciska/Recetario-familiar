// IndexedDB en memoria, lo justo para lib/dictados/pendientes.ts en Node (en el navegador se prueba la de
// verdad: pruebas/recetas/navegador-lib.mts). Imita lo que importa: open() con onupgradeneeded/onsuccess,
// almacenes con keyPath, transacciones que terminan después (oncomplete) con put/get/getAll/delete, y los
// valores se copian al guardar y al leer (structuredClone), como en un navegador.
//   const idb = instalarIDBFalso();   globalThis.indexedDB = …
//   idb.fallar(true)                  open() falla (modo privado, equipo lleno)
//   idb.fallarEscritura(true)         las transacciones de escritura terminan en error (equipo lleno)
//   idb.quitar()                      deja globalThis.indexedDB como estaba

type Valor = Record<string, unknown>;
type Pedido = { result: unknown; error: unknown; onsuccess: (() => void) | null; onerror: (() => void) | null };

export function instalarIDBFalso() {
  const bases = new Map<string, { version: number; almacenes: Map<string, { keyPath: string; filas: Map<unknown, Valor> }> }>();
  let fallaAbrir = false;
  let fallaEscribir = false;
  const antes = (globalThis as { indexedDB?: unknown }).indexedDB;
  const luego = (fn: () => void) => setTimeout(fn, 0);

  function baseAbierta(nombre: string) {
    const b = bases.get(nombre)!;
    return {
      onversionchange: null as (() => void) | null,
      close() {},
      objectStoreNames: { contains: (n: string) => b.almacenes.has(n) },
      createObjectStore(n: string, o: { keyPath: string }) {
        b.almacenes.set(n, { keyPath: o.keyPath, filas: new Map() });
        return {};
      },
      transaction(nombres: string | string[], modo: "readonly" | "readwrite") {
        const lista = Array.isArray(nombres) ? nombres : [nombres];
        for (const n of lista) if (!b.almacenes.has(n)) throw new DOMException(`No existe ${n}`, "NotFoundError");
        const ops: (() => void)[] = [];
        const tx = {
          oncomplete: null as (() => void) | null,
          onerror: null as (() => void) | null,
          onabort: null as (() => void) | null,
          objectStore(n: string) {
            if (!lista.includes(n)) throw new DOMException(`${n} no está en la transacción`, "NotFoundError");
            const a = b.almacenes.get(n)!;
            const pedido = (fn: () => unknown): Pedido => {
              const p: Pedido = { result: undefined, error: null, onsuccess: null, onerror: null };
              ops.push(() => {
                p.result = fn();
                p.onsuccess?.();
              });
              return p;
            };
            const escribir = (fn: () => unknown) => {
              if (modo !== "readwrite") throw new DOMException("Transacción de sólo lectura", "ReadOnlyError");
              return pedido(fn);
            };
            return {
              put: (v: Valor) => escribir(() => (a.filas.set(v[a.keyPath], structuredClone(v)), v[a.keyPath])),
              delete: (k: unknown) => escribir(() => void a.filas.delete(k)),
              get: (k: unknown) => pedido(() => (a.filas.has(k) ? structuredClone(a.filas.get(k)) : undefined)),
              getAll: () => pedido(() => [...a.filas.values()].map((v) => structuredClone(v))),
            };
          },
        };
        luego(() => {
          if (modo === "readwrite" && fallaEscribir) {
            tx.onerror?.();
            return;
          }
          for (const op of ops) op();
          tx.oncomplete?.();
        });
        return tx;
      },
    };
  }

  const falso = {
    open(nombre: string, version = 1) {
      const p = { result: undefined as unknown, error: null, onsuccess: null as (() => void) | null, onerror: null as (() => void) | null, onupgradeneeded: null as (() => void) | null };
      luego(() => {
        if (fallaAbrir) {
          p.error = new DOMException("No se puede", "UnknownError");
          p.onerror?.();
          return;
        }
        const nueva = !bases.has(nombre) || bases.get(nombre)!.version < version;
        if (!bases.has(nombre)) bases.set(nombre, { version, almacenes: new Map() });
        const b = bases.get(nombre)!;
        p.result = baseAbierta(nombre);
        if (nueva) {
          b.version = version;
          p.onupgradeneeded?.();
        }
        p.onsuccess?.();
      });
      return p;
    },
  };
  (globalThis as { indexedDB?: unknown }).indexedDB = falso;
  return {
    bases,
    fallar: (si: boolean) => void (fallaAbrir = si),
    fallarEscritura: (si: boolean) => void (fallaEscribir = si),
    /** Filas de un almacén (copias). */
    filas: (base: string, almacen: string) => [...(bases.get(base)?.almacenes.get(almacen)?.filas.values() ?? [])].map((v) => structuredClone(v)),
    quitar() {
      (globalThis as { indexedDB?: unknown }).indexedDB = antes;
    },
  };
}
