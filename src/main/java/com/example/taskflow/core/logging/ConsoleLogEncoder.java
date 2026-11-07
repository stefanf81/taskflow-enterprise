package com.example.taskflow.core.logging;

import ch.qos.logback.classic.encoder.PatternLayoutEncoder;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.encoder.Encoder;
import ch.qos.logback.core.encoder.EncoderBase;
import org.springframework.boot.logging.logback.StructuredLogEncoder;

import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;

/**
 * The console encoder of {@code logback-spring.xml}: Spring Boot's structured (JSON) encoder when
 * {@code logging.structured.format.console} is set (ecs, logstash, gelf or a formatter class),
 * otherwise the plain pattern. A custom Logback file must choose its encoder itself; setting the
 * property alone does not replace a pattern encoder, and Logback has no conditionals without
 * Janino. Opt-in, so a deployment's log parsing never changes format by surprise.
 */
public class ConsoleLogEncoder extends EncoderBase<ILoggingEvent> {

    private String format = "";
    private String pattern = "%msg%n";
    private Charset charset = StandardCharsets.UTF_8;
    private Encoder<ILoggingEvent> delegate;

    public void setFormat(String format) {
        this.format = format == null ? "" : format.strip();
    }

    public void setPattern(String pattern) {
        this.pattern = pattern;
    }

    public void setCharset(Charset charset) {
        this.charset = charset;
    }

    /** Whether events are written as structured JSON (for tests and diagnostics). */
    public boolean isStructured() {
        return delegate instanceof StructuredLogEncoder;
    }

    @Override
    public void start() {
        if (!format.isEmpty()) {
            StructuredLogEncoder structured = new StructuredLogEncoder();
            structured.setContext(getContext());
            structured.setFormat(format);
            structured.setCharset(charset);
            structured.start();
            delegate = structured;
        } else {
            PatternLayoutEncoder plain = new PatternLayoutEncoder();
            plain.setContext(getContext());
            plain.setPattern(pattern);
            plain.setCharset(charset);
            plain.start();
            delegate = plain;
        }
        super.start();
    }

    @Override
    public void stop() {
        if (delegate != null) {
            delegate.stop();
        }
        super.stop();
    }

    @Override
    public byte[] headerBytes() {
        return delegate.headerBytes();
    }

    @Override
    public byte[] encode(ILoggingEvent event) {
        return delegate.encode(event);
    }

    @Override
    public byte[] footerBytes() {
        return delegate.footerBytes();
    }
}
