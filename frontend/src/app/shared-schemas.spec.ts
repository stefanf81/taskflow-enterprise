import {
  appointmentDashboardResponseSchema,
  appointmentEventSchema,
  barberRatingResponseSchema,
  loginSchema,
  notificationOutboxResponseSchema,
  publicBarberResponseSchema,
  registerSchema,
  serviceItemResponseSchema,
} from '@taskflow/schemas';

describe('shared API schemas', () => {
  it('accepts the web login payload shape', () => {
    expect(loginSchema.parse({ username: 'admin', password: 'admin-password' })).toEqual({
      username: 'admin',
      password: 'admin-password',
    });
  });

  it('rejects an invalid registration password', () => {
    expect(
      registerSchema.safeParse({
        fullName: 'Jane Smith',
        email: 'jane@example.com',
        phone: '+1-555-0000',
        password: 'password',
      }).success,
    ).toBe(false);
  });

  it('validates the public catalog response contract', () => {
    expect(
      serviceItemResponseSchema.safeParse({
        id: 1,
        name: 'Classic Haircut',
        price: 25,
        durationMinutes: 30,
        category: 'hair',
        description: 'Desc',
      }).success,
    ).toBe(true);
    expect(serviceItemResponseSchema.safeParse({ name: 'Classic Haircut' }).success).toBe(false);
  });

  it('validates the public barber directory and ratings contract', () => {
    expect(publicBarberResponseSchema.safeParse({ id: 1, name: 'Alex' }).success).toBe(true);
    expect(publicBarberResponseSchema.safeParse({ name: 'Alex' }).success).toBe(false);
    expect(
      barberRatingResponseSchema.safeParse({
        barberName: 'Alex',
        averageRating: 4.8,
        reviewCount: 12,
      }).success,
    ).toBe(true);
  });

  it('validates the admin dashboard and notification contracts', () => {
    const dashboard = {
      page: {
        content: [
          {
            id: 1,
            publicId: 'pub-1',
            customerName: 'Alice',
            customerEmail: 'alice@example.com',
            customerPhone: '123',
            barberName: 'Alex',
            bookingDate: '2026-08-01',
            bookingTime: '09:00',
            serviceType: 'Classic Haircut',
            status: 'PENDING',
            createdAt: '2026-07-01T00:00:00',
            updatedAt: '2026-07-01T00:00:00',
          },
        ],
        page: { number: 0, size: 50, totalElements: 1, totalPages: 1 },
      },
      stats: {
        total: 1,
        pending: 1,
        approved: 0,
        denied: 0,
        overdue: 0,
        progress: 0,
        approvedRevenue: 0,
      },
    };
    expect(appointmentDashboardResponseSchema.safeParse(dashboard).success).toBe(true);
    expect(
      appointmentDashboardResponseSchema.safeParse({ ...dashboard, stats: undefined }).success,
    ).toBe(false);
    expect(
      notificationOutboxResponseSchema.safeParse({
        id: 1,
        message: 'Sent',
        recipient: 'alice@example.com',
        retryCount: 0,
        sentAt: '2026-07-01T00:00:00',
        status: 'SENT',
        type: 'EMAIL',
      }).success,
    ).toBe(true);
  });

  it('validates server-sent appointment events', () => {
    expect(
      appointmentEventSchema.safeParse({
        type: 'CREATED',
        appointmentId: 1,
        occurredAt: '2026-07-01T00:00:00',
      }).success,
    ).toBe(true);
    expect(
      appointmentEventSchema.safeParse({ type: 'ARCHIVED', appointmentId: 1, occurredAt: 'x' })
        .success,
    ).toBe(false);
  });
});
