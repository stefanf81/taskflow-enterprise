import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { merge } from 'rxjs';
import { AuthState } from '../../core/auth/auth.state';
import { NotificationItem } from '../../types/api';
import { NotificationsApi } from '../../core/api/notifications-api';
import { refreshResource, safeResourceValue } from '../../core/resource-utils';
import { SessionEvents } from '../../core/session-events';
import { notificationOutboxResponseListSchema } from '@taskflow/schemas';

@Injectable({ providedIn: 'root' })
export class NotificationStore {
  private readonly notificationsApi = inject(NotificationsApi);
  private readonly authState = inject(AuthState);
  private readonly sessionEvents = inject(SessionEvents);
  private readonly destroyRef = inject(DestroyRef);
  private readonly refreshTick = signal(0);

  private readonly notificationsResource = httpResource<NotificationItem[]>(
    () => {
      if (!this.authState.isLoggedIn() || this.authState.role() !== 'ROLE_ADMIN') {
        return undefined;
      }
      this.refreshTick();
      return { url: this.notificationsApi.listUrl };
    },
    {
      defaultValue: [],
      parse: (raw) => notificationOutboxResponseListSchema.parse(raw),
    },
  );

  /** Error-safe: an empty list (never a throw) while loading or after a failed load. */
  readonly notifications = safeResourceValue<NotificationItem[]>(this.notificationsResource, []);
  readonly isLoading = this.notificationsResource.isLoading;
  readonly errorMessage = computed(() => {
    const err = this.notificationsResource.error();
    return err ? 'Could not load notification outbox.' : null;
  });

  constructor() {
    merge(this.sessionEvents.sessionEnded, this.sessionEvents.sessionStarted)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.notificationsResource.set([]);
        this.refreshTick.update((n) => n + 1);
      });
  }

  loadNotifications(): void {
    refreshResource(this.notificationsResource, this.refreshTick);
  }
}
