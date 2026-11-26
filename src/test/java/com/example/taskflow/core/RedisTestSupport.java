package com.example.taskflow.core;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;

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
    /**
     * The image of the compose {@code redis} service ({@code redis:<tag>@sha256:<digest>}, the pin
     * ci.yml and dast.yml share). Read from docker-compose.yml, like {@code PostgresTestServer.IMAGE}:
     * Renovate ignores {@code src/test}, so an image written here would stay behind on the next update.
     */
    public static final String IMAGE = composeImage();

    private RedisTestSupport() {}

    private static String composeImage() {
        String compose;
        try {
            compose = Files.readString(Path.of("docker-compose.yml"));
        } catch (IOException e) {
            throw new UncheckedIOException("the Redis tests read their image from docker-compose.yml", e);
        }
        Matcher image = Pattern.compile("(?m)^\\s+image: (redis:\\S+)$").matcher(compose);
        if (!image.find()) {
            throw new IllegalStateException("docker-compose.yml names no redis image");
        }
        return image.group(1);
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
