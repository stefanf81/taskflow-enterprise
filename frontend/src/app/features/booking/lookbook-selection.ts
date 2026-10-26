import { Injectable, signal } from '@angular/core';

/** A lookbook style the guest picked, on its way to the booking wizard. */
export interface LookbookPick {
  serviceName: string;
  category: string;
  /** Distinguishes two consecutive picks of the same style. */
  seq: number;
}

/**
 * Hand-off point between the lookbook (landing page) and {@link BookingStore}.
 *
 * It exists so the landing page does not have to import `BookingStore`: that static import
 * pulls Signal Forms (~60 kB) and the whole wizard into the eager `main.js`, which defeats
 * deferring `<app-booking-wizard />`. The pick is held in a signal rather than emitted, so a
 * click made before the wizard has hydrated is still applied once `BookingStore` is
 * constructed.
 */
@Injectable({ providedIn: 'root' })
export class LookbookSelectionBus {
  readonly pick = signal<LookbookPick | null>(null);
  private seq = 0;

  select(serviceName: string, category: string): void {
    this.seq += 1;
    this.pick.set({ serviceName, category, seq: this.seq });
  }
}
