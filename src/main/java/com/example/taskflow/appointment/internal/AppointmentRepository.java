package com.example.taskflow.appointment.internal;

import com.example.taskflow.appointment.Appointment;
import com.example.taskflow.appointment.AppointmentStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.util.List;

@Repository
public interface AppointmentRepository
        extends JpaRepository<Appointment, Long>, JpaSpecificationExecutor<Appointment> {

    Appointment findByPublicId(String publicId);

    Appointment findByIdempotencyKey(String idempotencyKey);

    /**
     * Case-insensitive e-mail match with an explicit {@code lower(col) = lower(:email)} so
     * PostgreSQL can use the functional index from V28 (the derived
     * {@code IgnoreCase} query generates {@code upper(col) = upper(?)}, which no plain
     * B-tree index can serve).
     */
    @Query(value = "SELECT a FROM Appointment a WHERE lower(a.customerEmail) = lower(:email)",
            countQuery = "SELECT COUNT(a) FROM Appointment a WHERE lower(a.customerEmail) = lower(:email)")
    Page<Appointment> findByCustomerEmailIgnoreCase(@Param("email") String email, Pageable pageable);

    /**
     * Number of PENDING/APPROVED bookings an e-mail address holds that have not started yet:
     * later dates, or today at/after {@code fromTime} (HH:mm). A booking that already took
     * place earlier today no longer counts; cancelled and declined bookings never do.
     */
    @Query("""
        SELECT COUNT(a) FROM Appointment a
        WHERE lower(a.customerEmail) = lower(:email)
          AND (a.bookingDate > :today OR (a.bookingDate = :today AND a.bookingTime >= :fromTime))
          AND a.status IN (com.example.taskflow.appointment.AppointmentStatus.PENDING,
                           com.example.taskflow.appointment.AppointmentStatus.APPROVED)
    """)
    long countUpcoming(@Param("email") String email, @Param("today") LocalDate today,
                       @Param("fromTime") String fromTime);

    @Query("SELECT a.id FROM Appointment a WHERE a.bookingDate = :date AND a.reminderSent = :reminderSent AND a.status = :status")
    List<Long> findReminderIds(@Param("date") LocalDate date,
                               @Param("reminderSent") boolean reminderSent,
                               @Param("status") AppointmentStatus status);

    @org.springframework.data.jpa.repository.Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT a FROM Appointment a WHERE a.id = :id")
    java.util.Optional<Appointment> findByIdForUpdate(@Param("id") Long id);

    /**
     * PENDING/APPROVED appointments of one barber on one date, with the service
     * (duration) fetched so overlap checks do not issue a query per row.
     */
    @Query("""
        SELECT a FROM Appointment a LEFT JOIN FETCH a.service
        WHERE a.barberName = :barberName
          AND a.bookingDate = :bookingDate
          AND a.status IN (com.example.taskflow.appointment.AppointmentStatus.PENDING,
                           com.example.taskflow.appointment.AppointmentStatus.APPROVED)
        ORDER BY a.bookingTime
    """)
    List<Appointment> findActiveForBarberOnDate(@Param("barberName") String barberName,
                                                @Param("bookingDate") LocalDate bookingDate);

    /** PENDING/APPROVED appointments of every barber on one date (used by "No Preference"). */
    @Query("""
        SELECT a FROM Appointment a LEFT JOIN FETCH a.service
        WHERE a.bookingDate = :bookingDate
          AND a.status IN (com.example.taskflow.appointment.AppointmentStatus.PENDING,
                           com.example.taskflow.appointment.AppointmentStatus.APPROVED)
        ORDER BY a.bookingTime
    """)
    List<Appointment> findActiveOnDate(@Param("bookingDate") LocalDate bookingDate);

    /** PENDING/APPROVED appointments of one barber within an inclusive date range. */
    @Query("""
        SELECT a FROM Appointment a LEFT JOIN FETCH a.service
        WHERE a.barberName = :barberName
          AND a.bookingDate >= :startDate
          AND a.bookingDate <= :endDate
          AND a.status IN (com.example.taskflow.appointment.AppointmentStatus.PENDING,
                           com.example.taskflow.appointment.AppointmentStatus.APPROVED)
        ORDER BY a.bookingDate, a.bookingTime
    """)
    List<Appointment> findActiveForBarberInRange(@Param("barberName") String barberName,
                                                 @Param("startDate") LocalDate startDate,
                                                 @Param("endDate") LocalDate endDate);

    /**
     * Dashboard counters. Every SUM is wrapped in COALESCE: SUM over an empty table is
     * NULL, which previously failed to map onto the primitive record components and made
     * the admin listing return 500 until the first booking existed. {@code total} excludes
     * cancelled bookings (a cancelled booking used to be deleted and never counted).
     * Revenue uses the price snapshotted at booking time and only falls back to the live
     * service price for legacy rows that have none.
     */
    @Query("SELECT new com.example.taskflow.appointment.AppointmentStats(" +
            "COALESCE(SUM(CASE WHEN a.status <> com.example.taskflow.appointment.AppointmentStatus.CANCELLED THEN 1 ELSE 0 END), 0L), " +
            "COALESCE(SUM(CASE WHEN a.status = com.example.taskflow.appointment.AppointmentStatus.PENDING THEN 1 ELSE 0 END), 0L), " +
            "COALESCE(SUM(CASE WHEN a.status = com.example.taskflow.appointment.AppointmentStatus.APPROVED THEN 1 ELSE 0 END), 0L), " +
            "COALESCE(SUM(CASE WHEN a.status = com.example.taskflow.appointment.AppointmentStatus.DENIED THEN 1 ELSE 0 END), 0L), " +
            "COALESCE(SUM(CASE WHEN a.status = com.example.taskflow.appointment.AppointmentStatus.PENDING AND a.bookingDate < :now THEN 1 ELSE 0 END), 0L), " +
            "0, " +
            "COALESCE(SUM(CASE WHEN a.status = com.example.taskflow.appointment.AppointmentStatus.APPROVED THEN CAST(COALESCE(a.priceAtBooking, s.price) AS double) ELSE 0.0 END), 0.0)) " +
            "FROM Appointment a LEFT JOIN a.service s")
    com.example.taskflow.appointment.AppointmentStats getAppointmentStats(@Param("now") LocalDate now);
}
