import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NotificationStore } from './notification.store';

/** Owner dashboard · notification outbox tab. */
@Component({
  selector: 'app-admin-notifications-tab',
  imports: [CommonModule],
  templateUrl: './admin-notifications-tab.html',
})
export class AdminNotificationsTab {
  private readonly notificationStore = inject(NotificationStore);

  protected readonly notificationsList = this.notificationStore.notifications;
  readonly isLoading = this.notificationStore.isLoading;
  protected readonly loadError = this.notificationStore.errorMessage;

  protected retryLoad(): void {
    this.notificationStore.loadNotifications();
  }
}
