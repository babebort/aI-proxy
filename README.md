# AI-proxy

Локальный прокси для **ChatGPT (Codex)** и **Claude** через OAuth-подписки — без платных API keys.

**Управление — через Web UI** (`http://127.0.0.1:8790`). Отдельного CLI нет: `npm start` / кнопки в панели.

Один порт **`http://127.0.0.1:8787`** принимает оба API:

| Маршрут | Провайдер |
|---------|-----------|
| `POST /v1/chat/completions` | ChatGPT (codexer → `:9090`) |
| `POST /v1/messages` | Claude (native pool → api.anthropic.com) |

```
клиент (BB / Cursor / Claude Code / codexer-audit)
        │
        ▼
   ai-proxy :8787
   ├── /v1/chat/completions → codexer :9090
   └── /v1/messages         → Anthropic pool
```

---

## Требования

| Что | Версия |
|-----|--------|
| **Node.js** | 22+ |
| **Go** | 1.22+ (сборка vendored codexer) |
| **macOS** | OAuth «+ Добавить» / ↺ Reauth открывают **Terminal** |
| **Браузер** | Chrome / Safari / Edge — для PWA |

---

## Первый запуск (один раз)

```bash
git clone git@github.com:babebort/aI-proxy.git
cd aI-proxy

npm run setup
```

`setup` делает:

1. `npm install`
2. `npm run compile` — TypeScript → `dist/`
3. `npm run install-binaries` — `codexer` + `tcr` в `resources/bin/`
4. `npm run link-bin` — symlink `npx ai-proxy`

После setup:

```bash
npm start
```

Откроется браузер на `http://127.0.0.1:8790`. Прокси `:8787` поднимется автоматически.

---

## Ежедневный workflow

```bash
cd ~/Documents/PycharmProjects/aI-proxy   # или свой путь

npm start          # UI + proxy в фоне — терминал сразу свободен
npm run start:fg   # UI в этом терминале (Ctrl+C закрывает панель)

npm run open       # открыть панель, если UI уже запущен
npm run stop       # убить UI (:8790)
npm run stop -- --all   # UI + proxy (:8787) + codexer (:9090)
```

Логи фонового UI: `~/.config/ai-proxy/logs/ui.log`

### Web App (PWA) — иконка в Dock

`npm start` поднимает сервер в фоне — терминал не нужен держать открытым. PWA — удобное окно в Dock.

1. `npm start`
2. Открой `http://127.0.0.1:8790`
3. Установи как приложение:

| Браузер | Действие |
|---------|----------|
| **Chrome** | ⋮ → «Установить AI Proxy» (или кнопка **Установить** вверху) |
| **Safari** | Поделиться → «На Dock» |
| **Edge** | ⋮ → Apps → Install this site as an app |

Дальше можно открывать из Dock; `npm start` нужен, пока работаешь.

---

## UI — вкладки и кнопки

### Обзор

- Статус unified proxy, codexer, anthropic pool
- **Запустить** / **Стоп** — proxy в фоне
- **↻** (справа вверху) — обновить статус

### Аккаунты

| Элемент | Действие |
|---------|----------|
| **+ Добавить аккаунт** | OAuth в Terminal (`codexer auth` / `tcr login`) |
| **↻** на карточке | Обновить лимиты **этого** аккаунта |
| **↺** на карточке | **Reauth** — удалить битую запись + OAuth заново (тот же alias) |
| **Обновить лимиты** | Probe всех аккаунтов сразу |

**Лимиты ChatGPT:** `GET /backend-api/wham/usage` (неделя / окно, % used)  
**Лимиты Claude:** probe + headers `anthropic-ratelimit-*`

После OAuth в Terminal нажми **↻** на карточке.

### Клиенты

Готовые `export …` для Cursor, BB, Claude Code — копируй в shell или `.zshrc`.

---

## Env для клиентов

Из вкладки **Клиенты** или вручную:

```bash
export AI_PROXY_URL=http://127.0.0.1:8787
export OPENAI_BASE_URL=http://127.0.0.1:8787/v1
export OPENAI_API_KEY=<group.api из ~/.config/codexer/config.yml>
export CODEXER_API_KEY=<тот же>
export ANTHROPIC_BASE_URL=http://127.0.0.1:8787
# ANTHROPIC_API_KEY не ставить — pool без ключа
```

Ключ codexer для audit/judge: `cat ~/CODEXER_API_KEY.txt` (не печатай в логах).

Gateway для codexer напрямую (если нужен только OpenAI): `http://127.0.0.1:9090/v1`.

---

## Команды npm

| Команда | Что делает |
|---------|------------|
| `npm run setup` | Первичная установка (см. выше) |
| `npm run build` | Только compile (`tsc`) |
| `npm start` | UI `:8790` + proxy в **фоне** (терминал свободен) |
| `npm run start:fg` | UI в текущем терминале (Ctrl+C) |
| `npm run open` | Открыть браузер, UI уже должен работать |
| `npm run stop` | Остановить UI |
| `npm run stop -- --all` | UI + proxy + codexer |
| `npm run install-binaries` | Пересобрать codexer / скачать tcr |
| `npm run link-bin` | `npx ai-proxy` → `dist/bootstrap.js` |
| `npm test` | Тесты |
| `npm run install-app` | *(legacy)* macOS `.app` в `~/Applications` |

---

## Файлы и конфиги

```
aI-proxy/
├── ui/                         # HTML/CSS/JS панели + PWA manifest
├── src/
│   ├── main.ts                 # entry → UI
│   ├── stop.ts                 # npm run stop
│   └── ui/                     # server, probes, reauth, login
├── resources/bin/
│   ├── codexer                 # OpenAI proxy (Go)
│   └── tcr                     # Anthropic login helper
└── codexer/                    # исходники codexer

~/.config/codexer/config.yml    # ChatGPT аккаунты + group.api
~/.config/teamclaude.json       # Claude pool
~/.config/ai-proxy/
├── config.yml                  # порты, ключи ai-proxy
├── run/unified.json            # pid proxy
├── run/openai.json             # pid codexer
└── logs/                       # openai.log, ui.launch.log, …
```

---

## Troubleshooting

| Проблема | Решение |
|----------|---------|
| `codexer not found` | `npm run install-binaries` |
| UI не открылся | `open http://127.0.0.1:8790` или `npm run open` |
| **Ctrl+C не гасит** / завис терминал | `npm run stop` или `npm run stop -- --all` (не нужен Ctrl+C — `npm start` уже в фоне) |
| Жёстко убить порты | `lsof -ti tcp:8790,8787,9090 \| xargs kill -9` |
| **`missing chatgpt account id`** | **↺ Reauth** на карточке → OAuth в Terminal → тот же alias → **↻** |
| `err` / `no token` на карточке | **↺ Reauth** или «+ Добавить аккаунт» |
| 401 OpenAI в клиенте | Reauth ChatGPT; проверь `OPENAI_API_KEY` = `group.api` |
| 429 OpenAI | Добавь аккаунты / ротация в codexer |
| Нет Claude | «+ Добавить» (Anthropic) → `tcr login` |
| Proxy не стартует | UI → **Запустить** или `npm start` |
| Остановить proxy | UI → **Стоп** или `npm run stop -- --all` |

Логи: `~/.config/ai-proxy/logs/`

---

## Лицензии

| Компонент | Лицензия |
|-----------|----------|
| AI-proxy | MIT |
| codexer | [upstream](https://github.com/vladvlsu/codexer) |
| teamclaude-rs | PolyForm Noncommercial 1.0.0 |
