import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AuthModalComponent } from './auth-modal';
import { AuthState } from '../../auth.state';

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
    req.flush(null);

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
});
