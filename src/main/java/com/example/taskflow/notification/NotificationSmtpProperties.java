package com.example.taskflow.notification;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import org.jspecify.annotations.Nullable;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.validation.annotation.Validated;

/** Validated only when SMTP is explicitly selected. Timeouts cannot be infinite or unbounded. */
@Validated
@ConfigurationProperties("app.notification.smtp")
record NotificationSmtpProperties(
        @NotBlank String host,
        @Min(1) @Max(65535) @DefaultValue("587") int port,
        @NotBlank @Email String from,
        @Nullable String username,
        @Nullable String password,
        @DefaultValue("true") boolean startTls,
        @DefaultValue("false") boolean ssl,
        @Min(1) @Max(10000) @DefaultValue("5000") int connectTimeoutMs,
        @Min(1) @Max(10000) @DefaultValue("5000") int readTimeoutMs,
        @Min(1) @Max(10000) @DefaultValue("5000") int writeTimeoutMs) {

    @Override
    public String toString() {
        return "NotificationSmtpProperties[redacted]";
    }
}
