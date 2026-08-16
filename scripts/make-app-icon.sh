#!/usr/bin/env bash
# Build AppIcon.icns from ui/icon.svg (best-effort; skips if tools missing).
set -euo pipefail

OUT="${1:?output .icns path}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SVG="$ROOT/ui/icon.svg"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

[[ -f "$SVG" ]] || exit 0

PNG="$TMP/icon-1024.png"
if command -v rsvg-convert >/dev/null 2>&1; then
  rsvg-convert -w 1024 -h 1024 "$SVG" -o "$PNG"
elif command -v magick >/dev/null 2>&1; then
  magick -background none "$SVG" -resize 1024x1024 "$PNG"
elif command -v convert >/dev/null 2>&1; then
  convert -background none "$SVG" -resize 1024x1024 "$PNG"
else
  exit 0
fi

ICONSET="$TMP/AppIcon.iconset"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$PNG" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" "$PNG" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$OUT"
