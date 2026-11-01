import {
  HttpClient,
  HttpErrorResponse,
  httpResource,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  requestTimeoutInterceptor,
} from './request-timeout.interceptor';

describe('requestTimeoutInterceptor', () => {
  describe('with the testing backend', () => {
    let http: HttpClient;
    let httpTesting: HttpTestingController;

    const setup = () => {
      TestBed.configureTestingModule({
        providers: [
          provideHttpClient(withInterceptors([requestTimeoutInterceptor])),
          provideHttpClientTesting(),
        ],
      });
      http = TestBed.inject(HttpClient);
      httpTesting = TestBed.inject(HttpTestingController);
    };

    afterEach(() => httpTesting.verify());

    it('bounds a request without its own timeout by the default', () => {
      setup();
      http.get('/api/v1/catalog').subscribe();

      const req = httpTesting.expectOne('/api/v1/catalog');
      expect(req.request.timeout).toBe(DEFAULT_REQUEST_TIMEOUT_MS);
      req.flush([]);
    });

    it('keeps a timeout the caller set', () => {
      setup();
      http.post('/api/v1/appointments', {}, { timeout: 30_000 }).subscribe();

      const req = httpTesting.expectOne('/api/v1/appointments');
      expect(req.request.timeout).toBe(30_000);
      req.flush(null);
    });

    it('also bounds httpResource requests', () => {
      setup();
      TestBed.runInInjectionContext(() => httpResource(() => '/api/v1/barbers'));
      TestBed.tick();

      const req = httpTesting.expectOne('/api/v1/barbers');
      expect(req.request.timeout).toBe(DEFAULT_REQUEST_TIMEOUT_MS);
      req.flush([]);
    });
  });

  describe('with the fetch backend', () => {
    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it('fails a hung request as a transport error once the timeout expires', async () => {
      vi.useFakeTimers();
      let signal: AbortSignal | undefined;
      vi.stubGlobal(
        'fetch',
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            signal = init.signal ?? undefined;
            signal?.addEventListener('abort', () => reject(signal?.reason));
          }),
      );
      TestBed.configureTestingModule({
        providers: [provideHttpClient(withInterceptors([requestTimeoutInterceptor]))],
      });
      const http = TestBed.inject(HttpClient);
      let failure: unknown;
      http.get('/api/v1/catalog').subscribe({ error: (err: unknown) => (failure = err) });

      await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_TIMEOUT_MS - 1);
      expect(signal?.aborted).toBe(false);
      expect(failure).toBeUndefined();

      await vi.advanceTimersByTimeAsync(1);
      expect(signal?.aborted).toBe(true);
      expect(failure).toBeInstanceOf(HttpErrorResponse);
      expect((failure as HttpErrorResponse).status).toBe(0);
    });
  });
});
