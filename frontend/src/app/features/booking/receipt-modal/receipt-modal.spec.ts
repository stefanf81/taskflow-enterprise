import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { CdkTrapFocus } from '@angular/cdk/a11y';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ReceiptModalComponent } from './receipt-modal';
import { AppointmentItem } from '../../../types/api';

describe('ReceiptModalComponent', () => {
  let fixture: ComponentFixture<ReceiptModalComponent>;
  let component: ReceiptModalComponent;

  const appointment: AppointmentItem = {
    id: 42,
    publicId: 'TF-0042',
    customerName: 'Jane Smith',
    customerEmail: 'jane@example.com',
    customerPhone: '+1-555-0000',
    barberName: 'Alex the Barber',
    bookingDate: '2026-08-01',
    bookingTime: '13:30',
    serviceType: 'Classic Haircut',
    status: 'PENDING',
    createdAt: '2026-07-01T00:00:00',
    updatedAt: '2026-07-01T00:00:00',
  };

  const overlay = (): HTMLElement =>
    fixture.nativeElement.querySelector('.modal-overlay') as HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ReceiptModalComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(ReceiptModalComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('appointment', appointment);
    fixture.componentRef.setInput('checkoutTotal', 27.5);
    fixture.detectChanges();
  });

  it('renders the receipt with formatted date, time and total', () => {
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Receipt #42');
    expect(text).toContain('TF-0042');
    expect(text).toContain('Jane Smith');
    expect(text).toContain('Alex the Barber');
    expect(text).toContain('August 1, 2026');
    expect(text).toContain('1:30 PM');
    expect(text).toContain('$27.50');
  });

  it('renders safely while the appointment is still null', () => {
    fixture.componentRef.setInput('appointment', null);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Receipt #');
  });

  it('emits closed when the close button is clicked', () => {
    let closed = 0;
    component.closed.subscribe(() => closed++);
    (fixture.nativeElement.querySelector('.modal-close') as HTMLButtonElement).click();
    expect(closed).toBe(1);
  });

  it('emits closed when the confirmation button is clicked', () => {
    let closed = 0;
    component.closed.subscribe(() => closed++);
    (fixture.nativeElement.querySelector('.btn-submit') as HTMLButtonElement).click();
    expect(closed).toBe(1);
  });

  it('emits closed on Escape from the overlay', () => {
    let closed = 0;
    component.closed.subscribe(() => closed++);
    overlay().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(closed).toBe(1);
  });

  // jsdom has no layout, so the CDK never treats an element as focusable there; assert the
  // trap is configured to capture (and later restore) focus instead of observing the move.
  it('captures focus into the dialog and closes on Escape from inside it', () => {
    const trap = fixture.debugElement.query(By.directive(CdkTrapFocus)).injector.get(CdkTrapFocus);
    expect(trap.autoCapture).toBe(true);
    const close = fixture.nativeElement.querySelector('.modal-close') as HTMLButtonElement;
    expect(close.getAttribute('aria-label')).toBe('Close');

    let closed = 0;
    component.closed.subscribe(() => closed++);
    close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(closed).toBe(1);
  });

  it('emits closed when the backdrop itself is clicked', () => {
    let closed = 0;
    component.closed.subscribe(() => closed++);
    overlay().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(closed).toBe(1);
  });

  it('does not close when clicking inside the dialog card', () => {
    let closed = 0;
    component.closed.subscribe(() => closed++);
    const card = fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement;
    card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(closed).toBe(0);
  });

  describe('calendar export', () => {
    let httpMock: HttpTestingController;
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const calendarButton = (): HTMLButtonElement =>
      Array.from(
        fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
      ).find((button) => button.textContent?.includes('.ics')) as HTMLButtonElement;

    beforeEach(() => {
      httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => {
      httpMock.verify();
      vi.useRealTimers();
      vi.restoreAllMocks();
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    });

    it('verifies the guest with the booking email and saves the .ics file', () => {
      vi.useFakeTimers();
      const createObjectURL = vi.fn(() => 'blob:calendar');
      const revokeObjectURL = vi.fn();
      URL.createObjectURL = createObjectURL;
      URL.revokeObjectURL = revokeObjectURL;
      const click = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => undefined);

      calendarButton().click();
      const req = httpMock.expectOne('/api/v1/appointments/public/calendar/TF-0042');
      expect(req.request.body).toEqual({ email: 'jane@example.com' });
      req.flush({
        content: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n',
        filename: 'appointment-TF-0042.ics',
      });
      fixture.detectChanges();

      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(click).toHaveBeenCalledTimes(1);
      // Revoked later: revoking at once can abort the download.
      expect(revokeObjectURL).not.toHaveBeenCalled();
      vi.runAllTimers();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:calendar');
      expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
    });

    it('says so when the export fails instead of failing silently', () => {
      calendarButton().click();
      httpMock
        .expectOne('/api/v1/appointments/public/calendar/TF-0042')
        .flush(
          { message: 'Appointment not found or unauthorized.' },
          { status: 404, statusText: 'x' },
        );
      fixture.detectChanges();

      const alert = fixture.nativeElement.querySelector('[role="alert"]') as HTMLElement;
      expect(alert.textContent).toContain('Appointment not found or unauthorized.');
      expect(calendarButton().disabled).toBe(false);
    });
  });
});
