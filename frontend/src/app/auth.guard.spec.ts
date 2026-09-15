import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import {
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';
import { Observable, firstValueFrom, of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { authGuard } from './auth.guard';
import { AuthState } from './auth.state';

/** Normalizes a guard result (boolean or UrlTree) into a comparable string. */
function asPath(result: unknown): string {
  return result instanceof UrlTree ? result.toString() : String(result);
}

describe('authGuard', () => {
  let auth: {
    role: ReturnType<typeof signal<string>>;
    isBootstrapDone: ReturnType<typeof vi.fn>;
    bootstrap: ReturnType<typeof vi.fn>;
  };

  const runGuard = (url = '/admin') =>
    TestBed.runInInjectionContext(() =>
      authGuard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
    );

  beforeEach(() => {
    auth = {
      role: signal(''),
      isBootstrapDone: vi.fn(() => false),
      bootstrap: vi.fn(() => of('')),
    };
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AuthState, useValue: auth }],
    });
  });

  it('lets an authenticated admin through to /admin', () => {
    auth.role.set('ROLE_ADMIN');
    expect(runGuard('/admin')).toBe(true);
  });

  it('lets an authenticated customer through to /customer', () => {
    auth.role.set('ROLE_CUSTOMER');
    expect(runGuard('/customer')).toBe(true);
  });

  it('redirects an admin deep-linking to /customer back to /admin', () => {
    auth.role.set('ROLE_ADMIN');
    expect(asPath(runGuard('/customer'))).toBe('/admin');
  });

  it('redirects a customer deep-linking to /admin back to /customer', () => {
    auth.role.set('ROLE_CUSTOMER');
    expect(asPath(runGuard('/admin'))).toBe('/customer');
  });

  it('sends guests to the landing page once bootstrap has already finished', () => {
    auth.isBootstrapDone.mockReturnValue(true);
    expect(asPath(runGuard())).toBe('/');
    expect(auth.bootstrap).not.toHaveBeenCalled();
  });

  it('restores an admin role from the server and redirects to /admin', async () => {
    auth.bootstrap.mockReturnValue(of('ROLE_ADMIN'));
    const result = await firstValueFrom(runGuard() as Observable<unknown>);
    expect(asPath(result)).toBe('/admin');
  });

  it('restores a customer role from the server and redirects to /customer', async () => {
    auth.bootstrap.mockReturnValue(of('ROLE_CUSTOMER'));
    const result = await firstValueFrom(runGuard('/admin') as Observable<unknown>);
    expect(asPath(result)).toBe('/customer');
  });

  it('sends guests to the landing page when bootstrap resolves without a role', async () => {
    auth.bootstrap.mockReturnValue(of(''));
    const result = await firstValueFrom(runGuard() as Observable<unknown>);
    expect(asPath(result)).toBe('/');
  });

  it('falls back to the landing page when bootstrap fails', async () => {
    auth.bootstrap.mockReturnValue(throwError(() => new Error('401')));
    const result = await firstValueFrom(runGuard() as Observable<unknown>);
    expect(asPath(result)).toBe('/');
  });
});
