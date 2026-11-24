package com.example.taskflow.catalog;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.example.taskflow.auth.AppUser;
import com.example.taskflow.auth.internal.UserRepository;
import com.example.taskflow.catalog.internal.RetailProductRepository;
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
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Retail products (V44) end to end on H2: the seeded list in the shop's order, admin create /
 * update / delete, the public list following every write (the cache is invalidated after commit),
 * unique names (409) and request validation (400).
 */
@SpringBootTest(properties = {"app.rate-limit.enabled=false", "app.schedulers.enabled=false"})
@AutoConfigureMockMvc
class RetailProductIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private RetailProductRepository productRepository;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private CacheManager cacheManager;

    private final ObjectMapper objectMapper = new ObjectMapper();
    private String adminToken;

    @BeforeEach
    void setUp() throws Exception {
        restoreSeed();
        userRepository.findByEmailIgnoreCase("products-admin@taskflow.com").ifPresent(userRepository::delete);
        userRepository.save(new AppUser(
                "products-admin@taskflow.com",
                passwordEncoder.encode("admin-password"),
                "Shop Owner",
                "555-1234",
                "ROLE_ADMIN"));
        Map<String, String> login = Map.of("username", "products-admin@taskflow.com", "password", "admin-password");
        String cookie = mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(login)))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getCookie("access_token")
                .getValue();
        adminToken = "Bearer " + cookie;
    }

    /** Other test classes share the H2 database: leave the V44 seed as it was. */
    @AfterEach
    void restoreSeed() {
        productRepository.deleteAll();
        jdbc.update("""
                INSERT INTO retail_products (name, size_label, price, sort_order) VALUES
                ('Styling Fiber Clay', '100ml', 24.00, 1),
                ('Sandalwood Beard Balm', '60ml', 19.00, 2),
                ('Straight Razor Shave Cream', '150ml', 22.00, 3)
                """);
        // Rows written straight to the table do not evict the cached list.
        cacheManager.getCache(CatalogCacheConfig.PRODUCTS_CACHE).clear();
    }

    private static Map<String, Object> product(String name, Object price, Integer sortOrder) {
        Map<String, Object> m = new HashMap<>();
        m.put("name", name);
        m.put("sizeLabel", "50ml");
        m.put("price", price);
        m.put("sortOrder", sortOrder);
        return m;
    }

    @Test
    void listsTheSeededProductsPubliclyInTheShopsOrder() throws Exception {
        mockMvc.perform(get("/api/v1/catalog/products"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-cache, public"))
                .andExpect(jsonPath("$", hasSize(3)))
                .andExpect(jsonPath("$[0].name").value("Styling Fiber Clay"))
                .andExpect(jsonPath("$[0].price").value(24.00))
                .andExpect(jsonPath("$[1].name").value("Sandalwood Beard Balm"))
                .andExpect(jsonPath("$[1].sizeLabel").value("60ml"))
                .andExpect(jsonPath("$[2].name").value("Straight Razor Shave Cream"));
    }

    @Test
    void adminWritesShowUpInThePublicListRightAway() throws Exception {
        mockMvc.perform(get("/api/v1/catalog/products")).andExpect(status().isOk()); // warm the cache

        String created = mockMvc.perform(post("/api/v1/catalog/products")
                        .header("Authorization", adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(product("  Matte Paste  ", 18.50, 0))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.name").value("Matte Paste"))
                .andReturn()
                .getResponse()
                .getContentAsString();
        long id = objectMapper.readTree(created).get("id").asLong();

        mockMvc.perform(get("/api/v1/catalog/products"))
                .andExpect(jsonPath("$", hasSize(4)))
                .andExpect(jsonPath("$[0].name").value("Matte Paste"));

        Map<String, Object> update = product("Matte Paste", 20.00, 9);
        update.put("sizeLabel", " ");
        mockMvc.perform(put("/api/v1/catalog/products/" + id)
                        .header("Authorization", adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(update)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sizeLabel").doesNotExist());
        mockMvc.perform(get("/api/v1/catalog/products"))
                .andExpect(jsonPath("$[3].name").value("Matte Paste"))
                .andExpect(jsonPath("$[3].price").value(20.00));

        mockMvc.perform(delete("/api/v1/catalog/products/" + id).header("Authorization", adminToken))
                .andExpect(status().isNoContent());
        mockMvc.perform(get("/api/v1/catalog/products")).andExpect(jsonPath("$", hasSize(3)));
        mockMvc.perform(delete("/api/v1/catalog/products/" + id).header("Authorization", adminToken))
                .andExpect(status().isNotFound());
    }

    @Test
    void rejectsDuplicateNamesAndInvalidInput() throws Exception {
        mockMvc.perform(post("/api/v1/catalog/products")
                        .header("Authorization", adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(product("sandalwood beard balm", 10, 1))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message", containsString("already exists")));

        mockMvc.perform(post("/api/v1/catalog/products")
                        .header("Authorization", adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(product("", -1, -1))))
                .andExpect(status().isBadRequest());

        Map<String, Object> longSize = product("Big Tub", 10, 1);
        longSize.put("sizeLabel", "x".repeat(31));
        mockMvc.perform(post("/api/v1/catalog/products")
                        .header("Authorization", adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(longSize)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.validationErrors[0].field").value("sizeLabel"))
                .andExpect(jsonPath("$.validationErrors[0].message", containsString("Size")));

        mockMvc.perform(put("/api/v1/catalog/products/999999")
                        .header("Authorization", adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(product("Ghost", 10, 1))))
                .andExpect(status().isNotFound());
    }
}
