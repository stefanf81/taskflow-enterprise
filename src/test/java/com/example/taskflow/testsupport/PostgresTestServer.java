package com.example.taskflow.testsupport;

import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The PostgreSQL server for the {@code @Tag("testcontainers")} tests that create their own schemas or
 * databases. {@code TASKFLOW_TEST_POSTGRES_URL} (plus {@code _USER}/{@code _PASSWORD}) points them at
 * an existing server; otherwise one throw-away container is started per JVM on first use, so
 * {@code ./gradlew testcontainersTest} runs them in CI instead of skipping them.
 */
public final class PostgresTestServer {

    /**
     * The image of the compose {@code db} service. Every PostgreSQL test container uses it, so the
     * local stack and the tests run the same server, and Renovate updates one pin: it ignores
     * {@code src/test}, so an image named in a test would stay behind. The compose image is pinned
     * as {@code postgres:<tag>@sha256:<digest>}, a name Testcontainers does not recognise as a
     * postgres image on its own, hence the declared substitute.
     */
    public static final DockerImageName IMAGE =
            DockerImageName.parse(composeImage()).asCompatibleSubstituteFor("postgres");

    private static final String URL = System.getenv("TASKFLOW_TEST_POSTGRES_URL");

    private static PostgreSQLContainer container;

    private PostgresTestServer() {
    }

    /** JDBC URL of the server's default database, e.g. {@code jdbc:postgresql://host:port/postgres}. */
    public static String jdbcUrl() {
        return hasExternalServer() ? URL : container().getJdbcUrl();
    }

    public static String user() {
        return hasExternalServer()
                ? System.getenv().getOrDefault("TASKFLOW_TEST_POSTGRES_USER", "postgres")
                : container().getUsername();
    }

    public static String password() {
        return hasExternalServer()
                ? System.getenv().getOrDefault("TASKFLOW_TEST_POSTGRES_PASSWORD", "")
                : container().getPassword();
    }

    /** {@link #jdbcUrl()} without the {@code jdbc:} prefix, for host, port and database name. */
    public static URI uri() {
        return URI.create(jdbcUrl().substring("jdbc:".length()));
    }

    private static String composeImage() {
        String compose;
        try {
            compose = Files.readString(Path.of("docker-compose.yml"));
        } catch (IOException e) {
            throw new UncheckedIOException("the PostgreSQL tests read their image from docker-compose.yml", e);
        }
        Matcher image = Pattern.compile("(?m)^\\s+image: (postgres:\\S+)$").matcher(compose);
        if (!image.find()) {
            throw new IllegalStateException("docker-compose.yml names no postgres image");
        }
        return image.group(1);
    }

    private static boolean hasExternalServer() {
        return URL != null && !URL.isBlank();
    }

    private static synchronized PostgreSQLContainer container() {
        if (container == null) {
            PostgreSQLContainer started = new PostgreSQLContainer(IMAGE)
                    .withDatabaseName("postgres")
                    .withUsername("postgres")
                    .withPassword("postgres-password");
            started.start();
            container = started;
        }
        return container;
    }
}
