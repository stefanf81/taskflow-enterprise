import { queryClient } from '../src/query/queryClient';

describe('queryClient defaults', () => {
  const queries = queryClient.getDefaultOptions().queries!;

  it('keeps data fresh for a minute and cached for five', () => {
    expect(queries.staleTime).toBe(60_000);
    expect(queries.gcTime).toBe(5 * 60_000);
  });

  it('retries once and does not refetch on focus', () => {
    expect(queries.retry).toBe(1);
    expect(queries.refetchOnWindowFocus).toBe(false);
  });

  it('backs off exponentially up to 30 seconds', () => {
    const retryDelay = queries.retryDelay as (attemptIndex: number, error: Error) => number;
    const error = new Error('boom');
    expect(retryDelay(0, error)).toBe(1000);
    expect(retryDelay(1, error)).toBe(2000);
    expect(retryDelay(4, error)).toBe(16_000);
    expect(retryDelay(5, error)).toBe(30_000);
    expect(retryDelay(20, error)).toBe(30_000);
  });
});
