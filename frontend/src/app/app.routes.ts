import { Component, inject } from '@angular/core';
import { Router, RouterLink, Routes } from '@angular/router';
import { authGuard } from './auth.guard';
import { AuthState } from './auth.state';

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
    loadComponent: () => import('./features/landing/landing-page').then((m) => m.LandingPage),
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
  { path: '**', component: NotFoundComponent, title: 'Not Found — TaskFlow' },
];
