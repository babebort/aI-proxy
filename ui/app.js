const $ = (sel) => document.querySelector(sel);

const panels = {
  overview: { el: '#panel-overview', title: 'Обзор' },
  accounts: { el: '#panel-accounts', title: 'Аккаунты' },
  env: { el: '#panel-env', title: 'Клиенты' },
};

let pollTimer = null;
let lastStatus = null;
let lastProbe = null;
let probing = false;
const probingAccounts = new Set();
const pendingProbeKeys = new Set();
let installPrompt = null;
let oauthSessionId = null;
let oauthPollTimer = null;

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), 2600);
}

function setTheme(next) {
  document.documentElement.dataset.theme = next;
  localStorage.setItem('ai-proxy-theme', next);
}

function initTheme() {
  const saved = localStorage.getItem('ai-proxy-theme');
  if (saved === 'dark' || saved === 'light') {
    setTheme(saved);
    return;
  }
  setTheme(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

function showPanel(name) {
  for (const [key, cfg] of Object.entries(panels)) {
    $(cfg.el).classList.toggle('hidden', key !== name);
  }
  for (const btn of document.querySelectorAll('.nav-item')) {
    btn.classList.toggle('active', btn.dataset.panel === name);
  }
  $('#panel-title').textContent = panels[name].title;
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatReset(resetAt, resetAfterSeconds) {
  if (resetAt) {
    const d = new Date(resetAt * 1000);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  if (typeof resetAfterSeconds === 'number') {
    const h = Math.floor(resetAfterSeconds / 3600);
    const m = Math.floor((resetAfterSeconds % 3600) / 60);
    return `через ${h}ч ${m}м`;
  }
  return '';
}

function windowLabel(seconds) {
  if (!seconds) return 'лимит';
  if (seconds >= 86400 * 6) return 'неделя';
  if (seconds >= 86400) return `${Math.round(seconds / 86400)}d`;
  if (seconds >= 3600 * 4) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 60)}m`;
}

function quotaBar(usedPercent, label, resetHint) {
  const used = Math.max(0, Math.min(100, usedPercent ?? 0));
  const left = Math.max(0, 100 - used);
  const tone = used >= 95 ? 'danger' : used >= 80 ? 'warn' : 'ok';
  return `<div class="quota-row">
    <div class="quota-head"><span>${esc(label)}</span><span>${left.toFixed(0)}% left · ${esc(resetHint || '—')}</span></div>
    <div class="quota-track"><div class="quota-fill ${tone}" style="width:${used}%"></div></div>
  </div>`;
}

function accountRefreshBtn(provider, id, spinning = false) {
  return `<button type="button" class="icon-btn account-refresh${spinning ? ' spinning' : ''}" title="Обновить лимиты" data-probe-provider="${esc(provider)}" data-probe-id="${esc(id)}" aria-label="Обновить">↻</button>`;
}

function accountReauthBtn(provider, id, alias) {
  return `<button type="button" class="icon-btn reauth-btn" title="Переавторизовать (OAuth)" data-reauth-provider="${esc(provider)}" data-reauth-id="${esc(id)}" data-reauth-alias="${esc(alias)}" aria-label="Reauth">↺</button>`;
}

function needsReauth(probe, account) {
  if (probe?.error && /missing chatgpt account id|no token|401|403|expired|unauthorized/i.test(probe.error)) {
    return true;
  }
  if (account && account.hasToken === false) {
    return true;
  }
  return false;
}

function mergeProbeResult(payload) {
  if (!lastProbe || !payload.single) {
    lastProbe = payload;
    return;
  }
  const { provider, id } = payload.single;
  const incoming = provider === 'openai' ? payload.openai[0] : payload.anthropic[0];
  if (!incoming) return;

  const listKey = provider === 'openai' ? 'openai' : 'anthropic';
  const matchKey = provider === 'openai' ? (row) => row.uuid === id || row.alias === id : (row) => row.name === id;
  const list = lastProbe[listKey] ?? [];
  const idx = list.findIndex(matchKey);
  if (idx >= 0) {
    list[idx] = incoming;
  } else {
    list.push(incoming);
  }
  lastProbe[listKey] = list;
  lastProbe.probedAt = payload.probedAt;
}

function renderOpenAiAccounts(statusAccounts, probeAccounts) {
  const wrap = $('#openai-accounts');
  const probeMap = new Map((probeAccounts ?? []).map((a) => [a.uuid || a.alias, a]));
  const rows = statusAccounts?.length ? statusAccounts : [];

  if (!rows.length) {
    wrap.innerHTML = `<article class="account-card add-card">
      <p>Нет ChatGPT аккаунтов</p>
      <button type="button" class="primary" data-login="openai">Добавить первый</button>
    </article>`;
    wrap.querySelector('[data-login="openai"]').onclick = () => void login('openai');
    return;
  }

  wrap.innerHTML = rows
    .map((account) => {
      const id = account.uuid || account.alias;
      const probe = probeMap.get(account.uuid) ?? probeMap.get(account.alias);
      const email = probe?.email ?? account.email ?? '';
      const plan = probe?.planType ?? account.planType ?? '—';
      const spinning = probingAccounts.has(`openai:${id}`);
      const pending = pendingProbeKeys.has(`openai:${id}`);
      const limitBadge = probe?.limitReached
        ? '<span class="badge no">limit</span>'
        : probe?.ok
          ? '<span class="badge ok">live</span>'
          : probe?.error
            ? `<span class="badge no" title="${esc(probe.error)}">err</span>`
            : spinning || pending
              ? '<span class="badge pending">…</span>'
              : account.hasToken
                ? '<span class="badge pending">new</span>'
                : '<span class="badge no">no token</span>';

      let quotaHtml = '';
      if (probe?.ok) {
        const primaryLabel = windowLabel(probe.primary?.windowSeconds) || 'primary';
        const secondaryLabel = windowLabel(probe.secondary?.windowSeconds) || 'secondary';
        if (probe.primary) {
          quotaHtml += quotaBar(
            probe.primary.usedPercent,
            primaryLabel,
            formatReset(probe.primary.resetAt, probe.primary.resetAfterSeconds),
          );
        }
        if (probe.secondary) {
          quotaHtml += quotaBar(
            probe.secondary.usedPercent,
            secondaryLabel,
            formatReset(probe.secondary.resetAt, probe.secondary.resetAfterSeconds),
          );
        }
        if (!probe.primary && !probe.secondary) {
          quotaHtml = '<p class="muted small">Quota API ответил без окон</p>';
        }
      } else if (probe?.error) {
        quotaHtml = `<p class="muted small err">${esc(probe.error)}</p>`;
      } else {
        quotaHtml = '<p class="muted small">↻ — обновить лимиты</p>';
      }

      return `<article class="account-card">
        <div class="account-top">
          <div>
            <strong>${esc(account.alias)}</strong>
            <div class="muted small">${esc(email)}</div>
          </div>
          <div class="account-actions">
            ${accountRefreshBtn('openai', id, spinning)}
            ${needsReauth(probe, account) ? accountReauthBtn('openai', account.uuid || id, account.alias) : ''}
            <div class="account-badges">${limitBadge}<span class="badge plan">${esc(plan)}</span></div>
          </div>
        </div>
        ${quotaHtml}
      </article>`;
    })
    .join('');
}

function renderAnthropicAccounts(statusAccounts, probeAccounts) {
  const wrap = $('#anthropic-accounts');
  const probeMap = new Map((probeAccounts ?? []).map((a) => [a.name, a]));
  const rows = statusAccounts?.length ? statusAccounts : [];

  if (!rows.length) {
    wrap.innerHTML = `<article class="account-card add-card">
      <p>Нет Claude аккаунтов</p>
      <button type="button" class="primary" data-login="anthropic">Добавить первый</button>
    </article>`;
    wrap.querySelector('[data-login="anthropic"]').onclick = () => void login('anthropic');
    return;
  }

  wrap.innerHTML = rows
    .map((account) => {
      const probe = probeMap.get(account.name);
      const disabled = account.disabled;
      const spinning = probingAccounts.has(`anthropic:${account.name}`);
      const pending = pendingProbeKeys.has(`anthropic:${account.name}`);
      const hasUnifiedQuota = Boolean(probe?.quota?.fiveHour || probe?.quota?.sevenDay);
      const badge = disabled
        ? '<span class="badge no">disabled</span>'
        : probe?.ok || hasUnifiedQuota
          ? '<span class="badge ok">live</span>'
          : probe?.error
            ? `<span class="badge no" title="${esc(probe.error)}">err</span>`
            : spinning || pending
              ? '<span class="badge pending">…</span>'
              : '<span class="badge pending">new</span>';

      let quotaHtml = '';
      const quota = probe?.quota;
      const hasQuota =
        quota &&
        (quota.fiveHour ||
          quota.sevenDay ||
          quota.tokensLimit !== undefined ||
          quota.requestsLimit !== undefined);
      if (hasQuota) {
        if (quota.fiveHour) {
          quotaHtml += quotaBar(
            (quota.fiveHour.utilization ?? 0) * 100,
            '5 часов',
            formatReset(quota.fiveHour.resetMs ? Math.floor(quota.fiveHour.resetMs / 1000) : undefined),
          );
        }
        if (quota.sevenDay) {
          quotaHtml += quotaBar(
            (quota.sevenDay.utilization ?? 0) * 100,
            '7 дней',
            formatReset(quota.sevenDay.resetMs ? Math.floor(quota.sevenDay.resetMs / 1000) : undefined),
          );
        }
        if (!quota.fiveHour && !quota.sevenDay) {
          quotaHtml = '<p class="muted small">Probe OK, но unified headers пустые</p>';
        }
      } else if (probe?.error) {
        quotaHtml = `<p class="muted small err">${esc(probe.error)}</p>`;
      } else {
        quotaHtml = '<p class="muted small">↻ — обновить лимиты</p>';
      }

      return `<article class="account-card">
        <div class="account-top">
          <div><strong>${esc(account.name)}</strong></div>
          <div class="account-actions">
            ${accountRefreshBtn('anthropic', account.name, spinning)}
            ${needsReauth(probe, { hasToken: !disabled }) ? accountReauthBtn('anthropic', account.name, account.name) : ''}
            <div class="account-badges">${badge}</div>
          </div>
        </div>
        ${quotaHtml}
      </article>`;
    })
    .join('');
}

function bindAccountRefresh() {
  for (const wrap of [$('#openai-accounts'), $('#anthropic-accounts')]) {
    wrap.onclick = (event) => {
      const refreshBtn = event.target.closest('[data-probe-provider]');
      if (refreshBtn) {
        void probeAccount(refreshBtn.dataset.probeProvider, refreshBtn.dataset.probeId);
        return;
      }
      const reauthBtn = event.target.closest('[data-reauth-provider]');
      if (reauthBtn) {
        void reauthAccount(
          reauthBtn.dataset.reauthProvider,
          reauthBtn.dataset.reauthId,
          reauthBtn.dataset.reauthAlias,
        );
      }
    };
  }
}

function renderEnv(env) {
  const block = $('#env-block');
  block.innerHTML = Object.entries(env)
    .map(
      ([key, val]) => `<div class="env-row">
        <code>${esc(`${key}=${val}`)}</code>
        <button type="button" data-copy="${esc(`${key}=${val}`.replace(/"/g, '&quot;'))}">Copy</button>
      </div>`,
    )
    .join('');
  for (const btn of block.querySelectorAll('[data-copy]')) {
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(btn.getAttribute('data-copy')).then(() => toast('Скопировано'));
    });
  }
}

function renderAccountsView() {
  renderOpenAiAccounts(lastStatus?.openaiAccounts, lastProbe?.openai);
  renderAnthropicAccounts(lastStatus?.anthropicAccounts, lastProbe?.anthropic);
  bindAccountRefresh();
  if (lastProbe?.probedAt) {
    $('#probe-meta').textContent = `Лимиты обновлены: ${new Date(lastProbe.probedAt).toLocaleString()}`;
  }
}

function statusLabel(running, up) {
  if (up) return 'UP';
  if (running) return 'Starting…';
  return 'DOWN';
}

async function api(path, opts) {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...opts,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body;
}

function probeMapFor(provider) {
  const list = provider === 'openai' ? lastProbe?.openai : lastProbe?.anthropic;
  const map = new Map();
  for (const row of list ?? []) {
    if (provider === 'openai') {
      map.set(row.uuid || row.alias, row);
      if (row.uuid) map.set(row.alias, row);
    } else {
      map.set(row.name, row);
    }
  }
  return map;
}

function accountsMissingProbe() {
  const missing = [];
  for (const account of lastStatus?.openaiAccounts ?? []) {
    const id = account.uuid || account.alias;
    const key = `openai:${id}`;
    if (!account.hasToken || probingAccounts.has(key) || pendingProbeKeys.has(key)) continue;
    const probe = probeMapFor('openai').get(account.uuid) ?? probeMapFor('openai').get(account.alias);
    if (!probe) missing.push(['openai', id]);
  }
  for (const account of lastStatus?.anthropicAccounts ?? []) {
    if (account.disabled) continue;
    const key = `anthropic:${account.name}`;
    if (probingAccounts.has(key) || pendingProbeKeys.has(key)) continue;
    if (!probeMapFor('anthropic').has(account.name)) {
      missing.push(['anthropic', account.name]);
    }
  }
  return missing;
}

async function autoProbeMissing() {
  const missing = accountsMissingProbe();
  for (const [provider, id] of missing) {
    pendingProbeKeys.add(`${provider}:${id}`);
  }
  if (missing.length) {
    renderAccountsView();
  }
  for (const [provider, id] of missing) {
    await probeAccount(provider, id, { quiet: true });
  }
}

async function refresh() {
  try {
    lastStatus = await api('/api/status');
    const dot = $('#refresh-dot');
    dot.className = `status-dot ${lastStatus.unified.up ? 'up' : 'down'}`;

    $('#unified-status').textContent = `${statusLabel(lastStatus.unified.running, lastStatus.unified.up)}${lastStatus.unified.pid ? ` · pid ${lastStatus.unified.pid}` : ''}`;
    $('#unified-url').textContent = lastStatus.unified.url;
    $('#codexer-status').textContent = `${statusLabel(lastStatus.codexer.running, lastStatus.codexer.up)}${lastStatus.codexer.pid ? ` · pid ${lastStatus.codexer.pid}` : ''} · :${lastStatus.codexer.port}`;
    $('#codexer-url').textContent = lastStatus.codexer.url;
    $('#anthropic-status').textContent = `${lastStatus.anthropic.accountCount} account(s)`;
    $('#config-path').textContent = `Config: ${lastStatus.configPath}`;

    renderEnv(lastStatus.env);
    renderAccountsView();
    void autoProbeMissing();

    $('#btn-start').disabled = lastStatus.unified.up;
    $('#btn-stop').disabled = !lastStatus.unified.running && !lastStatus.codexer.running;
  } catch (err) {
    toast(err.message ?? 'Ошибка загрузки');
  }
}

async function probeLimits() {
  if (probing) return;
  probing = true;
  $('#btn-probe').disabled = true;
  $('#btn-probe').textContent = 'Проверяю…';
  try {
    lastProbe = await api('/api/accounts/probe', { method: 'POST', body: '{}' });
    renderAccountsView();
    toast('Лимиты обновлены');
  } catch (err) {
    toast(err.message ?? 'Probe failed');
  } finally {
    probing = false;
    $('#btn-probe').disabled = false;
    $('#btn-probe').textContent = 'Обновить лимиты';
  }
}

async function reauthAccount(provider, id, alias) {
  if (provider === 'openai') {
    const account = lastStatus?.openaiAccounts?.find((row) => row.uuid === id || row.alias === id);
    openOAuthModal({
      title: `Reauth ${alias || id}`,
      alias: alias || account?.alias || id,
      reauth: { uuid: account?.uuid || id, gid: account?.gid },
    });
    return;
  }
  try {
    const data = await api('/api/accounts/reauth', {
      method: 'POST',
      body: JSON.stringify({ provider, id, alias }),
    });
    if (data.terminal) {
      toast(`Terminal: reauth ${alias || id} — заверши OAuth, потом ↻`);
    } else {
      toast('Reauth только через Terminal (macOS)');
    }
    await refresh();
  } catch (err) {
    toast(err.message ?? 'Reauth failed');
  }
}

async function probeAccount(provider, id, opts = {}) {
  const key = `${provider}:${id}`;
  if (probingAccounts.has(key)) return;
  probingAccounts.add(key);
  pendingProbeKeys.delete(key);
  renderAccountsView();
  try {
    const payload = await api('/api/accounts/probe', {
      method: 'POST',
      body: JSON.stringify({ provider, id }),
    });
    mergeProbeResult(payload);
    renderAccountsView();
    if (!opts.quiet) toast(`${id}: обновлено`);
  } catch (err) {
    if (!opts.quiet) toast(err.message ?? 'Probe failed');
  } finally {
    probingAccounts.delete(key);
    pendingProbeKeys.delete(key);
    renderAccountsView();
  }
}

async function startProxy() {
  $('#btn-start').disabled = true;
  try {
    await api('/api/proxy/start', { method: 'POST', body: '{}' });
    toast('Запуск…');
    await refresh();
  } catch (err) {
    toast(err.message ?? 'Не удалось запустить');
  } finally {
    $('#btn-start').disabled = false;
  }
}

async function stopProxy() {
  try {
    await api('/api/proxy/stop', { method: 'POST', body: '{}' });
    toast('Остановлено');
    await refresh();
  } catch (err) {
    toast(err.message ?? 'Не удалось остановить');
  }
}

async function login(kind) {
  if (kind === 'openai') {
    if (!document.getElementById('oauth-modal')) {
      toast('Старый UI в кеше — Cmd+Shift+R');
      return;
    }
    openOAuthModal();
    return;
  }
  try {
    const data = await api(`/api/login/${kind}`, { method: 'POST', body: '{}' });
    if (data.terminal) {
      toast('Terminal открыт — заверши OAuth там, потом ↻ на аккаунте');
    } else {
      toast('Claude OAuth пока через Terminal (macOS)');
    }
  } catch (err) {
    toast(err.message ?? 'Login');
  }
}

function oauthEl(id) {
  return document.getElementById(id);
}

function setOAuthStep(step) {
  for (const name of ['setup', 'wait', 'done']) {
    oauthEl(`oauth-step-${name}`).classList.toggle('hidden', name !== step);
  }
  oauthEl('oauth-error').classList.add('hidden');
}

function setOAuthError(message) {
  const el = oauthEl('oauth-error');
  if (!message) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  el.textContent = message;
  el.classList.remove('hidden');
}

async function loadOAuthGroups(selectedGid) {
  const select = oauthEl('oauth-group');
  const { groups } = await api('/api/login/openai/groups');
  select.innerHTML = '';
  for (const group of groups) {
    const opt = document.createElement('option');
    opt.value = group.gid;
    opt.textContent = `${group.gname} (${group.userCount})`;
    select.appendChild(opt);
  }
  const createOpt = document.createElement('option');
  createOpt.value = '__new__';
  createOpt.textContent = '+ Новая группа';
  select.appendChild(createOpt);
  if (selectedGid && groups.some((group) => group.gid === selectedGid)) {
    select.value = selectedGid;
  } else if (!groups.length) {
    select.value = '__new__';
  }
  oauthEl('oauth-new-group-wrap').classList.toggle('hidden', select.value !== '__new__');
}

function stopOAuthPoll() {
  if (oauthPollTimer) {
    clearInterval(oauthPollTimer);
    oauthPollTimer = null;
  }
}

async function pollOAuthSession() {
  if (!oauthSessionId) return;
  try {
    const data = await api(`/api/login/openai/status/${oauthSessionId}`);
    if (data.status === 'done' && data.account) {
      stopOAuthPoll();
      setOAuthStep('done');
      oauthEl('oauth-done-text').textContent = `Аккаунт ${data.account.alias} добавлен.`;
      await refresh();
      const probeId = data.account.uuid || data.account.alias;
      pendingProbeKeys.add(`openai:${probeId}`);
      renderAccountsView();
      await probeAccount('openai', probeId, { quiet: true });
      toast(`${data.account.alias}: лимиты подтянуты`);
      return;
    }
    if (data.status === 'error') {
      stopOAuthPoll();
      setOAuthError(data.error ?? 'OAuth failed');
      setOAuthStep('wait');
    }
  } catch (err) {
    setOAuthError(err.message ?? 'Poll failed');
  }
}

function openOAuthModal(opts = {}) {
  const modal = oauthEl('oauth-modal');
  oauthSessionId = null;
  stopOAuthPoll();
  setOAuthStep('setup');
  setOAuthError('');
  oauthEl('oauth-title').textContent = opts.title ?? 'Добавить ChatGPT аккаунт';
  oauthEl('oauth-alias').value = opts.alias ?? '';
  oauthEl('oauth-paste').value = '';
  oauthEl('oauth-form').dataset.reauthUuid = opts.reauth?.uuid ?? '';
  oauthEl('oauth-form').dataset.reauthGid = opts.reauth?.gid ?? '';
  void loadOAuthGroups(opts.reauth?.gid);
  if (typeof modal.showModal === 'function') {
    modal.showModal();
  } else {
    modal.setAttribute('open', 'open');
  }
}

function closeOAuthModal() {
  stopOAuthPoll();
  oauthSessionId = null;
  const modal = oauthEl('oauth-modal');
  if (typeof modal.close === 'function') {
    modal.close();
  } else {
    modal.removeAttribute('open');
  }
}

async function beginOAuthLogin() {
  setOAuthError('');
  const alias = oauthEl('oauth-alias').value.trim();
  if (!alias) {
    setOAuthError('Укажи alias');
    return;
  }
  const groupValue = oauthEl('oauth-group').value;
  const body = { alias };
  if (groupValue === '__new__') {
    const newGroupName = oauthEl('oauth-new-group').value.trim() || 'default';
    body.newGroupName = newGroupName;
  } else {
    body.gid = groupValue;
  }

  const reauthUuid = oauthEl('oauth-form').dataset.reauthUuid;
  const reauthGid = oauthEl('oauth-form').dataset.reauthGid;
  let data;
  if (reauthUuid) {
    data = await api('/api/accounts/reauth', {
      method: 'POST',
      body: JSON.stringify({
        provider: 'openai',
        id: reauthUuid,
        alias,
      }),
    });
    oauthSessionId = data.sessionId;
    oauthEl('oauth-link').href = data.authUrl;
    window.open(data.authUrl, '_blank', 'noopener,noreferrer');
  } else {
    data = await api('/api/login/openai/begin', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    oauthSessionId = data.sessionId;
    oauthEl('oauth-link').href = data.authUrl;
    window.open(data.authUrl, '_blank', 'noopener,noreferrer');
  }

  setOAuthStep('wait');
  stopOAuthPoll();
  oauthPollTimer = setInterval(() => void pollOAuthSession(), 1200);
  void pollOAuthSession();
}

async function submitOAuthPaste() {
  if (!oauthSessionId) {
    setOAuthError('Сначала нажми «Войти через ChatGPT»');
    return;
  }
  const code = oauthEl('oauth-paste').value.trim();
  if (!code) {
    setOAuthError('Вставь callback URL или code');
    return;
  }
  setOAuthError('');
  await api('/api/login/openai/submit', {
    method: 'POST',
    body: JSON.stringify({ sessionId: oauthSessionId, code }),
  });
  await pollOAuthSession();
}

function initOAuthModal() {
  oauthEl('oauth-group').addEventListener('change', () => {
    oauthEl('oauth-new-group-wrap').classList.toggle(
      'hidden',
      oauthEl('oauth-group').value !== '__new__',
    );
  });
  oauthEl('oauth-begin').addEventListener('click', () => {
    void beginOAuthLogin().catch((err) => setOAuthError(err.message ?? 'OAuth begin failed'));
  });
  oauthEl('oauth-submit-paste').addEventListener('click', () => {
    void submitOAuthPaste().catch((err) => setOAuthError(err.message ?? 'Submit failed'));
  });
  oauthEl('oauth-close').addEventListener('click', closeOAuthModal);
  oauthEl('oauth-done-close').addEventListener('click', closeOAuthModal);
  oauthEl('oauth-modal').addEventListener('close', stopOAuthPoll);
}

function initPwa() {
  if ('serviceWorker' in navigator) {
    void navigator.serviceWorker.getRegistrations().then((regs) => {
      for (const reg of regs) {
        void reg.unregister();
      }
    });
  }
  if ('caches' in window) {
    void caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key))));
  }

  if (!document.getElementById('oauth-modal')) {
    toast('Старый UI в кеше — Cmd+Shift+R');
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    $('#install-banner').classList.remove('hidden');
  });

  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
  if (standalone) {
    $('#install-banner').classList.add('hidden');
  }
}

async function installPwa() {
  if (!installPrompt) {
    toast('Chrome: меню ⋮ → «Установить AI Proxy» · Safari: Поделиться → «На Dock»');
    return;
  }
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $('#install-banner').classList.add('hidden');
}

function bind() {
  for (const btn of document.querySelectorAll('.nav-item')) {
    btn.addEventListener('click', () => showPanel(btn.dataset.panel));
  }
  $('#theme-toggle').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    setTheme(dark ? 'light' : 'dark');
  });
  $('#btn-start').addEventListener('click', () => void startProxy());
  $('#btn-stop').addEventListener('click', () => void stopProxy());
  $('#btn-refresh').addEventListener('click', () => void refresh());
  $('#btn-probe').addEventListener('click', () => void probeLimits());
  $('#btn-openai-login').addEventListener('click', () => void login('openai'));
  $('#btn-anthropic-login').addEventListener('click', () => void login('anthropic'));
  $('#btn-install').addEventListener('click', () => void installPwa());
  $('#install-dismiss').addEventListener('click', () => {
    $('#install-banner').classList.add('hidden');
  });
}

initTheme();
initPwa();
initOAuthModal();
bind();
showPanel('accounts');
void refresh().then(() => void probeLimits());
pollTimer = setInterval(() => void refresh(), 8000);
