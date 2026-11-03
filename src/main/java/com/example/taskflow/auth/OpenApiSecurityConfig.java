package com.example.taskflow.auth;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.Operation;
import io.swagger.v3.oas.models.PathItem;
import io.swagger.v3.oas.models.media.Content;
import io.swagger.v3.oas.models.media.MediaType;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Documents how the API authenticates: the web app sends the HttpOnly {@code access_token} cookie
 * (ADR-005), the mobile app a bearer token (ADR-007); either one satisfies an operation. Operations
 * that {@link SecurityConfig} lets anyone call get {@code security: []}.
 *
 * <p>{@link #PUBLIC_OPERATIONS} restates the {@code permitAll()} rules of {@link SecurityConfig} for
 * the documented operations; {@code OpenApiSecurityDocumentationTest} calls every documented
 * operation anonymously against the real filter chain and fails when this list and the chain
 * disagree, so the spec cannot drift from the rules.
 *
 * <p>This also documents every 401/403 body: on a public operation they come from a handler and carry
 * the {@code ErrorResponse} body (a failed login), on one that needs authentication the filter chain
 * answers them before any controller runs, without a body.
 */
@Configuration(proxyBeanMethods = false)
class OpenApiSecurityConfig {

    static final String COOKIE_AUTH = "cookieAuth";
    static final String BEARER_AUTH = "bearerAuth";

    /** {@code "METHOD /path/template"} of every documented operation open to anonymous callers. */
    static final Set<String> PUBLIC_OPERATIONS = Set.of(
            "GET /api/v1/auth/csrf",
            "POST /api/v1/auth/login",
            "POST /api/v1/auth/mobile/login",
            "POST /api/v1/auth/register",
            "POST /api/v1/auth/logout",
            "GET /api/v1/appointments/public/busy-slots",
            "GET /api/v1/appointments/public/shop",
            "PUT /api/v1/appointments/public/cancel/{publicId}",
            "POST /api/v1/appointments",
            "GET /api/v1/catalog",
            "GET /api/v1/catalog/{id}",
            "GET /api/v1/barbers",
            "GET /api/v1/reviews/public/barber-ratings",
            "POST /api/v1/reviews/public/{publicId}");

    @Bean
    OpenApiCustomizer securityRequirements() {
        return OpenApiSecurityConfig::documentSecurity;
    }

    /** The body {@code GlobalExceptionHandler} writes (its schema is registered by core's error customizer). */
    private static Content handlerErrorContent() {
        return new Content().addMediaType(org.springframework.http.MediaType.APPLICATION_JSON_VALUE,
                new MediaType().schema(new Schema<>().$ref("#/components/schemas/ErrorResponse")));
    }

    static void documentSecurity(OpenAPI openApi) {
        if (openApi.getComponents() == null) {
            openApi.setComponents(new Components());
        }
        openApi.getComponents()
                .addSecuritySchemes(COOKIE_AUTH, new SecurityScheme()
                        .type(SecurityScheme.Type.APIKEY)
                        .in(SecurityScheme.In.COOKIE)
                        .name("access_token")
                        .description("HttpOnly JWT cookie set by POST /api/v1/auth/login (web)."))
                .addSecuritySchemes(BEARER_AUTH, new SecurityScheme()
                        .type(SecurityScheme.Type.HTTP)
                        .scheme("bearer")
                        .bearerFormat("JWT")
                        .description("Token returned by POST /api/v1/auth/mobile/login (mobile)."));
        // Two alternatives: either scheme authenticates.
        openApi.setSecurity(List.of(
                new SecurityRequirement().addList(COOKIE_AUTH),
                new SecurityRequirement().addList(BEARER_AUTH)));
        if (openApi.getPaths() == null) {
            return;
        }
        openApi.getPaths().forEach((path, item) -> {
            for (Map.Entry<PathItem.HttpMethod, Operation> entry : item.readOperationsMap().entrySet()) {
                Operation operation = entry.getValue();
                boolean isPublic = PUBLIC_OPERATIONS.contains(entry.getKey() + " " + path);
                if (isPublic) {
                    operation.setSecurity(List.of());
                }
                if (operation.getResponses() != null) {
                    operation.getResponses().forEach((code, response) -> {
                        if ("401".equals(code) || "403".equals(code)) {
                            response.setContent(isPublic ? handlerErrorContent() : null);
                        }
                    });
                }
            }
        });
    }
}
