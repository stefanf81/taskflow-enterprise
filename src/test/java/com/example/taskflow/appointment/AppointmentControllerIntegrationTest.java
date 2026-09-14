package com.example.taskflow.appointment;
import com.example.taskflow.appointment.internal.AppointmentRepository;

import com.example.taskflow.auth.TestSecurityConfig;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.time.LocalDate;
import java.util.HashMap;
import java.util.Map;

import static org.hamcrest.Matchers.*;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = {"app.rate-limit.enabled=false", "app.stats.cache.ttl=0"})
@AutoConfigureMockMvc
@Import(TestSecurityConfig.class)
class AppointmentControllerIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private AppointmentRepository appointmentRepository;

    private ObjectMapper objectMapper = new ObjectMapper();

    private String authHeader;

    private LocalDate getNextWorkingDate() {
        LocalDate date = LocalDate.now().plusDays(1);
        while (date.getDayOfWeek() == java.time.DayOfWeek.SUNDAY) {
            date = date.plusDays(1);
        }
        return date;
    }

    private LocalDate getNextSunday() {
        LocalDate date = LocalDate.now().plusDays(1);
        while (date.getDayOfWeek() != java.time.DayOfWeek.SUNDAY) {
            date = date.plusDays(1);
        }
        return date;
    }

    private Map<String, Object> appointmentRequest(String email, String barberName, String time) {
        Map<String, Object> request = new HashMap<>();
        request.put("customerName", "Guest John");
        request.put("customerEmail", email);
        request.put("customerPhone", "555-1234");
        request.put("barberName", barberName);
        request.put("bookingDate", getNextWorkingDate().toString());
        request.put("bookingTime", time);
        request.put("serviceType", "Beard Trim & Shave");
        return request;
    }

    @BeforeEach
    void setUp() throws Exception {
        appointmentRepository.deleteAll();

        // Retrieve valid JWT token by calling the login endpoint
        Map<String, String> loginRequest = new HashMap<>();
        loginRequest.put("username", "admin");
        loginRequest.put("password", "admin-password");

        // The JWT now lives in the HttpOnly 'access_token' cookie (C2 migration);
        // it is no longer returned in the response body.
        String cookie = mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(loginRequest)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getCookie("access_token").getValue();

        authHeader = "Bearer " + cookie;
    }

    @Test
    void shouldCreateAppointmentSuccessfullyAsGuestWithoutAuth() throws Exception {
        Map<String, Object> request = appointmentRequest("john.doe@example.com", "Sara the Stylist", "10:30");

        String createdId = objectMapper.readTree(mockMvc.perform(post("/api/v1/appointments")
                        .header("Idempotency-Key", "test-idempotent-key")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id", notNullValue()))
                .andExpect(jsonPath("$.customerName", is("Guest John")))
                .andExpect(jsonPath("$.status", is("PENDING")))
                .andReturn().getResponse().getContentAsString()).get("id").asText();

        // H1: an identical replay is a 200 with the same resource, not a 201.
        mockMvc.perform(post("/api/v1/appointments")
                        .header("Idempotency-Key", "test-idempotent-key")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id", is(Integer.parseInt(createdId))))
                .andExpect(jsonPath("$.customerName", is("Guest John")));
    }

    @Test
    void shouldRejectOverlongIdempotencyKey() throws Exception {
        Map<String, Object> request = appointmentRequest("john.doe@example.com", "Sara the Stylist", "10:30");
        String overlongKey = "k".repeat(101);

        mockMvc.perform(post("/api/v1/appointments")
                        .header("Idempotency-Key", overlongKey)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void shouldRejectIdempotencyReplayForDifferentCustomer() throws Exception {
        Map<String, Object> request = appointmentRequest("owner@example.com", "Sara the Stylist", "10:30");

        mockMvc.perform(post("/api/v1/appointments")
                        .header("Idempotency-Key", "shared-key")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isCreated());

        Map<String, Object> attackerRequest = appointmentRequest("attacker@example.com", "Sara the Stylist", "10:30");

        mockMvc.perform(post("/api/v1/appointments")
                        .header("Idempotency-Key", "shared-key")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(attackerRequest)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message", containsString("already used")))
                .andExpect(jsonPath("$.customerEmail").doesNotExist());
    }

    @Test
    void shouldRejectIdempotencyReplayForDifferentPayload() throws Exception {
        Map<String, Object> request = appointmentRequest("john.doe@example.com", "Sara the Stylist", "10:30");

        mockMvc.perform(post("/api/v1/appointments")
                        .header("Idempotency-Key", "shared-key-2")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isCreated());

        Map<String, Object> otherSlot = appointmentRequest("john.doe@example.com", "Sara the Stylist", "11:30");

        mockMvc.perform(post("/api/v1/appointments")
                        .header("Idempotency-Key", "shared-key-2")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(otherSlot)))
                .andExpect(status().isConflict());
    }

    @Test
    void shouldResolveNoPreferenceBookingToConcreteBarber() throws Exception {
        Map<String, Object> request = appointmentRequest(
                "no.pref@example.com", "No Preference (First Available)", "10:30");

        mockMvc.perform(post("/api/v1/appointments")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.barberName", not("No Preference (First Available)")));

        Appointment persisted = appointmentRepository.findAll().stream()
                .filter(a -> "no.pref@example.com".equals(a.getCustomerEmail()))
                .findFirst().orElseThrow();
        assertNotNull(persisted.getBarber());
        assertFalse("No Preference (First Available)".equals(persisted.getBarberName()));
    }

    @Test
    void shouldPreventSpecificBarberDoubleBookingAfterSentinelAssignment() throws Exception {
        Map<String, Object> sentinelRequest = appointmentRequest(
                "sentinel@example.com", "No Preference (First Available)", "10:30");

        String assignedBarber = objectMapper.readTree(mockMvc.perform(post("/api/v1/appointments")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(sentinelRequest)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString()).get("barberName").asText();

        Map<String, Object> specificRequest = appointmentRequest(
                "specific@example.com", assignedBarber, "10:30");

        mockMvc.perform(post("/api/v1/appointments")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(specificRequest)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void shouldRejectNoPreferenceBookingWhenNoBarberIsWorking() throws Exception {
        Map<String, Object> request = appointmentRequest(
                "sunday@example.com", "No Preference (First Available)", "10:30");
        request.put("bookingDate", getNextSunday().toString());

        mockMvc.perform(post("/api/v1/appointments")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", containsString("No barber is available")));
    }

    @Test
    void shouldReturnBadRequestWhenCustomerNameIsBlank() throws Exception {
        Map<String, Object> request = new HashMap<>();
        request.put("customerName", " ");
        request.put("customerEmail", "invalid-email");
        request.put("customerPhone", "555-1234");
        request.put("barberName", "Sara the Stylist");
        request.put("bookingDate", getNextWorkingDate().toString());
        request.put("bookingTime", "10:30");
        request.put("serviceType", "Beard Trim & Shave");

        mockMvc.perform(post("/api/v1/appointments")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status", is(400)))
                .andExpect(jsonPath("$.message", is("Validation failed")))
                .andExpect(jsonPath("$.validationErrors", hasSize(2))); // Name blank + invalid email
    }

    @Test
    void shouldGetAllAppointmentsFilteredByStatusForAdmin() throws Exception {
        Appointment item1 = new Appointment("Client 1", "client1@test.com", "123", "Barber Alex", LocalDate.now(), "10:00", "Haircut");
        Appointment item2 = new Appointment("Client 2", "client2@test.com", "456", "Barber Sara", LocalDate.now(), "11:00", "Beard");
        item2.setStatus("APPROVED");
        appointmentRepository.save(item1);
        appointmentRepository.save(item2);

        mockMvc.perform(get("/api/v1/appointments?status=APPROVED")
                        .header("Authorization", authHeader))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.page.content", hasSize(1)))
                .andExpect(jsonPath("$.page.content[0].customerName", is("Client 2")))
                .andExpect(jsonPath("$.page.content[0].status", is("APPROVED")))
                .andExpect(jsonPath("$.stats.total", is(2)))
                .andExpect(jsonPath("$.stats.approved", is(1)));
    }

    @Test
    void shouldSerializeDashboardPaginationAsPagedModel() throws Exception {
        Appointment item1 = new Appointment("Client 1", "client1@test.com", "123", "Barber Alex", LocalDate.now(), "10:00", "Haircut");
        Appointment item2 = new Appointment("Client 2", "client2@test.com", "456", "Barber Sara", LocalDate.now(), "11:00", "Beard");
        appointmentRepository.save(item1);
        appointmentRepository.save(item2);

        mockMvc.perform(get("/api/v1/appointments?page=1&size=1")
                        .header("Authorization", authHeader))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.page.content", hasSize(1)))
                .andExpect(jsonPath("$.page.page.number", is(1)))
                .andExpect(jsonPath("$.page.page.size", is(1)))
                .andExpect(jsonPath("$.page.page.totalElements", is(2)))
                .andExpect(jsonPath("$.page.page.totalPages", is(2)))
                .andExpect(jsonPath("$.page.totalPages").doesNotExist())
                .andExpect(jsonPath("$.page.pageable").doesNotExist())
                .andExpect(jsonPath("$.page.sort").doesNotExist());
    }

    @Test
    void shouldReturnUnauthorizedToViewAllAppointmentsWithoutAuthHeader() throws Exception {
        mockMvc.perform(get("/api/v1/appointments"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void shouldUpdateAppointmentStatusSuccessfullyAsAdmin() throws Exception {
        Appointment item = new Appointment("Alex", "alex@test.com", "123", "Barber", LocalDate.now(), "10:00", "Haircut");
        Appointment savedItem = appointmentRepository.save(item);

        Map<String, Object> request = new HashMap<>();
        request.put("status", "APPROVED");

        mockMvc.perform(put("/api/v1/appointments/" + savedItem.getId())
                        .header("Authorization", authHeader)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("APPROVED")));

        Appointment updatedItem = appointmentRepository.findById(savedItem.getId()).orElseThrow();
        assertTrue("APPROVED".equalsIgnoreCase(updatedItem.getStatus()));
    }

    @Test
    void shouldDeleteAppointmentSuccessfullyAsAdmin() throws Exception {
        Appointment item = new Appointment("Cancel Me", "test@test.com", "123", "Barber", LocalDate.now(), "10:00", "Haircut");
        Appointment savedItem = appointmentRepository.save(item);

        mockMvc.perform(delete("/api/v1/appointments/" + savedItem.getId())
                        .header("Authorization", authHeader))
                .andExpect(status().isNoContent());

        assertFalse(appointmentRepository.existsById(savedItem.getId()));
    }

    @Test
    void shouldGetAppointmentByIdSuccessfully() throws Exception {
        Appointment item = new Appointment("Alex", "alex@test.com", "123", "Barber", LocalDate.now(), "10:00", "Haircut");
        Appointment savedItem = appointmentRepository.save(item);

        mockMvc.perform(get("/api/v1/appointments/" + savedItem.getId())
                        .header("Authorization", authHeader))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.customerName", is("Alex")));
    }

    @Test
    void shouldReturnNotFoundForInvalidAppointmentId() throws Exception {
        mockMvc.perform(get("/api/v1/appointments/99999")
                        .header("Authorization", authHeader))
                .andExpect(status().isNotFound());
    }

    @Test
    void shouldReturnBusySlotsSuccessfully() throws Exception {
        LocalDate testDate = getNextWorkingDate();
        Appointment item = new Appointment("Alex", "alex@test.com", "123", "Barber Alex", testDate, "10:00", "Haircut");
        item.setStatus("APPROVED");
        appointmentRepository.save(item);

        mockMvc.perform(get("/api/v1/appointments/public/busy-slots")
                        .param("barberName", "Barber Alex")
                        .param("bookingDate", testDate.toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0]", is("10:00")));
    }

    @Test
    void shouldPublicCancelAppointmentSuccessfully() throws Exception {
        Appointment item = new Appointment("Alex", "alex@test.com", "123", "Barber", LocalDate.now(), "10:00", "Haircut");
        Appointment savedItem = appointmentRepository.save(item);

        mockMvc.perform(put("/api/v1/appointments/public/cancel/" + savedItem.getPublicId())
                        .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new CancelRequest("alex@test.com"))))
                .andExpect(status().isNoContent());

        assertFalse(appointmentRepository.existsById(savedItem.getId()));
    }

    @Test
    void shouldReturnNotFoundWhenDeletingInvalidAppointment() throws Exception {
        mockMvc.perform(delete("/api/v1/appointments/99999")
                        .header("Authorization", authHeader))
                .andExpect(status().isNotFound());
    }
}
