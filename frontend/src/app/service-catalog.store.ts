import { Injectable, inject, signal } from '@angular/core';
import { AppointmentService, ServiceItem } from './appointment.service';
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
}
