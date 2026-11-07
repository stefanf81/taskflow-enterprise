package com.example.taskflow.core.telemetry;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertEquals;

class ClientTelemetryControllerTest {

    @Test
    void recordsAllowlistedPerformanceAndErrorMetricsAndRejectsMalformedPayloads() {
        SimpleMeterRegistry registry = new SimpleMeterRegistry();
        ClientTelemetryController controller = new ClientTelemetryController(registry);

        MockHttpServletRequest lcpReq = new MockHttpServletRequest("POST", "/api/v1/telemetry");
        lcpReq.setContentType("application/json");
        lcpReq.setContent("{\"platform\":\"WEB\",\"route\":\"LANDING\",\"name\":\"LCP\",\"value\":1240.5}"
                .getBytes(StandardCharsets.UTF_8));
        var lcpRes = controller.record(lcpReq);
        assertEquals(204, lcpRes.getStatusCode().value());
        assertEquals("no-store", lcpRes.getHeaders().getCacheControl());
        assertEquals(1L, registry.get("taskflow.client.performance")
                .tags("platform", "WEB", "route", "LANDING", "name", "LCP").summary().count());

        MockHttpServletRequest errReq = new MockHttpServletRequest("POST", "/api/v1/telemetry");
        errReq.setContentType("application/json");
        errReq.setContent("{\"platform\":\"MOBILE\",\"route\":\"BOOKING\",\"name\":\"RENDER_ERROR\",\"value\":0}"
                .getBytes(StandardCharsets.UTF_8));
        assertEquals(204, controller.record(errReq).getStatusCode().value());
        assertEquals(1.0, registry.get("taskflow.client.errors")
                .tags("platform", "MOBILE", "route", "BOOKING", "name", "RENDER_ERROR").counter().count());

        // Unknown property or non-zero error value is rejected with 400 and no body.
        MockHttpServletRequest extraField = new MockHttpServletRequest("POST", "/api/v1/telemetry");
        extraField.setContent("{\"platform\":\"WEB\",\"route\":\"LANDING\",\"name\":\"LCP\",\"value\":100,\"url\":\"/secret\"}"
                .getBytes(StandardCharsets.UTF_8));
        assertEquals(400, controller.record(extraField).getStatusCode().value());

        // Oversized payload is rejected with 413.
        MockHttpServletRequest huge = new MockHttpServletRequest("POST", "/api/v1/telemetry");
        huge.setContent("x".repeat(ClientTelemetryController.MAX_BODY_BYTES + 10).getBytes(StandardCharsets.UTF_8));
        assertEquals(413, controller.record(huge).getStatusCode().value());
    }
}
