#!/usr/bin/env bash
# Genera la versión web del video de la NASA (4096x2048 60fps, 334 MB → 2048x1024 30fps, ~22 MB).
# Uso: bash scripts/prepare-video.sh ../iss_lightning_sos_yearly_07312023_2048p60.mp4
set -euo pipefail
SRC="${1:?Indica la ruta del video original}"
mkdir -p public/video
ffmpeg -y -i "$SRC" -vf "scale=2048:1024:flags=area,fps=30" \
  -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -movflags +faststart -an \
  public/video/lightning-2048.mp4

# Copia para los fondos de la landing: baja resolución y solo 20 s (segundos 40 a 60), ~0.5 MB.
# La app sigue usando lightning-2048.mp4 completo para el análisis.
ffmpeg -y -ss 40 -t 20 -i public/video/lightning-2048.mp4 -vf "scale=640:320:flags=area" -an \
  -c:v libx264 -preset slow -crf 27 -pix_fmt yuv420p -movflags +faststart \
  public/video/lightning-landing.mp4
