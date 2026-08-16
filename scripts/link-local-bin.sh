#!/usr/bin/env bash
# Symlink dist/cli.js → node_modules/.bin/ai-proxy so `npx ai-proxy` uses THIS repo.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$ROOT/node_modules/.bin"
CLI="$ROOT/dist/cli.js"
LINK="$BIN_DIR/ai-proxy"

[[ -f "$CLI" ]] || { echo "dist/cli.js missing — run npm run build first" >&2; exit 1; }

mkdir -p "$BIN_DIR"
ln -sf "../../dist/cli.js" "$LINK"
chmod +x "$CLI"
