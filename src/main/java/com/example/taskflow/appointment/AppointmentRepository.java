package com.example.taskflow.appointment;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;

@Repository
public interface AppointmentRepository extends JpaRepository<Appointment, Long> {
    Page<Appointment> findByStatus(AppointmentStatus status, Pageable pageable);
    Page<Appointment> findByCustomerNameContainingIgnoreCase(String customerName, Pageable pageable);
    Page<Appointment> findByStatusAndCustomerNameContainingIgnoreCase(AppointmentStatus status, String customerName, Pageable pageable);
    Page<Appointment> findByStatusAndBookingDateBefore(AppointmentStatus status, LocalDate date, Pageable pageable);
    
    Appointment findByPublicId(String publicId);
    
    Appointment findByIdempotencyKey(String idempotencyKey);
    
    Page<Appointment> findByCustomerEmailIgnoreCase(String customerEmail, Pageable pageable);
    
    @Query("SELECT a.id FROM Appointment a WHERE a.bookingDate = :date AND a.reminderSent = :reminderSent AND a.status = :status")
    java.util.List<Long> findReminderIds(@Param("date") LocalDate date,
                                         @Param("reminderSent") boolean reminderSent,
                                         @Param("status") AppointmentStatus status);

    @org.springframework.data.jpa.repository.Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT a FROM Appointment a WHERE a.id = :id")
    java.util.Optional<Appointment> findByIdForUpdate(@Param("id") Long id);
    
    // V22 migrated booking_time from VARCHAR to TIME. PostgreSQL's substr()
    // does not accept TIME arguments, so we must first CAST the column to a
    // character type before applying SUBSTRING.
    @Query("""
        SELECT DISTINCT SUBSTRING(CAST(a.bookingTime AS string), 1, 5)
        FROM Appointment a
        WHERE a.barberName = :barberName
          AND a.bookingDate = :bookingDate
          AND a.status <> :status
        ORDER BY SUBSTRING(CAST(a.bookingTime AS string), 1, 5)
    """)
    java.util.List<String> findDistinctBookingTimes(@Param("barberName") String barberName, 
                                                     @Param("bookingDate") LocalDate bookingDate, 
                                                     @Param("status") AppointmentStatus status);
    
    @Query("SELECT new com.example.taskflow.appointment.AppointmentStats(" +
            "COUNT(a), " +
            "SUM(CASE WHEN a.status = com.example.taskflow.appointment.AppointmentStatus.PENDING THEN 1 ELSE 0 END), " +
            "SUM(CASE WHEN a.status = com.example.taskflow.appointment.AppointmentStatus.APPROVED THEN 1 ELSE 0 END), " +
            "SUM(CASE WHEN a.status = com.example.taskflow.appointment.AppointmentStatus.DENIED THEN 1 ELSE 0 END), " +
            "SUM(CASE WHEN a.status = com.example.taskflow.appointment.AppointmentStatus.PENDING AND a.bookingDate < :now THEN 1 ELSE 0 END), " +
            "0, " +
            "COALESCE(SUM(CASE WHEN a.status = com.example.taskflow.appointment.AppointmentStatus.APPROVED THEN CAST(s.price AS double) ELSE 0.0 END), 0.0)) " +
            "FROM Appointment a LEFT JOIN a.service s")
    com.example.taskflow.appointment.AppointmentStats getAppointmentStats(@Param("now") LocalDate now);
}
