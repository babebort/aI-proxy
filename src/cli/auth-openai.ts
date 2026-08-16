#!/usr/bin/env node
/** Add ChatGPT account from terminal — no web UI required. */
import { runOpenAiAuthInteractive } from '../openai/auth-interactive.js';

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length).trim() || undefined;
    }
  }
  return undefined;
}

const noBrowser = process.argv.includes('--no-browser');

await runOpenAiAuthInteractive({
  alias: readArg('alias'),
  gid: readArg('gid'),
  newGroupName: readArg('new-group'),
  noBrowser,
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
