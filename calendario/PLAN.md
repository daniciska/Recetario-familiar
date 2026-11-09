# Plan: lo que falta para que el calendario quede como Skylight (o mejor)

Estado al 3 de noviembre de 2026. Hecho y publicado: calendario, menú con colación, recetas, lista de compras
inteligente, quehaceres con estrellas y premios, cuentas regresivas (y repetición anual), PIN para la pared, datos
compartidos entre equipos y calendario de iCloud en ambos sentidos.
Publicado en https://calendario-familiar-pared.netlify.app (Netlify, proyecto `calendario-familiar-pared`).

## Decisiones de la familia

| Tema | Decisión |
|---|---|
| Equipos | Todo Apple: iPhone, iPad, Mac, iCloud. |
| Correo y calendario dedicados | **Apple ID nuevo sólo para el panel** (p. ej. `familia.apellido.panel@icloud.com`). Tiene el correo dedicado y el calendario "Familia", que se comparte con los iPhone de la familia. La app sólo accede a esa cuenta, nunca a las personales. |
| Calendario (9 nov 2026) | **Google Calendar en vez de iCloud**: una **cuenta de Google nueva de la familia** es dueña del calendario "Familia", que se comparte con el Gmail personal de cada integrante (para verlo y editarlo en sus iPhone). El panel entra con una cuenta de servicio a la que también se comparte el calendario. iCloud queda hecho por si se quiere volver. |
| Base de datos compartida | **No Supabase** (la familia lo descartó). Se eligió Netlify Database, pero Netlify falló al crearla (error interno 500, dos veces) y la familia eligió **Netlify Blobs** (Functions + Blobs, en el mismo Netlify). Las fases de abajo dicen "Supabase" en algunos nombres: se traducen a Netlify (funciones programadas cada 5 min, Blobs para fotos y audios, variables de entorno secretas). |
| Diseño | Pastel, parecido a Skylight (hecho): fondo claro lavanda, tarjetas blancas, eventos con relleno pastel del color de cada persona, letra redondeada (Fredoka) en títulos y reloj. |
| Recetas | **Separadas** del "Recetario familiar" de la mamá (`/recetas`). El calendario tiene su propio recetario. |
| IA | **Gemini, plan gratis** (Google AI Studio). Ojo: en el plan gratis Google puede usar lo que se le manda para mejorar sus productos; si después se quiere más privacidad, se cambia a pago por uso sin tocar el código. |

## Lo que tiene que preparar la familia (sin pegar contraseñas en el chat)

1. **Apple ID del panel**: crearlo en https://account.apple.com (con un número de teléfono de la familia para la verificación
   en dos pasos). Activar iCloud Mail para que tenga su dirección `@icloud.com`.
2. **Calendario "Familia"**: con ese Apple ID, en iCloud.com → Calendario, crear "Familia" y compartirlo (con permiso
   de edición) con el Apple ID de cada integrante. Así se edita desde el Calendario del iPhone y avisa con sus alertas.
3. **Contraseña de app**: en https://account.apple.com → Inicio de sesión y seguridad → Contraseñas de app → crear una
   llamada "Panel". Se guarda directo en los secretos del proveedor (en Netlify: Project configuration → Environment
   variables, marcadas como secretas: `ICLOUD_USUARIO`, `ICLOUD_CLAVE_APP`), nunca en el repositorio ni en el chat.
4. **Clave de Gemini**: en https://aistudio.google.com → Get API key. Se guarda igual, como `GEMINI_API_KEY`.

## Fases

### Fase 1 · Datos compartidos — HECHA con Netlify Blobs (ver README → Datos)

Lo de abajo era el plan original con Supabase; se hizo con Netlify Functions + Blobs: colecciones con
versión (sin pisarse entre equipos), sondeo cada 20 s que sólo lee Blobs, copia local para abrir sin internet,
invitación con QR y código de un uso, lista de equipos con "quitar acceso", fotos de recetas en Blobs.

<details><summary>Plan original</summary>

- Proyecto en São Paulo (`sa-east-1`). Tablas por colección (miembros, eventos, recetas, plan, compras, tareas,
  premios, estrellas, ajustes) con `familia_id` y **RLS** por familia; o una tabla `documentos (familia_id, coleccion,
  id, datos jsonb, actualizado)` para calzar con la interfaz `Repositorio` actual y mezclar cambios por elemento.
- Ingreso: enlace mágico por correo (Supabase Auth). El tablet de la pared entra una vez y queda con sesión.
- `lib/datos/repositorioSupabase.ts` implementa `Repositorio` (cargar, guardar, reemplazarTodo, **suscribir** con
  Realtime). Se elige en `lib/datos/index.ts`. Caché local (localStorage) para que la pared siga mostrando todo sin
  internet.
- Migración: al entrar por primera vez, se suben los datos que ya están en el equipo (con confirmación).
- Fotos de recetas → Supabase Storage (hoy van como data URL dentro del JSON).

</details>

### Fase 2 · Calendario de iCloud — HECHA (ver README → Calendario de iCloud)

CalDAV en ambos sentidos con Netlify Functions: función programada cada 5 min (`calendario-programado`) + al guardar
un evento (`/api/calendario/sincronizar`). Estado por evento en Blobs (ETag + huella), escrituras condicionales,
"gana el más reciente", seguro contra borrados masivos, reconectar sin duplicar. Personas: emoji al inicio del título
(lo pone el panel), o nombre en el título, o `@Nombre` en la nota; sin nada, para todos. El modelo de eventos ganó
varios días, lugar, "cada N" y varios días de la semana. Falta que la familia ponga `ICLOUD_USUARIO` e
`ICLOUD_CLAVE_APP` en Netlify y conecte "Familia" desde *Familia → 📅 Calendario del iPhone*.

### Fase 2b · Google Calendar (si se quiere)
- Google no acepta contraseña de app para el calendario (CalDAV sólo con OAuth). La forma limpia para un Gmail personal:
  una **cuenta de servicio** de Google Cloud (gratis), compartir el calendario de Google con el correo de esa cuenta
  ("Hacer cambios en eventos") y usar la API de Calendar v3 con un token JWT (sin que nadie tenga que volver a iniciar
  sesión). La clave de la cuenta de servicio va en una variable secreta de Netlify (`GOOGLE_CUENTA_SERVICIO`).
- Limitación: una cuenta de servicio no puede invitar personas a los eventos (no hace falta para el panel).
- El motor de `servidor/sincronizar.ts` sirve igual: falta un "proveedor" Google (listar con `syncToken`, leer/escribir
  eventos JSON en vez de .ics) y que un evento nuevo de la pared se pueda mandar a un calendario u otro.

### Fase 3 · Correo dedicado
- Función programada `correo-entrante`: IMAP a `imap.mail.me.com:993` con la misma contraseña de app, cada 5 min
  (o Gmail: `imap.gmail.com:993` con una contraseña de aplicación de Google, que pide verificación en 2 pasos).
- Cada correo nuevo (texto, PDF, fotos) va a Gemini con un esquema JSON: ¿eventos? ¿receta? ¿ítems de compras?
  Crea lo que corresponda, marca el correo como leído y responde con un resumen ("Agregué 3 eventos…") con opción de
  deshacer desde la app. Los nombres de los integrantes en el asunto asignan las personas.

### Fase 4 · Recetas por audio con Gemini
- En Recetas → "🎙️ Dictar receta": se graba en el iPhone/iPad (MediaRecorder, m4a/webm) o se reenvía una nota de voz
  al correo del panel.
- Edge Function `receta-audio`: sube el audio a Storage y lo manda a Gemini (entiende audio directo) con un esquema
  JSON: nombre, porciones, tiempo, ingredientes `{cantidad, unidad, ingrediente, categoría, como_lo_dijo,
  estimado: bool}`, pasos, dudas. Las cantidades vagas ("un puñado", "lo que pida") se convierten en cantidades
  medibles marcadas como **estimadas** (se ven con "≈" y se pueden corregir). El escalado por porciones lo sigue
  haciendo la app (exacto, sin IA).
- Queda como borrador para revisar antes de guardarla.

### Formato de las recetas y cómo compartirlas
- Se guardan estructuradas (como hoy en `Receta`), más: audio original, transcripción, `como_lo_dijo` por ingrediente
  y marca de estimado.
- **Compartir**: enlace público de solo lectura por receta (página con JSON-LD **schema.org/Recipe**, así apps de
  Apple como Mela, Paprika o Crouton la importan desde el enlace), archivo `.json` (schema.org/Recipe), PDF/imprimir,
  e importar con un toque si otra familia usa la app.

### Fase 5 · Fotos en la pared
- Álbum en Supabase Storage; se suben desde el iPhone (app web en la pantalla de inicio). Opcional: leer un álbum
  compartido de iCloud con "sitio web público" (no oficial, puede romperse).
- Protector de pantalla en la pared tras N minutos sin tocar, con hora, clima y próximos eventos encima; no se
  activa con una ventana abierta. De noche, apagado o atenuado.

### Después
- Avisos en el teléfono: los eventos ya avisan por el Calendario de iOS (fase 2); para quehaceres, Web Push en la app
  instalada en la pantalla de inicio (iOS 16.4+).
- Atajos de Siri ("Oye Siri, agrega leche a la lista") con la app Atajos llamando a una Edge Function.
