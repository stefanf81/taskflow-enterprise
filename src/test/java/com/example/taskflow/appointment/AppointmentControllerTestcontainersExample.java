package com.example.taskflow.appointment;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.time.LocalDate;
import java.util.HashMap;
import java.util.Map;

import static org.hamcrest.Matchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * STATE-OF-THE-ART (SOTA) INTEGRATION TEST EXAMPLE USING TESTCONTAINERS (BARBER BOOKING DOMAIN)
 * 
 * Why this is used:
 * In enterprise-grade applications, using an in-memory database like H2 for testing can lead to false
 * positives or negatives because H2 differs SQL-dialect and index-wise from PostgreSQL.
 * Testcontainers spins up a real, lightweight Docker container of PostgreSQL during the test execution,
 * ensuring that your tests run against the exact same engine used in production.
 * 
 * Note: This file is named "...Example.java" instead of "Test.java" so it is excluded from default 
 * offline Gradle test runs, preventing connection failures when the local Docker socket is unreachable.
 */
@SpringBootTest(properties = "app.rate-limit.enabled=false")
@AutoConfigureMockMvc
@Testcontainers
@org.junit.jupiter.api.Disabled("Disabled locally to prevent build failures when the Docker socket is disconnected.")
public class AppointmentControllerTestcontainersExample {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private AppointmentRepository appointmentRepository;

    private ObjectMapper objectMapper = new ObjectMapper();

    private String authHeader;

    // Define the PostgreSQL container matching our exact production version 17
    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:17-alpine")
            .withDatabaseName("taskflow_test")
            .withUsername("postgres")
            .withPassword("postgres-password");

    // Dynamically override properties to point Spring Data JPA to the active Testcontainer
    @DynamicPropertySource
    static void configureProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
        registry.add("spring.datasource.driverClassName", () -> "org.postgresql.Driver");
        registry.add("spring.jpa.database-platform", () -> "org.hibernate.dialect.PostgreSQLDialect");
        registry.add("spring.flyway.enabled", () -> "true");
    }

    @BeforeEach
    void setUp() throws Exception {
        appointmentRepository.deleteAll();

        // Perform login to retrieve secure JWT token
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
    void shouldCreateAppointmentInRealPostgresContainer() throws Exception {
        Map<String, Object> request = new HashMap<>();
        request.put("customerName", "Guest John");
        request.put("customerEmail", "john.doe@example.com");
        request.put("customerPhone", "555-1234");
        request.put("barberName", "Sara the Stylist");
        request.put("bookingDate", LocalDate.now().plusDays(2).toString());
        request.put("bookingTime", "10:30");
        request.put("serviceType", "Beard Trim & Shave");

        mockMvc.perform(post("/api/v1/appointments")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id", notNullValue()))
                .andExpect(jsonPath("$.customerName", is("Guest John")))
                .andExpect(jsonPath("$.status", is("PENDING")));
    }
}
