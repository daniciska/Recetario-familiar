// Protección para los equipos que siguen con la versión anterior a las recetas dictadas (un iPhone con
// la app abierta en memoria, la tablet de la pared antes de su recarga de madrugada).
//
// Esos equipos no mandan `esquema` al guardar (los nuevos mandan `esquema: 2`, ver repositorioNube.ts) y
// su normalizar.ts descarta los campos que no conoce. Como guardan la colección ENTERA, al cambiar
// cualquier receta borrarían las dudas, el enlace al audio y los «≈» de todas las demás. PUT
// /api/datos/recetas (netlify/functions/api-datos.mts) se los repone desde lo guardado, que es la versión
// de la que partió ese equipo:
// - por id de receta: `dudas` y `dictado`, si faltan;
// - por id de ingrediente: `nota`, si falta; `comoLoDijo` y `estimado`, si faltan y el equipo viejo no
//   cambió el nombre, la cantidad ni la unidad (si corrigió la cantidad, el «≈» y «cómo lo dijo» ya no
//   valen; la preparación o el envase de la nota, sí).
// Un equipo viejo no puede poner estos campos, así que si vienen es porque ya estaban: no se tocan.
// PUT /api/datos (reemplazar todo: respaldo o datos de ejemplo) no pasa por aquí, a propósito.
// Quitar en enero de 2027, cuando todos los equipos hayan recargado (igual que conservarItemsPlan).

type Obj = Record<string, unknown>;
const esObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);

export const CAMPOS_RECETA_NUEVOS = ["dudas", "dictado"] as const;
export const CAMPOS_INGREDIENTE_NUEVOS = ["comoLoDijo", "estimado", "nota"] as const;

/** `entrantes` con los campos nuevos repuestos desde `previas`. No cambia ninguno de los dos. */
export function conservarCamposNuevos(previas: unknown, entrantes: unknown): unknown {
  if (!Array.isArray(previas) || !Array.isArray(entrantes)) return entrantes;
  const porId = new Map<unknown, Obj>();
  for (const r of previas) if (esObj(r) && typeof r.id === "string") porId.set(r.id, r);
  return entrantes.map((r) => {
    if (!esObj(r)) return r;
    const p = porId.get(r.id);
    if (!p) return r;
    const out: Obj = { ...r };
    for (const k of CAMPOS_RECETA_NUEVOS) if (!(k in out) && p[k] !== undefined) out[k] = p[k];
    if (Array.isArray(r.ingredientes) && Array.isArray(p.ingredientes)) {
      const ingPrevios = new Map<unknown, Obj>();
      for (const i of p.ingredientes) if (esObj(i) && typeof i.id === "string") ingPrevios.set(i.id, i);
      out.ingredientes = r.ingredientes.map((i) => {
        if (!esObj(i)) return i;
        const q = ingPrevios.get(i.id);
        // Sin nombre no es un ingrediente que haya editado un equipo viejo (su normalizar siempre lo pone).
        if (!q || typeof i.nombre !== "string") return i;
        const o: Obj = { ...i };
        // La nota (preparación o envase: «picada en cubitos», «tarro de 397 g») sigue valiendo aunque
        // corrija la cantidad, la unidad o el nombre: el editor viejo conserva el id de cada fila.
        // El «≈» y «cómo lo dijo» no: describen la cantidad de antes.
        const igual = q.nombre === i.nombre && q.cantidad === i.cantidad && q.unidad === i.unidad;
        for (const k of CAMPOS_INGREDIENTE_NUEVOS)
          if ((igual || k === "nota") && !(k in o) && q[k] !== undefined) o[k] = q[k];
        return o;
      });
    }
    return out;
  });
}
