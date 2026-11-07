/**
 * API DTO types of TaskFlow, generated from the reviewed baseline api/openapi.json.
 * Both clients re-export them from their own types/api.ts.
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
  page: PagedModelAppointmentResponse;
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

export interface BarberScheduleResponse {
  days: ScheduleDay[];
  revision: string;
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

export interface CalendarExportRequest {
  email: string;
}

export interface CalendarExportResponse {
  content: string;
  filename: string;
}

export interface CancelRequest {
  email: string;
}

export interface ClientTelemetryEvent {
  name?: "LCP" | "FCP" | "CLS" | "INP" | "SCREEN_LOAD" | "JS_ERROR" | "UNHANDLED_REJECTION" | "RENDER_ERROR";
  platform?: "WEB" | "MOBILE";
  route?: "LANDING" | "BOOKING" | "CUSTOMER" | "ADMIN" | "AUTH" | "OTHER";
  value?: number;
}

export interface CsrfToken {
  headerName?: string;
  parameterName?: string;
  token?: string;
}

export interface ErrorResponse {
  detail: string;
  error: string;
  instance: string;
  message: string;
  path: string;
  status: number;
  timestamp: string;
  title: string;
  type: string;
  validationErrors?: ValidationError[];
}

export interface GuestRescheduleRequest {
  bookingDate: string;
  bookingTime: string;
  email: string;
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
  refreshToken?: string;
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

export interface OpeningHoursResponse {
  closes: string;
  dayOfWeek: number;
  opens: string;
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

export interface PublicBarberResponse {
  id: number;
  name: string;
}

export interface RefreshRequest {
  refreshToken: string;
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

export interface RescheduleAvailabilityRequest {
  bookingDate: string;
  email: string;
}

export interface RescheduleRequest {
  bookingDate: string;
  bookingTime: string;
}

export interface ReviewRequest {
  comment?: string;
  customerEmail: string;
  rating: number;
}

export interface ScheduleChangeRequest {
  cancelConflictingAppointments?: boolean;
  days: ScheduleDay[];
  expectedConflicts?: string;
  expectedRevision: string;
}

export interface ScheduleDay {
  closes: string;
  dayOfWeek: number;
  opens: string;
}

export interface SchedulePreviewResponse {
  conflictCount: number;
  conflictsRevision: string;
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

export interface ShopInfoResponse {
  maxAdvanceDays: number;
  openingHours: OpeningHoursResponse[];
  timeZone: string;
}

export interface SseEmitter {
  timeout?: number;
}

export interface ValidationError {
  field: string;
  message: string;
}

export type AppointmentItem = AppointmentResponse;
export type AppointmentPage = PagedModelAppointmentResponse;
export type Barber = BarberResponse;
export type PublicBarber = PublicBarberResponse;
export type BarberRating = BarberRatingResponse;
export type BarberTimeOff = BarberTimeOffResponse;
export type NotificationItem = NotificationOutboxResponse;
export type PublicCancelRequest = CancelRequest;
export type ServiceItem = ServiceItemResponse;
