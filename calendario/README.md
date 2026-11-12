# Calendario familiar

Panel de pared para un tablet en horizontal: calendario semanal por persona, **menú de la semana con recetas**, lista de compras que se arma sola, y tareas de la casa. También se usa desde el teléfono.

Next.js + TypeScript + Tailwind. Todo en español de Chile: 24 h, zona `America/Santiago`, semana de lunes a domingo, unidades métricas.

## Qué trae

| Pestaña | Qué hace |
|---|---|
| 📅 Calendario | Semana (por defecto), mes y día. Cada persona tiene su color; los eventos compartidos se ven con franjas de varios colores. Filtro por persona. Eventos de uno o **varios días** (vacaciones, viajes), con lugar, repetición diaria / semanal / mensual / anual (cumpleaños) **cada N** (p. ej. “cada 2 semanas”) y, en la semanal, **varios días** (lu y mi), fecha de término opcional, y borrar “sólo este día”. **Conectado al Calendario de los iPhone** (Google Calendar en ambos sentidos; también sirve iCloud: ver más abajo). **Cuenta regresiva**: un evento marcado así se ve arriba, bajo la fecha (“⏳ En 5 días · Cumple de la Tía Ana”). Clima de cada día y, al pie de cada columna, el almuerzo y la cena con todos sus ítems. |
| 🍽️ Menú | Grilla lunes–domingo × desayuno / colación / almuerzo / once / cena. **Cada comida tiene espacios** (como los pidió la familia): desayuno 4 libres, colación 3 libres (p. ej. 2 frutas y 1 carbohidrato), almuerzo *proteína, carbohidrato, verduras y postre*, cena *proteína, carbohidrato y verduras*, once 1 (se cambian en `ESPACIOS_COMIDA`, `lib/comidas.ts`). Cada espacio lleva una receta o un texto libre, con atajos (arroz, ensalada, fruta…); las porciones son por comida. Un plato que lo trae todo (“Cazuela”) va en el primero y los demás pueden quedar vacíos; “Comemos fuera” o “Sin colación” son para la comida entera. “Repetir semana” copia la anterior. **Generar lista de compras** junta los ingredientes de las recetas de todos los espacios de la semana, escala por porciones, suma iguales (g+kg, ml+l), y los manda a Compras agrupados por categoría (la vista previa marca con «≈» lo que suma cantidades estimadas de recetas dictadas). |
| 📖 Recetas | CRUD completo: nombre, foto (se reduce sola) o ícono, porciones, minutos, ingredientes (cantidad + unidad + ingrediente + categoría, que se adivina por el nombre) y pasos. Vista de cocina con porciones ajustables y pasos que se tachan al tocarlos. **🎙️ Dictar receta**: se cuenta la receta en voz alta (o se sube una nota de voz de WhatsApp) y Gemini la deja como borrador para revisar, con las cantidades «al ojo» marcadas ≈ y sus dudas (ver *Dictar receta (Gemini)*). |
| 🛒 Compras | Agrupada por categoría (Verduras y frutas, Carnes y pescados, Lácteos y huevos…). Agregar a mano (“2 kg papas” entiende la cantidad). Marcar comprado, sacar comprados. Regenerar la lista de la semana reemplaza sólo lo que vino del menú y aún no se compra. |
| ✅ Tareas | Quehaceres de hoy: en el tablet, una columna por persona. Pueden ser de una vez, de todos los días o de algunos días, con momento (mañana / tarde / noche). Cada uno puede dar **estrellas** ⭐ a quien lo hace (si es “Quien pueda”, se elige quién lo hizo); con las estrellas se **canjean premios** (🏆 Premios). |
| ⚙️ Familia | Integrantes (nombre, color, emoji), nombre de la familia, ciudad del clima, tema claro / noche / automático por horario, **“Este equipo: pantalla de la pared / teléfono”**, **PIN para hacer cambios**, respaldo (descargar / cargar), volver a los datos de ejemplo, **🎙️ Recetas por audio (Gemini)** (*Probar conexión*) y **📅 Calendario del iPhone** (conectar Google Calendar o iCloud; con Google, quién es el dueño del calendario y a quién se invita). |

Para la pared: reloj en vivo, día de hoy resaltado (a medianoche pasa solo al día y la semana nuevos), modo noche automático (por defecto 20:30–07:00, sin destello al recargar de noche), la pantalla se mantiene encendida (Wake Lock) y se recarga sola cada madrugada a las 03:30 y también unos minutos después de que se publique una versión nueva (cada 10 minutos un `HEAD` a la página compara su ETag con la de cuando se abrió; no despierta funciones). La recarga sólo ocurre si hay internet, nadie tocó la pantalla en los últimos 2 minutos y no hay ninguna ventana abierta (una receta mientras se cocina, un formulario) ni un campo de texto en uso; si no, lo reintenta cada 5 minutos. La única excepción: una ventana que quedó abierta de madrugada sin que nadie la toque en una hora se da por olvidada y se cierra con la recarga.

**Vuelta sola al calendario:** en el equipo marcado como *pantalla de la pared* (Familia → Este equipo), si nadie lo toca en 5 minutos vuelve al calendario de esta semana. No lo hace si hay una ventana abierta (una receta mientras se cocina, un formulario a medio llenar). En el teléfono no ocurre nunca. Un tablet táctil grande y apaisado se marca solo como pantalla de pared; se puede cambiar a mano.

**PIN:** con un PIN definido (Familia → PIN), la pantalla de la pared lo pide para crear o cambiar eventos, el menú y las recetas, administrar quehaceres y premios (también *Limpiar hechas*), canjear premios y entrar a Familia. Mirar todo, marcar quehaceres y agregar a Compras no lo piden. Queda abierto 5 minutos; quitarlo o dejar de pedirlo exige ponerlo otra vez. El teléfono no lo pide (se puede cambiar por equipo). Con la familia en la nube el PIN es el mismo en todos los equipos. Si se olvida: en el teclado, *¿Olvidaste el PIN?* muestra un número; en otro equipo, *Familia → PIN → Destrabar otro equipo* con ese número da un código que lo quita. Un respaldo cargado no cambia el PIN. Es un candado para la casa, no seguridad.

Lo que falta (correo dedicado, fotos en la pared) está en [`PLAN.md`](PLAN.md), junto con los pasos que tiene que hacer la familia para configurar Google Calendar.

## Correrlo

```bash
cd calendario
npm install
npm run dev        # http://localhost:3000
npm run build      # versión de producción en out/ (archivos estáticos)
```

## Publicarlo

**Publicado en Netlify:** https://calendario-familiar-pared.netlify.app (proyecto `calendario-familiar-pared`, sitio aparte del recetario, oculto para buscadores).

La app se exporta como archivos estáticos (`output: "export"` en `next.config.ts`, carpeta `out/`); lo compartido entre equipos, el calendario conectado (Google o iCloud) y las recetas dictadas usan Netlify Functions y Netlify Blobs (ver *Datos*, *Calendario de Google*, *Calendario de iCloud* y *Dictar receta (Gemini)*).

Para que cada cambio se publique solo: en Netlify, *Project configuration → Build & deploy → Continuous deployment → Link repository*, este repositorio, rama `claude/recetario-familiar`, **Base directory** = `calendario` (el `netlify.toml` de esta carpeta ya trae el comando y la carpeta `out`). Desde ahí, cada push que toque `calendario/` se publica solo; los cambios del recetario no lo gatillan.

**Vercel** (alternativa): *Add New → Project*, elige este repositorio y en **Root Directory** pon `calendario`.

## Datos

**Compartir entre equipos (Familia → ☁️ Compartir entre equipos):** el primer equipo toca *Crear la familia en la nube* y sube lo que tenía. Los demás se unen con *📲 Invitar otro equipo*: aparece un QR (en el iPhone o iPad basta apuntar la Cámara) y un código de 8 letras que sirve una vez y vence en 24 horas. Desde ahí todos ven y cambian lo mismo: lo que se cambia en un equipo aparece en los otros en unos 20 segundos. La lista de equipos conectados permite quitarle el acceso a uno (un teléfono perdido) o desconectar el propio. Sin internet, cada equipo abre con la última copia que guardó y avisa si un cambio no se pudo guardar.

**Equipo sin unir:** muestra arriba, en todas las pestañas, una franja: «Este equipo todavía no está unido a tu familia: lo que ves es una familia de ejemplo (inventada)» (o, si ya cambiaron los integrantes o borraron los eventos de ejemplo, «… los cambios quedan sólo aquí»), con *Unirme con un código* (abre el campo del código) y *Usar sólo en este equipo* (la oculta sólo en ese equipo, para quien usa el panel sin nube; se puede unir igual desde *Familia → Compartir entre equipos*). Esa elección se olvida al unirse o crear la familia: si después el equipo se desconecta o le quitan el acceso, la franja vuelve. «De ejemplo» quiere decir que siguen al menos 3 de los 4 integrantes inventados (con su id y su nombre) y la mitad de los eventos inventados (por id): un nombre solo no basta, porque una familia de verdad puede tener una Sofía. Al unirse (o crear la familia) aparece «✅ Listo: este equipo quedó unido a…» una vez (`components/AvisoEquipo.tsx`).

**iPhone y iPad — app de la pantalla de inicio:** el ícono guarda sus datos aparte de Safari. Escanear el QR con la Cámara abre Safari y une **Safari**, no el ícono: si después se agrega a la pantalla de inicio, el ícono abre sin unir y muestra la familia de ejemplo (pasó el 12 nov 2026). Orden correcto: abrir la dirección en Safari → Compartir → *Agregar a pantalla de inicio*, abrirla desde el ícono y ahí tocar *Unirme con un código* y escribir el código (el de 8 letras, no el QR). Si ya se unió en Safari, desde ahí mismo se pide otro código para el ícono. El panel lo explica cuando detecta el ícono (`navigator.standalone`, o pantalla completa en un iPhone/iPad): en la franja, con una línea antes de los botones y el resto tras «¿Por qué?» (en la pared, sólo la línea), y completo en *Unirme con un código*. También en *📲 Invitar otro equipo*, que dice que **no escaneen el QR si la quieren como app** (se une Safari y el código queda gastado) y trae un segundo QR sólo con la dirección (sin `#unirse=`) para abrirla en Safari y agregarla a la pantalla de inicio, más la dirección para copiar; y en el «Listo» al unirse desde Safari.

Cómo funciona:
- **Netlify Blobs** guarda todo: cada colección (eventos, recetas, menú…) como un documento con número de versión, los equipos con acceso (sólo la huella de su clave), las invitaciones, las versiones (los equipos preguntan cada 20 s si hubo cambios) y las fotos de las recetas. Un cambio sólo se acepta si parte de la última versión (escritura condicional con ETag); si otro equipo guardó antes, la app vuelve a aplicar su cambio sobre lo más nuevo, así dos equipos que cambian a la vez no se pisan.
- Se intentó con Netlify Database (Postgres), pero al publicar Netlify devolvió un error interno 500 al crear la base (dos veces, sin incidentes en su página de estado); la familia eligió seguir con Blobs. Pasar a Netlify Database más adelante sólo cambia `servidor/comun.ts` y `api-datos.mts`.
- **Netlify Functions** (`netlify/functions/api-*.mts`, código común en `servidor/comun.ts`) son la API: `/api/familia`, `/api/invitar`, `/api/unirse`, `/api/cambios`, `/api/datos`, `/api/equipos`, `/api/fotos`, `/api/calendario`, `/api/dictados` (y `/api/dictados-proceso`, en segundo plano), `/api/salud` (si Blobs responde y si hay clave de Gemini, nunca su valor).
- Sólo se puede crear la primera familia del sitio; para crear otra hay que definir la variable `CLAVE_CREACION` en Netlify y mandarla en la cabecera `x-clave-creacion`.
- **Equipos con la versión anterior** (p. ej. un iPhone con la app abierta desde antes de publicar): su copia no conoce los campos nuevos de las recetas dictadas (dudas, enlace al audio, «≈», «Dijo», nota) ni los espacios 2.º en adelante de cada comida del menú, y al guardar los borraría. Los equipos al día mandan `esquema: 2` (`repositorioNube.ts`); a los que no lo mandan, `api-datos.mts` les repone lo que no ven (`servidor/conservar.ts` y `conservarItemsPlan` en `lib/comidas.ts`). Por eso esa protección se publica junto con el botón *Dictar* y el menú por ítems, nunca después; se quita en enero de 2027, cuando todos hayan recargado. *Cargar respaldo* (reemplazar todo) no pasa por ella, a propósito. Límite de la transición: **Generar lista de compras** en un equipo con la versión anterior sólo mira el primer espacio de cada comida y reemplaza lo pendiente del menú de esa semana, así que quita los ingredientes de las recetas puestas en los demás espacios (no toca el menú ni las recetas): hasta que todos los equipos hayan recargado (la pared lo hace sola a los pocos minutos de publicar, o a las 03:30), genera la lista desde un equipo al día. Un equipo que guardó con la versión anterior y abre la nueva sin red no confía en las versiones de su copia (`RepositorioNube.cargar`): con la primera revisión trae todo de la nube.

Sin conectar a la nube, los datos viven en el `localStorage` del equipo y se mueven con *Descargar respaldo / Cargar respaldo*. Un respaldo dañado o incompleto se revisa antes de cargarlo y nunca deja la app caída. La app sólo habla con la interfaz `Repositorio` (`lib/datos/repositorio.ts`): `RepositorioLocal` o `RepositorioNube`, elegido en `lib/datos/index.ts`.

Probar la nube en local: `NODE_OPTIONS= npx netlify-cli dev --offline --dir out --functions netlify/functions` (después de `npm run build`). Ojo: el simulador local de Blobs no entrega ETags ni hace atómica la escritura "sólo si no existe", así que los cambios simultáneos sólo se pueden probar en Netlify (con `CLAVE_CREACION`, sin ocupar la primera familia).

```
lib/datos/tipos.ts            modelo (Miembro, Evento, Receta, ItemCompra, Tarea…)
lib/datos/repositorio.ts      interfaz de almacenamiento
lib/datos/repositorioLocal.ts implementación con localStorage
lib/datos/repositorioNube.ts  implementación con la nube (versiones, sondeo, copia local)
lib/datos/nube.ts             sesión del equipo, llamadas a /api, fotos
components/Nube.tsx           crear familia, invitar (QR), unirse, equipos
components/AvisoEquipo.tsx    franja «equipo sin unir a la familia» y el «Listo» al unirse
components/CalendarioComun.tsx   lo común a los dos calendarios: estado, avisos, sincronizar, desconectar
components/CalendarioGoogle.tsx  conectar Google Calendar: dueño, Probar, «Quiénes lo ven» e invitaciones
components/CalendarioICloud.tsx  conectar el calendario de iCloud y ver cómo va
netlify/functions/            API (Netlify Functions), calendario-programado (cada 5 min) y dictados-proceso-background (Gemini, hasta 15 min)
servidor/comun.ts             Blobs: colecciones con versión, acceso por equipo, invitaciones
servidor/caldav.ts            cliente CalDAV (iCloud)
servidor/ics.ts               .ics del iPhone ↔ eventos del panel
servidor/sincronizar.ts       sincronización en ambos sentidos (el mismo motor para Google e iCloud)
servidor/proveedores.ts       contrato `Transporte` y qué proveedor usa cada conexión
servidor/google/cuenta.ts     clave de la cuenta de servicio (GOOGLE_CUENTA_SERVICIO) y tokens (JWT)
servidor/google/ids.ts        id de Google reversible a partir del UID del panel
servidor/google/serie.ts      listado de Google → series → .ics (lo que lee el motor)
servidor/google/escritura.ts  .ics del motor → pedidos a la API (y lo que Google no deja hacer)
servidor/google/transporte.ts Calendar API v3 con el mismo contrato que CalDAV
servidor/google/compartir.ts  con quién se comparte «Familia» (ACL): invitar, permiso, quitar
servidor/google/prueba.ts     autoprueba «Probar»
servidor/dictados.ts          «Dictar receta»: API de los dictados y la corrida en segundo plano (Blobs: registro, audio, texto)
servidor/gemini.ts            Gemini por REST: clave, modelos, tipo de audio, errores y reintentos
servidor/receta-ia/           instrucción y esquema JSON para Gemini; normalizar-receta.ts pasa su respuesta a una Receta
servidor/conservar.ts         repone lo que borraría un equipo con la versión anterior (se quita en enero de 2027)
lib/dictados/                 lado de la app: grabadora, copia en IndexedDB, subida, reglas, textos, motor.ts (lo automático, en cualquier pestaña) y useDictados
components/DictarReceta.tsx   grabar o subir un audio y seguir el avance hasta «✅ ¡Lista!»
components/Dictados.tsx       aviso en Recetas y la lista «🎙️ Dictadas»
components/Escuchar.tsx       escuchar el audio y «Ver lo que se dijo»
components/GeminiAjustes.tsx  Familia → 🎙️ Recetas por audio (Gemini): «Probar conexión»
pruebas/                      pruebas del servidor y simuladores de Google y de Gemini (ver pruebas/README.md)
lib/datos/normalizar.ts       revisa y repara datos guardados o respaldos
lib/comidas.ts                espacios de cada comida (ESPACIOS_COMIDA) y sus ítems
lib/compras.ts                categorías, unidades, suma de ingredientes
lib/fechas.ts                 fechas en America/Santiago, semana lunes–domingo
lib/eventos.ts                repeticiones
lib/ejemplo.ts                familia de 4, eventos y 6 recetas chilenas de ejemplo
components/                   las vistas
```

## Calendario de Google

**Qué hace:** el panel y el Calendario de los iPhone comparten el calendario **«Familia»** de Google Calendar. Es un calendario secundario del **Gmail de uno de los adultos** (el *dueño*: madre, padre u otro adulto). Un evento creado o cambiado en la pared aparece en los iPhone; uno creado o cambiado en el iPhone (o en calendar.google.com) aparece en la pared. Borrar en un lado borra en el otro. Desde el panel se **invita a los demás** (el otro adulto, los abuelos…) como **Editor** (ven y cambian los eventos desde su iPhone) o **Solo lectura** (sólo los ven), y Google les manda la invitación por correo. El panel entra con una **cuenta de servicio** de Google Cloud (Google no acepta contraseñas de app para el calendario), a la que el dueño le comparte «Familia»; nadie tiene que volver a iniciar sesión.

**Prepararlo (una vez; el detalle paso a paso está en [`PLAN.md`](PLAN.md)):**
1. En el panel: *Familia → 📅 Calendario del iPhone (Google Calendar)* → **¿De quién es el calendario?** (un integrante o un nombre, su Gmail y si es Madre, Padre u Otro adulto). Los pasos que siguen se muestran para esa persona.
2. Con el Gmail del dueño, en calendar.google.com (en un computador): *Otros calendarios → + → Crear calendario* → **Familia**, zona **Santiago** (sale como «(GMT-03:00) Santiago» en verano y «(GMT-04:00) Santiago» en invierno). No usar el calendario principal (trae los cumpleaños de los contactos).
3. Con el mismo Gmail, en console.cloud.google.com: un proyecto, *APIs y servicios → Biblioteca →* habilitar **Google Calendar API**, una **cuenta de servicio** sin roles y su **clave JSON** (se descarga una sola vez). No hace falta facturación.
4. En Netlify (proyecto `calendario-familiar-pared`) → *Project configuration → Environment variables*: **`GOOGLE_CUENTA_SERVICIO`** con el JSON tal cual o en base64, marcada como secreta (con las Functions en su alcance), y volver a publicar. Nunca en el repositorio ni en el chat; después, borrar el archivo descargado o guardarlo en un gestor de contraseñas.
5. De vuelta en el panel aparece el correo de la cuenta de servicio (…@….iam.gserviceaccount.com, botón *📋 Copiar*). En calendar.google.com → «Familia» → ⋮ → *Configuración y uso compartido → Compartido con → Agregar personas y grupos* → ese correo con **«Realizar cambios y administrar el uso compartido»** (así el panel puede invitar al resto). Con «Realizar cambios y ver los detalles del evento» la sincronización funciona igual, pero las invitaciones se hacen a mano en Google Calendar (el panel muestra los pasos).
6. En esa misma página, *Integrar el calendario → ID de calendario* (`c_…@group.calendar.google.com`): pegarlo en el panel → **🔎 Probar** → **🔗 Conectar**, eligiendo si los eventos que ya están en la pared se suben o quedan sólo en la pared.
7. **👥 Quiénes lo ven → Invitar a otro adulto**: nombre (o integrante), Gmail, rol y permiso → *✉️ Enviar invitación*. La persona abre el correo de Google y toca el enlace; después agrega su cuenta de Google en el iPhone (*Configuración → Apps → Calendario → Cuentas de Calendario → Agregar cuenta → Google*).

**«Probar»** revisa con la cuenta y el calendario reales que la clave funciona, el permiso con que se compartió, la zona horaria, si el panel puede invitar, y lo que la documentación de Google no asegura (eventos sin hora de término, repeticiones como «el último día del mes», que un cambio sobre una versión vieja se rechace). Usa un evento de prueba del 01-01-2001 que la pared nunca muestra y que borra al terminar (si se corta, lo borra la prueba siguiente). La sincronización no depende de ella.

**👥 Quiénes lo ven:** el dueño (*Cambiar* corrige su nombre, Gmail o rol sólo en el panel; el panel avisa si ese Gmail no aparece como dueño en Google, y nunca le quita ni le cambia el acceso) y cada persona invitada con su permiso (*Editor* / *Solo lectura*, se cambia ahí mismo) y *Quitar* (con confirmación). Se mezcla lo guardado en el panel con lo que dice Google: alguien a quien se le quitó el acceso en Google Calendar aparece como «ya no tiene acceso» (con *Invitar de nuevo*), y alguien a quien se compartió directamente en Google aparece como «compartido en Google Calendar». Si el panel no tiene permiso para compartir, la persona queda «falta compartirlo a mano», con los pasos para el dueño (también si en Google tiene otro permiso que el pedido); si después se le da al panel «administrar el uso compartido», queda «falta compartirlo» con *✉️ Invitar ahora* (*🔄 Revisar de nuevo* vuelve a mirar Google). Los nombres de Google Calendar que usa el panel: *Compartido con*, «Ver los detalles de todos los eventos» (Solo lectura), «Realizar cambios y ver los detalles del evento» (Editor) y «Realizar cambios y administrar el uso compartido». Hasta 20 personas.

**Reglas** (las mismas de iCloud: cada 5 minutos y al guardar, gana el cambio más reciente, aviso antes de un borrado masivo, reparto por emoji o nombre, «sólo en la pared», desconectar sin perder nada… más las propias de Google):
- **Demoras:** los iPhone no reciben avisos al instante desde Google; con *Obtener datos → Cada 15 minutos* los cambios de la pared llegan al iPhone en hasta 15 minutos, y los del iPhone llegan a la pared en hasta 5 (o enseguida si alguien guarda un evento en el panel).
- **Avisos de cada persona:** los configura cada uno en Google Calendar → Familia → *Notificaciones de eventos* (y en el iPhone, *Alertas de eventos* activado para Familia). El panel no pone avisos.
- **Solo lectura:** quien tiene «Solo lectura» ve los eventos en su iPhone pero no los puede cambiar.
- **Si «Familia» no aparece en el iPhone** de una persona invitada: calendar.google.com/calendar/syncselect con su cuenta, en un computador → marcar Familia → Guardar. Al dueño le aparece solo.
- **Invitaciones de otras personas** (un evento en que otro es el organizador) se ven en la pared, pero se cambian en Google Calendar (si se cambian o borran en la pared, vuelven en esa misma sincronización, con un aviso que dice por qué).
- **Series con días cambiados uno por uno:** en la pared se puede cambiar el título, la nota o el lugar, o borrar un día; la hora o la repetición de toda la serie se cambian en el iPhone o en Google Calendar. Un día borrado en Google no se recupera desde la pared, y un día cambiado no se vuelve a la normalidad desde la pared (todo con aviso).
- **Notas con formato** (negritas, listas o enlaces hechos en calendar.google.com) se ven como texto en la pared; si la nota se edita en la pared, se pierde el formato. Los recordatorios, el enlace de Meet y los adjuntos se conservan (el panel nunca los manda).
- **Cumpleaños, «fuera de la oficina» y eventos de Gmail** no se muestran en la pared (por eso «Familia» es un calendario aparte y no el principal).
- **Un solo calendario conectado a la vez** (Google o iCloud), y la cuenta de servicio sirve a una sola familia del sitio.
- Un calendario muy grande (más de unos 10.000 eventos) se sincroniza sólo con la función programada, que tiene más tiempo.

**Cómo funciona:** [Calendar API v3](https://developers.google.com/workspace/calendar/api/v3/reference) con la cuenta de servicio (`servidor/google/`): el panel firma un JWT con la clave y lo cambia por un token en `oauth2.googleapis.com` (alcances `calendar.events` y `calendar.acls`), que vive sólo en la memoria de la función. El transporte cumple el mismo contrato que el cliente CalDAV de iCloud (`servidor/proveedores.ts`), así que el motor (`servidor/sincronizar.ts` y `servidor/ics.ts`) es el mismo: cada vuelta pide el listado completo (`singleEvents=false`; completo o error, nunca una parte, y sólo con permiso de editar), arma cada serie con sus días cambiados o borrados como un .ics, y traduce cada cambio de la pared a pedidos de la API (casi siempre un solo PATCH). Además:
- El id de cada evento de la pared sale de su UID (`cf` + base32hex), así crear es idempotente (un reintento da 409 en vez de un duplicado) y al volver a conectar se reconocen; si el id quedó ocupado por un evento borrado, se usa la «generación» siguiente.
- PATCH y DELETE van siempre con `If-Match` (412 = otro lo cambió antes: nunca se pisa un cambio a ciegas).
- Una serie con días cambiados se escribe en orden: primero sus días cambiados, después el evento principal y al final sus días «fantasma» (copias idénticas que Google a veces crea), que reciben el mismo cambio para seguir iguales a la serie (si Google ya les pasó parte del cambio, se releen y se les manda sólo lo que falta).
- Las fantasmas que no alcanzan en la vuelta quedan «rezagadas» (marca `extendedProperties.private.cfv` del principal): la pared no las muestra como días cambiados, el etag de la serie no las cuenta (así un borrado justo después no hace volver el evento) y se ponen al día al final de la vuelta o en la sincronización siguiente, que no toma el atajo mientras queden. Si Google no acepta poner una al día, se avisa y se anota en la marca como rechazada (con su etag): la pared sigue sin mostrarla (en Google y en los iPhone ese día queda con el valor de antes) y no se reintenta mientras nadie la toque ni la familia vuelva a cambiar desde la pared el título, la nota, el lugar o la duración de la serie (entonces se reintenta una vez; un cambio hecho en Google web o en el iPhone no la reintenta); el aviso se repite sólo si no se alcanzó a anotarla (Google falló o no quedaba tiempo). Si la marca no tiene espacio para anotarla, se borra entera y la pared muestra esas rezagadas como días cambiados, igual que Google.
- Cada escritura del panel deja una marca propia (`extendedProperties.private.cfh`), así una escritura del panel que quedó a medias no le gana a la pared en «gana el más reciente».
- Errores por motivo: un límite de uso (429, o 403 de cuota) se reintenta en la sincronización siguiente y nunca se toma como falta de permiso (eso revertiría la pared); un 403 desconocido también se reintenta. Invitar, quitar y «Probar» no reintentan solos.
- Las invitaciones son reglas de la ACL de «Familia» (`writer` = Editor, `reader` = Solo lectura) con `sendNotifications=true`, y se lee la regla antes de escribirla.

**Seguridad:**
- La clave vive sólo en la variable secreta `GOOGLE_CUENTA_SERVICIO` de Netlify: nunca en Blobs, en registros, en mensajes de error ni en el repositorio. Si se sube a GitHub, Google la deshabilita.
- Con «Realizar cambios y administrar el uso compartido», **quien tuviera la clave podría cambiar con quién se comparte «Familia»** (además de ver y cambiar sus eventos); por eso «Probar» lo recuerda. El panel nunca toca la regla del dueño ni la propia, nunca da el permiso de administrar (sólo Editor o Solo lectura) y no toca reglas que ya administran el calendario. La cuenta de servicio sólo ve los calendarios que se le compartieron.
- Para cortar el acceso de inmediato: deshabilitar la cuenta de servicio en Google Cloud (borrar la clave no invalida los tokens ya entregados, que duran hasta 1 hora) o dejar de compartirle «Familia».

**Probar en local** sin tocar Google: `pruebas/google/simulador-local.ts` levanta el simulador de la Calendar API (el mismo de las pruebas) en 127.0.0.1 con una clave de prueba recién generada (nunca una real) y un calendario «Familia» compartido con el panel, y corre el comando que va después de `--` con `GOOGLE_API_URL`, `GOOGLE_TOKEN_URL` y `GOOGLE_CUENTA_SERVICIO` apuntando a él:

```bash
npm run build
node --experimental-transform-types --no-warnings --import ./pruebas/registrar.mjs pruebas/google/simulador-local.ts \
  -- npx netlify-cli dev --offline --dir out --functions netlify/functions
```

En el panel, el ID es `c_familia@group.calendar.google.com`. `SIM_ROL=writer` lo comparte sin «administrar el uso compartido» (invitaciones a mano) y `SIM_VER=1` muestra cada pedido a la API. `GOOGLE_API_URL` y `GOOGLE_TOKEN_URL` son sólo para pruebas: el código las ignora si no son `http://127.0.0.1` o `http://localhost`. Las pruebas automáticas (simulador fiel de Google, cuenta de servicio, transporte, motor de punta a punta con el simulador, API, invitaciones) se corren con `bash pruebas/correr.sh` (o `bash pruebas/correr.sh google`); ver [`pruebas/README.md`](pruebas/README.md).

## Calendario de iCloud

**Alternativa a Google Calendar** (hay un solo calendario conectado a la vez). En *Familia* sólo aparece si el servidor tiene `ICLOUD_USUARIO` e `ICLOUD_CLAVE_APP` (o si ya estaba conectado).

**Qué hace:** el panel y el Calendario de los iPhone comparten un calendario de iCloud (“Familia”). Un evento creado o cambiado en la pared aparece en los iPhone (y avisa con las alertas de cada teléfono); uno creado o cambiado en el iPhone aparece en la pared. Borrar en un lado borra en el otro.

**Prepararlo (una vez):**
1. Un **Apple ID nuevo sólo para el panel** (account.apple.com). La app sólo entra a esa cuenta, nunca a las personales.
2. Con ese Apple ID, en iCloud.com → Calendario, crear **“Familia”** y compartirlo (permiso para editar) con el Apple ID de cada integrante.
3. Una **contraseña de app**: account.apple.com → Inicio de sesión y seguridad → Contraseñas de app → “Panel”.
4. En Netlify (proyecto `calendario-familiar-pared`) → *Project configuration → Environment variables*: `ICLOUD_USUARIO` (el Apple ID del panel) e `ICLOUD_CLAVE_APP` (la contraseña de app), marcadas como secretas si el plan lo permite; nunca en el repositorio ni en el chat. Volver a publicar para que las funciones las tomen.
5. En la app: *Familia → 📅 Calendario del iPhone → Elegir calendario* → “Familia” → *Conectar*. Se puede elegir si los eventos que ya estaban en la pared se suben o quedan sólo en la pared.

**Cómo se reparte entre personas:** al subir, el título lleva adelante el emoji de cada persona (“🦄 Dentista”); los eventos de todos van sin emoji. Al traer un evento del iPhone: emojis al inicio → esas personas; si no, el nombre en el título (“Fútbol Tomás”) o `@Tomás` en la nota; si no, es para todos.

**Reglas:**
- Se sincroniza cada 5 minutos (función programada `calendario-programado`) y 1,5 s después de guardar un evento en cualquier equipo.
- Si un evento se cambió en los dos lados, gana el cambio más reciente. Si en un lado se borró y en el otro se cambió, gana el cambio (nada se pierde).
- Si de una vez se borrarían muchos eventos (p. ej. al cargar un respaldo viejo o si iCloud devolviera el calendario vacío), no borra nada y pregunta en *Familia*: borrarlos también del otro lado o traerlos de vuelta. La respuesta vale sólo para los eventos que mostraba el aviso: si mientras tanto se borraron otros, vuelve a preguntar, y otro borrado masivo después también. Si iCloud está lento, la respuesta queda anotada y la aplica sola la sincronización siguiente.
- Si iCloud está lento o el calendario es muy grande, cada sincronización avanza lo que alcanza y sigue en la siguiente (la programada tiene más tiempo). Mientras quede algo del iPhone sin leer, no se suben eventos nuevos de la pared (podría ser su par y se duplicaría).
- En un calendario de sólo lectura, lo que se cambia o borra en la pared vuelve a quedar como en iCloud (con un aviso).
- Lo que el iPhone guarda y el panel no maneja (alertas, invitados, adjuntos, URL) se conserva: al actualizar sólo se cambia lo que se cambió en la pared.
- Repeticiones que el panel no sabe escribir (“el segundo martes de cada mes”, o series que vienen en otra zona horaria, como una invitación en UTC) se muestran en sus días, pero su repetición se cambia en el iPhone; en la pared se puede cambiar lo demás o borrar un día. Las que vienen en otra zona se ven con la hora de la primera vez (puede diferir en una hora entre invierno y verano).
- Un evento “para todos” sigue siéndolo al agregar una persona nueva a la familia.
- Cambiar “sólo este día” en el iPhone se ve en la pared como un evento aparte ese día.
- Un evento puede quedar **sólo en la pared** (interruptor en el editor).
- Desconectar deja los eventos en los dos lados; al volver a conectar se reconocen y no se duplican.

**Cómo funciona:** CalDAV contra `caldav.icloud.com` con el Apple ID y la contraseña de app (`servidor/caldav.ts`). Para cada evento (serie) se guarda en Blobs su ETag y una huella de cómo quedó la última vez que los dos lados coincidieron; así se sabe qué lado cambió. Se escribe siempre con `If-Match` / `If-None-Match` (nunca se pisa un cambio a ciegas) y los eventos nuevos usan UID `<id>@calendario-familiar`, así un reintento no duplica. Una sola sincronización a la vez por familia.

**Probar en local** sin tocar iCloud: un servidor CalDAV de prueba (p. ej. [Radicale](https://radicale.org)) y `ICLOUD_CALDAV_URL=http://127.0.0.1:5232/ ICLOUD_USUARIO=… ICLOUD_CLAVE_APP=… NODE_OPTIONS= npx netlify-cli dev --offline --dir out --functions netlify/functions`. `ICLOUD_CALDAV_URL` es sólo para pruebas.

## Dictar receta (Gemini)

**Qué hace:** en *📖 Recetas → 🎙️ Dictar receta* se cuenta una receta en voz alta, como se le explicaría a alguien en la cocina (cómo se llama, para cuántos alcanza, los ingredientes con sus cantidades aunque sean «al ojo», y los pasos), o se sube un audio que ya existe (nota de voz de WhatsApp, Notas de Voz, m4a, mp3…). Gemini (Google) la escucha y la deja como **borrador**, que alguien de la familia revisa antes de guardarla:
- las cantidades vagas («un puñado», «lo que pida») pasan a cantidades medibles marcadas **≈ estimada**, que se corrigen con un toque (y se ven con «≈» en la receta y en la vista previa de la lista de compras);
- cada ingrediente guarda cómo se dijo («Dijo: «un chorrito»»), y lo que Gemini no entendió queda en **❓ Dudas de Gemini**;
- el escalado por porciones lo sigue haciendo la app (exacto, sin IA); las porciones son **personas**: si se dice «salen como 40», Gemini estima para cuántas personas alcanza, deja «Salen como 40» en la nota y lo pregunta en las dudas;
- una receta dictada se puede volver a escuchar (▶️) y leer (*📝 Ver lo que se dijo*).

**Cómo se usa:**
1. El equipo tiene que estar en la nube (*Familia → ☁️ Compartir entre equipos*). En la pared con PIN, *Dictar* pide el PIN.
2. **⏺ Empezar a grabar** (el iPhone pide permiso para el micrófono; en la app de la pantalla de inicio lo pide cada vez que se abre) → *⏸ Pausa / ▶️ Seguir* → **⏹ Terminar**. Máximo 15 minutos: avisa cuando quedan 2 y si no se escucha nada; si entra una llamada o se sale de la app, se pausa y lo grabado queda a salvo. O **📎 Subir un audio**: en WhatsApp, mantener apretada la nota → *Reenviar* → *Compartir (↑)* → *Guardar en Archivos*, y elegirla desde Archivos.
3. Se ve el avance: *Guardado en este equipo → Guardado en la nube → Gemini está escribiendo… → ✅ ¡Lista!* (suele tardar menos de un minuto). Se puede cerrar la ventana: sigue sola, y el aviso de Recetas («🎙️ 1 lista para revisar →») abre la lista **🎙️ Dictadas**, en cualquier equipo de la familia.
4. **Revisar receta**: corregir lo marcado con ≈, responder las dudas (*✓ Resuelta*; las que queden se guardan con la receta) → **Guardar receta**. *Después* deja la revisión a medias en ese equipo y la retoma donde quedó. Si Gemini dice que no parece una receta: *Revisar igual* o *Pedir otra versión*. *🗑 Descartar* borra el audio y lo que escribió Gemini.

**Reglas:**
- Hasta 15 minutos y 4 MB por audio, y hasta 20 recetas dictadas sin revisar por familia. La nube lee la duración del propio audio (opus, webm, m4a, mp3, wav, flac, aac; lo que dura, aunque no parta en 0); si el equipo también la manda, la del audio sólo ataja uno claramente más largo (más de 16:30), y si no se puede saber y el equipo tampoco la sabe, el máximo es 1,8 MB.
- *Pedir otra versión* guarda el borrador anterior hasta que llega el nuevo: si Gemini falla, vuelve el de antes con el aviso «No se pudo hacer otra versión: …» (en la ventana, en 🎙️ Dictadas y en la revisión), y la app no la vuelve a pedir sola. Si falló por el audio mismo (Gemini no quiso procesarlo o no lo pudo leer), antes de pedirla de nuevo pregunta: lo más seguro es que dé lo mismo.
- Con el borrador ya en la ventana de dictar, *Revisar receta* se abre también sin internet; lo corregido queda en ese equipo (*Guardar receta* necesita la nube).
- Sin internet, el audio queda guardado en el equipo (IndexedDB) y se sube solo cuando vuelve, con la app abierta en cualquier pestaña (no hace falta tener Recetas a la vista).
- Si falta la clave, Google está saturado o se acabó la cuota del día, el audio espera en la nube y se pasa a receta solo después (la lista dice *⏳ Se reintenta sola* o *⏳ Esperando a Gemini*; ver *Cuando Google está saturado*). Lo que necesita a alguien (*⚠️ Necesita ayuda*: clave inválida, verificar la cuenta de Google, un formato que Gemini no lee…) dice qué hacer y trae *Intentar de nuevo*; mientras tanto el audio sigue guardado.
- Los audios y lo que se dijo quedan en la nube y **no van en el respaldo**. Al guardar la receta se conservan para escucharlos; al editarla, *🗑 Borrar el audio (la receta queda)*, y al borrar la receta se ofrece borrar también el audio.
- Los cupos del plan gratis no son públicos (unos 20 pedidos al día con 3.8 Flash, según terceros): cuando se acaban se usa el modelo siguiente y, si se acaban todos, se sigue al otro día.

**Privacidad (plan gratis de Gemini):** con el plan gratis, **Google puede usar lo que se le manda (los audios y lo que se dijo) para mejorar sus productos, y revisores humanos pueden leerlo y escucharlo**. La app lo avisa al dictar y en *Familia*. Mejor no decir datos personales (RUT, dirección, teléfonos). **Para pasarse al plan pagado** (Google no usa lo que se le manda): en aistudio.google.com → *API keys*, en el proyecto de la clave → *Set up billing* / *Upgrade* (con tarjeta, prepago). La misma clave pasa al plan pagado: no se cambia nada en el panel ni en Netlify. Cuesta unos centavos de dólar por receta (3.8 Flash: USD 0,75 por millón de tokens de entrada y 3,75 de salida hasta el 31 de diciembre de 2026, y el doble desde el 1 de enero de 2027; un minuto de audio son ≈ 1.900 tokens).

**Prepararlo (una vez; la familia ya lo hizo):**
1. En aistudio.google.com, con la cuenta de Google de un adulto: *Get API key → Create API key*.
2. En Netlify (proyecto `calendario-familiar-pared`) → *Project configuration → Environment variables*: **`GEMINI_API_KEY`**, marcada como secreta (*Contains secret values*), y volver a publicar. Nunca en el repositorio ni en el chat.
3. Comprobar: `/api/salud` dice `"gemini":"ok"` (nunca muestra la clave) y *Familia → 🎙️ Recetas por audio (Gemini) → Probar conexión* dice «✅ Conectado» (no gasta cuota).

Si la clave se filtra: borrarla en AI Studio, crear otra, reemplazar el valor en Netlify y volver a publicar; los audios que esperaban se pasan a receta solos. Variables opcionales: `GEMINI_MODELOS` (modelos en orden de preferencia, separados por coma, hasta 4; por omisión `gemini-3.8-flash,gemini-3.6-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite`: los modelos cambian seguido y, si Google retira uno, se cambia aquí sin tocar el código; uno que ya no existe da 404 y se salta solo) y `GEMINI_USAR_AI_GATEWAY=1` (sin `GEMINI_API_KEY` propia, Netlify AI Gateway pone su clave y cobra créditos de Netlify sin tope; el panel la detecta y no la usa salvo con esta variable).

**Cómo funciona** (`servidor/dictados.ts`, `servidor/gemini.ts`, `lib/dictados/`):
- **Subida:** la app inventa el id del dictado y guarda el audio en IndexedDB **antes** de subirlo. `PUT /api/dictados/:id` (un solo pedido, ≤ 4 MB: Netlify acepta ≈ 4,5 MB) es idempotente, así un reintento no duplica, y la copia del equipo se borra recién cuando la nube confirma. En la nube, el audio va al almacén `audios` de Blobs y el registro del dictado al de siempre. El tipo se reconoce por los bytes (WebM de Chrome, MP4/AAC de Safari como `audio/m4a`, Ogg de WhatsApp…), con un tipo alterno por si Gemini rechaza el primero.
- **Función en segundo plano:** Gemini no corre en la función que recibe el audio (tiene 60 s), sino en una *Background Function* (`dictados-proceso-background.mts`, hasta 15 min), que se dispara con `POST /api/dictados-proceso` y el mismo token del equipo. La corrida toma el dictado con ETag, un turno y un plazo de 14 minutos: dos disparos a la vez hacen un solo pedido, y un dictado descartado mientras Gemini escucha no revive. Si el disparo no llega, la app lo vuelve a pedir a los 30 s.
- **Gemini:** el audio va en línea por REST (`generateContent`, cabecera `x-goog-api-key`, nunca `?key=`) con la instrucción y el esquema JSON de `servidor/receta-ia/`; `normalizar-receta.ts` revisa todo lo que vuelve, y la receta queda con id `rec_<id del dictado>`. Los modelos son los de `GEMINI_MODELOS`, en orden.
- **Reintentos** dentro de una corrida (hasta 12 pedidos y 12 minutos), dando vueltas por los modelos en orden: si uno está ocupado (503 «high demand», otro 5xx, la red o una demora) o se le acabó el cupo por minuto (429), se pasa **de inmediato** al siguiente; recién cuando se probaron todos se espera (≈ 10 s después de la primera vuelta y ≈ 30 s después de las otras; un 429 por minuto, nunca menos de lo que dice Google, 2–60 s) y se da otra vuelta. Un modelo que no existe (404), que se quedó sin la cuota del día o que rechaza el pedido (un 400 que no se entiende, p. ej. un campo que ese modelo no acepta) queda fuera de esa corrida y se sigue con los demás; si todos dan 400, recién ahí es un error del panel. Si todos se quedaron sin cuota, el dictado espera hasta la medianoche del Pacífico (entre las 03:00 y las 05:00 de Chile, según la época). Cada corrida deja en el registro de la función una línea con lo que pasó con cada modelo (`gemini resumen (12 pedidos → ocupado): gemini-3.8-flash: ocupado 503, …`), sin la clave. Una respuesta cortada que trae la transcripción se rescata como borrador, con aviso. Lo que no se pudo queda en el dictado como error con su motivo; la app lo vuelve a pedir sola cuando corresponde (con un tope de intentos, para no gastar la cuota en un audio que falla siempre) y la familia ve el resto en la lista.
- **Modelos:** por omisión `gemini-3.8-flash` (el más nuevo) y de respaldo los «Stable» `gemini-3.6-flash`, `gemini-3.5-flash-lite` y `gemini-3.1-flash-lite` (este último deprecado: Google lo apaga no antes del 7 de mayo de 2027; cuando ya no esté, da 404 y se salta). Los cuatro aceptan el mismo pedido según la documentación de Google: audio en línea, salida estructurada y `thinkingLevel: "low"` (`"minimal"` da error en 3.8). La familia 2.5 no se usa (deprecada y sólo para quienes ya la usaban) y la 2.0 está apagada.
- **Dónde queda cada cosa:** la transcripción va en Blobs (`audios`, `<familia>/<id>.texto`) y no dentro de la receta, para que la colección `recetas`, que todos los equipos bajan entera, no crezca. El dictado existe hasta que se guarda o se descarta. La clave vive sólo en la variable de Netlify: nunca en Blobs, registros ni respuestas (`sanear()` la quita de todo lo que viene de Google). Los equipos con la versión anterior: ver *Datos*.

**Cuando Google está saturado** (`503 UNAVAILABLE` «This model is currently experiencing high demand…»): es un problema de Google y de cada modelo, no del panel, y no gasta la cuota (Google no atendió el pedido). Por eso la corrida prueba los cuatro modelos al tiro antes de esperar. Si en los 12 pedidos ninguno respondió, el dictado queda *⏳ Se reintenta sola* con el mensaje «Gemini (Google) está saturado en este momento: no es un error del panel…» y la app lo vuelve a pedir sola: a los **3 minutos** (los picos suelen pasar pronto), después a los 10, a los 20 y luego cada 30, hasta 8 corridas (unas 2 horas y media); después dice *⚠️ Necesita ayuda* y se pide con *Intentar de nuevo*. El audio sigue guardado todo el tiempo. **Pagar no evita estos 503**: Google no publica que el plan pagado normal tenga prioridad sobre el gratis cuando hay alta demanda, ni cifras. Lo que sí documenta es un nivel aparte, *Priority* (pagado, más caro, en vista previa y sólo en la Interactions API; el panel no lo usa), que va por encima del tráfico estándar. Lo que el plan pagado sí da: límites más altos y que Google no use los audios.

**Probar en local** sin clave real ni red: el simulador de Gemini (`pruebas/recetas/mock-gemini.mts`, el mismo de las pruebas) en 127.0.0.1, con una clave de prueba:

```bash
npm run build
node --experimental-transform-types --no-warnings --import ./pruebas/registrar.mjs pruebas/recetas/mock-gemini.mts --puerto 8787 --clave clave-de-prueba &
GEMINI_API_KEY=clave-de-prueba GEMINI_API_URL=http://127.0.0.1:8787 NODE_OPTIONS= npx netlify-cli dev --offline --dir out --functions netlify/functions
```

`GEMINI_API_URL` es sólo para pruebas: el código la ignora si no es `http://127.0.0.1` o `http://localhost` (una variable mal puesta no puede mandar la clave a otro sitio), y sólo entonces vale `GEMINI_TIMEOUT_MS`. Al simulador se le piden errores con `POST /__guion` (p. ej. `[{"modelo":"*","accion":"429dia"}]`, o por modelo: `[{"modelo":"gemini-3.8-flash","accion":"503"}]`; las acciones están al comienzo del archivo); `--mimes-extra audio/mp4` y `--sin-response-format` imitan otras respuestas de Google. Las pruebas automáticas (formatos de audio, Gemini con el simulador, la API y la corrida con un reloj falso, datos con equipos viejos y nuevos, cliente y lo automático, grabadora con un navegador falso) se corren con `bash pruebas/correr.sh recetas`. La prueba en el navegador es manual: `npm run build && node --experimental-transform-types --no-warnings --import ./pruebas/registrar.mjs pruebas/recetas/navegador.e2e.mjs --puerto 8900` (Chrome con micrófono falso, un tablet y un iPhone de la misma familia, `netlify dev` con las funciones reales; necesita Chrome, Playwright, ffmpeg y netlify-cli; usa los puertos N y N+1; `--capturas <carpeta> --prefijo r2-` guarda ahí las capturas con ese prefijo).

## Modo kiosko en el tablet

Pasos comunes, en cualquier tablet:

1. Abre https://calendario-familiar-pared.netlify.app en el tablet.
2. Únela a la familia: en otro equipo ya unido, *Familia → Compartir entre equipos → 📲 Invitar otro equipo*, y en el tablet *Unirme con un código* (la franja de arriba). **En el iPad, haz primero el paso 1 de la sección iPad (agregarla a la pantalla de inicio) y únete desde el ícono**: unirse antes en Safari gasta el código y el ícono queda sin unir. Si es el primer equipo, configúrala ahí y crea la familia en la nube. En *Familia → Este equipo* revisa que diga **Pantalla de la pared**.
3. Deja el tablet **enchufado** siempre y en **horizontal**.
4. Desactiva las actualizaciones automáticas de sistema en horario nocturno si el tablet se reinicia solo.

La app ya pide que la pantalla no se apague (Wake Lock), pero cada sistema tiene su propio bloqueo; por eso abajo se ajusta también.

### iPad — Acceso Guiado + Safari a pantalla completa

1. **Agregar a inicio (pantalla completa):** abre la dirección en Safari → botón Compartir → **Agregar a pantalla de inicio**. Ábrela desde ese ícono: se ve sin barras de Safari, como app. **Une el iPad a la familia desde el ícono** (*Unirme con un código*, escribiendo el código): el ícono no comparte lo de Safari, así que unirse en Safari o con el QR de la Cámara no lo une.
2. **Que la pantalla no se apague:** *Ajustes → Pantalla y brillo → Bloqueo automático → Nunca*. (Con Acceso Guiado activo además puedes fijar el tiempo en *Nunca* dentro de sus opciones.)
3. **Acceso Guiado:** *Ajustes → Accesibilidad → Acceso Guiado* → actívalo, define un **código** y en *Bloqueo automático* elige **Nunca**.
4. Abre la app desde el ícono y presiona **3 veces el botón lateral** (o el botón de inicio) → **Acceso Guiado** → en *Opciones* deja activado *Tocar* y desactiva *Botones de volumen* / *Bloqueo* si quieres → **Iniciar**.
5. Para salir: 3 clics al botón y el código.

El botón ⛶ del riel lateral pone pantalla completa en el navegador, pero el navegador la quita en cada recarga (la de las 03:30 incluida); por eso conviene abrirla desde el ícono de inicio, que ya es pantalla completa.

Volver sola a la app: con Acceso Guiado el iPad **no puede salir** de la app, así que siempre está ahí. Si se corta la luz y se reinicia, iPadOS no reabre la app sola: hay que abrirla y activar Acceso Guiado de nuevo (para eso existe MDM, ver al final).

### Android — fijar pantalla o app de kiosko + Chrome

**Opción simple (gratis): fijar pantalla**

1. Abre la dirección en Chrome → menú ⋮ → **Agregar a pantalla principal / Instalar app**. Se abre en pantalla completa como app.
2. *Ajustes → Pantalla → Tiempo de espera de pantalla* → lo máximo. Para que no se apague nunca mientras carga: *Ajustes → Sistema → Opciones de desarrollador* (se activan tocando 7 veces *Número de compilación* en *Acerca del teléfono*) → **Pantalla activa** / *Stay awake*.
3. *Ajustes → Seguridad → Fijar aplicaciones* (o *Fijar pantalla*) → activar.
4. Abre la app, ve a **Recientes**, toca el ícono de la app → **Fijar**.
5. Para salir: mantener *Atrás* + *Recientes* (o deslizar arriba y mantener, según la marca).

Limitación: si el tablet se reinicia, no vuelve sola a la app.

**Opción completa: app de kiosko** — por ejemplo **Fully Kiosk Browser** (la más usada para paneles de pared; licencia Plus pagada única para algunas funciones), o **SureLock**/**Kiosk Browser Lockdown**:

1. Instala Fully Kiosk Browser desde Google Play.
2. *Start URL* = la dirección de la app.
3. *Web Content Settings* → activar JavaScript y localStorage (vienen activados).
4. *Device Management* → **Keep Screen On** ✔, **Launch on Boot** ✔ (vuelve sola al encender), *Unlock Screen* ✔.
5. *Kiosk Mode* (Plus) → **Enable Kiosk Mode** con PIN: bloquea la barra de notificaciones y el botón inicio.
6. Opcional: *Screensaver* / *Screen Off Timer* para apagar de noche y *Motion Detection* para encender al pasar alguien (usa la cámara).
7. Opcional: hazla **launcher predeterminado** (*Ajustes de Android → Apps → Apps predeterminadas → Pantalla principal → Fully Kiosk*): así el botón Inicio siempre vuelve a la app.

### Fire tablet (Amazon)

Los Fire usan **Silk** como navegador y Fire OS (Android sin Google Play).

1. **Pantalla siempre encendida:** *Configuración → Pantalla → Tiempo de espera de pantalla → Nunca* (si no aparece *Nunca*, actívalo en *Opciones de desarrollador → Permanecer activo*; para verlas, toca 7 veces *Número de serie* en *Opciones del dispositivo → Acerca del tablet Fire*).
2. **Sólo con Silk:** abre la dirección → menú → **Agregar a la pantalla de inicio**, ábrela desde ahí y usa *Fijar pantalla*: *Configuración → Seguridad y privacidad → Fijación de pantalla* → activar; luego en Recientes, fijar la app.
3. **Amazon Kids (Kids+ / Perfil infantil):** sirve para *restringir* el tablet a contenidos aprobados, y en el perfil infantil puedes aprobar **un sitio web** en *Contenido y suscripciones → Agregar contenido → Sitios web*. Ojo: el navegador infantil abre la página con su propio marco y a veces sin todas las funciones (pantalla completa, guardar datos); úsalo sólo si quieres que los niños no salgan de ahí. Para un panel de pared es mejor la siguiente opción.
4. **App de kiosko (recomendado):** Fully Kiosk Browser no está en la Appstore de Amazon: se instala el APK desde su web oficial (*Configuración → Seguridad → Apps de fuentes desconocidas* → permitir a Silk). Luego configura igual que en Android: *Start URL*, **Keep Screen On**, **Launch on Boot**, **Kiosk Mode**. Así vuelve sola a la app al reiniciar.

### Si necesitas más control

Para varios tablets o para que un iPad vuelva solo a la app tras un corte de luz, se usa un **MDM** (Apple Business Manager + Jamf/Mosyle para iPad en *Modo App Única*; Android Enterprise para Android). Es más trabajo y en general no vale la pena para una sola casa.
