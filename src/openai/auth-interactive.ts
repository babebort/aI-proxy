import { spawn } from 'node:child_process';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { ensureConfig } from '../config.js';
import { waitForOAuthCallback } from './oauth-callback.js';
import { createOAuthClient, parseCodeInput } from './oauth-client.js';
import {
  addCodexerUser,
  listCodexerGroups,
  type SavedCodexerUser,
} from '../ui/account-store.js';

export interface OpenAiAuthOptions {
  alias?: string;
  gid?: string;
  newGroupName?: string;
  /** Print auth URL only; do not spawn `open` / xdg-open. */
  noBrowser?: boolean;
}

function openAuthUrl(url: string): void {
  if (process.platform === 'darwin') {
    spawn('open', [url], { stdio: 'ignore' }).unref();
    return;
  }
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', shell: true }).unref();
    return;
  }
  spawn('xdg-open', [url], { stdio: 'ignore' }).unref();
}

async function promptLine(rl: readline.Interface, label: string): Promise<string> {
  for (;;) {
    const value = (await rl.question(`${label}: `)).trim();
    if (value) {
      return value;
    }
    console.log('Нужно непустое значение.');
  }
}

async function chooseGroup(
  rl: readline.Interface,
  configFile: string,
): Promise<{ gid?: string; newGroupName?: string }> {
  const groups = await listCodexerGroups(configFile);
  if (groups.length === 0) {
    const newGroupName = await promptLine(rl, 'Название новой группы');
    return { newGroupName };
  }

  console.log('\nГруппы:');
  for (const [idx, group] of groups.entries()) {
    console.log(`  ${idx + 1}. ${group.gname} (${group.gid}) · users=${group.userCount}`);
  }
  console.log('  n. Новая группа');

  for (;;) {
    const choice = (await rl.question('Группа (номер или n): ')).trim().toLowerCase();
    if (choice === 'n' || choice === 'new') {
      const newGroupName = await promptLine(rl, 'Название новой группы');
      return { newGroupName };
    }
    const number = Number.parseInt(choice, 10);
    if (Number.isFinite(number) && number >= 1 && number <= groups.length) {
      return { gid: groups[number - 1].gid };
    }
    console.log('Неверный выбор.');
  }
}

async function acquireOAuthCode(
  rl: readline.Interface,
  authUrl: string,
  state: string,
  redirectUri: string,
  noBrowser: boolean,
): Promise<string> {
  const callbackPromise = waitForOAuthCallback(redirectUri, state).catch(() => null);

  await new Promise((resolve) => setTimeout(resolve, 150));

  if (noBrowser) {
    console.log('\nОткрой ссылку в браузере:\n');
    console.log(authUrl);
  } else {
    console.log('\nОткрываю браузер для OAuth…');
    openAuthUrl(authUrl);
  }

  const callback = await Promise.race([
    callbackPromise,
    new Promise<null>((resolve) => setTimeout(resolve, 1500)),
  ]);

  if (callback?.code) {
    console.log('Callback получен.');
    return callback.code;
  }

  console.log('\nАвто-callback не пришёл — вставь callback URL или code:');
  const pasted = await promptLine(rl, 'code/url');
  const { code, state: pastedState } = parseCodeInput(pasted);
  if (pastedState && pastedState !== state) {
    throw new Error('oauth state mismatch');
  }
  return code;
}

/** Terminal / headless OpenAI OAuth — same result as the UI modal. */
export async function runOpenAiAuthInteractive(
  options: OpenAiAuthOptions = {},
): Promise<SavedCodexerUser> {
  const config = await ensureConfig();
  const rl = readline.createInterface({ input, output });

  try {
    const alias = options.alias?.trim() || (await promptLine(rl, 'Alias аккаунта'));
    let gid = options.gid?.trim();
    let newGroupName = options.newGroupName?.trim();

    if (!gid && !newGroupName) {
      const picked = await chooseGroup(rl, config.openai.configFile);
      gid = picked.gid;
      newGroupName = picked.newGroupName;
    }

    const client = createOAuthClient();
    const { session, authUrl } = client.generateAuthUrl();
    const code = await acquireOAuthCode(
      rl,
      authUrl,
      session.state,
      session.redirectUri,
      Boolean(options.noBrowser),
    );

    console.log('Обмен code на token…');
    const tokens = await client.exchangeCode(session, code);
    const account = await addCodexerUser(config.openai.configFile, {
      alias,
      oauthCode: code,
      tokens,
      gid,
      newGroupName,
    });

    console.log('\n✓ ChatGPT аккаунт сохранён');
    console.log(`  alias: ${account.alias}`);
    console.log(`  uuid:  ${account.uuid}`);
    console.log(`  group: ${account.gname} (${account.gid})`);
    console.log(`  api:   ${account.api}`);
    return account;
  } finally {
    rl.close();
  }
}
