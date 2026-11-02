-- Datos compartidos de cada familia. Cada colección (eventos, recetas, menú…) se guarda como un
-- documento JSON con un número de versión: un cambio sólo se acepta si parte de la última versión
-- (si no, el equipo vuelve a aplicar su cambio sobre lo más nuevo). Los equipos con acceso, las
-- invitaciones y las fotos viven en Netlify Blobs.
CREATE TABLE familias (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  creada TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE colecciones (
  familia_id TEXT NOT NULL REFERENCES familias(id) ON DELETE CASCADE,
  clave TEXT NOT NULL,
  datos JSONB NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  actualizado TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (familia_id, clave)
);
