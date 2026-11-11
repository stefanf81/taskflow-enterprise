package com.example.taskflow.auth;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.test.web.support.WebTestUtils;
import org.springframework.security.web.csrf.CsrfTokenRepository;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.context.WebApplicationContext;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.request;

/**
 * The OpenAPI document says which operations anyone may call ({@code security: []}) and which need
 * the cookie or bearer token. {@link OpenApiSecurityConfig} states that by hand, so this checks it
 * against the real {@code SecurityFilterChain}: every documented operation is called anonymously,
 * and only the filter chain's own refusal (401/403 without a body) counts as "needs
 * authentication". A handler's 400, 404 or a failed login's 401 (with a JSON body) means the
 * request got through.
 *
 * <p>{@code csrf()} replaces the {@code CsrfFilter}'s cookie repository with a session-based test
 * repository for good. Left in place, the next class sharing this context found no
 * {@code XSRF-TOKEN} cookie on {@code GET /api/v1/auth/csrf}
 * ({@code SecurityAuthorizationIntegrationTest.cookieLogout_requiresTheActualDoubleSubmitHeader}), so
 * each test puts the original repository back, which keeps the context shareable. This class used to
 * carry {@code @DirtiesContext} instead: a context of its own (10.8 s of class setup on a 4-vCPU
 * machine) that was then thrown away (BENCHMARKS.md §68).
 */
@SpringBootTest(properties = {"app.rate-limit.enabled=false"})
@AutoConfigureMockMvc
class OpenApiSecurityDocumentationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private WebApplicationContext context;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private CsrfTokenRepository originalCsrfTokenRepository;

    @BeforeEach
    void rememberCsrfTokenRepository() {
        originalCsrfTokenRepository = WebTestUtils.getCsrfTokenRepository(filterChainRequest());
    }

    @AfterEach
    void restoreCsrfTokenRepository() {
        WebTestUtils.setCsrfTokenRepository(filterChainRequest(), originalCsrfTokenRepository);
    }

    /** The application has one SecurityFilterChain, so any request finds its CsrfFilter. */
    private MockHttpServletRequest filterChainRequest() {
        return new MockHttpServletRequest(context.getServletContext());
    }

    @Test
    void theSpecMarksExactlyTheOperationsTheFilterChainLetsAnonymousCallersReach() throws Exception {
        JsonNode spec = objectMapper.readTree(mockMvc.perform(get("/v3/api-docs").with(user("admin").roles("ADMIN")))
                .andReturn().getResponse().getContentAsString());

        List<String> mismatches = new ArrayList<>();
        TreeSet<String> documentedPublic = new TreeSet<>();
        for (Map.Entry<String, JsonNode> path : spec.get("paths").properties()) {
            for (Map.Entry<String, JsonNode> op : path.getValue().properties()) {
                String operation = op.getKey().toUpperCase() + " " + path.getKey();
                boolean markedPublic = op.getValue().has("security") && op.getValue().get("security").isEmpty();
                if (markedPublic) {
                    documentedPublic.add(operation);
                }
                boolean reachable = reachableAnonymously(op.getKey(), path.getKey());
                if (reachable != markedPublic) {
                    mismatches.add(operation + (markedPublic ? " is documented public but refused anonymously"
                            : " needs authentication in the spec but is reachable anonymously"));
                }
            }
        }

        assertEquals(List.of(), mismatches);
        // Every listed operation exists (a typo in the list would silently document nothing).
        assertEquals(new TreeSet<>(OpenApiSecurityConfig.PUBLIC_OPERATIONS), documentedPublic);
        assertEquals("[{\"cookieAuth\":[]},{\"bearerAuth\":[]}]", spec.get("security").toString());

        // Telemetry documents 204 and intentionally empty 400/413 error responses, with all event fields required.
        JsonNode telemetryResponses = spec.at("/paths/~1api~1v1~1telemetry/post/responses");
        assertTrue(telemetryResponses.has("204"));
        assertFalse(telemetryResponses.has("200"));
        assertFalse(telemetryResponses.path("400").has("content"));
        assertFalse(telemetryResponses.path("413").has("content"));
        assertEquals("[\"name\",\"platform\",\"route\",\"value\"]",
                spec.at("/components/schemas/ClientTelemetryEvent/required").toString());

        // Browser refresh CSRF 403 is answered by CsrfFilter without a body; 401 still carries ErrorResponse.
        JsonNode refreshResponses = spec.at("/paths/~1api~1v1~1auth~1refresh/post/responses");
        assertTrue(refreshResponses.path("401").has("content"));
        assertFalse(refreshResponses.path("403").has("content"));

        for (String path : List.of("~1api~1v1~1auth~1login", "~1api~1v1~1auth~1mobile~1login")) {
            JsonNode unavailable = spec.at("/paths/" + path + "/post/responses/503");
            assertEquals("integer", unavailable.at("/headers/Retry-After/schema/type").asText());
            assertEquals("#/components/schemas/ErrorResponse",
                    unavailable.at("/content/application~1json/schema/$ref").asText());
        }
    }

    private boolean reachableAnonymously(String method, String pathTemplate) throws Exception {
        String uri = pathTemplate
                .replace("{publicId}", UUID.randomUUID().toString())
                .replaceAll("\\{[^}]+}", "1");
        MockHttpServletResponse response = mockMvc.perform(request(HttpMethod.valueOf(method.toUpperCase()), uri)
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andReturn().getResponse();
        boolean refusedByFilterChain = (response.getStatus() == 401 || response.getStatus() == 403)
                && response.getContentAsString().isEmpty();
        return !refusedByFilterChain;
    }
}
