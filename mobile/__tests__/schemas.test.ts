import {
  appointmentCreateSchema,
  loginSchema,
  registerSchema,
} from '@taskflow/schemas';

describe('shared API schemas', () => {
  it('normalizes login usernames while preserving passwords', () => {
    const result = loginSchema.parse({
      username: '  admin  ',
      password: ' password123 ',
    });

    expect(result).toEqual({ username: 'admin', password: ' password123 ' });
  });

  it('rejects invalid registration data before a request is made', () => {
    const result = registerSchema.safeParse({
      fullName: 'Jane Smith',
      email: 'not-an-email',
      password: 'short',
    });

    expect(result.success).toBe(false);
  });

  it('matches the backend appointment time validation', () => {
    const result = appointmentCreateSchema.safeParse({
      customerName: 'Jane Smith',
      customerEmail: 'jane@example.com',
      customerPhone: '+1-555-0000',
      barberName: 'Alex',
      bookingDate: '2026-08-05',
      bookingTime: '25:00',
      serviceType: 'Classic Haircut',
    });

    expect(result.success).toBe(false);
  });
});
