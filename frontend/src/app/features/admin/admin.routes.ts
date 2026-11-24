import { Routes } from '@angular/router';

/**
 * The owner dashboard's sections, children of `/admin`. Each is its own chunk and its own URL, so a
 * reload or the Back button keeps the owner where they were. A file of its own (loaded with the
 * dashboard shell) so the route config does not ride in `main.js`.
 */
export const ADMIN_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'appointments' },
  {
    path: 'appointments',
    loadComponent: () => import('./admin-appointments-tab').then((m) => m.AdminAppointmentsTab),
    title: 'Appointments — TaskFlow Owner',
  },
  {
    path: 'calendar',
    loadComponent: () => import('./admin-calendar-tab').then((m) => m.AdminCalendarTab),
    title: 'Calendar — TaskFlow Owner',
  },
  {
    path: 'services',
    loadComponent: () => import('./admin-services-tab').then((m) => m.AdminServicesTab),
    title: 'Service Catalog — TaskFlow Owner',
  },
  {
    path: 'schedules',
    loadComponent: () => import('./admin-schedules-tab').then((m) => m.AdminSchedulesTab),
    title: 'Schedules & Time-Off — TaskFlow Owner',
  },
  {
    path: 'notifications',
    loadComponent: () => import('./admin-notifications-tab').then((m) => m.AdminNotificationsTab),
    title: 'Notification Outbox — TaskFlow Owner',
  },
];
