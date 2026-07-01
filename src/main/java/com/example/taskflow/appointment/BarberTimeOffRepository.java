package com.example.taskflow.appointment;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.util.List;

@Repository
public interface BarberTimeOffRepository extends JpaRepository<BarberTimeOff, Long> {
    
    @Query("SELECT t FROM BarberTimeOff t WHERE t.barber.id = :barberId AND :date >= t.startDate AND :date <= t.endDate")
    List<BarberTimeOff> findTimeOffForBarberOnDate(@Param("barberId") Long barberId, @Param("date") LocalDate date);
}
