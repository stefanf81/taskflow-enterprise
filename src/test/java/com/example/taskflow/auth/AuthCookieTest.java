package com.example.taskflow.auth;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.cookie;

@SpringBootTest
@AutoConfigureMockMvc
@Import(TestSecurityConfig.class)
class AuthCookieTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private TokenProvider tokenProvider;

    @MockitoBean
    private UserRepository userRepository;

    @Test
    void loginSetsHttpOnlySecureStrictCookieAndNoTokenInBody() throws Exception {
        when(tokenProvider.generateToken(any())).thenReturn("test-jwt");

        mockMvc.perform(post("/api/v1/auth/login")
                        .with(csrf())
                        .contentType("application/json")
                        .content("{\"username\":\"admin\",\"password\":\"admin-password\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.token").doesNotExist())
                .andExpect(jsonPath("$.username").value("admin"))
                .andExpect(jsonPath("$.role").value("ROLE_ADMIN"))
                .andExpect(cookie().httpOnly("access_token", true))
                // app.cookie.secure is false under the default (dev/http) profile; the prod
                // profile (application-prod.properties) sets it true.
                .andExpect(cookie().secure("access_token", false))
                .andExpect(cookie().path("access_token", "/"))
                .andExpect(cookie().value("access_token", "test-jwt"));
    }

    @Test
    void meReturnsUnauthorizedWhenAnonymous() throws Exception {
        mockMvc.perform(get("/api/v1/auth/me").with(csrf()))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void meReturnsRoleForAuthenticatedUser() throws Exception {
        mockMvc.perform(get("/api/v1/auth/me").with(csrf()).with(user("admin").roles("ADMIN")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.username").value("admin"))
                .andExpect(jsonPath("$.role").value("ROLE_ADMIN"));
    }

    @Test
    void logoutClearsCookie() throws Exception {
        mockMvc.perform(post("/api/v1/auth/logout").with(csrf()).with(user("admin").roles("ADMIN")))
                .andExpect(status().isNoContent())
                .andExpect(cookie().maxAge("access_token", 0))
                .andExpect(cookie().value("access_token", ""));
    }
}
