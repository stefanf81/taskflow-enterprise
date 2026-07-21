import { Injectable, computed } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { NotificationItem } from './appointment.service';

@Injectable({ providedIn: 'root' })
export class NotificationStore {
  private readonly notificationsResource = httpResource<NotificationItem[]>(
    () => '/api/v1/notifications',
    {
      defaultValue: [],
    },
  );

  readonly notifications = this.notificationsResource.value;
  readonly isLoading = this.notificationsResource.isLoading;
  readonly errorMessage = computed(() => {
    const err = this.notificationsResource.error();
    return err ? 'Could not load notification outbox.' : null;
  });

  loadNotifications(): void {
    this.notificationsResource.reload();
  }
}
