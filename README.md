# Las recetas de la Ñaña

Un recetario familiar hecho con la voz de la mamá. Cada receta guarda **su audio original** y además una versión **pasada en limpio**, con ingredientes, pasos, sus secretos y sus frases, para que sus hijos puedan cocinar como ella.

## Cómo se agrega una receta

1. Graba a la mamá contando la receta (una nota de voz de WhatsApp sirve perfecto). Si se alarga en varios audios, no importa.
2. Sube el audio a la carpeta **`audios_nuevos`** de este repositorio en GitHub (desde el celular: abre la carpeta → *Add file* → *Upload files*).
   - Si puedes, ponle al archivo el nombre del plato: `Pastel de choclo.ogg`.
   - Si la receta vino en varios audios, crea una carpeta con el nombre del plato y súbelos todos ahí.
3. En unos minutos, GitHub transcribe el audio y crea la receta. La página se actualiza sola.

Si todavía no configuraste la clave de Claude (paso 3 de la instalación), la receta aparecerá como **"en preparación"**, con el audio y la transcripción. Para pasarla en limpio, abre Claude Code en este repositorio y pídele: *"adapta las recetas pendientes"*.

## Instalación (una sola vez)

### 1. Repositorio privado
Deja este repositorio en **privado** en GitHub (Settings → General → Danger Zone → Change visibility). Así los audios no quedan públicos.

### 2. Publicar la página solo para la familia — Cloudflare (gratis)
1. Crea una cuenta en [cloudflare.com](https://dash.cloudflare.com/sign-up).
2. *Workers & Pages* → *Create* → *Pages* → *Connect to Git* → elige este repositorio. Sin comando de compilación; carpeta de salida: `/`. Te dará una dirección tipo `recetas-mama.pages.dev`.
3. Para que solo entren tus hermanos: *Zero Trust* → *Access* → *Applications* → *Add an application* → *Self-hosted*, con la dirección de tu página. En la regla, elige *Emails* y escribe los correos de cada hermano.
   Cuando alguien abra el enlace, le llegará un código a su correo para entrar. Nadie más puede verla.

Cada vez que se agrega una receta, Cloudflare vuelve a publicar la página automáticamente.

### 3. (Opcional) Que las recetas se pasen en limpio solas
En GitHub: *Settings → Secrets and variables → Actions → New repository secret*
- Nombre: `ANTHROPIC_API_KEY`
- Valor: tu clave de [console.anthropic.com](https://console.anthropic.com) (se paga por uso; una receta cuesta centavos de dólar).

### 4. Personalizar
Edita `config.json`: el título del recetario, cómo llaman a la mamá (`"cocinera"`), la dedicatoria y la firma.

Borra la carpeta `recetas/ejemplo-porotos-granados` cuando subas la primera receta real, y actualiza el índice (la próxima vez que se suba un audio se actualiza solo).

## Qué tiene cada receta

- 🎙️ Sus audios, para escucharla, y el archivo original para descargar.
- Ingredientes con cantidades claras, y al lado **cómo lo dice ella** ("un puñadito", "a ojo").
- Pasos numerados (se pueden ir marcando mientras cocinas; la pantalla no se apaga).
- ✨ Sus secretos y sus frases, escritas a mano.
- ❓ **Para preguntarle**: lo que no quedó claro en el audio. Una buena excusa para llamarla.
- La transcripción completa, palabra por palabra.
- Botones para compartir e imprimir.

## Ideas para las grabaciones

- Pídele que cuente también **de quién aprendió** la receta y **para quién la hacía**: eso queda en la historia.
- Grábala mientras cocina de verdad: salen los trucos que de memoria se olvidan.
- Pregúntale las medidas: "¿cuánto es un puñadito?", "¿cómo sabes que está listo?".
