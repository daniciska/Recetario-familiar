# Producto: estado del código (leído 12 nov 2026, sin modificar nada)

Fuente: /home/user/Recetario-familiar/calendario (README.md, PLAN.md, servidor/, netlify/functions/, components/)

## Supuestos "una familia por sitio" (HECHO, verificado en el código)
- api-familia.mts: sólo se crea la primera familia (`registro/primera`, onlyIfNew); otra exige `CLAVE_CREACION` en cabecera x-clave-creacion.
  -> El modelo de datos YA es multi-familia (acceso/<familia>, datos/<familia>/<colección>), lo único que lo ata es el alta.
- servidor/proveedores.ts: `CLAVE_DUENO_GOOGLE = "externos/google"` -> la cuenta de servicio del sitio sirve a UNA familia.
  iCloud: `credencialesICloud()` lee ICLOUD_USUARIO/ICLOUD_CLAVE_APP del entorno del sitio -> 1 Apple ID por sitio.
- servidor/google/cuenta.ts: JWT de cuenta de servicio con alcances calendar.events + calendar.acls.
- calendario-programado.mts: cada 5 min, presupuesto 24 s para TODAS las familias (límite 30 s de las scheduled functions de Netlify). No escala más allá de unas pocas familias.
- Gemini: GEMINI_API_KEY de la dueña (plan gratis: Google puede usar los audios para entrenar y revisores humanos pueden leer). GEMINI_USAR_AI_GATEWAY opcional.
- Sesión: token de equipo `familia.equipo.secreto` (sin cuentas de usuario, sin correo, sin recuperación). PIN = "candado para la casa, no seguridad".
- Sondeo: lib/datos/repositorioNube.ts CADA = 20_000 ms a /api/cambios, se salta si document.hidden. La pared está siempre visible -> 3/min.
- Clima: lib/hooks.ts usa api.open-meteo.com (cada 30 min). OJO: API gratis de Open-Meteo es sólo no comercial (verificar en 05-clima).
- Fuentes: next/font/google (Fredoka, Nunito) -> se autoalojan en el build (OK).
- Exportación estática Next 16 (output: export) + Netlify Functions + Blobs. Sin base de datos relacional.
- netlify.toml: X-Robots-Tag noindex (panel privado).
- Sin términos, sin política de privacidad, sin página pública, sin facturación, sin panel de administración multi-cliente, sin telemetría de errores (sólo console.log en funciones).

## Medición real (Netlify Observability, últimas 24 h al 12 nov 2026 ~19:00 UTC, sitio calendario-familiar-pared, plan nf_team_dev)
- calendario-programado: 288 invocaciones/día, p50 0,86 s, p90 1,04 s, p99 1,88 s.
- api-cambios: 276/día (la pared aún no está sondeando 24/7; si lo hiciera serían ~4.320/día), p50 0,18 s.
- api-dictados: 100/día (pruebas de dictado), api-datos: 39-68, resto marginal.
(Las latencias de Observability están en ns; se convirtieron.)

## Pendientes en PLAN.md (HECHO: listado del documento)
- Fase 2b Google: falta invitar al otro adulto y probar en ambos sentidos; medir con cuenta real (end:null, BYSETPOS, ids, cfh); pruebas en iPhone.
- Pendientes técnicos Google/iCloud: día borrado + serie cortada en iCloud (subirGrupo etag null); notas con "<b>" (escapar en escritura.ts); fantasmas >40 rezagadas (arreglo probado no aplicado en pendientes()); marca casi llena en `actualizar`; regla G1 rehúsa cambios con fantasmas; recrear serie con días cambiados (PATCH de instancia no-excepción); borrar serie usa etag del principal (carrera de segundos).
- Fase 3 correo dedicado (IMAP + Gemini): no hecha.
- Fase 4 dictado: falta prueba familiar en iPhone/iPad, medir con clave real (m4a/ogg/webm, latencia, ≈), disparo de background en prod; quitar en ene-2027 conservarCamposNuevos/conservarItemsPlan; audios huérfanos sin limpieza; cupos gratis no públicos; revisar GEMINI_MODELOS cada pocos meses; grabación perdida si iOS cierra la app.
- Compartir recetas (enlace público schema.org/Recipe, .json, PDF, importar entre familias): no hecho.
- Fase 5 fotos en la pared / protector de pantalla: no hecha.
- Vista de celular más amigable (pedido 12 nov): en curso.
- Cambiar sólo un día de un evento repetido (pedido 10 nov): pendiente (editar sólo un día; hacer visible "borrar sólo un día").
- Después: Web Push para quehaceres; Atajos de Siri.
