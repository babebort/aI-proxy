'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, screen } = require('electron');
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
const activeAgents = new Map();
const pendingApprovals = new Map();
let authProcess = null;
let authOutput = '';

const AGENT_TOOLS = [
  { type: 'function', function: { name: 'read_file', description: 'Read a UTF-8 text file inside the workspace.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'list_dir', description: 'List entries in a workspace directory.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: [] } } },
  { type: 'function', function: { name: 'write_file', description: 'Create or overwrite a UTF-8 text file in the workspace. Requires user approval.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
  { type: 'function', function: { name: 'edit_file', description: 'Replace one exact occurrence of text in a workspace file. Requires user approval.', parameters: { type: 'object', properties: { path: { type: 'string' }, old: { type: 'string' }, new: { type: 'string' } }, required: ['path', 'old', 'new'] } } },
  { type: 'function', function: { name: 'run_command', description: 'Run a bash command from the workspace root. Requires user approval.', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } } }
];

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

async function workspacePath() {
  const settings = await readJson('settings.json', {});
  if (!settings.workspace) return '';
  try {
    const stat = await fs.stat(settings.workspace);
    return stat.isDirectory() ? await fs.realpath(settings.workspace) : '';
  } catch {
    return '';
  }
}

async function resolveInWorkspace(workspace, requested, allowMissing) {
  const raw = String(requested || '').trim();
  if (!raw || path.isAbsolute(raw) || raw.split(/[\\/]+/).includes('..')) {
    throw new Error('Путь должен быть относительным и не выходить за пределы workspace.');
  }
  const target = path.resolve(workspace, raw);
  const relative = path.relative(workspace, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Путь выходит за пределы workspace.');
  }
  if (allowMissing) {
    try { await fs.access(target); } catch { return target; }
  }
  const real = await fs.realpath(target);
  if (real !== workspace && !real.startsWith(`${workspace}${path.sep}`)) {
    throw new Error('Символическая ссылка выходит за пределы workspace.');
  }
  return real;
}

function diffPreview(before, after) {
  const a = String(before).split('\n').slice(0, 150);
  const b = String(after).split('\n').slice(0, 150);
  return [...a.map((l) => `- ${l}`), ...b.map((l) => `+ ${l}`)].join('\n');
}

function runCommand(command, cwd, signal) {
  return new Promise((resolve) => {
    const child = spawn('/bin/bash', ['-lc', command], {
      cwd,
      env: { PATH: process.env.PATH || '/usr/bin:/bin', HOME: cwd, PWD: cwd, TERM: 'dumb' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    const append = (chunk) => { if (output.length < 100_000) output += chunk.toString(); };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const timer = setTimeout(() => child.kill('SIGTERM'), 120_000);
    const onAbort = () => child.kill('SIGTERM');
    signal?.addEventListener('abort', onAbort, { once: true });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve({ ok: code === 0, text: output || `(код завершения ${code})` });
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, text: error.message });
    });
  });
}

function commandLooksSafe(command) {
  const v = String(command || '').trim();
  if (!v || v.length > 8000) return false;
  if (/(^|[\s;&|])(cd|pushd|popd|sudo|ssh|scp|curl|wget|nc|telnet)\b/i.test(v)) return false;
  return true;
}

function waitForApproval(sender, requestId, tool) {
  return new Promise((resolve) => {
    const approvalId = `${requestId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const timer = setTimeout(() => { pendingApprovals.delete(approvalId); resolve(false); }, 10 * 60 * 1000);
    pendingApprovals.set(approvalId, {
      resolve: (approved) => { clearTimeout(timer); pendingApprovals.delete(approvalId); resolve(approved === true); }
    });
    sender.send('agent:event', { requestId, type: 'approval', approvalId, tool });
  });
}

async function executeTool(sender, requestId, workspace, call, signal) {
  const name = call.function?.name;
  let args;
  try { args = JSON.parse(call.function?.arguments || '{}'); } catch { return { ok: false, text: 'Некорректные JSON-аргументы инструмента.' }; }

  const mutating = ['write_file', 'edit_file', 'run_command'].includes(name);
  const preview = { name, path: args.path || '', command: args.command || '', diff: '' };

  try {
    if (name === 'write_file') {
      const target = await resolveInWorkspace(workspace, args.path, true);
      let previous = '';
      try { previous = await fs.readFile(target, 'utf8'); } catch { /* new file */ }
      preview.diff = diffPreview(previous, String(args.content || ''));
    } else if (name === 'edit_file') {
      const target = await resolveInWorkspace(workspace, args.path, false);
      const previous = await fs.readFile(target, 'utf8');
      preview.diff = diffPreview(previous, previous.replace(String(args.old || ''), String(args.new || '')));
    }
  } catch (error) {
    return { ok: false, text: error.message };
  }

  sender.send('agent:event', { requestId, type: 'tool', callId: call.id, tool: preview });

  if (mutating) {
    const approved = await waitForApproval(sender, requestId, preview);
    if (!approved) {
      const result = { ok: false, text: 'Пользователь отклонил действие.' };
      sender.send('agent:event', { requestId, type: 'result', callId: call.id, ...result });
      return result;
    }
  }

  try {
    let result;
    if (name === 'read_file') {
      const target = await resolveInWorkspace(workspace, args.path, false);
      const stat = await fs.stat(target);
      if (stat.size > 1_000_000) throw new Error('Файл слишком большой для чтения.');
      result = { ok: true, text: await fs.readFile(target, 'utf8') };
    } else if (name === 'list_dir') {
      const target = await resolveInWorkspace(workspace, args.path || '.', false);
      const entries = await fs.readdir(target, { withFileTypes: true });
      result = { ok: true, text: entries.slice(0, 400).map((e) => `${e.isDirectory() ? 'dir ' : 'file'} ${e.name}`).join('\n') || '(пусто)' };
    } else if (name === 'write_file') {
      const target = await resolveInWorkspace(workspace, args.path, true);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, String(args.content || ''), 'utf8');
      result = { ok: true, text: `Записан файл ${args.path}.` };
    } else if (name === 'edit_file') {
      const target = await resolveInWorkspace(workspace, args.path, false);
      const previous = await fs.readFile(target, 'utf8');
      const oldText = String(args.old || '');
      if (!oldText) throw new Error('Параметр old не может быть пустым.');
      const count = previous.split(oldText).length - 1;
      if (count !== 1) throw new Error(`Ожидалось ровно одно совпадение old, найдено: ${count}.`);
      await fs.writeFile(target, previous.replace(oldText, String(args.new || '')), 'utf8');
      result = { ok: true, text: `Изменён файл ${args.path}.` };
    } else if (name === 'run_command') {
      if (!commandLooksSafe(args.command)) throw new Error('Команда отклонена (сеть/sudo/выход из workspace запрещены).');
      result = await runCommand(args.command, workspace, signal);
    } else {
      throw new Error(`Неизвестный инструмент: ${name}.`);
    }
    sender.send('agent:event', { requestId, type: 'result', callId: call.id, ...result });
    return result;
  } catch (error) {
    const result = { ok: false, text: error.message };
    sender.send('agent:event', { requestId, type: 'result', callId: call.id, ...result });
    return result;
  }
}

async function requestAgentTurn(sender, agent) {
  const key = await gatewayKey();
  if (!key) throw new Error('API ключ не найден.');

  const response = await fetch(CHAT_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: agent.model, messages: agent.messages, tools: AGENT_TOOLS, tool_choice: 'auto', stream: true }),
    signal: agent.controller.signal
  });

  if (!response.ok) throw new Error(errorMessageFromBody(await response.text(), `Gateway error: HTTP ${response.status}`));
  if (!response.body) throw new Error('Gateway не открыл поток ответа.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done = false;
  let content = '';
  const calls = new Map();

  while (!done) {
    const { value, done: readerDone } = await reader.read();
    if (readerDone) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') { done = true; break; }
      let chunk;
      try { chunk = JSON.parse(payload); } catch { continue; }
      if (chunk?.error) throw new Error(String(chunk.error.message || chunk.error));
      const delta = chunk?.choices?.[0]?.delta || {};
      if (typeof delta.content === 'string' && delta.content) {
        content += delta.content;
        sender.send('chat:event', { requestId: agent.requestId, type: 'text', text: delta.content });
      }
      for (const partial of delta.tool_calls || []) {
        const index = Number.isInteger(partial.index) ? partial.index : calls.size;
        const call = calls.get(index) || { id: '', type: 'function', function: { name: '', arguments: '' } };
        if (partial.id) call.id += partial.id;
        if (partial.function?.name) call.function.name += partial.function.name;
        if (partial.function?.arguments) call.function.arguments += partial.function.arguments;
        calls.set(index, call);
      }
    }
  }

  return { content, toolCalls: [...calls.values()].filter((c) => c.function.name) };
}

async function runAgent(event, request) {
  const requestId = String(request.requestId || '');
  const workspace = await workspacePath();
  event.sender.send('chat:event', { requestId, type: 'thinking' });

  if (!workspace) {
    event.sender.send('chat:event', { requestId, type: 'error', message: 'Выберите workspace в Settings перед включением Agent mode.' });
    event.sender.send('chat:event', { requestId, type: 'done' });
    return;
  }

  const controller = new AbortController();
  const agent = { requestId, model: MODELS.includes(request.model) ? request.model : MODELS[0], messages: cleanMessages(request.messages), controller };
  activeAgents.set(requestId, agent);
  event.sender.send('agent:event', { requestId, type: 'workspace', workspace });

  let step = 0;
  try {
    while (!controller.signal.aborted && step < 25) {
      step += 1;
      const turn = await requestAgentTurn(event.sender, agent);
      if (!turn.toolCalls.length) {
        if (!turn.content) event.sender.send('chat:event', { requestId, type: 'error', message: 'пустой ответ — лимит/таймаут' });
        break;
      }
      agent.messages.push({ role: 'assistant', content: turn.content || null, tool_calls: turn.toolCalls });
      for (const call of turn.toolCalls) {
        if (controller.signal.aborted) break;
        const result = await executeTool(event.sender, requestId, workspace, call, controller.signal);
        agent.messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
      }
    }
    if (step >= 25 && !controller.signal.aborted) {
      event.sender.send('chat:event', { requestId, type: 'error', message: 'Agent достиг лимита в 25 шагов.' });
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      event.sender.send('chat:event', { requestId, type: 'error', message: String(error.message || error) });
    }
  } finally {
    activeAgents.delete(requestId);
    event.sender.send('chat:event', { requestId, type: 'done' });
  }
}

function createWindow() {
  const workArea = screen.getPrimaryDisplay().workArea;
  const width = Math.min(1320, workArea.width - 40);
  const height = Math.min(860, workArea.height - 40);
  const x = workArea.x + Math.round((workArea.width - width) / 2);
  const y = workArea.y + Math.round((workArea.height - height) / 2);

  mainWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
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

  mainWindow.on('show', () => {
    const visible = screen.getDisplayMatching(mainWindow.getBounds());
    const bounds = mainWindow.getBounds();
    const inside = bounds.x >= visible.workArea.x - 20 &&
      bounds.y >= visible.workArea.y - 20 &&
      bounds.x + bounds.width <= visible.workArea.x + visible.workArea.width + 20 &&
      bounds.y + bounds.height <= visible.workArea.y + visible.workArea.height + 20;
    if (!inside) mainWindow.center();
  });

  mainWindow.webContents.on('console-message', (event) => {
    const { message, lineNumber, sourceId } = event;
    console.log(`[renderer] ${sourceId}:${lineNumber} ${message}`);
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.log('[renderer] CRASHED', JSON.stringify(details));
  });

  // file:// assets can otherwise be served from Chromium's persistent HTTP
  // cache across relaunches, silently masking CSS/JS edits during development.
  mainWindow.webContents.session.clearCache().finally(() => {
    mainWindow.loadFile(path.join(__dirname, '../assets/index.html'));
  });
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
  const agent = activeAgents.get(String(requestId));
  if (agent) agent.controller.abort();
  return Boolean(controller || agent);
});

ipcMain.handle('agent:start', async (event, request) => {
  runAgent(event, request).catch((error) => {
    event.sender.send('chat:event', { requestId: request.requestId, type: 'error', message: String(error.message || error) });
    event.sender.send('chat:event', { requestId: request.requestId, type: 'done' });
  });
  return true;
});

ipcMain.handle('agent:approve', async (_event, approvalId, approved) => {
  const pending = pendingApprovals.get(String(approvalId));
  if (pending) pending.resolve(approved === true);
  return Boolean(pending);
});

ipcMain.handle('workspace:get', async () => ({ path: await workspacePath() }));

ipcMain.handle('workspace:pick', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { title: 'Select workspace', properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled || !result.filePaths[0]) return { canceled: true, path: await workspacePath() };
  const selected = await fs.realpath(result.filePaths[0]);
  const settings = await readJson('settings.json', {});
  await writeJson('settings.json', { ...settings, workspace: selected });
  return { canceled: false, path: selected };
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
