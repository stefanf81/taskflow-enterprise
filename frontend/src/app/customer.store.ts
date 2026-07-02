import { Injectable, inject, signal } from '@angular/core';
import { TodoService, AppointmentItem } from './todo.service';
import { catchError } from 'rxjs/operators';
import { of } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class CustomerStore {
  private readonly todoService = inject(TodoService);

  readonly appointments = signal<AppointmentItem[]>([]);
  readonly totalPages = signal<number>(1);
  readonly currentPage = signal<number>(0);

  readonly isLoading = signal<boolean>(false);
  readonly errorMessage = signal<string | null>(null);

  loadAppointments(): void {
    this.isLoading.set(true);
    this.todoService
      .getCustomerAppointments(this.currentPage(), 10)
      .pipe(
        catchError((err) => {
          console.error('Failed to load customer appointments:', err);
          this.errorMessage.set('Could not load your appointments.');
          this.isLoading.set(false);
          return of({ content: [], totalPages: 1 });
        }),
      )
      .subscribe((data) => {
        this.appointments.set(data.content);
        this.totalPages.set(data.totalPages);
        this.isLoading.set(false);
      });
  }

  cancelAppointment(id: number): void {
    if (!confirm('Are you sure you want to cancel this appointment?')) return;

    this.isLoading.set(true);
    this.todoService.cancelCustomerAppointment(id).subscribe({
      next: () => {
        this.loadAppointments();
      },
      error: (err) => {
        console.error('Failed to cancel appointment:', err);
        this.errorMessage.set('Failed to cancel appointment.');
        this.isLoading.set(false);
      },
    });
  }
}
