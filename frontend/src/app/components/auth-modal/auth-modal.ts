import {
  Component,
  output,
  signal,
  inject,
  DestroyRef,
  ChangeDetectionStrategy,
  ViewEncapsulation,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AppointmentService } from '../../appointment.service';
import { AuthState } from '../../auth.state';
import { AppointmentStore } from '../../appointment.store';

/**
 * Standalone Login / Register modal component.
 *
 * Displays an overlay dialog with sign-in and create-account forms.
 * Designed for @defer lazy-loading since the modal only appears on-demand
 * when the user clicks "Owner Portal".
 */
@Component({
  selector: 'app-auth-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="modal-overlay" (keydown.escape)="closeModal()">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Sign in"
        class="login-card modal-card animate-fadeIn p-8 rounded-3xl border border-white/10 shadow-2xl shadow-black/50"
      >
        <button class="modal-close" (click)="closeModal()">&times;</button>
        <div class="login-header text-center mb-6">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke-width="2.5"
            stroke="currentColor"
            class="w-10 h-10 text-gold mx-auto mb-3"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
            />
          </svg>
          <h2 class="text-xl font-black text-zinc-100 tracking-tight uppercase">
            {{ isRegisterMode() ? 'Create Account' : 'Sign In' }}
          </h2>
          <p class="text-xs text-zinc-500 leading-relaxed mt-1">
            {{
              isRegisterMode()
                ? 'Register to manage your appointments.'
                : 'Enter your credentials to access your dashboard.'
            }}
          </p>
        </div>

        @if (errorMessage()) {
          <div
            class="alert alert-error mb-4 py-3 px-4 rounded-xl text-xs flex items-center gap-2 border border-red-500/20"
          >
            <span class="text-rose-400 leading-normal font-medium">{{ errorMessage() }}</span>
          </div>
        }

        @if (successMessage()) {
          <div
            class="alert alert-success mb-4 py-3 px-4 rounded-xl text-xs flex items-center gap-2 border border-emerald-500/10"
          >
            <span class="text-emerald-400 leading-normal font-medium">{{ successMessage() }}</span>
          </div>
        }

        <form (ngSubmit)="onLogin()" #loginForm="ngForm" class="space-y-4">
          @if (isRegisterMode()) {
            <div class="form-group flex flex-col gap-1.5">
              <label for="regName" class="text-xs font-bold text-zinc-500 uppercase tracking-wider"
                >Full Name</label
              >
              <input
                type="text"
                id="regName"
                name="regName"
                [ngModel]="registerFullName()"
                (ngModelChange)="registerFullName.set($event)"
                required
                placeholder="John Doe"
                class="form-control"
                [attr.aria-invalid]="
                  loginForm.controls['regName']?.invalid && loginForm.controls['regName']?.touched
                    ? 'true'
                    : null
                "
                aria-describedby="regName-error"
              />
              <span
                id="regName-error"
                class="text-rose-400 text-[10px]"
                [style.display]="
                  loginForm.controls['regName']?.invalid && loginForm.controls['regName']?.touched
                    ? 'block'
                    : 'none'
                "
              >
                Full name is required.
              </span>
            </div>
            <div class="form-group flex flex-col gap-1.5">
              <label for="regPhone" class="text-xs font-bold text-zinc-500 uppercase tracking-wider"
                >Phone</label
              >
              <input
                type="text"
                id="regPhone"
                name="regPhone"
                [ngModel]="registerPhone()"
                (ngModelChange)="registerPhone.set($event)"
                placeholder="555-1234"
                class="form-control"
              />
            </div>
          }

          <div class="form-group flex flex-col gap-1.5">
            <label for="username" class="text-xs font-bold text-zinc-500 uppercase tracking-wider"
              >Email / Username</label
            >
            <input
              type="text"
              id="username"
              name="username"
              [ngModel]="loginUsername()"
              (ngModelChange)="loginUsername.set($event)"
              required
              placeholder="e.g., admin"
              class="form-control"
              [attr.aria-invalid]="
                loginForm.controls['username']?.invalid && loginForm.controls['username']?.touched
                  ? 'true'
                  : null
              "
              aria-describedby="username-error"
            />
            <span
              id="username-error"
              class="text-rose-400 text-[10px]"
              [style.display]="
                loginForm.controls['username']?.invalid && loginForm.controls['username']?.touched
                  ? 'block'
                  : 'none'
              "
            >
              Username is required.
            </span>
          </div>

          <div class="form-group flex flex-col gap-1.5">
            <label for="password" class="text-xs font-bold text-zinc-500 uppercase tracking-wider"
              >Password</label
            >
            <input
              type="password"
              id="password"
              name="password"
              [ngModel]="loginPassword()"
              (ngModelChange)="loginPassword.set($event)"
              required
              placeholder="e.g., admin-password"
              class="form-control"
              [attr.aria-invalid]="
                loginForm.controls['password']?.invalid && loginForm.controls['password']?.touched
                  ? 'true'
                  : null
              "
              aria-describedby="password-error"
            />
            <span
              id="password-error"
              class="text-rose-400 text-[10px]"
              [style.display]="
                loginForm.controls['password']?.invalid && loginForm.controls['password']?.touched
                  ? 'block'
                  : 'none'
              "
            >
              Password is required.
            </span>
          </div>

          <button
            type="submit"
            class="btn btn-submit w-full mt-2 py-3 text-xs tracking-wide uppercase font-black"
            [disabled]="loginForm.invalid || isSubmitting()"
          >
            {{ isSubmitting() ? 'Processing...' : isRegisterMode() ? 'Register' : 'Sign In' }}
          </button>
        </form>

        <div class="mt-4 text-center">
          <button
            type="button"
            class="text-xs text-gold font-bold hover:text-white"
            (click)="toggleMode()"
          >
            {{
              isRegisterMode() ? 'Already have an account? Sign In' : 'Need an account? Register'
            }}
          </button>
        </div>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class AuthModalComponent {
  private readonly appointmentService = inject(AppointmentService);
  private readonly authState = inject(AuthState);
  private readonly store = inject(AppointmentStore);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  /** Emitted when the modal should be closed (X button or Escape key). */
  readonly close = output<void>();
  /** Emitted after a successful login with the user's role. */
  readonly loginSuccess = output<string>();

  // Form state
  readonly loginUsername = signal('');
  readonly loginPassword = signal('');
  readonly isRegisterMode = signal(false);
  readonly registerFullName = signal('');
  readonly registerPhone = signal('');

  // Feedback state
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly isSubmitting = signal(false);

  /** Handle login submission (or delegates to onRegister when in register mode). */
  onLogin(): void {
    if (this.isRegisterMode()) {
      this.onRegister();
      return;
    }

    const user = this.loginUsername().trim();
    const pass = this.loginPassword().trim();

    if (!user || !pass) {
      this.errorMessage.set('Email and password are required.');
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    this.appointmentService
      .login(user, pass)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.authState.applyRole(response.role);
          this.store.isLoggedIn.set(true);
          this.isSubmitting.set(false);
          this.errorMessage.set(null);

          this.loginUsername.set('');
          this.loginPassword.set('');

          this.loginSuccess.emit(response.role);
          this.close.emit();
        },
        error: (err) => {
          this.errorMessage.set('Invalid credentials. Please try again.');
          this.isSubmitting.set(false);
          console.error('Authentication error:', err);
        },
      });
  }

  /** Handle registration submission. */
  onRegister(): void {
    const email = this.loginUsername().trim();
    const pass = this.loginPassword().trim();
    const name = this.registerFullName().trim();
    const phone = this.registerPhone().trim();

    if (!email || !pass || !name) {
      this.errorMessage.set('Name, email, and password are required.');
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    this.appointmentService
      .register({ email, password: pass, fullName: name, phone })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isRegisterMode.set(false);
          this.isSubmitting.set(false);
          this.successMessage.set('Account created! You can now log in.');
          this.errorMessage.set(null);
        },
        error: (err) => {
          this.errorMessage.set(err.error?.message || 'Failed to create account.');
          this.isSubmitting.set(false);
        },
      });
  }

  /** Switch between login and register mode. */
  toggleMode(): void {
    this.isRegisterMode.set(!this.isRegisterMode());
    this.errorMessage.set(null);
    this.successMessage.set(null);
  }

  /** User-requested close (X button or Escape). */
  closeModal(): void {
    this.close.emit();
  }
}
