import { Injectable, inject, signal } from '@angular/core';
import { TodoService, NotificationItem } from './todo.service';
import { catchError } from 'rxjs/operators';
import { of } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class NotificationStore {
  private readonly todoService = inject(TodoService);

  readonly notifications = signal<NotificationItem[]>([]);
  readonly isLoading = signal<boolean>(false);
  readonly errorMessage = signal<string | null>(null);

  loadNotifications(): void {
    this.isLoading.set(true);
    this.todoService.getNotifications()
      .pipe(
        catchError(err => {
          console.error('Failed to load notifications:', err);
          this.errorMessage.set('Could not load notification outbox.');
          this.isLoading.set(false);
          return of([]);
        })
      )
      .subscribe(data => {
        this.notifications.set(data);
        this.isLoading.set(false);
      });
  }
}
