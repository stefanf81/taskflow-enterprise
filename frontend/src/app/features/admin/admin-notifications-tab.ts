import { Component, inject } from '@angular/core';
import { formatDateTime } from '../../core/format';
import { NotificationStore } from './notification.store';
import { Button } from '../../core/ui/button';
import { EmptyState } from '../../core/ui/empty-state';
import { StatusBadge } from '../../core/ui/status-badge';

/** Owner dashboard · notification outbox tab. */
@Component({
  selector: 'app-admin-notifications-tab',
  imports: [Button, EmptyState, StatusBadge],
  templateUrl: './admin-notifications-tab.html',
})
export class AdminNotificationsTab {
  private readonly notificationStore = inject(NotificationStore);

  protected readonly notificationsList = this.notificationStore.notifications;
  readonly isLoading = this.notificationStore.isLoading;
  protected readonly loadError = this.notificationStore.errorMessage;

  protected readonly formatDateTime = formatDateTime;

  protected retryLoad(): void {
    this.notificationStore.loadNotifications();
  }
}
