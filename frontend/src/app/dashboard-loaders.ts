import { Injectable } from '@angular/core';

/*
 * The dashboard chunks, shared by the lazy routes (app.routes.ts) and the login-modal prefetch.
 * Both go through the same dynamic import, so the prefetched chunk is the one the router loads
 * (same file, same import-map SRI hash, evaluated once).
 */
export const loadAdminDashboard = () =>
  import('./features/admin/admin-dashboard').then((m) => m.AdminDashboard);

export const loadCustomerPortal = () =>
  import('./features/customer/customer-portal').then((m) => m.CustomerPortal);

/**
 * Downloads both dashboard chunks once the login modal opens. A successful login navigates
 * straight to a dashboard, which otherwise waited one more round trip for its chunk after the
 * login response. The role is unknown until then, so both are fetched (~15 kB transfer); guests
 * who never open the modal download neither.
 */
@Injectable({ providedIn: 'root' })
export class DashboardPrefetch {
  private started = false;

  prefetch(): void {
    if (this.started) return;
    this.started = true;
    // A failed prefetch is not an error: the route load requests the chunk again.
    void Promise.allSettled([loadAdminDashboard(), loadCustomerPortal()]);
  }
}
