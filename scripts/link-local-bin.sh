#!/usr/bin/env bash
# Symlink dist/bootstrap.js → node_modules/.bin/ai-proxy so `npx ai-proxy` opens the UI.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$ROOT/node_modules/.bin"
BOOT="$ROOT/dist/bootstrap.js"
LINK="$BIN_DIR/ai-proxy"

[[ -f "$BOOT" ]] || { echo "dist/bootstrap.js missing — run npm run build first" >&2; exit 1; }

mkdir -p "$BIN_DIR"
ln -sf "../../dist/bootstrap.js" "$LINK"
chmod +x "$BOOT" "$ROOT/dist/main.js" "$ROOT/dist/stop.js"

echo "linked $LINK → dist/bootstrap.js"
