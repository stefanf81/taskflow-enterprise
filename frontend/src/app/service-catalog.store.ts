import { Injectable, inject, signal } from '@angular/core';
import { TodoService, ServiceItem, ServiceItemRequest } from './todo.service';
import { catchError } from 'rxjs/operators';
import { of } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class ServiceCatalogStore {
  private readonly todoService = inject(TodoService);

  readonly services = signal<ServiceItem[]>([]);
  readonly isLoading = signal<boolean>(false);
  readonly errorMessage = signal<string | null>(null);

  loadServices(): void {
    this.isLoading.set(true);
    this.todoService
      .getAllServices()
      .pipe(
        catchError((err) => {
          console.error('Failed to load services:', err);
          this.errorMessage.set('Could not load service catalog.');
          this.isLoading.set(false);
          return of([]);
        }),
      )
      .subscribe((data) => {
        this.services.set(data);
        this.isLoading.set(false);
      });
  }

  addService(request: ServiceItemRequest): void {
    this.isLoading.set(true);
    this.todoService.createService(request).subscribe({
      next: () => {
        this.loadServices();
      },
      error: (err) => {
        console.error('Failed to add service:', err);
        this.errorMessage.set('Failed to add service.');
        this.isLoading.set(false);
      },
    });
  }

  updateService(id: number, request: ServiceItemRequest): void {
    this.isLoading.set(true);
    this.todoService.updateService(id, request).subscribe({
      next: () => {
        this.loadServices();
      },
      error: (err) => {
        console.error('Failed to update service:', err);
        this.errorMessage.set('Failed to update service.');
        this.isLoading.set(false);
      },
    });
  }

  deleteService(id: number): void {
    this.isLoading.set(true);
    this.todoService.deleteService(id).subscribe({
      next: () => {
        this.loadServices();
      },
      error: (err) => {
        console.error('Failed to delete service:', err);
        this.errorMessage.set('Failed to delete service.');
        this.isLoading.set(false);
      },
    });
  }
}
