#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ICONSET="$ROOT/build/icon.iconset"
SVG="$ROOT/assets/icon.svg"

rm -rf "$ICONSET"
mkdir -p "$ICONSET"

make_png() {
  local size="$1"
  local name="$2"
  qlmanage -t -s "$size" -o /tmp "$SVG" >/dev/null 2>&1
  mv "/tmp/icon.svg.png" "$ICONSET/$name"
}

make_png 16 icon_16x16.png
make_png 32 icon_16x16@2x.png
make_png 32 icon_32x32.png
make_png 64 icon_32x32@2x.png
make_png 128 icon_128x128.png
make_png 256 icon_128x128@2x.png
make_png 256 icon_256x256.png
make_png 512 icon_256x256@2x.png
make_png 512 icon_512x512.png
make_png 1024 icon_512x512@2x.png

iconutil -c icns "$ICONSET" -o "$ROOT/build/icon.icns"
rm -rf "$ICONSET"

echo "Created build/icon.icns"
