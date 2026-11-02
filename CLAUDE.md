# Recetario familiar

Página web estática (sin compilación) que guarda las recetas de la mamá a partir de sus audios.

- `index.html`, `estilos.css`, `app.js`: la página. Lee `config.json`, `recetas/indice.json` y `recetas/<slug>/receta.json`.
- `audios_nuevos/`: bandeja de entrada. Un archivo = una receta; una carpeta con varios audios = una receta en varias partes.
- `herramientas/procesar.py`: guarda el original en `recetas/<slug>/originales/`, crea `audio-NN.mp3`, transcribe con Whisper y, si hay `ANTHROPIC_API_KEY`, adapta con Claude. Siempre regenera `recetas/indice.json`.
- `herramientas/instrucciones_receta.md`: criterios para adaptar una receta. Síguelos siempre.
- `.github/workflows/procesar-audios.yml`: corre el script al subir audios.

## Cuando pidan "adaptar las recetas pendientes" (o "pasar en limpio")

1. Busca `recetas/*/receta.json` con `"estado": "pendiente"`.
2. Con la `transcripcion`, completa los campos siguiendo `herramientas/instrucciones_receta.md`: `titulo`, `subtitulo`, `categoria` (una de las de `CATEGORIAS` en `procesar.py`), `porciones`, `tiempo`, `dificultad` (Fácil / Media / Con paciencia), `historia`, `ingredientes` (`cantidad`, `ingrediente`, `como_lo_dice_mama`), `pasos`, `secretos`, `frases`, `dudas`. Pon `"estado": "lista"`.
3. No inventes nada que no esté en la transcripción; lo que falte va a `dudas`. Nunca modifiques `transcripcion` ni los audios.
4. Si la carpeta tiene un nombre sin sentido (p. ej. `ptt-20260930-wa0001`), renómbrala con `git mv` al slug del título y actualiza `slug`.
5. Ejecuta `python herramientas/procesar.py --indice` y haz commit.

La transcripción con Whisper necesita descargar el modelo desde huggingface.co; si la red del entorno lo bloquea, deja que lo haga la GitHub Action.

## `calendario/` (app aparte)

Panel familiar de pared (Next.js + TypeScript + Tailwind): calendario, menú semanal con recetas, lista de compras automática y tareas. Es independiente del recetario estático y se publica como un sitio aparte (Root/Base directory = `calendario`). Ver `calendario/README.md`. Para verificar cambios: `cd calendario && npx tsc --noEmit && npm run build`.

Publicado en Netlify (proyecto `calendario-familiar-pared`, exportación estática en `calendario/out`). Lo que falta (Supabase, iCloud, correo dedicado, recetas por audio con Gemini, fotos) y las decisiones de la familia están en `calendario/PLAN.md`: síguelo cuando pidan continuar con el calendario. Nunca pidas ni guardes en el repositorio contraseñas de app de Apple ni claves de Gemini: van en los secretos de Supabase.
