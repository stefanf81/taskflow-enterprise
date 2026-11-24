package com.example.taskflow.testsupport;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/**
 * The PostgreSQL server of a test JVM: every Spring context of the {@code test} task gets its own
 * database on it ({@link PostgresTestDatabases}), and the {@code @Tag("testcontainers")} tests create
 * their own schemas or databases on it. {@code TASKFLOW_TEST_POSTGRES_URL} (plus {@code _USER}/
 * {@code _PASSWORD}) points them at an existing server; otherwise one throw-away container is started
 * per JVM (per Gradle test fork) on first use.
 */
public final class PostgresTestServer {

    /**
     * The image of the compose {@code db} service ({@code postgres:<tag>@sha256:<digest>}, the pin
     * ci.yml shares). Read from docker-compose.yml so the local stack and the tests always run the
     * same server: Renovate ignores {@code src/test}, so an image written here would stay behind on
     * the next update. Testcontainers does not recognise a reference with both a tag and a digest as
     * a postgres image on its own, hence the declared substitute.
     */
    public static final DockerImageName IMAGE =
            DockerImageName.parse(composeImage()).asCompatibleSubstituteFor("postgres");

    /**
     * Room for every cached Spring context of one fork: each holds at most one idle connection
     * ({@link PostgresTestDatabases#HIKARI_MINIMUM_IDLE}) and the running test up to
     * {@link PostgresTestDatabases#HIKARI_MAXIMUM_POOL_SIZE}; Spring's context cache keeps at most 32.
     */
    static final int MAX_CONNECTIONS = 200;

    private static final String URL = System.getenv("TASKFLOW_TEST_POSTGRES_URL");

    private static PostgreSQLContainer container;

    private PostgresTestServer() {}

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

    /** Whether {@code TASKFLOW_TEST_POSTGRES_URL} names a server, instead of a container per JVM. */
    public static boolean isExternal() {
        return hasExternalServer();
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
            // Throw-away data: the data directory lives in memory and durability is off
            // (no fsync, no synchronous commit, no full-page writes), the usual test tuning.
            PostgreSQLContainer started = new PostgreSQLContainer(IMAGE)
                    .withDatabaseName("postgres")
                    .withUsername("postgres")
                    .withPassword("postgres-password")
                    .withTmpFs(Map.of("/var/lib/postgresql", "rw"))
                    .withCommand(
                            "postgres",
                            "-c",
                            "fsync=off",
                            "-c",
                            "synchronous_commit=off",
                            "-c",
                            "full_page_writes=off",
                            "-c",
                            "max_connections=" + MAX_CONNECTIONS);
            started.start();
            container = started;
        }
        return container;
    }
}
