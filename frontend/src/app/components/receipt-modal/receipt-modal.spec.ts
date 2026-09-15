import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { ReceiptModalComponent } from './receipt-modal';
import { AppointmentItem } from '../../types/api';

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
    TestBed.configureTestingModule({ imports: [ReceiptModalComponent] });
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
});
