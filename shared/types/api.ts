/**
 * Single Source of Truth API Contracts for TaskFlow.
 * Auto-aligned with Backend OpenAPI schema (GET /v3/api-docs).
 */

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
  status: 'PENDING' | 'APPROVED' | 'DENIED' | 'CANCELLED';
  createdAt: string;
  updatedAt: string;
}

export type AppointmentResponse = AppointmentItem;

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
  status: 'APPROVED' | 'DENIED';
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

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  username: string;
  role: 'ROLE_ADMIN' | 'ROLE_CUSTOMER';
  token?: string;
}

export interface RegisterRequest {
  fullName: string;
  email: string;
  password: string;
  phone: string;
}

export interface RegisterResponse {
  message: string;
}

export interface ServiceItem {
  id: number;
  name: string;
  price: number;
  durationMinutes: number;
  category: string;
  description: string;
}

export type ServiceItemResponse = ServiceItem;

export interface ServiceItemRequest {
  name: string;
  price: number;
  durationMinutes: number;
  category: string;
  description?: string;
}

export interface Barber {
  id: number;
  name: string;
  email: string;
  phone: string;
}

export type BarberResponse = Barber;

export interface BarberRequest {
  name: string;
  email?: string;
  phone?: string;
}

export interface BarberTimeOff {
  id?: number;
  startDate: string;
  endDate: string;
  reason: string;
}

export interface BarberTimeOffRequest {
  startDate: string;
  endDate: string;
  reason: string;
  dateRangeValid?: boolean;
}

export interface NotificationItem {
  id: number;
  recipient: string;
  type: string;
  message: string;
  sentAt: string;
  status: string;
  retryCount?: number;
}

export type NotificationOutboxResponse = NotificationItem;

export interface BarberRating {
  barberName: string;
  averageRating: number;
  reviewCount: number;
}

export type BarberRatingResponse = BarberRating;

export interface ReviewRequest {
  rating: number;
  comment: string;
}

export interface PublicCancelRequest {
  email: string;
}

export type CancelRequest = PublicCancelRequest;
