import { Routes } from '@angular/router';
import { authGuard } from './auth.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./app').then((m) => m.App),
  },
  {
    path: 'admin',
    canActivate: [authGuard],
    loadComponent: () => import('./features/admin/admin-dashboard').then((m) => m.AdminDashboard),
  },
  {
    path: 'customer',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/customer/customer-portal').then((m) => m.CustomerPortal),
  },
  { path: '**', redirectTo: '' },
];
