package com.example.taskflow.auth;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class LoginAttemptLimiterTest {

    @Test
    void allowsUpToTheLimitThenThrottlesWithRetryAfter() {
        LoginAttemptLimiter limiter = new LoginAttemptLimiter(3, 300);

        for (int i = 0; i < 3; i++) {
            limiter.checkAllowed("a@x.com");
            limiter.recordFailure("a@x.com");
        }

        TooManyLoginAttemptsException ex =
                assertThrows(TooManyLoginAttemptsException.class, () -> limiter.checkAllowed("a@x.com"));
        long retryAfter = Long.parseLong(ex.getHeaders().getFirst("Retry-After"));
        assertTrue(retryAfter >= 1 && retryAfter <= 300, "retry-after=" + retryAfter);
    }

    @Test
    void keyIgnoresCaseAndSurroundingWhitespace() {
        LoginAttemptLimiter limiter = new LoginAttemptLimiter(1, 300);
        limiter.recordFailure("  Mixed@Case.com ");

        assertThrows(TooManyLoginAttemptsException.class, () -> limiter.checkAllowed("mixed@case.com"));
    }

    @Test
    void successClearsTheCountAndOtherAccountsAreUnaffected() {
        LoginAttemptLimiter limiter = new LoginAttemptLimiter(2, 300);
        limiter.recordFailure("a@x.com");
        limiter.recordFailure("a@x.com");
        limiter.recordFailure("b@x.com");

        assertThrows(TooManyLoginAttemptsException.class, () -> limiter.checkAllowed("a@x.com"));
        assertDoesNotThrow(() -> limiter.checkAllowed("b@x.com"));

        limiter.recordSuccess("a@x.com");
        assertDoesNotThrow(() -> limiter.checkAllowed("a@x.com"));
    }

    @Test
    void zeroDisablesTheThrottle() {
        LoginAttemptLimiter limiter = new LoginAttemptLimiter(0, 300);
        for (int i = 0; i < 100; i++) {
            limiter.recordFailure("a@x.com");
        }
        assertDoesNotThrow(() -> limiter.checkAllowed("a@x.com"));
    }

    @Test
    void nullUsernameDoesNotThrow() {
        LoginAttemptLimiter limiter = new LoginAttemptLimiter(1, 300);
        assertDoesNotThrow(() -> limiter.recordFailure(null));
        assertThrows(TooManyLoginAttemptsException.class, () -> limiter.checkAllowed(null));
    }

    @Test
    void failuresFromOneAddressDoNotLockTheAccountOutForOtherAddresses() {
        LoginAttemptLimiter limiter = new LoginAttemptLimiter(2, 300);
        try {
            asClient("203.0.113.66");
            limiter.recordFailure("admin");
            limiter.recordFailure("admin");
            assertThrows(TooManyLoginAttemptsException.class, () -> limiter.checkAllowed("admin"));

            // The real admin, from another address, can still sign in.
            asClient("198.51.100.10");
            assertDoesNotThrow(() -> limiter.checkAllowed("admin"));
        } finally {
            org.springframework.web.context.request.RequestContextHolder.resetRequestAttributes();
        }
    }

    private static void asClient(String address) {
        var request = new org.springframework.mock.web.MockHttpServletRequest();
        request.setRemoteAddr(address);
        org.springframework.web.context.request.RequestContextHolder.setRequestAttributes(
                new org.springframework.web.context.request.ServletRequestAttributes(request));
    }
}
