import { TestBed, ComponentFixture } from '@angular/core/testing';
import { App } from './app';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthState } from './auth.state';

describe('App shell', () => {
  let fixture: ComponentFixture<App>;
  let app: App;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(App);
    app = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  });

  function flushMe(status: 'ok' | 'unauthorized', role?: string): void {
    const reqs = httpMock.match((req) => req.url.includes('/api/v1/auth/me'));
    expect(reqs.length).toBeGreaterThan(0);
    for (const req of reqs) {
      if (status === 'ok') {
        req.flush({ role, username: 'user' });
      } else {
        req.flush(null, { status: 401, statusText: 'Unauthorized' });
      }
    }
  }

  it('compiles and renders the routed shell', () => {
    expect(app).toBeTruthy();
    expect((fixture.nativeElement as HTMLElement).querySelector('router-outlet')).toBeTruthy();
  });

  it('restores an existing session and forwards the user to their dashboard', async () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    fixture.detectChanges();
    flushMe('ok', 'ROLE_ADMIN');

    await fixture.whenStable();
    expect(navigate).toHaveBeenCalledWith('/admin');
  });

  it('stays logged out when no session cookie is present', async () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const authState = TestBed.inject(AuthState);

    fixture.detectChanges();
    flushMe('unauthorized');

    await fixture.whenStable();
    expect(authState.isLoggedIn()).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
});
