package com.example.taskflow.auth;

import com.example.taskflow.auth.internal.UserRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;

import java.util.HashMap;
import java.util.Map;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * HTTP-boundary authorization matrix against the real {@code SecurityFilterChain}
 * and real JWT decoding.
 *
 * <p>Deliberately does not import {@link TestSecurityConfig}: its {@code @Primary}
 * in-memory user store contains only an admin, so CUSTOMER role tests would not
 * work. Users are seeded through the real repository instead.
 *
 * <p>Filter-chain 403 responses carry no JSON body (they are produced by the
 * access-denied handler before the controller), so only status codes are asserted.
 */
@SpringBootTest(properties = {"app.rate-limit.enabled=false"})
@AutoConfigureMockMvc
class SecurityAuthorizationIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private PasswordEncoder passwordEncoder;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private String adminToken;
    private String customerToken;

    @BeforeEach
    void setUp() throws Exception {
        userRepository.deleteAll();

        userRepository.save(new AppUser("admin@taskflow.com", passwordEncoder.encode("admin-password"),
                "Shop Owner", "555-0001", "ROLE_ADMIN"));
        userRepository.save(new AppUser("customer@taskflow.com", passwordEncoder.encode("customer-password"),
                "Jane Customer", "555-0002", "ROLE_CUSTOMER"));

        adminToken = "Bearer " + login("admin@taskflow.com", "admin-password");
        customerToken = "Bearer " + login("customer@taskflow.com", "customer-password");
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

    // ------------------------------------------------------------------
    // Anonymous → 401
    // ------------------------------------------------------------------

    @Test
    void anonymous_shouldBeUnauthorizedOnProtectedEndpoints() throws Exception {
        mockMvc.perform(get("/api/v1/appointments")).andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/v1/appointments/events")).andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/v1/barbers/admin")).andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/v1/notifications")).andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/v1/customer/appointments")).andExpect(status().isUnauthorized());
        mockMvc.perform(get("/actuator/info")).andExpect(status().isUnauthorized());
    }

    @Test
    void anonymousStateChanging_withValidCsrf_shouldStillBeUnauthorized() throws Exception {
        // CSRF is satisfied so the assertion isolates authorization, not CSRF.
        mockMvc.perform(post("/api/v1/barbers")
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Ghost\",\"email\":\"ghost@taskflow.com\",\"phone\":\"555-0009\"}"))
                .andExpect(status().isUnauthorized());
    }

    // ------------------------------------------------------------------
    // CUSTOMER → 403 on admin endpoints
    // ------------------------------------------------------------------

    @Test
    void customer_shouldBeForbiddenOnAdminAppointmentEndpoints() throws Exception {
        mockMvc.perform(get("/api/v1/appointments").header("Authorization", customerToken))
                .andExpect(status().isForbidden());
        mockMvc.perform(get("/api/v1/appointments/1").header("Authorization", customerToken))
                .andExpect(status().isForbidden());
        mockMvc.perform(put("/api/v1/appointments/1")
                        .header("Authorization", customerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"APPROVED\"}"))
                .andExpect(status().isForbidden());
        mockMvc.perform(delete("/api/v1/appointments/1").header("Authorization", customerToken))
                .andExpect(status().isForbidden());
    }

    @Test
    void customer_shouldBeForbiddenOnAdminBarberAndCatalogEndpoints() throws Exception {
        mockMvc.perform(get("/api/v1/barbers/admin").header("Authorization", customerToken))
                .andExpect(status().isForbidden());
        mockMvc.perform(get("/api/v1/barbers/1/time-off").header("Authorization", customerToken))
                .andExpect(status().isForbidden());
        mockMvc.perform(post("/api/v1/barbers")
                        .header("Authorization", customerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Ghost\",\"email\":\"ghost@taskflow.com\",\"phone\":\"555-0009\"}"))
                .andExpect(status().isForbidden());
        mockMvc.perform(post("/api/v1/catalog")
                        .header("Authorization", customerToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Ghost Cut\",\"price\":10.0,\"durationMinutes\":15,\"category\":\"hair\"}"))
                .andExpect(status().isForbidden());
        mockMvc.perform(delete("/api/v1/catalog/1").header("Authorization", customerToken))
                .andExpect(status().isForbidden());
    }

    @Test
    void customer_shouldBeForbiddenOnNotificationAndSwaggerEndpoints() throws Exception {
        mockMvc.perform(get("/api/v1/notifications").header("Authorization", customerToken))
                .andExpect(status().isForbidden());
        mockMvc.perform(get("/swagger-ui/index.html").header("Authorization", customerToken))
                .andExpect(status().isForbidden());
    }

    // ------------------------------------------------------------------
    // ADMIN controls
    // ------------------------------------------------------------------

    @Test
    void admin_shouldAccessAdminEndpoints() throws Exception {
        mockMvc.perform(get("/api/v1/barbers/admin").header("Authorization", adminToken))
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/notifications").header("Authorization", adminToken))
                .andExpect(status().isOk());
    }

    // ------------------------------------------------------------------
    // Public endpoints remain public
    // ------------------------------------------------------------------

    @Test
    void publicEndpoints_shouldRemainAccessible() throws Exception {
        mockMvc.perform(get("/api/v1/barbers")).andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/catalog")).andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/appointments/public/busy-slots")
                        .param("barberName", "Alex the Barber")
                        .param("bookingDate", "2030-05-16"))
                .andExpect(status().isOk());
        mockMvc.perform(get("/actuator/prometheus")).andExpect(status().isOk());
    }

    @Test
    void customer_shouldAccessCustomerEndpoints() throws Exception {
        mockMvc.perform(get("/api/v1/customer/appointments").header("Authorization", customerToken))
                .andExpect(status().isOk());
    }
}
