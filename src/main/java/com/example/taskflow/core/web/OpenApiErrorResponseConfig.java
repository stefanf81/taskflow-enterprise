package com.example.taskflow.core.web;

import io.swagger.v3.core.converter.ModelConverters;
import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.media.Content;
import io.swagger.v3.oas.models.media.MediaType;
import io.swagger.v3.oas.models.media.Schema;
import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Documents the body of every error response as {@link ErrorResponse}, the shape
 * {@link GlobalExceptionHandler} writes. Springdoc otherwise reuses the operation's success type
 * for a declared {@code @ApiResponse(responseCode = "4xx")}, so the spec claimed a failed booking
 * returned an {@code AppointmentResponse}.
 *
 * <p>401 and 403 are left to {@code OpenApiSecurityConfig} (auth): only it knows whether an operation
 * is public, where they come from a handler with this body, or protected, where the security
 * filter chain answers them without one. Springdoc does not order customizers, so neither relies
 * on the other having run.
 */
@Configuration(proxyBeanMethods = false)
class OpenApiErrorResponseConfig {

    static final String ERROR_SCHEMA = "ErrorResponse";

    @Bean
    OpenApiCustomizer errorResponseBodies() {
        return OpenApiErrorResponseConfig::documentErrorBodies;
    }

    @SuppressWarnings("rawtypes")
    static void documentErrorBodies(OpenAPI openApi) {
        if (openApi.getComponents() == null) {
            openApi.setComponents(new Components());
        }
        // The 3.1 converters, like springdoc's own for this OpenAPI 3.1 document.
        java.util.Map<String, Schema> errorSchemas = ModelConverters.getInstance(true).readAll(ErrorResponse.class);
        errorSchemas.forEach(openApi.getComponents()::addSchemas);
        if (openApi.getPaths() == null) {
            return;
        }
        // The 401/403 of an operation are documented by OpenApiSecurityConfig (see class comment).
        // POST /api/v1/telemetry intentionally returns empty 400/413 responses as a privacy boundary.
        openApi.getPaths().forEach((pathName, path) -> path.readOperationsMap().forEach((method, operation) -> {
            if (operation.getResponses() == null) {
                return;
            }
            boolean emptyTelemetryError = "/api/v1/telemetry".equals(pathName)
                    && method == io.swagger.v3.oas.models.PathItem.HttpMethod.POST;
            operation.getResponses().forEach((code, response) -> {
                if ((code.startsWith("4") || code.startsWith("5")) && !"401".equals(code) && !"403".equals(code)) {
                    response.setContent(emptyTelemetryError ? null : errorContent());
                }
            });
        }));
        // Required fields as for every response record, independent of the customizers' order.
        OpenApiResponseNullabilityConfig.markRequired(openApi, java.util.Map.of(
                ERROR_SCHEMA, ErrorResponse.class,
                "ValidationError", ErrorResponse.ValidationError.class));
    }

    private static Content errorContent() {
        return new Content().addMediaType(org.springframework.http.MediaType.APPLICATION_JSON_VALUE,
                new MediaType().schema(new Schema<>().$ref("#/components/schemas/" + ERROR_SCHEMA)));
    }
}
