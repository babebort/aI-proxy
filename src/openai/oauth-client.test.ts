import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chatGptAccountIdFromIdToken,
  createOAuthClient,
  parseCodeInput,
} from './oauth-client.js';

test('parseCodeInput accepts raw code and callback URL', () => {
  assert.deepEqual(parseCodeInput('abc123'), { code: 'abc123', state: '' });
  assert.deepEqual(parseCodeInput('http://localhost:1455/auth/callback?code=xyz&state=st'), {
    code: 'xyz',
    state: 'st',
  });
});

test('parseCodeInput rejects empty input', () => {
  assert.throws(() => parseCodeInput('   '), /oauth code is required/);
});

test('generateAuthUrl builds PKCE authorize link', () => {
  const client = createOAuthClient();
  const { session, authUrl } = client.generateAuthUrl();
  assert.ok(session.state);
  assert.ok(session.codeVerifier);
  assert.match(authUrl, /^https:\/\/auth\.openai\.com\/oauth\/authorize\?/);
  assert.match(authUrl, /code_challenge=/);
  assert.match(authUrl, /state=/);
});

test('chatGptAccountIdFromIdToken reads account id claim', () => {
  const payload = Buffer.from(
    JSON.stringify({ chatgpt_account_id: 'acct-42' }),
    'utf8',
  ).toString('base64url');
  const token = `header.${payload}.sig`;
  assert.equal(chatGptAccountIdFromIdToken(token), 'acct-42');
});
