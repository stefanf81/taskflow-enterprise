package com.example.taskflow.appointment;

import org.springframework.context.ApplicationContext;

/**
 * Test-only access to the package-private booking and lifecycle services for tests outside this
 * package (the {@code benchmark} suite), which used to call them through {@link AppointmentService}
 * before that became the small cross-module API.
 */
public final class AppointmentTestAccess {

    private final AppointmentBookingService booking;
    private final AppointmentLifecycleService lifecycle;

    public AppointmentTestAccess(ApplicationContext context) {
        this.booking = context.getBean(AppointmentBookingService.class);
        this.lifecycle = context.getBean(AppointmentLifecycleService.class);
    }

    public AppointmentCreationResult createAppointment(AppointmentCreateRequest request, String idempotencyKey) {
        return booking.createAppointment(request, idempotencyKey);
    }

    public AppointmentResponse updateAppointmentStatus(Long id, AppointmentUpdateRequest request) {
        return lifecycle.updateAppointmentStatus(id, request);
    }
}
