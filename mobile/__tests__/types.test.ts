/**
 * Type-level tests for the API and navigation type definitions.
 * These verify that the types compile correctly by asserting on
 * their structure at runtime (since TS types are erased at compile time).
 */
import {
  AppointmentItem,
  AppointmentCreateRequest,
  AppointmentUpdateRequest,
  AppointmentStats,
  AppointmentPage,
  AppointmentDashboardResponse,
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  ServiceItem,
  Barber,
  BarberTimeOff,
  NotificationItem,
  BarberRating,
  ReviewRequest,
  PublicCancelRequest,
} from '../src/types/api';

describe('types/api', () => {
  it('AppointmentItem has required fields', () => {
    const item: AppointmentItem = {
      id: 1, publicId: 'TF-0001', customerName: 'John', customerEmail: 'j@ex.com',
      customerPhone: '+1', barberName: 'Alex', bookingDate: '2026-08-01',
      bookingTime: '10:00', serviceType: 'Haircut', status: 'PENDING',
      createdAt: '', updatedAt: '',
    };
    expect(item.id).toBe(1);
    expect(item.publicId).toBe('TF-0001');
    expect(['PENDING', 'APPROVED', 'DENIED', 'CANCELLED']).toContain(item.status);
  });

  it('AppointmentCreateRequest has required fields', () => {
    const req: AppointmentCreateRequest = {
      customerName: 'John', customerEmail: 'j@ex.com', customerPhone: '+1',
      barberName: 'Alex', bookingDate: '2026-08-01', bookingTime: '10:00', serviceType: 'Haircut',
    };
    expect(req.serviceType).toBe('Haircut');
  });

  it('AppointmentUpdateRequest status is restricted', () => {
    const req: AppointmentUpdateRequest = { status: 'APPROVED' };
    expect(['APPROVED', 'DENIED']).toContain(req.status);
  });

  it('AppointmentStats has all numeric fields', () => {
    const stats: AppointmentStats = {
      total: 10, pending: 3, approved: 5, denied: 2, overdue: 1, progress: 50, approvedRevenue: 250,
    };
    expect(stats.total).toBe(10);
    expect(stats.approvedRevenue).toBe(250);
  });

  it('AppointmentPage has pagination fields', () => {
    const page: AppointmentPage = {
      content: [], totalPages: 1, totalElements: 0, size: 10, number: 0,
    };
    expect(page.totalPages).toBe(1);
  });

  it('AppointmentDashboardResponse combines page and stats', () => {
    const resp: AppointmentDashboardResponse = {
      page: { content: [], totalPages: 0, totalElements: 0, size: 10, number: 0 },
      stats: { total: 0, pending: 0, approved: 0, denied: 0, overdue: 0, progress: 0, approvedRevenue: 0 },
    };
    expect(resp.page).toBeDefined();
    expect(resp.stats).toBeDefined();
  });

  it('LoginRequest has username and password', () => {
    const req: LoginRequest = { username: 'admin', password: 'pass' };
    expect(req.username).toBe('admin');
  });

  it('LoginResponse has role union type', () => {
    const resp: LoginResponse = { username: 'admin', role: 'ROLE_ADMIN' };
    expect(['ROLE_ADMIN', 'ROLE_CUSTOMER']).toContain(resp.role);
  });

  it('RegisterRequest has all registration fields', () => {
    const req: RegisterRequest = { fullName: 'Jane', email: 'j@ex.com', password: 'pass', phone: '+1' };
    expect(req.fullName).toBe('Jane');
  });

  it('ServiceItem has pricing fields', () => {
    const svc: ServiceItem = { id: 1, name: 'Cut', price: 45, durationMinutes: 30, category: 'HAIRCUTS', description: '' };
    expect(svc.price).toBe(45);
  });

  it('Barber has contact fields', () => {
    const b: Barber = { id: 1, name: 'Alex', email: 'a@ex.com', phone: '+1' };
    expect(b.email).toBe('a@ex.com');
  });

  it('BarberTimeOff has date range', () => {
    const to: BarberTimeOff = { startDate: '2026-08-01', endDate: '2026-08-02', reason: 'Vacation' };
    expect(to.reason).toBe('Vacation');
  });

  it('NotificationItem has log fields', () => {
    const n: NotificationItem = { id: 1, recipient: 'admin', type: 'EMAIL', message: 'Test', sentAt: '2026-07-24T10:00:00', status: 'SENT' };
    expect(n.status).toBe('SENT');
  });

  it('BarberRating has rating fields', () => {
    const r: BarberRating = { barberName: 'Alex', averageRating: 4.8, reviewCount: 15 };
    expect(r.averageRating).toBe(4.8);
  });

  it('ReviewRequest has rating and comment', () => {
    const r: ReviewRequest = { rating: 5, comment: 'Great!' };
    expect(r.rating).toBe(5);
  });

  it('PublicCancelRequest has email', () => {
    const r: PublicCancelRequest = { email: 'j@ex.com' };
    expect(r.email).toBe('j@ex.com');
  });
});
