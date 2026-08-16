#!/usr/bin/env bash
# Build AI Proxy.app and install to ~/Applications (macOS only).
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "install-app: skipped (macOS only). Run: npm start" >&2
  exit 0
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="AI Proxy"
APP_ID="bio.longeva.ai-proxy"
VERSION="$(node -p "require('$ROOT/package.json').version" 2>/dev/null || echo 0.0.0)"
STAGE="$ROOT/build/macos/AI Proxy.app"
TARGET="${AI_PROXY_APPLICATIONS_DIR:-$HOME/Applications}/AI Proxy.app"
ICON_SCRIPT="$ROOT/scripts/make-app-icon.sh"

say() { printf '\033[1;36m▸\033[0m %s\n' "$1"; }

[[ -f "$ROOT/dist/main.js" ]] || {
  echo "dist/main.js missing — run npm run compile first" >&2
  exit 1
}

say "building $APP_NAME.app"
rm -rf "$STAGE"
mkdir -p "$STAGE/Contents/MacOS" "$STAGE/Contents/Resources"

if [[ -x "$ICON_SCRIPT" ]]; then
  bash "$ICON_SCRIPT" "$STAGE/Contents/Resources/AppIcon.icns" || true
fi

cat >"$STAGE/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleExecutable</key>
  <string>ai-proxy</string>
  <key>CFBundleIdentifier</key>
  <string>${APP_ID}</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>${APP_NAME}</string>
  <key>CFBundleDisplayName</key>
  <string>${APP_NAME}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${VERSION}</string>
  <key>CFBundleVersion</key>
  <string>${VERSION}</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
</dict>
</plist>
PLIST

cat >"$STAGE/Contents/MacOS/ai-proxy" <<'LAUNCHER'
#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cat "$APP_DIR/Resources/install-root" 2>/dev/null || true)"
if [[ -z "$ROOT" || ! -f "$ROOT/dist/main.js" ]]; then
  osascript -e 'display alert "AI Proxy" message "Install path missing. Re-run npm run setup in the project folder." as critical' || true
  exit 1
fi

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
NODE="${AI_PROXY_NODE:-$(command -v node || true)}"
if [[ -z "$NODE" || ! -x "$NODE" ]]; then
  osascript -e 'display alert "AI Proxy" message "Node.js 22+ is required (brew install node)." as critical' || true
  exit 1
fi

PORT="${AI_PROXY_UI_PORT:-8790}"
UI_URL="http://127.0.0.1:${PORT}"
LOG_DIR="$HOME/.config/ai-proxy/logs"
mkdir -p "$LOG_DIR"

open_panel() {
  open -na "Google Chrome" --args "--app=${UI_URL}" 2>/dev/null || open "$UI_URL"
}

if curl -fsS --max-time 1 "${UI_URL}/api/status" >/dev/null 2>&1; then
  open_panel
  exit 0
fi

cd "$ROOT"
nohup "$NODE" "$ROOT/dist/main.js" --detach --port="$PORT" >>"$LOG_DIR/ui.launch.log" 2>&1 &
disown

for _ in $(seq 1 40); do
  if curl -fsS --max-time 1 "${UI_URL}/api/status" >/dev/null 2>&1; then
    open_panel
    exit 0
  fi
  sleep 0.15
done

osascript -e 'display alert "AI Proxy" message "Could not start the control panel. See ~/.config/ai-proxy/logs/ui.launch.log"' as critical || true
exit 1
LAUNCHER

chmod +x "$STAGE/Contents/MacOS/ai-proxy"
printf '%s\n' "$ROOT" >"$STAGE/Contents/Resources/install-root"

mkdir -p "$(dirname "$TARGET")"
rm -rf "$TARGET"
ditto "$STAGE" "$TARGET"

say "installed → $TARGET"
say "Launch from Finder / Spotlight, or: open \"$TARGET\""
