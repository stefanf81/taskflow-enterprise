package com.example.taskflow.appointment;

import com.example.taskflow.appointment.internal.BarberRepository;
import com.example.taskflow.catalog.CatalogService;
import com.example.taskflow.catalog.ServiceItemRequest;
import com.example.taskflow.catalog.ServiceItemResponse;
import jakarta.persistence.EntityManagerFactory;
import org.hibernate.SessionFactory;
import org.hibernate.stat.Statistics;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Both clients send the service with every busy-slots request. Once the catalog and the slot list
 * are cached, answering it must not touch the database: the service's length used to be looked up
 * with a query on every request, so the public endpoint borrowed a connection even on a cache hit.
 */
@SpringBootTest(properties = {"app.rate-limit.enabled=false", "app.schedulers.enabled=false"})
class BusySlotsQueryCountIntegrationTest {

    @Autowired private AppointmentBookingService bookingService;
    @Autowired private BarberRepository barberRepository;
    @Autowired private CatalogService catalogService;
    @Autowired private Clock clock;
    @Autowired private EntityManagerFactory entityManagerFactory;

    @Test
    void aWarmLookupForAServiceRunsNoStatement() {
        String service = anyActiveService();
        String date = LocalDate.now(clock).plusDays(1).toString();

        List<String> barbers = new ArrayList<>(List.of(AppointmentBookingService.NO_PREFERENCE_BARBER));
        barberRepository.findAllByOrderByIdAsc().stream().findFirst().map(Barber::getName).ifPresent(barbers::add);

        for (String barber : barbers) {
            bookingService.getBusySlots(barber, date, service); // fills the caches
            assertEquals(0, statementsDuring(() -> bookingService.getBusySlots(barber, date, service)), barber);
        }
    }

    private String anyActiveService() {
        List<ServiceItemResponse> services = catalogService.getAllServices();
        return services.isEmpty()
                ? catalogService.createService(new ServiceItemRequest(
                        "Query Count Cut", new BigDecimal("20.00"), 30, "hair", null)).name()
                : services.getFirst().name();
    }

    private long statementsDuring(Runnable action) {
        Statistics statistics = entityManagerFactory.unwrap(SessionFactory.class).getStatistics();
        boolean wasEnabled = statistics.isStatisticsEnabled();
        statistics.setStatisticsEnabled(true);
        statistics.clear();
        try {
            action.run();
            return statistics.getPrepareStatementCount();
        } finally {
            statistics.setStatisticsEnabled(wasEnabled);
        }
    }
}
