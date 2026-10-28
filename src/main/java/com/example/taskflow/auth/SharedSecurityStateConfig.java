package com.example.taskflow.auth;

import com.example.taskflow.core.SharedStateStore;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.listener.ChannelTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;

import java.nio.charset.StandardCharsets;

/**
 * Redis-backed security state, active only with {@code app.state.store=redis} (set by the prod
 * profile). Without it — dev, tests and the offline CDS training build — none of these beans exist
 * and {@link TokenRevocationList} / {@link LoginAttemptLimiter} stay purely in memory.
 *
 * <p>Nothing here connects during context refresh: Lettuce connects lazily on the first command,
 * and the revocation channel subscription is started off the startup path (see
 * {@link RevocationChannelSubscriber}), so a backend whose Redis is unreachable still starts and
 * serves logins with the in-memory fallbacks.
 */
@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = SharedStateStore.PROPERTY, havingValue = SharedStateStore.REDIS)
class SharedSecurityStateConfig {

    @Bean
    RedisTokenRevocationStore redisTokenRevocationStore(StringRedisTemplate redisTemplate) {
        return new RedisTokenRevocationStore(redisTemplate);
    }

    @Bean
    RedisLoginFailureCounter redisLoginFailureCounter(StringRedisTemplate redisTemplate) {
        return new RedisLoginFailureCounter(redisTemplate);
    }

    /**
     * Listens for revocations announced by other replicas. Not auto-started: a container started in
     * the refresh phase blocks on (and may fail with) an unreachable Redis.
     */
    @Bean
    RedisMessageListenerContainer tokenRevocationListenerContainer(RedisConnectionFactory connectionFactory,
                                                                   TokenRevocationList revocationList) {
        RedisMessageListenerContainer container = new RedisMessageListenerContainer();
        container.setConnectionFactory(connectionFactory);
        container.setAutoStartup(false);
        container.addMessageListener(
                (message, pattern) -> revocationList.onRemoteRevocation(
                        new String(message.getBody(), StandardCharsets.UTF_8)),
                new ChannelTopic(RedisTokenRevocationStore.CHANNEL));
        return container;
    }

    @Bean
    RevocationChannelSubscriber revocationChannelSubscriber(RedisMessageListenerContainer tokenRevocationListenerContainer) {
        return new RevocationChannelSubscriber(tokenRevocationListenerContainer);
    }
}
