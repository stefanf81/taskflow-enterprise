package com.example.taskflow.appointment.internal;

import com.example.taskflow.appointment.BarberSchedule;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

@Repository
public interface BarberScheduleRepository extends JpaRepository<BarberSchedule, Long> {
    Optional<BarberSchedule> findByBarberIdAndDayOfWeek(Long barberId, Integer dayOfWeek);

    List<BarberSchedule> findByBarberIdOrderByDayOfWeek(Long barberId);

    /**
     * The schedule rows of the given barbers for one weekday (at most one per barber, V6 unique key),
     * with the barber fetched so callers can key them by barber id without further queries.
     */
    @Query("SELECT s FROM BarberSchedule s JOIN FETCH s.barber b WHERE s.dayOfWeek = :dayOfWeek AND b.id IN :barberIds")
    List<BarberSchedule> findForBarbersOnDay(@Param("barberIds") Collection<Long> barberIds,
                                             @Param("dayOfWeek") Integer dayOfWeek);

    /** Per weekday on which anyone works: the earliest shift start and the latest shift end. */
    @Query("""
        SELECT s.dayOfWeek AS dayOfWeek, MIN(s.startTime) AS opens, MAX(s.endTime) AS closes
        FROM BarberSchedule s
        GROUP BY s.dayOfWeek
        ORDER BY s.dayOfWeek
    """)
    List<WeekdayHours> findWeekdayHours();

    interface WeekdayHours {
        Integer getDayOfWeek();

        LocalTime getOpens();

        LocalTime getCloses();
    }
}
