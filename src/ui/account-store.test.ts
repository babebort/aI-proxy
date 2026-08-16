import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addCodexerUser,
  needsAccountReauth,
  removeAnthropicAccount,
  removeCodexerUser,
} from './account-store.js';

test('needsAccountReauth detects missing account id and auth failures', () => {
  assert.equal(needsAccountReauth('missing chatgpt account id'), true);
  assert.equal(needsAccountReauth('HTTP 401: bad'), true);
  assert.equal(needsAccountReauth(undefined), false);
  assert.equal(needsAccountReauth('HTTP 500'), false);
});

test('addCodexerUser appends to existing group', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ai-proxy-'));
  const file = path.join(dir, 'config.yml');
  await writeFile(
    file,
    `groups:
  - gname: main
    gid: g1
    api: gsg_test
    users: []
`,
    'utf8',
  );
  const saved = await addCodexerUser(file, {
    alias: 'alice',
    oauthCode: 'code1',
    tokens: { access_token: 'tok', id_token: 'id.tok.sig' },
    gid: 'g1',
  });
  assert.equal(saved.alias, 'alice');
  assert.match(await readFile(file, 'utf8'), /alias: alice/);
  await rm(dir, { recursive: true, force: true });
});

test('removeCodexerUser drops matching uuid', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ai-proxy-'));
  const file = path.join(dir, 'config.yml');
  await writeFile(
    file,
    `groups:
  - gname: main
    gid: g1
    users:
      - uuid: keep
        alias: ok
      - uuid: drop
        alias: bad
`,
    'utf8',
  );
  assert.equal(await removeCodexerUser(file, 'drop'), true);
  const text = await readFile(file, 'utf8');
  assert.match(text, /uuid: keep/);
  assert.doesNotMatch(text, /uuid: drop/);
  await rm(dir, { recursive: true, force: true });
});

test('removeAnthropicAccount drops matching name', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ai-proxy-'));
  const file = path.join(dir, 'teamclaude.json');
  await writeFile(
    file,
    JSON.stringify({
      accounts: [
        { name: 'keep', accessToken: 'a' },
        { name: 'drop', accessToken: 'b' },
      ],
    }),
    'utf8',
  );
  assert.equal(await removeAnthropicAccount(file, 'drop'), true);
  const raw = JSON.parse(await readFile(file, 'utf8')) as { accounts: Array<{ name: string }> };
  assert.deepEqual(raw.accounts.map((row) => row.name), ['keep']);
  await rm(dir, { recursive: true, force: true });
});
