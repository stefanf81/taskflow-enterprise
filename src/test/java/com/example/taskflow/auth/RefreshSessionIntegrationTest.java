package com.example.taskflow.auth;

import com.example.taskflow.auth.internal.UserRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Grace 0 over HTTP: an immediate replay counts as reuse. The grace window is tested on the service. */
@SpringBootTest(properties = {"app.rate-limit.enabled=false", "app.auth.refresh.reuse-grace-seconds=0"})
@AutoConfigureMockMvc
class RefreshSessionIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private UserRepository userRepository;
    @Autowired private PasswordEncoder passwordEncoder;
    @Autowired private JdbcTemplate jdbc;

    private final ObjectMapper objectMapper = new ObjectMapper();

    /** A clock the tests move; the service reads it for expiry, grace and cache age. */
    private static final class MutableClock extends Clock {
        private Instant now = Instant.parse("2026-11-06T10:00:00Z");

        void advance(Duration duration) {
            now = now.plus(duration);
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }

    private static final Authentication CUSTOMER = UsernamePasswordAuthenticationToken.authenticated(
            "customer@taskflow.com", null, List.of(new SimpleGrantedAuthority("ROLE_CUSTOMER")));

    private static Jwt tokenOf(RefreshSessionService.Issued session) {
        return Jwt.withTokenValue("t").header("alg", "RS256").subject(session.username())
                .claim(RefreshSessionService.SESSION_CLAIM, session.id()).build();
    }

    @Test
    void aReplayWithinTheGraceWindowGetsAnotherCredentialAndKeepsTheFamily() {
        MutableClock clock = new MutableClock();
        RefreshSessionService service = new RefreshSessionService(jdbc, new RefreshProperties(3600, 3600, 30), clock);
        RefreshSessionService.Issued login = service.create(CUSTOMER);

        RefreshSessionService.Issued first = service.rotate(login.refreshToken()).orElseThrow();
        clock.advance(Duration.ofSeconds(20));
        // A second tab (or a retry after a lost response) presents the just-used credential.
        RefreshSessionService.Issued concurrent = service.rotate(login.refreshToken()).orElseThrow();

        assertNotEquals(first.refreshToken(), concurrent.refreshToken());
        assertEquals(login.expiresAt(), concurrent.expiresAt(), "the family deadline never moves");
        assertTrue(service.rotate(first.refreshToken()).isPresent());
        assertTrue(service.rotate(concurrent.refreshToken()).isPresent());
        assertFalse(service.validate(tokenOf(login)).hasErrors());
    }

    @Test
    void aReplayAfterTheGraceWindowRevokesTheWholeFamily() {
        MutableClock clock = new MutableClock();
        RefreshSessionService service = new RefreshSessionService(jdbc, new RefreshProperties(3600, 3600, 30), clock);
        RefreshSessionService.Issued login = service.create(CUSTOMER);
        RefreshSessionService.Issued next = service.rotate(login.refreshToken()).orElseThrow();

        clock.advance(Duration.ofSeconds(31));
        assertTrue(service.rotate(login.refreshToken()).isEmpty());

        assertTrue(service.rotate(next.refreshToken()).isEmpty(), "the successor dies with the family");
        assertTrue(service.validate(tokenOf(login)).hasErrors(), "so do the family's access tokens");
    }

    @Test
    void purgeDeletesRevokedAndExpiredFamiliesWithTheirCredentials() {
        MutableClock clock = new MutableClock();
        RefreshSessionService service = new RefreshSessionService(jdbc, new RefreshProperties(3600, 3600, 30), clock);
        RefreshSessionService.Issued kept = service.create(CUSTOMER);
        RefreshSessionService.Issued loggedOut = service.create(CUSTOMER);
        service.revokeSession(loggedOut.id());

        assertEquals(1, service.purgeInactive());
        assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM refresh_sessions", Integer.class));
        assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM refresh_credentials", Integer.class));

        clock.advance(Duration.ofSeconds(3601));
        assertEquals(1, service.purgeInactive());
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM refresh_credentials", Integer.class));
        assertTrue(service.validate(tokenOf(kept)).hasErrors(), "a purged family authenticates nothing");
    }

    @Test
    void theSessionCheckIsCachedAndFailsOpenWhenTheDatabaseCannotBeRead() {
        MutableClock clock = new MutableClock();
        RefreshSessionService real = new RefreshSessionService(jdbc, new RefreshProperties(3600, 3600, 30), clock);
        RefreshSessionService.Issued login = real.create(CUSTOMER);

        JdbcTemplate failing = mock(JdbcTemplate.class, invocation -> {
            throw new DataAccessResourceFailureException("database down");
        });
        RefreshSessionService unreachable = new RefreshSessionService(failing, new RefreshProperties(3600, 3600, 30), clock);

        // No cached state: accept rather than sign everybody out during an outage (ADR-018).
        assertFalse(unreachable.validate(tokenOf(login)).hasErrors());
        // The real service caches its read for a short while.
        assertFalse(real.validate(tokenOf(login)).hasErrors());
        jdbc.update("UPDATE refresh_sessions SET revoked = TRUE WHERE id = ?", login.id());
        assertFalse(real.validate(tokenOf(login)).hasErrors(), "a direct DB change applies after the cache TTL");
        clock.advance(RefreshSessionService.CACHE_TTL.plusSeconds(1));
        assertTrue(real.validate(tokenOf(login)).hasErrors());
        assertEquals(Optional.empty(), real.rotate(login.refreshToken()));
    }

    @BeforeEach
    void setUp() {
        jdbc.update("DELETE FROM refresh_credentials");
        jdbc.update("DELETE FROM refresh_sessions");
        userRepository.deleteAll();
        userRepository.save(new AppUser("customer@taskflow.com", passwordEncoder.encode("Pass1234"),
                "Customer", "555-0101", "ROLE_CUSTOMER"));
    }

    @Test
    void mobileRefreshRotatesOneTimeCredentialAndReuseRevokesTheEntireSessionFamily() throws Exception {
        String loginJson = mockMvc.perform(post("/api/v1/auth/mobile/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                Map.of("username", "customer@taskflow.com", "password", "Pass1234"))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        JsonNode initial = objectMapper.readTree(loginJson);
        String firstAccess = initial.get("accessToken").asText();
        String firstRefresh = initial.get("refreshToken").asText();
        assertNotNull(firstRefresh);

        // Rotate once: returns a new access token and a new refresh token.
        String rotatedJson = mockMvc.perform(post("/api/v1/auth/mobile/refresh")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("refreshToken", firstRefresh))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.username").value("customer@taskflow.com"))
                .andReturn().getResponse().getContentAsString();
        JsonNode rotated = objectMapper.readTree(rotatedJson);
        String secondAccess = rotated.get("accessToken").asText();
        String secondRefresh = rotated.get("refreshToken").asText();
        assertNotEquals(firstRefresh, secondRefresh);

        mockMvc.perform(get("/api/v1/auth/me").header("Authorization", "Bearer " + secondAccess))
                .andExpect(status().isOk());

        // Replaying the already-used first refresh token is detected as theft/reuse and revokes the family!
        mockMvc.perform(post("/api/v1/auth/mobile/refresh")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("refreshToken", firstRefresh))))
                .andExpect(status().isUnauthorized());

        // Both the second refresh token AND the active access token of that family are now dead.
        mockMvc.perform(post("/api/v1/auth/mobile/refresh")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("refreshToken", secondRefresh))))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/v1/auth/me").header("Authorization", "Bearer " + secondAccess))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/v1/auth/me").header("Authorization", "Bearer " + firstAccess))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void webCookieRefreshRequiresCsrfAndRotatesCookies() throws Exception {
        var loginRes = mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                Map.of("username", "customer@taskflow.com", "password", "Pass1234"))))
                .andExpect(status().isOk())
                .andReturn().getResponse();
        Cookie refreshCookie = loginRes.getCookie("refresh_token");
        assertNotNull(refreshCookie);
        // The SPA cannot read the credential; the hint tells it (and nginx) that it can renew.
        Cookie hint = loginRes.getCookie("taskflow_session");
        assertNotNull(hint);
        assertFalse(hint.isHttpOnly());
        assertEquals("1", hint.getValue());

        // Without CSRF token, browser refresh is forbidden (403).
        mockMvc.perform(post("/api/v1/auth/refresh").cookie(refreshCookie))
                .andExpect(status().isForbidden());

        // Obtain the real double-submit XSRF-TOKEN cookie + header (never .with(csrf()), which
        // replaces the shared CsrfFilter's CookieCsrfTokenRepository in the cached Spring context).
        var csrfRes = mockMvc.perform(get("/api/v1/auth/csrf")).andExpect(status().isOk()).andReturn().getResponse();
        Cookie xsrfCookie = csrfRes.getCookie("XSRF-TOKEN");
        String xsrfHeader = objectMapper.readTree(csrfRes.getContentAsString()).get("token").asText();

        // With CSRF token, browser refresh rotates both cookies.
        var refreshRes = mockMvc.perform(post("/api/v1/auth/refresh")
                        .cookie(refreshCookie, xsrfCookie)
                        .header("X-XSRF-TOKEN", xsrfHeader))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.username").value("customer@taskflow.com"))
                .andReturn().getResponse();
        Cookie newAccess = refreshRes.getCookie("access_token");
        Cookie newRefresh = refreshRes.getCookie("refresh_token");
        assertNotNull(newAccess);
        assertNotNull(newRefresh);
        assertNotEquals(refreshCookie.getValue(), newRefresh.getValue());
        assertNotNull(refreshRes.getCookie("taskflow_session"));

        // Replaying the used cookie (grace 0 here) is reuse: 401, and the 401 drops the cookies so
        // the SPA stops trying to renew a dead session.
        var rejected = mockMvc.perform(post("/api/v1/auth/refresh")
                        .cookie(refreshCookie, xsrfCookie)
                        .header("X-XSRF-TOKEN", xsrfHeader))
                .andExpect(status().isUnauthorized())
                .andReturn().getResponse();
        assertTrue(rejected.getHeaders("Set-Cookie").stream()
                .anyMatch(value -> value.startsWith("taskflow_session=;") && value.contains("Max-Age=0")));
        assertTrue(rejected.getHeaders("Set-Cookie").stream()
                .anyMatch(value -> value.startsWith("refresh_token=;") && value.contains("Max-Age=0")));
    }
}
