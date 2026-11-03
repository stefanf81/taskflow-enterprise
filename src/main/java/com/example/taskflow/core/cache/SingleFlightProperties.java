package com.example.taskflow.core.cache;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.core.env.Environment;

import java.time.Duration;

/**
 * The cross-replica cache-load lease of {@link SingleFlightCacheManager}, bound from
 * {@code app.cache.single-flight.*} (used only with {@code app.state.store=redis}).
 *
 * <ul>
 *   <li>{@code lock-lease-ms} (default 10000): how long a loader may hold the lease.</li>
 *   <li>{@code max-wait-ms} (default 5000): how long another replica waits for the value before
 *       loading itself.</li>
 * </ul>
 *
 * <p>Not a bean: {@link CacheConfig}'s static post-processor reads it with {@link #bind} before the
 * properties beans exist.
 */
@ConfigurationProperties(prefix = SingleFlightProperties.PREFIX)
record SingleFlightProperties(
        @DefaultValue("10000") long lockLeaseMs,
        @DefaultValue("5000") long maxWaitMs) {

    static final String PREFIX = "app.cache.single-flight";

    static SingleFlightProperties bind(Environment environment) {
        return Binder.get(environment).bindOrCreate(PREFIX, SingleFlightProperties.class);
    }

    Duration lockLease() {
        return Duration.ofMillis(lockLeaseMs);
    }

    Duration maxWait() {
        return Duration.ofMillis(maxWaitMs);
    }
}
