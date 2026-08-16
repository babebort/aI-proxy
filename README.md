# AI-proxy

Локальный прокси для **двух провайдеров по подписке** (OAuth, не API keys).

**v0.2 — unified server:** один порт `:8787` для OpenAI и Anthropic. OpenAI — codexer (internal `:9090`), Anthropic — **native pool** (round-robin + retry на 429), без runtime-зависимости от teamclaude-rs.

| Маршрут | Куда | Аккаунты |
|---------|------|----------|
| `POST /v1/chat/completions` | codexer → ChatGPT | `~/codexer/config.yml` |
| `POST /v1/messages` | native → api.anthropic.com | `~/.config/teamclaude.json` |
| **Публичный порт** | **`http://127.0.0.1:8787`** | один `ai-proxy env` |

---

## Зачем это нужно

**Было (OpenAI):** отдельный `~/codexer`, LaunchAgent, ручной setup.

**Было (Anthropic):** `claude auth login` → лимит → вручную другой аккаунт.

**Стало:** `ai-proxy start` → один URL, пул аккаунтов, автобалансировка.

```
BB / Cursor / скрипты
        │
        ▼
   ai-proxy :8787  (единый Node-сервер)
   ├── /v1/chat/completions → codexer :9090 (internal)
   └── /v1/messages         → Anthropic pool (native)
        │
   [ChatGPT accs…]  [Claude accs…]
```

**teamclaude / tcr** — только для `anthropic login` (OAuth в браузере пишет `teamclaude.json`). В runtime v0.2 **не нужен**.

---

## Быстрый старт

```bash
git clone git@github.com:babebort/aI-proxy.git
cd aI-proxy

npm install
npm run build

# Скопировать бинарники в resources/bin/
npm run install-binaries
```

### 1. OpenAI — добавить ChatGPT-аккаунты

```bash
npx ai-proxy openai login    # OAuth в браузере, как codexer auth
npx ai-proxy openai login    # второй аккаунт в ту же группу…
```

Конфиг аккаунтов: `~/codexer/config.yml` (существующий файл переиспользуется as-is).

### 2. Anthropic — добавить Claude-аккаунты

OAuth через `tcr login` (один раз поставить [teamclaude-rs](https://github.com/dhkts1/teamclaude-rs)):

```bash
curl --proto '=https' --tlsv1.2 -LsSf \
  https://github.com/dhkts1/teamclaude-rs/releases/latest/download/teamclaude-rs-installer.sh | sh

npx ai-proxy anthropic login   # пишет ~/.config/teamclaude.json
npx ai-proxy anthropic login   # второй, третий аккаунт…
npx ai-proxy anthropic accounts
```

После login **tcr в runtime не нужен** — пул читает JSON напрямую.

### 3. Запуск

```bash
npx ai-proxy start
npx ai-proxy status
eval "$(npx ai-proxy env)"   # один export для BB и codexer
```

Legacy (два порта + tcr runtime): `npx ai-proxy start --legacy`

Остановка:

```bash
npx ai-proxy stop
```

---

## Env для клиентов

```bash
npx ai-proxy env
```

```bash
export AI_PROXY_URL=http://127.0.0.1:8787
export OPENAI_BASE_URL=http://127.0.0.1:8787/v1
export OPENAI_API_KEY=<group.api из ~/codexer/config.yml>
export CODEXER_API_KEY=<тот же>
export ANTHROPIC_BASE_URL=http://127.0.0.1:8787
# ANTHROPIC_API_KEY не ставить для Claude Code
```

---

## Подписки и лимиты: Claude CLI vs OpenAI Codex

Оба провайдера в AI-proxy работают через **подписку claude.ai / chatgpt.com**, не через pay-per-token API keys. Но «бесплатность» устроена по-разному.

### OpenAI (codexer → ChatGPT OAuth)

| План ChatGPT | Codex через codexer |
|--------------|---------------------|
| **Free** | Есть, но очень маленький лимит; быстро упираешься в usage limit |
| **Plus** | Больше, но всё равно cap |
| **Pro / Team** | Основной рабочий объём для Codex |

Лимит — **на аккаунт ChatGPT**. codexer в `--multiuser` при 429 переключается на следующий аккаунт в группе.

### Anthropic (teamclaude-rs → claude.ai OAuth)

| План Claude | Claude Code / CLI |
|-------------|-------------------|
| **Free (claude.ai)** | Веб-чат с лимитом; для **Claude Code как агента** Free по сути не рабочий — нужна подписка |
| **Pro** (~$20/мес) | Есть лимиты: **5h session bucket** + **7d weekly bucket** |
| **Max** ($100–200/мес) | Значительно выше лимиты; то, что у тебя сейчас (`subscriptionType: max`) |

Лимиты видны в headers ответа: `anthropic-ratelimit-unified-*` (5h и 7d). teamclaude-rs их читает и ротирует **до** полного исчерпания.

### Итого

| | OpenAI Codex | Claude CLI |
|---|-------------|------------|
| Модель оплаты | Подписка ChatGPT | Подписка Claude (Pro/Max) |
| API keys | **Нет** (OAuth) | **Нет** (OAuth) |
| «Бесплатный» tier | Free ChatGPT — крошечный Codex | Free claude.ai — не для тяжёлого BB/агента |
| Практичный минимум | Plus или несколько Free | Pro или Max |
| Окна лимита | usage limit (429) | 5h session + 7d weekly |
| Смысл multi-account | N аккаунтов × лимит каждого | N аккаунтов × лимит каждого |

**Ответ на вопрос «Claude CLI даёт бесплатный лимит как OpenAI?»** — формально у обоих есть free tier на сайте, но для **BB / агентной работы** нужны платные подписки (Claude Pro/Max, ChatGPT Plus/Pro). AI-proxy не создаёт лимиты — он **умножает** их: 3 Max-аккаунта ≈ 3× weekly quota, codexer с 3 ChatGPT ≈ 3× Codex cap.

---

## Автобалансировка

Не «ждём 429 → переключаем», а **постоянный микс по пулу**.

### OpenAI (codexer `--multiuser`)

- Каждый запрос через балансировщик группы (`~/codexer/config.yml` → `groups[].users[]`).
- При `usage_limit_reached` / 429 — fallback на следующий аккаунт.
- ≥2 аккаунта → автоматически `--multiuser`; 1 аккаунт → `--singleuser`.

### Anthropic (native v0.2)

- Round-robin по активным аккаунтам в `~/.config/teamclaude.json`.
- 429 / 529 / 502 / 503 — retry на другом аккаунте (до 4 попыток).
- **TODO:** quota headers (`switchThreshold 0.95`) и OAuth refresh — как в teamclaude-rs.

---

## Архитектура и файлы

```
aI-proxy/
├── src/
│   ├── server/unified.ts    # :8787 — /v1/messages + forward OpenAI
│   ├── anthropic/           # native pool + proxy
│   └── openai/forward.ts    # → codexer :9090
├── resources/bin/codexer
└── scripts/install-binaries.sh

~/.config/ai-proxy/
├── config.yml
├── run/unified.json
├── run/openai.json
└── logs/
```

### Supervisor config (`~/.config/ai-proxy/config.yml`)

Генерируется при первом `start`. Пример:

```yaml
unified:
  port: 8787
  enabled: true
openai:
  port: 9090          # internal only
  configFile: ~/codexer/config.yml
  gid: cfe83f1b...
anthropic:
  configFile: ~/.config/teamclaude.json
```

---

## Команды

```
ai-proxy start [--foreground] [--legacy]
ai-proxy stop | status | env | config-path
ai-proxy openai login | key | openai-env
ai-proxy anthropic login | accounts
```

---

## Embed vs один сервер

| | v0.1 embed | **v0.2 unified (сейчас)** | Go monolith (TODO) |
|---|---|---|---|
| Клиентский порт | 9090 + 3456 | **8787** | 8787 |
| Anthropic runtime | teamclaude-rs | native Node | native Go |
| OpenAI | codexer binary | codexer child | import codexer packages |

`--legacy` = старый dual-port + tcr.

---

## Бинарники

```bash
npm run install-binaries
```

Источники (переопределяются env):

| Бинарник | Env | Default |
|----------|-----|---------|
| codexer | `AI_PROXY_CODEXER_SRC` | `~/codexer/codexer` |
| tcr | `AI_PROXY_TCR_SRC` | `~/.local/bin/tcr` |

Runtime override:

- `AI_PROXY_CODEXER` — путь к codexer при старте
- `AI_PROXY_TCR` — путь к tcr при старте
- `AI_PROXY_HOME` — каталог конфига (default `~/.config/ai-proxy`)

Сборка codexer из исходников (если нет бинарника):

```bash
git clone https://github.com/vladvlsu/codexer ~/codexer
cd ~/codexer && go build -o codexer .
npm run install-binaries
```

---

## Интеграция с BB (Longeva audit queue)

Workflow `.bb/workflows/codexer-audit-queue.js`:

| `judgeMode` | Куда ходит судья |
|-------------|------------------|
| `codex` | `127.0.0.1:9090` + `$CODEXER_API_KEY` (single-user key) |
| `codexarion` | `:9090` + `group.api` из `~/codexer/config.yml` (multiuser pool) |
| `grok` | Cursor Grok (codexer не используется) |

```bash
ai-proxy start
eval "$(npx ai-proxy env)"
# OpenAI judge  → POST http://127.0.0.1:8787/v1/chat/completions
# Anthropic/BB  → ANTHROPIC_BASE_URL=http://127.0.0.1:8787
```

---

## Миграция

### С Codexarion (Electron)

Codexarion заменён этим репо. Electron, чаты и agent workspace удалены — остался только proxy supervisor.

### С ручного codexer + LaunchAgent

1. `npm run install-binaries && npm run build`
2. `ai-proxy start` вместо `launchctl kickstart com.bortnik.codexer`
3. `~/codexer/config.yml` и аккаунты остаются
4. LaunchAgent можно отключить: `launchctl unload ~/Library/LaunchAgents/com.bortnik.codexer.plist`

### С ручного переключения Claude CLI

1. `ai-proxy anthropic login` для каждого аккаунта (wigiwork, wilka, zelen…)
2. `ai-proxy start`
3. `eval "$(npx ai-proxy env)"` в shell / BB env
4. Больше не нужно `claude auth login` при каждом лимите

---

## Лицензии

| Компонент | Лицензия |
|-----------|----------|
| AI-proxy (этот репо) | MIT |
| codexer | см. [upstream](https://github.com/vladvlsu/codexer) |
| teamclaude-rs | **PolyForm Noncommercial 1.0.0** — проверь, если коммерческое использование |

---

## Troubleshooting

**codexer not found** → `npm run install-binaries` или `go build` в `~/codexer`.

**tcr not found** → установи teamclaude-rs (см. выше), затем `npm run install-binaries`.

**9090 down** → `ai-proxy status`, смотри `~/.config/ai-proxy/logs/openai.log`.

**8787 down** → `ai-proxy status`, логи `~/.config/ai-proxy/logs/unified.log`.

**Пустой Anthropic pool** → `ai-proxy anthropic login`.

**401 на codexer** → протух OAuth; `ai-proxy openai login` для проблемного аккаунта.

**429 на codexer при 1 аккаунте** → добавь второй: `ai-proxy openai login`.

**Claude Code не видит коннекторы** → убери `ANTHROPIC_API_KEY` из env (teamclaude-rs injects OAuth сам).

**BB упёрся в Anthropic limit** → добавь аккаунт: `ai-proxy anthropic login`; прокси сам начнёт его использовать.
