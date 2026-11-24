package com.example.taskflow.catalog;

import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.example.taskflow.auth.AppUser;
import com.example.taskflow.auth.internal.UserRepository;
import com.example.taskflow.catalog.internal.ShopAnnouncement;
import com.example.taskflow.catalog.internal.ShopAnnouncementRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.cache.CacheManager;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;

/**
 * The landing pages' promo strip (V45) end to end: guests read it from the shop info, the owner
 * sets or clears it, the shop info follows at once (cache invalidated after commit), and a message
 * longer than the room the web page reserves is a 400.
 */
@SpringBootTest(properties = {"app.rate-limit.enabled=false", "app.schedulers.enabled=false"})
@AutoConfigureMockMvc
class ShopAnnouncementIntegrationTest {

    private static final String SEEDED =
            "Special Highlight: Book 'The Executive Package' today and get 15% off any premium hair styling clay!";
    private static final String SHOP = "/api/v1/appointments/public/shop";
    private static final String ANNOUNCEMENT = "/api/v1/catalog/announcement";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private ShopAnnouncementRepository repository;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Autowired
    private CacheManager cacheManager;

    private final ObjectMapper objectMapper = new ObjectMapper();
    private String adminToken;

    @BeforeEach
    void setUp() throws Exception {
        restoreSeed();
        userRepository.findByEmailIgnoreCase("promo-admin@taskflow.com").ifPresent(userRepository::delete);
        userRepository.save(new AppUser(
                "promo-admin@taskflow.com",
                passwordEncoder.encode("admin-password"),
                "Shop Owner",
                "555-1234",
                "ROLE_ADMIN"));
        String cookie = mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                Map.of("username", "promo-admin@taskflow.com", "password", "admin-password"))))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getCookie("access_token")
                .getValue();
        adminToken = "Bearer " + cookie;
    }

    /** Other test classes share the H2 database: leave the V45 seed as it was. */
    @AfterEach
    void restoreSeed() {
        repository.save(new ShopAnnouncement(SEEDED));
        cacheManager.getCache(CatalogCacheConfig.ANNOUNCEMENT_CACHE).clear();
    }

    private String body(String message) throws Exception {
        Map<String, Object> m = new HashMap<>();
        m.put("message", message);
        return objectMapper.writeValueAsString(m);
    }

    @Test
    void guestsReadTheSeededStripFromTheShopInfo() throws Exception {
        mockMvc.perform(get(SHOP))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.announcement").value(SEEDED));
    }

    @Test
    void theOwnersEditShowsUpInTheShopInfoAtOnce() throws Exception {
        mockMvc.perform(get(SHOP)).andExpect(jsonPath("$.announcement").value(SEEDED)); // cached now

        mockMvc.perform(put(ANNOUNCEMENT)
                        .header("Authorization", adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body("  Half-price beard trims on Tuesdays  ")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.active").value(true))
                .andExpect(jsonPath("$.message").value("Half-price beard trims on Tuesdays"));
        mockMvc.perform(get(SHOP)).andExpect(jsonPath("$.announcement").value("Half-price beard trims on Tuesdays"));
    }

    @Test
    void aBlankOrMissingMessageTurnsTheStripOff() throws Exception {
        mockMvc.perform(put(ANNOUNCEMENT)
                        .header("Authorization", adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body("   ")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.active").value(false))
                .andExpect(jsonPath("$.message").doesNotExist());
        mockMvc.perform(get(SHOP))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.announcement").doesNotExist())
                .andExpect(jsonPath("$.timeZone").exists());

        mockMvc.perform(put(ANNOUNCEMENT)
                        .header("Authorization", adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isOk());
        mockMvc.perform(get(SHOP)).andExpect(jsonPath("$.announcement").doesNotExist());
    }

    @Test
    void rejectsMoreThanTheReservedRoom() throws Exception {
        mockMvc.perform(put(ANNOUNCEMENT)
                        .header("Authorization", adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body("x".repeat(121))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.validationErrors[0].field").value("message"))
                .andExpect(jsonPath("$.validationErrors[0].message", containsString("120")));
        mockMvc.perform(get(SHOP)).andExpect(jsonPath("$.announcement").value(SEEDED));
    }
}
