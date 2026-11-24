package com.example.taskflow.core.cache;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

/** The cache-load lease keeps its {@code app.cache.single-flight.*} keys and defaults. */
class SingleFlightPropertiesTest {

    @Test
    void defaultsMatchTheLockAndManagerDefaults() {
        SingleFlightProperties defaults = SingleFlightProperties.bind(new MockEnvironment());

        assertEquals(RedisCacheLoadLock.DEFAULT_LEASE, defaults.lockLease());
        assertEquals(SingleFlightCacheManager.DEFAULT_MAX_WAIT, defaults.maxWait());
    }

    @Test
    void theKeysAreBound() {
        SingleFlightProperties bound = SingleFlightProperties.bind(new MockEnvironment()
                .withProperty("app.cache.single-flight.lock-lease-ms", "2500")
                .withProperty("app.cache.single-flight.max-wait-ms", "750"));

        assertEquals(Duration.ofMillis(2500), bound.lockLease());
        assertEquals(Duration.ofMillis(750), bound.maxWait());
    }
}
