# AI-proxy

Локальный прокси для **ChatGPT (Codex)** и **Claude** через OAuth-подписки — без платных API keys.

Один порт **`http://127.0.0.1:8787`** для клиентов:

| Маршрут | Провайдер |
|---------|-----------|
| `POST /v1/chat/completions` | ChatGPT (codexer → `:9090`) |
| `POST /v1/messages` | Claude (native pool) |

```
Cursor / Claude Code / BB judge
        │
        ▼
   ai-proxy :8787
   ├── /v1/chat/completions → codexer :9090
   └── /v1/messages         → Anthropic pool
```

Панель управления: **`http://127.0.0.1:8790`** (опционально — лимиты, env, настройки).  
Добавлять аккаунты можно **из терминала** — web не обязателен.

---

## Пошаговый мануал

### Шаг 0 — один раз (новая машина)

```bash
git clone git@github.com:babebort/aI-proxy.git
cd aI-proxy
npm run setup
```

`setup` = install + compile + codexer/tcr binaries + `npx ai-proxy`.

Опционально — иконка в Dock:

```bash
npm run install-app   # → ~/Applications/AI Proxy.app
```

---

### Шаг 1 — обновление (каждый `git pull`)

```bash
cd ~/Documents/PycharmProjects/aI-proxy   # свой путь к репо

git pull
npm run build
npm run stop && npm start
```

Проверка:

```bash
curl -s http://127.0.0.1:8790/api/status | head -c 200
curl -s http://127.0.0.1:8787/health
```

Если открываешь панель в браузере — **Cmd+Shift+R** (жёсткое обновление, сброс старого JS из PWA-кеша).

---

### Шаг 2 — запуск на каждый день

```bash
npm start
```

- UI `:8790` + proxy `:8787` в **фоне**
- **Браузер не открывается** сам

Остановить:

```bash
npm run stop              # только UI
npm run stop -- --all     # UI + proxy + codexer
```

Логи: `~/.config/ai-proxy/logs/ui.log`

---

### Шаг 3 — настройки (SMSPool, probe Claude)

**Вариант A — терминал / файл** (`~/.config/ai-proxy/config.yml`):

```yaml
integrations:
  smspool:
    apiKey: "32_символьный_ключ_из_smspool.net_Settings"
anthropic:
  probeModel: claude-haiku-4-5
  probeReasoning: off    # off | low | medium | high
```

Или env (приоритетнее файла):

```bash
export SMSPOOL_API_KEY="..."
```

**Вариант B — панель:**

```bash
npm run open
```

1. Слева **Настройки**
2. **SMSPool API key** → вставить ключ → **Сохранить**
3. **Claude probe** — model + reasoning (для кнопки «Обновить лимиты»)

> SMSPool ключ **сохраняется**; автозаказ SMS-номера при регистрации — **ещё не подключён**.

---

### Шаг 4 — добавить ChatGPT аккаунт

**Через терминал (рекомендуется, web не нужен):**

```bash
npm run auth:openai
```

Интерактивно: alias → группа → браузер OAuth → callback на `localhost:1455`.

С параметрами:

```bash
npm run auth:openai -- --alias=voip --new-group=main
npm run auth:openai -- --alias=work --gid=<gid_существующей_группы>
npm run auth:openai -- --alias=work --no-browser   # только ссылка, без open
```

**Через панель** (`npm run open`):

1. **Аккаунты** → **+ Добавить аккаунт** (OpenAI)
2. Модалка: alias, группа → **Войти через ChatGPT**
3. Если модалки нет — **Cmd+Shift+R**

Reauth (битый токен): **↺** на карточке (UI) или снова `npm run auth:openai` с тем же alias.

---

### Шаг 5 — добавить Claude аккаунт

```bash
npm run auth:anthropic
```

(`tcr login` — OAuth в браузере, только терминал.)

После логина проверь лимиты (шаг 6).

---

### Шаг 6 — лимиты / quota

**Терминал не нужен** — можно в панели:

```bash
npm run open
```

- **Обновить лимиты** — все аккаунты
- **↻** на карточке — один аккаунт

ChatGPT: полоски «неделя» (% used).  
Claude: «5 часов» / «7 дней» (unified headers).

После `auth:openai` лимиты ChatGPT подтягиваются сами.  
Claude — нажми **↻** после `auth:anthropic`.

Если Claude **404 model** — убедись что сделал шаг 1 (`git pull` + build), в **Настройках** выбери `claude-haiku-4-5` или `claude-sonnet-4-6`.

---

### Шаг 7 — env для Cursor / BB / Claude Code

В панели: **Клиенты** → Copy.

Или вручную:

```bash
export AI_PROXY_URL=http://127.0.0.1:8787
export OPENAI_BASE_URL=http://127.0.0.1:8787/v1
export OPENAI_API_KEY=<скопируй из вкладки Клиенты>
export CODEXER_API_KEY="$OPENAI_API_KEY"
export ANTHROPIC_BASE_URL=http://127.0.0.1:8787
# ANTHROPIC_API_KEY не ставить
```

`OPENAI_API_KEY` = поле `api` первой группы в `~/.config/codexer/config.yml`.

Проверка:

```bash
curl -s http://127.0.0.1:8787/health
```

---

## Команды (шпаргалка)

| Команда | Что делает |
|---------|------------|
| `npm run setup` | Первичная установка |
| `npm run build` | Compile после pull |
| `npm start` | UI + proxy в фоне (**без** браузера) |
| `npm run stop` | Остановить UI |
| `npm run stop -- --all` | UI + proxy + codexer |
| `npm run open` | Открыть панель `:8790` |
| `npm run auth:openai` | + ChatGPT (terminal OAuth) |
| `npm run auth:anthropic` | + Claude (`tcr login`) |
| `npm run install-app` | macOS `.app` → Applications |
| `npm run start:fg` | UI в текущем терминале |
| `npm test` | Тесты |

Открыть панель chromeless: `AI_PROXY_OPEN=app npm start -- --open`

---

## UI — вкладки

| Вкладка | Зачем |
|---------|--------|
| **Обзор** | Статус proxy, Запустить/Стоп |
| **Аккаунты** | Карточки, лимиты, + добавить, ↻ ↺ |
| **Клиенты** | `export …` для shell |
| **Настройки** | SMSPool key, Claude probe model/reasoning |

---

## Файлы

```
~/.config/codexer/config.yml     # ChatGPT аккаунты + group.api
~/.config/teamclaude.json        # Claude pool
~/.config/ai-proxy/config.yml    # ai-proxy: порты, SMSPool, probe
~/.config/ai-proxy/logs/ui.log    # лог UI
```

---

## Troubleshooting

| Проблема | Решение |
|----------|---------|
| **`+ Добавить` / toast про API** | Cmd+Shift+R или шаг 1 (build + restart) |
| **Нет вкладки «Настройки»** | Старый UI в кеше → Cmd+Shift+R |
| **`codexer not found`** | `npm run install-binaries` |
| **Claude 404 `claude-sonnet-4-…`** | Шаг 1 + **Настройки** → model `claude-haiku-4-5` |
| **`missing chatgpt account id`** | ↺ Reauth или `npm run auth:openai` |
| **`err` / offline на карточке** | ↻ probe; если не помогло — reauth |
| **401 OpenAI в клиенте** | `OPENAI_API_KEY` = `group.api` из **Клиенты** |
| **Порты заняты** | `npm run stop -- --all` или `lsof -ti tcp:8790,8787,9090 \| xargs kill -9` |

---

## Требования

| Что | Версия |
|-----|--------|
| Node.js | 22+ |
| Go | 1.22+ (для `install-binaries`) |
| macOS | для `auth:anthropic`, `install-app`, Terminal OAuth fallback |

---

## Лицензии

| Компонент | Лицензия |
|-----------|----------|
| AI-proxy | MIT |
| codexer | [upstream](https://github.com/vladvlsu/codexer) |
| teamclaude-rs | PolyForm Noncommercial 1.0.0 |
