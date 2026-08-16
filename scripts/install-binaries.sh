#!/usr/bin/env bash
# Build vendored backends into resources/bin/
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/resources/bin"
CODEXER_DIR="$ROOT/codexer"
CODEXER_OUT="$BIN/codexer"
TCR_OUT="$BIN/tcr"
TCR_VERSION="${AI_PROXY_TCR_VERSION:-0.2.15}"
TCR_RELEASE_BASE="https://github.com/dhkts1/teamclaude-rs/releases/download/v${TCR_VERSION}"
mkdir -p "$BIN"

say() { printf '\033[1;36m▸\033[0m %s\n' "$1"; }
fail() { printf '\033[1;31m✗\033[0m %s\n' "$1" >&2; exit 1; }

detect_tcr_triple() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"
  case "$os/$arch" in
    Darwin/arm64) echo "aarch64-apple-darwin" ;;
    Darwin/x86_64) echo "x86_64-apple-darwin" ;;
    Linux/aarch64|Linux/arm64) echo "aarch64-unknown-linux-musl" ;;
    Linux/x86_64) echo "x86_64-unknown-linux-musl" ;;
    *) return 1 ;;
  esac
}

install_tcr() {
  if [[ -n "${AI_PROXY_TCR_SRC:-}" && -x "${AI_PROXY_TCR_SRC}" ]]; then
    say "using tcr from AI_PROXY_TCR_SRC=$AI_PROXY_TCR_SRC"
    cp -f "$AI_PROXY_TCR_SRC" "$TCR_OUT"
    chmod +x "$TCR_OUT"
    return 0
  fi

  local fallback="${AI_PROXY_TCR_FALLBACK:-$HOME/.local/bin/tcr}"
  if [[ -x "$fallback" ]]; then
    say "bundling tcr from $fallback"
    cp -f "$fallback" "$TCR_OUT"
    chmod +x "$TCR_OUT"
    return 0
  fi

  if [[ -x "$TCR_OUT" ]]; then
    say "tcr already present at $TCR_OUT"
    return 0
  fi

  local triple
  triple="$(detect_tcr_triple)" || fail "unsupported platform for bundled tcr: $(uname -s)/$(uname -m)"

  local archive="teamclaude-rs-${triple}.tar.xz"
  local url="${TCR_RELEASE_BASE}/${archive}"
  local tmpdir
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "$tmpdir"' RETURN

  command -v curl >/dev/null 2>&1 || fail "curl is required to download tcr"
  command -v tar >/dev/null 2>&1 || fail "tar is required to extract tcr"

  say "downloading tcr v${TCR_VERSION} (${triple})"
  curl -fsSL "$url" | tar -xJ -C "$tmpdir"

  local extracted
  extracted="$(find "$tmpdir" -type f -name tcr | head -1)"
  [[ -n "$extracted" && -f "$extracted" ]] || fail "tcr binary missing in ${archive}"

  cp -f "$extracted" "$TCR_OUT"
  chmod +x "$TCR_OUT"
}

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

# --- teamclaude-rs (Anthropic login helper; bundled for anthropic login) ---
install_tcr

say "done → $BIN"
ls -la "$BIN" 2>/dev/null || true
