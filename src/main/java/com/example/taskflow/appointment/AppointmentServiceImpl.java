package com.example.taskflow.appointment;
import com.example.taskflow.appointment.internal.Appointment;
import com.example.taskflow.appointment.internal.AppointmentRepository;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

/**
 * The cross-module {@link AppointmentService}: booking lookup for {@code review}, reminder selection
 * and claiming for {@code notification}. Everything the controllers need lives in
 * {@link AppointmentBookingService}, {@link AppointmentLifecycleService} and
 * {@link AppointmentQueryService}.
 */
@Service
class AppointmentServiceImpl implements AppointmentService {

    private static final Logger logger = LoggerFactory.getLogger(AppointmentServiceImpl.class);

    private final AppointmentRepository appointmentRepository;

    AppointmentServiceImpl(AppointmentRepository appointmentRepository) {
        this.appointmentRepository = appointmentRepository;
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<AppointmentDetails> findDetailsByPublicId(String publicId) {
        return Optional.ofNullable(appointmentRepository.findByPublicId(publicId)).map(AppointmentDetails::of);
    }

    @Override
    @Transactional(readOnly = true)
    public List<Long> findAppointmentIdsNeedingReminders(LocalDate tomorrow) {
        return appointmentRepository.findReminderIds(tomorrow, false, AppointmentStatus.APPROVED);
    }

    @Override
    // MANDATORY: the flag must commit together with the caller's outbox row. In a transaction of
    // its own it would commit first, and a failed outbox write would lose the reminder for good.
    @Transactional(propagation = Propagation.MANDATORY)
    public Optional<AppointmentDetails> claimReminder(Long id, LocalDate tomorrow) {
        Appointment appointment = appointmentRepository.findByIdForUpdate(id).orElse(null);
        if (appointment == null || Boolean.TRUE.equals(appointment.getReminderSent())) {
            return Optional.empty();
        }
        // The id was selected before the lock was taken; the booking may have been denied,
        // cancelled or moved in between. Re-check under the lock and skip rather than remind a
        // customer about a booking that no longer exists.
        if (appointment.getStatusEnum() != AppointmentStatus.APPROVED
                || !tomorrow.equals(appointment.getBookingDate())) {
            logger.info("Skipping reminder for appointment id={}: status={} date={} no longer qualifies",
                    appointment.getId(), appointment.getStatus(), appointment.getBookingDate());
            return Optional.empty();
        }
        appointment.setReminderSent(true);
        appointmentRepository.save(appointment);
        return Optional.of(AppointmentDetails.of(appointment));
    }
}
