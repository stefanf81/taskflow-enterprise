import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface AppointmentItem {
  id: number;
  publicId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  barberName: string;
  bookingDate: string;
  bookingTime: string;
  serviceType: string;
  status: string; // PENDING, APPROVED, DENIED
  createdAt: string;
  updatedAt: string;
}

export interface AppointmentCreateRequest {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  barberName: string;
  bookingDate: string;
  bookingTime: string;
  serviceType: string;
}

export interface AppointmentUpdateRequest {
  status: string;
}

export interface AppointmentStats {
  total: number;
  pending: number;
  approved: number;
  denied: number;
  overdue: number;
  progress: number;
  approvedRevenue: number;
}

export interface AppointmentPage {
  content: AppointmentItem[];
  totalPages: number;
  totalElements: number;
  size: number;
  number: number;
}

export interface AppointmentDashboardResponse {
  page: AppointmentPage;
  stats: AppointmentStats;
}

export interface LoginResponse {
  token: string;
  username: string;
  role: string;
}

export interface RegisterRequest {
  fullName: string;
  email: string;
  password: string;
  phone: string;
}

export interface ServiceItem {
  id: number;
  name: string;
  price: number;
  durationMinutes: number;
  category: string;
  description: string;
}

export interface ServiceItemRequest {
  name: string;
  price: number;
  durationMinutes: number;
  category: string;
  description: string;
}

export interface Barber {
  id: number;
  name: string;
  email: string;
  phone: string;
}

export interface BarberTimeOff {
  id?: number;
  startDate: string;
  endDate: string;
  reason: string;
}

export interface NotificationItem {
  id: number;
  recipient: string;
  type: string;
  message: string;
  sentAt: string;
  status: string;
}

export interface BarberRating {
  barberName: string;
  averageRating: number;
  reviewCount: number;
}

export interface ReviewRequest {
  rating: number;
  comment: string;
}

@Injectable({
  providedIn: 'root',
})
export class TodoService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = '/api/v1/appointments';
  private readonly authUrl = '/api/v1/auth';
  private readonly catalogUrl = '/api/v1/catalog';
  private readonly barbersUrl = '/api/v1/barbers';
  private readonly notificationsUrl = '/api/v1/notifications';
  private readonly reviewsUrl = '/api/v1/reviews';
  private readonly customerUrl = '/api/v1/customer';

  // --- Customer Accounts & Auth ---
  register(request: RegisterRequest): Observable<void> {
    return this.http.post<void>(`${this.authUrl}/register`, request);
  }

  getCustomerAppointments(
    page = 0,
    size = 10,
  ): Observable<{ content: AppointmentItem[]; totalPages: number }> {
    const params = new HttpParams().set('page', page.toString()).set('size', size.toString());
    return this.http.get<{ content: AppointmentItem[]; totalPages: number }>(
      `${this.customerUrl}/appointments`,
      { params },
    );
  }

  cancelCustomerAppointment(id: number): Observable<void> {
    return this.http.delete<void>(`${this.customerUrl}/appointments/${id}`);
  }

  // --- Reviews API ---
  getBarberRatings(): Observable<BarberRating[]> {
    return this.http.get<BarberRating[]>(`${this.reviewsUrl}/public/barber-ratings`);
  }

  submitReview(publicId: string, request: ReviewRequest): Observable<void> {
    return this.http.post<void>(`${this.reviewsUrl}/public/${publicId}`, request);
  }

  // --- Notifications API ---
  getNotifications(): Observable<NotificationItem[]> {
    return this.http.get<NotificationItem[]>(this.notificationsUrl);
  }

  // --- Barbers & Time-Off API ---
  getAllBarbers(): Observable<Barber[]> {
    return this.http.get<Barber[]>(this.barbersUrl);
  }

  getTimeOff(barberId: number): Observable<BarberTimeOff[]> {
    return this.http.get<BarberTimeOff[]>(`${this.barbersUrl}/${barberId}/time-off`);
  }

  addTimeOff(barberId: number, request: BarberTimeOff): Observable<BarberTimeOff> {
    return this.http.post<BarberTimeOff>(`${this.barbersUrl}/${barberId}/time-off`, request);
  }

  // --- Service Catalog API ---
  getAllServices(): Observable<ServiceItem[]> {
    return this.http.get<ServiceItem[]>(this.catalogUrl);
  }

  createService(request: ServiceItemRequest): Observable<ServiceItem> {
    return this.http.post<ServiceItem>(this.catalogUrl, request);
  }

  updateService(id: number, request: ServiceItemRequest): Observable<ServiceItem> {
    return this.http.put<ServiceItem>(`${this.catalogUrl}/${id}`, request);
  }

  deleteService(id: number): Observable<void> {
    return this.http.delete<void>(`${this.catalogUrl}/${id}`);
  }

  // Perform secure JWT login by posting to the authentication controller
  login(username: string, password: string): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${this.authUrl}/login`, { username, password });
  }

  getAllAppointments(
    statusFilter?: string,
    search?: string,
    page = 0,
    size = 10,
  ): Observable<AppointmentDashboardResponse> {
    let params = new HttpParams();
    if (statusFilter && statusFilter !== 'all') {
      params = params.set('status', statusFilter.toUpperCase());
    }
    if (search) {
      params = params.set('search', search);
    }
    params = params.set('page', page.toString());
    params = params.set('size', size.toString());
    return this.http.get<AppointmentDashboardResponse>(this.apiUrl, { params });
  }

  getAppointmentById(id: number): Observable<AppointmentItem> {
    return this.http.get<AppointmentItem>(`${this.apiUrl}/${id}`);
  }

  createAppointment(request: AppointmentCreateRequest): Observable<AppointmentItem> {
    return this.http.post<AppointmentItem>(this.apiUrl, request);
  }

  getBusySlots(barberName: string, bookingDate: string): Observable<string[]> {
    let params = new HttpParams().set('barberName', barberName).set('bookingDate', bookingDate);
    return this.http.get<string[]>(`${this.apiUrl}/public/busy-slots`, { params });
  }

  publicCancelAppointment(publicId: string, email: string): Observable<void> {
    let params = new HttpParams().set('email', email);
    return this.http.put<void>(`${this.apiUrl}/public/cancel/${publicId}`, null, { params });
  }

  updateAppointmentStatus(id: number, statusValue: string): Observable<AppointmentItem> {
    const request: AppointmentUpdateRequest = { status: statusValue };
    return this.http.put<AppointmentItem>(`${this.apiUrl}/${id}`, request);
  }

  deleteAppointment(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }
}
