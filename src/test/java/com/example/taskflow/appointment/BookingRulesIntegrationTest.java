package com.example.taskflow.appointment;

import com.example.taskflow.appointment.internal.AppointmentRepository;
import com.example.taskflow.appointment.internal.BarberRepository;
import com.example.taskflow.appointment.internal.BarberScheduleRepository;
import com.example.taskflow.appointment.internal.BarberTimeOffRepository;
import com.example.taskflow.auth.internal.UserRepository;
import com.example.taskflow.catalog.ServiceItem;
import com.example.taskflow.catalog.internal.ServiceItemRepository;
import com.example.taskflow.notification.NotificationOutbox;
import com.example.taskflow.notification.internal.NotificationOutboxRepository;
import com.example.taskflow.review.internal.ReviewRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.reset;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * End-to-end regression tests (MockMvc + the real H2 schema, Flyway V1-V28) for the booking
 * rules: grid/duration/overlap (BKG-1), date window and per-e-mail limit (BKG-2), admin status
 * transitions (BKG-3), busy-slot failure handling (BKG-4), soft cancel and its notifications
 * (BKG-5), roster changes (BKG-6), unknown barber (BKG-9), search/status filter/price snapshot
 * (BKG-10).
 *
 * <p>The shop clock is fixed to Monday 2030-05-13 08:00 so every date below is deterministic.
 */
@SpringBootTest(properties = {"app.rate-limit.enabled=false"})
@AutoConfigureMockMvc
@Import(BookingRulesIntegrationTest.FixedClockConfig.class)
class BookingRulesIntegrationTest {

    /** Monday 2030-05-13, 08:00 shop time. */
    static final Instant NOW = Instant.parse("2030-05-13T08:00:00Z");
    private static final LocalDate TODAY = LocalDate.of(2030, 5, 13);
    private static final LocalDate TUE = TODAY.plusDays(1);
    private static final LocalDate WED = TODAY.plusDays(2);
    private static final LocalDate THU = TODAY.plusDays(3);

    private static final String BARBER = "Rules Barber";
    private static final String CUT = "Rules Cut";
    private static final String LONG = "Rules Long Treatment";

    @TestConfiguration
    static class FixedClockConfig {
        @Bean
        @Primary
        Clock fixedTestClock() {
            return Clock.fixed(NOW, ZoneOffset.UTC);
        }
    }

    @Autowired private MockMvc mockMvc;
    @Autowired private AppointmentRepository appointmentRepository;
    @Autowired private BarberRepository barberRepository;
    @Autowired private BarberScheduleRepository barberScheduleRepository;
    @Autowired private BarberTimeOffRepository barberTimeOffRepository;
    @Autowired private ServiceItemRepository serviceItemRepository;
    @Autowired private ReviewRepository reviewRepository;
    @Autowired private NotificationOutboxRepository outboxRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private CacheManager cacheManager;
    @Autowired private BookingProperties bookingProperties;

    @MockitoSpyBean private AppointmentRepository spiedAppointmentRepository;

    private final ObjectMapper objectMapper = new ObjectMapper();
    private String adminToken;

    @BeforeEach
    void setUp() throws Exception {
        reset(spiedAppointmentRepository);
        reviewRepository.deleteAll();
        outboxRepository.deleteAll();
        appointmentRepository.deleteAll();
        barberTimeOffRepository.deleteAll();
        // keep the bootstrapped admin account (these tests log in with it)
        userRepository.deleteAll(userRepository.findAll().stream()
                .filter(user -> !"admin".equalsIgnoreCase(user.getEmail())).toList());
        for (String name : List.of("busySlots", "appointmentStats", "barbers", "publicBarbers", "services")) {
            Cache cache = cacheManager.getCache(name);
            if (cache != null) {
                cache.clear();
            }
        }
        ensureBarber(BARBER);
        ensureService(CUT, "25.00", 30);
        ensureService(LONG, "60.00", 120);

        Map<String, String> login = Map.of("username", "admin", "password", "admin-password");
        adminToken = "Bearer " + mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(login)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getCookie("access_token").getValue();
    }

    // ── fixtures ──────────────────────────────────────────────────────────────

    private Barber ensureBarber(String name) {
        Barber barber = barberRepository.findByName(name)
                .orElseGet(() -> barberRepository.save(new Barber(name, name.replace(' ', '.') + "@taskflow.com", "555-0100")));
        for (int day = 1; day <= 6; day++) {
            if (barberScheduleRepository.findByBarberIdAndDayOfWeek(barber.getId(), day).isEmpty()) {
                BarberSchedule schedule = new BarberSchedule();
                schedule.setBarber(barber);
                schedule.setDayOfWeek(day);
                schedule.setStartTime(LocalTime.of(9, 0));
                schedule.setEndTime(LocalTime.of(17, 0));
                barberScheduleRepository.save(schedule);
            }
        }
        return barber;
    }

    private void ensureService(String name, String price, int minutes) {
        ServiceItem item = serviceItemRepository.findByName(name).orElseGet(ServiceItem::new);
        item.setName(name);
        item.setPrice(new BigDecimal(price));
        item.setDurationMinutes(minutes);
        item.setCategory("hair");
        serviceItemRepository.save(item);
    }

    private Map<String, Object> request(String email, String barber, LocalDate date, String time, String service) {
        Map<String, Object> request = new HashMap<>();
        request.put("customerName", "Rules Customer");
        request.put("customerEmail", email);
        request.put("customerPhone", "555-0111");
        request.put("barberName", barber);
        request.put("bookingDate", date.toString());
        request.put("bookingTime", time);
        request.put("serviceType", service);
        return request;
    }

    private ResultActions postBooking(Map<String, Object> request) throws Exception {
        return mockMvc.perform(post("/api/v1/appointments")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)));
    }

    /** Books via the API and returns the created resource. */
    private JsonNode book(String email, LocalDate date, String time) throws Exception {
        return book(email, BARBER, date, time, CUT);
    }

    private JsonNode book(String email, String barber, LocalDate date, String time, String service) throws Exception {
        String body = postBooking(request(email, barber, date, time, service))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(body);
    }

    private ResultActions adminSetStatus(long id, String status) throws Exception {
        return mockMvc.perform(put("/api/v1/appointments/" + id)
                .header("Authorization", adminToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"" + status + "\"}"));
    }

    private ResultActions guestCancel(String publicId, String email) throws Exception {
        return mockMvc.perform(put("/api/v1/appointments/public/cancel/" + publicId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(new CancelRequest(email))));
    }

    private List<String> busySlots(String barber, LocalDate date) throws Exception {
        String body = mockMvc.perform(get("/api/v1/appointments/public/busy-slots")
                        .param("barberName", barber).param("bookingDate", date.toString()))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readerForListOf(String.class).readValue(body);
    }

    private List<NotificationOutbox> outboxFor(String email) {
        return outboxRepository.findAll().stream().filter(o -> email.equalsIgnoreCase(o.getRecipient())).toList();
    }

    private AppointmentStatus statusOf(long id) {
        return appointmentRepository.findById(id).orElseThrow().getStatusEnum();
    }

    @Test
    void bookingPolicyDefaultsApplyWhenNothingIsConfigured() {
        assertEquals(BookingProperties.defaults(), bookingProperties);
    }

    // ── BKG-1 ─────────────────────────────────────────────────────────────────

    @Test
    void offGridTimesCannotBypassTheDoubleBookingGuard() throws Exception {
        book("first@example.com", TUE, "10:00");

        // the exact scenario of the finding: 10:30 and 10:01 used to return 201
        for (String time : List.of("10:30", "10:01")) {
            postBooking(request("second@example.com", BARBER, TUE, time, CUT))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.message", containsString("available time slots")));
        }
        // and the same start is still refused by the overlap guard
        postBooking(request("second@example.com", BARBER, TUE, "10:00", CUT))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", containsString("already booked")));
        assertEquals(1, appointmentRepository.count());
    }

    @Test
    void aLongServiceBlocksTheSlotsItCoversAndCannotRunPastClosing() throws Exception {
        book("long@example.com", BARBER, TUE, "10:00", LONG); // 10:00-12:00

        assertEquals(List.of("10:00", "11:00"), busySlots(BARBER, TUE));
        postBooking(request("other@example.com", BARBER, TUE, "11:00", CUT))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", containsString("already booked")));
        book("other@example.com", BARBER, TUE, "13:00", CUT);

        // 16:00 + 120 min would end at 18:00, after closing; 15:00 + 120 ends exactly at 17:00
        postBooking(request("late@example.com", BARBER, WED, "16:00", LONG))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", containsString("closing time")));
        book("late@example.com", BARBER, WED, "15:00", LONG);
    }

    @Test
    void noPreferenceNeverAssignsABarberWhoIsAlreadyBooked() throws Exception {
        book("named@example.com", TUE, "10:00");

        ResultActions result = postBooking(request("any@example.com", AppointmentServiceImpl.NO_PREFERENCE_BARBER, TUE, "10:00", CUT));
        String assigned = result.andReturn().getResponse().getStatus() == 201
                ? objectMapper.readTree(result.andReturn().getResponse().getContentAsString()).get("barberName").asText()
                : null;
        if (assigned != null) {
            assertTrue(!BARBER.equals(assigned), "the busy barber must not be assigned, got " + assigned);
        }
        postBooking(request("any@example.com", AppointmentServiceImpl.NO_PREFERENCE_BARBER, TUE, "10:30", CUT))
                .andExpect(status().isBadRequest());
    }

    // ── BKG-2 ─────────────────────────────────────────────────────────────────

    @Test
    void bookingDateWindowIsEnforced() throws Exception {
        postBooking(request("past@example.com", BARBER, TODAY.minusDays(1), "10:00", CUT))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", containsString("future")));
        postBooking(request("far@example.com", BARBER, TODAY.plusDays(91), "10:00", CUT))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", containsString("90 days")));
        // today, later in the day, is fine
        book("today@example.com", TODAY, "09:00");
        assertEquals(1, appointmentRepository.count());
    }

    @Test
    void perEmailLimitCountsActiveFutureBookingsCaseInsensitively() throws Exception {
        List<String> times = List.of("09:00", "10:00", "11:00", "13:00", "14:00");
        JsonNode first = null;
        for (String time : times) {
            JsonNode created = book("Limit@Example.com", TUE, time);
            if (first == null) {
                first = created;
            }
        }
        postBooking(request("limit@example.com", BARBER, TUE, "15:00", CUT))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", containsString("maximum")));
        // another address is unaffected
        book("someone.else@example.com", TUE, "15:00");

        // cancelling one frees a place
        guestCancel(first.get("publicId").asText(), "limit@example.com").andExpect(status().isNoContent());
        book("limit@example.com", TUE, "16:00");
    }

    // ── BKG-3 ─────────────────────────────────────────────────────────────────

    @Test
    void deniedBookingWhoseSlotWasRebookedCannotBeApproved() throws Exception {
        long deniedId = book("a@example.com", TUE, "10:00").get("id").asLong();
        adminSetStatus(deniedId, "DENIED").andExpect(status().isOk());
        book("b@example.com", TUE, "10:00"); // the freed slot is taken

        adminSetStatus(deniedId, "APPROVED")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message", containsString("already booked")));
        assertEquals(AppointmentStatus.DENIED, statusOf(deniedId));
    }

    @Test
    void deniedBookingCanBeReApprovedWhileItsSlotIsStillFree() throws Exception {
        long id = book("a@example.com", TUE, "10:00").get("id").asLong();
        adminSetStatus(id, "DENIED").andExpect(status().isOk());

        adminSetStatus(id, "APPROVED").andExpect(status().isOk()).andExpect(jsonPath("$.status", is("APPROVED")));
        assertEquals(AppointmentStatus.APPROVED, statusOf(id));
    }

    @Test
    void sentinelBarberRowsCannotBeApproved() throws Exception {
        Appointment legacy = new Appointment("Legacy", "legacy@example.com", "555", AppointmentServiceImpl.NO_PREFERENCE_BARBER,
                TUE, "10:00", CUT);
        legacy.setStatus(AppointmentStatus.DENIED);
        legacy = appointmentRepository.save(legacy);

        adminSetStatus(legacy.getId(), "APPROVED")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message", containsString("no assigned barber")));
        assertEquals(AppointmentStatus.DENIED, statusOf(legacy.getId()));
    }

    @Test
    void pastBookingsCannotBeApproved() throws Exception {
        Appointment past = new Appointment("Past", "past@example.com", "555", BARBER, TODAY.minusDays(2), "10:00", CUT);
        past.setBarber(barberRepository.findByName(BARBER).orElseThrow());
        past = appointmentRepository.save(past);

        adminSetStatus(past.getId(), "APPROVED").andExpect(status().isConflict());
        // but an overdue pending booking can still be denied
        adminSetStatus(past.getId(), "DENIED").andExpect(status().isOk());
    }

    @Test
    void sameStatusRequestIsANoOpAndSendsNoEmail() throws Exception {
        long id = book("noop@example.com", TUE, "10:00").get("id").asLong();
        adminSetStatus(id, "APPROVED").andExpect(status().isOk());
        assertEquals(1, outboxFor("noop@example.com").size());

        adminSetStatus(id, "APPROVED").andExpect(status().isOk()).andExpect(jsonPath("$.status", is("APPROVED")));

        assertEquals(1, outboxFor("noop@example.com").size(), "a no-op must not enqueue another e-mail");
    }

    @Test
    void anythingOnACancelledBookingIsAConflict() throws Exception {
        JsonNode created = book("c@example.com", TUE, "10:00");
        long id = created.get("id").asLong();
        guestCancel(created.get("publicId").asText(), "c@example.com").andExpect(status().isNoContent());

        adminSetStatus(id, "APPROVED").andExpect(status().isConflict());
        adminSetStatus(id, "DENIED").andExpect(status().isConflict());
        assertEquals(AppointmentStatus.CANCELLED, statusOf(id));
    }

    @Test
    void optimisticLockingRejectsAStaleWrite() {
        Appointment saved = appointmentRepository.save(new Appointment(
                "Lock", "lock@example.com", "555", BARBER, TUE, "10:00", CUT));
        // two readers load the same version...
        Appointment staleCopy = appointmentRepository.findById(saved.getId()).orElseThrow();
        Appointment winner = appointmentRepository.findById(saved.getId()).orElseThrow();
        winner.setStatus(AppointmentStatus.DENIED);
        appointmentRepository.saveAndFlush(winner);

        // ...the second writer's update is refused instead of silently interleaving
        staleCopy.setStatus(AppointmentStatus.APPROVED);
        org.junit.jupiter.api.Assertions.assertThrows(org.springframework.dao.OptimisticLockingFailureException.class,
                () -> appointmentRepository.saveAndFlush(staleCopy));
    }

    // ── BKG-4 / BKG-9 ─────────────────────────────────────────────────────────

    @Test
    void databaseFailureOnBusySlotsIsA503AndIsNotCached() throws Exception {
        doThrow(new QueryTimeoutException("simulated timeout"))
                .when(spiedAppointmentRepository).findActiveForBarberOnDate(anyString(), eq(TUE));

        mockMvc.perform(get("/api/v1/appointments/public/busy-slots")
                        .param("barberName", BARBER).param("bookingDate", TUE.toString()))
                .andExpect(status().isServiceUnavailable())
                .andExpect(header().exists("Retry-After"));

        Cache cache = cacheManager.getCache("busySlots");
        assertNotNull(cache);
        assertNull(cache.get(BARBER + "-" + TUE), "a failed computation must not be cached as 'everything busy'");

        // once the database is back the very next call computes (and returns) real availability
        reset(spiedAppointmentRepository);
        assertEquals(List.of(), busySlots(BARBER, TUE));
        assertNotNull(cache.get(BARBER + "-" + TUE));
    }

    @Test
    void unknownBarberAndMalformedDateAreBadRequestsAndNeverCached() throws Exception {
        mockMvc.perform(get("/api/v1/appointments/public/busy-slots")
                        .param("barberName", "Nobody Here").param("bookingDate", TUE.toString()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", containsString("Unknown barber")));
        assertNull(cacheManager.getCache("busySlots").get("Nobody Here-" + TUE));

        mockMvc.perform(get("/api/v1/appointments/public/busy-slots")
                        .param("barberName", BARBER).param("bookingDate", "2030-13-45"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void timeOffAndNonWorkingDaysStillYieldACacheableAllBusyAnswer() throws Exception {
        LocalDate sunday = LocalDate.of(2030, 5, 19);
        assertEquals(BusySlotsService.ALL_SLOTS, busySlots(BARBER, sunday));
        assertNotNull(cacheManager.getCache("busySlots").get(BARBER + "-" + sunday));
    }

    // ── BKG-5 ─────────────────────────────────────────────────────────────────

    @Test
    void cancellingSoftCancelsFreesTheSlotAndTheSlotCanBeRebookedOnH2() throws Exception {
        JsonNode created = book("cancel@example.com", TUE, "10:00");
        long id = created.get("id").asLong();
        assertEquals(List.of("10:00"), busySlots(BARBER, TUE));

        guestCancel(created.get("publicId").asText(), "cancel@example.com").andExpect(status().isNoContent());

        assertEquals(AppointmentStatus.CANCELLED, statusOf(id), "the row is kept");
        assertEquals(List.of(), busySlots(BARBER, TUE));
        // the unique slot index ignores CANCELLED rows, so the slot can be taken again...
        JsonNode rebooked = book("new@example.com", TUE, "10:00");
        // ...even several times over
        guestCancel(rebooked.get("publicId").asText(), "new@example.com").andExpect(status().isNoContent());
        book("third@example.com", TUE, "10:00");
        assertEquals(3, appointmentRepository.count());

        // cancelling again is an idempotent 204 and sends no second e-mail
        int mails = outboxFor("cancel@example.com").size();
        guestCancel(created.get("publicId").asText(), "cancel@example.com").andExpect(status().isNoContent());
        assertEquals(mails, outboxFor("cancel@example.com").size());
    }

    @Test
    void cancellationEmailsAreWrittenForGuestCustomerAndAdminCancels() throws Exception {
        // guest
        JsonNode guest = book("guest@example.com", TUE, "10:00");
        guestCancel(guest.get("publicId").asText(), "guest@example.com").andExpect(status().isNoContent());
        // admin
        JsonNode byAdmin = book("admin.cancelled@example.com", TUE, "11:00");
        mockMvc.perform(delete("/api/v1/appointments/" + byAdmin.get("id").asLong()).header("Authorization", adminToken))
                .andExpect(status().isNoContent());
        // signed-in customer
        Map<String, Object> registration = Map.of("fullName", "Cust Omer", "email", "cust@example.com",
                "password", "customer-pass-123", "phone", "555-0222");
        mockMvc.perform(post("/api/v1/auth/register").contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(registration))).andExpect(status().isCreated());
        String customerToken = "Bearer " + mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("username", "cust@example.com", "password", "customer-pass-123"))))
                .andExpect(status().isOk()).andReturn().getResponse().getCookie("access_token").getValue();
        JsonNode mine = book("cust@example.com", TUE, "13:00");
        mockMvc.perform(delete("/api/v1/customer/appointments/" + mine.get("publicId").asText())
                        .header("Authorization", customerToken))
                .andExpect(status().isNoContent());

        Map<String, String> expectedTimes = Map.of("guest@example.com", "10:00",
                "admin.cancelled@example.com", "11:00", "cust@example.com", "13:00");
        expectedTimes.forEach((email, time) -> {
            List<NotificationOutbox> mails = outboxFor(email);
            assertEquals(1, mails.size(), email);
            String message = mails.get(0).getMessage();
            assertTrue(message.contains("your " + CUT + " appointment with " + BARBER + " on " + TUE + " at " + time
                    + " has been cancelled"), message);
            assertTrue(!message.contains("status has been updated"), "must not use the generic status wording: " + message);
        });

        // the customer sees the cancelled booking in their history
        mockMvc.perform(get("/api/v1/customer/appointments").header("Authorization", customerToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].status", is("CANCELLED")));
    }

    @Test
    void deniedAndPastBookingsCannotBeCancelledByGuestsButAdminsMayCancelPastOnes() throws Exception {
        long deniedId = book("denied@example.com", TUE, "10:00").get("id").asLong();
        adminSetStatus(deniedId, "DENIED").andExpect(status().isOk());
        String deniedPublicId = appointmentRepository.findById(deniedId).orElseThrow().getPublicId();
        guestCancel(deniedPublicId, "denied@example.com").andExpect(status().isBadRequest());

        Appointment past = new Appointment("Past", "past@example.com", "555", BARBER, TODAY.minusDays(1), "10:00", CUT);
        past.setStatus(AppointmentStatus.APPROVED);
        past = appointmentRepository.save(past);
        guestCancel(past.getPublicId(), "past@example.com")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", containsString("already started")));
        assertEquals(AppointmentStatus.APPROVED, statusOf(past.getId()));

        mockMvc.perform(delete("/api/v1/appointments/" + past.getId()).header("Authorization", adminToken))
                .andExpect(status().isNoContent());
        assertEquals(AppointmentStatus.CANCELLED, statusOf(past.getId()));
    }

    @Test
    void replayOfTheOriginalCreateRequestAfterCancellationDoesNotRebook() throws Exception {
        Map<String, Object> request = request("replay@example.com", BARBER, TUE, "10:00", CUT);
        JsonNode created = objectMapper.readTree(mockMvc.perform(post("/api/v1/appointments")
                        .header("Idempotency-Key", "late-replay")
                        .contentType(MediaType.APPLICATION_JSON).content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString());
        guestCancel(created.get("publicId").asText(), "replay@example.com").andExpect(status().isNoContent());

        mockMvc.perform(post("/api/v1/appointments")
                        .header("Idempotency-Key", "late-replay")
                        .contentType(MediaType.APPLICATION_JSON).content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id", is(created.get("id").asInt())))
                .andExpect(jsonPath("$.status", is("CANCELLED")));
        assertEquals(1, appointmentRepository.count());
        assertEquals(List.of(), busySlots(BARBER, TUE));
    }

    @Test
    void dashboardStatsWorkOnAnEmptyTableAndExcludeCancelledFromTheTotal() throws Exception {
        mockMvc.perform(get("/api/v1/appointments").header("Authorization", adminToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.stats.total", is(0)))
                .andExpect(jsonPath("$.stats.approvedRevenue", is(0.0)));

        JsonNode a = book("a@example.com", TUE, "10:00");
        JsonNode b = book("b@example.com", TUE, "11:00");
        guestCancel(b.get("publicId").asText(), "b@example.com").andExpect(status().isNoContent());

        mockMvc.perform(get("/api/v1/appointments").header("Authorization", adminToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.stats.total", is(1)))
                .andExpect(jsonPath("$.stats.pending", is(1)))
                .andExpect(jsonPath("$.page.content", hasSize(2)));
        mockMvc.perform(get("/api/v1/appointments").param("status", "CANCELLED").header("Authorization", adminToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.page.content", hasSize(1)))
                .andExpect(jsonPath("$.page.content[0].id", is(b.get("id").asInt())));
        assertNotNull(a);
    }

    // ── BKG-6 ─────────────────────────────────────────────────────────────────

    @Test
    void timeOffCancelsAndNotifiesAffectedBookingsAndLeavesOthersAlone() throws Exception {
        JsonNode tue = book("tue@example.com", TUE, "10:00");
        JsonNode wed = book("wed@example.com", WED, "11:00");
        long wedId = wed.get("id").asLong();
        adminSetStatus(wedId, "APPROVED").andExpect(status().isOk());
        JsonNode thu = book("thu@example.com", THU, "10:00");
        // availability is cached before the time off
        assertEquals(List.of("10:00"), busySlots(BARBER, TUE));
        long barberId = barberRepository.findByName(BARBER).orElseThrow().getId();

        mockMvc.perform(post("/api/v1/barbers/" + barberId + "/time-off")
                        .header("Authorization", adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"startDate\":\"" + TUE + "\",\"endDate\":\"" + WED + "\",\"reason\":\"Vacation\"}"))
                .andExpect(status().isCreated());

        assertEquals(AppointmentStatus.CANCELLED, statusOf(tue.get("id").asLong()));
        assertEquals(AppointmentStatus.CANCELLED, statusOf(wedId));
        assertEquals(AppointmentStatus.PENDING, statusOf(thu.get("id").asLong()));
        List<NotificationOutbox> mails = outboxFor("tue@example.com");
        assertEquals(1, mails.size());
        assertTrue(mails.get(0).getMessage().contains("has been cancelled"), mails.get(0).getMessage());
        assertTrue(mails.get(0).getMessage().contains("unavailable"), mails.get(0).getMessage());
        // wed was APPROVED earlier (1 mail) and is now cancelled (second mail)
        assertEquals(2, outboxFor("wed@example.com").size());
        assertEquals(0, outboxFor("thu@example.com").size());
        assertEquals(BusySlotsService.ALL_SLOTS, busySlots(BARBER, TUE));
    }

    @Test
    void aNewlyCreatedBarberIsBookableImmediately() throws Exception {
        mockMvc.perform(post("/api/v1/barbers")
                        .header("Authorization", adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Fresh Hire\",\"email\":\"fresh@taskflow.com\",\"phone\":\"555-0900\"}"))
                .andExpect(status().isCreated());
        Barber fresh = barberRepository.findByName("Fresh Hire").orElseThrow();
        for (int day = 1; day <= 6; day++) {
            BarberSchedule schedule = barberScheduleRepository.findByBarberIdAndDayOfWeek(fresh.getId(), day).orElseThrow();
            assertEquals(LocalTime.of(9, 0), schedule.getStartTime());
            assertEquals(LocalTime.of(17, 0), schedule.getEndTime());
        }
        assertTrue(barberScheduleRepository.findByBarberIdAndDayOfWeek(fresh.getId(), 7).isEmpty(), "Sunday is off");

        book("hire@example.com", "Fresh Hire", TUE, "10:00", CUT);
        assertEquals(List.of("10:00"), busySlots("Fresh Hire", TUE));
    }

    // ── BKG-10 ────────────────────────────────────────────────────────────────

    @Test
    void unknownStatusFilterIsABadRequest() throws Exception {
        mockMvc.perform(get("/api/v1/appointments").param("status", "BOGUS").header("Authorization", adminToken))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", containsString("Unknown status")));
        mockMvc.perform(get("/api/v1/appointments").param("status", "approved").header("Authorization", adminToken))
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/appointments").param("status", "  ").header("Authorization", adminToken))
                .andExpect(status().isOk());
    }

    @Test
    void adminSearchMatchesNameEmailPhoneAndPublicIdAndAlsoAppliesToOverdue() throws Exception {
        Appointment olga = new Appointment("Olga Overdue", "olga.o@example.com", "555-7777", BARBER, TODAY.minusDays(3), "10:00", CUT);
        olga = appointmentRepository.save(olga);
        Appointment other = new Appointment("Peter Past", "peter@example.com", "555-8888", BARBER, TODAY.minusDays(3), "11:00", CUT);
        appointmentRepository.save(other);
        JsonNode future = book("future.fiona@example.com", TUE, "10:00");

        assertSearch("olga", 1, olga.getId());                   // name, case-insensitive
        assertSearch("OLGA.O@EXAMPLE", 1, olga.getId());         // e-mail contains, case-insensitive
        assertSearch("555-7777", 1, olga.getId());               // phone
        assertSearch(olga.getPublicId(), 1, olga.getId());       // exact public id
        assertSearch(olga.getPublicId().substring(0, 8), 0, null); // a partial public id does not match
        assertSearch("fiona", 1, future.get("id").asLong());
        assertSearch("zzz-no-match", 0, null);

        // OVERDUE lists both past pending rows; the search narrows it (it used to be ignored)
        mockMvc.perform(get("/api/v1/appointments").param("status", "OVERDUE").header("Authorization", adminToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.page.content", hasSize(2)));
        mockMvc.perform(get("/api/v1/appointments").param("status", "OVERDUE").param("search", "peter")
                        .header("Authorization", adminToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.page.content", hasSize(1)))
                .andExpect(jsonPath("$.page.content[0].customerName", is("Peter Past")));
        mockMvc.perform(get("/api/v1/appointments").param("status", "OVERDUE").param("search", "fiona")
                        .header("Authorization", adminToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.page.content", hasSize(0)));
        // a search term with LIKE wildcards is taken literally
        assertSearch("%", 0, null);
    }

    private void assertSearch(String term, int expected, Long expectedId) throws Exception {
        ResultActions result = mockMvc.perform(get("/api/v1/appointments").param("search", term)
                        .header("Authorization", adminToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.page.content", hasSize(expected)));
        if (expectedId != null) {
            result.andExpect(jsonPath("$.page.content[*].id", hasItem(expectedId.intValue())));
        }
    }

    @Test
    void revenueUsesThePriceSnapshotNotTheCurrentPrice() throws Exception {
        long id = book("price@example.com", TUE, "10:00").get("id").asLong();
        adminSetStatus(id, "APPROVED").andExpect(status().isOk());
        assertEquals(0, new BigDecimal("25.00").compareTo(appointmentRepository.findById(id).orElseThrow().getPriceAtBooking()));

        // the shop doubles the price afterwards
        ServiceItem cut = serviceItemRepository.findByName(CUT).orElseThrow();
        cut.setPrice(new BigDecimal("50.00"));
        serviceItemRepository.save(cut);
        cacheManager.getCache("appointmentStats").clear();

        mockMvc.perform(get("/api/v1/appointments").header("Authorization", adminToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.stats.approvedRevenue", is(25.0)));

        // a legacy row without a snapshot falls back to the live price
        Appointment legacy = new Appointment("Legacy", "legacy@example.com", "555", BARBER, WED, "10:00", CUT);
        legacy.setStatus(AppointmentStatus.APPROVED);
        legacy.setService(cut);
        appointmentRepository.save(legacy);
        cacheManager.getCache("appointmentStats").clear();
        mockMvc.perform(get("/api/v1/appointments").header("Authorization", adminToken))
                .andExpect(jsonPath("$.stats.approvedRevenue", is(75.0)));
    }

    @Test
    void emailLookupsAreCaseInsensitive() {
        appointmentRepository.save(new Appointment("Mixed", "MiXeD@Case.com", "555", BARBER, TUE, "10:00", CUT));
        assertEquals(1, appointmentRepository.findByCustomerEmailIgnoreCase("mixed@case.COM",
                org.springframework.data.domain.PageRequest.of(0, 10)).getTotalElements());
        assertEquals(1, appointmentRepository.countActiveFromDate("MIXED@CASE.COM", TODAY));

        userRepository.save(new com.example.taskflow.auth.AppUser("user@case.com", "hash", "U", null, "ROLE_CUSTOMER"));
        assertTrue(userRepository.findByEmailIgnoreCase("USER@Case.Com").isPresent());
        assertTrue(userRepository.findByEmailIgnoreCase("other@case.com").isEmpty());
    }

    @Test
    void reminderLookupOnlyReturnsApprovedBookings() {
        Appointment approved = new Appointment("A", "a@example.com", "555", BARBER, TUE, "10:00", CUT);
        approved.setStatus(AppointmentStatus.APPROVED);
        approved = appointmentRepository.save(approved);
        for (AppointmentStatus other : List.of(AppointmentStatus.PENDING, AppointmentStatus.DENIED, AppointmentStatus.CANCELLED)) {
            Appointment appointment = new Appointment("B", other + "@example.com", "555", BARBER, TUE, "11:00", CUT);
            appointment.setStatus(other);
            appointmentRepository.save(appointment);
        }
        assertEquals(List.of(approved.getId()),
                appointmentRepository.findReminderIds(TUE, false, AppointmentStatus.APPROVED));
    }
}
