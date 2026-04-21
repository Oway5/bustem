export type RetryOptions = {
  attempts?: number;
  baseMs?: number;
  signal?: AbortSignal;
  retryOn?: (err: unknown) => boolean;
};

export class HttpStatusError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpStatusError";
    this.status = status;
  }
}

export class RateLimitedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitedError";
  }
}

const TRANSIENT_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function defaultRetryOn(error: unknown) {
  if (error instanceof RateLimitedError) {
    return true;
  }
  if (error instanceof HttpStatusError) {
    return TRANSIENT_STATUS.has(error.status);
  }
  // fetch surfaces network and DNS failures as TypeError in modern Node runtimes.
  if (error instanceof TypeError) {
    return true;
  }
  if (error instanceof Error && /network|ECONN|ETIMEDOUT|socket hang up/i.test(error.message)) {
    return true;
  }
  return false;
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Aborted"));
      return;
    }

    const timer = setTimeout(() => {
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Aborted"));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Runs `task` with bounded retries. Budget reservations should happen *outside*
 * the retry so transient failures don't double-bill the request budget.
 *
 * Defaults: 3 attempts with full-jitter exponential backoff starting at 300 ms.
 * Aborts immediately if `signal.aborted`. Only retries on `retryOn(err)` true
 * (defaults to transient HTTP + network errors).
 */
export async function withRetry<T>(
  task: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const baseMs = Math.max(1, opts.baseMs ?? 300);
  const retryOn = opts.retryOn ?? defaultRetryOn;
  const signal = opts.signal;

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (signal?.aborted) {
      throw new Error("Aborted");
    }

    try {
      return await task();
    } catch (error) {
      lastError = error;
      const isLast = attempt === attempts;

      if (isLast || !retryOn(error)) {
        throw error;
      }

      const backoff = Math.floor(Math.random() * baseMs * 2 ** (attempt - 1));
      await sleep(backoff, signal);
    }
  }

  throw lastError;
}
