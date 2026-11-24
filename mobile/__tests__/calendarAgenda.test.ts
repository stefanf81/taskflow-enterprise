import { buildAgenda } from '../src/features/admin/calendarAgenda';
import type { AppointmentItem } from '../src/types/api';

const item = (
  id: number,
  barberName: string,
  bookingDate: string,
  bookingTime: string,
  status = 'PENDING',
): AppointmentItem => ({
  id,
  publicId: `TF-${id}`,
  customerName: `Customer ${id}`,
  customerEmail: 'c@ex.com',
  customerPhone: '1',
  barberName,
  bookingDate,
  bookingTime,
  serviceType: 'Cut',
  status,
  createdAt: '',
  updatedAt: '',
});

describe('buildAgenda', () => {
  const dates = ['2026-11-24', '2026-11-25'];

  it('gives every date its day, empty ones included', () => {
    expect(buildAgenda([], dates, null)).toEqual([
      { date: '2026-11-24', items: [] },
      { date: '2026-11-25', items: [] },
    ]);
  });

  it('keeps only bookings that hold a slot, per day, earliest first (id breaks ties)', () => {
    const agenda = buildAgenda(
      [
        item(4, 'Alex', '2026-11-24', '10:30'),
        item(1, 'Sara', '2026-11-24', '09:00', 'APPROVED'),
        item(3, 'Alex', '2026-11-24', '10:30'),
        item(2, 'Alex', '2026-11-24', '11:00', 'DENIED'),
        item(5, 'Alex', '2026-11-24', '12:00', 'CANCELLED'),
        item(6, 'Alex', '2026-11-25', '09:00'),
        item(7, 'Alex', '2026-11-30', '09:00'), // outside the dates shown
      ],
      dates,
      null,
    );
    expect(agenda[0]!.items.map((i) => i.id)).toEqual([1, 3, 4]);
    expect(agenda[1]!.items.map((i) => i.id)).toEqual([6]);
  });

  it('narrows to one barber', () => {
    const agenda = buildAgenda(
      [item(1, 'Alex', '2026-11-24', '09:00'), item(2, 'Sara', '2026-11-24', '10:00')],
      dates,
      'Sara',
    );
    expect(agenda[0]!.items.map((i) => i.id)).toEqual([2]);
  });
});
