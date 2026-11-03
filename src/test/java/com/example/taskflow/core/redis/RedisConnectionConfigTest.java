package com.example.taskflow.core.redis;

import com.example.taskflow.core.cache.CacheConfig;
import io.lettuce.core.ClientOptions;
import io.lettuce.core.SocketOptions;
import io.lettuce.core.resource.ExtendedKeepAliveSupport;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.cache.autoconfigure.CacheAutoConfiguration;
import org.springframework.boot.data.redis.autoconfigure.DataRedisAutoConfiguration;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.cache.annotation.EnableCaching;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;

import java.time.Clock;
import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The Lettuce and cache-writer settings, checked on the beans Boot's auto-configuration builds
 * (nothing here connects to Redis).
 */
class RedisConnectionConfigTest {

    @Configuration(proxyBeanMethods = false)
    @EnableCaching
    static class Caching {
    }

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withConfiguration(AutoConfigurations.of(DataRedisAutoConfiguration.class, CacheAutoConfiguration.class))
            .withBean(Clock.class, Clock::systemUTC)
            .withUserConfiguration(RedisConnectionConfig.class, CacheConfig.class, Caching.class)
            .withPropertyValues("spring.data.redis.port=1", "spring.data.redis.connect-timeout=1s",
                    "spring.cache.type=redis");

    @Test
    void keepAliveIsAddedWithoutLosingTheConfiguredConnectTimeout() {
        runner.run(context -> {
            ClientOptions options = context.getBean(LettuceConnectionFactory.class)
                    .getClientConfiguration().getClientOptions().orElseThrow();
            SocketOptions socket = options.getSocketOptions();

            assertThat(socket.getConnectTimeout()).isEqualTo(Duration.ofSeconds(1));
            assertThat(socket.isKeepAlive()).isTrue();
            if (ExtendedKeepAliveSupport.isSupported()) {
                assertThat(socket.getKeepAlive().getIdle()).isEqualTo(Duration.ofSeconds(30));
                assertThat(socket.getKeepAlive().getInterval()).isEqualTo(Duration.ofSeconds(10));
                assertThat(socket.getKeepAlive().getCount()).isEqualTo(3);
            }
        });
    }

    @Test
    void theCustomizerKeepsOtherSocketOptions() {
        ClientOptions.Builder builder = ClientOptions.builder()
                .socketOptions(SocketOptions.builder().connectTimeout(Duration.ofMillis(750)).tcpNoDelay(false).build());

        RedisConnectionConfig.enableKeepAlive(builder);

        SocketOptions socket = builder.build().getSocketOptions();
        assertThat(socket.getConnectTimeout()).isEqualTo(Duration.ofMillis(750));
        assertThat(socket.isTcpNoDelay()).isFalse();
        assertThat(socket.isKeepAlive()).isTrue();
    }

    @Test
    void recoveryResetsTheSharedConnectionOfTheFactory() {
        runner.run(context -> {
            RedisConnectionRecovery recovery = context.getBean(RedisConnectionRecovery.class);
            org.springframework.dao.QueryTimeoutException timeout =
                    new org.springframework.dao.QueryTimeoutException("Redis command timed out");
            for (int i = 0; i < RedisConnectionRecovery.DEFAULT_THRESHOLD; i++) {
                recovery.recordFailure(timeout);
            }
            assertThat(recovery.resetCount()).isEqualTo(1);
        });
    }
}
