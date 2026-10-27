import { Injectable, computed, inject } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { NotificationItem } from '../../types/api';
import { NotificationsApi } from '../../core/api/notifications-api';
import { safeResourceValue } from '../../core/resource-utils';
import { notificationOutboxResponseListSchema } from '@taskflow/schemas';

@Injectable({ providedIn: 'root' })
export class NotificationStore {
  private readonly notificationsApi = inject(NotificationsApi);

  private readonly notificationsResource = httpResource<NotificationItem[]>(
    () => this.notificationsApi.listUrl,
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

  loadNotifications(): void {
    this.notificationsResource.reload();
  }
}
