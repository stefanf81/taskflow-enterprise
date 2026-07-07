import { Injectable, inject, signal } from '@angular/core';
import { AppointmentService, ServiceItem, ServiceItemRequest } from './appointment.service';
import { catchError } from 'rxjs/operators';
import { of } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class ServiceCatalogStore {
  private readonly appointmentService = inject(AppointmentService);

  readonly services = signal<ServiceItem[]>([]);
  readonly isLoading = signal<boolean>(false);
  readonly errorMessage = signal<string | null>(null);

  loadServices(): void {
    this.isLoading.set(true);
    this.appointmentService
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
    this.appointmentService.createService(request).subscribe({
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
    this.appointmentService.updateService(id, request).subscribe({
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
    this.appointmentService.deleteService(id).subscribe({
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
