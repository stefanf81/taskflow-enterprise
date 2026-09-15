import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { describe, beforeEach, expect, it, vi } from 'vitest';
import { AuthState } from './auth.state';
import { LoginResponse } from './types/api';
import { AuthApi } from './core/api/auth-api';

describe('AuthState', () => {
  let authState: AuthState;
  let me$: Subject<LoginResponse>;

  beforeEach(() => {
    me$ = new Subject<LoginResponse>();
    TestBed.configureTestingModule({
      providers: [
        AuthState,
        { provide: AuthApi, useValue: { me: vi.fn(() => me$.asObservable()) } },
        { provide: Router, useValue: {} },
      ],
    });
    authState = TestBed.inject(AuthState);
  });

  it('does not restore authentication when a pre-logout bootstrap completes late', () => {
    authState.bootstrap().subscribe();
    authState.clear();

    me$.next({ username: 'admin', role: 'ROLE_ADMIN' });

    expect(authState.isLoggedIn()).toBe(false);
    expect(authState.role()).toBe('');
  });
});
