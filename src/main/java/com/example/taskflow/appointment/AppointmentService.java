package com.example.taskflow.appointment;

public interface AppointmentService {
    AppointmentDashboardResponse getAllAppointments(String status, String searchName, int page, int size);
    AppointmentResponse getAppointmentById(Long id);
    org.springframework.data.domain.Page<AppointmentResponse> getMyAppointments(String email, int page, int size);
    void cancelMyAppointment(Long id, String email);
    AppointmentResponse createAppointment(AppointmentCreateRequest request, String idempotencyKey);
    AppointmentResponse updateAppointmentStatus(Long id, AppointmentUpdateRequest request);
    void deleteAppointment(Long id);
    java.util.List<String> getBusySlots(String barberName, String bookingDate);
    void publicCancelAppointment(String publicId, String email);
    Appointment findByPublicId(String publicId);
}
