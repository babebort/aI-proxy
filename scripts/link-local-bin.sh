#!/usr/bin/env bash
# Symlink dist/main.js → node_modules/.bin/ai-proxy so `npx ai-proxy` opens the UI.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$ROOT/node_modules/.bin"
MAIN="$ROOT/dist/main.js"
LINK="$BIN_DIR/ai-proxy"

[[ -f "$MAIN" ]] || { echo "dist/main.js missing — run npm run build first" >&2; exit 1; }

mkdir -p "$BIN_DIR"
ln -sf "../../dist/main.js" "$LINK"
chmod +x "$MAIN"
