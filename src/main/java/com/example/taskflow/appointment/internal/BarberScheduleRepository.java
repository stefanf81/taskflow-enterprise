package com.example.taskflow.appointment.internal;

import com.example.taskflow.appointment.BarberSchedule;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

@Repository
public interface BarberScheduleRepository extends JpaRepository<BarberSchedule, Long> {
    Optional<BarberSchedule> findByBarberIdAndDayOfWeek(Long barberId, Integer dayOfWeek);

    /**
     * The schedule rows of the given barbers for one weekday (at most one per barber, V6 unique key),
     * with the barber fetched so callers can key them by barber id without further queries.
     */
    @Query("SELECT s FROM BarberSchedule s JOIN FETCH s.barber b WHERE s.dayOfWeek = :dayOfWeek AND b.id IN :barberIds")
    List<BarberSchedule> findForBarbersOnDay(@Param("barberIds") Collection<Long> barberIds,
                                             @Param("dayOfWeek") Integer dayOfWeek);
}
