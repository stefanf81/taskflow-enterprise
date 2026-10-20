import { describe, it, expect } from 'vitest';
import { routes } from './app.routes';
import { DashboardPrefetch, loadAdminDashboard, loadCustomerPortal } from './dashboard-loaders';
import { AdminDashboard } from './features/admin/admin-dashboard';
import { CustomerPortal } from './features/customer/customer-portal';

describe('dashboard loaders', () => {
  it('are the loaders the routes use, so a prefetch warms the chunk the router loads', () => {
    expect(routes.find((r) => r.path === 'admin')?.loadComponent).toBe(loadAdminDashboard);
    expect(routes.find((r) => r.path === 'customer')?.loadComponent).toBe(loadCustomerPortal);
  });

  it('resolve the dashboard components', async () => {
    expect(await loadAdminDashboard()).toBe(AdminDashboard);
    expect(await loadCustomerPortal()).toBe(CustomerPortal);
  });

  it('prefetch can be called repeatedly without throwing', () => {
    const prefetch = new DashboardPrefetch();
    expect(() => {
      prefetch.prefetch();
      prefetch.prefetch();
    }).not.toThrow();
  });
});
