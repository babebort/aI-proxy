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
| **macOS** | Claude OAuth пока через **Terminal** (`tcr login`); ChatGPT — в UI |
| **Браузер** | Chrome / Safari / Edge — панель на `:8790` |

---

## Обновление (после `git pull`)

```bash
cd aI-proxy
git pull
npm run build
npm run stop && npm start
```

В UI нажми **↻** на карточке или **Обновить лимиты** — подтянет quota заново.

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

UI поднимается в фоне на `:8790`, **браузер не открывается**. Proxy `:8787` стартует сам.

**Добавить аккаунт (без web-панели):**

```bash
npm run auth:openai      # ChatGPT — OAuth в терминале + браузер
npm run auth:anthropic   # Claude — tcr login
```

Опции ChatGPT: `--alias=voip --new-group=main` или `--gid=<gid>` · `--no-browser` — только ссылка.

**Открыть панель** (лимиты, env, обзор):

```bash
npm run open             # браузер
npm run install-app      # AI Proxy.app в Dock
AI_PROXY_OPEN=app npm start -- --open   # chromeless окно
```

---

## Ежедневный workflow

```bash
cd ~/Documents/PycharmProjects/aI-proxy   # или свой путь

npm start          # UI + proxy в фоне, без браузера
npm run auth:openai    # + ChatGPT аккаунт (terminal)
npm run auth:anthropic # + Claude аккаунт (tcr)
npm run open       # открыть панель :8790
npm run start:fg   # UI в этом терминале (Ctrl+C закрывает панель)
npm run stop       # убить UI (:8790)
npm run stop -- --all   # UI + proxy (:8787) + codexer (:9090)
npm run install-app     # macOS .app в ~/Applications
```

Логи фонового UI: `~/.config/ai-proxy/logs/ui.log`

### Окно в Dock

Предпочтительно **`npm run install-app`** — отдельное приложение, Chrome app-mode на localhost.

PWA (Chrome «Установить сайт») тоже работает, но это запасной вариант:

1. `npm start` → `http://127.0.0.1:8790`
2. Chrome ⋮ → «Установить AI Proxy» или Safari → Поделиться → «На Dock»

`npm start` должен быть запущен, пока работаешь.

---

## UI — вкладки и кнопки

### Обзор

- Статус unified proxy, codexer, anthropic pool
- **Запустить** / **Стоп** — proxy в фоне
- **↻** (справа вверху) — обновить статус

### Аккаунты

| Элемент | Действие |
|---------|----------|
| **+ Добавить аккаунт** (ChatGPT) | UI-модалка **или** `npm run auth:openai` |
| **+ Добавить аккаунт** (Claude) | `npm run auth:anthropic` (tcr login) |
| **↻** на карточке | Обновить лимиты **этого** аккаунта |
| **↺** на карточке | **Reauth** — ChatGPT в UI; Claude в Terminal |
| **Обновить лимиты** | Probe всех аккаунтов сразу |

**Лимиты ChatGPT:** `GET /backend-api/wham/usage` (неделя / окно, % used)  
**Лимиты Claude:** `count_tokens` + headers `anthropic-ratelimit-unified-*` (5h / 7d)

После добавления ChatGPT лимиты подтягиваются сами. Claude — **↻** после `tcr login`.

### Клиенты

Готовые `export …` для Cursor, BB, Claude Code — копируй в shell или `.zshrc`.

### Настройки

Вкладка **Настройки** в панели (`npm run open`) или файл `~/.config/ai-proxy/config.yml`:

```yaml
integrations:
  smspool:
    apiKey: "твой_32_символьный_ключ"
anthropic:
  probeModel: claude-haiku-4-5
  probeReasoning: off   # off | low | medium | high
```

Через env: `export SMSPOOL_API_KEY=…` (приоритетнее файла).

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
| `npm start` | UI + proxy в фоне (**без** браузера) |
| `npm run auth:openai` | Добавить ChatGPT (terminal OAuth) |
| `npm run auth:anthropic` | Добавить Claude (`tcr login`) |
| `npm run start:fg` | UI в текущем терминале (Ctrl+C) |
| `npm run open` | Браузер на `:8790` |
| `npm run stop` | Остановить UI |
| `npm run stop -- --all` | UI + proxy + codexer |
| `npm run install-binaries` | Пересобрать codexer / скачать tcr |
| `npm run link-bin` | `npx ai-proxy` → `dist/bootstrap.js` |
| `npm test` | Тесты |
| `npm run install-app` | macOS **AI Proxy.app** → `~/Applications` |

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
| **«+ Добавить» ничего не делает** / toast про API | **Cmd+Shift+R** (старый JS в PWA-кеше). Или `npm run build && npm run stop && npm start`, затем hard refresh |
| **Ctrl+C не гасит** / завис терминал | `npm run stop` или `npm run stop -- --all` (не нужен Ctrl+C — `npm start` уже в фоне) |
| Жёстко убить порты | `lsof -ti tcp:8790,8787,9090 \| xargs kill -9` |
| **`missing chatgpt account id`** | **↺ Reauth** на карточке → OAuth в UI → тот же alias |
| `err` / `no token` на карточке | **↺ Reauth** или «+ Добавить аккаунт» |
| Claude **404 model: claude-sonnet-4-…** | `git pull && npm run build && npm run stop && npm start` — старый probe; потом **↻** |
| Claude лимиты пустые | **↻** на карточке; аккаунт должен быть залогинен через `tcr login` |
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
