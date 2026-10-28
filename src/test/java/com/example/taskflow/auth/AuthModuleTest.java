package com.example.taskflow.auth;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.modulith.test.ApplicationModuleTest;
import org.springframework.test.context.TestPropertySource;

import java.time.Instant;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Boots the auth module on its own (plus the shared {@code core} module). */
@ApplicationModuleTest
@TestPropertySource(properties = {"app.rate-limit.enabled=false", "app.schedulers.enabled=false"})
class AuthModuleTest {

    @Autowired
    private TokenRevocationList revocations;

    @Test
    void revokingATokenIdMakesItRevoked() {
        String jti = UUID.randomUUID().toString();
        assertFalse(revocations.isRevoked(jti));

        revocations.revoke(jti, Instant.now().plusSeconds(60));

        assertTrue(revocations.isRevoked(jti));
    }
}
