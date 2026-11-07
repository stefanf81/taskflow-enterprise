package com.example.taskflow.core.telemetry;

import io.micrometer.core.instrument.MeterRegistry;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.cfg.EnumFeature;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;

/**
 * Anonymous, untrusted measurements, not an audit trail or billing signal. The existing API
 * rate-limit filter also covers this path. The public POST still needs an explicit security rule;
 * the handler never uses cookies or authentication and never mutates customer state. Anonymous
 * native reporting needs the same explicit CSRF exemption as the other public guest POSTs.
 */
@RestController
class ClientTelemetryController {
    static final int MAX_BODY_BYTES = 1024;
    private final MeterRegistry meters;
    // Do not route malformed input through the global JSON error logger (it may include the
    // offending value). A private strict reader plus empty errors is the privacy boundary.
    private final JsonMapper reader = JsonMapper.builder()
            .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .enable(DeserializationFeature.FAIL_ON_MISSING_CREATOR_PROPERTIES)
            .enable(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES)
            .enable(EnumFeature.FAIL_ON_NUMBERS_FOR_ENUMS)
            .disable(tools.jackson.databind.MapperFeature.ALLOW_COERCION_OF_SCALARS)
            .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
            .build();

    ClientTelemetryController(MeterRegistry meters) {
        this.meters = meters;
    }

    @Operation(summary = "Record one anonymous, allowlisted client measurement", requestBody =
            @io.swagger.v3.oas.annotations.parameters.RequestBody(required = true,
                    content = @Content(schema = @Schema(implementation = ClientTelemetryEvent.class))))
    @PostMapping(path = "/api/v1/telemetry", consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<Void> record(HttpServletRequest request) {
        try {
            byte[] body = request.getInputStream().readNBytes(MAX_BODY_BYTES + 1);
            if (body.length > MAX_BODY_BYTES) {
                return empty(413);
            }
            ClientTelemetryEvent event = reader.readValue(body, ClientTelemetryEvent.class);
            if (event == null) {
                return empty(400);
            }
            String[] tags = { "platform", event.platform().name(), "route", event.route().name(),
                    "name", event.name().name() };
            if (ClientTelemetryEvent.isError(event.name())) {
                meters.counter("taskflow.client.errors", tags).increment();
            } else {
                // DistributionSummary keeps CLS unitless and other measurements in milliseconds.
                // No client-controlled tag names/values, no per-user cardinality and no payload logs.
                meters.summary("taskflow.client.performance", tags).record(event.value());
            }
            return empty(204);
        } catch (IOException | RuntimeException ignored) {
            // Never echo/log parser messages, input, headers, cookies, URLs or exceptions.
            return empty(400);
        }
    }

    private static ResponseEntity<Void> empty(int status) {
        return ResponseEntity.status(status).cacheControl(CacheControl.noStore()).build();
    }
}
