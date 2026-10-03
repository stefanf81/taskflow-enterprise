package com.example.taskflow.appointment;

import com.example.taskflow.appointment.internal.AppointmentRepository;
import com.example.taskflow.appointment.internal.BarberRepository;
import com.example.taskflow.appointment.internal.BarberScheduleRepository;
import com.example.taskflow.appointment.internal.BarberTimeOffRepository;
import com.example.taskflow.auth.AppUser;
import com.example.taskflow.auth.internal.UserRepository;
import com.example.taskflow.catalog.ServiceItem;
import com.example.taskflow.catalog.internal.ServiceItemRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;

import java.math.BigDecimal;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.HashMap;
import java.util.Map;

import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.not;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Gaps in the {@code Idempotency-Key} replay contract beyond the base cases
 * already covered by {@code AppointmentControllerIntegrationTest}.
 */
@SpringBootTest(properties = {"app.rate-limit.enabled=false"})
@AutoConfigureMockMvc
class IdempotencyReplayIntegrationTest {

    private static final String BARBER = "Idem Barber";
    private static final String OTHER_BARBER = "Idem Alternate Barber";
    private static final String SERVICE = "Idem Cut";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private AppointmentRepository appointmentRepository;

    @Autowired
    private BarberRepository barberRepository;

    @Autowired
    private BarberScheduleRepository barberScheduleRepository;

    @Autowired
    private BarberTimeOffRepository barberTimeOffRepository;

    @Autowired
    private ServiceItemRepository serviceItemRepository;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Autowired
    private CacheManager cacheManager;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private String adminToken;

    @BeforeEach
    void setUp() throws Exception {
        appointmentRepository.deleteAll();
        barberTimeOffRepository.deleteAll();
        userRepository.deleteAll();
        Cache busySlots = cacheManager.getCache("busySlots");
        if (busySlots != null) {
            busySlots.clear();
        }
        ensureBarber(BARBER);
        ensureBarber(OTHER_BARBER);
        ensureService();

        userRepository.save(new AppUser("admin@taskflow.com", passwordEncoder.encode("admin-password"),
                "Shop Owner", "555-0001", "ROLE_ADMIN"));
        adminToken = "Bearer " + login("admin@taskflow.com", "admin-password");
    }

    private void ensureBarber(String name) {
        if (barberRepository.findByName(name).isPresent()) {
            return;
        }
        Barber barber = barberRepository.save(new Barber(name, name.replace(' ', '.') + "@taskflow.com", "555-0100"));
        for (int day = 1; day <= 6; day++) {
            BarberSchedule schedule = new BarberSchedule();
            schedule.setBarber(barber);
            schedule.setDayOfWeek(day);
            schedule.setStartTime(LocalTime.of(9, 0));
            schedule.setEndTime(LocalTime.of(17, 0));
            barberScheduleRepository.save(schedule);
        }
    }

    private void ensureService() {
        if (serviceItemRepository.findByName(SERVICE).isEmpty()) {
            serviceItemRepository.save(new ServiceItem(SERVICE, new BigDecimal("25.00"), 30, "hair", ""));
        }
    }

    private String login(String username, String password) throws Exception {
        Map<String, String> request = new HashMap<>();
        request.put("username", username);
        request.put("password", password);
        return mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getCookie("access_token").getValue();
    }

    private LocalDate nextWorkingDate() {
        LocalDate date = LocalDate.now().plusDays(1);
        while (date.getDayOfWeek() == DayOfWeek.SUNDAY) {
            date = date.plusDays(1);
        }
        return date;
    }

    private Map<String, Object> request(String email, String barber, String time) {
        return request(email, barber, time, SERVICE, nextWorkingDate().toString());
    }

    private Map<String, Object> request(String email, String barber, String time, String service, String date) {
        Map<String, Object> request = new HashMap<>();
        request.put("customerName", "Idem Customer");
        request.put("customerEmail", email);
        request.put("customerPhone", "555-0444");
        request.put("barberName", barber);
        request.put("bookingDate", date);
        request.put("bookingTime", time);
        request.put("serviceType", service);
        return request;
    }

    private String create(Map<String, Object> request, String key) throws Exception {
        return mockMvc.perform(post("/api/v1/appointments")
                        .header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
    }

    @Test
    void sentinelReplay_returnsOriginalResolvedBarber() throws Exception {
        Map<String, Object> request = request("sentinel@example.com",
                AppointmentServiceImpl.NO_PREFERENCE_BARBER, "10:00");
        String created = create(request, "sentinel-key");
        String resolvedBarber = objectMapper.readTree(created).get("barberName").asText();

        mockMvc.perform(post("/api/v1/appointments")
                        .header("Idempotency-Key", "sentinel-key")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id", is(objectMapper.readTree(created).get("id").asInt())))
                .andExpect(jsonPath("$.barberName", is(resolvedBarber)))
                .andExpect(jsonPath("$.barberName", not(AppointmentServiceImpl.NO_PREFERENCE_BARBER)));
    }

    @Test
    void differentService_replayConflicts() throws Exception {
        Map<String, Object> request = request("service@example.com", BARBER, "10:00");
        create(request, "service-key");

        Map<String, Object> changed = request("service@example.com", BARBER, "10:00",
                "Some Other Service", nextWorkingDate().toString());
        mockMvc.perform(post("/api/v1/appointments")
                        .header("Idempotency-Key", "service-key")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(changed)))
                .andExpect(status().isConflict());
    }

    @Test
    void differentBarber_replayConflicts() throws Exception {
        create(request("barber@example.com", BARBER, "10:00"), "barber-key");

        mockMvc.perform(post("/api/v1/appointments")
                        .header("Idempotency-Key", "barber-key")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                request("barber@example.com", OTHER_BARBER, "10:00"))))
                .andExpect(status().isConflict());
    }

    @Test
    void differentDate_replayConflicts() throws Exception {
        LocalDate date = nextWorkingDate();
        Map<String, Object> request = request("date@example.com", BARBER, "10:00", SERVICE, date.toString());
        create(request, "date-key");

        LocalDate other = date.plusDays(1);
        while (other.getDayOfWeek() == DayOfWeek.SUNDAY) {
            other = other.plusDays(1);
        }
        mockMvc.perform(post("/api/v1/appointments")
                        .header("Idempotency-Key", "date-key")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                request("date@example.com", BARBER, "10:00", SERVICE, other.toString()))))
                .andExpect(status().isConflict());
    }

    @Test
    void keyIsTrimmedBeforeLookup() throws Exception {
        Map<String, Object> request = request("trim@example.com", BARBER, "10:00");
        String created = create(request, "   idem-trim-key   ");

        mockMvc.perform(post("/api/v1/appointments")
                        .header("Idempotency-Key", "idem-trim-key")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id", is(objectMapper.readTree(created).get("id").asInt())));
    }

    @Test
    void blankKey_isTreatedAsAbsent() throws Exception {
        create(request("blank@example.com", BARBER, "10:00"), "   ");

        // A blank key must not be stored/looked up, so a second booking at a
        // different time creates a new row (201) rather than replaying or
        // colliding.
        mockMvc.perform(post("/api/v1/appointments")
                        .header("Idempotency-Key", "   ")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                request("blank@example.com", BARBER, "11:00"))))
                .andExpect(status().isCreated());
    }

    @Test
    void replayAfterStatusChange_stillReturnsReplay() throws Exception {
        Map<String, Object> request = request("status@example.com", BARBER, "10:00");
        String created = create(request, "status-key");
        int id = objectMapper.readTree(created).get("id").asInt();

        mockMvc.perform(put("/api/v1/appointments/" + id)
                        .header("Authorization", adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"APPROVED\"}"))
                .andExpect(status().isOk());

        mockMvc.perform(post("/api/v1/appointments")
                        .header("Idempotency-Key", "status-key")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id", is(id)))
                .andExpect(jsonPath("$.status", is("APPROVED")));
    }

    @Test
    void caseInsensitiveEmail_replayIsHonored() throws Exception {
        create(request("Case@Example.com", BARBER, "10:00"), "case-key");

        mockMvc.perform(post("/api/v1/appointments")
                        .header("Idempotency-Key", "case-key")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                request("case@example.com", BARBER, "10:00"))))
                .andExpect(status().isOk());
    }

    @Test
    void maxLengthKey_isAccepted() throws Exception {
        String hundredCharKey = "k".repeat(100);
        create(request("maxkey@example.com", BARBER, "10:00"), hundredCharKey);

        mockMvc.perform(post("/api/v1/appointments")
                        .header("Idempotency-Key", hundredCharKey)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                request("maxkey@example.com", BARBER, "10:00"))))
                .andExpect(status().isOk());
    }
}
