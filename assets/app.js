'use strict';

window.addEventListener('error', (e) => {
  console.error('UNCAUGHT', e.message, e.filename + ':' + e.lineno);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('UNHANDLED-REJECTION', String(e.reason));
});

const $ = (selector, root = document) => root.querySelector(selector);
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

const state = {
  conversations: [],
  skills: [],
  routines: [],
  settings: {},
  models: [],
  activeId: null,
  busy: null,
  gateway: { up: false, detail: 'Checking gateway…' },
  routineRun: null,
  workspace: '',
  tools: new Map()
};

const elements = {
  list: $('#chat-list'),
  search: $('#chat-search'),
  title: $('#chat-title'),
  model: $('#model-picker'),
  messages: $('#messages'),
  chatView: $('#chat-view'),
  empty: $('#empty-state'),
  prompt: $('#prompt'),
  composer: $('#composer'),
  send: $('#send-button'),
  sendIcon: $('#send-icon'),
  gatewayLabel: $('#gateway-label'),
  gatewayDot: $('#gateway-dot'),
  modalRoot: $('#modal-root'),
  toastRoot: $('#toast-root'),
  routineBanner: $('#routine-banner'),
  agentToggle: $('#agent-toggle'),
  autoApproveToggle: $('#auto-approve-toggle'),
  workspaceButton: $('#workspace-button')
};

function id() {
  return `${Date.now()}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(16)}`;
}

function activeChat() {
  return state.conversations.find((chat) => chat.id === state.activeId);
}

function save(type, value) {
  return window.codexer.save(type, value).catch((error) => toast(`Не удалось сохранить: ${error.message}`));
}

function saveConversations() {
  return save('conversations', state.conversations);
}

function applyTheme() {
  const configured = state.settings.theme || 'system';
  const systemDark = matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = configured === 'dark' || (configured === 'system' && systemDark);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.contrast = String(Boolean(state.settings.highContrast && dark));
  document.documentElement.style.setProperty('--accent', state.settings.accent || '#6d5efc');
  document.documentElement.style.setProperty('--code-font', state.settings.codeFont || 'ui-monospace, monospace');
}

function toast(message) {
  elements.toastRoot.innerHTML = `<div class="toast">${escapeHtml(message)}</div>`;
  setTimeout(() => { elements.toastRoot.innerHTML = ''; }, 2600);
}

function titleFrom(text) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 48) || 'New chat';
}

function sortedChats() {
  return [...state.conversations].sort((a, b) =>
    Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
    new Date(b.updatedAt) - new Date(a.updatedAt)
  );
}

function newChat() {
  const chat = {
    id: id(),
    title: 'New chat',
    model: state.settings.defaultModel || state.models[0],
    systemPrompt: '',
    skillId: '',
    pinned: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: []
  };
  state.conversations.unshift(chat);
  state.activeId = chat.id;
  saveConversations();
  render();
  elements.prompt.focus();
}

function setActive(idValue) {
  if (state.busy) {
    toast('Останови текущий запрос перед переключением чата.');
    return;
  }
  state.activeId = idValue;
  render();
}

function renderSidebar() {
  const query = elements.search.value.trim().toLowerCase();
  const filtered = sortedChats().filter((chat) => {
    if (!query) return true;
    return [chat.title, ...(chat.messages || []).map((message) => message.content)]
      .join('\n')
      .toLowerCase()
      .includes(query);
  });

  elements.list.innerHTML = filtered.map((chat) => `
    <div class="chat-item ${chat.id === state.activeId ? 'active' : ''}" data-chat="${chat.id}">
      <span class="chat-pin">${chat.pinned ? '●' : ''}</span>
      <span class="chat-name">${escapeHtml(chat.title)}</span>
      <button class="chat-menu" data-menu="${chat.id}" title="Chat options">•••</button>
    </div>
  `).join('');

  elements.list.querySelectorAll('[data-chat]').forEach((node) => {
    node.addEventListener('click', (event) => {
      if (event.target.closest('[data-menu]')) return;
      setActive(node.dataset.chat);
    });
  });

  elements.list.querySelectorAll('[data-menu]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      showChatMenu(button.dataset.menu);
    });
  });
}

function showChatMenu(chatId) {
  const chat = state.conversations.find((item) => item.id === chatId);
  if (!chat) return;

  modal(`
    <div class="modal small">
      <div class="modal-head"><h2>${escapeHtml(chat.title)}</h2><button class="close-modal">×</button></div>
      <div class="modal-body">
        <div class="modal-actions" style="justify-content:stretch;display:grid;gap:8px">
          <button class="btn" data-action="rename">Rename</button>
          <button class="btn" data-action="pin">${chat.pinned ? 'Unpin' : 'Pin to top'}</button>
          <button class="btn danger" data-action="delete">Delete conversation</button>
        </div>
      </div>
    </div>
  `, (root, close) => {
    $('[data-action="rename"]', root).onclick = () => {
      close();
      elements.title.focus();
      elements.title.select();
    };
    $('[data-action="pin"]', root).onclick = () => {
      chat.pinned = !chat.pinned;
      chat.updatedAt = new Date().toISOString();
      saveConversations();
      close();
      renderSidebar();
    };
    $('[data-action="delete"]', root).onclick = () => {
      state.conversations = state.conversations.filter((item) => item.id !== chatId);
      if (state.activeId === chatId) state.activeId = state.conversations[0]?.id || null;
      saveConversations();
      close();
      if (!state.activeId) newChat();
      else render();
    };
  });
}

function renderHeader() {
  const chat = activeChat();
  if (!chat) return;

  elements.title.value = chat.title;
  elements.model.innerHTML = state.models.map((model) =>
    `<option value="${escapeHtml(model)}" ${model === chat.model ? 'selected' : ''}>${escapeHtml(model)}</option>`
  ).join('');
}

function messageTools(message, index) {
  const buttons = [`<button data-copy="${index}">Copy</button>`];
  if (message.role === 'assistant' && !message.error) buttons.push(`<button data-regenerate="${index}">Regenerate</button>`);
  if (message.role === 'user') buttons.push(`<button data-edit="${index}">Edit</button>`);
  return `<div class="message-tools">${buttons.join('')}</div>`;
}

function markdown(text) {
  const blocks = [];
  let input = String(text || '').replace(/```([\w+-]*)\n?([\s\S]*?)```/g, (_match, lang, code) => {
    const index = blocks.length;
    blocks.push(`<div class="code-wrap"><button class="code-copy" data-code-copy="${index}">Copy</button><pre><code class="language-${escapeHtml(lang)}">${highlight(code, lang)}</code></pre></div>`);
    return `\u0000CODE${index}\u0000`;
  });

  input = escapeHtml(input)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" data-link="$2">$1</a>');

  const lines = input.split('\n');
  let html = '';
  let list = null;

  const closeList = () => {
    if (list) html += `</${list}>`;
    list = null;
  };

  for (let line of lines) {
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    const unordered = line.match(/^\s*[-*]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+\.\s+(.+)$/);

    if (heading) {
      closeList();
      html += `<h${heading[1].length}>${heading[2]}</h${heading[1].length}>`;
    } else if (unordered) {
      if (list !== 'ul') { closeList(); html += '<ul>'; list = 'ul'; }
      html += `<li>${unordered[1]}</li>`;
    } else if (ordered) {
      if (list !== 'ol') { closeList(); html += '<ol>'; list = 'ol'; }
      html += `<li>${ordered[1]}</li>`;
    } else if (/^\|.*\|$/.test(line)) {
      closeList();
      const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
      if (!cells.every((cell) => /^:?-{3,}:?$/.test(cell))) {
        html += `<table class="md-table"><tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr></table>`;
      }
    } else {
      closeList();
      if (line.trim()) html += `<p>${line}</p>`;
    }
  }

  closeList();
  return html.replace(/\u0000CODE(\d+)\u0000/g, (_match, index) => blocks[Number(index)]);
}

function highlight(code, language) {
  let html = escapeHtml(String(code).replace(/^\n/, ''));
  if (/^(js|javascript|ts|typescript|json|jsx|tsx)$/i.test(language)) {
    html = html
      .replace(/(&quot;.*?&quot;|&#39;.*?&#39;)/g, '<span style="color:#bd5d22">$1</span>')
      .replace(/\b(const|let|var|function|return|async|await|if|else|class|new|import|from|export|true|false|null|undefined)\b/g, '<span style="color:#8055c7">$1</span>')
      .replace(/\b(\d+)\b/g, '<span style="color:#16805a">$1</span>');
  } else if (/^(py|python|sh|bash|zsh)$/i.test(language)) {
    html = html.replace(/\b(def|class|return|if|else|elif|for|while|import|from|in|True|False|None|function|then|fi)\b/g, '<span style="color:#8055c7">$1</span>');
  }
  return html;
}

function renderMessages() {
  const chat = activeChat();
  elements.messages.innerHTML = '';
  const visibleMessages = chat?.messages || [];
  elements.empty.classList.toggle('hidden', visibleMessages.length > 0);

  visibleMessages.forEach((message, index) => {
    const row = document.createElement('article');
    row.className = `message-row ${message.role === 'user' ? 'user' : 'assistant'}`;
    row.innerHTML = `
      <div class="avatar ${message.role === 'assistant' ? 'assistant' : ''}">${message.role === 'assistant' ? '✦' : 'You'}</div>
      <div class="message-column">
        <div class="message-bubble ${message.error ? 'error' : ''}" data-bubble="${index}">
          ${message.role === 'user' ? escapeHtml(message.content) : markdown(message.content)}
        </div>
        ${messageTools(message, index)}
      </div>
    `;
    elements.messages.appendChild(row);
  });

  if (state.busy?.chatId === state.activeId) renderBusyBubble();
  wireMessageButtons();
  scrollBottom();
}

function wireMessageButtons() {
  elements.messages.querySelectorAll('[data-copy]').forEach((button) => {
    button.onclick = async () => {
      const message = activeChat().messages[Number(button.dataset.copy)];
      await navigator.clipboard.writeText(message.content);
      toast('Copied');
    };
  });

  elements.messages.querySelectorAll('[data-code-copy]').forEach((button) => {
    button.onclick = async () => {
      const pre = button.parentElement.querySelector('code');
      await navigator.clipboard.writeText(pre.textContent);
      button.textContent = 'Copied';
      setTimeout(() => { button.textContent = 'Copy'; }, 900);
    };
  });

  elements.messages.querySelectorAll('[data-regenerate]').forEach((button) => {
    button.onclick = () => regenerate(Number(button.dataset.regenerate));
  });

  elements.messages.querySelectorAll('[data-edit]').forEach((button) => {
    button.onclick = () => editUserMessage(Number(button.dataset.edit));
  });

  elements.messages.querySelectorAll('[data-link]').forEach((link) => {
    link.onclick = (event) => {
      event.preventDefault();
      window.codexer.openExternal(link.dataset.link);
    };
  });
}

function renderBusyBubble() {
  const row = document.createElement('article');
  row.id = 'busy-row';
  row.className = 'message-row assistant';
  row.innerHTML = `
    <div class="avatar assistant">✦</div>
    <div class="message-column">
      <div class="message-bubble assistant-thinking">
        <span class="thinking"><i></i><i></i><i></i><span class="elapsed">думает… 0с</span></span>
      </div>
    </div>
  `;
  elements.messages.appendChild(row);
  updateThinking();
}

function updateThinking() {
  if (!state.busy) return;
  const elapsed = Math.max(0, Math.floor((Date.now() - state.busy.startedAt) / 1000));
  const target = $('#busy-row .elapsed');
  if (target && !state.busy.startedText) target.textContent = `думает… ${elapsed}с`;
}

function scrollBottom() {
  requestAnimationFrame(() => {
    elements.chatView.scrollTop = elements.chatView.scrollHeight;
  });
}

function renderGateway() {
  const up = Boolean(state.gateway.up);
  elements.gatewayDot.className = `status-dot ${up ? 'up' : 'down'}`;
  elements.gatewayLabel.textContent = up ? 'Gateway connected' : 'Gateway offline';
  elements.gatewayLabel.title = state.gateway.detail || '';
}

function renderRoutineBanner() {
  if (!state.routineRun) {
    elements.routineBanner.classList.add('hidden');
    return;
  }
  elements.routineBanner.classList.remove('hidden');
  elements.routineBanner.textContent = `Routine “${state.routineRun.name}” · step ${state.routineRun.index + 1}/${state.routineRun.steps.length}`;
}

function render() {
  renderSidebar();
  renderHeader();
  renderMessages();
  renderGateway();
  renderRoutineBanner();
  renderAgentControls();
}

function setBusy(busy) {
  state.busy = busy;
  elements.send.classList.toggle('stop', Boolean(busy));
  elements.sendIcon.textContent = busy ? '■' : '↑';
  if (!busy) clearInterval(window.__thinkingTimer);
  else {
    clearInterval(window.__thinkingTimer);
    window.__thinkingTimer = setInterval(updateThinking, 400);
  }
}

async function sendPrompt(rawText, options = {}) {
  const chat = activeChat() || (newChat(), activeChat());
  const text = rawText.trim();
  if (!text || state.busy) return;

  if (!options.internal) {
    chat.messages.push({ id: id(), role: 'user', content: text, createdAt: new Date().toISOString() });
    if (chat.title === 'New chat') chat.title = titleFrom(text);
    chat.updatedAt = new Date().toISOString();
    await saveConversations();
    render();
  }

  const requestId = id();
  setBusy({
    requestId,
    chatId: chat.id,
    startedAt: Date.now(),
    startedText: false,
    text: '',
    options
  });

  const systemMessages = [];
  if (chat.systemPrompt?.trim()) systemMessages.push({ role: 'system', content: chat.systemPrompt.trim() });

  if (chat.skillId) {
    const skill = state.skills.find((item) => item.id === chat.skillId);
    if (skill?.prompt) systemMessages.push({ role: 'system', content: skill.prompt });
  }

  renderMessages();
  const payload = {
    requestId,
    model: chat.model,
    messages: [...systemMessages, ...chat.messages],
    streaming: state.settings.streaming !== false
  };

  if (chat.agentMode) {
    await window.codexer.startAgent({ ...payload, autoApprove: Boolean(chat.autoApprove) });
  } else {
    await window.codexer.startChat(payload);
  }
}

function finishBusy(errorMessage = '') {
  const busy = state.busy;
  if (!busy) return;
  const chat = state.conversations.find((item) => item.id === busy.chatId);

  if (chat) {
    const content = busy.text || errorMessage;
    chat.messages.push({
      id: id(),
      role: 'assistant',
      content: content || 'пустой ответ — вероятно лимит или таймаут; попробуй ещё раз или смени модель',
      error: Boolean(errorMessage),
      createdAt: new Date().toISOString(),
      routineStep: busy.options?.routineStep || null
    });
    chat.updatedAt = new Date().toISOString();
    saveConversations();
  }

  setBusy(null);
  render();

  if (state.routineRun && !errorMessage) {
    const previous = busy.text;
    advanceRoutine(previous);
  } else if (state.routineRun) {
    state.routineRun = null;
    renderRoutineBanner();
  }
}

function renderAgentControls() {
  const chat = activeChat();
  const on = Boolean(chat?.agentMode);
  if (elements.agentToggle) {
    elements.agentToggle.textContent = `🤖 Agent: ${on ? 'on' : 'off'}`;
    elements.agentToggle.classList.toggle('active', on);
  }
  if (elements.workspaceButton) {
    elements.workspaceButton.textContent = state.workspace
      ? `📁 ${state.workspace.split('/').pop()}`
      : '📁 Workspace';
    elements.workspaceButton.title = state.workspace || 'Pick workspace folder for Agent mode';
  }
  if (elements.autoApproveToggle) {
    elements.autoApproveToggle.hidden = !on;
    const auto = Boolean(chat?.autoApprove);
    elements.autoApproveToggle.textContent = `⚠️ Auto-approve: ${auto ? 'on' : 'off'}`;
    elements.autoApproveToggle.classList.toggle('active', auto);
  }
}

elements.agentToggle?.addEventListener('click', () => {
  const chat = activeChat();
  if (!chat || state.busy) return;
  chat.agentMode = !chat.agentMode;
  chat.updatedAt = new Date().toISOString();
  saveConversations();
  renderAgentControls();
  toast(chat.agentMode ? 'Agent mode on — mutating actions need your approval' : 'Agent mode off');
});

elements.autoApproveToggle?.addEventListener('click', () => {
  const chat = activeChat();
  if (!chat || !chat.agentMode || state.busy) return;
  chat.autoApprove = !chat.autoApprove;
  chat.updatedAt = new Date().toISOString();
  saveConversations();
  renderAgentControls();
  toast(chat.autoApprove
    ? 'Auto-approve on — write/edit/run will execute without confirmation'
    : 'Auto-approve off');
});

elements.workspaceButton?.addEventListener('click', async () => {
  const result = await window.codexer.pickWorkspace();
  if (!result.canceled) {
    state.workspace = result.path;
    renderAgentControls();
    toast(`Workspace: ${result.path}`);
  }
});

const TOOL_VERBS = { read_file: 'Read', list_dir: 'Listed', write_file: 'Wrote', edit_file: 'Edited', run_command: 'Ran' };

function diffStat(diff) {
  if (!diff) return '';
  let added = 0, removed = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+')) added += 1;
    else if (line.startsWith('-')) removed += 1;
  }
  return added || removed ? ` <span class="stat-add">+${added}</span> <span class="stat-del">-${removed}</span>` : '';
}

function toolCardHtml(tool) {
  const status = tool.result
    ? (tool.result.ok ? 'Done' : 'Failed')
    : tool.approvalId ? 'Needs approval'
    : tool.autoApproved ? 'Auto-approved'
    : 'Running…';
  const verb = TOOL_VERBS[tool.name] || tool.name || 'Tool';
  const label = tool.name === 'run_command'
    ? `${verb} a command`
    : `${verb} ${escapeHtml(tool.path || '')}${diffStat(tool.diff)}`;
  const diff = tool.diff ? `<pre class="diff-block">${escapeHtml(tool.diff)}</pre>` : '';
  const command = tool.command ? `<pre class="diff-block">${escapeHtml(tool.command)}</pre>` : '';
  const resultText = tool.result ? `<pre class="tool-result">${escapeHtml(tool.result.text || '')}</pre>` : '';
  const actions = tool.approvalId && !tool.result
    ? `<div class="tool-actions"><button data-approve="${tool.approvalId}" data-ok="1">Approve</button><button data-approve="${tool.approvalId}" data-ok="0">Deny</button></div>`
    : '';
  return `<article class="tool-card${tool.result?.ok === false ? ' failed' : ''}">
    <header><span class="tool-label">${label}</span><span class="tool-status">${status}</span></header>
    ${command}${diff}${resultText}${actions}
  </article>`;
}

function renderToolCards() {
  const container = $('#tool-cards') || (() => {
    const el = document.createElement('div');
    el.id = 'tool-cards';
    elements.messages?.appendChild(el);
    return el;
  })();
  const chat = activeChat();
  const cards = [...state.tools.values()].filter((t) => t.chatId === chat?.id);
  container.innerHTML = cards.map(toolCardHtml).join('');
  container.querySelectorAll('[data-approve]').forEach((button) => {
    button.onclick = () => {
      window.codexer.approveAgent(button.dataset.approve, button.dataset.ok === '1');
      const tool = [...state.tools.values()].find((t) => t.approvalId === button.dataset.approve);
      if (tool) tool.approvalId = '';
      renderToolCards();
    };
  });
  scrollBottom();
}

function handleAgentEvent(event) {
  if (!state.busy || event.requestId !== state.busy.requestId) return;

  if (event.type === 'workspace') {
    state.workspace = event.workspace;
    renderAgentControls();
    return;
  }

  if (event.type === 'tool') {
    state.tools.set(event.callId, {
      chatId: state.busy.chatId,
      name: event.tool.name,
      path: event.tool.path,
      command: event.tool.command,
      diff: event.tool.diff,
      approvalId: '',
      autoApproved: Boolean(event.autoApproved)
    });
    renderToolCards();
    return;
  }

  if (event.type === 'approval') {
    const entry = [...state.tools.values()].reverse().find((t) => t.chatId === state.busy.chatId && !t.approvalId && !t.result);
    if (entry) entry.approvalId = event.approvalId;
    renderToolCards();
    return;
  }

  if (event.type === 'result') {
    const tool = state.tools.get(event.callId);
    if (tool) tool.result = { ok: event.ok, text: event.text };
    renderToolCards();
  }
}

function handleChatEvent(event) {
  if (!state.busy || event.requestId !== state.busy.requestId) return;

  if (event.type === 'text') {
    state.busy.startedText = true;
    state.busy.text += event.text;

    const bubble = $('#busy-row .message-bubble');
    if (bubble) {
      bubble.innerHTML = `${markdown(state.busy.text)}<span class="caret"></span>`;
      bubble.querySelectorAll('[data-code-copy]').forEach((button) => {
        button.onclick = async () => {
          await navigator.clipboard.writeText(button.parentElement.querySelector('code').textContent);
          toast('Copied');
        };
      });
    }
    scrollBottom();
  }

  if (event.type === 'error') {
    finishBusy(event.message || 'Unknown gateway error');
  }

  if (event.type === 'aborted') {
    finishBusy(state.busy.text ? '' : 'Остановлено');
  }

  if (event.type === 'done' && state.busy) {
    finishBusy('');
  }
}

function stopChat() {
  if (!state.busy) return;
  const requestId = state.busy.requestId;
  window.codexer.stopChat(requestId);
  toast('Stopping request…');
}

function regenerate(index) {
  if (state.busy) return;
  const chat = activeChat();
  chat.messages = chat.messages.slice(0, index);
  saveConversations();
  render();
  const lastUser = [...chat.messages].reverse().find((message) => message.role === 'user');
  if (lastUser) sendPrompt(lastUser.content, { internal: true });
}

function editUserMessage(index) {
  if (state.busy) return;
  const chat = activeChat();
  const message = chat.messages[index];
  elements.prompt.value = message.content;
  autoResize();
  chat.messages = chat.messages.slice(0, index);
  saveConversations();
  render();
  elements.prompt.focus();
}

function autoResize() {
  elements.prompt.style.height = '26px';
  elements.prompt.style.height = `${Math.min(elements.prompt.scrollHeight, 180)}px`;
}

function modal(html, onOpen = () => {}) {
  elements.modalRoot.innerHTML = `<div class="modal-backdrop">${html}</div>`;
  const root = $('.modal-backdrop', elements.modalRoot);
  const close = () => { elements.modalRoot.innerHTML = ''; };

  root.addEventListener('mousedown', (event) => {
    if (event.target === root) close();
  });

  $('.close-modal', root)?.addEventListener('click', close);
  onOpen(root, close);
}

function openSystemPrompt() {
  const chat = activeChat();
  modal(`
    <div class="modal small">
      <div class="modal-head"><h2>System prompt</h2><button class="close-modal">×</button></div>
      <div class="modal-body">
        <p style="color:var(--muted);font-size:12px;margin-top:0">Applied to every request in this conversation. Skills are added separately.</p>
        <textarea id="system-prompt-input" placeholder="Optional instructions for this chat">${escapeHtml(chat.systemPrompt || '')}</textarea>
        <div class="modal-actions"><button class="btn primary" id="save-system-prompt">Save</button></div>
      </div>
    </div>
  `, (root, close) => {
    $('#save-system-prompt', root).onclick = () => {
      chat.systemPrompt = $('#system-prompt-input', root).value;
      saveConversations();
      close();
      toast('System prompt saved');
    };
  });
}

function openSkills() {
  modal(`
    <div class="modal">
      <div class="modal-head"><h2>Skills library</h2><button class="close-modal">×</button></div>
      <div class="modal-body">
        <div class="modal-actions" style="margin-top:0"><button class="btn primary" id="new-skill">Create skill</button></div>
        <div id="skills-list"></div>
      </div>
    </div>
  `, (root) => {
    const list = $('#skills-list', root);
    const draw = () => {
      list.innerHTML = state.skills.map((skill) => `
        <div class="list-card">
          <span style="font-size:22px">${escapeHtml(skill.emoji || '✦')}</span>
          <div class="grow"><strong>${escapeHtml(skill.name)}</strong><small>${escapeHtml(skill.prompt)}</small></div>
          <button class="btn" data-edit="${skill.id}">Edit</button>
          <button class="btn" data-duplicate="${skill.id}">Duplicate</button>
          <button class="btn danger" data-delete="${skill.id}">Delete</button>
        </div>
      `).join('');

      list.querySelectorAll('[data-edit]').forEach((button) => button.onclick = () => editSkill(button.dataset.edit, draw));
      list.querySelectorAll('[data-duplicate]').forEach((button) => {
        button.onclick = () => {
          const old = state.skills.find((skill) => skill.id === button.dataset.duplicate);
          state.skills.push({ ...old, id: id(), name: `${old.name} copy` });
          save('skills', state.skills);
          draw();
        };
      });
      list.querySelectorAll('[data-delete]').forEach((button) => {
        button.onclick = () => {
          state.skills = state.skills.filter((skill) => skill.id !== button.dataset.delete);
          state.conversations.forEach((chat) => {
            if (chat.skillId === button.dataset.delete) chat.skillId = '';
          });
          save('skills', state.skills); saveConversations(); draw();
        };
      });
    };
    $('#new-skill', root).onclick = () => editSkill(null, draw);
    draw();
  });
}

function editSkill(skillId, redraw) {
  const skill = state.skills.find((item) => item.id === skillId) || {
    id: id(), name: '', emoji: '✦', color: '#6d5efc', model: '', prompt: ''
  };

  modal(`
    <div class="modal small">
      <div class="modal-head"><h2>${skillId ? 'Edit skill' : 'Create skill'}</h2><button class="close-modal">×</button></div>
      <div class="modal-body">
        <div class="row-fields">
          <label class="field">Name<input id="skill-name" value="${escapeHtml(skill.name)}"></label>
          <label class="field">Emoji<input id="skill-emoji" value="${escapeHtml(skill.emoji)}"></label>
        </div>
        <label class="field">Default model (optional)
          <select id="skill-model"><option value="">Use conversation model</option>${state.models.map((model) => `<option ${skill.model === model ? 'selected' : ''}>${model}</option>`).join('')}</select>
        </label>
        <label class="field">System prompt<textarea id="skill-prompt">${escapeHtml(skill.prompt)}</textarea></label>
        <div class="modal-actions"><button class="btn primary" id="save-skill">Save skill</button></div>
      </div>
    </div>
  `, (root, close) => {
    $('#save-skill', root).onclick = () => {
      const next = {
        ...skill,
        name: $('#skill-name', root).value.trim() || 'Untitled skill',
        emoji: $('#skill-emoji', root).value.trim() || '✦',
        model: $('#skill-model', root).value,
        prompt: $('#skill-prompt', root).value.trim()
      };
      const existing = state.skills.findIndex((item) => item.id === next.id);
      if (existing >= 0) state.skills[existing] = next;
      else state.skills.push(next);
      save('skills', state.skills);
      close();
      redraw?.();
    };
  });
}

function openRoutines() {
  modal(`
    <div class="modal">
      <div class="modal-head"><h2>Routines</h2><button class="close-modal">×</button></div>
      <div class="modal-body">
        <p style="color:var(--muted);font-size:12px">Use {{input}} for user input and {{previous}} for the previous step’s answer.</p>
        <div class="modal-actions" style="margin-top:0"><button class="btn primary" id="new-routine">Create routine</button></div>
        <div id="routine-list"></div>
      </div>
    </div>
  `, (root) => {
    const list = $('#routine-list', root);
    const draw = () => {
      list.innerHTML = state.routines.map((routine) => `
        <div class="list-card">
          <span>◌</span><div class="grow"><strong>${escapeHtml(routine.name)}</strong><small>${routine.steps.length} step${routine.steps.length === 1 ? '' : 's'}</small></div>
          <button class="btn" data-run="${routine.id}">Run</button>
          <button class="btn" data-edit="${routine.id}">Edit</button>
          <button class="btn danger" data-delete="${routine.id}">Delete</button>
        </div>
      `).join('');

      list.querySelectorAll('[data-run]').forEach((button) => button.onclick = () => {
        $('.close-modal', root)?.click();
        runRoutine(button.dataset.run);
      });
      list.querySelectorAll('[data-edit]').forEach((button) => button.onclick = () => editRoutine(button.dataset.edit, draw));
      list.querySelectorAll('[data-delete]').forEach((button) => button.onclick = () => {
        state.routines = state.routines.filter((routine) => routine.id !== button.dataset.delete);
        save('routines', state.routines); draw();
      });
    };
    $('#new-routine', root).onclick = () => editRoutine(null, draw);
    draw();
  });
}

function editRoutine(routineId, redraw) {
  const routine = state.routines.find((item) => item.id === routineId) || { id: id(), name: '', steps: [''] };
  modal(`
    <div class="modal small">
      <div class="modal-head"><h2>${routineId ? 'Edit routine' : 'Create routine'}</h2><button class="close-modal">×</button></div>
      <div class="modal-body">
        <label class="field">Name<input id="routine-name" value="${escapeHtml(routine.name)}"></label>
        <label class="field">One step per blank-line-separated block<textarea id="routine-steps">${escapeHtml(routine.steps.join('\n\n---STEP---\n\n'))}</textarea></label>
        <div class="modal-actions"><button class="btn primary" id="save-routine">Save routine</button></div>
      </div>
    </div>
  `, (root, close) => {
    $('#save-routine', root).onclick = () => {
      const steps = $('#routine-steps', root).value.split(/\n\s*---STEP---\s*\n/).map((step) => step.trim()).filter(Boolean);
      const next = { ...routine, name: $('#routine-name', root).value.trim() || 'Untitled routine', steps };
      const position = state.routines.findIndex((item) => item.id === next.id);
      if (position >= 0) state.routines[position] = next;
      else state.routines.push(next);
      save('routines', state.routines);
      close();
      redraw?.();
    };
  });
}

function runRoutine(routineId) {
  const routine = state.routines.find((item) => item.id === routineId);
  if (!routine || state.busy) return;

  const needsInput = routine.steps.some((step) => step.includes('{{input}}'));
  if (needsInput) {
    modal(`
      <div class="modal small">
        <div class="modal-head"><h2>${escapeHtml(routine.name)}</h2><button class="close-modal">×</button></div>
        <div class="modal-body">
          <label class="field">Input<textarea id="routine-input" placeholder="What should this routine work on?"></textarea></label>
          <div class="modal-actions"><button class="btn primary" id="begin-routine">Run routine</button></div>
        </div>
      </div>
    `, (root, close) => {
      $('#begin-routine', root).onclick = () => {
        const input = $('#routine-input', root).value.trim();
        close();
        state.routineRun = { name: routine.name, steps: routine.steps, input, previous: '', index: 0 };
        advanceRoutine('');
      };
    });
  } else {
    state.routineRun = { name: routine.name, steps: routine.steps, input: '', previous: '', index: 0 };
    advanceRoutine('');
  }
}

function advanceRoutine(previous) {
  const run = state.routineRun;
  if (!run) return;
  if (run.index >= run.steps.length) {
    state.routineRun = null;
    renderRoutineBanner();
    toast('Routine complete');
    return;
  }

  run.previous = previous;
  const step = run.steps[run.index]
    .replaceAll('{{input}}', run.input)
    .replaceAll('{{previous}}', run.previous);

  const label = `[Routine step ${run.index + 1}/${run.steps.length}: ${run.name}]\n${step}`;
  const chat = activeChat();
  chat.messages.push({ id: id(), role: 'user', content: label, createdAt: new Date().toISOString(), routineStep: run.index + 1 });
  if (chat.title === 'New chat') chat.title = titleFrom(run.name);
  saveConversations();
  render();
  const stepIndex = run.index + 1;
  run.index += 1;
  sendPrompt(step, { internal: true, routineStep: stepIndex });
}

function palette() {
  const items = [
    { kind: 'action', icon: '＋', title: 'New chat', hint: '⌘N', action: newChat },
    { kind: 'action', icon: '⇩', title: 'Export current conversation', hint: '', action: exportCurrent },
    { kind: 'action', icon: '◐', title: 'Toggle theme', hint: '', action: toggleTheme },
    { kind: 'action', icon: '◉', title: 'Open accounts', hint: '', action: openAccounts },
    ...state.models.map((model) => ({ kind: 'model', icon: '◈', title: `Switch model: ${model}`, hint: 'Model', model })),
    ...state.skills.map((skill) => ({ kind: 'skill', icon: skill.emoji || '✦', title: skill.name, hint: 'Skill', skill })),
    ...state.routines.map((routine) => ({ kind: 'routine', icon: '◌', title: routine.name, hint: 'Routine', routine }))
  ];

  modal(`
    <div class="modal palette">
      <input class="palette-search" id="palette-search" placeholder="Search commands, skills, routines…" autofocus>
      <div class="palette-list" id="palette-list"></div>
    </div>
  `, (root, close) => {
    const input = $('#palette-search', root);
    const list = $('#palette-list', root);
    let filtered = items;
    let selected = 0;

    const draw = () => {
      filtered = items.filter((item) => item.title.toLowerCase().includes(input.value.toLowerCase()));
      selected = Math.min(selected, Math.max(0, filtered.length - 1));
      list.innerHTML = filtered.map((item, index) => `
        <div class="palette-item ${index === selected ? 'selected' : ''}" data-index="${index}">
          <span>${escapeHtml(item.icon)}</span><span>${escapeHtml(item.title)}</span><small>${escapeHtml(item.hint)}</small>
        </div>
      `).join('');
      list.querySelectorAll('.palette-item').forEach((item) => item.onclick = () => choose(Number(item.dataset.index)));
    };

    const choose = (index) => {
      const item = filtered[index];
      if (!item) return;
      close();
      if (item.kind === 'action') item.action();
      if (item.kind === 'model') {
        activeChat().model = item.model;
        saveConversations();
        renderHeader();
      }
      if (item.kind === 'skill') {
        const chat = activeChat();
        chat.skillId = item.skill.id;
        if (item.skill.model) chat.model = item.skill.model;
        saveConversations();
        render();
        toast(`Applied skill: ${item.skill.name}`);
      }
      if (item.kind === 'routine') runRoutine(item.routine.id);
    };

    input.oninput = draw;
    input.onkeydown = (event) => {
      if (event.key === 'ArrowDown') { event.preventDefault(); selected = Math.min(selected + 1, filtered.length - 1); draw(); }
      if (event.key === 'ArrowUp') { event.preventDefault(); selected = Math.max(selected - 1, 0); draw(); }
      if (event.key === 'Enter') { event.preventDefault(); choose(selected); }
      if (event.key === 'Escape') close();
    };
    draw();
    input.focus();
  });
}

async function openAccounts() {
  const info = await window.codexer.getAccounts();
  state.gateway = info.gateway;
  renderGateway();

  modal(`
    <div class="modal">
      <div class="modal-head"><h2>Accounts</h2><button class="close-modal">×</button></div>
      <div class="modal-body">
        <div id="accounts-content"></div>
      </div>
    </div>
  `, (root) => {
    const content = $('#accounts-content', root);
    const draw = (data) => {
      content.innerHTML = `
        <div class="account-status ${data.gateway.up ? 'up' : 'down'}">
          ${data.gateway.up ? '● Gateway connected' : '● Gateway unavailable'} · ${escapeHtml(data.gateway.detail || '')} · mode: ${escapeHtml(data.mode)}
        </div>
        <div class="setting-section">
          <h3>Connected accounts</h3>
          ${(data.accounts.length ? data.accounts : [{ alias: 'No accounts found in the configured group', email: '', status: 'unknown' }]).map((account) => `
            <div class="list-card">
              <span class="status-dot ${account.status === 'rate-limited' ? 'down' : 'up'}"></span>
              <div class="grow"><strong>${escapeHtml(account.alias || account.label || account.email || 'Account')}</strong><small>${escapeHtml(account.email || account.label || '')}</small></div>
              <small>${escapeHtml(account.status || 'active')}</small>
            </div>
          `).join('')}
        </div>
        <div class="setting-section">
          <h3>Add account</h3>
          <p style="color:var(--muted);font-size:12px">Starts <code>~/codexer/codexer auth</code>, opens its OAuth URL, and submits the code you paste back.</p>
          <button class="btn primary" id="start-auth">Add account</button>
          <div id="auth-area"></div>
        </div>
      `;

      $('#start-auth', content).onclick = async () => {
        try {
          await window.codexer.startAuth();
          $('#auth-area', content).innerHTML = `
            <div class="field" style="margin-top:12px">Returned OAuth code
              <input id="auth-code" placeholder="Paste returned code">
            </div>
            <button class="btn" id="submit-auth-code">Submit code</button>
            <pre class="auth-output" id="auth-output">Waiting for login URL…</pre>
          `;
          $('#submit-auth-code', content).onclick = async () => {
            await window.codexer.submitAuthCode($('#auth-code', content).value);
          };
        } catch (error) {
          toast(error.message);
        }
      };
    };
    draw(info);
  });
}

function exportMarkdown(chat) {
  const lines = [`# ${chat.title}`, '', `Model: ${chat.model}`, ''];
  if (chat.systemPrompt) lines.push('## System prompt', '', chat.systemPrompt, '');
  for (const message of chat.messages) {
    lines.push(`## ${message.role === 'user' ? 'You' : 'Codexarion'}`, '', message.content, '');
  }
  return lines.join('\n');
}

async function exportCurrent() {
  const chat = activeChat();
  if (!chat) return;
  const result = await window.codexer.exportConversation(exportMarkdown(chat), chat.title.replace(/[^\w-]+/g, '-').toLowerCase());
  if (result) toast('Conversation exported');
}

function toggleTheme() {
  state.settings.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme();
  save('settings', state.settings);
}

function openSettings(section = 'general') {
  const sections = ['general', 'appearance', 'code', 'models', 'skills', 'accounts', 'data', 'about'];

  modal(`
    <div class="modal settings">
      <nav class="settings-nav">
        <h2>Settings</h2>
        ${sections.map((item) => `<button data-section="${item}" class="${item === section ? 'active' : ''}">${({
          general: 'General', appearance: 'Appearance', code: 'Code appearance', models: 'Models',
          skills: 'Skills', accounts: 'Accounts', data: 'Data', about: 'About'
        })[item]}</button>`).join('')}
      </nav>
      <section id="settings-content" class="settings-content"></section>
    </div>
  `, (root) => {
    root.querySelectorAll('[data-section]').forEach((button) => {
      button.onclick = () => openSettings(button.dataset.section);
    });
    renderSettingsSection(section, $('#settings-content', root));
  });
}

function settingToggle(key, title, description) {
  return `<div class="setting-row"><div><strong>${title}</strong><div class="description">${description}</div></div><input class="toggle" type="checkbox" data-setting="${key}" ${state.settings[key] ? 'checked' : ''}></div>`;
}

function bindSettings(content) {
  content.querySelectorAll('[data-setting]').forEach((input) => {
    input.onchange = () => {
      state.settings[input.dataset.setting] = input.type === 'checkbox' ? input.checked : input.value;
      applyTheme();
      save('settings', state.settings);
    };
  });
}

function renderSettingsSection(section, content) {
  const header = (title, subtitle) => `<h1>${title}</h1><p>${subtitle}</p>`;

  if (section === 'general') {
    content.innerHTML = header('General', 'Core Codexarion behavior.') + `
      <div class="setting-section">
        ${settingToggle('sendOnEnter', 'Send on Enter', 'Shift+Enter always inserts a new line.')}
        ${settingToggle('streaming', 'Stream responses', 'Render output as soon as the gateway returns tokens.')}
        ${settingToggle('autoFallback', 'Automatically switch model on limits', 'Saved preference for gateway-limit workflows.')}
        <div class="setting-row"><div><strong>Default model</strong><div class="description">Used for new conversations.</div></div>
          <select class="select" data-setting="defaultModel">${state.models.map((model) => `<option ${state.settings.defaultModel === model ? 'selected' : ''}>${model}</option>`).join('')}</select>
        </div>
      </div>`;
    bindSettings(content);
  }

  if (section === 'appearance') {
    content.innerHTML = header('Appearance', 'Make Codexarion feel at home on your desktop.') + `
      <div class="setting-section">
        <h3>Theme</h3>
        <div class="segment">${['light', 'dark', 'system'].map((theme) => `<button data-theme-choice="${theme}" class="${state.settings.theme === theme ? 'active' : ''}">${theme[0].toUpperCase() + theme.slice(1)}</button>`).join('')}</div>
        ${settingToggle('highContrast', 'High-contrast dark', 'Increase contrast when dark theme is active.')}
        <div class="setting-row"><div><strong>Accent color</strong><div class="description">Used for controls and assistant identity.</div></div><input data-setting="accent" type="color" value="${escapeHtml(state.settings.accent)}" style="width:42px;padding:2px;height:28px"></div>
      </div>`;
    content.querySelectorAll('[data-theme-choice]').forEach((button) => button.onclick = () => {
      state.settings.theme = button.dataset.themeChoice; applyTheme(); save('settings', state.settings); renderSettingsSection('appearance', content);
    });
    bindSettings(content);
  }

  if (section === 'code') {
    content.innerHTML = header('Code appearance', 'Choose readable syntax surfaces for light and dark modes.') + `
      <div class="setting-section">
        <div class="setting-row"><div><strong>Light code theme</strong></div><select class="select" data-setting="codeThemeLight"><option>paper</option><option>solar</option><option>fog</option></select></div>
        <div class="setting-row"><div><strong>Dark code theme</strong></div><select class="select" data-setting="codeThemeDark"><option>midnight</option><option>obsidian</option><option>violet</option></select></div>
        <label class="field">Code font<input data-setting="codeFont" value="${escapeHtml(state.settings.codeFont)}"></label>
        <div class="code-preview">const gateway = await fetch("http://127.0.0.1:9090");\nif (!gateway.ok) throw new Error("Gateway unavailable");</div>
      </div>`;
    content.querySelector('[data-setting="codeThemeLight"]').value = state.settings.codeThemeLight;
    content.querySelector('[data-setting="codeThemeDark"]').value = state.settings.codeThemeDark;
    bindSettings(content);
  }

  if (section === 'models') {
    content.innerHTML = header('Models', 'Every conversation remembers its selected model.') + `
      <div class="setting-section">
        <h3>Available gateway models</h3>
        ${state.models.map((model) => `<div class="list-card"><span>◈</span><div class="grow"><strong>${model}</strong><small>272k context window</small></div>${model === state.settings.defaultModel ? '<small>Default</small>' : ''}</div>`).join('')}
      </div>
      <div class="setting-section"><h3>Skill model overrides</h3>${state.skills.map((skill) => `<div class="setting-row"><div><strong>${escapeHtml(skill.emoji)} ${escapeHtml(skill.name)}</strong></div><select class="select" data-skill-model="${skill.id}"><option value="">Conversation model</option>${state.models.map((model) => `<option ${skill.model === model ? 'selected' : ''}>${model}</option>`).join('')}</select></div>`).join('')}</div>`;
    content.querySelectorAll('[data-skill-model]').forEach((select) => select.onchange = () => {
      const skill = state.skills.find((item) => item.id === select.dataset.skillModel);
      skill.model = select.value; save('skills', state.skills);
    });
  }

  if (section === 'skills') {
    content.innerHTML = header('Skills', 'Reusable personas and system prompts.') + `<button class="btn primary" id="open-skills-settings">Manage skills library</button>`;
    $('#open-skills-settings', content).onclick = openSkills;
  }

  if (section === 'accounts') {
    content.innerHTML = header('Accounts', 'Connected Codexarion accounts and local gateway status.') + `<button class="btn primary" id="open-accounts-settings">Open accounts panel</button>`;
    $('#open-accounts-settings', content).onclick = openAccounts;
  }

  if (section === 'data') {
    content.innerHTML = header('Data', 'Codexarion data is stored locally.') + `
      <div class="setting-section">
        <div class="account-status">${escapeHtml(state.userData || 'Loading local data path…')}</div>
        <div class="modal-actions" style="justify-content:flex-start">
          <button class="btn" id="export-all">Export all</button>
          <button class="btn danger" id="clear-all">Clear all local data</button>
        </div>
      </div>`;
    $('#export-all', content).onclick = async () => {
      const markdown = state.conversations.map(exportMarkdown).join('\n\n---\n\n');
      if (await window.codexer.exportAll(markdown)) toast('All conversations exported');
    };
    $('#clear-all', content).onclick = async () => {
      if (!confirm('Clear conversations, custom skills, routines, and settings?')) return;
      await window.codexer.clearData();
      location.reload();
    };
  }

  if (section === 'about') {
    content.innerHTML = header('About Codexarion', 'A local desktop gateway client.') + `
      <div class="setting-section">
        <div class="list-card"><div class="grow"><strong>Codexarion ${escapeHtml(state.version || '')}</strong><small>Electron desktop application</small></div></div>
        <div class="list-card"><div class="grow"><strong>Gateway</strong><small>${state.gateway.up ? 'Connected' : 'Offline'} · ${escapeHtml(state.gateway.detail || '')}</small></div></div>
        <div class="list-card"><div class="grow"><strong>Runtime</strong><small>Electron 39 · Node 24+ runtime · OpenAI-compatible Chat Completions</small></div></div>
      </div>`;
  }
}

async function bootstrap() {
  const data = await window.codexer.bootstrap();
  Object.assign(state, data);
  state.userData = data.userData;

  if (!state.conversations.length) {
    newChat();
  } else {
    state.activeId = state.conversations[0].id;
  }

  applyTheme();
  render();
  renderAgentControls();

  window.codexer.getWorkspace().then(({ path }) => {
    state.workspace = path || '';
    renderAgentControls();
  }).catch(() => {});

  window.codexer.onChatEvent(handleChatEvent);
  window.codexer.onAgentEvent(handleAgentEvent);
  window.codexer.onGatewayStatus((gateway) => {
    state.gateway = gateway;
    renderGateway();
  });

  window.codexer.onAuthEvent(async (event) => {
    const output = $('#auth-output');
    if (output && event.output) output.textContent = event.output;
    if (event.type === 'output' && event.url) toast('Login URL opened in your browser');
    if (event.type === 'error') toast(event.message);
    if (event.type === 'done') {
      toast(event.success ? 'Account added. Gateway restarted.' : event.message || 'Authentication failed');
      state.gateway = await window.codexer.ensureGateway();
      renderGateway();
    }
  });

  window.codexer.onMenuAction((action) => {
    if (action === 'new-chat') newChat();
    if (action === 'palette') palette();
    if (action === 'settings') openSettings();
    if (action === 'export') exportCurrent();
    if (action === 'search') { elements.search.focus(); elements.search.select(); }
  });
}

elements.composer.addEventListener('submit', (event) => {
  event.preventDefault();
  if (state.busy) return stopChat();
  const value = elements.prompt.value;
  elements.prompt.value = '';
  autoResize();
  sendPrompt(value);
});

elements.prompt.addEventListener('input', () => {
  autoResize();
  if (elements.prompt.value === '/') palette();
});

elements.prompt.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.busy) { event.preventDefault(); stopChat(); }
  if (event.key === 'Enter' && !event.shiftKey && state.settings.sendOnEnter !== false) {
    event.preventDefault();
    elements.composer.requestSubmit();
  }
});

document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); palette(); }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); newChat(); }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); elements.search.focus(); }
  if ((event.metaKey || event.ctrlKey) && event.key === ',') { event.preventDefault(); openSettings(); }
});

elements.search.addEventListener('input', renderSidebar);
elements.title.addEventListener('change', () => {
  const chat = activeChat();
  if (!chat) return;
  chat.title = elements.title.value.trim() || 'New chat';
  chat.updatedAt = new Date().toISOString();
  saveConversations();
  renderSidebar();
});

elements.model.addEventListener('change', () => {
  const chat = activeChat();
  chat.model = elements.model.value;
  chat.updatedAt = new Date().toISOString();
  saveConversations();
});

$('#new-chat').onclick = newChat;
$('#palette-button').onclick = palette;
$('#skills-button').onclick = openSkills;
$('#routines-button').onclick = openRoutines;
$('#accounts-button').onclick = openAccounts;
$('#settings-button').onclick = () => openSettings();
$('#system-prompt-button').onclick = openSystemPrompt;

document.querySelectorAll('[data-prompt]').forEach((button) => {
  button.onclick = () => {
    elements.prompt.value = button.dataset.prompt;
    autoResize();
    elements.prompt.focus();
  };
});

bootstrap().catch((error) => {
  document.body.innerHTML = `<main style="padding:40px;font-family:-apple-system;color:#c9364b">Codexarion failed to initialize: ${escapeHtml(error.message)}</main>`;
});
