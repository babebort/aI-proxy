const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const GATEWAY_URL = 'http://127.0.0.1:9090/v1/chat/completions';
const CONFIG_GID = 'cfe83f1b603c9dfef46e8ea3eca0eac2bfb59411a7687a405a05eb4c483f3949';
const DEFAULT_MODEL = 'gpt-5.6-terra';
const activeRequests = new Map();

const DEFAULT_SETTINGS = {
  theme: 'system',
  highContrast: false,
  accent: '#6d5dfc',
  sendOnEnter: true,
  streaming: true,
  defaultModel: DEFAULT_MODEL,
  autoFallback: true,
  codeThemeLight: 'github-light',
  codeThemeDark: 'github-dark',
  codeFont: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace'
};

const BUILT_IN_SKILLS = [
  {
    id: 'builtin-code-reviewer',
    name: 'Code reviewer',
    emoji: '🔍',
    color: '#7c6cff',
    system: 'You are a rigorous senior code reviewer. Analyze correctness, security, performance, maintainability, tests, and edge cases. Give prioritized, actionable feedback with concrete code examples when useful.',
    model: 'codex-auto-review'
  },
  {
    id: 'builtin-seo-copywriter',
    name: 'SEO copywriter',
    emoji: '✍️',
    color: '#ef8b5d',
    system: 'You are an expert SEO copywriter. Write clear, useful, original copy with a natural tone. Structure answers for readers first, use relevant search intent and keywords without stuffing, and suggest headings, meta title, and meta description when appropriate.'
  },
  {
    id: 'builtin-senior-explainer',
    name: 'Explain like a senior engineer',
    emoji: '🧠',
    color: '#4fbf9b',
    system: 'Explain technical topics like a patient senior engineer mentoring a capable colleague. Start with the mental model, then explain trade-offs, practical examples, pitfalls, and a concise takeaway. Be precise and avoid unnecessary jargon.'
  },
  {
    id: 'builtin-translator',
    name: 'Translator RU ↔ EN',
    emoji: '🌐',
    color: '#4f9eea',
    system: 'You are a professional Russian-English translator. Detect the source language and translate into the other language. Preserve meaning, tone, formatting, names, code, URLs, and terminology. Briefly note ambiguities only when needed.'
  },
  {
    id: 'builtin-bug-hunter',
    name: 'Bug hunter',
    emoji: '🐞',
    color: '#df5d7a',
    system: 'You are a meticulous bug hunter. Reproduce the issue conceptually, identify likely root causes, inspect assumptions and boundary conditions, and propose minimal safe fixes with verification steps and tests.'
  }
];

const string = (value, fallback = '') => typeof value === 'string' ? value : fallback;
const file = (name) => path.join(app.getPath('userData'), name);
const requestKey = (sender, id) => `${sender.id}:${id}`;

function normalizeMessage(message) {
  return {
    role: ['user', 'assistant', 'system'].includes(message?.role) ? message.role : 'user',
    content: string(message?.content),
    ...(message?.err === true ? { err: true } : {}),
    ts: Number.isFinite(message?.ts) ? message.ts : Date.now()
  };
}

function normalizeChat(chat) {
  const now = Date.now();
  return {
    id: string(chat?.id, crypto.randomUUID()),
    title: string(chat?.title, 'Новый чат').trim() || 'Новый чат',
    model: string(chat?.model, DEFAULT_MODEL),
    systemPrompt: string(chat?.systemPrompt),
    pinned: chat?.pinned === true,
    createdAt: Number.isFinite(chat?.createdAt) ? chat.createdAt : now,
    updatedAt: Number.isFinite(chat?.updatedAt) ? chat.updatedAt : now,
    messages: Array.isArray(chat?.messages) ? chat.messages.map(normalizeMessage) : [],
    ...(string(chat?.skillId) ? { skillId: string(chat.skillId) } : {})
  };
}

function normalizeSkill(skill) {
  return {
    id: string(skill?.id, crypto.randomUUID()),
    name: string(skill?.name, 'Новый навык').trim() || 'Новый навык',
    emoji: string(skill?.emoji, '✨').slice(0, 8),
    color: /^#[\da-f]{6}$/i.test(string(skill?.color)) ? skill.color : '#6d5dfc',
    system: string(skill?.system),
    ...(string(skill?.model) ? { model: string(skill.model) } : {})
  };
}

function normalizeSettings(settings) {
  const source = settings && typeof settings === 'object' ? settings : {};
  return {
    ...DEFAULT_SETTINGS,
    ...source,
    theme: ['system', 'light', 'dark'].includes(source.theme) ? source.theme : 'system',
    highContrast: source.highContrast === true,
    sendOnEnter: source.sendOnEnter !== false,
    streaming: source.streaming !== false,
    autoFallback: source.autoFallback !== false,
    defaultModel: string(source.defaultModel, DEFAULT_MODEL)
  };
}

async function readJson(name, fallback) {
  try {
    return JSON.parse(await fs.readFile(file(name), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return fallback;
    throw error;
  }
}

async function writeJson(name, data) {
  const destination = file(name);
  const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(temporary, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(temporary, destination);
}

async function getApiKey() {
  if (process.env.CODEXER_API_KEY?.trim()) return process.env.CODEXER_API_KEY.trim();

  try {
    const config = await fs.readFile(path.join(app.getPath('home'), 'codexer', 'config.yml'), 'utf8');
    const groups = config.split(/\n(?=\s*-\s*(?:gid\s*:|\n))/);
    for (const group of groups) {
      const gid = group.match(/(?:^|\n)\s*(?:-\s*)?gid\s*:\s*['"]?([^'"\s#]+)['"]?/)?.[1];
      const api = group.match(/(?:^|\n)\s*api\s*:\s*(.+?)\s*(?:#.*)?$/m)?.[1];
      if (gid === CONFIG_GID && api?.trim()) return api.trim().replace(/^['"]|['"]$/g, '');
    }
  } catch {
    return '';
  }
  return '';
}

function sendEvent(sender, payload) {
  if (!sender.isDestroyed()) sender.send('chat:event', payload);
}

function errorText(body, fallback) {
  try {
    return string(JSON.parse(body)?.error?.message, fallback);
  } catch {
    return body.trim() || fallback;
  }
}

async function streamChat(sender, request, controller) {
  let hasText = false;
  let errored = false;
  let done = false;
  const fail = (message) => {
    if (!errored) {
      errored = true;
      sendEvent(sender, { id: request.id, t: 'err', d: message });
    }
  };
  const finish = () => {
    if (!done) {
      done = true;
      sendEvent(sender, { id: request.id, t: 'done', d: '' });
    }
  };

  sendEvent(sender, { id: request.id, t: 'status', d: 'thinking' });

  try {
    const key = await getApiKey();
    if (!key) {
      fail('API key не настроен. Укажите CODEXER_API_KEY или api в ~/codexer/config.yml.');
      return;
    }

    const response = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json' },
      body: JSON.stringify({ model: request.model, messages: request.messages, stream: true }),
      signal: controller.signal
    });

    if (!response.ok) {
      fail(errorText(await response.text(), `Ошибка gateway (${response.status})`));
      return;
    }

    if (!response.headers.get('content-type')?.includes('text/event-stream')) {
      const body = await response.text();
      try {
        const answer = JSON.parse(body)?.choices?.[0]?.message?.content;
        if (typeof answer === 'string' && answer) {
          hasText = true;
          sendEvent(sender, { id: request.id, t: 'txt', d: answer });
        } else fail(errorText(body, 'пустой ответ — лимит/таймаут'));
      } catch {
        fail(errorText(body, 'Gateway вернул некорректный ответ.'));
      }
      return;
    }

    if (!response.body) {
      fail('Gateway не открыл поток ответа.');
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let complete = false;

    const consume = (raw) => {
      const line = raw.replace(/\r$/, '');
      if (!line.startsWith('data:')) return;
      const data = line.slice(5).trimStart();
      if (data === '[DONE]') {
        complete = true;
        return;
      }
      if (!data) return;
      try {
        const chunk = JSON.parse(data);
        if (typeof chunk?.error?.message === 'string') return fail(chunk.error.message);
        const delta = chunk?.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta) {
          hasText = true;
          sendEvent(sender, { id: request.id, t: 'txt', d: delta });
        }
      } catch {
        fail('Gateway прислал некорректный фрагмент потока.');
      }
    };

    while (!complete) {
      const { value, done: readerDone } = await reader.read();
      if (readerDone) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      lines.forEach(consume);
    }
    buffer += decoder.decode();
    if (buffer) consume(buffer);
    if (!hasText && !errored && !controller.signal.aborted) fail('пустой ответ — лимит/таймаут');
  } catch (error) {
    if (!controller.signal.aborted) fail(error?.message || 'Не удалось связаться с gateway.');
  } finally {
    finish();
    activeRequests.delete(requestKey(sender, request.id));
  }
}

function installMenu() {
  const command = (name) => {
    const window = BrowserWindow.getFocusedWindow();
    if (window && !window.isDestroyed()) window.webContents.send('app:command', name);
  };

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Codexarion',
      submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }]
    },
    {
      label: 'Файл',
      submenu: [
        { label: 'Новый чат', accelerator: 'CommandOrControl+N', click: () => command('new-chat') },
        { label: 'Экспортировать чат…', accelerator: 'CommandOrControl+Shift+E', click: () => command('export-chat') },
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    {
      label: 'Правка',
      submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }, { type: 'separator' }, { label: 'Найти в чатах', accelerator: 'CommandOrControl+F', click: () => command('focus-search') }]
    },
    {
      label: 'Вид',
      submenu: [{ label: 'Командная палитра', accelerator: 'CommandOrControl+K', click: () => command('palette') }, { label: 'Остановить ответ', accelerator: 'Escape', click: () => command('stop') }, { type: 'separator' }, { role: 'toggleDevTools' }, { role: 'togglefullscreen' }]
    },
    { label: 'Окно', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }] }
  ]));
}

function registerIpc() {
  ipcMain.handle('gateway:status', async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    try {
      await fetch('http://127.0.0.1:9090/', { signal: controller.signal });
      return { up: true };
    } catch {
      return { up: false };
    } finally {
      clearTimeout(timeout);
    }
  });

  ipcMain.on('chat:send', (event, payload) => {
    const id = string(payload?.id);
    if (!id) return;
    const key = requestKey(event.sender, id);
    activeRequests.get(key)?.abort();
    const controller = new AbortController();
    activeRequests.set(key, controller);
    const messages = Array.isArray(payload?.messages)
      ? payload.messages.filter((message) => ['user', 'assistant', 'system'].includes(message?.role)).map((message) => ({ role: message.role, content: string(message.content) }))
      : [];
    void streamChat(event.sender, { id, model: string(payload?.model, DEFAULT_MODEL), messages }, controller);
  });

  ipcMain.on('chat:stop', (event, id) => activeRequests.get(requestKey(event.sender, string(id)))?.abort());

  ipcMain.handle('store:listChats', async () => {
    const chats = await readJson('conversations.json', []);
    return Array.isArray(chats) ? chats.map(normalizeChat).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt) : [];
  });

  ipcMain.handle('store:saveChat', async (_event, chat) => {
    const chats = await readJson('conversations.json', []);
    const list = Array.isArray(chats) ? chats.map(normalizeChat) : [];
    const value = normalizeChat(chat);
    const index = list.findIndex((item) => item.id === value.id);
    if (index >= 0) {
      value.createdAt = list[index].createdAt;
      list[index] = value;
    } else list.push(value);
    await writeJson('conversations.json', list);
  });

  ipcMain.handle('store:deleteChat', async (_event, id) => {
    const chats = await readJson('conversations.json', []);
    await writeJson('conversations.json', (Array.isArray(chats) ? chats : []).filter((chat) => chat?.id !== id));
  });

  ipcMain.handle('store:getSettings', async () => normalizeSettings(await readJson('settings.json', DEFAULT_SETTINGS)));
  ipcMain.handle('store:setSettings', async (_event, settings) => writeJson('settings.json', normalizeSettings(settings)));

  ipcMain.handle('store:getSkills', async () => {
    const skills = await readJson('skills.json', null);
    if (!Array.isArray(skills)) {
      const seeded = BUILT_IN_SKILLS.map(normalizeSkill);
      await writeJson('skills.json', seeded);
      return seeded;
    }
    return skills.map(normalizeSkill);
  });

  ipcMain.handle('store:setSkills', async (_event, skills) => {
    await writeJson('skills.json', Array.isArray(skills) ? skills.map(normalizeSkill) : []);
  });

  ipcMain.handle('store:getRoutines', async () => []);
  ipcMain.handle('store:setRoutines', async () => {});
  ipcMain.handle('accounts:list', async () => []);
  ipcMain.handle('accounts:addStart', async () => ({ loginUrl: '', session: '' }));
  ipcMain.handle('accounts:addComplete', async () => ({ ok: false, accounts: [], error: 'Добавление аккаунтов пока недоступно.' }));
  ipcMain.handle('accounts:restartDaemon', async () => ({ ok: false }));

  ipcMain.handle('sys:exportChat', async (event, rawChat) => {
    const chat = normalizeChat(rawChat);
    const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
      title: 'Экспортировать чат',
      defaultPath: `${chat.title.replace(/[\\/:*?"<>|]/g, '-').slice(0, 80) || 'codexer-chat'}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    const output = [`# ${chat.title}`, '', ...chat.messages.flatMap((message) => [`## ${message.role === 'user' ? 'Пользователь' : message.role === 'assistant' ? 'Codexarion' : 'Система'}`, '', message.content, ''])].join('\n');
    try {
      await fs.writeFile(result.filePath, output, 'utf8');
      return { ok: true, canceled: false };
    } catch (error) {
      return { ok: false, canceled: false, error: error?.message || 'Не удалось сохранить файл.' };
    }
  });

  ipcMain.on('sys:openExternal', (_event, rawUrl) => {
    try {
      const url = new URL(string(rawUrl));
      if (url.protocol === 'http:' || url.protocol === 'https:') void shell.openExternal(url.toString());
    } catch {
      // Invalid renderer input is ignored.
    }
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1220,
    height: 800,
    minWidth: 880,
    minHeight: 600,
    title: 'Codexarion',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#111217',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  void window.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  registerIpc();
  installMenu();
  createWindow();
  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
