import { describe, it, expect, vi } from 'vitest';
import { getRetryPolicy, runWithRetry, retryDelay, isRetryableStatus, type RetryPolicy } from '../src/engine/retry';

const noWait = () => Promise.resolve();
const policy = (p: Partial<RetryPolicy> = {}): RetryPolicy => ({ maxRetries: 2, delayMs: 100, backoff: 'fixed', onError: 'stop', ...p });

describe('getRetryPolicy', () => {
  it('uses the global HTTP setting when the node does not override it', () => {
    expect(getRetryPolicy({ type: 'httpRequest', data: {} }, { http_max_retries: 3 }).maxRetries).toBe(3);
    expect(getRetryPolicy({ type: 'httpRequest', data: { retryCount: 0 } }, { http_max_retries: 3 }).maxRetries).toBe(0);
    expect(getRetryPolicy({ type: 'httpRequest', data: { retryCount: '2' } }).maxRetries).toBe(2);
  });

  it('never retries deterministic nodes', () => {
    expect(getRetryPolicy({ type: 'jsonTransform', data: { retryCount: 5 } }).maxRetries).toBe(0);
    expect(getRetryPolicy({ type: 'dataList', data: { retryCount: 5 } }).maxRetries).toBe(0);
  });

  it('caps the number of retries and the delay', () => {
    const p = getRetryPolicy({ type: 'query', data: { retryCount: 99, retryDelayMs: 999999 } });
    expect(p.maxRetries).toBe(10);
    expect(p.delayMs).toBe(60000);
  });

  it('does not allow "continue" on control-flow nodes', () => {
    expect(getRetryPolicy({ type: 'httpRequest', data: { onError: 'continue' } }).onError).toBe('continue');
    expect(getRetryPolicy({ type: 'conditionalBranch', data: { onError: 'continue' } }).onError).toBe('stop');
    expect(getRetryPolicy({ type: 'forEach', data: { onError: 'continue' } }).onError).toBe('stop');
  });
});

describe('retryDelay', () => {
  it('doubles the delay with exponential backoff', () => {
    const p = policy({ backoff: 'exponential', delayMs: 500 });
    expect([1, 2, 3].map(a => retryDelay(p, a))).toEqual([500, 1000, 2000]);
  });

  it('keeps it constant with fixed backoff', () => {
    expect(retryDelay(policy({ delayMs: 500 }), 3)).toBe(500);
  });
});

describe('runWithRetry', () => {
  it('retries until the call succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValue('ok');
    const onRetry = vi.fn();
    await expect(runWithRetry(fn, policy(), { sleepFn: noWait, onRetry })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry.mock.calls[0][0]).toMatchObject({ attempt: 1, maxRetries: 2, error: 'ECONNRESET' });
  });

  it('gives up after maxRetries and throws the last error', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(runWithRetry(fn, policy({ maxRetries: 1 }), { sleepFn: noWait })).rejects.toThrow('boom');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry client errors marked with a 4xx status', async () => {
    const err: any = Object.assign(new Error('not found'), { status: 404 });
    const fn = vi.fn().mockRejectedValue(err);
    await expect(runWithRetry(fn, policy(), { sleepFn: noWait })).rejects.toThrow('not found');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not retry when the run was stopped by the user', async () => {
    const controller = new AbortController();
    controller.abort();
    const fn = vi.fn().mockRejectedValue(new Error('network'));
    await expect(runWithRetry(fn, policy(), { signal: controller.signal, sleepFn: noWait })).rejects.toThrow('network');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries results flagged by retryResult and returns the last one when retries run out', async () => {
    const fn = vi.fn().mockResolvedValue({ status: 503 });
    const result = await runWithRetry(fn, policy({ maxRetries: 2 }), {
      sleepFn: noWait,
      retryResult: r => (r.status >= 500 ? 'HTTP 503' : null),
    });
    expect(result).toEqual({ status: 503 });
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe('isRetryableStatus', () => {
  it('only retries transient HTTP statuses', () => {
    expect([408, 425, 429, 500, 502, 503, 504].every(isRetryableStatus)).toBe(true);
    expect([400, 401, 403, 404, 422].some(isRetryableStatus)).toBe(false);
  });
});
