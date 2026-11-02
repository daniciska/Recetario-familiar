# Calendario familiar

Panel de pared para un tablet en horizontal: calendario semanal por persona, **menú de la semana con recetas**, lista de compras que se arma sola, y tareas de la casa. También se usa desde el teléfono.

Next.js + TypeScript + Tailwind. Todo en español de Chile: 24 h, zona `America/Santiago`, semana de lunes a domingo, unidades métricas.

## Qué trae

| Pestaña | Qué hace |
|---|---|
| 📅 Calendario | Semana (por defecto), mes y día. Cada persona tiene su color; los eventos compartidos se ven con franjas de varios colores. Filtro por persona. Eventos con repetición diaria / semanal / mensual / anual (cumpleaños), fecha de término opcional, y borrar “sólo este día”. **Cuenta regresiva**: un evento marcado así se ve arriba, bajo la fecha (“⏳ En 5 días · Cumple de la Tía Ana”). Clima de cada día y la comida al pie de cada columna. |
| 🍽️ Menú | Grilla lunes–domingo × desayuno / colación / almuerzo / once / cena (la colación trae atajos propios: fruta, yogur, sándwich…). Se asigna una receta (con porciones por día) o un texto libre (“Sobras”, “Comemos fuera”). “Repetir semana” copia la anterior. **Generar lista de compras** junta los ingredientes de la semana, escala por porciones, suma iguales (g+kg, ml+l), y los manda a Compras agrupados por categoría. |
| 📖 Recetas | CRUD completo: nombre, foto (se reduce sola) o ícono, porciones, minutos, ingredientes (cantidad + unidad + ingrediente + categoría, que se adivina por el nombre) y pasos. Vista de cocina con porciones ajustables y pasos que se tachan al tocarlos. |
| 🛒 Compras | Agrupada por categoría (Verduras y frutas, Carnes y pescados, Lácteos y huevos…). Agregar a mano (“2 kg papas” entiende la cantidad). Marcar comprado, sacar comprados. Regenerar la lista de la semana reemplaza sólo lo que vino del menú y aún no se compra. |
| ✅ Tareas | Quehaceres de hoy: en el tablet, una columna por persona. Pueden ser de una vez, de todos los días o de algunos días, con momento (mañana / tarde / noche). Cada uno puede dar **estrellas** ⭐ a quien lo hace (si es “Quien pueda”, se elige quién lo hizo); con las estrellas se **canjean premios** (🏆 Premios). |
| ⚙️ Familia | Integrantes (nombre, color, emoji), nombre de la familia, ciudad del clima, tema claro / noche / automático por horario, **“Este equipo: pantalla de la pared / teléfono”**, **PIN para hacer cambios**, respaldo (descargar / cargar) y volver a los datos de ejemplo. |

Para la pared: reloj en vivo, día de hoy resaltado (a medianoche pasa solo al día y la semana nuevos), modo noche automático (por defecto 20:30–07:00, sin destello al recargar de noche), la pantalla se mantiene encendida (Wake Lock) y se recarga sola cada madrugada a las 03:30 para tomar versiones nuevas. La recarga sólo ocurre si hay internet, nadie tocó la pantalla en los últimos 2 minutos y no hay ninguna ventana abierta (una receta mientras se cocina, un formulario); si no, lo reintenta cada 5 minutos. La única excepción: una ventana que quedó abierta de madrugada sin que nadie la toque en una hora se da por olvidada y se cierra con la recarga.

**Vuelta sola al calendario:** en el equipo marcado como *pantalla de la pared* (Familia → Este equipo), si nadie lo toca en 5 minutos vuelve al calendario de esta semana. No lo hace si hay una ventana abierta (una receta mientras se cocina, un formulario a medio llenar). En el teléfono no ocurre nunca. Un tablet táctil grande y apaisado se marca solo como pantalla de pared; se puede cambiar a mano.

**PIN:** con un PIN definido (Familia → PIN), la pantalla de la pared lo pide para crear o cambiar eventos, el menú y las recetas, administrar quehaceres y premios, canjear premios y entrar a Familia. Mirar todo, marcar quehaceres y agregar a Compras no lo piden. Queda abierto 5 minutos. El teléfono no lo pide (se puede cambiar por equipo). Es un candado para la casa, no seguridad.

Lo que falta (datos compartidos entre equipos, calendario de iCloud, correo dedicado, recetas por audio con Gemini, fotos) está en [`PLAN.md`](PLAN.md).

## Correrlo

```bash
cd calendario
npm install
npm run dev        # http://localhost:3000
npm run build      # versión de producción en out/ (archivos estáticos)
```

## Publicarlo

**Publicado en Netlify:** https://calendario-familiar-pared.netlify.app (proyecto `calendario-familiar-pared`, sitio aparte del recetario, oculto para buscadores).

La app se exporta como archivos estáticos (`output: "export"` en `next.config.ts`, carpeta `out/`): no necesita servidor ni funciones.

Para que cada cambio se publique solo: en Netlify, *Project configuration → Build & deploy → Continuous deployment → Link repository*, este repositorio, rama `claude/recetario-familiar`, **Base directory** = `calendario` (el `netlify.toml` de esta carpeta ya trae el comando y la carpeta `out`). Desde ahí, cada push que toque `calendario/` se publica solo; los cambios del recetario no lo gatillan.

**Vercel** (alternativa): *Add New → Project*, elige este repositorio y en **Root Directory** pon `calendario`.

## Datos

Hoy los datos viven en el `localStorage` **de cada dispositivo**: lo que cambias en el teléfono no aparece en el tablet. Para mover los datos usa *Familia → Descargar respaldo / Cargar respaldo*. Un respaldo dañado o incompleto se revisa antes de cargarlo y nunca deja la app caída; si el almacenamiento se llena (fotos), la app avisa y no da por guardado lo que no se guardó.

Para compartirlos de verdad hay que conectar una base de datos. La app sólo habla con la interfaz `Repositorio` (`lib/datos/repositorio.ts`): se escribe otra implementación (Supabase, Firebase, una API propia) y se cambia una línea en `lib/datos/index.ts`. El método `suscribir` está pensado para recibir cambios en vivo de otros dispositivos. Si el tablet y el teléfono van a escribir a la vez, conviene que esa implementación mezcle los cambios por elemento (por `id`) en vez de reemplazar colecciones completas.

```
lib/datos/tipos.ts            modelo (Miembro, Evento, Receta, ItemCompra, Tarea…)
lib/datos/repositorio.ts      interfaz de almacenamiento
lib/datos/repositorioLocal.ts implementación con localStorage
lib/datos/normalizar.ts       revisa y repara datos guardados o respaldos
lib/compras.ts                categorías, unidades, suma de ingredientes
lib/fechas.ts                 fechas en America/Santiago, semana lunes–domingo
lib/eventos.ts                repeticiones
lib/ejemplo.ts                familia de 4, eventos y 6 recetas chilenas de ejemplo
components/                   las vistas
```

## Modo kiosko en el tablet

Pasos comunes, en cualquier tablet:

1. Abre https://calendario-familiar-pared.netlify.app en el tablet.
2. Configúrala **en ese tablet** (integrantes, recetas): los datos quedan guardados ahí. En *Familia → Este equipo* revisa que diga **Pantalla de la pared**.
3. Deja el tablet **enchufado** siempre y en **horizontal**.
4. Desactiva las actualizaciones automáticas de sistema en horario nocturno si el tablet se reinicia solo.

La app ya pide que la pantalla no se apague (Wake Lock), pero cada sistema tiene su propio bloqueo; por eso abajo se ajusta también.

### iPad — Acceso Guiado + Safari a pantalla completa

1. **Agregar a inicio (pantalla completa):** abre la dirección en Safari → botón Compartir → **Agregar a pantalla de inicio**. Ábrela desde ese ícono: se ve sin barras de Safari, como app.
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
