# Codexarion

Codexarion is a native macOS Electron desktop client for a local Codexarion gateway:

- Gateway: `http://127.0.0.1:9090`
- Protocol: OpenAI-compatible `/v1/chat/completions`
- API key remains only in the Electron main process.
- The renderer is sandboxed, uses `contextIsolation`, has no Node integration,
  does not receive the API key, and never makes network requests itself.

## Requirements

- macOS Apple Silicon
- Node.js 24+
- A running Codexarion installation under `~/codexer`
- Gateway configured for `127.0.0.1:9090`
- Either:
  - `CODEXER_API_KEY` in the Electron launch environment, or
  - a key in `~/codexer/config.yml` at:
