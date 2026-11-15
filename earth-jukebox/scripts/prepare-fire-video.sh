#!/usr/bin/env bash
# Genera la versión web del video del incendio (1920x1080, 181 MB → 1280x720, ~35 MB).
# Uso: bash scripts/prepare-fire-video.sh "../Dixie_fire_2021_p30_1080p30 (1).mp4"
set -euo pipefail
SRC="${1:?Indica la ruta del video original}"
mkdir -p public/video
ffmpeg -y -i "$SRC" -vf "scale=1280:720:flags=area" -r 30 \
  -c:v libx264 -preset veryfast -crf 21 -pix_fmt yuv420p -movflags +faststart -an \
  public/video/dixie-fire-720.mp4

# Copia para los fondos de la landing: sin la gráfica de área (derecha) ni la fecha (arriba),
# en baja resolución y solo la segunda oleada de fuego (segundos 34 a 52), ~1.2 MB.
# El análisis de la app usa el video completo; esta copia es solo decorativa.
ffmpeg -y -ss 34 -t 18 -i public/video/dixie-fire-720.mp4 -vf "crop=1040:640:0:80,scale=720:444:flags=area" -an \
  -c:v libx264 -preset slow -crf 27 -pix_fmt yuv420p -movflags +faststart \
  public/video/dixie-fire-landing.mp4
