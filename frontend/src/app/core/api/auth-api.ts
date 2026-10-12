import { HttpClient, HttpContext } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { defer, map, Observable } from 'rxjs';
import { LoginResponse, RegisterRequest, RegisterResponse } from '../../types/api';
import { PUBLIC_REQUEST } from '../http/public-request.token';
import { parseRequest, parseResponse } from './request-validation';
import {
  loginResponseSchema,
  loginSchema,
  registerResponseSchema,
  registerSchema,
} from '@taskflow/schemas';

/** Customer account and session endpoints (`/api/v1/auth`). */
@Service()
export class AuthApi {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/v1/auth';

  register(request: RegisterRequest): Observable<RegisterResponse> {
    return defer(() => {
      const validated = parseRequest(registerSchema, request);
      return this.http
        .post<RegisterResponse>(`${this.base}/register`, validated, {
          context: new HttpContext().set(PUBLIC_REQUEST, true),
        })
        .pipe(
          map((raw) => parseResponse(registerResponseSchema, raw, 'POST /api/v1/auth/register')),
        );
    });
  }

  // Perform secure JWT login by posting to the authentication controller.
  // The backend responds with an HttpOnly, SameSite=Strict cookie; no token is
  // returned to (or stored by) JavaScript.
  login(username: string, password: string): Observable<LoginResponse> {
    return defer(() => {
      const validated = parseRequest(loginSchema, { username, password });
      return this.http
        .post<LoginResponse>(`${this.base}/login`, validated, {
          context: new HttpContext().set(PUBLIC_REQUEST, true),
        })
        .pipe(map((raw) => parseResponse(loginResponseSchema, raw, 'POST /api/v1/auth/login')));
    });
  }

  // Returns the currently authenticated principal (used to restore UI role after a page refresh).
  // Marked PUBLIC_REQUEST: a guest's boot-time 401 is the expected "no session" answer, not a
  // session expiry. AuthState.bootstrap() handles it itself, so the interceptor must not broadcast
  // it (that would clear state out from under the bootstrap and wipe a newer login).
  me(): Observable<LoginResponse> {
    return this.http
      .get<LoginResponse>(`${this.base}/me`, {
        context: new HttpContext().set(PUBLIC_REQUEST, true),
      })
      .pipe(map((raw) => parseResponse(loginResponseSchema, raw, 'GET /api/v1/auth/me')));
  }

  // Fetches the CSRF token from the server, which causes Spring Security's
  // CookieCsrfTokenRepository to set the XSRF-TOKEN cookie in the response.
  // Safe to call repeatedly — the backend re-issues the cookie on every response.
  fetchCsrfToken(): Observable<void> {
    return this.http.get<void>(`${this.base}/csrf`, {
      context: new HttpContext().set(PUBLIC_REQUEST, true),
    });
  }

  // Revokes the session and clears the HttpOnly auth cookie on the backend. The endpoint is
  // permitAll (a dead session can still sign out) but still needs the CSRF header. Marked
  // PUBLIC_REQUEST so a 401 here never triggers the "session expired" flow mid-logout.
  logout(): Observable<void> {
    return this.http.post<void>(
      `${this.base}/logout`,
      {},
      { context: new HttpContext().set(PUBLIC_REQUEST, true) },
    );
  }
}
