package com.example.taskflow.appointment;

import com.example.taskflow.catalog.ServiceItem;
import com.example.taskflow.core.StringTimeConverter;
import jakarta.persistence.*;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.format.DateTimeParseException;
import java.util.UUID;

@Entity
@Table(name = "appointments", indexes = {
    @Index(name = "idx_appointment_status", columnList = "status"),
    @Index(name = "idx_appointments_booking_date", columnList = "booking_date"),
    @Index(name = "idx_appointment_public_id", columnList = "public_id", unique = true),
    @Index(name = "idx_appointment_barber_date", columnList = "barber_name,booking_date"),
    @Index(name = "idx_appointment_status_date", columnList = "status,booking_date"),
    @Index(name = "idx_appointments_customer_email", columnList = "customer_email"),
    @Index(name = "idx_appointments_barber_id", columnList = "barber_id"),
    @Index(name = "idx_appointments_service_id", columnList = "service_id")
})
public class Appointment {

    /**
     * Length assumed for an appointment that has no service (or a service without a positive
     * duration): one grid step, so such a row still blocks at least its own slot.
     */
    public static final int DEFAULT_DURATION_MINUTES = 60;

    /**
     * Latest representable end of an appointment. A booking never crosses midnight (it must end by
     * the barber's closing time), so an end past midnight can only come from a corrupt legacy row;
     * it is clamped here instead of wrapping to the next morning. V35 applies the same rule.
     */
    static final LocalTime LATEST_END_TIME = LocalTime.of(23, 59, 59);

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "public_id", nullable = false, unique = true, length = 36)
    @Size(max = 36)
    private String publicId;

    @Column(name = "idempotency_key", unique = true, length = 100)
    @Size(max = 100)
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

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "barber_id", foreignKey = @ForeignKey(name = "fk_appointment_barber"))
    private Barber barber;

    @NotNull(message = "Booking date is required")
    @Column(name = "booking_date", nullable = false)
    private LocalDate bookingDate;

    @NotBlank(message = "Booking time is required")
    @Pattern(regexp = "^(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d)?$", message = "Booking time must be in HH:mm or HH:mm:ss format")
    @Convert(converter = StringTimeConverter.class)
    @Column(name = "booking_time", nullable = false, columnDefinition = "TIME")
    private String bookingTime;

    /**
     * End of the booked interval {@code [bookingTime, bookingEndTime)}: start + the service's
     * duration when the booking was made (a snapshot, like {@link #priceAtBooking}). Derived by the
     * entity whenever the start time or the service changes, and backing the PostgreSQL
     * {@code appointments_no_overlap} exclusion constraint (V35).
     */
    @Column(name = "booking_end_time", nullable = false)
    private LocalTime bookingEndTime;

    @NotBlank(message = "Service type is required")
    @Size(max = 100)
    @Column(name = "service_type", nullable = false, length = 100)
    private String serviceType;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "service_id", foreignKey = @ForeignKey(name = "fk_appointment_service"))
    private ServiceItem service;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 50)
    private AppointmentStatus status = AppointmentStatus.PENDING;

    /**
     * The service price at the moment of booking. Revenue uses this snapshot so a
     * later catalog price change does not rewrite history; null on legacy rows
     * that had no service reference (revenue then falls back to the live price).
     */
    @Column(name = "price_at_booking", precision = 10, scale = 2)
    private BigDecimal priceAtBooking;

    /** Optimistic lock: concurrent approve/deny/cancel cannot silently interleave. */
    @Version
    @Column(nullable = false)
    private Long version;

    @Column(name = "reminder_sent", nullable = false)
    private Boolean reminderSent = false;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    @PrePersist
    protected void onCreate() {
        if (this.publicId == null || this.publicId.isBlank()) {
            this.publicId = UUID.randomUUID().toString();
        }
        if (this.bookingEndTime == null) {
            deriveEndTime();
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
        deriveEndTime();
    }

    /**
     * End of an appointment that starts at {@code start} and lasts {@code durationMinutes}, clamped
     * to {@link #LATEST_END_TIME} (never before {@code start}) instead of wrapping past midnight.
     */
    public static LocalTime endTimeOf(LocalTime start, int durationMinutes) {
        long endSecond = start.toSecondOfDay() + durationMinutes * 60L;
        if (endSecond > LATEST_END_TIME.toSecondOfDay()) {
            return start.isAfter(LATEST_END_TIME) ? start : LATEST_END_TIME;
        }
        return start.plusMinutes(durationMinutes);
    }

    /** Duration of a service in minutes, or {@link #DEFAULT_DURATION_MINUTES} when it has none. */
    public static int durationOf(ServiceItem service) {
        if (service != null && service.getDurationMinutes() != null && service.getDurationMinutes() > 0) {
            return service.getDurationMinutes();
        }
        return DEFAULT_DURATION_MINUTES;
    }

    /** Recomputes {@link #bookingEndTime} from the start time and the service (left as is while the start is unparseable). */
    private void deriveEndTime() {
        if (bookingTime == null || bookingTime.isBlank()) {
            return;
        }
        try {
            this.bookingEndTime = endTimeOf(LocalTime.parse(bookingTime.trim()), durationOf(service));
        } catch (DateTimeParseException e) {
            // Bean Validation (@Pattern) rejects the row before it is written.
        }
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
        deriveEndTime();
    }

    public LocalTime getBookingEndTime() {
        return bookingEndTime;
    }

    /** Overrides the derived end time (the booking flow sets the exact interval it validated). */
    public void setBookingEndTime(LocalTime bookingEndTime) {
        this.bookingEndTime = bookingEndTime;
    }

    public String getServiceType() {
        return serviceType;
    }

    public void setServiceType(String serviceType) {
        this.serviceType = serviceType;
    }

    public Barber getBarber() {
        return barber;
    }

    public void setBarber(Barber barber) {
        this.barber = barber;
    }

    public ServiceItem getService() {
        return service;
    }

    public void setService(ServiceItem service) {
        this.service = service;
        deriveEndTime();
    }

    public BigDecimal getPriceAtBooking() {
        return priceAtBooking;
    }

    public void setPriceAtBooking(BigDecimal priceAtBooking) {
        this.priceAtBooking = priceAtBooking;
    }

    public Long getVersion() {
        return version;
    }

    public String getStatus() {
        return status != null ? status.name() : AppointmentStatus.PENDING.name();
    }

    public AppointmentStatus getStatusEnum() {
        return status;
    }

    public void setStatus(String status) {
        this.status = AppointmentStatus.fromString(status);
    }

    public void setStatus(AppointmentStatus status) {
        this.status = status != null ? status : AppointmentStatus.PENDING;
    }

    public Boolean getReminderSent() {
        return reminderSent;
    }

    public void setReminderSent(Boolean reminderSent) {
        this.reminderSent = reminderSent;
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
