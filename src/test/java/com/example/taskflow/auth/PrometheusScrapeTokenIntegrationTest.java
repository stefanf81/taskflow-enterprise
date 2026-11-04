package com.example.taskflow.auth;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import static org.hamcrest.Matchers.containsString;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.head;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * https://github.com/stefanf81/taskflow-enterprise/issues/223: with {@code app.metrics.scrape-token}
 * set, {@code /actuator/prometheus} answers only the scraper that sends it. (Without the token the
 * endpoint stays open, which {@code AuthCookieTest} and {@code SecurityAuthorizationIntegrationTest}
 * cover.)
 */
@SpringBootTest(properties = {"app.rate-limit.enabled=false", "app.metrics.scrape-token=scrape-secret-0123"})
@AutoConfigureMockMvc
class PrometheusScrapeTokenIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void theScraperWithTheTokenGetsTheMetrics() throws Exception {
        mockMvc.perform(get("/actuator/prometheus").header("Authorization", "Bearer scrape-secret-0123"))
                .andExpect(status().isOk())
                .andExpect(content().string(containsString("jvm_memory_used_bytes")));
        // The scheme is case-insensitive (RFC 9110).
        mockMvc.perform(get("/actuator/prometheus").header("Authorization", "bearer scrape-secret-0123"))
                .andExpect(status().isOk());
    }

    @Test
    void everyoneElseIsRefused() throws Exception {
        mockMvc.perform(get("/actuator/prometheus"))
                .andExpect(status().isUnauthorized())
                .andExpect(header().exists("WWW-Authenticate"));
        mockMvc.perform(get("/actuator/prometheus").header("Authorization", "Bearer wrong"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/actuator/prometheus").header("Authorization", "Bearer "))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/actuator/prometheus").header("Authorization", "Basic c2NyYXBlLXNlY3JldC0wMTIz"))
                .andExpect(status().isUnauthorized());
        // The token is a prefix match away from a near miss; only the exact value passes.
        mockMvc.perform(get("/actuator/prometheus").header("Authorization", "Bearer scrape-secret-01234"))
                .andExpect(status().isUnauthorized());
        // Being the admin is not a substitute: the scraper credential is the only way in (authenticated
        // but not allowed, hence 403).
        mockMvc.perform(get("/actuator/prometheus").with(user("admin").roles("ADMIN")))
                .andExpect(status().isForbidden());
    }

    @Test
    void theTokenOpensNothingElse() throws Exception {
        mockMvc.perform(get("/actuator/info").header("Authorization", "Bearer scrape-secret-0123"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(head("/actuator/prometheus").header("Authorization", "Bearer scrape-secret-0123"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/v1/appointments").header("Authorization", "Bearer scrape-secret-0123"))
                .andExpect(status().isUnauthorized());
        // The public API is untouched.
        mockMvc.perform(get("/api/v1/catalog")).andExpect(status().isOk());
    }
}
