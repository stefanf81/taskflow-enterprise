package com.example.taskflow.core;

import io.lettuce.core.ClientOptions;
import io.lettuce.core.SocketOptions;
import io.lettuce.core.resource.ExtendedKeepAliveSupport;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.data.redis.autoconfigure.LettuceClientOptionsBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;

import java.time.Clock;
import java.time.Duration;

/**
 * Dead-connection detection for the Lettuce connections (all profiles; nothing here connects).
 *
 * <p><b>TCP keepalive</b> (idle 30 s, then 3 probes 10 s apart): an <em>idle</em> connection the
 * network silently dropped - typically the pub/sub connection of the token-revocation channel - is
 * reported dead after about a minute, and Lettuce reconnects (and re-subscribes) instead of waiting
 * for a write that never fails. The probe settings use the JDK's extended socket options on the
 * plain NIO transport; without them (an exotic platform) only {@code SO_KEEPALIVE} with the OS
 * defaults is set. A <em>busy</em> connection is not probed (it has unacknowledged data), which is
 * what {@link RedisConnectionRecovery} is for.
 */
@Configuration(proxyBeanMethods = false)
class RedisConnectionConfig {

    static final Duration KEEPALIVE_IDLE = Duration.ofSeconds(30);
    static final Duration KEEPALIVE_INTERVAL = Duration.ofSeconds(10);
    static final int KEEPALIVE_COUNT = 3;

    /**
     * Boot has already put {@code spring.data.redis.connect-timeout} into the builder's socket
     * options, so they are extended rather than replaced (a fresh {@code SocketOptions} would reset
     * the connect timeout to Lettuce's 10 s).
     */
    @Bean
    LettuceClientOptionsBuilderCustomizer redisKeepAliveCustomizer() {
        return RedisConnectionConfig::enableKeepAlive;
    }

    static void enableKeepAlive(ClientOptions.Builder builder) {
        SocketOptions.Builder socket = builder.build().getSocketOptions().mutate();
        if (ExtendedKeepAliveSupport.isSupported()) {
            socket.keepAlive(SocketOptions.KeepAliveOptions.builder()
                    .enable()
                    .idle(KEEPALIVE_IDLE)
                    .interval(KEEPALIVE_INTERVAL)
                    .count(KEEPALIVE_COUNT)
                    .build());
        } else {
            socket.keepAlive(true);
        }
        builder.socketOptions(socket.build());
    }

    /** Resets the factory's shared connection; resolved lazily, so startup never touches Redis. */
    @Bean
    RedisConnectionRecovery redisConnectionRecovery(ObjectProvider<RedisConnectionFactory> connectionFactory,
                                                    Clock clock) {
        return new RedisConnectionRecovery(() -> {
            if (connectionFactory.getIfAvailable() instanceof LettuceConnectionFactory lettuce) {
                lettuce.resetConnection();
            }
        }, RedisConnectionRecovery.DEFAULT_THRESHOLD, RedisBackoff.DEFAULT_BACKOFF_MILLIS, clock::millis);
    }
}
