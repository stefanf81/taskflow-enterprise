package com.example.taskflow.core;

import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

/**
 * Runs {@link AbstractRedisCacheLoadLockTest} against the Redis named by {@code TASKFLOW_TEST_REDIS_URL}.
 * Skipped unless it is set, so the default {@code test} task stays server-free:
 * <pre>
 *   redis-server --port 6390 --save '' --daemonize yes
 *   TASKFLOW_TEST_REDIS_URL=redis://127.0.0.1:6390 ./gradlew cleanTest test --no-build-cache --tests '*Redis*'
 * </pre>
 * ({@code cleanTest --no-build-cache}: the variable is not a Gradle input.)
 */
@EnabledIfEnvironmentVariable(named = RedisTestSupport.ENV, matches = ".+")
class RedisCacheLoadLockIntegrationTest extends AbstractRedisCacheLoadLockTest {

    @Override
    protected String redisUrl() {
        return System.getenv(RedisTestSupport.ENV);
    }
}
