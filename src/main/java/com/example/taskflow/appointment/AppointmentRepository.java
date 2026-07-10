package com.example.taskflow.appointment;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;

@Repository
public interface AppointmentRepository extends JpaRepository<Appointment, Long> {
    Page<Appointment> findByStatus(String status, Pageable pageable);
    Page<Appointment> findByCustomerNameContainingIgnoreCase(String customerName, Pageable pageable);
    Page<Appointment> findByStatusAndCustomerNameContainingIgnoreCase(String status, String customerName, Pageable pageable);
    Page<Appointment> findByStatusAndBookingDateBefore(String status, LocalDate date, Pageable pageable);
    
    Appointment findByPublicId(String publicId);
    
    Appointment findByIdempotencyKey(String idempotencyKey);
    
    Page<Appointment> findByCustomerEmailIgnoreCase(String customerEmail, Pageable pageable);
    
    @org.springframework.data.jpa.repository.Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT a FROM Appointment a WHERE a.bookingDate = :date AND a.reminderSent = :reminderSent AND a.status = :status")
    java.util.List<Appointment> findForReminderWithLock(@Param("date") LocalDate date, 
                                                         @Param("reminderSent") boolean reminderSent, 
                                                         @Param("status") String status);
    
    @Query(value = "SELECT DISTINCT a.booking_time FROM appointments a WHERE a.barber_name = :barberName AND a.booking_date = :bookingDate AND a.status <> :status ORDER BY a.booking_time LIMIT 500", 
           nativeQuery = true)
    java.util.List<String> findDistinctBookingTimes(@Param("barberName") String barberName, 
                                                     @Param("bookingDate") LocalDate bookingDate, 
                                                     @Param("status") String status);
    
    @Query("SELECT new com.example.taskflow.appointment.AppointmentStats(" +
            "COUNT(a), " +
            "SUM(CASE WHEN a.status = 'PENDING' THEN 1 ELSE 0 END), " +
            "SUM(CASE WHEN a.status = 'APPROVED' THEN 1 ELSE 0 END), " +
            "SUM(CASE WHEN a.status = 'DENIED' THEN 1 ELSE 0 END), " +
            "SUM(CASE WHEN a.status = 'PENDING' AND a.bookingDate < :now THEN 1 ELSE 0 END), " +
            "0, " +
            "COALESCE(SUM(CASE WHEN a.status = 'APPROVED' THEN CAST(s.price AS double) ELSE 0.0 END), 0.0)) " +
            "FROM Appointment a LEFT JOIN ServiceItem s ON s.name = a.serviceType")
    com.example.taskflow.appointment.AppointmentStats getAppointmentStats(@Param("now") LocalDate now);
}
