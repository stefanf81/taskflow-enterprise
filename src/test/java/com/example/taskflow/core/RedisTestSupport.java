package com.example.taskflow.core;

import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;

import java.net.URI;

/**
 * Connection helpers for the real-Redis suites. Each "replica" in those tests gets its own
 * {@link LettuceConnectionFactory} (its own client and connections) to the same server.
 *
 * <p>The suites run when {@code TASKFLOW_TEST_REDIS_URL} is set (e.g. {@code redis://127.0.0.1:6390};
 * a scratch server: {@code redis-server --port 6390 --save '' --daemonize yes}) and, in the tagged
 * {@code testcontainersTest} task, against a Redis container.
 */
public final class RedisTestSupport {

    public static final String ENV = "TASKFLOW_TEST_REDIS_URL";
    /** The image docker-compose runs. */
    public static final String IMAGE = "redis:8.10.2-alpine";

    private RedisTestSupport() {
    }

    /** A started connection factory for {@code redis://[:password@]host:port[/db]}. */
    public static LettuceConnectionFactory connect(String redisUrl) {
        URI uri = URI.create(redisUrl);
        RedisStandaloneConfiguration configuration =
                new RedisStandaloneConfiguration(uri.getHost(), uri.getPort() > 0 ? uri.getPort() : 6379);
        String userInfo = uri.getUserInfo();
        if (userInfo != null && !userInfo.isEmpty()) {
            int colon = userInfo.indexOf(':');
            configuration.setPassword(colon >= 0 ? userInfo.substring(colon + 1) : userInfo);
        }
        String path = uri.getPath();
        if (path != null && path.length() > 1) {
            configuration.setDatabase(Integer.parseInt(path.substring(1)));
        }
        LettuceConnectionFactory factory = new LettuceConnectionFactory(configuration);
        factory.afterPropertiesSet();
        factory.start();
        return factory;
    }
}
