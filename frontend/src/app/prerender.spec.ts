import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect } from 'vitest';
import { HttpClient, HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { App } from './app';
import { PrerenderBackend } from './core/http/prerender-backend';
import { PublicBarberStore } from './public-barber.store';
import { ReviewStore } from './review.store';
import { ServiceCatalogStore } from './service-catalog.store';

/** The guest landing is prerendered at build time, where there is no backend. */
describe('prerendering (server platform)', () => {
  function configure(platform: 'server' | 'browser') {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: PLATFORM_ID, useValue: platform },
      ],
    });
    return TestBed.inject(HttpTestingController);
  }

  it('the public stores request nothing and render the empty, error-free loading state', () => {
    const http = configure('server');
    const catalog = TestBed.inject(ServiceCatalogStore);
    const barbers = TestBed.inject(PublicBarberStore);
    const reviews = TestBed.inject(ReviewStore);
    TestBed.tick();

    http.expectNone(() => true);
    expect(catalog.services()).toEqual([]);
    expect(barbers.barbers()).toEqual([]);
    expect(reviews.ratings()).toEqual([]);
    expect([catalog.errorMessage(), barbers.errorMessage(), reviews.errorMessage()]).toEqual([
      null,
      null,
      null,
    ]);
  });

  it('the public stores still load in the browser', () => {
    const http = configure('browser');
    TestBed.inject(ServiceCatalogStore);
    TestBed.tick();

    http.expectOne((req) => req.url.includes('/api/v1/catalog'));
  });

  it('the app shell does not restore the session on the server', () => {
    const http = configure('server');
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    http.expectNone((req) => req.url.includes('/api/v1/auth/'));
  });

  it('PrerenderBackend fails every request locally instead of reaching the network', async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), { provide: PrerenderBackend, useClass: PrerenderBackend }],
    });
    const backend = TestBed.inject(PrerenderBackend);
    const client = new HttpClient(backend);

    const error = await firstValueFrom(client.get('/api/v1/catalog')).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpErrorResponse);
    expect((error as HttpErrorResponse).status).toBe(0);
    expect((error as HttpErrorResponse).statusText).toContain('GET /api/v1/catalog');
  });
});
