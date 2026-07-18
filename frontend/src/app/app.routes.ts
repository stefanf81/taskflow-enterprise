import { Routes } from '@angular/router';
import { adminGuard } from './guards/admin.guard';
import { authGuard } from './guards/auth.guard';
import { NotFound } from './pages/not-found/not-found';

export const routes: Routes = [
  {
    path: '',
    title: 'TaskFlow Pro — Luxury Barber Scheduler',
    loadComponent: () => import('./pages/home/home').then((m) => m.Home),
  },
  {
    path: 'booking',
    title: 'Book an Appointment — TaskFlow Pro',
    loadComponent: () => import('./pages/booking/booking').then((m) => m.Booking),
  },
  {
    path: 'login',
    title: 'Owner Portal — TaskFlow Pro',
    loadComponent: () => import('./pages/login/login').then((m) => m.Login),
  },
  {
    path: 'faq',
    title: 'FAQ — TaskFlow Pro',
    loadComponent: () => import('./pages/faq/faq').then((m) => m.Faq),
  },
  {
    path: 'reviews',
    title: 'Reviews — TaskFlow Pro',
    loadComponent: () => import('./pages/reviews/reviews').then((m) => m.Reviews),
  },
  {
    path: 'admin',
    canMatch: [adminGuard],
    title: 'Admin Dashboard — TaskFlow Pro',
    loadComponent: () => import('./pages/admin/admin').then((m) => m.Admin),
  },
  {
    path: 'customer',
    canMatch: [authGuard],
    title: 'My Appointments — TaskFlow Pro',
    loadComponent: () => import('./pages/customer/customer').then((m) => m.Customer),
  },
  { path: '**', title: 'Not Found — TaskFlow Pro', component: NotFound },
];
