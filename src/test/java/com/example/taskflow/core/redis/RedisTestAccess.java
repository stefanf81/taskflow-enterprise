package com.example.taskflow.core.redis;

import io.lettuce.core.ClientOptions;

/**
 * Test-only access to package-private parts of {@code core.redis} for the real-Redis suite in
 * {@code core.cache} ({@code AbstractRedisCacheLoadLockTest}), which exercises the whole stack.
 */
public final class RedisTestAccess {

    private RedisTestAccess() {
    }

    public static void enableKeepAlive(ClientOptions.Builder builder) {
        RedisConnectionConfig.enableKeepAlive(builder);
    }

    public static long resetCount(RedisConnectionRecovery recovery) {
        return recovery.resetCount();
    }
}
