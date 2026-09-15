import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { form, required, FormField } from '@angular/forms/signals';
import { BarberStore } from '../../barber.store';
import { formatLocalDate } from '../../time-utils';

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

  readonly barbersList = this.barberStore.barbers;
  readonly timeOffs = this.barberStore.timeOffs;
  readonly selectedBarberId = this.barberStore.selectedBarberId;
  readonly timeOffActionError = this.barberStore.actionErrorMessage;
  readonly timeOffActionSuccess = this.barberStore.actionSuccessMessage;

  readonly timeOffModel = signal<TimeOffFormModel>({ startDate: '', endDate: '', reason: '' });
  readonly timeOffForm = form(this.timeOffModel, (f) => {
    required(f.startDate);
    required(f.endDate);
  });

  selectAdminBarber(id: number): void {
    this.barberStore.selectBarber(id);
  }

  addTimeOff(): void {
    const model = this.timeOffModel();
    if (!model.startDate || !model.endDate) {
      this.barberStore.actionErrorMessage.set('Start and end dates are required.');
      return;
    }
    this.barberStore.actionSuccessMessage.set(null);
    this.barberStore.addTimeOff({
      startDate: model.startDate,
      endDate: model.endDate,
      reason: model.reason,
    });
    this.timeOffModel.set({ startDate: '', endDate: '', reason: '' });
  }

  formatLocalDate(dateStr: string): string {
    return formatLocalDate(dateStr);
  }
}
