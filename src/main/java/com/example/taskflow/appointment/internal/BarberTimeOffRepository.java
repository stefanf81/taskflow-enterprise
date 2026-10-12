package com.example.taskflow.appointment.internal;

import com.example.taskflow.appointment.BarberTimeOff;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.util.Collection;
import java.util.List;

@Repository
public interface BarberTimeOffRepository extends JpaRepository<BarberTimeOff, Long> {
    
    List<BarberTimeOff> findByBarberId(Long barberId);

    @Query("SELECT t FROM BarberTimeOff t WHERE t.barber.id = :barberId AND :date >= t.startDate AND :date <= t.endDate")
    List<BarberTimeOff> findTimeOffForBarberOnDate(@Param("barberId") Long barberId, @Param("date") LocalDate date);

    /** Ids of the given barbers who have time off covering {@code date} (one query for any number of barbers). */
    @Query("SELECT DISTINCT t.barber.id FROM BarberTimeOff t "
            + "WHERE t.barber.id IN :barberIds AND :date >= t.startDate AND :date <= t.endDate")
    List<Long> findBarberIdsOnTimeOff(@Param("barberIds") Collection<Long> barberIds, @Param("date") LocalDate date);
}
