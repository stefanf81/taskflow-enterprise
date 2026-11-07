import { queryClient, queryRetryDelay, shouldRetryQuery } from '../src/query/queryClient';
import { ApiContractError } from '../src/api/contracts';
import { SessionChangedError, SessionExpiredError } from '../src/utils/session';

const httpError = (status: number, headers: Record<string, string> = {}) =>
  Object.assign(new Error(`HTTP ${status}`), { response: { status, data: null, headers } });

describe('queryClient defaults', () => {
  const queries = queryClient.getDefaultOptions().queries!;

  it('keeps data fresh for a minute and cached for five', () => {
    expect(queries.staleTime).toBe(60_000);
    expect(queries.gcTime).toBe(5 * 60_000);
  });

  it('uses the retry policy and does not refetch on focus by default', () => {
    expect(queries.retry).toBe(shouldRetryQuery);
    expect(queries.retryDelay).toBe(queryRetryDelay);
    expect(queries.refetchOnWindowFocus).toBe(false);
  });

  it('fails fast offline but refetches once the device reconnects', () => {
    expect(queries.networkMode).toBe('always');
    expect(queries.refetchOnReconnect).toBe(true);
    expect(queryClient.getDefaultOptions().mutations?.networkMode).toBe('always');
  });
});

describe('shouldRetryQuery', () => {
  it('retries a transient failure once', () => {
    const timeout = Object.assign(new Error('timeout of 10000ms exceeded'), { code: 'ECONNABORTED' });
    expect(shouldRetryQuery(0, timeout)).toBe(true);
    expect(shouldRetryQuery(1, timeout)).toBe(false);
    for (const status of [408, 500, 502, 503, 504]) {
      expect(shouldRetryQuery(0, httpError(status))).toBe(true);
      expect(shouldRetryQuery(1, httpError(status))).toBe(false);
    }
  });

  it('never retries client errors', () => {
    for (const status of [400, 401, 403, 404, 409, 422]) {
      expect(shouldRetryQuery(0, httpError(status))).toBe(false);
    }
  });

  it('never retries a contract violation, an expired session or a replaced one', () => {
    expect(shouldRetryQuery(0, new ApiContractError('GET /x', 'id: required'))).toBe(false);
    expect(shouldRetryQuery(0, new SessionExpiredError())).toBe(false);
    expect(shouldRetryQuery(0, new SessionChangedError())).toBe(false);
  });

  it('retries 429 only after a short Retry-After', () => {
    expect(shouldRetryQuery(0, httpError(429))).toBe(false);
    expect(shouldRetryQuery(0, httpError(429, { 'Retry-After': '3' }))).toBe(true);
    expect(shouldRetryQuery(0, httpError(429, { 'Retry-After': '60' }))).toBe(false);
    expect(shouldRetryQuery(0, httpError(503, { 'retry-after': '60' }))).toBe(false);
  });
});

describe('queryRetryDelay', () => {
  it('backs off exponentially up to 30 seconds', () => {
    const error = new Error('boom');
    expect(queryRetryDelay(0, error)).toBe(1000);
    expect(queryRetryDelay(1, error)).toBe(2000);
    expect(queryRetryDelay(4, error)).toBe(16_000);
    expect(queryRetryDelay(5, error)).toBe(30_000);
    expect(queryRetryDelay(20, error)).toBe(30_000);
  });

  it('waits for the Retry-After the server sent', () => {
    expect(queryRetryDelay(0, httpError(429, { 'Retry-After': '3' }))).toBe(3000);
    expect(queryRetryDelay(0, httpError(503, { 'Retry-After': '120' }))).toBe(30_000);
  });
});
