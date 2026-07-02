import { Injectable, inject, signal } from '@angular/core';
import { TodoService, Barber, BarberTimeOff } from './todo.service';
import { catchError } from 'rxjs/operators';
import { of } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class BarberStore {
  private readonly todoService = inject(TodoService);

  readonly barbers = signal<Barber[]>([]);
  readonly timeOffs = signal<BarberTimeOff[]>([]);
  readonly selectedBarberId = signal<number | null>(null);

  readonly isLoading = signal<boolean>(false);
  readonly errorMessage = signal<string | null>(null);

  loadBarbers(): void {
    this.isLoading.set(true);
    this.todoService
      .getAllBarbers()
      .pipe(
        catchError((err) => {
          console.error('Failed to load barbers:', err);
          this.errorMessage.set('Could not load barbers.');
          this.isLoading.set(false);
          return of([]);
        }),
      )
      .subscribe((data) => {
        this.barbers.set(data);
        this.isLoading.set(false);
        if (data.length > 0 && !this.selectedBarberId()) {
          this.selectBarber(data[0].id);
        }
      });
  }

  selectBarber(id: number): void {
    this.selectedBarberId.set(id);
    this.loadTimeOffs(id);
  }

  loadTimeOffs(barberId: number): void {
    this.isLoading.set(true);
    this.todoService
      .getTimeOff(barberId)
      .pipe(
        catchError((err) => {
          console.error('Failed to load time off:', err);
          this.errorMessage.set('Could not load time off.');
          this.isLoading.set(false);
          return of([]);
        }),
      )
      .subscribe((data) => {
        this.timeOffs.set(data);
        this.isLoading.set(false);
      });
  }

  addTimeOff(request: BarberTimeOff): void {
    const barberId = this.selectedBarberId();
    if (!barberId) return;

    this.isLoading.set(true);
    this.todoService.addTimeOff(barberId, request).subscribe({
      next: () => {
        this.loadTimeOffs(barberId);
      },
      error: (err) => {
        console.error('Failed to add time off:', err);
        this.errorMessage.set('Failed to add time off.');
        this.isLoading.set(false);
      },
    });
  }
}
