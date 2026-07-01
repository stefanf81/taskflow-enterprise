package com.example.taskflow.appointment;

import jakarta.persistence.*;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "appointments", indexes = {
    @Index(name = "idx_appointment_status", columnList = "status"),
    @Index(name = "idx_appointment_date", columnList = "booking_date"),
    @Index(name = "idx_appointment_public_id", columnList = "public_id", unique = true),
    @Index(name = "idx_appointment_barber_date_status", columnList = "barber_name,booking_date,status"),
    @Index(name = "idx_appointment_status_customer_name", columnList = "status,customer_name"),
    @Index(name = "idx_appointment_status_date", columnList = "status,booking_date")
})
public class Appointment {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "public_id", nullable = false, unique = true, length = 36)
    private String publicId;

    @Column(name = "idempotency_key", unique = true, length = 100)
    private String idempotencyKey;

    @NotBlank(message = "Customer name is required")
    @Size(max = 100)
    @Column(name = "customer_name", nullable = false, length = 100)
    private String customerName;

    @NotBlank(message = "Customer email is required")
    @Size(max = 100)
    @Column(name = "customer_email", nullable = false, length = 100)
    private String customerEmail;

    @NotBlank(message = "Customer phone is required")
    @Size(max = 50)
    @Column(name = "customer_phone", nullable = false, length = 50)
    private String customerPhone;

    @NotBlank(message = "Barber name is required")
    @Size(max = 100)
    @Column(name = "barber_name", nullable = false, length = 100)
    private String barberName;

    @NotNull(message = "Booking date is required")
    @Column(name = "booking_date", nullable = false)
    private LocalDate bookingDate;

    @NotBlank(message = "Booking time is required")
    @Size(max = 50)
    @Column(name = "booking_time", nullable = false, length = 50)
    private String bookingTime;

    @NotBlank(message = "Service type is required")
    @Size(max = 100)
    @Column(name = "service_type", nullable = false, length = 100)
    private String serviceType;

    @NotBlank(message = "Status is required")
    @Size(max = 50)
    @Column(nullable = false, length = 50)
    private String status = "PENDING";

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    @PrePersist
    protected void onCreate() {
        if (this.publicId == null || this.publicId.isBlank()) {
            this.publicId = UUID.randomUUID().toString();
        }
        createdAt = LocalDateTime.now();
        updatedAt = LocalDateTime.now();
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = LocalDateTime.now();
    }

    public Appointment() {
    }

    public Appointment(String customerName, String customerEmail, String customerPhone, String barberName, LocalDate bookingDate, String bookingTime, String serviceType) {
        this.customerName = customerName;
        this.customerEmail = customerEmail;
        this.customerPhone = customerPhone;
        this.barberName = barberName;
        this.bookingDate = bookingDate;
        this.bookingTime = bookingTime;
        this.serviceType = serviceType;
    }

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getPublicId() {
        return publicId;
    }

    public void setPublicId(String publicId) {
        this.publicId = publicId;
    }

    public String getIdempotencyKey() {
        return idempotencyKey;
    }

    public void setIdempotencyKey(String idempotencyKey) {
        this.idempotencyKey = idempotencyKey;
    }

    public String getCustomerName() {
        return customerName;
    }

    public void setCustomerName(String customerName) {
        this.customerName = customerName;
    }

    public String getCustomerEmail() {
        return customerEmail;
    }

    public void setCustomerEmail(String customerEmail) {
        this.customerEmail = customerEmail;
    }

    public String getCustomerPhone() {
        return customerPhone;
    }

    public void setCustomerPhone(String customerPhone) {
        this.customerPhone = customerPhone;
    }

    public String getBarberName() {
        return barberName;
    }

    public void setBarberName(String barberName) {
        this.barberName = barberName;
    }

    public LocalDate getBookingDate() {
        return bookingDate;
    }

    public void setBookingDate(LocalDate bookingDate) {
        this.bookingDate = bookingDate;
    }

    public String getBookingTime() {
        return bookingTime;
    }

    public void setBookingTime(String bookingTime) {
        this.bookingTime = bookingTime;
    }

    public String getServiceType() {
        return serviceType;
    }

    public void setServiceType(String serviceType) {
        this.serviceType = serviceType;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
    }
}
