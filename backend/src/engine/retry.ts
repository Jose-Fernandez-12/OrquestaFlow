// Per-node retry and error policy.
//
// Node data fields (all optional):
//   retryCount    number of extra attempts after the first failure (0-10)
//   retryDelayMs  wait before the first retry, in ms (default 1000)
//   retryBackoff  'fixed' | 'exponential' (default 'exponential')
//   onError       'stop' (default) fails the flow | 'continue' records the error and lets downstream nodes run

export type RetryBackoff = 'fixed' | 'exponential';
export type OnErrorPolicy = 'stop' | 'continue';

export interface RetryPolicy {
  maxRetries: number;
  delayMs: number;
  backoff: RetryBackoff;
  onError: OnErrorPolicy;
}

export interface RetryInfo {
  attempt: number;      // retry number about to run (1-based)
  maxRetries: number;
  delayMs: number;
  error: string;
}

export const HTTP_NODE_TYPES = ['httpGet', 'httpPost', 'httpRequest'];

// Nodes that talk to the outside world and can fail transiently
export const RETRYABLE_NODE_TYPES = [...HTTP_NODE_TYPES, 'scraping', 'query', 'oauth2Connector', 'aiChatCompletion'];

// Control-flow nodes: continuing past a failure would leave the graph in an undefined state
export const NO_CONTINUE_NODE_TYPES = ['start', 'forEach', 'forEachEnd', 'conditionalBranch'];

const MAX_RETRIES = 10;
const MAX_DELAY_MS = 60_000;
const DEFAULT_DELAY_MS = 1000;

function toInt(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export function getRetryPolicy(node: any, settings?: { http_max_retries?: number }): RetryPolicy {
  const data = node?.data || {};
  const type = node?.type || '';

  let maxRetries = 0;
  if (RETRYABLE_NODE_TYPES.includes(type)) {
    const explicit = toInt(data.retryCount);
    const fallback = HTTP_NODE_TYPES.includes(type) ? toInt(settings?.http_max_retries) : null;
    maxRetries = Math.min(MAX_RETRIES, Math.max(0, explicit ?? fallback ?? 0));
  }

  const delay = toInt(data.retryDelayMs);
  const onError: OnErrorPolicy =
    data.onError === 'continue' && !NO_CONTINUE_NODE_TYPES.includes(type) ? 'continue' : 'stop';

  return {
    maxRetries,
    delayMs: Math.min(MAX_DELAY_MS, Math.max(0, delay ?? DEFAULT_DELAY_MS)),
    backoff: data.retryBackoff === 'fixed' ? 'fixed' : 'exponential',
    onError,
  };
}

export function retryDelay(policy: RetryPolicy, attempt: number): number {
  const base = policy.backoff === 'exponential' ? policy.delayMs * 2 ** (attempt - 1) : policy.delayMs;
  return Math.min(MAX_DELAY_MS, base);
}

export function isAbortError(err: any, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes('detenida por el usuario') || msg.includes('detenido');
}

// 408 Request Timeout, 425 Too Early, 429 Too Many Requests and 5xx are worth retrying
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

export function isRetryableError(err: any): boolean {
  if (err?.retryable === false) return false;
  if (typeof err?.status === 'number') return isRetryableStatus(err.status);
  return true;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Ejecución detenida por el usuario'));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('Ejecución detenida por el usuario'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export interface RunWithRetryOptions<T> {
  signal?: AbortSignal;
  onRetry?: (info: RetryInfo) => void;
  /** Return a reason to retry a successful-but-unusable result (e.g. an HTTP 503), or null to accept it */
  retryResult?: (result: T) => string | null;
  sleepFn?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export async function runWithRetry<T>(
  fn: (attempt: number) => Promise<T>,
  policy: RetryPolicy,
  options: RunWithRetryOptions<T> = {}
): Promise<T> {
  const wait = options.sleepFn || sleep;
  for (let attempt = 0; ; attempt++) {
    let reason: string | null = null;
    try {
      const result = await fn(attempt);
      reason = options.retryResult ? options.retryResult(result) : null;
      if (!reason || attempt >= policy.maxRetries) return result;
    } catch (err: any) {
      if (isAbortError(err, options.signal) || !isRetryableError(err) || attempt >= policy.maxRetries) throw err;
      reason = String(err?.message || err);
    }

    const delayMs = retryDelay(policy, attempt + 1);
    options.onRetry?.({ attempt: attempt + 1, maxRetries: policy.maxRetries, delayMs, error: reason });
    await wait(delayMs, options.signal);
  }
}
