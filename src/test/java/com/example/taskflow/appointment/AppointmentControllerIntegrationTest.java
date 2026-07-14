package com.example.taskflow.appointment;

import com.example.taskflow.auth.TestSecurityConfig;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.time.LocalDate;
import java.util.HashMap;
import java.util.Map;

import static org.hamcrest.Matchers.*;
import static org.junit.jupiter.api.Assertions.assertFalse;
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

    @Autowired
    private ObjectMapper objectMapper;

    private String authHeader;

    @BeforeEach
    void setUp() throws Exception {
        appointmentRepository.deleteAll();

        // Retrieve valid JWT token by calling the login endpoint
        Map<String, String> loginRequest = new HashMap<>();
        loginRequest.put("username", "admin");
        loginRequest.put("password", "admin-password");

        String responseJson = mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(loginRequest)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.token", notNullValue()))
                .andReturn().getResponse().getContentAsString();

        @SuppressWarnings("unchecked")
        Map<String, Object> responseMap = objectMapper.readValue(responseJson, Map.class);
        authHeader = "Bearer " + responseMap.get("token").toString();
    }

    @Test
    void shouldCreateAppointmentSuccessfullyAsGuestWithoutAuth() throws Exception {
        Map<String, Object> request = new HashMap<>();
        request.put("customerName", "Guest John");
        request.put("customerEmail", "john.doe@example.com");
        request.put("customerPhone", "555-1234");
        request.put("barberName", "Sara the Stylist");
        request.put("bookingDate", LocalDate.now().plusDays(2).toString());
        request.put("bookingTime", "10:30");
        request.put("serviceType", "Beard Trim & Shave");

        mockMvc.perform(post("/api/v1/appointments")
                        .header("Idempotency-Key", "test-idempotent-key")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id", notNullValue()))
                .andExpect(jsonPath("$.customerName", is("Guest John")))
                .andExpect(jsonPath("$.status", is("PENDING")));

        // Test idempotency: second request with same key should return 201 (or 200) and same ID
        mockMvc.perform(post("/api/v1/appointments")
                        .header("Idempotency-Key", "test-idempotent-key")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.customerName", is("Guest John")));
    }

    @Test
    void shouldReturnBadRequestWhenCustomerNameIsBlank() throws Exception {
        Map<String, Object> request = new HashMap<>();
        request.put("customerName", " ");
        request.put("customerEmail", "invalid-email");
        request.put("customerPhone", "555-1234");
        request.put("barberName", "Sara the Stylist");
        request.put("bookingDate", LocalDate.now().plusDays(2).toString());
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
        Appointment item = new Appointment("Alex", "alex@test.com", "123", "Barber Alex", LocalDate.now(), "10:00", "Haircut");
        item.setStatus("APPROVED");
        appointmentRepository.save(item);

        mockMvc.perform(get("/api/v1/appointments/public/busy-slots")
                        .param("barberName", "Barber Alex")
                        .param("bookingDate", LocalDate.now().toString()))
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
