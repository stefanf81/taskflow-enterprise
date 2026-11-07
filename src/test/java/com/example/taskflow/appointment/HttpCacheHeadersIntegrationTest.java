package com.example.taskflow.appointment;

import com.example.taskflow.appointment.internal.Appointment;
import com.example.taskflow.appointment.internal.AppointmentRepository;
import com.example.taskflow.appointment.internal.BarberRepository;
import com.example.taskflow.appointment.internal.BarberScheduleRepository;
import com.example.taskflow.appointment.internal.BarberTimeOffRepository;
import com.example.taskflow.auth.TestSecurityConfig;
import com.example.taskflow.catalog.ServiceItem;
import com.example.taskflow.catalog.internal.ServiceItemRepository;
import com.example.taskflow.review.internal.ReviewRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.cache.CacheManager;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.math.BigDecimal;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.temporal.TemporalAdjusters;
import java.util.Map;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The Cache-Control tiers (BENCHMARKS.md §44) through the full filter chain, including the
 * ETag filter and Spring Security's default cache headers. Browsers and the mobile app's
 * native HTTP cache (OkHttp on Android, NSURLCache on iOS) obey these headers, so they decide
 * whether a refetch after a mutation reaches the server and what stays on disk after logout.
 */
@SpringBootTest(properties = {"app.rate-limit.enabled=false", "spring.cache.type=simple"})
@AutoConfigureMockMvc
@Import(TestSecurityConfig.class)
class HttpCacheHeadersIntegrationTest {

    private static final String BARBER = "Cache Header Barber";
    private static final String SERVICE = "Cache Header Cut";
    /** A Thursday inside the booking window. */
    private static final LocalDate DATE = LocalDate.now().plusDays(7)
            .with(TemporalAdjusters.nextOrSame(DayOfWeek.THURSDAY));

    @Autowired private MockMvc mockMvc;
    @Autowired private AppointmentRepository appointmentRepository;
    @Autowired private BarberRepository barberRepository;
    @Autowired private BarberScheduleRepository barberScheduleRepository;
    @Autowired private BarberTimeOffRepository barberTimeOffRepository;
    @Autowired private ServiceItemRepository serviceItemRepository;
    @Autowired private ReviewRepository reviewRepository;
    @Autowired private CacheManager cacheManager;

    private final ObjectMapper objectMapper = new ObjectMapper();
    private Barber barber;

    @BeforeEach
    void setUp() {
        reviewRepository.deleteAll();
        appointmentRepository.deleteAll();
        barberTimeOffRepository.deleteAll();
        barberScheduleRepository.deleteAll();
        barberRepository.deleteAll();
        serviceItemRepository.deleteAll();

        serviceItemRepository.save(new ServiceItem(SERVICE, new BigDecimal("25.00"), 30, "hair", ""));
        barber = barberRepository.save(new Barber(BARBER, "barber@taskflow.com", "555-1234"));
        BarberSchedule schedule = new BarberSchedule();
        schedule.setBarber(barber);
        schedule.setDayOfWeek(DATE.getDayOfWeek().getValue());
        schedule.setStartTime(LocalTime.of(9, 0));
        schedule.setEndTime(LocalTime.of(17, 0));
        barberScheduleRepository.save(schedule);
    }

    private MockHttpServletRequestBuilder busySlots() {
        return get("/api/v1/appointments/public/busy-slots")
                .param("barberName", BARBER)
                .param("bookingDate", DATE.toString());
    }

    @Test
    void busySlotsAreRevalidatedSoARefetchAfterABookingSeesTheTakenSlot() throws Exception {
        String etag = mockMvc.perform(busySlots())
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-cache, private"))
                .andExpect(jsonPath("$", not(hasItem("10:00"))))
                .andReturn().getResponse().getHeader(HttpHeaders.ETAG);
        assertNotNull(etag);

        // Unchanged: the revalidation costs a 304, not the body.
        mockMvc.perform(busySlots().header(HttpHeaders.IF_NONE_MATCH, etag))
                .andExpect(status().isNotModified());

        mockMvc.perform(post("/api/v1/appointments")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "customerName", "Guest John",
                                "customerEmail", "john@test.com",
                                "customerPhone", "555-0000",
                                "barberName", BARBER,
                                "bookingDate", DATE.toString(),
                                "bookingTime", "10:00",
                                "serviceType", SERVICE))))
                .andExpect(status().isCreated());

        mockMvc.perform(busySlots().header(HttpHeaders.IF_NONE_MATCH, etag))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasItem("10:00")));
    }

    @Test
    void barberRatingsAreRevalidatedSoASubmittedReviewShowsUp() throws Exception {
        String etag = mockMvc.perform(get("/api/v1/reviews/public/barber-ratings"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-cache, public"))
                .andReturn().getResponse().getHeader(HttpHeaders.ETAG);
        assertNotNull(etag);

        mockMvc.perform(get("/api/v1/reviews/public/barber-ratings").header(HttpHeaders.IF_NONE_MATCH, etag))
                .andExpect(status().isNotModified());
    }

    /**
     * Admins edit the catalog, the barbers and their schedules from both clients, which refetch
     * these lists right afterwards: public, but revalidated (ETag 304) instead of a max-age that
     * would let the browser or native HTTP cache answer that refetch with the old list.
     */
    @Test
    void adminEditableReferenceDataIsPublicButRevalidated() throws Exception {
        for (String path : new String[] {"/api/v1/catalog", "/api/v1/barbers", "/api/v1/appointments/public/shop"}) {
            String etag = mockMvc.perform(get(path))
                    .andExpect(status().isOk())
                    .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-cache, public"))
                    .andReturn().getResponse().getHeader(HttpHeaders.ETAG);
            assertNotNull(etag, path + " must keep its ETag");
            mockMvc.perform(get(path).header(HttpHeaders.IF_NONE_MATCH, etag))
                    .andExpect(status().isNotModified());
        }
    }

    @Test
    void shopInfoDerivesItsHoursFromTheSchedulesAndStatesTheBookingWindow() throws Exception {
        // Schedules are written straight to the repository here, which (unlike createBarber) does
        // not evict the cached hours another test in this context may have loaded.
        cacheManager.getCache(AppointmentCacheConfig.OPENING_HOURS_CACHE).clear();

        mockMvc.perform(get("/api/v1/appointments/public/shop"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.maxAdvanceDays").value(90))
                .andExpect(jsonPath("$.openingHours.length()").value(1))
                .andExpect(jsonPath("$.openingHours[0].dayOfWeek").value(DATE.getDayOfWeek().getValue()))
                .andExpect(jsonPath("$.openingHours[0].opens").value("09:00"))
                .andExpect(jsonPath("$.openingHours[0].closes").value("17:00"));
    }

    @Test
    void customerPersonalDataIsNeverStoredByAnHttpCache() throws Exception {
        Appointment booking = new Appointment("Jane", "jane@test.com", "555-0002", BARBER, DATE, "11:00", SERVICE);
        booking.setBarber(barber);
        booking = appointmentRepository.save(booking);

        for (String path : new String[] {"/api/v1/appointments", "/api/v1/appointments/" + booking.getId(),
                "/api/v1/barbers/admin"}) {
            mockMvc.perform(get(path).with(user("admin").roles("ADMIN")))
                    .andExpect(status().isOk())
                    .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"));
        }
        mockMvc.perform(get("/api/v1/customer/appointments").with(user("jane@test.com").roles("CUSTOMER")))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"));
    }

    /** Endpoints without an explicit tier rely on Spring Security's default no-store headers. */
    @Test
    void authenticatedEndpointsWithoutATierFallBackToNoStore() throws Exception {
        for (String path : new String[] {"/api/v1/notifications", "/api/v1/barbers/" + barber.getId() + "/time-off",
                "/api/v1/auth/me"}) {
            mockMvc.perform(get(path).with(user("admin").roles("ADMIN")))
                    .andExpect(status().isOk())
                    .andExpect(header().string(HttpHeaders.CACHE_CONTROL, containsString("no-store")));
        }
    }
}
