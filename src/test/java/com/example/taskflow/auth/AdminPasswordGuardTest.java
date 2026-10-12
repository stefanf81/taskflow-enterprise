package com.example.taskflow.auth;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import static org.junit.jupiter.api.Assertions.*;

class AdminPasswordGuardTest {

    private final ApplicationContextRunner runner =
            new ApplicationContextRunner().withUserConfiguration(AdminPasswordGuard.class);

    @Test
    void rejectsMissingBlankDefaultAndPlaceholderPasswords() {
        assertThrows(IllegalStateException.class, () -> AdminPasswordGuard.validate(null));
        assertThrows(IllegalStateException.class, () -> AdminPasswordGuard.validate("   "));
        assertThrows(IllegalStateException.class, () -> AdminPasswordGuard.validate("admin-password"));
        assertThrows(IllegalStateException.class,
                () -> AdminPasswordGuard.validate("<CHANGE_ME_STRONG_TOKEN_SECRET>"));
    }

    @Test
    void acceptsAnOrdinaryStrongPassword() {
        assertDoesNotThrow(() -> AdminPasswordGuard.validate("k3y-9fT!vQ2-long-and-unique"));
    }

    @Test
    void whenEnabledTheContextRefusesToStartWithTheDevelopmentDefault() {
        runner.withPropertyValues(
                        "app.security.require-strong-admin-password=true",
                        "spring.security.user.password=admin-password")
                .run(ctx -> {
                    assertNotNull(ctx.getStartupFailure());
                    assertTrue(rootMessage(ctx.getStartupFailure()).contains("SPRING_SECURITY_PASSWORD"));
                });
    }

    @Test
    void whenEnabledAStrongPasswordStarts() {
        runner.withPropertyValues(
                        "app.security.require-strong-admin-password=true",
                        "spring.security.user.password=k3y-9fT!vQ2-long-and-unique")
                .run(ctx -> assertNull(ctx.getStartupFailure()));
    }

    @Test
    void whenNotEnabledTheDefaultIsAllowedForDevAndDisposableStacks() {
        runner.withPropertyValues("spring.security.user.password=admin-password")
                .run(ctx -> {
                    assertNull(ctx.getStartupFailure());
                    assertTrue(ctx.getBeansOfType(AdminPasswordGuard.class).isEmpty());
                });
    }

    private static String rootMessage(Throwable t) {
        while (t.getCause() != null) {
            t = t.getCause();
        }
        return String.valueOf(t.getMessage());
    }
}
