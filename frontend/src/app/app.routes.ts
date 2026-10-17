import { Component, inject } from '@angular/core';
import { Router, RouterLink, Routes } from '@angular/router';
import { authGuard } from './auth.guard';
import { AuthState } from './auth.state';
import { LandingPage } from './features/landing/landing-page';

/**
 * 404 handler: redirects authenticated users to their dashboard,
 * shows a minimal "not found" message for guests.
 */
@Component({
  template: `
    <div class="flex flex-col items-center justify-center min-h-[50vh] text-center px-4">
      <h1 class="text-4xl font-black text-zinc-100 mb-4">404</h1>
      <p class="text-zinc-400 text-sm mb-8">The page you're looking for doesn't exist.</p>
      <a
        routerLink="/"
        class="text-gold text-sm font-bold uppercase tracking-wider hover:underline"
      >
        Go Home
      </a>
    </div>
  `,
  imports: [RouterLink],
})
class NotFoundComponent {
  private readonly auth = inject(AuthState);
  private readonly router = inject(Router);

  constructor() {
    const role = this.auth.role();
    if (role === 'ROLE_ADMIN') {
      this.router.navigateByUrl('/admin');
    } else if (role === 'ROLE_CUSTOMER') {
      this.router.navigateByUrl('/customer');
    }
    // Guests stay on the 404 page
  }
}

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    // Eager on purpose: the guest landing page is the entry route, and lazy-loading it made the
    // browser discover its chunk (and the booking/forms chunks it imports) only after main.js ran,
    // two extra round trips before first paint (-376 ms FCP on slow 4G when eager).
    component: LandingPage,
    title: 'TaskFlow — Premium Barber Booking',
  },
  {
    path: 'admin',
    canActivate: [authGuard],
    loadComponent: () => import('./features/admin/admin-dashboard').then((m) => m.AdminDashboard),
    title: 'Owner Dashboard — TaskFlow',
  },
  {
    path: 'customer',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/customer/customer-portal').then((m) => m.CustomerPortal),
    title: 'My Appointments — TaskFlow',
  },
  {
    // Booking flow for signed-in customers. Under /customer so authGuard keeps it
    // customer-only; unlike '/', it does not redirect the customer to their dashboard.
    path: 'customer/book',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/customer/customer-booking').then((m) => m.CustomerBooking),
    title: 'Book an Appointment — TaskFlow',
  },
  { path: '**', component: NotFoundComponent, title: 'Not Found — TaskFlow' },
];
