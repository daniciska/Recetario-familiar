"""
Convierte los audios de mamá en recetas para el recetario familiar.

Qué hace, para cada audio (o carpeta de audios) dentro de `audios_nuevos/`:
  1. Guarda el audio original tal cual, sin tocarlo.
  2. Crea una copia .mp3 que se escucha en cualquier teléfono.
  3. Transcribe lo que dice mamá (Whisper, gratis, funciona sin internet
     una vez descargado el modelo).
  4. Si hay una clave ANTHROPIC_API_KEY, Claude convierte la transcripción
     en una receta bonita y ordenada. Si no la hay, la receta queda
     "pendiente" y se puede terminar pidiéndoselo a Claude Code.
  5. Actualiza recetas/indice.json, que es lo que lee la página.

Uso:
    python herramientas/procesar.py              # procesa audios_nuevos/
    python herramientas/procesar.py --adaptar    # (re)adapta recetas pendientes
    python herramientas/procesar.py --indice     # solo regenera el índice
"""

import argparse
import datetime
import json
import os
import re
import shutil
import subprocess
import sys
import unicodedata
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
ENTRADA = RAIZ / "audios_nuevos"
RECETAS = RAIZ / "recetas"
EXTENSIONES = {".ogg", ".opus", ".mp3", ".m4a", ".aac", ".wav", ".webm", ".amr", ".3gp", ".mp4", ".flac"}
CATEGORIAS = ["Entradas", "Sopas y cazuelas", "Platos de fondo", "Acompañamientos",
              "Masas y panes", "Postres", "Dulces y conservas", "Salsas", "Bebidas", "Otros"]


# ---------------------------------------------------------------- utilidades

def slugify(texto):
    texto = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode()
    texto = re.sub(r"[^a-zA-Z0-9]+", "-", texto).strip("-").lower()
    return texto or "receta"


def titulo_provisorio(nombre):
    # Los audios de WhatsApp llegan como "PTT-20260930-WA0001": eso no es un título.
    if re.match(r"^(PTT|AUD|WhatsApp|audio|nota|grabaci)", nombre, re.I) or not re.search(r"[a-zA-Z]{3}", nombre):
        return "Receta nueva (sin nombre aún)"
    return nombre.replace("-", " ").replace("_", " ").strip().capitalize()


def slug_libre(base):
    slug, n = base, 2
    while (RECETAS / slug).exists():
        slug, n = f"{base}-{n}", n + 1
    return slug


def ffmpeg():
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def a_mp3(origen, destino):
    subprocess.run([ffmpeg(), "-y", "-loglevel", "error", "-i", str(origen),
                    "-vn", "-ac", "1", "-b:a", "96k", str(destino)], check=True)


def duracion(ruta):
    import av
    with av.open(str(ruta)) as f:
        return round(f.duration / 1_000_000) if f.duration else None


_modelo = None


def transcribir(ruta):
    global _modelo
    from faster_whisper import WhisperModel
    if _modelo is None:
        nombre = os.environ.get("WHISPER_MODELO", "small")
        print(f"  · cargando modelo Whisper '{nombre}'…")
        _modelo = WhisperModel(nombre, device="cpu", compute_type="int8")
    segmentos, _ = _modelo.transcribe(str(ruta), language="es", vad_filter=True,
                                      initial_prompt="Receta de cocina casera chilena contada por una mamá.")
    return " ".join(s.text.strip() for s in segmentos).strip()


def leer(ruta):
    return json.loads(ruta.read_text(encoding="utf-8"))


def escribir(ruta, datos):
    ruta.write_text(json.dumps(datos, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


# ------------------------------------------------------------ adaptar con IA

ESQUEMA = {
    "type": "object",
    "properties": {
        "titulo": {"type": "string"},
        "subtitulo": {"type": "string"},
        "categoria": {"type": "string", "enum": CATEGORIAS},
        "porciones": {"type": "string"},
        "tiempo": {"type": "string"},
        "dificultad": {"type": "string", "enum": ["Fácil", "Media", "Con paciencia"]},
        "historia": {"type": "string"},
        "ingredientes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "cantidad": {"type": "string"},
                    "ingrediente": {"type": "string"},
                    "como_lo_dice_mama": {"type": "string"},
                },
                "required": ["cantidad", "ingrediente", "como_lo_dice_mama"],
                "additionalProperties": False,
            },
        },
        "pasos": {"type": "array", "items": {"type": "string"}},
        "secretos": {"type": "array", "items": {"type": "string"}},
        "frases": {"type": "array", "items": {"type": "string"}},
        "dudas": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["titulo", "subtitulo", "categoria", "porciones", "tiempo", "dificultad", "historia",
                 "ingredientes", "pasos", "secretos", "frases", "dudas"],
    "additionalProperties": False,
}

INSTRUCCIONES = (RAIZ / "herramientas" / "instrucciones_receta.md").read_text(encoding="utf-8")


def adaptar(receta):
    """Pide a Claude que convierta la transcripción en una receta. Devuelve True si lo logró."""
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return False
    import anthropic

    config = leer(RAIZ / "config.json")
    client = anthropic.Anthropic()
    pista = f"Nombre que le dieron al audio: {receta['nombre_archivo']}\n" if receta.get("nombre_archivo") else ""
    mensaje = (f"{pista}Quien cocina: {config.get('cocinera', 'mamá')}\n\n"
               f"Transcripción del audio:\n<transcripcion>\n{receta['transcripcion']}\n</transcripcion>")
    try:
        with client.beta.messages.stream(
            model="claude-opus-5-5",
            max_tokens=64000,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            output_config={"effort": "high", "format": {"type": "json_schema", "schema": ESQUEMA}},
            system=INSTRUCCIONES,
            messages=[{"role": "user", "content": mensaje}],
        ) as stream:
            respuesta = stream.get_final_message()
    except anthropic.APIStatusError as e:
        print(f"  ! Claude respondió con error {e.status_code}: {e.message}")
        return False
    except anthropic.APIConnectionError:
        print("  ! No se pudo conectar con Claude")
        return False

    if respuesta.stop_reason != "end_turn":
        print(f"  ! Claude no terminó la receta (motivo: {respuesta.stop_reason})")
        return False
    texto = next(b.text for b in respuesta.content if b.type == "text")
    receta.update(json.loads(texto))
    receta["estado"] = "lista"
    return True


# ------------------------------------------------------------------ proceso

def procesar_entrada(item):
    """`item` es un archivo de audio o una carpeta con varios audios de una misma receta."""
    if item.is_dir():
        archivos = sorted(p for p in item.iterdir() if p.suffix.lower() in EXTENSIONES)
    else:
        archivos = [item]
    if not archivos:
        return None

    nombre = item.stem if item.is_file() else item.name
    slug = slug_libre(slugify(nombre))
    carpeta = RECETAS / slug
    (carpeta / "originales").mkdir(parents=True)
    print(f"→ {nombre}  ({len(archivos)} audio{'s' if len(archivos) > 1 else ''}) → recetas/{slug}")

    audios, textos = [], []
    for i, archivo in enumerate(archivos, 1):
        original = carpeta / "originales" / f"{i:02d}{archivo.suffix.lower()}"
        shutil.copy2(archivo, original)
        mp3 = carpeta / f"audio-{i:02d}.mp3"
        a_mp3(original, mp3)
        print(f"  · transcribiendo audio {i}…")
        textos.append(transcribir(mp3))
        audios.append({"archivo": mp3.name, "original": f"originales/{original.name}", "segundos": duracion(mp3)})

    receta = {
        "slug": slug,
        "titulo": titulo_provisorio(nombre),
        "nombre_archivo": nombre,
        "fecha": datetime.date.today().isoformat(),
        "audios": audios,
        "transcripcion": "\n\n".join(textos),
        "estado": "pendiente",
    }
    if adaptar(receta):
        print("  ✓ receta adaptada por Claude")
        # Si el audio venía con un nombre tipo "PTT-20260930-WA0001", usar el título real en la dirección.
        nuevo = slugify(receta["titulo"])
        if nuevo != slug and not (RECETAS / nuevo).exists():
            carpeta = carpeta.rename(RECETAS / nuevo)
            receta["slug"] = slug = nuevo
    else:
        print("  · receta guardada como PENDIENTE (falta adaptarla)")
    escribir(carpeta / "receta.json", receta)

    # El audio ya quedó guardado dentro de recetas/, se retira de la bandeja de entrada.
    shutil.rmtree(item) if item.is_dir() else item.unlink()
    return slug


def adaptar_pendientes():
    for ruta in sorted(RECETAS.glob("*/receta.json")):
        receta = leer(ruta)
        if receta.get("estado") == "pendiente" and receta.get("transcripcion"):
            print(f"→ adaptando {receta['slug']}")
            if adaptar(receta):
                escribir(ruta, receta)
                print("  ✓ lista")


def regenerar_indice():
    resumen = []
    for ruta in sorted(RECETAS.glob("*/receta.json")):
        r = leer(ruta)
        resumen.append({k: r.get(k) for k in
                        ("slug", "titulo", "subtitulo", "categoria", "tiempo", "estado", "fecha", "ejemplo")})
        resumen[-1]["con_audio"] = bool(r.get("audios"))
    resumen.sort(key=lambda r: (r.get("titulo") or "").lower())
    escribir(RECETAS / "indice.json", resumen)
    print(f"Índice actualizado: {len(resumen)} receta(s).")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--adaptar", action="store_true", help="adaptar con Claude las recetas pendientes")
    p.add_argument("--indice", action="store_true", help="solo regenerar recetas/indice.json")
    args = p.parse_args()

    RECETAS.mkdir(exist_ok=True)
    if not args.indice:
        if args.adaptar:
            adaptar_pendientes()
        entradas = [p for p in sorted(ENTRADA.iterdir())
                    if not p.name.startswith(".") and (p.is_dir() or p.suffix.lower() in EXTENSIONES)]
        if not entradas and not args.adaptar:
            print("No hay audios nuevos en audios_nuevos/.")
        for item in entradas:
            procesar_entrada(item)
    regenerar_indice()


if __name__ == "__main__":
    sys.exit(main())
