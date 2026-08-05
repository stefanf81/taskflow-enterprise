import { loginSchema, registerSchema } from '@taskflow/schemas';

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
});
