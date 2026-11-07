package com.example.taskflow.core.logging;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.LoggerContext;
import ch.qos.logback.classic.spi.LoggingEvent;
import org.junit.jupiter.api.Test;
import org.springframework.core.env.Environment;
import org.springframework.core.env.StandardEnvironment;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ConsoleLogEncoderTest {

    private static LoggingEvent event(LoggerContext context) {
        LoggingEvent event = new LoggingEvent(ConsoleLogEncoderTest.class.getName(), context.getLogger("test"),
                Level.INFO, "hello", null, null);
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

    /** Production's log format must not change unless the deployment asks for JSON. */
    @Test
    void logbackConfigurationKeepsThePatternUnlessTheFormatPropertyIsSet() throws Exception {
        String xml = Files.readString(Path.of("src/main/resources/logback-spring.xml"));
        assertTrue(xml.contains("source=\"logging.structured.format.console\"") && xml.contains("defaultValue=\"\""),
                "the structured format must default to empty (plain pattern)");
        assertTrue(xml.contains("class=\"com.example.taskflow.core.logging.ConsoleLogEncoder\""));
        assertFalse(xml.contains("<springProfile"), "the console format must not depend on the profile");
    }
}
