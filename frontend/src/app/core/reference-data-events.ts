import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';

/**
 * Tells the public reference-data readers (the booking flow's barber list, the shop's hours)
 * that an admin changed the roster in this tab, so they refetch instead of showing what they
 * loaded earlier. Lives in core so the owner dashboard and the booking feature stay independent.
 */
@Injectable({ providedIn: 'root' })
export class ReferenceDataEvents {
  private readonly rosterSubject = new Subject<void>();

  /** Emits after a barber was added or a weekly schedule was saved. */
  readonly rosterChanged: Observable<void> = this.rosterSubject.asObservable();

  notifyRosterChanged(): void {
    this.rosterSubject.next();
  }
}
