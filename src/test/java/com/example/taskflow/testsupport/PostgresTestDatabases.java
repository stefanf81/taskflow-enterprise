package com.example.taskflow.testsupport;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.atomic.AtomicInteger;
import org.flywaydb.core.Flyway;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;

/**
 * One PostgreSQL database per Spring context, cloned from a Flyway-migrated template.
 *
 * <p>The template is migrated once per server and set of migrations: its name carries a hash of every
 * file under the Flyway locations, so a changed migration builds a new one, and an advisory lock keeps
 * two forks sharing an external server from building it twice. Each context then gets
 * {@code CREATE DATABASE … TEMPLATE …}, a file copy that takes milliseconds, and the application's own
 * Flyway only validates the already-applied history. That keeps the H2 suite's isolation (no context
 * sees another's rows) without migrating ~40 versions per context.
 */
public final class PostgresTestDatabases {

    /** Hikari's default: concurrency tests open several connections per thread (REQUIRES_NEW). */
    static final int HIKARI_MAXIMUM_POOL_SIZE = 10;

    /** A cached, idle context keeps one connection; the rest retire after {@link #HIKARI_IDLE_TIMEOUT_MS}. */
    static final int HIKARI_MINIMUM_IDLE = 1;

    /** Hikari's minimum. */
    static final long HIKARI_IDLE_TIMEOUT_MS = 10_000;

    private static final long TEMPLATE_LOCK = 7_301_202_611L;

    /** Unique per JVM, so forks and repeated runs against an external server never collide. */
    private static final String RUN_ID = ProcessHandle.current().pid() + "_"
            + Integer.toString(ThreadLocalRandom.current().nextInt(1 << 20, 1 << 25), 36);

    private static final AtomicInteger COUNTER = new AtomicInteger();

    private static final List<String> CREATED = new ArrayList<>();

    /** Template database per set of Flyway locations (the production layout adds db/prod-cleanup). */
    private static final Map<List<String>, String> TEMPLATES = new HashMap<>();

    private PostgresTestDatabases() {}

    /** Creates a fresh, fully migrated database and returns its JDBC URL. */
    public static synchronized String createDatabase(List<String> flywayLocations) {
        String source = template(flywayLocations);
        String name = "taskflow_test_" + RUN_ID + "_" + COUNTER.incrementAndGet();
        execute("CREATE DATABASE " + name + " TEMPLATE " + source);
        if (CREATED.isEmpty() && PostgresTestServer.isExternal()) {
            // A container disappears with the JVM; an external server would keep every database.
            Runtime.getRuntime().addShutdownHook(new Thread(PostgresTestDatabases::dropCreated, "drop-test-dbs"));
        }
        CREATED.add(name);
        return jdbcUrl(name);
    }

    /** JDBC URL of database {@code name} on {@link PostgresTestServer}. */
    static String jdbcUrl(String name) {
        URI server = PostgresTestServer.uri();
        String query = server.getRawQuery();
        return "jdbc:postgresql://" + server.getRawAuthority() + "/" + name + (query == null ? "" : "?" + query);
    }

    private static String template(List<String> flywayLocations) {
        String existing = TEMPLATES.get(flywayLocations);
        if (existing != null) {
            return existing;
        }
        String name = "taskflow_tpl_" + migrationsHash(flywayLocations);
        try (Connection admin = adminConnection();
                Statement statement = admin.createStatement()) {
            statement.execute("SELECT pg_advisory_lock(" + TEMPLATE_LOCK + ")");
            try {
                if (!databaseExists(admin, name)) {
                    // Built under a temporary name and renamed when complete, so a run that dies
                    // mid-migration never leaves a half-migrated template behind.
                    String building = "taskflow_tpl_build_" + RUN_ID;
                    statement.execute("DROP DATABASE IF EXISTS " + building);
                    statement.execute("CREATE DATABASE " + building);
                    Flyway.configure()
                            .dataSource(jdbcUrl(building), PostgresTestServer.user(), PostgresTestServer.password())
                            .locations(flywayLocations.toArray(String[]::new))
                            .load()
                            .migrate();
                    statement.execute("ALTER DATABASE " + building + " RENAME TO " + name);
                    // Nobody connects to the template, so cloning it can never be blocked.
                    statement.execute("ALTER DATABASE " + name + " WITH IS_TEMPLATE true ALLOW_CONNECTIONS false");
                }
            } finally {
                statement.execute("SELECT pg_advisory_unlock(" + TEMPLATE_LOCK + ")");
            }
        } catch (SQLException e) {
            throw new IllegalStateException("Could not prepare the PostgreSQL test template " + name, e);
        }
        TEMPLATES.put(List.copyOf(flywayLocations), name);
        return name;
    }

    /** SHA-256 over the relative path and content of every file under the Flyway locations. */
    static String migrationsHash(List<String> flywayLocations) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            PathMatchingResourcePatternResolver resolver = new PathMatchingResourcePatternResolver();
            for (String location : flywayLocations) {
                digest.update(location.getBytes(StandardCharsets.UTF_8));
                if (!location.startsWith("classpath:")) {
                    continue;
                }
                String path = location.substring("classpath:".length()).replaceAll("^/+|/+$", "");
                Resource[] resources = resolver.getResources("classpath*:" + path + "/**/*");
                Arrays.sort(resources, Comparator.comparing(r -> relativePath(r, path)));
                for (Resource resource : resources) {
                    if (!resource.isReadable()) {
                        continue; // a directory
                    }
                    digest.update(relativePath(resource, path).getBytes(StandardCharsets.UTF_8));
                    try (InputStream in = resource.getInputStream()) {
                        digest.update(in.readAllBytes());
                    }
                }
            }
            return HexFormat.of().formatHex(digest.digest()).substring(0, 16);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static String relativePath(Resource resource, String path) {
        String url;
        try {
            url = resource.getURL().toString();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        int index = url.lastIndexOf("/" + path + "/");
        return index < 0 ? url : url.substring(index + 1);
    }

    private static boolean databaseExists(Connection admin, String name) throws SQLException {
        try (PreparedStatement query = admin.prepareStatement("SELECT 1 FROM pg_database WHERE datname = ?")) {
            query.setString(1, name.toLowerCase(Locale.ROOT));
            try (ResultSet rows = query.executeQuery()) {
                return rows.next();
            }
        }
    }

    private static void execute(String sql) {
        try (Connection admin = adminConnection();
                Statement statement = admin.createStatement()) {
            statement.execute(sql);
        } catch (SQLException e) {
            throw new IllegalStateException("Test database statement failed: " + sql, e);
        }
    }

    private static Connection adminConnection() throws SQLException {
        return DriverManager.getConnection(
                PostgresTestServer.jdbcUrl(), PostgresTestServer.user(), PostgresTestServer.password());
    }

    private static synchronized void dropCreated() {
        for (String name : CREATED) {
            try (Connection admin = adminConnection();
                    Statement statement = admin.createStatement()) {
                statement.execute("DROP DATABASE IF EXISTS " + name + " WITH (FORCE)");
            } catch (SQLException ignored) {
                // Best effort at JVM exit; a leftover database is harmless.
            }
        }
    }
}
