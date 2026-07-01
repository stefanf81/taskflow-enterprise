package com.example.taskflow.appointment;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface BarberScheduleRepository extends JpaRepository<BarberSchedule, Long> {
    Optional<BarberSchedule> findByBarberIdAndDayOfWeek(Long barberId, Integer dayOfWeek);
}
