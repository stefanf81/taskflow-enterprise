import { TestBed, ComponentFixture } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { BookingStore } from './booking.store';
import { BookingWizard } from './booking-wizard';

/** Monday 2026-10-12, 14:30 local time; 2026-10-13 is a bookable Tuesday. */
const MONDAY_AFTERNOON = new Date(2026, 9, 12, 14, 30);
const TUESDAY = '2026-10-13';

describe('BookingWizard accessibility (TODO 4.2, 4.3)', () => {
  let fixture: ComponentFixture<BookingWizard>;
  let store: BookingStore;
  let httpMock: HttpTestingController;

  const el = () => fixture.nativeElement as HTMLElement;
  const tabs = () => Array.from(el().querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const tab = (index: number) => tabs()[index] as HTMLButtonElement;
  const flushBusySlots = (busy: string[] = []) =>
    httpMock.match((r) => r.url.includes('/public/busy-slots')).forEach((r) => r.flush(busy));
  const press = (target: HTMLElement, key: string): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    fixture.detectChanges();
    return event;
  };
  const render = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(MONDAY_AFTERNOON);
    TestBed.configureTestingModule({
      imports: [BookingWizard],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(BookingWizard);
    store = TestBed.inject(BookingStore);
    httpMock = TestBed.inject(HttpTestingController);
    // Focus assertions need the component inside the document.
    document.body.appendChild(el());
    fixture.detectChanges();
    httpMock
      .match((r) => r.url.includes('/api/v1/catalog'))
      .forEach((r) =>
        r.flush([
          {
            id: 1,
            name: 'Classic Haircut',
            price: 25,
            durationMinutes: 30,
            category: 'hair',
            description: 'd',
          },
        ]),
      );
    httpMock.match((r) => r.url.includes('/barber-ratings')).forEach((r) => r.flush([]));
    httpMock.match((r) => r.url === '/api/v1/barbers').forEach((r) => r.flush([]));
    await render();
  });

  afterEach(() => {
    httpMock.match(() => true);
    el().remove();
    vi.useRealTimers();
  });

  describe('stepper (WAI-ARIA tabs, manual activation)', () => {
    it('exposes a labelled tablist whose selected tab controls the rendered panel', () => {
      expect(el().querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe(
        'Booking steps',
      );
      expect(tabs()).toHaveLength(4);

      expect(tab(0).getAttribute('aria-selected')).toBe('true');
      expect(tab(0).getAttribute('tabindex')).toBe('0');
      expect(tab(0).getAttribute('aria-controls')).toBe('step-panel-1');
      expect(tab(0).getAttribute('aria-label')).toBe('Step 1 of 4: Select Treatment');
      const panel = el().querySelector('#step-panel-1');
      expect(panel?.getAttribute('role')).toBe('tabpanel');
      expect(panel?.getAttribute('aria-labelledby')).toBe('step-tab-1');

      for (const other of tabs().slice(1)) {
        expect(other.getAttribute('aria-selected')).toBe('false');
        expect(other.getAttribute('tabindex')).toBe('-1');
        // Only the selected panel is rendered: never point at a missing id.
        expect(other.hasAttribute('aria-controls')).toBe(false);
      }
    });

    it('moves focus with ArrowRight/ArrowLeft (wrapping), Home and End without activating', () => {
      tab(0).focus();

      const right = press(tab(0), 'ArrowRight');
      expect(right.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(tab(1));

      press(tab(1), 'ArrowRight');
      expect(document.activeElement).toBe(tab(2));

      press(tab(2), 'ArrowLeft');
      expect(document.activeElement).toBe(tab(1));

      press(tab(1), 'End');
      expect(document.activeElement).toBe(tab(3));

      press(tab(3), 'ArrowRight');
      expect(document.activeElement).toBe(tab(0));

      press(tab(0), 'ArrowLeft');
      expect(document.activeElement).toBe(tab(3));

      press(tab(3), 'Home');
      expect(document.activeElement).toBe(tab(0));

      // Manual activation: moving focus never changes the step.
      expect(store.activeStep()).toBe(1);
      expect(tab(0).getAttribute('aria-selected')).toBe('true');
    });

    it('leaves every other key to the browser', () => {
      tab(0).focus();
      for (const key of ['Tab', 'Enter', ' ', 'ArrowDown', 'a']) {
        expect(press(tab(0), key).defaultPrevented).toBe(false);
        expect(document.activeElement).toBe(tab(0));
      }
    });

    it('keeps gated steps focusable but aria-disabled, and refuses to activate them', () => {
      // No date/slot yet: step 4 is gated; steps 2 and 3 are reachable (defaults are valid).
      expect(tab(1).hasAttribute('aria-disabled')).toBe(false);
      expect(tab(2).hasAttribute('aria-disabled')).toBe(false);
      expect(tab(3).getAttribute('aria-disabled')).toBe('true');
      expect(tab(3).classList).toContain('cursor-not-allowed');

      // Reachable by keyboard focus...
      tab(0).focus();
      press(tab(0), 'End');
      expect(document.activeElement).toBe(tab(3));
      // ...but Enter/Space (the button's click) does not activate it.
      tab(3).click();
      fixture.detectChanges();
      expect(store.activeStep()).toBe(1);
      expect(el().querySelector('#step-panel-4')).toBeNull();

      tab(2).click();
      fixture.detectChanges();
      expect(store.activeStep()).toBe(3);
      expect(tab(2).getAttribute('aria-selected')).toBe('true');
      expect(tab(2).getAttribute('tabindex')).toBe('0');
      expect(el().querySelector('#step-panel-3')).toBeTruthy();
      expect(tab(0).getAttribute('aria-label')).toBe('Step 1 of 4: Select Treatment, completed');

      store.selectBookingDate(TUESDAY);
      flushBusySlots();
      fixture.detectChanges();
      expect(tab(3).hasAttribute('aria-disabled')).toBe(false);
      tab(3).click();
      fixture.detectChanges();
      expect(store.activeStep()).toBe(4);
      expect(el().querySelector('#step-panel-4')).toBeTruthy();
    });

    it('always allows going back, and gates every step after an invalid one', () => {
      store.selectBookingDate(TUESDAY);
      flushBusySlots();
      store.setStep(4);
      fixture.detectChanges();
      expect(store.activeStep()).toBe(4);

      tab(0).click();
      fixture.detectChanges();
      expect(store.activeStep()).toBe(1);

      store.selectService('');
      flushBusySlots();
      fixture.detectChanges();
      expect(
        tabs()
          .slice(1)
          .map((t) => t.getAttribute('aria-disabled')),
      ).toEqual(['true', 'true', 'true']);
      tab(2).click();
      fixture.detectChanges();
      expect(store.activeStep()).toBe(1);
      expect(store.isStepReachable(0)).toBe(false);
      expect(store.isStepReachable(5)).toBe(false);
    });
  });

  describe('step 4 contact field messages', () => {
    const input = (id: string) => el().querySelector<HTMLInputElement>(`#${id}`)!;
    const submit = async () => {
      el().querySelector<HTMLButtonElement>('.appointment-form button[type="submit"]')!.click();
      await render();
    };

    beforeEach(async () => {
      store.bookingModel.update((m) => ({ ...m, bookingDate: TUESDAY, bookingTime: '15:00' }));
      store.activeStep.set(4);
      await render();
    });

    it('never defaults contact details to a GET form and prevents native submission', () => {
      const form = el().querySelector('form')!;
      expect(form.method).toBe('post');
      const event = new Event('submit', { bubbles: true, cancelable: true });
      form.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      httpMock.expectNone('/api/v1/appointments');
    });

    it('announces nothing and marks nothing invalid when step 4 opens', () => {
      expect(el().querySelectorAll('[role="alert"]')).toHaveLength(0);
      for (const id of ['customerName', 'customerEmail', 'customerPhone']) {
        expect(input(id).hasAttribute('aria-invalid')).toBe(false);
        expect(input(id).hasAttribute('aria-describedby')).toBe(false);
      }
    });

    it('shows a field message once that field has been left empty', () => {
      input('customerName').dispatchEvent(new Event('blur'));
      fixture.detectChanges();

      const error = el().querySelector('#customerName-error');
      expect(error?.getAttribute('role')).toBe('alert');
      expect(error?.textContent).toContain('Full name is required.');
      expect(input('customerName').getAttribute('aria-invalid')).toBe('true');
      expect(input('customerName').getAttribute('aria-describedby')).toBe('customerName-error');
      expect(el().querySelector('#customerPhone-error')).toBeNull();
      expect(el().querySelector('#customerEmail-error')).toBeNull();
    });

    it('reveals every message on a submit with untouched fields and focuses the first', async () => {
      await submit();

      expect(el().querySelector('#customerName-error')?.textContent).toContain(
        'Full name is required.',
      );
      expect(el().querySelector('#customerEmail-error')?.textContent).toContain(
        'Valid email address is required.',
      );
      expect(el().querySelector('#customerPhone-error')?.textContent).toContain(
        'Phone number is required.',
      );
      expect(document.activeElement).toBe(input('customerName'));
      expect(store.activeStep()).toBe(4);
      httpMock.expectNone('/api/v1/appointments');
    });

    it('focuses the first field that is still invalid', async () => {
      store.bookingModel.update((m) => ({
        ...m,
        customerName: 'Jane',
        customerEmail: 'a@b',
        customerPhone: '555-0100',
      }));
      await submit();

      expect(el().querySelector('#customerName-error')).toBeNull();
      expect(el().querySelector('#customerEmail-error')?.textContent).toContain(
        'Invalid email format',
      );
      expect(document.activeElement).toBe(input('customerEmail'));
    });

    it('does not carry the messages over to the next booking', async () => {
      await submit();
      expect(el().querySelectorAll('[role="alert"][id$="-error"]')).toHaveLength(3);

      store.resetBookingForm();
      store.bookingModel.update((m) => ({ ...m, bookingDate: TUESDAY, bookingTime: '15:00' }));
      store.activeStep.set(4);
      await render();

      expect(el().querySelectorAll('[role="alert"][id$="-error"]')).toHaveLength(0);
    });
  });
});
