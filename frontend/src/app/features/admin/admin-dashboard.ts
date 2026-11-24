import { Component, inject, DestroyRef } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { asyncScheduler, filter, map, throttleTime } from 'rxjs';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { injectSignOut } from '../../core/auth/sign-out';
import { FlashMessages } from '../../core/ui/flash-messages';
import { Alert } from '../../core/ui/alert';
import { Button } from '../../core/ui/button';
import { Icon } from '../../core/ui/icon';
import { bellIcon } from '../../core/ui/icons/bell';
import { circleCheckIcon } from '../../core/ui/icons/circle-check';
import { listChecksIcon } from '../../core/ui/icons/list-checks';
import { scissorsIcon } from '../../core/ui/icons/scissors';
import { usersIcon } from '../../core/ui/icons/users';
import { PageHeader } from '../../core/ui/page-header';
import { AppointmentStore } from './appointment.store';
import { AdminEventsService } from './admin-events.service';

/** One section of the owner dashboard: its URL under `/admin`, label and icon. */
export interface AdminSection {
  path: string;
  label: string;
  icon: string;
}

/**
 * Lazy-loaded Owner dashboard shell (route: /admin).
 *
 * Owns the dashboard chrome (alerts, section navigation, logout, SSE stream); each section is a
 * lazy child route with its own URL. All shared state lives in the injectable singleton stores.
 */
/** Window in which a burst of appointment events is coalesced into at most two refreshes. */
export const REFRESH_THROTTLE_MS = 300;

@Component({
  selector: 'app-admin-dashboard',
  imports: [Alert, Button, Icon, PageHeader, RouterLink, RouterOutlet],
  templateUrl: './admin-dashboard.html',
})
export class AdminDashboard {
  private readonly store = inject(AppointmentStore);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly adminEvents = inject(AdminEventsService);
  private readonly flash = inject(FlashMessages);
  private readonly signOut = injectSignOut();
  protected readonly icons = { circleCheck: circleCheckIcon };

  /** The sections, in the order of the navigation. The labels are what the owner already knew. */
  protected readonly sections: readonly AdminSection[] = [
    { path: '/admin/appointments', label: 'Appointments', icon: listChecksIcon },
    { path: '/admin/services', label: 'Service Catalog', icon: scissorsIcon },
    { path: '/admin/schedules', label: 'Schedules & Time-Off', icon: usersIcon },
    { path: '/admin/notifications', label: 'Notification Outbox', icon: bellIcon },
  ];

  /**
   * The URL the router is on, without query or fragment. Not `RouterLinkActive`: using it here
   * pulled more router code into main.js (+3 kB).
   */
  private readonly currentPath = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects.split(/[?#]/)[0] ?? ''),
    ),
    { initialValue: this.router.url.split(/[?#]/)[0] ?? '' },
  );

  /** Whether `path` is the section on screen (a deeper URL under it counts). */
  protected isCurrent(path: string): boolean {
    const current = this.currentPath();
    return current === path || current.startsWith(`${path}/`);
  }

  protected readonly errorMessage = this.flash.errorMessage;
  protected readonly successMessage = this.flash.successMessage;

  constructor() {
    // Every event, and every catch-up after the stream reconnects, refetches the list.
    // store.refreshWhenIdle() lets a load already in flight finish and then loads once more, so a
    // steady stream of events never keeps cancelling it. A burst (time off cancelling many
    // bookings sends one event each) is coalesced: the first event refreshes at once, the rest
    // of the burst in one trailing refresh per window.
    this.adminEvents.appointmentChanges
      .pipe(
        throttleTime(REFRESH_THROTTLE_MS, asyncScheduler, { leading: true, trailing: true }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.store.refreshWhenIdle());
    this.adminEvents.connect();
    this.destroyRef.onDestroy(() => this.adminEvents.close());
  }

  /** Navigates away only once the server confirmed the sign-out; on failure the error banner shows. */
  async onLogout(): Promise<void> {
    if (await this.signOut()) {
      await this.router.navigateByUrl('');
    }
  }
}
