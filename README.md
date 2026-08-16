# AI-proxy

Локальный прокси для **ChatGPT (Codex)** и **Claude** через подписки OAuth — без API keys.

Один порт `http://127.0.0.1:8787` принимает оба API:

| Маршрут | Провайдер |
|---------|-----------|
| `POST /v1/chat/completions` | ChatGPT (через codexer) |
| `POST /v1/messages` | Claude (native pool) |

Пул аккаунтов: при лимите или 429 запрос уходит на следующий аккаунт. Для Claude — ещё ротация по quota headers и авто-refresh OAuth токенов.

```
клиент (BB / Cursor / curl)
        │
        ▼
   ai-proxy :8787
   ├── /v1/chat/completions → codexer :9090
   └── /v1/messages         → api.anthropic.com (пул аккаунтов)
```

---

## Поднять с нуля

### 1. Установка

Требуется **Node 22+** и **Go 1.22+** (для сборки встроенного codexer).

```bash
git clone git@github.com:babebort/aI-proxy.git
cd aI-proxy

npm run setup    # install + build TS + codexer + tcr (login helper)
```

Или по шагам:

```bash
npm install
npm run build
npm run install-binaries   # codexer + tcr → resources/bin/
```

### 2. OpenAI — добавить ChatGPT-аккаунты

```bash
npx ai-proxy openai login    # OAuth в браузере
npx ai-proxy openai login    # второй аккаунт, третий…
```

Аккаунты пишутся в `~/.config/codexer/config.yml`.

### 3. Anthropic — добавить Claude-аккаунты

`tcr` (teamclaude-rs) ставится автоматически на шаге `npm run setup` — отдельно ничего качать не нужно.

```bash
npx ai-proxy anthropic login
npx ai-proxy anthropic login    # ещё аккаунты
npx ai-proxy anthropic accounts # список
```

Аккаунты пишутся в `~/.config/teamclaude.json`. После login `tcr` в runtime не нужен.

### 4. Запуск

```bash
npx ai-proxy start
npx ai-proxy status
eval "$(npx ai-proxy env)"
```

Остановка: `npx ai-proxy stop`

Foreground (логи в терминале): `npx ai-proxy start --foreground`

---

## Env для клиентов

```bash
eval "$(npx ai-proxy env)"
```

Или вручную:

```bash
export AI_PROXY_URL=http://127.0.0.1:8787
export OPENAI_BASE_URL=http://127.0.0.1:8787/v1
export OPENAI_API_KEY=<group.api из ~/.config/codexer/config.yml>
export CODEXER_API_KEY=<тот же>
export ANTHROPIC_BASE_URL=http://127.0.0.1:8787
# ANTHROPIC_API_KEY не ставить — Claude Code ходит через OAuth прокси
```

---

## Команды

```
ai-proxy start [--foreground] [--legacy]
ai-proxy stop | status | env
ai-proxy openai login | key
ai-proxy anthropic login | accounts
```

`--legacy` — старый режим: два порта (9090 + 3456) и teamclaude-rs в runtime.

---

## Как работает балансировка

**OpenAI (codexer):** multiuser-группа из `~/.config/codexer/config.yml`. При 429 — следующий аккаунт.

**Anthropic (native):**
- session affinity — один диалог держится на одном аккаунте (prompt cache, TTL 15 мин)
- quota headers — не берёт аккаунт, если `anthropic-ratelimit-unified-*` ≥ 95%
- OAuth refresh — обновляет токен до expiry, пишет в `teamclaude.json`
- 429 / 529 / 502 / 503 — retry на другом аккаунте (до 4 попыток)

Нужны платные подписки (ChatGPT Plus/Pro, Claude Pro/Max). Free tier для агентной работы не хватает — прокси умножает лимиты: N аккаунтов ≈ N× quota.

---

## Файлы

```
aI-proxy/
├── codexer/                 # vendored OpenAI proxy (Go)
├── src/                     # unified Node server
├── resources/bin/codexer    # built binary (gitignored)
├── resources/bin/tcr        # teamclaude-rs login helper (gitignored)
~/.config/codexer/config.yml # OpenAI аккаунты
~/.config/teamclaude.json    # Anthropic аккаунты
```

---

## Troubleshooting

| Проблема | Решение |
|----------|---------|
| `codexer not found` | `npm run install-binaries` (нужен Go) |
| `tcr not found` | `npm run install-binaries` (или `npm run setup`) |
| 401 на OpenAI | `npx ai-proxy openai login` |
| 429 при одном аккаунте | добавь второй: `openai login` / `anthropic login` |
| Пустой Anthropic pool | `npx ai-proxy anthropic login` |
| Claude Code не видит коннекторы | убери `ANTHROPIC_API_KEY` из env |

Логи: `~/.config/ai-proxy/logs/`

---

## Лицензии

| Компонент | Лицензия |
|-----------|----------|
| AI-proxy | MIT |
| codexer | [upstream](https://github.com/vladvlsu/codexer) |
| teamclaude-rs | PolyForm Noncommercial 1.0.0 |
