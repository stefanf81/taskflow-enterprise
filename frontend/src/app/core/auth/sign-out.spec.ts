import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { FlashMessages } from '../ui/flash-messages';
import { AuthState } from './auth.state';
import { SIGN_OUT_FAILED_MESSAGE, injectSignOut } from './sign-out';

describe('injectSignOut', () => {
  let signOut: () => Promise<boolean>;
  let authState: AuthState;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    signOut = TestBed.runInInjectionContext(() => injectSignOut());
    authState = TestBed.inject(AuthState);
    httpMock = TestBed.inject(HttpTestingController);
    authState.applyRole('ROLE_ADMIN', 'admin');
  });

  afterEach(() => httpMock.verify());

  it('signs out only after the server confirms (the session stays alive until then)', async () => {
    const done = signOut();
    expect(authState.isLoggedIn()).toBe(true);

    const req = httpMock.expectOne((r) => r.url.includes('/api/v1/auth/logout'));
    expect(req.request.method).toBe('POST');
    req.flush(null);

    expect(await done).toBe(true);
    expect(authState.isLoggedIn()).toBe(false);
  });

  it('keeps the session and shows an error on the banner when logout fails', async () => {
    const done = signOut();
    httpMock
      .expectOne((r) => r.url.includes('/api/v1/auth/logout'))
      .error(new ProgressEvent('error'), { status: 500, statusText: 'Server Error' });

    expect(await done).toBe(false);
    expect(authState.isLoggedIn()).toBe(true);
    expect(TestBed.inject(FlashMessages).errorMessage()).toBe(SIGN_OUT_FAILED_MESSAGE);
  });
});
