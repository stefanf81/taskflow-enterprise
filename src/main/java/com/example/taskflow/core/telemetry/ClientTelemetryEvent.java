package com.example.taskflow.core.telemetry;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;

/** Deliberately no free text, identifiers, URLs, timestamps, exceptions or session IDs. */
public record ClientTelemetryEvent(
        @NotNull Platform platform,
        @NotNull Route route,
        @NotNull Name name,
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED) @DecimalMin("0.0") @DecimalMax("600000.0") double value) {
    public enum Platform { WEB, MOBILE }
    public enum Route { LANDING, BOOKING, CUSTOMER, ADMIN, AUTH, OTHER }
    public enum Name { LCP, FCP, CLS, INP, SCREEN_LOAD, JS_ERROR, UNHANDLED_REJECTION, RENDER_ERROR }

    public ClientTelemetryEvent {
        if (platform == null || route == null || name == null || !Double.isFinite(value)
                || value < 0 || value > (name == Name.CLS ? 10 : 600_000)
                || (isError(name) && value != 0)) {
            throw new IllegalArgumentException("Invalid telemetry event");
        }
    }

    static boolean isError(Name name) {
        return name == Name.JS_ERROR || name == Name.UNHANDLED_REJECTION || name == Name.RENDER_ERROR;
    }
}
