import { Component, effect, inject } from '@angular/core';
import { Router, RouterLink, Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { AuthState } from './core/auth/auth.state';
import { loadAdminDashboard, loadCustomerPortal } from './dashboard-loaders';
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
        class="text-accent text-sm font-bold uppercase tracking-wider hover:underline"
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
    effect(() => {
      const role = this.auth.role();
      if (role === 'ROLE_ADMIN' || role === 'ROLE_CUSTOMER') {
        void this.router.navigateByUrl(this.auth.dashboardPathFor(role), { replaceUrl: true });
      }
      // Guests stay on the 404 page
    });
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
    loadComponent: loadAdminDashboard,
    title: 'Owner Dashboard — TaskFlow',
    // One URL per section, each its own chunk: a reload or Back keeps the owner where they were.
    // The guard on the parent covers the children; an unknown /admin/… falls through to the 404.
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'appointments' },
      {
        path: 'appointments',
        loadComponent: () =>
          import('./features/admin/admin-appointments-tab').then((m) => m.AdminAppointmentsTab),
        title: 'Appointments — TaskFlow Owner',
      },
      {
        path: 'calendar',
        loadComponent: () =>
          import('./features/admin/admin-calendar-tab').then((m) => m.AdminCalendarTab),
        title: 'Calendar — TaskFlow Owner',
      },
      {
        path: 'services',
        loadComponent: () =>
          import('./features/admin/admin-services-tab').then((m) => m.AdminServicesTab),
        title: 'Service Catalog — TaskFlow Owner',
      },
      {
        path: 'schedules',
        loadComponent: () =>
          import('./features/admin/admin-schedules-tab').then((m) => m.AdminSchedulesTab),
        title: 'Schedules & Time-Off — TaskFlow Owner',
      },
      {
        path: 'notifications',
        loadComponent: () =>
          import('./features/admin/admin-notifications-tab').then((m) => m.AdminNotificationsTab),
        title: 'Notification Outbox — TaskFlow Owner',
      },
    ],
  },
  {
    path: 'customer',
    canActivate: [authGuard],
    loadComponent: loadCustomerPortal,
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
