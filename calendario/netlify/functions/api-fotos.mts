// POST /api/fotos (imagen en el cuerpo)  → {url}
// GET  /api/fotos/:familia/:id           → la imagen (dirección imposible de adivinar; se guarda en caché)
import type { Config, Context } from "@netlify/functions";
import { almacenFotos, autenticar, error, idAzar, json } from "../../servidor/comun";

const TIPOS = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_FOTO = 3_000_000;

export default async (req: Request, context: Context) => {
  const { familia, id } = context.params ?? {};
  if (req.method === "GET") {
    if (!familia || !id || !/^[a-z0-9]+$/.test(familia + id)) return error("No existe", 404);
    const r = await almacenFotos().getWithMetadata(`${familia}/${id}`, { type: "arrayBuffer" });
    if (!r) return error("No existe", 404);
    return new Response(r.data, {
      headers: {
        "content-type": String(r.metadata.tipo ?? "image/jpeg"),
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  }
  if (req.method !== "POST") return error("Método no permitido", 405);
  const s = await autenticar(req);
  if (s instanceof Response) return s;
  const tipo = (req.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!TIPOS.includes(tipo)) return error("Sólo fotos (JPG, PNG, WebP o GIF)", 415);
  const datos = await req.arrayBuffer();
  if (!datos.byteLength || datos.byteLength > MAX_FOTO) return error("La foto es demasiado grande", 413);
  const fotoId = idAzar(24);
  await almacenFotos().set(`${s.familiaId}/${fotoId}`, datos, { metadata: { tipo, equipo: s.equipoId, subida: new Date().toISOString() } });
  return json({ url: `/api/fotos/${s.familiaId}/${fotoId}` }, 201);
};

export const config: Config = { path: ["/api/fotos", "/api/fotos/:familia/:id"] };
