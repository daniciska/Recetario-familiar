// Copia en este equipo (IndexedDB) de los audios dictados que todavía no llegan a la nube.
//
// Regla: el audio se guarda aquí ANTES de subirlo, y la copia se borra cuando la nube confirma que lo
// tiene (lib/dictados/cliente.ts, subirPendiente). Si no hay internet, si la app se cierra a medio subir o
// si el servidor falla, el audio sigue aquí y useDictados lo sube solo después.
//
// Base `calendario-familiar-dictados` v1, dos almacenes con keyPath `id` que se escriben juntos:
//   "audios"  → todo, con los bytes como ArrayBuffer (un Blob guardado en IndexedDB a veces no se puede
//               volver a leer en iOS después de cerrar la app: «WebKitBlobResource error 1»);
//   "resumen" → lo mismo sin los bytes, para listar sin cargar varios MB cada vez.
// Todo con try/catch: si IndexedDB no existe o falla (modo privado, equipo lleno), guardar() da false,
// listar() y resumenes() dan [] y borrar() no hace nada. La pantalla avisa si guardar() da false.
// alCambiar() avisa cada cambio hecho desde esta pestaña (guardar, borrar, anotarRechazo): así lo automático
// de Dictadas (lib/dictados/motor.ts) se entera de un audio que dejó la ventana de dictar sin red o «lleno».

export interface RechazoLocal {
  mensaje: string; // lo que dijo la nube, para mostrarlo
  reintentar: boolean; // true: se vuelve a subir solo cuando haya cupo (MAX_PENDIENTES); false: sólo a mano
}

export interface PendienteLocal {
  id: string; // ID_DICTADO: el mismo que tendrá en la nube (la subida es idempotente)
  blob: Blob;
  mime: string;
  segundos?: number;
  archivo?: string;
  origen: "grabacion" | "archivo";
  creado: string; // ISO
  rechazo?: RechazoLocal; // la nube no lo aceptó (ver cliente.ts)
}

export type ResumenLocal = Omit<PendienteLocal, "blob"> & { bytes: number };

interface Registro extends Omit<PendienteLocal, "blob"> {
  datos: ArrayBuffer;
}

const BASE = "calendario-familiar-dictados";
const AUDIOS = "audios";
const RESUMEN = "resumen";

let abriendo: Promise<IDBDatabase | null> | null = null;

function abrir(): Promise<IDBDatabase | null> {
  if (abriendo) return abriendo;
  abriendo = new Promise<IDBDatabase | null>((ok) => {
    try {
      if (typeof indexedDB === "undefined") return ok(null);
      const t = setTimeout(() => ok(null), 5000); // "blocked" u otra pestaña trabada: se sigue sin copia
      const pedido = indexedDB.open(BASE, 1);
      pedido.onupgradeneeded = () => {
        const bd = pedido.result;
        if (!bd.objectStoreNames.contains(AUDIOS)) bd.createObjectStore(AUDIOS, { keyPath: "id" });
        if (!bd.objectStoreNames.contains(RESUMEN)) bd.createObjectStore(RESUMEN, { keyPath: "id" });
      };
      pedido.onsuccess = () => {
        clearTimeout(t);
        const bd = pedido.result;
        bd.onversionchange = () => {
          bd.close();
          abriendo = null;
        };
        ok(bd);
      };
      pedido.onerror = () => {
        clearTimeout(t);
        ok(null);
      };
    } catch {
      ok(null);
    }
  }).then((bd) => {
    if (!bd) abriendo = null; // se vuelve a intentar la próxima vez
    return bd;
  });
  return abriendo;
}

/** Corre `fn` en una transacción y espera a que termine. null si algo falló. */
async function transaccion<T>(modo: IDBTransactionMode, fn: (a: IDBObjectStore, r: IDBObjectStore) => IDBRequest<T> | void): Promise<{ valor?: T } | null> {
  const bd = await abrir();
  if (!bd) return null;
  return new Promise((ok) => {
    try {
      const tx = bd.transaction([AUDIOS, RESUMEN], modo);
      const pedido = fn(tx.objectStore(AUDIOS), tx.objectStore(RESUMEN));
      tx.oncomplete = () => ok({ valor: pedido ? pedido.result : undefined });
      tx.onerror = () => ok(null);
      tx.onabort = () => ok(null);
    } catch {
      ok(null);
    }
  });
}

const sinDatos = ({ datos, ...resto }: Registro): ResumenLocal => ({ ...resto, bytes: datos.byteLength });
const aPendiente = ({ datos, ...resto }: Registro): PendienteLocal => ({ ...resto, blob: new Blob([datos], { type: resto.mime }) });

const oyentes = new Set<() => void>();

/** Avisa cada vez que cambia lo guardado en este equipo desde esta pestaña. Devuelve cómo dejar de escuchar. */
export function alCambiar(fn: () => void): () => void {
  oyentes.add(fn);
  return () => void oyentes.delete(fn);
}

function avisar() {
  for (const f of [...oyentes]) {
    try {
      f();
    } catch {
      /* un oyente que falla no impide avisar a los demás */
    }
  }
}

let persistencia = false;
/** Pide que el navegador no borre esta copia por falta de espacio (se concede por heurística; una vez). */
function pedirPersistencia() {
  if (persistencia) return;
  persistencia = true;
  try {
    void navigator.storage?.persist?.().catch(() => {});
  } catch {
    /* sin la API */
  }
}

/** Guarda (o reemplaza) un audio. false si este equipo no pudo guardarlo. */
export async function guardar(p: PendienteLocal): Promise<boolean> {
  try {
    pedirPersistencia();
    const datos = await p.blob.arrayBuffer();
    const { blob: _, ...meta } = p;
    const registro: Registro = { ...meta, datos };
    const r = await transaccion("readwrite", (a, s) => {
      a.put(registro);
      s.put(sinDatos(registro));
    });
    if (r !== null) avisar();
    return r !== null;
  } catch {
    return false;
  }
}

/** Todos los audios de este equipo, con sus bytes, del más viejo al más nuevo. */
export async function listar(): Promise<PendienteLocal[]> {
  try {
    const r = await transaccion<Registro[]>("readonly", (a) => a.getAll());
    return (r?.valor ?? []).map(aPendiente).sort((x, y) => x.creado.localeCompare(y.creado));
  } catch {
    return [];
  }
}

/** Lo mismo que listar(), sin los bytes (para la lista de la pantalla). */
export async function resumenes(): Promise<ResumenLocal[]> {
  try {
    const r = await transaccion<ResumenLocal[]>("readonly", (_, s) => s.getAll());
    return (r?.valor ?? []).sort((x, y) => x.creado.localeCompare(y.creado));
  } catch {
    return [];
  }
}

/** Un audio con sus bytes, o null. */
export async function leer(id: string): Promise<PendienteLocal | null> {
  try {
    const r = await transaccion<Registro | undefined>("readonly", (a) => a.get(id));
    return r?.valor ? aPendiente(r.valor) : null;
  } catch {
    return null;
  }
}

export async function borrar(id: string): Promise<void> {
  try {
    const r = await transaccion("readwrite", (a, s) => {
      a.delete(id);
      s.delete(id);
    });
    if (r !== null) avisar();
  } catch {
    /* sin copia: nada que borrar */
  }
}

/** Anota (o quita, con undefined) por qué la nube no aceptó un audio. No hace nada si ya no está. */
export async function anotarRechazo(id: string, rechazo: RechazoLocal | undefined): Promise<void> {
  try {
    const p = await leer(id);
    if (!p) return;
    const { rechazo: _, ...resto } = p;
    await guardar(rechazo ? { ...resto, rechazo } : resto);
  } catch {
    /* sin copia */
  }
}
