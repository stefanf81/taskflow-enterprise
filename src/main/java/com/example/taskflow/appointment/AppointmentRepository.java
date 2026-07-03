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
    
    java.util.List<Appointment> findByBookingDateAndReminderSentFalseAndStatus(LocalDate date, String status);
    
    @Query("SELECT COUNT(a) > 0 FROM Appointment a WHERE a.id = :id AND LOWER(a.customerEmail) = LOWER(:email)")
    boolean existsByIdAndCustomerEmailIgnoreCase(@Param("id") Long id, @Param("email") String email);

    long countByStatus(String status);
    long countByStatusAndBookingDateBefore(String status, LocalDate date);
    
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
            "COALESCE(SUM(CASE WHEN a.status = 'APPROVED' THEN " +
            "(SELECT s.price FROM ServiceItem s WHERE s.name = a.serviceType) ELSE 0.0 END), 0.0)) " +
            "FROM Appointment a")
    com.example.taskflow.appointment.AppointmentStats getAppointmentStats(@Param("now") LocalDate now);

    @Query("SELECT COALESCE(SUM(CASE WHEN a.status = 'APPROVED' THEN " +
            "(SELECT s.price FROM ServiceItem s WHERE s.name = a.serviceType) ELSE 0.0 END), 0.0) " +
            "FROM Appointment a")
    double sumApprovedRevenue();
}
