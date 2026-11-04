package com.example.taskflow.auth;

import com.example.taskflow.auth.internal.RevokedTokenRepository;
import com.example.taskflow.auth.internal.UserRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * https://github.com/stefanf81/taskflow-enterprise/issues/218 through the real filter chain and the H2
 * schema: a token stops working when its account's tokens are all revoked, when the account is
 * demoted or deleted, and a logout survives a restart of the denylist.
 */
@SpringBootTest(properties = {"app.rate-limit.enabled=false", "app.schedulers.enabled=false"})
@AutoConfigureMockMvc
class AccountTokenRevocationIntegrationTest {

    private static final String PASSWORD = "member-password";

    @Autowired private MockMvc mockMvc;
    @Autowired private UserRepository users;
    @Autowired private PasswordEncoder passwordEncoder;
    @Autowired private AccountTokenCheck accounts;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private JwtDecoder jwtDecoder;
    @Autowired private PersistentTokenRevocations persistent;
    @Autowired private RevokedTokenRepository revokedTokens;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private String newAccount(String role) {
        String email = "tokens-" + UUID.randomUUID() + "@x.test";
        users.save(new AppUser(email, passwordEncoder.encode(PASSWORD), "Token Test", "555", role));
        return email;
    }

    private String login(String email) throws Exception {
        String body = mockMvc.perform(post("/api/v1/auth/mobile/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("username", email, "password", PASSWORD))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        JsonNode json = objectMapper.readTree(body);
        return json.get("accessToken").asText();
    }

    private int customerListStatus(String token) throws Exception {
        return mockMvc.perform(get("/api/v1/customer/appointments").header("Authorization", "Bearer " + token))
                .andReturn().getResponse().getStatus();
    }

    @Test
    void revokingAllTokensOfAnAccountRejectsTheOldOnesAndNotANewLogin() throws Exception {
        String email = newAccount("ROLE_CUSTOMER");
        String first = login(email);
        String second = login(email);
        assertEquals(200, customerListStatus(first));

        accounts.revokeAllTokens(email);

        assertEquals(401, customerListStatus(first));
        assertEquals(401, customerListStatus(second));
        String fresh = login(email);
        assertEquals(200, customerListStatus(fresh), "a login after the revocation carries the new version");
    }

    @Test
    void aDemotedAdminLosesTheAdminTokenEvenWithoutARevocation() throws Exception {
        String email = newAccount("ROLE_ADMIN");
        String token = login(email);
        mockMvc.perform(get("/api/v1/appointments").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk());

        // straight in the database, as an operator would do it today (there is no endpoint)
        jdbc.update("UPDATE app_users SET role = 'ROLE_CUSTOMER' WHERE email = ?", email);
        accounts.forget(email); // otherwise within AccountTokenCheck.CACHE_TTL

        mockMvc.perform(get("/api/v1/appointments").header("Authorization", "Bearer " + token))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void aDeletedAccountsTokenIsRejected() throws Exception {
        String email = newAccount("ROLE_CUSTOMER");
        String token = login(email);
        assertEquals(200, customerListStatus(token));

        jdbc.update("DELETE FROM app_users WHERE email = ?", email);
        accounts.forget(email);

        assertEquals(401, customerListStatus(token));
    }

    /** A logout is stored durably and a fresh denylist (a restarted replica) loads it back. */
    @Test
    void aLogoutSurvivesARestartOfTheDenylist() throws Exception {
        String email = newAccount("ROLE_CUSTOMER");
        String token = login(email);
        String jti = jwtDecoder.decode(token).getId();

        mockMvc.perform(post("/api/v1/auth/logout").header("Authorization", "Bearer " + token))
                .andExpect(status().isNoContent());
        assertEquals(401, customerListStatus(token));
        assertTrue(revokedTokens.existsById(jti), "the revocation is stored in revoked_tokens");

        TokenRevocationList restarted = new TokenRevocationList(null, null, persistent, TokenProvider.TOKEN_CLOCK);
        assertEquals(false, restarted.isRevoked(jti), "an empty denylist knows nothing");
        assertTrue(restarted.restore(persistent.active(java.time.Instant.now())) >= 1);
        assertTrue(restarted.isRevoked(jti), "the restored denylist rejects the logged-out token again");
    }
}
