package com.example.taskflow.core.telemetry;

/** Deliberately no free text, identifiers, URLs, timestamps, exceptions or session IDs. */
public record ClientTelemetryEvent(Platform platform, Route route, Name name, double value) {
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
