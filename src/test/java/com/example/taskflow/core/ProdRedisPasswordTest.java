package com.example.taskflow.core;

import org.junit.jupiter.api.Test;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.data.redis.connection.RedisPassword;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;

import java.io.IOException;
import java.io.InputStream;
import java.util.Map;
import java.util.Properties;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The prod profile sends {@code REDIS_PASSWORD} to Redis and has no default for it
 * (https://github.com/stefanf81/taskflow-enterprise/issues/216): a deployment that forgot the secret
 * must fail to start instead of connecting unauthenticated. CI service containers cannot take a
 * password and set the variable to the empty string, which must mean "no authentication" rather than
 * an unresolved placeholder.
 */
class ProdRedisPasswordTest {

    private static String propertyValue() throws IOException {
        Properties prod = new Properties();
        try (InputStream in = ProdRedisPasswordTest.class.getClassLoader()
                .getResourceAsStream("application-prod.properties")) {
            prod.load(in);
        }
        return prod.getProperty("spring.data.redis.password");
    }

    private static StandardEnvironment environmentWith(Map<String, Object> variables) {
        StandardEnvironment environment = new StandardEnvironment();
        // Only the given variables: the machine's own REDIS_PASSWORD must not leak into the test.
        environment.getPropertySources().remove(StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME);
        environment.getPropertySources().addFirst(new MapPropertySource("test-env", variables));
        return environment;
    }

    @Test
    void theProdProfileReadsTheRedisPasswordFromAVariableWithoutADefault() throws IOException {
        assertThat(propertyValue()).isEqualTo("${REDIS_PASSWORD}");
    }

    @Test
    void aMissingPasswordFailsTheStart() throws IOException {
        StandardEnvironment environment = environmentWith(Map.of());
        assertThatThrownBy(() -> environment.resolveRequiredPlaceholders(propertyValue()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("REDIS_PASSWORD");
    }

    @Test
    void aPasswordIsPassedThroughAndAnEmptyOneMeansNoAuthentication() throws IOException {
        String configured = environmentWith(Map.of("REDIS_PASSWORD", "s3cret"))
                .resolveRequiredPlaceholders(propertyValue());
        assertThat(configured).isEqualTo("s3cret");
        RedisStandaloneConfiguration withPassword = new RedisStandaloneConfiguration();
        withPassword.setPassword(configured);
        assertThat(withPassword.getPassword().isPresent()).isTrue();

        String empty = environmentWith(Map.of("REDIS_PASSWORD", "")).resolveRequiredPlaceholders(propertyValue());
        assertThat(empty).isEmpty();
        RedisStandaloneConfiguration withoutPassword = new RedisStandaloneConfiguration();
        withoutPassword.setPassword(empty);
        assertThat(withoutPassword.getPassword()).isEqualTo(RedisPassword.none());
    }
}
