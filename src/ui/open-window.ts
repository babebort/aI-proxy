import { spawn } from 'node:child_process';

/** Open the control panel in a browser or a chromeless app window (macOS). */
export function openUiWindow(url: string, appMode: boolean): void {
  if (appMode && process.platform === 'darwin') {
    spawn('open', ['-na', 'Google Chrome', '--args', `--app=${url}`], {
      stdio: 'ignore',
    }).unref();
    return;
  }

  const opener = process.platform === 'win32' ? 'start' : 'open';
  const args = process.platform === 'win32' ? ['', url] : [url];
  spawn(opener, args, { stdio: 'ignore', shell: process.platform === 'win32' }).unref();
}

/** macOS only: open Terminal with a login command. */
export function openTerminalCommand(command: string): boolean {
  if (process.platform !== 'darwin') {
    return false;
  }
  const escaped = command.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  spawn(
    'osascript',
    ['-e', `tell application "Terminal" to do script "${escaped}"`],
    { stdio: 'ignore' },
  ).unref();
  return true;
}
