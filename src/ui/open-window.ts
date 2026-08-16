import { spawn } from 'node:child_process';

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** macOS Terminal.app name override: Terminal (default) or iTerm / iTerm2. */
export function terminalAppName(): string {
  const raw = process.env.AI_PROXY_TERMINAL_APP?.trim();
  return raw && raw.length > 0 ? raw : 'Terminal';
}

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

/** macOS only: open Terminal (or iTerm) in front and run a shell command. */
export function openTerminalCommand(command: string): boolean {
  if (process.platform !== 'darwin') {
    return false;
  }
  const escaped = escapeAppleScriptString(command);
  const app = terminalAppName();
  const script =
    app === 'iTerm' || app === 'iTerm2'
      ? `tell application "iTerm"
  activate
  if (count of windows) = 0 then
    create window with default profile
  end if
  tell current session of current window to write text "${escaped}"
end tell`
      : `tell application "Terminal"
  activate
  if (count of windows) = 0 then
    do script "${escaped}"
  else
    do script "${escaped}" in front window
  end if
end tell`;
  spawn('osascript', ['-e', script], { stdio: 'ignore' }).unref();
  return true;
}

/** Default `npm start` UX: Terminal tab with URL + live ui.log (UI keeps running if you Ctrl+C tail). */
export function openControlPanelTerminal(url: string, logFile: string): boolean {
  const cmd = [
    `printf '\\nAI-proxy  ${url}\\nlogs: ${logFile}\\nCtrl+C — только tail; UI: npm run stop\\n\\n'`,
    `tail -f ${shellQuote(logFile)}`,
  ].join(' && ');
  return openTerminalCommand(cmd);
}
