/**
 * Single Source of Truth API Contracts for TaskFlow.
 * Auto-generated from Backend OpenAPI schema (GET /v3/api-docs).
 *
 * DO NOT EDIT MANUALLY — run `npm run sync:api-types` to regenerate.
 */

export interface AppointmentCreateRequest {
  barberName: string;
  bookingDate: string;
  bookingTime: string;
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  serviceType: string;
}

export interface AppointmentDashboardResponse {
  page: PageObject;
  stats: AppointmentStats;
}

export interface AppointmentResponse {
  barberName: string;
  bookingDate: string;
  bookingTime: string;
  createdAt: string;
  customerEmail: string;
  customerName: string;
  customerPhone: string;
  id: number;
  publicId: string;
  serviceType: string;
  status: string;
  updatedAt: string;
}

export interface AppointmentStats {
  approved: number;
  approvedRevenue: number;
  denied: number;
  overdue: number;
  pending: number;
  progress: number;
  total: number;
}

export interface AppointmentUpdateRequest {
  status: "APPROVED" | "DENIED";
}

export interface BarberRatingResponse {
  averageRating: number;
  barberName: string;
  reviewCount: number;
}

export interface BarberRequest {
  email?: string;
  name: string;
  phone?: string;
}

export interface BarberResponse {
  email: string;
  id: number;
  name: string;
  phone: string;
}

export interface BarberTimeOffRequest {
  endDate: string;
  reason?: string;
  startDate: string;
}

export interface BarberTimeOffResponse {
  endDate: string;
  id: number;
  reason: string;
  startDate: string;
}

export interface CancelRequest {
  email: string;
}

export interface CsrfToken {
  headerName?: string;
  parameterName?: string;
  token?: string;
}

export interface LoginRequest {
  password: string;
  username: string;
}

export interface LoginResponse {
  role: "ROLE_ADMIN" | "ROLE_CUSTOMER";
  username: string;
}

export interface MobileLoginResponse {
  accessToken: string;
  expiresIn: number;
  role: "ROLE_ADMIN" | "ROLE_CUSTOMER";
  tokenType: "Bearer";
  username: string;
}

export interface NotificationOutboxResponse {
  id: number;
  message: string;
  recipient: string;
  retryCount: number;
  sentAt: string;
  status: string;
  type: string;
}

export interface PageableObject {
  offset: number;
  paged: boolean;
  pageNumber: number;
  pageSize: number;
  sort: SortObject;
  unpaged: boolean;
}

export interface PagedModelAppointmentResponse {
  content: AppointmentResponse[];
  page: PageMetadata;
}

export interface PageMetadata {
  number: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

export interface PageObject {
  content: AppointmentResponse[];
  empty: boolean;
  first: boolean;
  last: boolean;
  number: number;
  numberOfElements: number;
  pageable: PageableObject;
  size: number;
  sort: SortObject;
  totalElements: number;
  totalPages: number;
}

export interface RegisterRequest {
  email: string;
  fullName: string;
  password: string;
  phone: string;
}

export interface RegisterResponse {
  message: string;
}

export interface ReviewRequest {
  comment?: string;
  customerEmail: string;
  rating: number;
}

export interface ServiceItemRequest {
  category: string;
  description?: string;
  durationMinutes: number;
  name: string;
  price: number;
}

export interface ServiceItemResponse {
  category: string;
  description: string;
  durationMinutes: number;
  id: number;
  name: string;
  price: number;
}

export interface SortObject {
  empty: boolean;
  sorted: boolean;
  unsorted: boolean;
}

export interface SseEmitter {
  timeout?: number;
}

export type AppointmentItem = AppointmentResponse;
export type AppointmentPage = PageObject;
export type Barber = BarberResponse;
export type BarberRating = BarberRatingResponse;
export type BarberTimeOff = BarberTimeOffResponse;
export type NotificationItem = NotificationOutboxResponse;
export type PublicCancelRequest = CancelRequest;
export type ServiceItem = ServiceItemResponse;
