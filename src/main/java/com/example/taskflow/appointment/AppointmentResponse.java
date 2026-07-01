package com.example.taskflow.appointment;

import java.time.LocalDate;
import java.time.LocalDateTime;

public record AppointmentResponse(
    Long id,
    String publicId,
    String customerName,
    String customerEmail,
    String customerPhone,
    String barberName,
    LocalDate bookingDate,
    String bookingTime,
    String serviceType,
    String status,
    LocalDateTime createdAt,
    LocalDateTime updatedAt
) {
    public static AppointmentResponse fromEntity(Appointment item) {
        if (item == null) {
            return null;
        }
        return new AppointmentResponse(
            item.getId(),
            item.getPublicId(),
            item.getCustomerName(),
            item.getCustomerEmail(),
            item.getCustomerPhone(),
            item.getBarberName(),
            item.getBookingDate(),
            item.getBookingTime(),
            item.getServiceType(),
            item.getStatus(),
            item.getCreatedAt(),
            item.getUpdatedAt()
        );
    }
}
