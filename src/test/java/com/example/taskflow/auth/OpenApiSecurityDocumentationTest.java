package com.example.taskflow.auth;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.web.servlet.MockMvc;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
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
 * repository for good, so this test throws its context away afterwards: sharing it, the next class
 * found no {@code XSRF-TOKEN} cookie on {@code GET /api/v1/auth/csrf}
 * ({@code SecurityAuthorizationIntegrationTest.cookieLogout_requiresTheActualDoubleSubmitHeader}).
 */
@SpringBootTest(properties = {"app.rate-limit.enabled=false"})
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class OpenApiSecurityDocumentationTest {

    @Autowired
    private MockMvc mockMvc;

    private final ObjectMapper objectMapper = new ObjectMapper();

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
