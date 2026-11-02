// Boot-gate helpers (audit E3) — app-agnostic, no Vue/WWT imports, so this
// file can be copied verbatim into a sibling data-story repo.
//
// The pattern: every startup stage is a promise wrapped in withTimeout(), each
// fetch goes through fetchText()/fetchOk() so an HTTP error page can't parse
// silently as data, and any rejection lands in one catch that shows an error
// card with a Retry button instead of an endless spinner. In kiosk mode the
// app calls scheduleKioskRetry() so an unattended exhibit recovers on its own.

/** Thrown for a stage that didn't settle in time. */
export class BootTimeoutError extends Error {
  constructor(public stage: string, public ms: number) {
    super(`${stage} timed out after ${Math.round(ms / 1000)} s`);
    this.name = "BootTimeoutError";
  }
}

/** Default per-stage budget. Generous: a slow classroom network is not an error. */
export const BOOT_STAGE_TIMEOUT_MS = 20_000;

/** Reject with BootTimeoutError if `p` hasn't settled within `ms`. */
export function withTimeout<T>(p: Promise<T>, stage: string, ms = BOOT_STAGE_TIMEOUT_MS): Promise<T> {
  let timer = 0;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new BootTimeoutError(stage, ms)), ms);
  });
  return Promise.race([p, timeout]).finally(() => window.clearTimeout(timer));
}

/** fetch() that rejects on a non-2xx status rather than returning an error page. */
export async function fetchOk(url: string, init?: RequestInit): Promise<Response> {
  const r = await fetch(url, init);
  if (!r.ok) {
    throw new Error(`${url} returned HTTP ${r.status}`);
  }
  return r;
}

export async function fetchText(url: string, init?: RequestInit): Promise<string> {
  return (await fetchOk(url, init)).text();
}

/** True if the browser can create a WebGL context (WWT needs one). */
export function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

/** Short, visitor-safe description of a boot failure. */
export function describeBootError(err: unknown): string {
  if (err instanceof BootTimeoutError) {
    return `${err.stage} is taking too long. The image server may be slow or unreachable.`;
  }
  if (err instanceof TypeError) {
    // fetch() network failures surface as TypeError ("Failed to fetch").
    return "The image server couldn't be reached. Check the network connection.";
  }
  return "Something went wrong while loading the imagery.";
}

const KIOSK_RETRY_KEY = "bootRetryCount";

/**
 * Kiosk recovery: reload after an exponential backoff (15 s, 30 s, 60 s, …,
 * capped at 5 min). The attempt count survives the reload in sessionStorage and
 * is cleared by markBootSucceeded(). Returns the delay used (ms).
 */
export function scheduleKioskRetry(): number {
  let attempt = 0;
  try { attempt = Number(sessionStorage.getItem(KIOSK_RETRY_KEY) ?? "0") || 0; } catch { /* storage blocked */ }
  const delay = Math.min(300_000, 15_000 * 2 ** attempt);
  try { sessionStorage.setItem(KIOSK_RETRY_KEY, String(attempt + 1)); } catch { /* storage blocked */ }
  window.setTimeout(() => window.location.reload(), delay);
  return delay;
}

export function markBootSucceeded(): void {
  try { sessionStorage.removeItem(KIOSK_RETRY_KEY); } catch { /* storage blocked */ }
}
