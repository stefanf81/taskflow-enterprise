package com.example.taskflow.catalog;

import com.example.taskflow.appointment.Appointment;
import com.example.taskflow.appointment.internal.AppointmentRepository;
import com.example.taskflow.auth.AppUser;
import com.example.taskflow.auth.internal.UserRepository;
import com.example.taskflow.catalog.internal.ServiceItemRepository;
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

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.Map;

import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * DATA-6 end to end on H2 with the real V32 schema: unique names (409), retiring a service that
 * appointments reference (204 instead of a 500 from fk_appointment_service), retired services
 * disappearing from the public list / booking lookup, and request-size validation.
 */
@SpringBootTest(properties = {"app.rate-limit.enabled=false", "app.schedulers.enabled=false"})
@AutoConfigureMockMvc
class CatalogRetirementIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private UserRepository userRepository;
    @Autowired private ServiceItemRepository serviceItemRepository;
    @Autowired private AppointmentRepository appointmentRepository;
    @Autowired private CatalogService catalogService;
    @Autowired private PasswordEncoder passwordEncoder;
    @Autowired private JdbcTemplate jdbc;

    private final ObjectMapper objectMapper = new ObjectMapper();
    private String adminToken;

    @BeforeEach
    void setUp() throws Exception {
        // reviews.appointment_id is ON DELETE RESTRICT (V27): clear the seeded reviews first
        jdbc.update("DELETE FROM reviews");
        appointmentRepository.deleteAll();
        serviceItemRepository.deleteAll();
        userRepository.deleteAll();
        userRepository.save(new AppUser("admin@taskflow.com", passwordEncoder.encode("admin-password"),
                "Shop Owner", "555-1234", "ROLE_ADMIN"));
        Map<String, String> login = Map.of("username", "admin@taskflow.com", "password", "admin-password");
        String cookie = mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(login)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getCookie("access_token").getValue();
        adminToken = "Bearer " + cookie;
    }

    private Map<String, Object> body(String name) {
        Map<String, Object> m = new HashMap<>();
        m.put("name", name);
        m.put("price", 25.00);
        m.put("durationMinutes", 30);
        m.put("category", "hair");
        m.put("description", "desc");
        return m;
    }

    private long create(String name) throws Exception {
        String json = mockMvc.perform(post("/api/v1/catalog").header("Authorization", adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body(name))))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return ((Number) objectMapper.readValue(json, Map.class).get("id")).longValue();
    }

    @Test
    void duplicateNamesAreRejectedCaseInsensitivelyOnCreateAndUpdate() throws Exception {
        long first = create("Hot Towel Shave");
        long second = create("Beard Oil Treatment");

        mockMvc.perform(post("/api/v1/catalog").header("Authorization", adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body("hot TOWEL shave"))))
                .andExpect(status().isConflict());

        mockMvc.perform(put("/api/v1/catalog/" + second).header("Authorization", adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body("HOT towel SHAVE"))))
                .andExpect(status().isConflict());

        // renaming a service to its own name (different case) is fine
        mockMvc.perform(put("/api/v1/catalog/" + first).header("Authorization", adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body("HOT TOWEL SHAVE"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name", is("HOT TOWEL SHAVE")));
    }

    @Test
    void databaseItselfRefusesCaseInsensitiveDuplicates() {
        jdbc.update("INSERT INTO services (name, price, duration_minutes, category) VALUES ('Dup Check', 1, 1, 'x')");
        org.junit.jupiter.api.Assertions.assertThrows(org.springframework.dao.DataIntegrityViolationException.class,
                () -> jdbc.update("INSERT INTO services (name, price, duration_minutes, category) VALUES ('DUP CHECK', 1, 1, 'x')"));
    }

    @Test
    void deletingAServiceWithAppointmentsRetiresItAndHidesItFromListAndBooking() throws Exception {
        long id = create("Retire Me");
        ServiceItem item = serviceItemRepository.findById(id).orElseThrow();
        Appointment appointment = new Appointment("Old Customer", "old@x.test", "555", "Alex the Barber",
                LocalDate.of(2031, 5, 5), "10:00", "Retire Me");
        appointment.setService(item);
        appointmentRepository.save(appointment);

        mockMvc.perform(get("/api/v1/catalog")).andExpect(jsonPath("$", hasSize(1)));
        assertTrue(catalogService.findServiceByName("Retire Me").isPresent());

        // previously: 500 from fk_appointment_service
        mockMvc.perform(delete("/api/v1/catalog/" + id).header("Authorization", adminToken))
                .andExpect(status().isNoContent());

        assertTrue(serviceItemRepository.findById(id).isPresent(), "row kept for the appointment history");
        assertEquals(false, serviceItemRepository.findById(id).orElseThrow().isActive());
        mockMvc.perform(get("/api/v1/catalog")).andExpect(status().isOk()).andExpect(jsonPath("$", hasSize(0)));
        mockMvc.perform(get("/api/v1/catalog/" + id)).andExpect(status().isNotFound());
        assertTrue(catalogService.findServiceByName("Retire Me").isEmpty(), "retired services are not bookable");
        assertEquals(1, appointmentRepository.count(), "history untouched");

        // deleting it again is harmless
        mockMvc.perform(delete("/api/v1/catalog/" + id).header("Authorization", adminToken))
                .andExpect(status().isNoContent());

        // the name can be reused: the retired row comes back instead of hitting the unique index
        mockMvc.perform(post("/api/v1/catalog").header("Authorization", adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body("retire me"))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id", is((int) id)))
                .andExpect(jsonPath("$.name", is("retire me")));
        assertTrue(catalogService.findServiceByName("retire me").isPresent());
        mockMvc.perform(get("/api/v1/catalog")).andExpect(jsonPath("$", hasSize(1)));
    }

    @Test
    void deletingAnUnreferencedServiceStillRemovesTheRow() throws Exception {
        long id = create("Never Booked");

        mockMvc.perform(delete("/api/v1/catalog/" + id).header("Authorization", adminToken))
                .andExpect(status().isNoContent());

        assertTrue(serviceItemRepository.findById(id).isEmpty());
        mockMvc.perform(delete("/api/v1/catalog/" + id).header("Authorization", adminToken))
                .andExpect(status().isNotFound());
    }

    @Test
    void oversizedAndMalformedInputIsRejectedWith400() throws Exception {
        Map<String, Object> longName = body("x".repeat(101));
        Map<String, Object> longCategory = body("Ok Name");
        longCategory.put("category", "c".repeat(51));
        Map<String, Object> longDescription = body("Ok Name");
        longDescription.put("description", "d".repeat(501));
        Map<String, Object> tooManyDigits = body("Ok Name");
        tooManyDigits.put("price", new BigDecimal("123456789.00"));
        Map<String, Object> tooManyDecimals = body("Ok Name");
        tooManyDecimals.put("price", new BigDecimal("1.234"));
        Map<String, Object> zeroDuration = body("Ok Name");
        zeroDuration.put("durationMinutes", 0);

        for (Map<String, Object> invalid : java.util.List.of(longName, longCategory, longDescription, tooManyDigits,
                tooManyDecimals, zeroDuration)) {
            mockMvc.perform(post("/api/v1/catalog").header("Authorization", adminToken)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(invalid)))
                    .andExpect(status().isBadRequest());
        }

        Map<String, Object> boundary = body("n".repeat(100));
        boundary.put("category", "c".repeat(50));
        boundary.put("description", "d".repeat(500));
        boundary.put("price", new BigDecimal("12345678.99"));
        mockMvc.perform(post("/api/v1/catalog").header("Authorization", adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(boundary)))
                .andExpect(status().isCreated());
    }
}
