package com.example.taskflow.appointment;

import com.example.taskflow.appointment.internal.AppointmentRepository;
import com.example.taskflow.appointment.internal.BarberRepository;
import com.example.taskflow.appointment.internal.BarberScheduleRepository;
import com.example.taskflow.appointment.internal.BarberTimeOffRepository;
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
import org.springframework.test.web.servlet.MockMvc;

import java.math.BigDecimal;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.HashMap;
import java.util.Map;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Booking ownership at the HTTP boundary: a registered account sees the guest
 * bookings made with its email, and never another customer's. The cross-customer
 * cancel must fail without deleting the row.
 *
 * <p>Documents the current (email-based) ownership model. A manage-token or
 * verified-email ownership change must update these expectations.
 */
@SpringBootTest(properties = {"app.rate-limit.enabled=false"})
@AutoConfigureMockMvc
class CustomerOwnershipIntegrationTest {

    private static final String BARBER = "Ownership Barber";
    private static final String SERVICE = "Ownership Cut";

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
    private CacheManager cacheManager;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @BeforeEach
    void setUp() {
        appointmentRepository.deleteAll();
        barberTimeOffRepository.deleteAll();
        userRepository.deleteAll();
        Cache busySlots = cacheManager.getCache("busySlots");
        if (busySlots != null) {
            busySlots.clear();
        }
        ensureBarber();
        ensureService();
    }

    private void ensureBarber() {
        if (barberRepository.findByName(BARBER).isPresent()) {
            return;
        }
        Barber barber = barberRepository.save(new Barber(BARBER, "ownership@taskflow.com", "555-0100"));
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

    private LocalDate nextWorkingDate() {
        LocalDate date = LocalDate.now().plusDays(1);
        while (date.getDayOfWeek() == DayOfWeek.SUNDAY) {
            date = date.plusDays(1);
        }
        return date;
    }

    private String guestBooking(String email, String time) throws Exception {
        Map<String, Object> request = new HashMap<>();
        request.put("customerName", "Victim Customer");
        request.put("customerEmail", email);
        request.put("customerPhone", "555-0111");
        request.put("barberName", BARBER);
        request.put("bookingDate", nextWorkingDate().toString());
        request.put("bookingTime", time);
        request.put("serviceType", SERVICE);

        String body = mockMvc.perform(post("/api/v1/appointments")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(body).get("publicId").asText();
    }

    private void register(String email, String password) throws Exception {
        Map<String, Object> request = new HashMap<>();
        request.put("fullName", "Registered " + email);
        request.put("email", email);
        request.put("password", password);
        request.put("phone", "555-0222");
        mockMvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isCreated());
    }

    private String login(String email, String password) throws Exception {
        Map<String, String> request = new HashMap<>();
        request.put("username", email);
        request.put("password", password);
        return "Bearer " + mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getCookie("access_token").getValue();
    }

    @Test
    void registeredOwner_seesGuestBookingMadeWithItsEmail_caseInsensitively() throws Exception {
        String publicId = guestBooking("Victim@Example.com", "10:00");
        register("victim@example.com", "victim-pass-123");
        String victimToken = login("victim@example.com", "victim-pass-123");

        mockMvc.perform(get("/api/v1/customer/appointments").header("Authorization", victimToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content", hasSize(1)))
                .andExpect(jsonPath("$.content[0].publicId", is(publicId)));
    }

    @Test
    void otherCustomer_cannotSeeOrCancelVictimsBooking() throws Exception {
        String publicId = guestBooking("victim@example.com", "10:00");
        register("victim@example.com", "victim-pass-123");
        register("bob@example.com", "bob-pass-12345");
        String bobToken = login("bob@example.com", "bob-pass-12345");

        mockMvc.perform(get("/api/v1/customer/appointments").header("Authorization", bobToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content", hasSize(0)))
                .andExpect(jsonPath("$.page.totalElements", is(0)));

        mockMvc.perform(delete("/api/v1/customer/appointments/" + publicId)
                        .header("Authorization", bobToken))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.message", containsString("not found or unauthorized")));

        assertNotNull(appointmentRepository.findByPublicId(publicId),
                "a failed cross-customer cancel must not delete the booking");
    }

    @Test
    void duplicateRegistration_isRejected() throws Exception {
        register("victim@example.com", "victim-pass-123");

        Map<String, Object> request = new HashMap<>();
        request.put("fullName", "Imposter");
        request.put("email", "victim@example.com");
        request.put("password", "imposter-pass-123");
        request.put("phone", "555-0333");
        mockMvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadRequest());
    }
}
