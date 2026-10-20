package com.example.taskflow.core;

import org.hibernate.cfg.AvailableSettings;
import org.hibernate.jpa.SpecHints;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.net.URL;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Properties;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * Spring Boot ignores a property it does not know, so a renamed key keeps "working" silently. Under
 * Boot 4.1 this had happened to {@code management.metrics.distribution.sla} (renamed {@code slo}: the
 * prod SLO buckets were missing), {@code server.error.*} (now {@code spring.web.error.*}),
 * {@code management.endpoint.prometheus.enabled} (now {@code .access}), {@code spring.h2.console.*}
 * (needs the absent {@code spring-boot-h2console} module) and the Hibernate setting
 * {@code hibernate.query.plan_parameter_metadata_max_size} (deprecated, never read by Hibernate 7).
 *
 * <p>Every key in the application property files must therefore exist, and not be removed
 * (deprecation level {@code error}), in the configuration metadata of the classpath; keys under
 * {@code spring.jpa.properties.} must be non-deprecated Hibernate or Jakarta Persistence settings.
 * {@code app.*} keys are the application's own and have no metadata.
 */
class PropertyKeysMetadataTest {

    private static final String JPA_PROPERTIES = "spring.jpa.properties.";

    /** Canonical key -> metadata entry, plus the canonical names of Map-typed properties. */
    private static final Map<String, JsonNode> PROPERTIES = new HashMap<>();
    private static final List<String> MAP_PROPERTIES = new ArrayList<>();
    /** Hibernate/JPA setting name -> deprecated? */
    private static final Map<String, Boolean> HIBERNATE_SETTINGS = new HashMap<>();

    static {
        try {
            loadMetadata("META-INF/spring-configuration-metadata.json");
            loadMetadata("META-INF/additional-spring-configuration-metadata.json");
        } catch (IOException e) {
            throw new ExceptionInInitializerError(e);
        }
        addSettings(AvailableSettings.class);
        addSettings(SpecHints.class);
    }

    @ParameterizedTest
    @ValueSource(strings = {"application.properties", "application-prod.properties"})
    void everyFrameworkKeyIsKnownToTheClasspathMetadata(String file) throws IOException {
        Properties properties = new Properties();
        try (InputStream in = getClass().getClassLoader().getResourceAsStream(file)) {
            assertNotNull(in, file);
            properties.load(in);
        }
        List<String> problems = new ArrayList<>();
        for (String key : properties.stringPropertyNames()) {
            if (!key.startsWith("app.")) {
                String problem = check(key);
                if (problem != null) {
                    problems.add(key + ": " + problem);
                }
            }
        }
        Collections.sort(problems);
        assertEquals(List.of(), problems, file + " has keys Spring Boot or Hibernate would ignore");
    }

    @Test
    void flagsTheKeysThatWereSilentlyIgnored() {
        for (String ignored : List.of("management.metrics.distribution.sla.http.server.requests",
                "server.error.include-message", "management.endpoint.prometheus.enabled",
                "spring.h2.console.enabled", "spring.jpa.properties.hibernate.query.plan_parameter_metadata_max_size")) {
            assertNotNull(check(ignored), ignored);
        }
        for (String bound : List.of("management.metrics.distribution.slo.http.server.requests",
                "spring.web.error.include-message", "management.endpoint.prometheus.access",
                "spring.datasource.driverClassName", "spring.jpa.properties.hibernate.jdbc.batch_size")) {
            assertNull(check(bound), bound);
        }
    }

    private static String check(String key) {
        if (key.startsWith(JPA_PROPERTIES)) {
            Boolean deprecated = HIBERNATE_SETTINGS.get(key.substring(JPA_PROPERTIES.length()));
            if (deprecated == null) {
                return "not a Hibernate/Jakarta Persistence setting";
            }
            return deprecated ? "deprecated Hibernate setting" : null;
        }
        String canonical = canonical(key);
        JsonNode entry = PROPERTIES.get(canonical);
        if (entry == null) {
            String mapProperty = MAP_PROPERTIES.stream()
                    .filter(name -> canonical.startsWith(name + "."))
                    .findFirst()
                    .orElse(null);
            if (mapProperty == null) {
                return "unknown property";
            }
            entry = PROPERTIES.get(mapProperty);
        }
        JsonNode deprecation = entry.path("deprecation");
        if ("error".equals(deprecation.path("level").asString(""))) {
            return "no longer supported, replacement: " + deprecation.path("replacement").asString("none");
        }
        return null;
    }

    /** The relaxed-binding canonical form: {@code driverClassName} -> {@code driver-class-name}. */
    private static String canonical(String key) {
        return key.replaceAll("([a-z0-9])([A-Z])", "$1-$2").toLowerCase(Locale.ROOT);
    }

    private static void loadMetadata(String resource) throws IOException {
        JsonMapper mapper = JsonMapper.shared();
        for (URL url : Collections.list(PropertyKeysMetadataTest.class.getClassLoader().getResources(resource))) {
            try (InputStream in = url.openStream()) {
                for (JsonNode property : mapper.readTree(in).path("properties")) {
                    String name = property.path("name").asString();
                    // additional-* metadata only adds fields (e.g. a deprecation) to an existing entry
                    PROPERTIES.merge(name, property, (a, b) -> a.path("deprecation").isMissingNode() ? b : a);
                    if (property.path("type").asString("").startsWith("java.util.Map<")) {
                        MAP_PROPERTIES.add(name);
                    }
                }
            }
        }
    }

    private static void addSettings(Class<?> settings) {
        for (Field field : settings.getFields()) {
            if (field.getType() == String.class && Modifier.isStatic(field.getModifiers())) {
                try {
                    HIBERNATE_SETTINGS.merge((String) field.get(null), field.isAnnotationPresent(Deprecated.class),
                            (a, b) -> a && b);
                } catch (IllegalAccessException e) {
                    throw new IllegalStateException(e);
                }
            }
        }
    }
}
