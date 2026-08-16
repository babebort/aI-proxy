#!/usr/bin/env node
/** AI-proxy entry — launches the control panel (no CLI subcommands). */
import { parseCliArgs } from './cli-args.js';
import { launchUi } from './ui/launcher.js';

const args = parseCliArgs();

await launchUi({
  port: args.port,
  open: !args.noOpen,
  detach: args.detach,
  openOnly: args.openOnly,
  backgroundChild: args.backgroundChild,
  foreground: args.foreground,
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
