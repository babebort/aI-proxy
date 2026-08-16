export async function probeHttp(url: string, timeoutMs = 2_000): Promise<{ up: boolean; detail: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return { up: response.ok || response.status < 500, detail: `HTTP ${response.status}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { up: false, detail: message };
  } finally {
    clearTimeout(timer);
  }
}

export async function waitForUp(
  url: string,
  attempts = 30,
  intervalMs = 500,
): Promise<boolean> {
  for (let i = 0; i < attempts; i += 1) {
    const { up } = await probeHttp(url);
    if (up) {
      return true;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}
