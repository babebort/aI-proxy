#!/usr/bin/env bash
# Copy or download proxy backends into resources/bin/
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/resources/bin"
mkdir -p "$BIN"

say() { printf '\033[1;36m▸\033[0m %s\n' "$1"; }

# --- codexer (OpenAI / ChatGPT subscription) ---
CODEXER_SRC="${AI_PROXY_CODEXER_SRC:-$HOME/codexer/codexer}"
if [[ -x "$CODEXER_SRC" ]]; then
  say "bundling codexer from $CODEXER_SRC"
  cp -f "$CODEXER_SRC" "$BIN/codexer"
  chmod +x "$BIN/codexer"
else
  say "codexer not found at $CODEXER_SRC — build or clone ~/codexer first"
fi

# --- teamclaude-rs (Anthropic / Claude subscription) ---
TCR_SRC="${AI_PROXY_TCR_SRC:-$HOME/.local/bin/tcr}"
if [[ -x "$TCR_SRC" ]]; then
  say "bundling tcr from $TCR_SRC"
  cp -f "$TCR_SRC" "$BIN/tcr"
  chmod +x "$BIN/tcr"
else
  say "tcr not found — install teamclaude-rs:"
  say "  curl --proto '=https' --tlsv1.2 -LsSf https://github.com/dhkts1/teamclaude-rs/releases/latest/download/teamclaude-rs-installer.sh | sh"
fi

say "done → $BIN"
ls -la "$BIN" 2>/dev/null || true
