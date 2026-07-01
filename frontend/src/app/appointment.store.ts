import { Injectable, inject, signal } from '@angular/core';
import { TodoService, AppointmentItem, AppointmentStats } from './todo.service';
import { catchError } from 'rxjs/operators';
import { of } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class AppointmentStore {
  private readonly todoService = inject(TodoService);

  // Authentication State
  readonly isLoggedIn = signal<boolean>(!!sessionStorage.getItem('auth_token'));

  // Core Admin Reactive States (Signals)
  readonly appointments = signal<AppointmentItem[]>([]);
  readonly stats = signal<AppointmentStats>({ total: 0, pending: 0, approved: 0, denied: 0, overdue: 0, progress: 0, approvedRevenue: 0 });

  // Pagination State (Signals)
  readonly currentPage = signal<number>(0);
  readonly totalPages = signal<number>(1);
  readonly totalElements = signal<number>(0);
  readonly pageSize = 50;

  // Alerts & Loading State (Signals)
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly isSubmitting = signal<boolean>(false);
  readonly isCheckingSlots = signal<boolean>(false);
  readonly busySlots = signal<string[]>([]);

  // Load Paginated Bookings from Backend (Admin Only)
  loadAppointments(selectedFilter: string, searchQuery: string): void {
    if (!this.isLoggedIn()) return;

    this.todoService.getAllAppointments(selectedFilter, searchQuery, this.currentPage(), this.pageSize)
      .pipe(
        catchError(err => {
          if (err.status === 401) {
            this.onLogout();
            this.errorMessage.set('Session expired. Please log in again.');
          } else {
            this.errorMessage.set('Could not connect to the backend server. Please ensure the Spring Boot API is running.');
          }
          console.error('API Error:', err);
          return of({
            page: { content: [], totalPages: 1, totalElements: 0, size: this.pageSize, number: 0 },
            stats: { total: 0, pending: 0, approved: 0, denied: 0, overdue: 0, progress: 0, approvedRevenue: 0 }
          });
        })
      )
      .subscribe(data => {
        this.appointments.set(data.page.content);
        this.stats.set(data.stats);
        this.totalPages.set(data.page.totalPages);
        this.totalElements.set(data.page.totalElements);
        
        if (data.page.content.length > 0 && this.errorMessage() && this.errorMessage()!.startsWith('Could not connect')) {
          this.errorMessage.set(null);
        }
      });
  }

  // Handle Admin Logout
  onLogout(): void {
    sessionStorage.removeItem('auth_token');
    this.isLoggedIn.set(false);
    this.appointments.set([]);
    this.stats.set({ total: 0, pending: 0, approved: 0, denied: 0, overdue: 0, progress: 0, approvedRevenue: 0 });
    this.errorMessage.set(null);
  }
}
