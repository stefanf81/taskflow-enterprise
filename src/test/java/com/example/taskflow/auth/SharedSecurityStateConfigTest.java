package com.example.taskflow.auth;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;

import java.time.Duration;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@code app.state.store} wiring: no Redis beans by default, Redis-backed state with {@code redis},
 * and in neither case a connection attempt while the context starts. The Redis here is unreachable
 * (port 1), as for a prod backend started without Redis: everything must degrade, nothing may fail.
 */
class SharedSecurityStateConfigTest {

    @Configuration(proxyBeanMethods = false)
    static class UnreachableRedis {
        @Bean(destroyMethod = "destroy")
        LettuceConnectionFactory redisConnectionFactory() {
            return new LettuceConnectionFactory("127.0.0.1", 1);
        }

        @Bean
        StringRedisTemplate stringRedisTemplate(LettuceConnectionFactory factory) {
            return new StringRedisTemplate(factory);
        }
    }

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(UnreachableRedis.class, SharedSecurityStateConfig.class)
            .withBean(TokenRevocationList.class)
            .withBean(LoginAttemptLimiter.class)
            .withPropertyValues("app.rate-limit.login-max-failures=2");

    @Test
    void theDefaultMemoryStoreCreatesNoRedisBackedState() {
        runner.run(context -> {
            assertThat(context).hasNotFailed();
            assertThat(context).doesNotHaveBean(RedisTokenRevocationStore.class);
            assertThat(context).doesNotHaveBean(RedisLoginFailureCounter.class);
            assertThat(context).doesNotHaveBean(RedisMessageListenerContainer.class);

            TokenRevocationList list = context.getBean(TokenRevocationList.class);
            list.revoke("jti", Instant.now().plusSeconds(60));
            assertTrue(list.isRevoked("jti"));
        });
    }

    @Test
    void theRedisStoreStartsWithoutRedisAndDegradesToTheInMemoryFallbacks() {
        runner.withPropertyValues("app.state.store=redis").run(context -> {
            assertThat(context).hasNotFailed();
            assertThat(context).hasSingleBean(RedisTokenRevocationStore.class);
            assertThat(context).hasSingleBean(RedisLoginFailureCounter.class);
            assertThat(context).hasSingleBean(RevocationChannelSubscriber.class);
            assertFalse(context.getBean(RedisMessageListenerContainer.class).isRunning(),
                    "the subscription is not started during refresh");

            TokenRevocationList list = context.getBean(TokenRevocationList.class);
            assertDoesNotThrow(() -> list.revoke("jti", Instant.now().plusSeconds(60)));
            assertTrue(list.isRevoked("jti"), "revocation still enforced on this replica");
            assertFalse(list.isRevoked("other"), "other tokens are not rejected wholesale");
            assertTrue(list.pendingCount() == 1, "kept for a later Redis write");

            LoginAttemptLimiter limiter = context.getBean(LoginAttemptLimiter.class);
            limiter.recordFailure("a@x.com");
            limiter.recordFailure("a@x.com");
            assertThrows(TooManyLoginAttemptsException.class, () -> limiter.checkAllowed("a@x.com"));
            limiter.recordSuccess("a@x.com");
            assertDoesNotThrow(() -> limiter.checkAllowed("a@x.com"));
        });
    }

    @Test
    void theSubscriberKeepsRetryingInTheBackgroundAndStopsOnShutdown() throws Exception {
        LettuceConnectionFactory factory = new LettuceConnectionFactory("127.0.0.1", 1);
        factory.afterPropertiesSet();
        factory.start();
        RedisMessageListenerContainer container = new RedisMessageListenerContainer();
        container.setConnectionFactory(factory);
        container.setAutoStartup(false);
        container.addMessageListener((message, pattern) -> { },
                new org.springframework.data.redis.listener.ChannelTopic(RedisTokenRevocationStore.CHANNEL));
        container.afterPropertiesSet();
        RevocationChannelSubscriber subscriber = new RevocationChannelSubscriber(container, 50);
        try {
            long start = System.nanoTime();
            subscriber.subscribe();
            assertTrue(Duration.ofNanos(System.nanoTime() - start).toMillis() < 500,
                    "subscribing never blocks the caller (application startup)");
            Thread.sleep(300);
            assertFalse(subscriber.isListening());
        } finally {
            subscriber.destroy();
            container.destroy();
            factory.destroy();
        }
    }
}
