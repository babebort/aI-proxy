# AI-proxy

Локальный прокси для двух провайдеров подписок (не API keys):

| Провайдер | Бэкенд | Порт | Аккаунты |
|-----------|--------|------|----------|
| **OpenAI / Codex** | [codexer](https://github.com/vladvlsu/codexer) | `:9090` | ChatGPT OAuth, multiuser |
| **Anthropic / Claude** | [teamclaude-rs](https://github.com/dhkts1/teamclaude-rs) | `:3456` | Claude Max/Pro OAuth, autobalance |

Один CLI управляет обоими. Клиенты (BB, Cursor, скрипты) шлют на localhost — прокси **миксует запросы по пулу аккаунтов**, а не ждёт лимита.

## Быстрый старт

```bash
npm install
npm run install-binaries   # копирует codexer + tcr в resources/bin/
npm run build

# Добавить аккаунты (OAuth в браузере, как claude auth login / codexer auth)
npx ai-proxy openai login
npx ai-proxy anthropic login
npx ai-proxy anthropic login   # второй, третий аккаунт…

# Запуск
npx ai-proxy start
npx ai-proxy status
```

### Env для клиентов

```bash
eval "$(npx ai-proxy openai-env)"
eval "$(npx ai-proxy anthropic env)"
```

OpenAI-совместимые клиенты → `http://127.0.0.1:9090/v1/...`  
Anthropic SDK / Claude Code → `ANTHROPIC_BASE_URL=http://127.0.0.1:3456`

## Автобалансировка (не «следующий при лимите»)

**OpenAI (codexer `--multiuser`):** каждый запрос идёт через балансировщик группы; при 429/limit — автоматический fallback на другой аккаунт в группе.

**Anthropic (teamclaude-rs):** ротация **до** исчерпания квоты:
- читает `anthropic-ratelimit-*` headers с каждого ответа;
- `switchThreshold: 0.95` — переключается, когда аккаунт подошёл к 95% weekly/5h;
- при 429/529 — retry на другом аккаунте;
- OAuth refresh в фоне.

То есть все аккаунты в пуле участвуют постоянно, а не только когда один «умер».

## Архитектура

```
ai-proxy start
    ├── resources/bin/codexer  → 127.0.0.1:9090  (~/codexer/config.yml)
    └── resources/bin/tcr      → 127.0.0.1:3456  (~/.config/teamclaude.json)
```

Конфиг супervisor: `~/.config/ai-proxy/config.yml`  
Логи: `~/.config/ai-proxy/logs/`  
PID: `~/.config/ai-proxy/run/`

Существующий `~/codexer/config.yml` переиспользуется as-is.

## Два бинарника vs один сервер — в чём разница

| | **Встроить codexer + tcr** (выбрано) | **Портировать в один Go/Node** |
|---|---|---|
| **Срок** | дни | недели |
| **OAuth / refresh / 429** | уже решено upstream | писать с нуля |
| **Обновления** | bump бинарника | merge upstream fixes вручную |
| **Процессы** | 2 child + supervisor | 1 процесс |
| **Конфиг** | 2 файла (можно унифицировать CLI) | 1 файл |
| **Порты** | 9090 + 3456 | можно один :8080 с роутингом |
| **Риск** | coupling версий | bugs в своей OAuth-логике |

**Почему embed:** codexer и teamclaude-rs — battle-tested для подписок OAuth. AI-proxy = тонкий supervisor + единый CLI, без переписывания протоколов.

Портирование в один сервер имеет смысл позже, если нужен один порт/один config — но OAuth+quota логику лучше не дублировать.

## Команды

```
ai-proxy start [--foreground]
ai-proxy stop
ai-proxy status
ai-proxy openai login
ai-proxy openai key
ai-proxy openai-env
ai-proxy anthropic login
ai-proxy anthropic accounts
ai-proxy anthropic env
```

## Бинарники

```bash
npm run install-binaries
# или вручную:
# AI_PROXY_CODEXER_SRC=~/codexer/codexer AI_PROXY_TCR_SRC=~/.local/bin/tcr bash scripts/install-binaries.sh
```

Переменные:
- `AI_PROXY_CODEXER` / `AI_PROXY_TCR` — путь к бинарнику
- `AI_PROXY_HOME` — каталог конфига (default `~/.config/ai-proxy`)

## Лицензии

- AI-proxy — MIT
- codexer — см. upstream
- teamclaude-rs — **PolyForm Noncommercial** (проверь, если коммерческое использование)

## Миграция с Codexarion / ручного codexer

1. `npm run install-binaries`
2. `ai-proxy start` вместо LaunchAgent `com.bortnik.codexer`
3. `ai-proxy anthropic login` для каждого Claude-аккаунта (больше не нужно `claude auth login` вручную при лимите)
4. BB → `anthropic env` + `openai-env`
