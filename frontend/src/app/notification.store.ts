import { Injectable, inject, signal } from '@angular/core';
import { AppointmentService, NotificationItem } from './appointment.service';
import { catchError } from 'rxjs/operators';
import { of } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class NotificationStore {
  private readonly appointmentService = inject(AppointmentService);

  readonly notifications = signal<NotificationItem[]>([]);
  readonly isLoading = signal<boolean>(false);
  readonly errorMessage = signal<string | null>(null);

  loadNotifications(): void {
    this.isLoading.set(true);
    this.appointmentService
      .getNotifications()
      .pipe(
        catchError((err) => {
          console.error('Failed to load notifications:', err);
          this.errorMessage.set('Could not load notification outbox.');
          this.isLoading.set(false);
          return of([]);
        }),
      )
      .subscribe((data) => {
        this.notifications.set(data);
        this.isLoading.set(false);
      });
  }
}
