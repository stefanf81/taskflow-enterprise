import {
  Component,
  output,
  signal,
  inject,
  DestroyRef,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  isDevMode,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { form, required, FormField } from '@angular/forms/signals';
import { Router } from '@angular/router';
import { AppointmentService } from '../../appointment.service';
import { AuthState } from '../../auth.state';
import { AppointmentStore } from '../../appointment.store';

/** Model shape for the Signal Forms login / register wizard. */
interface AuthFormModel {
  username: string;
  password: string;
  fullName: string;
  phone: string;
}

/**
 * Standalone Login / Register modal component.
 *
 * Displays an overlay dialog with sign-in and create-account forms.
 * Designed for @defer lazy-loading since the modal only appears on-demand
 * when the user clicks "Owner Portal".
 *
 * Migrated to Angular 22 Signal Forms (`@angular/forms/signals`) to match
 * the booking wizard in `app.ts`: a single signal-backed model is bound to
 * the form via `[formRoot]` and each input via `[formField]`, replacing the
 * legacy template-driven `FormsModule` + `ngModel` + `#form="ngForm"` pattern.
 */
@Component({
  selector: 'app-auth-modal',
  standalone: true,
  imports: [CommonModule, FormField],
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

        <form (submit)="$event.preventDefault(); onLogin()" class="space-y-4">
          @if (isRegisterMode()) {
            <div class="form-group flex flex-col gap-1.5">
              <label for="regName" class="text-xs font-bold text-zinc-500 uppercase tracking-wider"
                >Full Name</label
              >
              <input
                type="text"
                id="regName"
                [formField]="authForm.fullName"
                placeholder="John Doe"
                class="form-control"
                [attr.aria-invalid]="
                  isRegisterMode() && authForm.fullName().touched() && !authModel().fullName.trim()
                    ? 'true'
                    : null
                "
                aria-describedby="regName-error"
              />
              @if (authForm.fullName().touched() && !authModel().fullName.trim()) {
                <span id="regName-error" class="text-rose-400 text-[10px]">
                  Full name is required.
                </span>
              }
            </div>
            <div class="form-group flex flex-col gap-1.5">
              <label for="regPhone" class="text-xs font-bold text-zinc-500 uppercase tracking-wider"
                >Phone</label
              >
              <input
                type="text"
                id="regPhone"
                [formField]="authForm.phone"
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
              [formField]="authForm.username"
              placeholder="e.g., admin"
              class="form-control"
              [attr.aria-invalid]="
                authForm.username().touched() && authForm.username().invalid() ? 'true' : null
              "
              aria-describedby="username-error"
            />
            @if (authForm.username().touched() && authForm.username().invalid()) {
              <span id="username-error" class="text-rose-400 text-[10px]">
                Username is required.
              </span>
            }
          </div>

          <div class="form-group flex flex-col gap-1.5">
            <label for="password" class="text-xs font-bold text-zinc-500 uppercase tracking-wider"
              >Password</label
            >
            <input
              type="password"
              id="password"
              [formField]="authForm.password"
              placeholder="e.g., admin-password"
              class="form-control"
              [attr.aria-invalid]="
                authForm.password().touched() && authForm.password().invalid() ? 'true' : null
              "
              aria-describedby="password-error"
            />
            @if (authForm.password().touched() && authForm.password().invalid()) {
              <span id="password-error" class="text-rose-400 text-[10px]">
                Password is required.
              </span>
            }
          </div>

          <button
            type="submit"
            class="btn btn-submit w-full mt-2 py-3 text-xs tracking-wide uppercase font-black"
            [disabled]="isSubmitting()"
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

  // Form state — a single signal-backed model bound to the Signal Form.
  // The previous pattern used four separate signals (`loginUsername`,
  // `loginPassword`, `registerFullName`, `registerPhone`) plus a separate
  // `#loginForm="ngForm"` template ref for validity ARIA. Signal Forms
  // replaces all of that with one model + computed form-level validation.
  readonly authModel = signal<AuthFormModel>({
    username: '',
    password: '',
    fullName: '',
    phone: '',
  });

  readonly authForm = form(this.authModel, (f) => {
    required(f.username);
    required(f.password);
  });

  // UI / mode toggle state (not bound to the form model).
  readonly isRegisterMode = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly isSubmitting = signal(false);

  /** Handle login submission (or delegates to onRegister when in register mode). */
  onLogin(): void {
    if (this.isRegisterMode()) {
      this.onRegister();
      return;
    }

    const user = this.authModel().username.trim();
    const pass = this.authModel().password.trim();

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
          this.isSubmitting.set(false);
          this.errorMessage.set(null);

          this.authModel.set({ username: '', password: '', fullName: '', phone: '' });

          this.loginSuccess.emit(response.role);
          this.close.emit();
        },
        error: (err) => {
          this.errorMessage.set('Invalid credentials. Please try again.');
          this.isSubmitting.set(false);
          // Verbose error logging only in dev builds to avoid leaking backend
          // error details into the production browser console.
          if (isDevMode()) {
            console.error('Authentication error:', err);
          }
        },
      });
  }

  /** Handle registration submission. */
  onRegister(): void {
    const email = this.authModel().username.trim();
    const pass = this.authModel().password.trim();
    const name = this.authModel().fullName.trim();
    const phone = this.authModel().phone.trim();

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
