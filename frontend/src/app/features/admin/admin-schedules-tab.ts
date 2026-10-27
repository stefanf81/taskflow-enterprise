import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { form, required, FormField } from '@angular/forms/signals';
import { AppointmentStore } from '../../core/appointments/appointment.store';
import { BarberStore } from './barber.store';
import { formatLocalDate } from '../../core/time-utils';

interface TimeOffFormModel {
  startDate: string;
  endDate: string;
  reason: string;
}

/** Owner dashboard · barber schedules and time-off tab (Signal Forms). */
@Component({
  selector: 'app-admin-schedules-tab',
  imports: [CommonModule, FormField],
  templateUrl: './admin-schedules-tab.html',
})
export class AdminSchedulesTab {
  private readonly barberStore = inject(BarberStore);
  private readonly appointmentStore = inject(AppointmentStore);

  protected readonly barbersList = this.barberStore.barbers;
  protected readonly timeOffs = this.barberStore.timeOffs;
  protected readonly selectedBarberId = this.barberStore.selectedBarberId;
  readonly timeOffActionError = this.barberStore.actionErrorMessage;
  protected readonly timeOffActionSuccess = this.barberStore.actionSuccessMessage;
  protected readonly isSaving = this.barberStore.isSaving;
  protected readonly loadError = this.barberStore.errorMessage;

  readonly timeOffModel = signal<TimeOffFormModel>({ startDate: '', endDate: '', reason: '' });
  protected readonly timeOffForm = form(this.timeOffModel, (f) => {
    required(f.startDate);
    required(f.endDate);
  });

  protected selectAdminBarber(id: number): void {
    this.barberStore.selectBarber(id);
  }

  async addTimeOff(): Promise<void> {
    const model = this.timeOffModel();
    if (!model.startDate || !model.endDate) {
      this.barberStore.actionErrorMessage.set('Start and end dates are required.');
      return;
    }
    this.barberStore.actionSuccessMessage.set(null);
    const saved = await this.barberStore.addTimeOff({
      startDate: model.startDate,
      endDate: model.endDate,
      reason: model.reason,
    });
    // Reset ONLY after the server accepted the entry; on error the input stays so the
    // owner can correct it (the store already shows the server's message).
    if (saved) {
      this.timeOffModel.set({ startDate: '', endDate: '', reason: '' });
      // The server may have cancelled conflicting bookings: refresh the appointment list.
      this.appointmentStore.refresh();
    }
  }

  protected retryLoad(): void {
    this.barberStore.loadBarbers();
    const barberId = this.selectedBarberId();
    if (barberId) this.barberStore.loadTimeOffs(barberId);
  }

  protected formatLocalDate(dateStr: string): string {
    return formatLocalDate(dateStr);
  }
}
