import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AuthModalComponent } from './auth-modal';
import { AuthState } from '../../../core/auth/auth.state';

describe('AuthModalComponent', () => {
  let fixture: ComponentFixture<AuthModalComponent>;
  let component: AuthModalComponent;
  let httpMock: HttpTestingController;
  let authState: AuthState;

  const overlay = (): HTMLElement =>
    fixture.nativeElement.querySelector('.modal-overlay') as HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AuthModalComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    fixture = TestBed.createComponent(AuthModalComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    authState = TestBed.inject(AuthState);
    fixture.detectChanges();
  });

  afterEach(() => httpMock.verify());

  it('never defaults credentials to a GET form and prevents native submission', () => {
    const form = (fixture.nativeElement as HTMLElement).querySelector('form')!;
    expect(form.method).toBe('post');
    const event = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    httpMock.expectNone('/api/v1/auth/login');
  });

  it('starts in login mode with invalid empty fields', () => {
    expect(component.isRegisterMode()).toBe(false);
    expect(component.authForm.username().invalid()).toBe(true);
    expect(component.authForm.password().invalid()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Sign In');
  });

  it('reports missing credentials without issuing a request', () => {
    component.onLogin();
    expect(component.errorMessage()).toBe('Email and password are required.');
    httpMock.expectNone('/api/v1/auth/login');
  });

  it('logs in, applies the role, resets the model and emits closed + loginSuccess', () => {
    let closed = 0;
    let role: string | undefined;
    component.closed.subscribe(() => closed++);
    component.loginSuccess.subscribe((value) => (role = value));

    component.authModel.set({
      username: 'admin',
      password: 'admin-password',
      fullName: '',
      phone: '',
    });
    component.onLogin();

    const req = httpMock.expectOne('/api/v1/auth/login');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ username: 'admin', password: 'admin-password' });
    req.flush({ role: 'ROLE_ADMIN', username: 'admin' });

    expect(authState.role()).toBe('ROLE_ADMIN');
    expect(authState.isLoggedIn()).toBe(true);
    expect(component.isSubmitting()).toBe(false);
    expect(component.authModel().username).toBe('');
    expect(closed).toBe(1);
    expect(role).toBe('ROLE_ADMIN');
  });

  it('surfaces a generic error when credentials are rejected', () => {
    // The component logs the raw HTTP error in dev mode; keep the test output clean.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    component.authModel.set({
      username: 'admin',
      password: 'wrong',
      fullName: '',
      phone: '',
    });
    component.onLogin();
    httpMock
      .expectOne('/api/v1/auth/login')
      .flush({ message: 'Bad credentials' }, { status: 401, statusText: 'Unauthorized' });

    expect(component.errorMessage()).toBe('Invalid credentials. Please try again.');
    expect(component.isSubmitting()).toBe(false);
    consoleError.mockRestore();
  });

  it('switches to register mode and clears stale alerts', () => {
    component.toggleMode();
    expect(component.isRegisterMode()).toBe(true);
    expect(component.errorMessage()).toBeNull();
    expect(component.successMessage()).toBeNull();
  });

  it('requires name, email and password for registration', () => {
    component.toggleMode();
    component.onRegister();
    expect(component.errorMessage()).toBe('Name, email, phone, and password are required.');
    httpMock.expectNone('/api/v1/auth/register');
  });

  it('sends the password verbatim (no trimming), like mobile and the backend', () => {
    component.authModel.set({
      username: ' admin ',
      password: '  pass word1  ',
      fullName: '',
      phone: '',
    });
    component.onLogin();

    const req = httpMock.expectOne('/api/v1/auth/login');
    expect(req.request.body).toEqual({ username: 'admin', password: '  pass word1  ' });
    req.flush({ role: 'ROLE_ADMIN', username: 'admin' });
  });

  it('refuses a blank (whitespace-only) password without a request', () => {
    component.authModel.set({ username: 'admin', password: '   ', fullName: '', phone: '' });
    component.onLogin();
    httpMock.expectNone('/api/v1/auth/login');
    expect(component.errorMessage()).toBe('Email and password are required.');
  });

  it('registers with the password verbatim', () => {
    component.toggleMode();
    component.authModel.set({
      username: 'jane@example.com',
      password: ' secret-password-1 ',
      fullName: 'Jane Smith',
      phone: '+1-555-0000',
    });
    component.onRegister();

    const req = httpMock.expectOne('/api/v1/auth/register');
    expect(req.request.body.password).toBe(' secret-password-1 ');
    req.flush({ message: 'Account created successfully.' });
  });

  it('registers the account and returns to login mode with a success message', () => {
    component.toggleMode();
    component.authModel.set({
      username: 'jane@example.com',
      password: 'secret-password-1',
      fullName: 'Jane Smith',
      phone: '+1-555-0000',
    });
    component.onRegister();

    const req = httpMock.expectOne('/api/v1/auth/register');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      email: 'jane@example.com',
      password: 'secret-password-1',
      fullName: 'Jane Smith',
      phone: '+1-555-0000',
    });
    req.flush({ message: 'Account created successfully.' });

    expect(component.isRegisterMode()).toBe(false);
    expect(component.successMessage()).toBe('Account created! You can now log in.');
    expect(component.isSubmitting()).toBe(false);
  });

  it('surfaces the backend message when registration fails', () => {
    component.toggleMode();
    component.authModel.set({
      username: 'jane@example.com',
      password: 'secret-password-1',
      fullName: 'Jane Smith',
      phone: '+1-555-0000',
    });
    component.onRegister();
    httpMock
      .expectOne('/api/v1/auth/register')
      .flush({ message: 'Email already registered' }, { status: 409, statusText: 'Conflict' });

    expect(component.errorMessage()).toBe('Email already registered');
  });

  it('emits closed from closeModal and from Escape on the overlay', () => {
    let closed = 0;
    component.closed.subscribe(() => closed++);
    component.closeModal();
    overlay().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(closed).toBe(2);
  });

  describe('login failures map to actionable copy (FE-10)', () => {
    const attemptLogin = () => {
      component.authModel.set({ username: 'admin', password: 'pw', fullName: '', phone: '' });
      component.onLogin();
      return httpMock.expectOne('/api/v1/auth/login');
    };

    it('401 -> invalid credentials', () => {
      attemptLogin().flush(null, { status: 401, statusText: 'Unauthorized' });
      expect(component.errorMessage()).toBe('Invalid credentials. Please try again.');
    });

    it('429 with Retry-After seconds -> wait in seconds', () => {
      attemptLogin().flush(null, {
        status: 429,
        statusText: 'Too Many Requests',
        headers: { 'Retry-After': '45' },
      });
      expect(component.errorMessage()).toBe('Too many attempts. Try again in 45 seconds.');
      expect(component.isSubmitting()).toBe(false);
    });

    it('429 with a longer Retry-After -> wait in minutes (rounded up)', () => {
      attemptLogin().flush(null, {
        status: 429,
        statusText: 'Too Many Requests',
        headers: { 'Retry-After': '120' },
      });
      expect(component.errorMessage()).toBe('Too many attempts. Try again in 2 minutes.');
    });

    it('429 singular wording', () => {
      attemptLogin().flush(null, {
        status: 429,
        statusText: 'Too Many Requests',
        headers: { 'Retry-After': '1' },
      });
      expect(component.errorMessage()).toBe('Too many attempts. Try again in 1 second.');
    });

    it('429 with an HTTP-date Retry-After', () => {
      vi.useFakeTimers({ now: new Date('2026-10-12T10:00:00Z') });
      try {
        attemptLogin().flush(null, {
          status: 429,
          statusText: 'Too Many Requests',
          headers: { 'Retry-After': new Date('2026-10-12T10:03:00Z').toUTCString() },
        });
        expect(component.errorMessage()).toBe('Too many attempts. Try again in 3 minutes.');
      } finally {
        vi.useRealTimers();
      }
    });

    it('429 without a usable Retry-After still explains itself', () => {
      attemptLogin().flush(null, { status: 429, statusText: 'Too Many Requests' });
      expect(component.errorMessage()).toBe('Too many attempts. Please try again in a moment.');
    });

    it('network failure (status 0) -> cannot reach the server', () => {
      attemptLogin().error(new ProgressEvent('error'));
      expect(component.errorMessage()).toContain('Cannot reach the server');
    });

    it('5xx -> generic retry message', () => {
      attemptLogin().flush(null, { status: 503, statusText: 'Service Unavailable' });
      expect(component.errorMessage()).toBe('Something went wrong. Please try again.');
    });
  });

  it('shows the password policy up front in register mode', () => {
    component.toggleMode();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'at least 8 characters long and contain both letters and numbers',
    );
  });

  it('shows the whole password policy when the client-side check rejects the password', () => {
    component.toggleMode();
    component.authModel.set({
      username: 'jane@example.com',
      password: 'abcdefgh',
      fullName: 'Jane Smith',
      phone: '555',
    });

    component.onRegister();

    expect(component.errorMessage()).toBe(component.passwordPolicy);
    httpMock.expectNone('/api/v1/auth/register');
  });

  it('shows the field message when the registration email is malformed', () => {
    component.toggleMode();
    component.authModel.set({
      username: 'not-an-email',
      password: 'secret-password-1',
      fullName: 'Jane Smith',
      phone: '555',
    });

    component.onRegister();

    expect(component.errorMessage()).toBe('Valid email is required');
    httpMock.expectNone('/api/v1/auth/register');
  });

  it('shows the session-expired notice and clears it when closed', () => {
    authState.sessionNotice.set('Your session expired. Please sign in again.');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Your session expired.');

    component.closeModal();

    expect(authState.sessionNotice()).toBeNull();
  });

  it('records the principal username from the login response', () => {
    component.authModel.set({
      username: 'jane@example.com',
      password: 'pw',
      fullName: '',
      phone: '',
    });
    component.onLogin();
    httpMock
      .expectOne('/api/v1/auth/login')
      .flush({ role: 'ROLE_CUSTOMER', username: 'jane@example.com' });

    expect(authState.username()).toBe('jane@example.com');
  });
});
