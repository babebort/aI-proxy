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

const text = (value, fallback = '') => typeof value === 'string' ? value : fallback;
const requestKey = (sender, id) => `${sender.id}:${id}`;
const conversationsPath = () => path.join(app.getPath('userData'), 'conversations.json');
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

function normalizeMessage(message) {
  return {
    role: ['user', 'assistant', 'system'].includes(message?.role) ? message.role : 'user',
    content: text(message?.content),
    ...(message?.err === true ? { err: true } : {}),
    ts: Number.isFinite(message?.ts) ? message.ts : Date.now()
  };
}

function normalizeChat(chat) {
  const now = Date.now();
  return {
    id: text(chat?.id, crypto.randomUUID()),
    title: text(chat?.title, 'Новый чат').trim() || 'Новый чат',
    model: text(chat?.model, DEFAULT_MODEL),
    systemPrompt: text(chat?.systemPrompt),
    pinned: chat?.pinned === true,
    createdAt: Number.isFinite(chat?.createdAt) ? chat.createdAt : now,
    updatedAt: Number.isFinite(chat?.updatedAt) ? chat.updatedAt : now,
    messages: Array.isArray(chat?.messages) ? chat.messages.map(normalizeMessage) : []
  };
}

function normalizeSettings(settings) {
  const source = settings && typeof settings === 'object' ? settings : {};
  return {
    ...DEFAULT_SETTINGS,
    ...source,
    theme: ['system', 'light', 'dark'].includes(source.theme) ? source.theme : DEFAULT_SETTINGS.theme,
    highContrast: source.highContrast === true,
    sendOnEnter: source.sendOnEnter !== false,
    streaming: source.streaming !== false,
    autoFallback: source.autoFallback !== false,
    accent: text(source.accent, DEFAULT_SETTINGS.accent),
    defaultModel: text(source.defaultModel, DEFAULT_SETTINGS.defaultModel),
    codeThemeLight: text(source.codeThemeLight, DEFAULT_SETTINGS.codeThemeLight),
    codeThemeDark: text(source.codeThemeDark, DEFAULT_SETTINGS.codeThemeDark),
    codeFont: text(source.codeFont, DEFAULT_SETTINGS.codeFont)
  };
}

function sortChats(chats) {
  return chats.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return fallback;
    throw error;
  }
}

async function writeJson(file, value) {
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(temporary, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(temporary, file);
}

async function readChats() {
  const parsed = await readJson(conversationsPath(), []);
  return Array.isArray(parsed) ? sortChats(parsed.map(normalizeChat)) : [];
}

async function readSettings() {
  return normalizeSettings(await readJson(settingsPath(), DEFAULT_SETTINGS));
}

async function loadApiKey() {
  const environmentKey = process.env.CODEXER_API_KEY?.trim();
  if (environmentKey) return environmentKey;

  try {
    const config = await fs.readFile(path.join(app.getPath('home'), 'codexer', 'config.yml'), 'utf8');
    const groups = config.split(/\n(?=\s*-\s*(?:gid\s*:|\n))/);

    for (const group of groups) {
      const gid = group.match(/(?:^|\n)\s*(?:-\s*)?gid\s*:\s*['"]?([^'"\s#]+)['"]?/)?.[1];
      if (gid !== CONFIG_GID) continue;

      const api = group.match(/(?:^|\n)\s*api\s*:\s*(.+?)\s*(?:#.*)?$/m)?.[1];
      const key = api?.trim().replace(/^['"]|['"]$/g, '').trim();
      if (key) return key;
    }
  } catch {
    return '';
  }

  return '';
}

function emitChat(sender, payload) {
  if (!sender.isDestroyed()) sender.send('chat:event', payload);
}

function parseGatewayError(body, fallback) {
  try {
    return text(JSON.parse(body)?.error?.message, fallback);
  } catch {
    return body.trim() || fallback;
  }
}

async function gatewayStatus() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);

  try {
    await fetch('http://127.0.0.1:9090/', { signal: controller.signal });
    return { up: true };
  } catch {
    return { up: false };
  } finally {
    clearTimeout(timer);
  }
}

async function streamChat(sender, request, controller) {
  const { id, model, messages } = request;
  let receivedText = false;
  let emittedError = false;
  let emittedDone = false;

  const fail = (message) => {
    if (!emittedError) {
      emittedError = true;
      emitChat(sender, { id, t: 'err', d: message });
    }
  };

  const finish = () => {
    if (!emittedDone) {
      emittedDone = true;
      emitChat(sender, { id, t: 'done', d: '' });
    }
  };

  emitChat(sender, { id, t: 'status', d: 'thinking' });

  try {
    const apiKey = await loadApiKey();
    if (!apiKey) {
      fail('API key не настроен. Укажите CODEXER_API_KEY или api в ~/codexer/config.yml.');
      finish();
      return;
    }

    const response = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream, application/json'
      },
      body: JSON.stringify({ model, messages, stream: true }),
      signal: controller.signal
    });

    if (!response.ok) {
      fail(parseGatewayError(await response.text(), `Ошибка gateway (${response.status})`));
      finish();
      return;
    }

    if (!response.headers.get('content-type')?.includes('text/event-stream')) {
      const body = await response.text();
      try {
        const answer = JSON.parse(body)?.choices?.[0]?.message?.content;
        if (typeof answer === 'string' && answer) {
          receivedText = true;
          emitChat(sender, { id, t: 'txt', d: answer });
        } else {
          fail(parseGatewayError(body, 'пустой ответ — лимит/таймаут'));
        }
      } catch {
        fail(parseGatewayError(body, 'Gateway вернул некорректный ответ.'));
      }
      finish();
      return;
    }

    if (!response.body) {
      fail('Gateway не открыл поток ответа.');
      finish();
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let complete = false;

    const consumeLine = (rawLine) => {
      const line = rawLine.replace(/\r$/, '');
      if (!line.startsWith('data:')) return;

      const data = line.slice(5).trimStart();
      if (!data) return;
      if (data === '[DONE]') {
        complete = true;
        return;
      }

      try {
        const chunk = JSON.parse(data);
        if (typeof chunk?.error?.message === 'string') {
          fail(chunk.error.message);
          return;
        }

        const delta = chunk?.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta) {
          receivedText = true;
          emitChat(sender, { id, t: 'txt', d: delta });
        }
      } catch {
        fail('Gateway прислал некорректный фрагмент потока.');
      }
    };

    while (!complete) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        consumeLine(line);
        if (complete) break;
      }
    }

    buffer += decoder.decode();
    if (!complete && buffer) consumeLine(buffer);
    if (!receivedText && !emittedError && !controller.signal.aborted) {
      fail('пустой ответ — лимит/таймаут');
    }
    finish();
  } catch (error) {
    if (!controller.signal.aborted) fail(error?.message || 'Не удалось связаться с gateway.');
    finish();
  } finally {
    activeRequests.delete(requestKey(sender, id));
  }
}

function chatMarkdown(chat) {
  const title = chat.title.replaceAll('\n', ' ').trim();
  const output = [`# ${title}`, '', `Создан: ${new Date(chat.createdAt).toLocaleString('ru-RU')}`, ''];

  for (const message of chat.messages) {
    const author = message.role === 'user' ? 'Пользователь' : message.role === 'assistant' ? 'Codexarion' : 'Система';
    output.push(`## ${author}`, '', message.content, '');
  }

  return `${output.join('\n').trimEnd()}\n`;
}

function sendCommand(command) {
  const window = BrowserWindow.getFocusedWindow();
  if (window && !window.isDestroyed()) window.webContents.send('app:command', command);
}

function installMenu() {
  const template = [
    {
      label: 'Codexarion',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Файл',
      submenu: [
        { label: 'Новый чат', accelerator: 'CommandOrControl+N', click: () => sendCommand('new-chat') },
        { label: 'Экспортировать чат…', accelerator: 'CommandOrControl+Shift+E', click: () => sendCommand('export-chat') },
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    {
      label: 'Правка',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Найти в чатах', accelerator: 'CommandOrControl+F', click: () => sendCommand('focus-search') }
      ]
    },
    {
      label: 'Вид',
      submenu: [
        { label: 'Командная палитра', accelerator: 'CommandOrControl+K', click: () => sendCommand('palette') },
        { label: 'Остановить ответ', accelerator: 'Escape', click: () => sendCommand('stop') },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Окно',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpc() {
  ipcMain.handle('gateway:status', gatewayStatus);

  ipcMain.on('chat:send', (event, payload) => {
    const id = text(payload?.id);
    if (!id) return;

    const key = requestKey(event.sender, id);
    activeRequests.get(key)?.abort();

    const controller = new AbortController();
    activeRequests.set(key, controller);

    const messages = Array.isArray(payload?.messages)
      ? payload.messages
        .filter((message) => ['user', 'assistant', 'system'].includes(message?.role))
        .map((message) => ({ role: message.role, content: text(message.content) }))
      : [];

    void streamChat(event.sender, {
      id,
      model: text(payload?.model, DEFAULT_MODEL),
      messages
    }, controller);
  });

  ipcMain.on('chat:stop', (event, id) => {
    activeRequests.get(requestKey(event.sender, text(id)))?.abort();
  });

  ipcMain.handle('store:listChats', readChats);
  ipcMain.handle('store:saveChat', async (_event, chat) => {
    const normalized = normalizeChat(chat);
    const chats = await readChats();
    const index = chats.findIndex((item) => item.id === normalized.id);

    if (index >= 0) {
      normalized.createdAt = chats[index].createdAt;
      chats[index] = normalized;
    } else {
      chats.push(normalized);
    }

    await writeJson(conversationsPath(), sortChats(chats));
  });
  ipcMain.handle('store:deleteChat', async (_event, id) => {
    await writeJson(conversationsPath(), (await readChats()).filter((chat) => chat.id !== id));
  });

  ipcMain.handle('store:getSettings', readSettings);
  ipcMain.handle('store:setSettings', async (_event, settings) => {
    await writeJson(settingsPath(), normalizeSettings(settings));
  });

  ipcMain.handle('store:getSkills', async () => []);
  ipcMain.handle('store:setSkills', async () => {});
  ipcMain.handle('store:getRoutines', async () => []);
  ipcMain.handle('store:setRoutines', async () => {});

  ipcMain.handle('accounts:list', async () => []);
  ipcMain.handle('accounts:addStart', async () => ({ loginUrl: '', session: '' }));
  ipcMain.handle('accounts:addComplete', async () => ({
    ok: false,
    accounts: [],
    error: 'Добавление аккаунтов пока недоступно.'
  }));
  ipcMain.handle('accounts:restartDaemon', async () => ({ ok: false }));

  ipcMain.handle('sys:exportChat', async (event, chat) => {
    const normalized = normalizeChat(chat);
    const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
      title: 'Экспортировать чат',
      defaultPath: `${normalized.title.replace(/[\\/:*?"<>|]/g, '-').slice(0, 80) || 'codexer-chat'}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    });

    if (result.canceled || !result.filePath) return { ok: false, canceled: true };

    try {
      await fs.writeFile(result.filePath, chatMarkdown(normalized), 'utf8');
      return { ok: true, canceled: false };
    } catch (error) {
      return { ok: false, canceled: false, error: error?.message || 'Не удалось сохранить файл.' };
    }
  });

  ipcMain.on('sys:openExternal', (_event, value) => {
    try {
      const url = new URL(text(value));
      if (url.protocol === 'https:' || url.protocol === 'http:') void shell.openExternal(url.toString());
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
