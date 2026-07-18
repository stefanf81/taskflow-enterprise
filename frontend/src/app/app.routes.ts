import { Component } from '@angular/core';
import { Routes } from '@angular/router';
import { authGuard } from './auth.guard';

/** Empty landing component — the root App template IS the landing page. */
@Component({ template: '', standalone: true })
class AppShell {}

export const routes: Routes = [
  { path: '', pathMatch: 'full', component: AppShell },
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
