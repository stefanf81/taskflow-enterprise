import { Component, inject } from '@angular/core';
import { formatDateTime } from '../../core/format';
import { NotificationStore } from './notification.store';

/** Owner dashboard · notification outbox tab. */
@Component({
  selector: 'app-admin-notifications-tab',
  imports: [],
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
