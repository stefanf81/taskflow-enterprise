/**
 * Vitest test setup — mocks browser APIs not available in jsdom.
 *
 * Angular's @defer (on viewport) uses IntersectionObserver, which is not
 * implemented by jsdom. This mock prevents test warnings/failures when
 * deferred components are rendered in unit tests.
 */

// --- IntersectionObserver mock ---
class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin: string = '';
  readonly scrollMargin: string = '';
  readonly thresholds: ReadonlyArray<number> = [];

  constructor(
    private callback: IntersectionObserverCallback,
    private options?: IntersectionObserverInit,
  ) {}

  observe(_target: Element): void {
    // Immediately trigger callback as intersecting so deferred content renders
    // in test environments.
    this.callback(
      [{ isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry],
      this,
    );
  }

  unobserve(_target: Element): void {}

  disconnect(): void {}

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

Object.defineProperty(window, 'IntersectionObserver', {
  writable: true,
  configurable: true,
  value: MockIntersectionObserver,
});

Object.defineProperty(globalThis, 'IntersectionObserver', {
  writable: true,
  configurable: true,
  value: MockIntersectionObserver,
});

// --- ResizeObserver mock (safety — some Angular internals may use it) ---
class MockResizeObserver implements ResizeObserver {
  constructor(private callback: ResizeObserverCallback) {}

  observe(_target: Element): void {}
  unobserve(_target: Element): void {}
  disconnect(): void {}
}

Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  configurable: true,
  value: MockResizeObserver,
});

Object.defineProperty(globalThis, 'ResizeObserver', {
  writable: true,
  configurable: true,
  value: MockResizeObserver,
});
