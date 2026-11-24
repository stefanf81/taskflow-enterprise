package com.example.taskflow.core.logging;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.LoggerContext;
import ch.qos.logback.classic.spi.LoggingEvent;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;
import org.junit.jupiter.api.Test;
import org.springframework.core.env.Environment;
import org.springframework.core.env.StandardEnvironment;

class ConsoleLogEncoderTest {

    private static LoggingEvent event(LoggerContext context) {
        LoggingEvent event = new LoggingEvent(
                ConsoleLogEncoderTest.class.getName(), context.getLogger("test"), Level.INFO, "hello", null, null);
        // A bare LoggerContext has no MDC adapter; the structured formatter reads the MDC.
        event.setMDCPropertyMap(java.util.Map.of());
        return event;
    }

    @Test
    void writesThePlainPatternWhenNoStructuredFormatIsConfigured() {
        LoggerContext context = new LoggerContext();
        ConsoleLogEncoder encoder = new ConsoleLogEncoder();
        encoder.setContext(context);
        encoder.setFormat("   ");
        encoder.setPattern("%level %msg%n");
        encoder.start();

        assertFalse(encoder.isStructured());
        String line = new String(encoder.encode(event(context)), StandardCharsets.UTF_8);
        assertTrue(line.startsWith("INFO hello"), line);
    }

    @Test
    void writesJsonOnlyWhenAStructuredFormatIsConfigured() {
        LoggerContext context = new LoggerContext();
        // Boot's LogbackLoggingSystem registers the Environment; the structured encoder reads it.
        context.putObject(Environment.class.getName(), new StandardEnvironment());
        ConsoleLogEncoder encoder = new ConsoleLogEncoder();
        encoder.setContext(context);
        encoder.setFormat("logstash");
        encoder.setPattern("%msg%n");
        encoder.start();

        assertTrue(encoder.isStructured());
        String line = new String(encoder.encode(event(context)), StandardCharsets.UTF_8);
        assertTrue(line.startsWith("{") && line.contains("\"message\":\"hello\""), line);
    }

    /**
     * The format is chosen by property, not by a Logback profile: the prod profile defaults to ECS
     * JSON, everything else (bootRun, tests; the compose stack by an override that
     * ContainerConfigGuardTest pins) keeps the plain pattern, and
     * LOGGING_STRUCTURED_FORMAT_CONSOLE overrides both (empty = plain, the rollback lever).
     */
    @Test
    void prodProfileDefaultsToEcsJsonWhileTheDefaultProfileKeepsThePattern() throws Exception {
        String xml = Files.readString(Path.of("src/main/resources/logback-spring.xml"));
        assertTrue(
                xml.contains("source=\"logging.structured.format.console\"") && xml.contains("defaultValue=\"\""),
                "the structured format must default to empty (plain pattern)");
        assertTrue(xml.contains("class=\"com.example.taskflow.core.logging.ConsoleLogEncoder\""));
        assertFalse(xml.contains("<springProfile"), "the console format must not depend on a Logback profile");

        assertEquals(
                "ecs",
                properties("application-prod.properties").getProperty("logging.structured.format.console"),
                "production writes Elastic Common Schema JSON; the homelab Alloy pipeline expects it");
        assertNull(
                properties("application.properties").getProperty("logging.structured.format.console"),
                "the default profile keeps the plain pattern");
    }

    /**
     * CWE-117: a message or exception message carrying a CR/LF and a date must not produce a second
     * record. The plain pattern prints it raw; the ECS encoder must keep the whole event on one line
     * and return the text unchanged inside JSON strings.
     */
    @Test
    void ecsJsonKeepsInjectedLineBreaksInsideOneRecord() throws Exception {
        LoggerContext context = new LoggerContext();
        context.putObject(Environment.class.getName(), new StandardEnvironment());
        ConsoleLogEncoder encoder = new ConsoleLogEncoder();
        encoder.setContext(context);
        encoder.setFormat("ecs");
        encoder.start();

        String forged = "2026-11-21 10:00:00.000 [main] [,] INFO  c.e.t.auth.AuthController - admin logged in";
        String message = "lookup failed for user x\n" + forged + "\r\n" + forged;
        LoggingEvent event = new LoggingEvent(
                ConsoleLogEncoderTest.class.getName(),
                context.getLogger("test"),
                Level.WARN,
                message,
                new IllegalStateException("bad input\n" + forged),
                null);
        event.setMDCPropertyMap(
                java.util.Map.of("traceId", "4bf92f3577b34da6a3ce929d0e0e4736", "spanId", "00f067aa0ba902b7"));
        String line = new String(encoder.encode(event), StandardCharsets.UTF_8);

        assertTrue(
                line.endsWith("\n") && line.indexOf('\n') == line.length() - 1 && line.indexOf('\r') < 0,
                "one physical line per record: " + line);
        JsonNode json = new ObjectMapper().readTree(line);
        assertEquals(message, json.path("message").asText());
        assertEquals("WARN", json.path("log").path("level").asText());
        assertEquals("4bf92f3577b34da6a3ce929d0e0e4736", json.path("traceId").asText());
        assertEquals(
                "java.lang.IllegalStateException",
                json.path("error").path("type").asText());
        assertEquals("bad input\n" + forged, json.path("error").path("message").asText());
        assertTrue(json.path("error").path("stack_trace").asText().contains("\n\tat "), "stack trace kept, escaped");
    }

    private static Properties properties(String resource) throws Exception {
        Properties properties = new Properties();
        try (var reader = Files.newBufferedReader(Path.of("src/main/resources", resource), StandardCharsets.UTF_8)) {
            properties.load(reader);
        }
        return properties;
    }
}
