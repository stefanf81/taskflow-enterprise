package com.example.taskflow.features;

import com.example.taskflow.appointment.Appointment;
import com.example.taskflow.appointment.AppointmentRepository;
import com.example.taskflow.appointment.Barber;
import com.example.taskflow.appointment.BarberRepository;
import com.example.taskflow.appointment.BarberSchedule;
import com.example.taskflow.appointment.BarberScheduleRepository;
import com.example.taskflow.appointment.BarberTimeOff;
import com.example.taskflow.appointment.BarberTimeOffRepository;
import com.example.taskflow.auth.AppUser;
import com.example.taskflow.auth.UserRepository;
import com.example.taskflow.catalog.ServiceItem;
import com.example.taskflow.catalog.ServiceItemRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.HashMap;
import java.util.Map;

import static org.hamcrest.Matchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {"app.rate-limit.enabled=false", "app.stats.cache.ttl=0"})
@AutoConfigureMockMvc
public class FeaturesIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private ServiceItemRepository serviceItemRepository;

    @Autowired
    private BarberRepository barberRepository;

    @Autowired
    private BarberScheduleRepository barberScheduleRepository;

    @Autowired
    private BarberTimeOffRepository barberTimeOffRepository;

    @Autowired
    private AppointmentRepository appointmentRepository;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Autowired
    private ObjectMapper objectMapper;

    private String adminToken;

    @BeforeEach
    void setUp() throws Exception {
        appointmentRepository.deleteAll();
        serviceItemRepository.deleteAll();
        barberTimeOffRepository.deleteAll();
        barberScheduleRepository.deleteAll();
        barberRepository.deleteAll();
        userRepository.deleteAll();

        // 1. Create default admin user
        AppUser admin = new AppUser("admin@taskflow.com", passwordEncoder.encode("admin-password"), "Shop Owner", "555-1234", "ROLE_ADMIN");
        userRepository.save(admin);

        // 2. Perform admin login
        Map<String, String> loginRequest = new HashMap<>();
        loginRequest.put("username", "admin@taskflow.com");
        loginRequest.put("password", "admin-password");

        String responseJson = mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(loginRequest)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        @SuppressWarnings("unchecked")
        Map<String, Object> responseMap = objectMapper.readValue(responseJson, Map.class);
        adminToken = "Bearer " + responseMap.get("token").toString();
    }

    @Test
    void executeFullSuiteFeaturesFlow() throws Exception {
        // --- FEATURE 1: Dynamic Service Catalog ---
        // Create a new Service as Admin
        Map<String, Object> serviceRequest = new HashMap<>();
        serviceRequest.put("name", "Luxury Beard Sculpture");
        serviceRequest.put("price", 35.00);
        serviceRequest.put("durationMinutes", 45);
        serviceRequest.put("category", "beard");
        serviceRequest.put("description", "Premium beard lining and hot towel massage.");

        mockMvc.perform(post("/api/v1/catalog")
                        .header("Authorization", adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(serviceRequest)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id", notNullValue()))
                .andExpect(jsonPath("$.name", is("Luxury Beard Sculpture")))
                .andExpect(jsonPath("$.price", is(35.00)));

        // Get Catalog Publicly
        mockMvc.perform(get("/api/v1/catalog"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].name", is("Luxury Beard Sculpture")));

        // --- FEATURE 5: Customer Registration & Accounts ---
        // Register Customer
        Map<String, Object> registerRequest = new HashMap<>();
        registerRequest.put("fullName", "Jane Customer");
        registerRequest.put("email", "jane@example.com");
        registerRequest.put("password", "customer-pass-888");
        registerRequest.put("phone", "555-4321");

        mockMvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(registerRequest)))
                .andExpect(status().isCreated());

        // Login Customer
        Map<String, String> customerLogin = new HashMap<>();
        customerLogin.put("username", "jane@example.com");
        customerLogin.put("password", "customer-pass-888");

        String customerResponse = mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(customerLogin)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.role", is("ROLE_CUSTOMER")))
                .andReturn().getResponse().getContentAsString();

        @SuppressWarnings("unchecked")
        Map<String, Object> customerMap = objectMapper.readValue(customerResponse, Map.class);
        String customerToken = "Bearer " + customerMap.get("token").toString();

        // --- FEATURE 2: Barber Schedule & Time-Off Management ---
        // Create Barber
        Barber barber = new Barber("James the Stylist", "james@taskflow.com", "555-0987");
        barber = barberRepository.save(barber);

        // Seed working schedule for James the Stylist for Thursday (Day 4)
        BarberSchedule schedule = new BarberSchedule();
        schedule.setBarber(barber);
        schedule.setDayOfWeek(4); // Thursday
        schedule.setStartTime(LocalTime.of(9, 0));
        schedule.setEndTime(LocalTime.of(17, 0));
        barberScheduleRepository.save(schedule);

        // Verify busy slots returns empty list for new date
        mockMvc.perform(get("/api/v1/appointments/public/busy-slots")
                        .param("barberName", "James the Stylist")
                        .param("bookingDate", "2030-05-16")) // 2030-05-16 is a Thursday
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(0)));

        // Create Appointment as Guest
        Map<String, Object> apptRequest = new HashMap<>();
        apptRequest.put("customerName", "Jane Customer");
        apptRequest.put("customerEmail", "jane@example.com");
        apptRequest.put("customerPhone", "555-4321");
        apptRequest.put("barberName", "James the Stylist");
        apptRequest.put("bookingDate", "2030-05-16");
        apptRequest.put("bookingTime", "10:00");
        apptRequest.put("serviceType", "Luxury Beard Sculpture");

        String apptJson = mockMvc.perform(post("/api/v1/appointments")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(apptRequest)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();

        @SuppressWarnings("unchecked")
        Map<String, Object> apptMap = objectMapper.readValue(apptJson, Map.class);
        String publicId = apptMap.get("publicId").toString();

        // --- FEATURE 4: Client Reviews & Ratings Engine ---
        // Ensure reviews fail if appointment is still PENDING
        Map<String, Object> reviewRequest = new HashMap<>();
        reviewRequest.put("rating", 5);
        reviewRequest.put("comment", "Absolutely amazing cut!");

        mockMvc.perform(post("/api/v1/reviews/public/" + publicId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(reviewRequest)))
                .andExpect(status().isBadRequest());
    }
}
