package com.example.taskflow.appointment;

import com.example.taskflow.appointment.internal.AppointmentRepository;
import com.example.taskflow.appointment.internal.BarberRepository;
import com.example.taskflow.appointment.internal.BarberScheduleRepository;
import com.example.taskflow.auth.AppUser;
import com.example.taskflow.auth.internal.UserRepository;
import com.example.taskflow.catalog.ServiceItem;
import com.example.taskflow.catalog.internal.ServiceItemRepository;
import com.example.taskflow.notification.internal.NotificationOutboxRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import java.math.BigDecimal;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.temporal.TemporalAdjusters;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.not;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {"app.rate-limit.enabled=false", "app.schedulers.enabled=false"})
@AutoConfigureMockMvc
class AppointmentSelfServiceIntegrationTest {

    private static final LocalDate THURSDAY = LocalDate.now().plusDays(7)
            .with(TemporalAdjusters.nextOrSame(DayOfWeek.THURSDAY));
    private static final LocalDate FRIDAY = THURSDAY.plusDays(1);

    @Autowired private MockMvc mockMvc;
    @Autowired private AppointmentRepository appointmentRepository;
    @Autowired private BarberRepository barberRepository;
    @Autowired private BarberScheduleRepository barberScheduleRepository;
    @Autowired private ServiceItemRepository serviceItemRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private NotificationOutboxRepository outboxRepository;
    @Autowired private PasswordEncoder passwordEncoder;
    @Autowired private JdbcTemplate jdbc;

    private final ObjectMapper objectMapper = new ObjectMapper();
    private String adminToken;
    private String customerToken;
    private Barber barber;
    private ServiceItem service;

    @BeforeEach
    void setUp() throws Exception {
        jdbc.update("DELETE FROM reviews");
        outboxRepository.deleteAll();
        appointmentRepository.deleteAll();
        barberScheduleRepository.deleteAll();
        barberRepository.deleteAll();
        serviceItemRepository.deleteAll();
        userRepository.deleteAll();

        userRepository.save(new AppUser("admin@taskflow.com", passwordEncoder.encode("admin-password"),
                "Admin", "555-0001", "ROLE_ADMIN"));
        userRepository.save(new AppUser("jane@taskflow.com", passwordEncoder.encode("Pass1234"),
                "Jane Doe", "555-0002", "ROLE_CUSTOMER"));

        adminToken = "Bearer " + login("admin@taskflow.com", "admin-password");
        customerToken = "Bearer " + login("jane@taskflow.com", "Pass1234");

        service = serviceItemRepository.save(
                new ServiceItem("Signature Cut", new BigDecimal("40.00"), 60, "hair", "Cut"));
        barber = barberRepository.save(new Barber("Marco", "marco@taskflow.com", "555-0100"));
        for (LocalDate day : List.of(THURSDAY, FRIDAY)) {
            BarberSchedule schedule = new BarberSchedule();
            schedule.setBarber(barber);
            schedule.setDayOfWeek(day.getDayOfWeek().getValue());
            schedule.setStartTime(LocalTime.of(9, 0));
            schedule.setEndTime(LocalTime.of(17, 0));
            barberScheduleRepository.save(schedule);
        }
    }

    private String login(String username, String password) throws Exception {
        return mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("username", username, "password", password))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getCookie("access_token").getValue();
    }

    @Test
    void calendarExportUsesStoredEndTimeAndVerifiesOwnership() throws Exception {
        Map<String, Object> createPayload = Map.of(
                "customerName", "Jane Doe",
                "customerEmail", "jane@taskflow.com",
                "customerPhone", "555-0002",
                "barberName", "Marco",
                "bookingDate", THURSDAY.toString(),
                "bookingTime", "10:00",
                "serviceType", "Signature Cut");

        String createdJson = mockMvc.perform(post("/api/v1/appointments")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(createPayload)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        String publicId = objectMapper.readTree(createdJson).get("publicId").asText();

        // Change catalog duration after booking: calendar export must still reflect the booked 60m interval.
        service.setDurationMinutes(120);
        serviceItemRepository.save(service);

        // Wrong guest email is rejected with 404 (no enumeration oracle).
        mockMvc.perform(post("/api/v1/appointments/public/calendar/" + publicId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"wrong@taskflow.com\"}"))
                .andExpect(status().isNotFound());

        // Verified guest export succeeds and sends no-store.
        String exportJson = mockMvc.perform(post("/api/v1/appointments/public/calendar/" + publicId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"JANE@taskflow.com\"}"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", containsString("no-store")))
                .andExpect(jsonPath("$.filename", is("appointment-" + publicId + ".ics")))
                .andReturn().getResponse().getContentAsString();
        String ics = objectMapper.readTree(exportJson).get("content").asText();
        assertTrue(ics.contains("BEGIN:VCALENDAR\r\n"));
        assertTrue(ics.contains("UID:" + publicId + "@taskflow\r\n"));
        assertTrue(ics.contains("STATUS:TENTATIVE\r\n"));
        assertTrue(!ics.contains("jane@taskflow.com"), "ICS must not leak customer email");

        // Signed-in customer export succeeds.
        mockMvc.perform(get("/api/v1/customer/appointments/" + publicId + "/calendar")
                        .header("Authorization", customerToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.filename", is("appointment-" + publicId + ".ics")));
    }

    @Test
    void atomicRescheduleMovesSlotResetsApprovalAndPreservesCreationIdempotencyReplay() throws Exception {
        Map<String, Object> createPayload = Map.of(
                "customerName", "Jane Doe",
                "customerEmail", "jane@taskflow.com",
                "customerPhone", "555-0002",
                "barberName", "Marco",
                "bookingDate", THURSDAY.toString(),
                "bookingTime", "10:00",
                "serviceType", "Signature Cut");

        String createdJson = mockMvc.perform(post("/api/v1/appointments")
                        .header("Idempotency-Key", "idem-resched-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(createPayload)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        JsonNode created = objectMapper.readTree(createdJson);
        long id = created.get("id").asLong();
        String publicId = created.get("publicId").asText();

        // Approve the booking first.
        mockMvc.perform(put("/api/v1/appointments/" + id)
                        .header("Authorization", adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"APPROVED\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("APPROVED")));

        // Reschedule as guest to 14:00: status resets to PENDING, publicId and id stay identical.
        mockMvc.perform(put("/api/v1/appointments/public/reschedule/" + publicId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "email", "jane@taskflow.com",
                                "bookingDate", THURSDAY.toString(),
                                "bookingTime", "14:00"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id", is((int) id)))
                .andExpect(jsonPath("$.publicId", is(publicId)))
                .andExpect(jsonPath("$.bookingTime", is("14:00")))
                .andExpect(jsonPath("$.status", is("PENDING")));

        // Old slot (10:00) is free again; new slot (14:00) is busy.
        mockMvc.perform(get("/api/v1/appointments/public/busy-slots")
                        .param("barberName", "Marco")
                        .param("bookingDate", THURSDAY.toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", not(hasItem("10:00"))))
                .andExpect(jsonPath("$", hasItem("14:00")));

        // Replaying the original creation request with Idempotency-Key still matches the frozen creation fingerprint.
        mockMvc.perform(post("/api/v1/appointments")
                        .header("Idempotency-Key", "idem-resched-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(createPayload)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id", is((int) id)));

        // Customer reschedule to Friday 11:00 also succeeds.
        mockMvc.perform(put("/api/v1/customer/appointments/" + publicId + "/reschedule")
                        .header("Authorization", customerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "bookingDate", FRIDAY.toString(),
                                "bookingTime", "11:00"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bookingDate", is(FRIDAY.toString())))
                .andExpect(jsonPath("$.bookingTime", is("11:00")));
    }

    private String bookThursday(String name, String email, String time, String serviceType) throws Exception {
        String json = mockMvc.perform(post("/api/v1/appointments")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "customerName", name,
                                "customerEmail", email,
                                "customerPhone", "555-0002",
                                "barberName", "Marco",
                                "bookingDate", THURSDAY.toString(),
                                "bookingTime", time,
                                "serviceType", serviceType))))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(json).get("publicId").asText();
    }

    private ResultActions guestAvailability(String publicId, String email, LocalDate date) throws Exception {
        return mockMvc.perform(post("/api/v1/appointments/public/reschedule/" + publicId + "/availability")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(Map.of("email", email, "bookingDate", date.toString()))));
    }

    /**
     * What the reschedule pickers show: the booking's own barber and booked length, with the booking
     * itself not counted, so it may move within its own interval and a later catalog change (another
     * length, a retired service) does not matter. The create-time answer differs on each point.
     */
    @Test
    void rescheduleAvailabilityUsesTheBookedLengthAndIgnoresTheBookingItself() throws Exception {
        // Through the API, which evicts the cached catalog the create-time answer reads.
        Map<String, Object> colour = new HashMap<>(Map.of("name", "Long Colour", "price", 90,
                "durationMinutes", 120, "category", "hair", "description", "Colour"));
        long colourId = objectMapper.readTree(mockMvc.perform(post("/api/v1/catalog")
                        .header("Authorization", adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(colour)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString()).get("id").asLong();
        String publicId = bookThursday("Jane Doe", "jane@taskflow.com", "10:00", "Long Colour");
        bookThursday("Bob Roe", "bob@taskflow.com", "14:00", "Signature Cut");

        // For a new booking the 10:00-12:00 booking blocks 11:00.
        mockMvc.perform(get("/api/v1/appointments/public/busy-slots")
                        .param("barberName", "Marco")
                        .param("bookingDate", THURSDAY.toString())
                        .param("serviceType", "Long Colour"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasItem("11:00")));

        // Moving it, only Bob's 14:00 (13:00 would overlap it) and closing time (16:00 + 2 h) count.
        guestAvailability(publicId, "JANE@taskflow.com", THURSDAY)
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", containsString("no-store")))
                .andExpect(jsonPath("$", contains("13:00", "14:00", "16:00")));
        mockMvc.perform(get("/api/v1/customer/appointments/" + publicId + "/availability")
                        .param("bookingDate", THURSDAY.toString())
                        .header("Authorization", customerToken))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", containsString("no-store")))
                .andExpect(jsonPath("$", contains("13:00", "14:00", "16:00")));

        // A shorter catalog length, then retiring the service: the booked 120 minutes still count.
        colour.put("durationMinutes", 60);
        mockMvc.perform(put("/api/v1/catalog/" + colourId)
                        .header("Authorization", adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(colour)))
                .andExpect(status().isOk());
        guestAvailability(publicId, "jane@taskflow.com", THURSDAY)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", contains("13:00", "14:00", "16:00")));
        mockMvc.perform(delete("/api/v1/catalog/" + colourId).header("Authorization", adminToken))
                .andExpect(status().isNoContent());
        mockMvc.perform(get("/api/v1/appointments/public/busy-slots")
                        .param("barberName", "Marco")
                        .param("bookingDate", THURSDAY.toString())
                        .param("serviceType", "Long Colour"))
                .andExpect(status().isBadRequest());
        guestAvailability(publicId, "jane@taskflow.com", THURSDAY)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", contains("13:00", "14:00", "16:00")));

        // And the move into its own old interval goes through.
        mockMvc.perform(put("/api/v1/customer/appointments/" + publicId + "/reschedule")
                        .header("Authorization", customerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "bookingDate", THURSDAY.toString(), "bookingTime", "11:00"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bookingTime", is("11:00")));
    }

    @Test
    void rescheduleAvailabilityVerifiesTheBookingAndTheDate() throws Exception {
        String publicId = bookThursday("Jane Doe", "jane@taskflow.com", "10:00", "Signature Cut");

        // A wrong email, or another account's booking, gets the same 404 as a missing booking.
        guestAvailability(publicId, "wrong@taskflow.com", THURSDAY).andExpect(status().isNotFound());
        mockMvc.perform(get("/api/v1/customer/appointments/" + publicId + "/availability")
                        .param("bookingDate", THURSDAY.toString())
                        .header("Authorization", adminToken))
                .andExpect(status().isNotFound());

        // Malformed or missing dates are 400.
        mockMvc.perform(post("/api/v1/appointments/public/reschedule/" + publicId + "/availability")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"jane@taskflow.com\",\"bookingDate\":\"2030-02-30\"}"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(post("/api/v1/appointments/public/reschedule/" + publicId + "/availability")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"jane@taskflow.com\"}"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(get("/api/v1/customer/appointments/" + publicId + "/availability")
                        .param("bookingDate", "not-a-date")
                        .header("Authorization", customerToken))
                .andExpect(status().isBadRequest());
        mockMvc.perform(get("/api/v1/customer/appointments/" + publicId + "/availability")
                        .header("Authorization", customerToken))
                .andExpect(status().isBadRequest());

        // Every slot is busy on a working day outside the booking window, and on a day off.
        LocalDate pastThursday = LocalDate.now().minusDays(2).with(TemporalAdjusters.previousOrSame(DayOfWeek.THURSDAY));
        LocalDate lateThursday = LocalDate.now().plusDays(120).with(TemporalAdjusters.nextOrSame(DayOfWeek.THURSDAY));
        for (LocalDate date : List.of(pastThursday, lateThursday, THURSDAY.plusDays(2))) {
            guestAvailability(publicId, "jane@taskflow.com", date)
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$", is(BusySlotsService.ALL_SLOTS)));
        }

        // A cancelled booking cannot move: 409, like the move itself.
        mockMvc.perform(put("/api/v1/appointments/public/cancel/" + publicId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"jane@taskflow.com\"}"))
                .andExpect(status().isNoContent());
        guestAvailability(publicId, "jane@taskflow.com", THURSDAY).andExpect(status().isConflict());
    }

    @Test
    void weeklyScheduleUpdateRequiresConflictPreviewConfirmationBeforeCancellingBookings() throws Exception {
        mockMvc.perform(post("/api/v1/appointments")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "customerName", "Jane Doe",
                                "customerEmail", "jane@taskflow.com",
                                "customerPhone", "555-0002",
                                "barberName", "Marco",
                                "bookingDate", THURSDAY.toString(),
                                "bookingTime", "16:00",
                                "serviceType", "Signature Cut"))))
                .andExpect(status().isCreated());

        String scheduleJson = mockMvc.perform(get("/api/v1/barbers/" + barber.getId() + "/schedule")
                        .header("Authorization", adminToken))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String revision = objectMapper.readTree(scheduleJson).get("revision").asText();

        // Shortening Thursday to close at 15:00 conflicts with the 16:00 booking.
        List<Map<String, Object>> shortenedDays = List.of(
                Map.of("dayOfWeek", THURSDAY.getDayOfWeek().getValue(), "opens", "09:00", "closes", "15:00"));

        String previewJson = mockMvc.perform(post("/api/v1/barbers/" + barber.getId() + "/schedule/preview")
                        .header("Authorization", adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "days", shortenedDays,
                                "expectedRevision", revision,
                                "cancelConflictingAppointments", false))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.conflictCount", is(1)))
                .andReturn().getResponse().getContentAsString();
        String conflictsRevision = objectMapper.readTree(previewJson).get("conflictsRevision").asText();

        // Null day elements are rejected with 400 (Bean Validation), never a 500 NPE.
        mockMvc.perform(post("/api/v1/barbers/" + barber.getId() + "/schedule/preview")
                        .header("Authorization", adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"days\":[null],\"expectedRevision\":\"" + revision + "\",\"cancelConflictingAppointments\":false}"))
                .andExpect(status().isBadRequest());

        // Saving without confirmation is rejected with 409.
        mockMvc.perform(put("/api/v1/barbers/" + barber.getId() + "/schedule")
                        .header("Authorization", adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "days", shortenedDays,
                                "expectedRevision", revision,
                                "cancelConflictingAppointments", false))))
                .andExpect(status().isConflict());

        // Saving with explicit confirmation and matching conflictsRevision succeeds and cancels the booking.
        mockMvc.perform(put("/api/v1/barbers/" + barber.getId() + "/schedule")
                        .header("Authorization", adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "days", shortenedDays,
                                "expectedRevision", revision,
                                "expectedConflicts", conflictsRevision,
                                "cancelConflictingAppointments", true))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.days[0].closes", is("15:00")));

        assertEquals(AppointmentStatus.CANCELLED, appointmentRepository.findAll().getFirst().getStatusEnum());
    }
}
