package com.example.taskflow.core;

import org.junit.jupiter.api.Tag;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/** Runs {@link AbstractRedisCacheLoadLockTest} against a Redis container ({@code ./gradlew testcontainersTest}). */
@Tag("testcontainers")
@Testcontainers
class RedisCacheLoadLockTestcontainersTest extends AbstractRedisCacheLoadLockTest {

    @Container
    static final GenericContainer<?> REDIS = new GenericContainer<>(RedisTestSupport.IMAGE).withExposedPorts(6379);

    @Override
    protected String redisUrl() {
        return "redis://" + REDIS.getHost() + ":" + REDIS.getMappedPort(6379);
    }
}
