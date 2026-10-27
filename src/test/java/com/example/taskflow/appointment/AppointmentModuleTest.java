package com.example.taskflow.appointment;

import com.example.taskflow.catalog.CatalogService;
import com.example.taskflow.catalog.ServiceItemRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.modulith.test.ApplicationModuleTest;
import org.springframework.test.context.TestPropertySource;
import org.springframework.modulith.test.PublishedEvents;

import java.math.BigDecimal;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Boots the appointment module with the modules it is allowed to depend on (catalog, core) and
 * checks what the rest of the system receives from it: {@link AppointmentDetails} snapshots in the
 * events, never the {@link Appointment} entity.
 */
@ApplicationModuleTest(mode = ApplicationModuleTest.BootstrapMode.DIRECT_DEPENDENCIES)
@TestPropertySource(properties = {"app.rate-limit.enabled=false", "app.schedulers.enabled=false"})
class AppointmentModuleTest {

    @Autowired
    private AppointmentService appointments;
    @Autowired
    private BarberService barbers;
    @Autowired
    private CatalogService catalog;

    private String barberName;
    private String serviceName;

    /** Own fixtures with unique names: other test classes share the in-memory database and wipe seeds. */
    @BeforeEach
    void createBarberAndService() {
        String suffix = UUID.randomUUID().toString();
        barberName = "Module Barber " + suffix;
        serviceName = "Module Cut " + suffix;
        barbers.createBarber(new BarberRequest(barberName, "barber-" + suffix + "@example.com", "555-0199"));
        catalog.createService(new ServiceItemRequest(serviceName, new BigDecimal("20.00"), 30, "hair", null));
    }

    private static LocalDate aWorkingDayInTwoWeeks() {
        LocalDate day = LocalDate.now().plusDays(14);
        while (day.getDayOfWeek() == DayOfWeek.SUNDAY) {
            day = day.plusDays(1);
        }
        return day;
    }

    private AppointmentResponse book(String email, LocalDate day, String time) {
        return appointments.createAppointment(
                new AppointmentCreateRequest("Module Test", email, "555-0100", barberName, day, time, serviceName),
                UUID.randomUUID().toString()).appointment();
    }

    @Test
    void approvingABookingPublishesASnapshotNotTheEntity(PublishedEvents events) {
        AppointmentResponse booked = book("module-approve@example.com", aWorkingDayInTwoWeeks(), "10:00");

        appointments.updateAppointmentStatus(booked.id(), new AppointmentUpdateRequest("APPROVED"));

        AppointmentDetails details = events.ofType(AppointmentStatusChangedEvent.class)
                .matching(e -> booked.id().equals(e.getAppointment().id()))
                .iterator().next().getAppointment();
        assertEquals(AppointmentStatus.APPROVED, details.status());
        assertEquals("module-approve@example.com", details.customerEmail());
        assertEquals(serviceName, details.serviceType());
        appointments.deleteAppointment(booked.id());
    }

    @Test
    void cancellingPublishesTheCancellationWithWhoDidIt(PublishedEvents events) {
        AppointmentResponse booked = book("module-cancel@example.com", aWorkingDayInTwoWeeks(), "11:00");

        appointments.publicCancelAppointment(booked.publicId(), "module-cancel@example.com");

        AppointmentCancelledEvent event = events.ofType(AppointmentCancelledEvent.class)
                .matching(e -> booked.id().equals(e.appointment().id()))
                .iterator().next();
        assertEquals(AppointmentCancelledEvent.CancelledBy.GUEST, event.cancelledBy());
        assertEquals(AppointmentStatus.CANCELLED, event.appointment().status());
        assertTrue(appointments.findDetailsByPublicId(booked.publicId()).isPresent());
    }
}
