#!/usr/bin/env bash
# Build vendored backends into resources/bin/
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/resources/bin"
CODEXER_DIR="$ROOT/codexer"
CODEXER_OUT="$BIN/codexer"
mkdir -p "$BIN"

say() { printf '\033[1;36m▸\033[0m %s\n' "$1"; }
fail() { printf '\033[1;31m✗\033[0m %s\n' "$1" >&2; exit 1; }

# --- codexer (vendored Go source in codexer/) ---
if [[ -n "${AI_PROXY_CODEXER_SRC:-}" && -x "${AI_PROXY_CODEXER_SRC}" ]]; then
  say "using codexer from AI_PROXY_CODEXER_SRC=$AI_PROXY_CODEXER_SRC"
  cp -f "$AI_PROXY_CODEXER_SRC" "$CODEXER_OUT"
  chmod +x "$CODEXER_OUT"
elif [[ -f "$CODEXER_DIR/go.mod" ]]; then
  command -v go >/dev/null 2>&1 || fail "Go is required to build codexer (brew install go)"
  say "building codexer from $CODEXER_DIR"
  (cd "$CODEXER_DIR" && go build -o "$CODEXER_OUT" .)
  chmod +x "$CODEXER_OUT"
else
  fail "vendored codexer/ directory missing — re-clone the repo"
fi

# --- teamclaude-rs (Anthropic login only; optional) ---
TCR_SRC="${AI_PROXY_TCR_SRC:-$HOME/.local/bin/tcr}"
if [[ -x "$TCR_SRC" ]]; then
  say "bundling tcr from $TCR_SRC (anthropic login helper)"
  cp -f "$TCR_SRC" "$BIN/tcr"
  chmod +x "$BIN/tcr"
else
  say "tcr not bundled — optional, only for: npx ai-proxy anthropic login"
  say "  curl --proto '=https' --tlsv1.2 -LsSf https://github.com/dhkts1/teamclaude-rs/releases/latest/download/teamclaude-rs-installer.sh | sh"
fi

say "done → $BIN"
ls -la "$BIN" 2>/dev/null || true
