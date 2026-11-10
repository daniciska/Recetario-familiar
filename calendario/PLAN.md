# Plan: lo que falta para que el calendario quede como Skylight (o mejor)

Estado al 3 de noviembre de 2026. Hecho y publicado: calendario, menú con colación, recetas, lista de compras
inteligente, quehaceres con estrellas y premios, cuentas regresivas (y repetición anual), PIN para la pared, datos
compartidos entre equipos y calendario de iCloud en ambos sentidos.
Hecho en código el 10 de noviembre (falta publicar y que la familia lo pruebe): menú por ítems y recetas dictadas con
Gemini (Fase 4).
Publicado en https://calendario-familiar-pared.netlify.app (Netlify, proyecto `calendario-familiar-pared`).

## Decisiones de la familia

| Tema | Decisión |
|---|---|
| Equipos | Todo Apple: iPhone, iPad, Mac, iCloud. |
| Correo y calendario dedicados | **Apple ID nuevo sólo para el panel** (p. ej. `familia.apellido.panel@icloud.com`). Tiene el correo dedicado y el calendario "Familia", que se comparte con los iPhone de la familia. La app sólo accede a esa cuenta, nunca a las personales. |
| Calendario (9 nov 2026) | **Google Calendar en vez de iCloud**. El calendario "Familia" es del **Gmail de uno de los adultos** (con su rol: madre, padre u otro adulto). Desde el panel se **invita al otro adulto** como **editor** (ve y cambia eventos) o **solo lectura**, y Google le manda la invitación por correo. El panel entra con una cuenta de servicio a la que el dueño comparte el calendario. iCloud queda hecho por si se quiere volver. (Antes se había pensado en una cuenta de Google nueva de la familia; se cambió.) |
| Base de datos compartida | **No Supabase** (la familia lo descartó). Se eligió Netlify Database, pero Netlify falló al crearla (error interno 500, dos veces) y la familia eligió **Netlify Blobs** (Functions + Blobs, en el mismo Netlify). Las fases de abajo dicen "Supabase" en algunos nombres: se traducen a Netlify (funciones programadas cada 5 min, Blobs para fotos y audios, variables de entorno secretas). |
| Diseño | Pastel, parecido a Skylight (hecho): fondo claro lavanda, tarjetas blancas, eventos con relleno pastel del color de cada persona, letra redondeada (Fredoka) en títulos y reloj. |
| Recetas | **Separadas** del "Recetario familiar" de la mamá (`/recetas`). El calendario tiene su propio recetario. |
| Menú (10 nov 2026) | **Cada comida por ítems**: desayuno 4 espacios libres, colación 3 (p. ej. 2 frutas y 1 carbohidrato), almuerzo proteína / carbohidrato / verduras / postre, cena proteína / carbohidrato / verduras, once 1. («En colación siempre ponemos 3 items, por ej 2 frutas y 1 carbo… En almuerzo, 1 proteína, 1 carbo, verduras, y postre. En cena, 1 proteína, carbo, verduras. En desayuno … unos 4 items.») Hecho en código (`ESPACIOS_COMIDA` en `lib/comidas.ts`). **Once**: no dijeron nada, quedó con 1 espacio libre como antes (preguntar). Porciones por comida, no por ítem. Los equipos con la versión anterior ven sólo el primer espacio; para que no borren los demás al guardar, el servidor los repone (`conservarItemsPlan` en `api-datos.mts`, con `esquema: 2` en `repositorioNube.ts`): se publica junto con el menú por ítems, nunca después, y se quita en enero de 2027. |
| IA | **Gemini, plan gratis** (Google AI Studio). Ojo: en el plan gratis Google puede usar lo que se le manda para mejorar sus productos y revisores humanos pueden leerlo; si después se quiere más privacidad, se cambia a pago por uso sin tocar el código (README → Dictar receta (Gemini) → Privacidad). |

## Lo que tiene que preparar la familia (sin pegar contraseñas en el chat)

1. **Google Calendar** (decisión del 9 nov): con el Gmail del adulto dueño, el calendario «Familia» y un proyecto de
   Google Cloud con una cuenta de servicio, cuya clave va en `GOOGLE_CUENTA_SERVICIO`; después se conecta y se invita a
   los demás desde el panel. Paso a paso en [Pasos para Google Calendar](#pasos-para-google-calendar), aquí abajo.
2. **iCloud** (sólo si se quiere volver a iCloud en vez de Google; hay un solo calendario conectado a la vez): un Apple ID
   nuevo del panel (https://account.apple.com, con iCloud Mail), con el calendario "Familia" compartido (con permiso de
   edición) con el Apple ID de cada integrante, y una contraseña de app llamada "Panel" (account.apple.com → Inicio de
   sesión y seguridad → Contraseñas de app) en `ICLOUD_USUARIO` e `ICLOUD_CLAVE_APP`. Ver README → Calendario de iCloud.
3. **Dónde van las claves**: siempre en los secretos del proveedor (en Netlify: Project configuration → Environment
   variables, marcadas como secretas), nunca en el repositorio ni en el chat. Después de cambiarlas hay que volver a
   publicar para que las funciones las tomen.
4. **Clave de Gemini** (hecho: la familia ya la puso): en https://aistudio.google.com → Get API key. Se guarda igual, como
   `GEMINI_API_KEY`. Después de publicar, comprobar que `/api/salud` diga `"gemini":"ok"` y *Familia → 🎙️ Recetas por
   audio (Gemini) → Probar conexión*. Ver README → Dictar receta (Gemini).

### Pasos para Google Calendar

Sin pegar claves en el chat ni en el repositorio. El calendario es del Gmail de uno de los adultos (el *dueño*: madre,
padre u otro adulto); los pasos A–C se hacen con ese Gmail.

**A. Calendario.** En un computador, en calendar.google.com: junto a «Otros calendarios», «+» → «Crear calendario» →
nombre «Familia» → zona horaria Santiago («(GMT-03:00) Santiago» en verano, «(GMT-04:00) Santiago» en invierno) →
«Crear calendario». No usar el calendario principal: trae los cumpleaños de los contactos y los eventos de Gmail (la
pared no los muestra).

**B. Google Cloud.** En console.cloud.google.com, con el mismo Gmail. Aceptar los términos; no hace falta facturación.
1. Crear un proyecto («panel-familia»).
2. Menú → APIs y servicios → Biblioteca → «Google Calendar API» → Habilitar.
3. IAM y administración → Cuentas de servicio → Crear cuenta de servicio («panel-familia») → Crear y continuar → sin
   roles → Listo.
4. Abrirla → pestaña Claves → Agregar clave → Crear clave nueva → JSON → Crear. Se descarga una sola vez. Esperar
   1 minuto antes de usarla.
5. Si aparece «La creación de claves de la cuenta de servicio está inhabilitada»: en el selector de arriba elegir la
   organización → IAM → Otorgar acceso → asignarse «Administrador de políticas de la organización» → IAM y
   administración → Políticas de la organización → buscar «Inhabilitar la creación de claves de cuentas de servicio».
   Hay DOS entradas (la normal y la «managed»); en cada una: Administrar política → Anular la política del elemento
   superior → Aplicación: desactivada → Establecer política. Esperar hasta 15 minutos y volver a crear la clave.

**C. Netlify.** Proyecto `calendario-familiar-pared` → Project configuration → Environment variables → Add a variable.
- Key: `GOOGLE_CUENTA_SERVICIO`. Valor: el archivo en base64 (en la Mac, en Terminal:
  `base64 -i ~/Downloads/<archivo>.json | pbcopy`, y pegar) o el JSON tal cual.
- Marcar «Contains secret values» (si el plan lo permite, con Functions en el alcance).
- Guardar → Deploys → Trigger deploy → Deploy site.
- Después, borrar el archivo descargado o guardarlo en un gestor de contraseñas. Nunca subirlo a GitHub (Google
  deshabilita las claves expuestas) ni pegarlo en el chat.

**D. En el panel: de quién es, y compartir con el panel.** Familia → 📅 Calendario del iPhone (Google Calendar) →
«¿De quién es el calendario?»: el integrante (o un nombre), su Gmail y su rol (Madre / Padre / Otro adulto). Después,
«📋 Copiar» el correo de la cuenta de servicio (…@….iam.gserviceaccount.com) y, en calendar.google.com → junto a
«Familia», ⋮ → Configuración y uso compartido → Compartido con → Agregar personas y grupos → pegar
el correo → **«Realizar cambios y administrar el uso compartido»** → Enviar. No hay que aceptar nada. (Con «Realizar
cambios y ver los detalles del evento» también se sincroniza, pero las invitaciones del paso F se hacen a mano.)

**E. ID del calendario.** En esa misma página, en «Integrar el calendario», copiar el «ID de calendario»
(`c_…@group.calendar.google.com`) y pegarlo en el panel → 🔎 Probar (todo ✅; si avisa que la zona no es Santiago,
cambiarla en la configuración del calendario) → 🔗 Conectar, eligiendo si se suben los eventos que ya están en la pared.

**F. Invitar a los demás desde el panel.** 👥 Quiénes lo ven → «Invitar a otro adulto» → nombre (o integrante), Gmail,
rol y permiso: «Editor» (ve y cambia los eventos desde su iPhone) o «Solo lectura» (solo los ve) → ✉️ Enviar
invitación. Google le manda un correo: abrirlo y tocar el enlace. Si alguien no tiene Gmail: accounts.google.com →
Crear cuenta → Para mi uso personal → «Usar tu correo electrónico existente»; primero se crea la cuenta y después se
invita. Si el panel dice que no puede compartir, el dueño sigue los pasos que aparecen en la fila de esa persona (en
Google, «Compartido con»; Solo lectura es «Ver los detalles de todos los eventos»), o le da al panel «Realizar cambios
y administrar el uso compartido» y, en el panel, 🔄 Revisar de nuevo → ✉️ Invitar ahora en esa fila.

**G. Cada iPhone o iPad.**
- Configuración → Apps → Calendario → Cuentas de Calendario → Agregar cuenta → Google → iniciar sesión → dejar
  encendido solo «Calendarios».
- Cuentas de Calendario → Obtener datos → «Cada 15 minutos». Calendario predeterminado → Familia.
- Al dueño, «Familia» le aparece solo. A un invitado, si no aparece: en un computador, con esa cuenta,
  calendar.google.com/calendar/syncselect → marcar Familia → Guardar. En el iPhone: Calendarios → deslizar hacia abajo.
- Para decidir cada uno: la app Calendario de Apple (recomendado, junto con sus otros calendarios) o la app Google
  Calendar (los cambios llegan más rápido y los avisos se configuran ahí). Con las dos, los avisos llegan repetidos.

**H. Avisos (cada persona).** calendar.google.com → Configuración → Familia → Notificaciones de eventos → Agregar
notificación (p. ej. 30 minutos antes). En el iPhone: Calendarios → (i) junto a Familia → Alertas de eventos activado.
El panel no pone avisos: le suenan a cada uno según lo que configuró.

**I. Mac.** Calendario → Configuración → Cuentas → + → Google. En «Actualizar calendarios», cada 5 o 15 minutos.

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

### Fase 2b · Google Calendar — HECHA en código; falta que la familia la configure (ver README → Calendario de Google)
- Se usa la **Calendar API v3**, no CalDAV: el CalDAV de Google exige que una persona inicie sesión (OAuth) y no
  acepta cuentas de servicio. El panel entra con una **cuenta de servicio** (gratis) y un token JWT, sin que nadie tenga
  que volver a iniciar sesión; la clave va en la variable secreta `GOOGLE_CUENTA_SERVICIO`.
- El motor es el mismo de iCloud (`servidor/sincronizar.ts` + `servidor/ics.ts`): el transporte de Google
  (`servidor/google/`) cumple el mismo contrato que CalDAV, con ids reversibles (crear sin duplicar), `If-Match` en
  cada cambio, listado completo o error y la marca de escritura propia `cfh`. iCloud no cambió de comportamiento
  (regresión contra Radicale) y su sección se oculta si el servidor no tiene sus credenciales.
- «Familia» es del Gmail de un adulto (el dueño, con su rol) y se comparte con la cuenta de servicio con «Realizar
  cambios y administrar el uso compartido»: así el panel **invita a los demás** como Editor o Solo lectura (reglas de
  la ACL; Google les manda el correo). Con «Realizar cambios y ver los detalles del evento» (el permiso que antes se
  llamaba «Hacer cambios en eventos», que ya no existe) se sincroniza igual, pero las invitaciones se hacen a mano.
- **Una sola conexión a la vez** (Google o iCloud). La cuenta de servicio no invita personas a los *eventos* (no hace
  falta): comparte el *calendario*.
- Sin `syncToken` por ahora: el listado completo de cada vuelta cuesta 1 pedido por cada 2.500 eventos. Si el
  calendario pasa de unos 10.000 eventos, conviene agregarlo (cambia una línea de la firma del motor).
- Probado con un simulador de la API escrito contra la documentación de Google (`pruebas/google/mock-google.mts`),
  pruebas del motor de punta a punta, de la API y de la interfaz (recorrido en el navegador con el simulador).
- **Falta:**
  1. Publicar (con el permiso de la familia) y que la familia siga los [Pasos para Google Calendar](#pasos-para-google-calendar).
  2. «Probar» con la cuenta real: mide lo que Google no documenta y el panel cubre con un respaldo (evento con fin
     igual al inicio, reglas como «el último día del mes» con BYSETPOS, que un evento borrado deje ocupado su id, que
     la marca `cfh` vuelva igual después de un cambio). Queda sin medir que Google acepte quitarle la hora de término
     a un evento existente (`end: null` en un PATCH, el respaldo cuando no acepta fin igual al inicio): si no, el
     cambio queda con aviso.
  3. Pruebas reales en los iPhone: que «Familia» aparezca (syncselect para los invitados), las demoras con «Cada
     15 minutos» y que los avisos de Google suenen en el Calendario de Apple.
- **Pendientes técnicos** (no bloquean; ninguno pierde datos):
  - Un día borrado en el iPhone y después la serie cortada antes de ese día: si la pared vuelve a alargar el «hasta»,
    en **iCloud** la pared muestra ese día y el iPhone no (en Google ya se relee). Propuesta para `subirGrupo` en
    `servidor/sincronizar.ts`: si `huellaGrupo(leerRecurso(nuevo, ctx).eventos) !== h`, guardar `etag: null`.
    No se cambió para no tocar iCloud sin otra revisión.
  - Una nota escrita en la pared que parezca HTML (p. ej. «<b>») queda tal cual en Google y vuelve a la pared sin las
    marcas. Opción: escaparla en `servidor/google/escritura.ts` (decidir antes qué se ve en el iPhone).
  - Los días «fantasma» (copias idénticas que Google a veces crea) reciben el cambio de título, nota, lugar u hora de
    término de su serie (un PATCH cada uno, hasta 10). Si una serie tiene más, o se acaba el plazo, los que faltan
    quedan como días cambiados con el valor anterior (con aviso). Un cambio con muchos PATCH espera a la
    sincronización programada, que tiene más tiempo.
  - Al volver a crear una serie con días cambiados (borrada en Google y cambiada en la pared), un día cuyo cambio no se
    pudo pasar (Google lo rechazó o falló dos veces) queda como un día normal, con aviso, y no se vuelve a intentar:
    habría que permitir en `planear` el PATCH de una instancia que todavía no es excepción.
  - Borrar una serie usa el etag del evento principal: un día cambiado por otra persona en los segundos entre la
    lectura y el borrado se borra junto con la serie.

### Fase 3 · Correo dedicado
- Función programada `correo-entrante`: IMAP a `imap.mail.me.com:993` con la misma contraseña de app, cada 5 min
  (o Gmail: `imap.gmail.com:993` con una contraseña de aplicación de Google, que pide verificación en 2 pasos).
- Cada correo nuevo (texto, PDF, fotos) va a Gemini con un esquema JSON: ¿eventos? ¿receta? ¿ítems de compras?
  Crea lo que corresponda, marca el correo como leído y responde con un resumen ("Agregué 3 eventos…") con opción de
  deshacer desde la app. Los nombres de los integrantes en el asunto asignan las personas.
- Una nota de voz reenviada al correo (una receta dictada) pasa por lo mismo que «🎙️ Dictar receta» (Fase 4,
  `servidor/dictados.ts`): queda en Recetas → 🎙️ Dictadas para revisar.

### Fase 4 · Recetas por audio con Gemini — HECHA en código; falta que la familia la pruebe (ver README → Dictar receta (Gemini))
- En Recetas → «🎙️ Dictar receta»: se graba en el panel (MediaRecorder: WebM/Opus o MP4/AAC según el equipo, hasta
  15 min) o se sube un audio (nota de voz de WhatsApp, Notas de Voz, m4a, mp3…). El audio se guarda primero en el
  equipo (IndexedDB) y después en Netlify Blobs (≤ 4 MB, hasta 20 sin revisar por familia), con una subida
  idempotente que no duplica.
- En vez de la Edge Function `receta-audio` del plan original: una **Background Function** de Netlify
  (`dictados-proceso-background.mts`, hasta 15 min) le manda el audio a Gemini por REST con el esquema JSON (nombre,
  porciones, tiempo, ingredientes con `comoLoDijo`, `estimado` y nota, pasos, dudas). Modelos en `GEMINI_MODELOS`
  (por omisión `gemini-3.8-flash` y `gemini-3.5-flash-lite`), con reintentos ante 429/5xx, cambio de modelo si se
  acaba la cuota del día y espera hasta la medianoche del Pacífico si se acaban todos. Un error de Gemini no borra el
  audio: espera en la nube y la app lo vuelve a pedir sola cuando corresponde.
- Las cantidades vagas se convierten en cantidades medibles marcadas como **estimadas** («≈» en la receta y en la vista
  previa de la lista de compras; se corrigen con un toque). El escalado por porciones lo sigue haciendo la app
  (exacto, sin IA). Queda como borrador para revisar (en cualquier equipo de la familia) antes de guardarla; la
  transcripción y el audio quedan en Blobs para escucharlos y leerlos después (no van en el respaldo).
- Protección de los equipos con la versión anterior (`esquema: 2`, `servidor/conservar.ts`): se publica junto con el
  botón o antes, nunca después.
- Probado con un simulador de la API de Gemini (`pruebas/recetas/mock-gemini.mts`), pruebas del servidor, la corrida y
  el cliente (`bash pruebas/correr.sh recetas`), y de punta a punta en Chrome con `netlify dev` (tablet, iPhone y un
  equipo sin nube; `pruebas/recetas/navegador.e2e.mjs`). Nunca con la API real.
- **Falta:**
  1. Publicar (con el permiso de la familia) y que **la familia lo pruebe** en sus iPhone/iPad y en la pared con PIN:
     permiso del micrófono (en la app de la pantalla de inicio lo pide cada vez), el selector de archivos, escuchar
     audios Ogg/WebM en iOS, que el nivel y el aviso de silencio respondan con una voz real, y la grabación de 13–15
     minutos (aviso «quedan 2 minutos» y corte solo).
  2. Medir con la clave real (unos 3 a 6 dictados): que Gemini acepte tal cual `audio/m4a` (Safari), `audio/ogg`
     (WhatsApp) y `audio/webm` (hay respaldo con el tipo alterno), qué forma de salida estructurada prefiere (hay
     respaldo), la latencia, la calidad de las cantidades «≈» en español de Chile y que la función en segundo plano
     se dispare en producción (en `netlify dev` funciona; si el disparo falla, la app lo vuelve a pedir a los 30 s).
  3. **Reenviar una nota de voz al correo del panel** depende de la **Fase 3** (correo dedicado): la nota adjunta
     pasaría por lo mismo que «Dictar receta» (`servidor/dictados.ts`).
  4. Quitar en enero de 2027 la protección de los equipos viejos (`conservarCamposNuevos` y `conservarItemsPlan` en
     `api-datos.mts`).
- **Pendientes técnicos** (no bloquean):
  - Los cupos del plan gratis no son públicos (≈ 20 pedidos al día con 3.8 Flash, según terceros): un día con muchos
    reintentos los agota y se sigue al otro día.
  - Los modelos de Gemini cambian rápido: revisar `GEMINI_MODELOS` cada pocos meses (si todos dan 404, el dictado queda
    con error «interno»).
  - Los audios se acumulan en Blobs (≈ 0,25–0,5 MB por minuto) sin limpieza automática; un equipo viejo que borra una
    receta dictada deja su audio huérfano.
  - Si iOS cierra la app a mitad de una grabación, lo grabado se pierde (lo ya terminado queda en IndexedDB).

### Formato de las recetas y cómo compartirlas
- Se guardan estructuradas (como hoy en `Receta`), más: audio original, transcripción, `como_lo_dijo` por ingrediente
  y marca de estimado. (Hecho con la Fase 4: `comoLoDijo`, `estimado`, `nota`, `dudas` y `dictado` en la receta; el
  audio y la transcripción en Blobs.)
- **Compartir**: enlace público de solo lectura por receta (página con JSON-LD **schema.org/Recipe**, así apps de
  Apple como Mela, Paprika o Crouton la importan desde el enlace), archivo `.json` (schema.org/Recipe), PDF/imprimir,
  e importar con un toque si otra familia usa la app.

### Fase 5 · Fotos en la pared
- Álbum en Supabase Storage; se suben desde el iPhone (app web en la pantalla de inicio). Opcional: leer un álbum
  compartido de iCloud con "sitio web público" (no oficial, puede romperse).
- Protector de pantalla en la pared tras N minutos sin tocar, con hora, clima y próximos eventos encima; no se
  activa con una ventana abierta. De noche, apagado o atenuado.

### Pendiente · Cambiar sólo un día de un evento que se repite (pedido de la familia, 10 nov 2026)
Ejemplo: las niñas van al colegio de 8:30 a 15:00 todos los días, pero hoy salen más temprano; o hay un feriado
interno del colegio y la clase de ese día no va.
- Hoy ya se puede **borrar sólo un día** (abrir el evento → 🗑 Borrar → «Sólo el …»), y eso sirve para el feriado.
  Pero está escondido detrás de «Borrar»: hay que hacerlo más visible.
- Lo que falta es **editar sólo un día**: al guardar un cambio en un evento que se repite, preguntar
  «¿Sólo este día o todas las repeticiones?» (y quizás «este y los siguientes»).
- Idea técnica: el día cambiado se guarda como un evento aparte ligado a la serie (una excepción en la serie más un
  evento con `externo.recurrencia` = la fecha original, como ya se hace con los días que se cambian desde el iPhone),
  y se sincroniza como un día cambiado de la serie (RECURRENCE-ID en iCloud; instancia en Google Calendar), no como un
  evento suelto. Que mover o borrar la serie entera arrastre también sus días cambiados.

### Después
- Avisos en el teléfono: los eventos ya avisan por el Calendario de iOS (fase 2); para quehaceres, Web Push en la app
  instalada en la pantalla de inicio (iOS 16.4+).
- Atajos de Siri ("Oye Siri, agrega leche a la lista") con la app Atajos llamando a una Edge Function.
