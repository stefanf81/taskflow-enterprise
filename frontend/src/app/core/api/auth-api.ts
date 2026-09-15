import { HttpClient, HttpContext } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { defer, Observable } from 'rxjs';
import { LoginResponse, RegisterRequest, RegisterResponse } from '../../types/api';
import { PUBLIC_REQUEST } from '../http/public-request.token';
import { parseRequest } from './request-validation';
import { loginSchema, registerSchema } from '@taskflow/schemas';

/** Customer account and session endpoints (`/api/v1/auth`). */
@Service()
export class AuthApi {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/v1/auth';

  register(request: RegisterRequest): Observable<RegisterResponse> {
    return defer(() => {
      const validated = parseRequest(registerSchema, request);
      return this.http.post<RegisterResponse>(`${this.base}/register`, validated, {
        context: new HttpContext().set(PUBLIC_REQUEST, true),
      });
    });
  }

  // Perform secure JWT login by posting to the authentication controller.
  // The backend responds with an HttpOnly, SameSite=Strict cookie; no token is
  // returned to (or stored by) JavaScript.
  login(username: string, password: string): Observable<LoginResponse> {
    return defer(() => {
      const validated = parseRequest(loginSchema, { username, password });
      return this.http.post<LoginResponse>(`${this.base}/login`, validated, {
        context: new HttpContext().set(PUBLIC_REQUEST, true),
      });
    });
  }

  // Returns the currently authenticated principal (used to restore UI role after a page refresh).
  me(): Observable<LoginResponse> {
    return this.http.get<LoginResponse>(`${this.base}/me`);
  }

  // Fetches the CSRF token from the server, which causes Spring Security's
  // CookieCsrfTokenRepository to set the XSRF-TOKEN cookie in the response.
  // Safe to call repeatedly — the backend re-issues the cookie on every response.
  fetchCsrfToken(): Observable<void> {
    return this.http.get<void>(`${this.base}/csrf`, {
      context: new HttpContext().set(PUBLIC_REQUEST, true),
    });
  }

  // Clears the HttpOnly auth cookie on the backend.
  logout(): Observable<void> {
    return this.http.post<void>(`${this.base}/logout`, {});
  }
}
