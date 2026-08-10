'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const YAML = require('yaml');

const execFileAsync = promisify(execFile);

const GID = 'cfe83f1b603c9dfef46e8ea3eca0eac2bfb59411a7687a405a05eb4c483f3949';
const GATEWAY = 'http://127.0.0.1:9090';
const CHAT_URL = `${GATEWAY}/v1/chat/completions`;
const MODELS = [
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5',
  'gpt-5.4-mini',
  'codex-auto-review'
];

let mainWindow = null;
const activeRequests = new Map();
let authProcess = null;
let authOutput = '';

const builtInSkills = [
  {
    id: 'builtin-code-reviewer',
    name: 'Code reviewer',
    emoji: '🔎',
    color: '#6d5efc',
    model: 'codex-auto-review',
    prompt: 'You are a meticulous senior code reviewer. Identify correctness, security, performance, readability, and maintainability issues. Give concrete fixes and prioritize findings.'
  },
  {
    id: 'builtin-seo',
    name: 'SEO copywriter',
    emoji: '✍️',
    color: '#e27a3f',
    model: '',
    prompt: 'You are an expert SEO copywriter. Produce clear, persuasive, search-friendly copy with useful structure, natural keywords, and an audience-first tone.'
  },
  {
    id: 'builtin-explain',
    name: 'Explain like a senior engineer',
    emoji: '🧠',
    color: '#2784d8',
    model: '',
    prompt: 'Explain the subject like a kind senior engineer mentoring a capable colleague. Start with the mental model, then practical details, trade-offs, and examples.'
  },
  {
    id: 'builtin-translator',
    name: 'Translator RU ↔ EN',
    emoji: '🌐',
    color: '#27a26a',
    model: '',
    prompt: 'You are a precise professional translator between Russian and English. Preserve meaning, tone, formatting, names, terminology, and intent. Return only the translation unless clarification is necessary.'
  },
  {
    id: 'builtin-bug-hunter',
    name: 'Bug hunter',
    emoji: '🐛',
    color: '#d54a5c',
    model: '',
    prompt: 'You are an adversarial bug hunter. Analyze edge cases, race conditions, invalid assumptions, input validation, state transitions, and failure modes. Offer reproducible tests and fixes.'
  }
];

const builtInRoutines = [
  {
    id: 'builtin-summarize-translate',
    name: 'Summarize → translate',
    steps: [
      'Summarize this clearly in concise bullet points:\n\n{{input}}',
      'Translate this summary into Russian, preserving its structure:\n\n{{previous}}'
    ]
  },
  {
    id: 'builtin-draft-critique-revise',
    name: 'Draft → critique → revise',
    steps: [
      'Create a strong first draft for this request:\n\n{{input}}',
      'Critique the following draft. Identify weaknesses and propose specific improvements:\n\n{{previous}}',
      'Write a final improved version using this critique and draft context:\n\n{{previous}}'
    ]
  }
];

function dataPath(name) {
  return path.join(app.getPath('userData'), name);
}

async function readJson(name, fallback) {
  try {
    return JSON.parse(await fs.readFile(dataPath(name), 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(name, value) {
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  const temp = `${dataPath(name)}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(temp, dataPath(name));
}

const defaultSettings = {
  theme: 'system',
  highContrast: false,
  accent: '#6d5efc',
  sendOnEnter: true,
  streaming: true,
  defaultModel: MODELS[0],
  autoFallback: true,
  codeThemeLight: 'paper',
  codeThemeDark: 'midnight',
  codeFont: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace'
};

async function configObject() {
  try {
    return YAML.parse(await fs.readFile(path.join(os.homedir(), 'codexer/config.yml'), 'utf8')) || {};
  } catch {
    return {};
  }
}

async function groupConfig() {
  const cfg = await configObject();
  return (cfg.groups || []).find((group) => group.gid === GID) || {};
}

async function gatewayKey() {
  if (process.env.CODEXER_API_KEY?.trim()) return process.env.CODEXER_API_KEY.trim();
  const group = await groupConfig();
  return String(group.api || '').trim();
}

function safeSend(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

async function gatewayStatus() {
  try {
    const response = await fetch(`${GATEWAY}/`, {
      signal: AbortSignal.timeout(1800)
    });
    return { up: response.ok || response.status < 500, detail: `HTTP ${response.status}` };
  } catch (error) {
    return { up: false, detail: error.message || 'Gateway unavailable' };
  }
}

async function kickstartGateway() {
  try {
    const { stdout } = await execFileAsync('id', ['-u']);
    await execFileAsync('launchctl', [
      'kickstart',
      '-k',
      `gui/${stdout.trim()}/com.bortnik.codexer`
    ]);
    return true;
  } catch {
    return false;
  }
}

async function ensureGateway() {
  let status = await gatewayStatus();
  if (status.up) return status;

  const kicked = await kickstartGateway();
  if (kicked) {
    await new Promise((resolve) => setTimeout(resolve, 1600));
    status = await gatewayStatus();
    if (status.up) return status;
  }

  try {
    await execFileAsync(path.join(os.homedir(), 'codexer-sweep/setup-codexer.sh'), [], {
      timeout: 30000
    });
  } catch {
    // The UI remains usable and presents gateway diagnostics.
  }

  await new Promise((resolve) => setTimeout(resolve, 1200));
  return gatewayStatus();
}

function cleanMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) =>
      message &&
      ['system', 'user', 'assistant'].includes(message.role) &&
      !message.error &&
      typeof message.content === 'string' &&
      message.content.trim()
    )
    .map(({ role, content }) => ({ role, content }));
}

function errorMessageFromBody(body, fallback) {
  try {
    const parsed = JSON.parse(body);
    if (parsed?.error?.message) return String(parsed.error.message);
    if (parsed?.message) return String(parsed.message);
  } catch {
    // Plain response body is still useful.
  }
  return body?.trim() || fallback;
}

async function streamChat(event, request) {
  const requestId = String(request.requestId || '');
  const model = MODELS.includes(request.model) ? request.model : MODELS[0];
  const messages = cleanMessages(request.messages);
  const key = await gatewayKey();

  if (!key) {
    event.sender.send('chat:event', {
      requestId,
      type: 'error',
      message: 'Не найден API ключ Codexarion. Укажи CODEXER_API_KEY или проверь ~/codexer/config.yml.'
    });
    event.sender.send('chat:event', { requestId, type: 'done' });
    return;
  }

  const controller = new AbortController();
  activeRequests.set(requestId, controller);
  event.sender.send('chat:event', { requestId, type: 'thinking' });

  let accumulated = '';
  let sawError = false;
  let aborted = false;

  try {
    const response = await fetch(CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model, messages, stream: request.streaming !== false }),
      signal: controller.signal
    });

    if (!response.ok) {
      sawError = true;
      const body = await response.text();
      event.sender.send('chat:event', {
        requestId,
        type: 'error',
        message: errorMessageFromBody(body, `Gateway error: HTTP ${response.status}`)
      });
      return;
    }

    const contentType = response.headers.get('content-type') || '';

    if (!contentType.includes('text/event-stream')) {
      const body = await response.text();
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        throw new Error(errorMessageFromBody(body, 'Gateway returned an invalid non-streaming response.'));
      }

      if (parsed?.error) {
        sawError = true;
        event.sender.send('chat:event', {
          requestId,
          type: 'error',
          message: String(parsed.error.message || parsed.error)
        });
        return;
      }

      const text = parsed?.choices?.[0]?.message?.content;
      if (text) {
        accumulated += text;
        event.sender.send('chat:event', { requestId, type: 'text', text });
      }
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let done = false;

    while (!done) {
      let stalled = false;
      const stallTimer = setTimeout(() => { stalled = true; controller.abort(); }, 90_000);
      let readerDone, value;
      try {
        ({ value, done: readerDone } = await reader.read());
      } finally {
        clearTimeout(stallTimer);
      }
      if (stalled) throw new Error('Таймаут ответа — сервер молчал более 90с.');
      if (readerDone) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || !line.startsWith('data:')) continue;

        const payload = line.slice(5).trim();
        if (payload === '[DONE]') {
          done = true;
          break;
        }

        let chunk;
        try {
          chunk = JSON.parse(payload);
        } catch {
          continue;
        }

        if (chunk?.error) {
          sawError = true;
          event.sender.send('chat:event', {
            requestId,
            type: 'error',
            message: String(chunk.error.message || chunk.error)
          });
          done = true;
          break;
        }

        const choice = chunk?.choices?.[0] || {};
        const text = choice?.delta?.content ?? choice?.message?.content;
        if (typeof text === 'string' && text.length) {
          accumulated += text;
          event.sender.send('chat:event', { requestId, type: 'text', text });
        }
      }
    }
  } catch (error) {
    aborted = error?.name === 'AbortError';
    sawError = true;
    event.sender.send('chat:event', {
      requestId,
      type: aborted ? 'aborted' : 'error',
      message: aborted ? 'Остановлено' : String(error?.message || error)
    });
  } finally {
    activeRequests.delete(requestId);

    if (!accumulated && !sawError && !aborted) {
      event.sender.send('chat:event', {
        requestId,
        type: 'error',
        message: 'пустой ответ — вероятно лимит или таймаут; попробуй ещё раз или смени модель'
      });
    }

    event.sender.send('chat:event', {
      requestId,
      type: 'done',
      text: accumulated
    });
  }
}

async function accountsInfo() {
  const group = await groupConfig();
  const status = await gatewayStatus();
  const users = Array.isArray(group.users) ? group.users : [];

  return {
    gateway: status,
    mode: 'multiuser',
    groupFound: Boolean(group.gid),
    accounts: users.map((user, index) => ({
      id: String(user.id || user.email || user.alias || index),
      alias: user.alias || user.label || user.name || '',
      email: user.email || user.login || '',
      label: user.label || user.name || '',
      status: user.status || (user.rate_limited ? 'rate-limited' : 'active')
    }))
  };
}

function beginAuth() {
  if (authProcess) throw new Error('Авторизация уже выполняется.');

  const binary = path.join(os.homedir(), 'codexer/codexer');
  authOutput = '';
  authProcess = spawn(binary, ['auth'], {
    cwd: path.join(os.homedir(), 'codexer'),
    stdio: ['pipe', 'pipe', 'pipe']
  });

  authProcess.stdout.on('data', (data) => {
    authOutput += data.toString();
    const url = authOutput.match(/https?:\/\/[^\s"'<>]+/i)?.[0];
    safeSend('auth:event', { type: 'output', output: authOutput.slice(-6000), url });
    if (url) shell.openExternal(url).catch(() => {});
  });

  authProcess.stderr.on('data', (data) => {
    authOutput += data.toString();
    safeSend('auth:event', { type: 'output', output: authOutput.slice(-6000) });
  });

  authProcess.on('error', (error) => {
    safeSend('auth:event', { type: 'error', message: error.message });
    authProcess = null;
  });

  authProcess.on('close', async (code) => {
    const output = authOutput;
    authProcess = null;

    if (code === 0) {
      await kickstartGateway();
      safeSend('auth:event', { type: 'done', success: true, output });
    } else {
      safeSend('auth:event', {
        type: 'done',
        success: false,
        output,
        message: `Команда codexer auth завершилась с кодом ${code}.`
      });
    }
  });

  return { output: authOutput };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 940,
    minHeight: 620,
    title: 'Codexarion',
    backgroundColor: '#f8f8fc',
    vibrancy: 'sidebar',
    visualEffectState: 'active',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../assets/index.html'));
}

function appMenu() {
  const template = [
    {
      label: 'Codexarion',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Settings…',
          accelerator: 'CmdOrCtrl+,',
          click: () => safeSend('menu:action', 'settings')
        },
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
      label: 'File',
      submenu: [
        {
          label: 'New Chat',
          accelerator: 'CmdOrCtrl+N',
          click: () => safeSend('menu:action', 'new-chat')
        },
        {
          label: 'Export Conversation…',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => safeSend('menu:action', 'export')
        },
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Command Palette',
          accelerator: 'CmdOrCtrl+K',
          click: () => safeSend('menu:action', 'palette')
        },
        {
          label: 'Search Chats',
          accelerator: 'CmdOrCtrl+F',
          click: () => safeSend('menu:action', 'search')
        },
        { role: 'toggleDevTools' }
      ]
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  await fs.mkdir(app.getPath('userData'), { recursive: true });

  const skills = await readJson('skills.json', null);
  if (!skills) await writeJson('skills.json', builtInSkills);

  const routines = await readJson('routines.json', null);
  if (!routines) await writeJson('routines.json', builtInRoutines);

  const settings = await readJson('settings.json', null);
  if (!settings) await writeJson('settings.json', defaultSettings);

  createWindow();
  appMenu();
  ensureGateway().then((status) => safeSend('gateway:status', status));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

ipcMain.handle('app:bootstrap', async () => ({
  version: app.getVersion(),
  models: MODELS,
  settings: { ...defaultSettings, ...(await readJson('settings.json', {})) },
  conversations: await readJson('conversations.json', []),
  skills: await readJson('skills.json', builtInSkills),
  routines: await readJson('routines.json', builtInRoutines),
  gateway: await gatewayStatus(),
  userData: app.getPath('userData')
}));

ipcMain.handle('store:save', async (_event, type, value) => {
  const allowed = new Set(['conversations', 'skills', 'routines', 'settings']);
  if (!allowed.has(type)) throw new Error('Invalid store.');
  await writeJson(`${type}.json`, value);
  return true;
});

ipcMain.handle('chat:start', async (event, request) => {
  streamChat(event, request).catch((error) => {
    event.sender.send('chat:event', {
      requestId: request.requestId,
      type: 'error',
      message: String(error.message || error)
    });
    event.sender.send('chat:event', { requestId: request.requestId, type: 'done' });
  });
  return true;
});

ipcMain.handle('chat:stop', async (_event, requestId) => {
  const controller = activeRequests.get(String(requestId));
  if (controller) controller.abort();
  return Boolean(controller);
});

ipcMain.handle('gateway:ensure', ensureGateway);
ipcMain.handle('accounts:get', accountsInfo);

ipcMain.handle('accounts:auth-start', async () => beginAuth());

ipcMain.handle('accounts:auth-code', async (_event, code) => {
  if (!authProcess) throw new Error('Нет активного процесса авторизации.');
  authProcess.stdin.write(`${String(code).trim()}\n`);
  return true;
});

ipcMain.handle('export:conversation', async (_event, markdown, suggestedName) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export conversation',
    defaultPath: `${suggestedName || 'codexer-chat'}.md`,
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  });

  if (result.canceled || !result.filePath) return false;
  await fs.writeFile(result.filePath, markdown, 'utf8');
  return result.filePath;
});

ipcMain.handle('export:all', async (_event, markdown) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export all Codexarion data',
    defaultPath: 'codexer-export.md',
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  });

  if (result.canceled || !result.filePath) return false;
  await fs.writeFile(result.filePath, markdown, 'utf8');
  return result.filePath;
});

ipcMain.handle('data:clear', async () => {
  await Promise.all([
    writeJson('conversations.json', []),
    writeJson('skills.json', builtInSkills),
    writeJson('routines.json', builtInRoutines),
    writeJson('settings.json', defaultSettings)
  ]);
  return true;
});

ipcMain.handle('shell:open', async (_event, url) => {
  if (!/^https?:\/\//i.test(String(url))) throw new Error('Unsupported URL.');
  await shell.openExternal(url);
  return true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
