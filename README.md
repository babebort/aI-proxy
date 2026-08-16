# AI-proxy

Локальный прокси для **двух провайдеров по подписке** (OAuth, не API keys).

Один CLI поднимает оба бэкенда, хранит пул аккаунтов и **автобалансирует** запросы между ними. Клиенты (BB, Cursor, скрипты) ходят на localhost — отдельный `~/codexer`, LaunchAgent и ручное `claude auth login` при лимите не нужны.

| Провайдер | Бэкенд (встроен) | Порт | Тип аккаунтов |
|-----------|------------------|------|---------------|
| **OpenAI / Codex** | [codexer](https://github.com/vladvlsu/codexer) | `:9090` | ChatGPT OAuth (Free / Plus / Pro / Team) |
| **Anthropic / Claude** | [teamclaude-rs](https://github.com/dhkts1/teamclaude-rs) (`tcr`) | `:3456` | Claude OAuth (Pro / Max) |

---

## Зачем это нужно

**Было (OpenAI):** отдельный `~/codexer`, бинарник, LaunchAgent `com.bortnik.codexer`, ручной `setup-codexer.sh`.

**Было (Anthropic):** `claude auth login` → один аккаунт → лимит → вручную переключить аккаунт → BB снова работает.

**Стало:** один `ai-proxy start`, пул аккаунтов на каждой стороне, прокси сам миксует нагрузку и переключается при 429 / при приближении к квоте.

```
BB / Cursor / скрипты
        │
        ▼
   ai-proxy (supervisor)
   ├── codexer      → :9090 → ChatGPT backend (Codex)
   └── teamclaude   → :3456 → api.anthropic.com
        │
   [acc1] [acc2] [acc3] …   ← OAuth-подписки, не API keys
```

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

Сначала установи `tcr`, если его ещё нет:

```bash
curl --proto '=https' --tlsv1.2 -LsSf \
  https://github.com/dhkts1/teamclaude-rs/releases/latest/download/teamclaude-rs-installer.sh | sh

npm run install-binaries   # скопирует tcr в resources/bin/
```

```bash
npx ai-proxy anthropic login   # OAuth, как claude auth login
npx ai-proxy anthropic login   # второй, третий аккаунт…
```

Конфиг аккаунтов: `~/.config/teamclaude.json`.

### 3. Запуск

```bash
npx ai-proxy start
npx ai-proxy status
```

Остановка:

```bash
npx ai-proxy stop
```

---

## Env для клиентов

### OpenAI / Codex (audit judge, скрипты)

```bash
npx ai-proxy openai-env
# export OPENAI_BASE_URL=http://127.0.0.1:9090/v1
# export OPENAI_API_KEY=<group.api из ~/codexer/config.yml>
# export CODEXER_API_KEY=<тот же ключ>
```

Или положи ключ в `~/CODEXER_API_KEY.txt` — так делают audit-скрипты Longeva.

### Anthropic / Claude (BB, Claude Code, Cursor)

```bash
npx ai-proxy anthropic env
# export ANTHROPIC_BASE_URL=http://127.0.0.1:3456
```

**Не ставь `ANTHROPIC_API_KEY`** для Claude Code — teamclaude-rs сам подставляет OAuth-токен нужного аккаунта из пула. API key в env отключит claude.ai-коннекторы.

Для SDK-клиентов на loopback ключ прокси не обязателен (127.0.0.1 exempt).

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

### Anthropic (teamclaude-rs)

- Читает quota headers на **каждом** ответе.
- `switchThreshold: 0.95` — уходит с аккаунта, когда тот на 95% 5h/7d лимита.
- 429 / 529 / transport error — retry на другом аккаунте.
- OAuth refresh в фоне (токены не протухают посреди сессии).
- `sessionAffinity: true` — одна беседа остаётся на одном аккаунте (prompt cache); параллельные BB-агенты естественно разъезжаются по разным аккаунтам.

---

## Архитектура и файлы

```
aI-proxy/
├── src/                    # supervisor CLI (TypeScript)
├── resources/bin/
│   ├── codexer             # bundled OpenAI gateway (~10 MB)
│   └── tcr                 # bundled Anthropic gateway
└── scripts/install-binaries.sh

~/.config/ai-proxy/
├── config.yml              # порты, proxy api keys supervisor
├── run/openai.json         # PID codexer
├── run/anthropic.json      # PID tcr
└── logs/openai.log
    logs/anthropic.log

~/codexer/config.yml         # OpenAI OAuth accounts (legacy path, reused)
~/.config/teamclaude.json   # Anthropic OAuth accounts
```

### Supervisor config (`~/.config/ai-proxy/config.yml`)

Генерируется при первом `start`. Пример:

```yaml
openai:
  port: 9090
  configFile: /Users/you/codexer/config.yml
  gid: cfe83f1b603c9dfef46e8ea3eca0eac2bfb59411a7687a405a05eb4c483f3949
  apiKey: aip-openai-<random>   # для клиентов; реальный bearer = group.api в codexer config
anthropic:
  port: 3456
  configFile: /Users/you/.config/teamclaude.json
  apiKey: aip-anthropic-<random>  # gate для /_tcr/ control routes
```

---

## Команды

```
ai-proxy start [--foreground]   # поднять оба бэкенда
ai-proxy stop                     # остановить
ai-proxy status                   # health + pid

ai-proxy openai login             # codexer auth (новый ChatGPT аккаунт)
ai-proxy openai key               # bearer для клиентов
ai-proxy openai-env               # export OPENAI_* / CODEXER_*

ai-proxy anthropic login          # tcr login (новый Claude аккаунт)
ai-proxy anthropic accounts       # список аккаунтов в пуле
ai-proxy anthropic env            # export ANTHROPIC_BASE_URL

ai-proxy config-path              # путь к supervisor config
```

---

## Embed vs один сервер

| | **Embed codexer + tcr** (выбрано) | **Портировать в один Go/Node** |
|---|---|---|
| Срок | дни | недели |
| OAuth / refresh / 429 | уже решено upstream | писать с нуля |
| Обновления | bump бинарника | merge upstream fixes вручную |
| Процессы | 2 child + supervisor | 1 процесс |
| Конфиг | 2 файла (+ unified CLI) | 1 файл |
| Порты | 9090 + 3456 | можно один :8080 |
| Риск | coupling версий | bugs в своей OAuth-логике |

**Почему embed:** codexer и teamclaude-rs уже умеют OAuth подписок, quota headers и rotation. AI-proxy = тонкий supervisor + единый CLI. Портирование в один сервер — позже, если понадобится один порт; OAuth-логику дублировать не стоит.

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

Для дешёвого judge на OpenAI:

```bash
ai-proxy start
eval "$(npx ai-proxy openai-env)"
# BB / audit → POST http://127.0.0.1:9090/v1/chat/completions
```

Для Anthropic (оркестратор BB):

```bash
ai-proxy start
eval "$(npx ai-proxy anthropic env)"
# Claude Code / BB → ANTHROPIC_BASE_URL=http://127.0.0.1:3456
# Ручной claude auth login при лимите больше не нужен
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
3. `eval "$(npx ai-proxy anthropic env)"` в shell / BB env
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

**3456 down** → `~/.config/ai-proxy/logs/anthropic.log`, проверь `~/.config/teamclaude.json` не пуст.

**401 на codexer** → протух OAuth; `ai-proxy openai login` для проблемного аккаунта.

**429 на codexer при 1 аккаунте** → добавь второй: `ai-proxy openai login`.

**Claude Code не видит коннекторы** → убери `ANTHROPIC_API_KEY` из env (teamclaude-rs injects OAuth сам).

**BB упёрся в Anthropic limit** → добавь аккаунт: `ai-proxy anthropic login`; прокси сам начнёт его использовать.
