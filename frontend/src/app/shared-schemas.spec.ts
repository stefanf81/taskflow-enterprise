import {
  appointmentDashboardResponseSchema,
  appointmentEventSchema,
  appointmentResponseSchema,
  appointmentUpdateSchema,
  barberRatingResponseSchema,
  barberResponseSchema,
  barberSchema,
  barberTimeOffResponseSchema,
  barberTimeOffSchema,
  busySlotsResponseSchema,
  loginResponseSchema,
  loginSchema,
  mobileLoginResponseSchema,
  notificationOutboxResponseSchema,
  publicBarberResponseSchema,
  registerResponseSchema,
  registerSchema,
  reviewSchema,
  serviceItemResponseSchema,
  serviceItemSchema,
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

  it('accepts only the roles the backend issues on login and /me', () => {
    expect(loginResponseSchema.parse({ username: 'admin', role: 'ROLE_ADMIN' })).toEqual({
      username: 'admin',
      role: 'ROLE_ADMIN',
    });
    expect(loginResponseSchema.safeParse({ username: 'admin', role: 'ROLE_ROOT' }).success).toBe(
      false,
    );
    expect(loginResponseSchema.safeParse({ username: '', role: 'ROLE_CUSTOMER' }).success).toBe(
      false,
    );
    expect(registerResponseSchema.safeParse({ message: 'ok' }).success).toBe(true);
    expect(registerResponseSchema.safeParse({}).success).toBe(false);
  });

  it('validates the mobile bearer login response', () => {
    const login = {
      accessToken: 'jwt',
      tokenType: 'Bearer',
      expiresIn: 3600,
      username: 'jane@example.com',
      role: 'ROLE_CUSTOMER',
    };
    expect(mobileLoginResponseSchema.safeParse(login).success).toBe(true);
    expect(mobileLoginResponseSchema.safeParse({ ...login, tokenType: 'Basic' }).success).toBe(
      false,
    );
    expect(mobileLoginResponseSchema.safeParse({ ...login, expiresIn: 0 }).success).toBe(false);
    expect(mobileLoginResponseSchema.safeParse({ ...login, accessToken: '' }).success).toBe(false);
  });

  it('requires every field of an appointment response and busy slots as strings', () => {
    const appointment = {
      id: 1,
      publicId: 'pub-1',
      customerName: 'Alice',
      customerEmail: 'alice@example.com',
      customerPhone: '123',
      barberName: 'Alex',
      bookingDate: '2026-08-01',
      bookingTime: '09:00',
      serviceType: 'Classic Haircut',
      status: 'CANCELLED',
      createdAt: '2026-07-01T00:00:00',
      updatedAt: '2026-07-01T00:00:00',
    };
    expect(appointmentResponseSchema.safeParse(appointment).success).toBe(true);
    const { publicId: _omitted, ...withoutPublicId } = appointment;
    expect(appointmentResponseSchema.safeParse(withoutPublicId).success).toBe(false);
    expect(appointmentResponseSchema.safeParse({ ...appointment, id: '1' }).success).toBe(false);

    expect(busySlotsResponseSchema.safeParse(['09:00', '10:00']).success).toBe(true);
    expect(busySlotsResponseSchema.safeParse([900]).success).toBe(false);
  });

  it('defaults omitted optional strings to empty strings in admin responses', () => {
    expect(barberResponseSchema.parse({ id: 1, name: 'Alex', email: null })).toEqual({
      id: 1,
      name: 'Alex',
      email: '',
      phone: '',
    });
    expect(
      barberTimeOffResponseSchema.parse({ id: 2, startDate: '2026-08-01', endDate: '2026-08-02' }),
    ).toEqual({ id: 2, startDate: '2026-08-01', endDate: '2026-08-02', reason: '' });
    expect(
      serviceItemResponseSchema.parse({
        id: 1,
        name: 'Cut',
        price: 25,
        durationMinutes: 30,
        category: 'hair',
      }).description,
    ).toBe('');
    expect(
      notificationOutboxResponseSchema.parse({
        id: 1,
        message: 'Queued',
        recipient: 'a***@example.com',
        retryCount: 0,
        status: 'PENDING',
      }),
    ).toMatchObject({ sentAt: '', type: '' });
  });

  it('limits admin status changes to APPROVED and DENIED', () => {
    expect(appointmentUpdateSchema.safeParse({ status: 'APPROVED' }).success).toBe(true);
    expect(appointmentUpdateSchema.safeParse({ status: 'DENIED' }).success).toBe(true);
    for (const status of ['PENDING', 'CANCELLED', 'approved']) {
      expect(appointmentUpdateSchema.safeParse({ status }).success).toBe(false);
    }
  });

  it('rejects a time-off range that ends before it starts', () => {
    expect(
      barberTimeOffSchema.safeParse({ startDate: '2026-08-01', endDate: '2026-08-01' }).success,
    ).toBe(true);
    const result = barberTimeOffSchema.safeParse({
      startDate: '2026-08-02',
      endDate: '2026-08-01',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['endDate']);
    expect(
      barberTimeOffSchema.safeParse({ startDate: '01/08/2026', endDate: '2026-08-02' }).success,
    ).toBe(false);
  });

  it('validates admin catalog and barber forms', () => {
    const service = { name: ' Cut ', price: 25, durationMinutes: 30, category: 'hair' };
    expect(serviceItemSchema.parse(service).name).toBe('Cut');
    expect(serviceItemSchema.safeParse({ ...service, price: 0 }).success).toBe(false);
    expect(serviceItemSchema.safeParse({ ...service, durationMinutes: 12.5 }).success).toBe(false);
    expect(serviceItemSchema.safeParse({ ...service, name: '   ' }).success).toBe(false);

    expect(barberSchema.safeParse({ name: 'Alex', email: '' }).success).toBe(true);
    expect(barberSchema.safeParse({ name: 'Alex', email: 'not-an-email' }).success).toBe(false);
    expect(barberSchema.safeParse({ name: 'x'.repeat(101) }).success).toBe(false);
  });

  it('keeps review ratings whole numbers between 1 and 5', () => {
    const review = { rating: 5, customerEmail: 'jane@example.com' };
    expect(reviewSchema.safeParse(review).success).toBe(true);
    for (const rating of [0, 6, 4.5]) {
      expect(reviewSchema.safeParse({ ...review, rating }).success).toBe(false);
    }
    expect(reviewSchema.safeParse({ ...review, comment: 'x'.repeat(1001) }).success).toBe(false);
    expect(reviewSchema.safeParse({ ...review, customerEmail: '' }).success).toBe(false);
  });
});
