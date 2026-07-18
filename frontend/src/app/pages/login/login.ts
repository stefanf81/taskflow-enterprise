import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AppointmentService } from '../../appointment.service';
import { AppointmentStore } from '../../appointment.store';
import { AuthStore } from '../../auth.store';

/**
 * Authentication page (lazy-loaded). Renders as a full-screen modal overlay.
 * On success it routes to the admin or customer dashboard based on the role.
 */
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './login.html',
})
export class Login {
  private readonly appointmentService = inject(AppointmentService);
  private readonly store = inject(AppointmentStore);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);

  readonly errorMessage = this.store.errorMessage;
  readonly isSubmitting = this.store.isSubmitting;

  isRegisterMode = false;
  loginUsername = '';
  loginPassword = '';
  registerFullName = '';
  registerPhone = '';

  onLogin(): void {
    if (this.isRegisterMode) {
      this.onRegister();
      return;
    }

    const user = this.loginUsername.trim();
    const pass = this.loginPassword.trim();

    if (!user || !pass) {
      this.errorMessage.set('Email and password are required.');
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    this.appointmentService.login(user, pass).subscribe({
      next: (response) => {
        this.auth.setSession(response.token, response.role);
        this.isSubmitting.set(false);
        this.errorMessage.set(null);
        this.loginUsername = '';
        this.loginPassword = '';

        if (response.role === 'ROLE_ADMIN') {
          this.router.navigate(['/admin']);
        } else {
          this.router.navigate(['/customer']);
        }
      },
      error: () => {
        this.errorMessage.set('Invalid credentials. Please try again.');
        this.isSubmitting.set(false);
      },
    });
  }

  onRegister(): void {
    const email = this.loginUsername.trim();
    const pass = this.loginPassword.trim();
    const name = this.registerFullName.trim();
    const phone = this.registerPhone.trim();

    if (!email || !pass || !name) {
      this.errorMessage.set('Name, email, and password are required.');
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    this.appointmentService.register({ email, password: pass, fullName: name, phone }).subscribe({
      next: () => {
        this.isRegisterMode = false;
        this.isSubmitting.set(false);
        this.errorMessage.set('Account created! You can now log in.');
      },
      error: (err) => {
        this.errorMessage.set(err.error?.message || 'Failed to create account.');
        this.isSubmitting.set(false);
      },
    });
  }

  close(): void {
    this.router.navigate(['/']);
  }
}
