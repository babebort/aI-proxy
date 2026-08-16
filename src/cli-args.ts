export interface CliArgs {
  detach: boolean;
  openOnly: boolean;
  port?: number;
  noOpen: boolean;
}

export function parseCliArgs(argv: string[] = process.argv.slice(2)): CliArgs {
  let port: number | undefined;
  for (const arg of argv) {
    if (arg.startsWith('--port=')) {
      const n = Number(arg.slice('--port='.length));
      if (Number.isFinite(n) && n > 0) port = n;
    }
  }
  return {
    detach: argv.includes('--detach'),
    openOnly: argv.includes('--open-only'),
    port,
    noOpen: argv.includes('--no-open'),
  };
}
