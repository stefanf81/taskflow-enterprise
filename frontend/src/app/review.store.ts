import { Injectable, inject, signal } from '@angular/core';
import { TodoService, BarberRating, ReviewRequest } from './todo.service';
import { catchError } from 'rxjs/operators';
import { of } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class ReviewStore {
  private readonly todoService = inject(TodoService);

  readonly ratings = signal<BarberRating[]>([]);
  readonly isLoading = signal<boolean>(false);
  readonly errorMessage = signal<string | null>(null);

  loadRatings(): void {
    this.isLoading.set(true);
    this.todoService
      .getBarberRatings()
      .pipe(
        catchError((err) => {
          console.error('Failed to load barber ratings:', err);
          this.errorMessage.set('Could not load barber ratings.');
          this.isLoading.set(false);
          return of([]);
        }),
      )
      .subscribe((data) => {
        this.ratings.set(data);
        this.isLoading.set(false);
      });
  }
}
