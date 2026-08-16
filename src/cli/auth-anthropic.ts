#!/usr/bin/env node
/** Add Claude account via tcr login — no web UI required. */
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveTeamclaude } from '../binaries.js';
import { ensureConfig } from '../config.js';

await ensureConfig();
const binary = await resolveTeamclaude();

console.log('Запуск tcr login — заверши OAuth в браузере.\n');

const result = spawnSync(binary, ['login'], {
  stdio: 'inherit',
  cwd: path.dirname(binary),
});

process.exit(result.status ?? 1);
