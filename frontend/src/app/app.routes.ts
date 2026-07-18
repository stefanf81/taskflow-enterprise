import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'admin',
    loadComponent: () => import('./features/admin/admin-dashboard').then((m) => m.AdminDashboard),
  },
  {
    path: 'customer',
    loadComponent: () =>
      import('./features/customer/customer-portal').then((m) => m.CustomerPortal),
  },
  { path: '**', redirectTo: '' },
];
