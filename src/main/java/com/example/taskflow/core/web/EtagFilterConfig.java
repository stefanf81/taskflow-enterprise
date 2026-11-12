package com.example.taskflow.core.web;

import jakarta.servlet.Filter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.filter.ShallowEtagHeaderFilter;

import java.io.InputStream;

/**
 * ETags for GET responses ({@link ShallowEtagHeaderFilter}), so a revalidated {@code Cache-Control}
 * tier answers {@code 304} when nothing changed. The tiers themselves are set by the controllers and
 * must stay aligned with the cache TTLs (see {@code docs/agents/backend.md}).
 */
@Configuration
class EtagFilterConfig {

    /** The admin dashboard's server-sent-event stream (see {@code AppointmentController}). */
    static final String EVENT_STREAM_PATH = "/api/v1/appointments/events";
    /** Actuator endpoints, relative to the context path (the default base path). */
    static final String ACTUATOR_PATH = "/actuator/";

    @Bean
    public Filter shallowEtagHeaderFilter() {
        return new ShallowEtagHeaderFilter() {
            /**
             * GET only, on top of Spring's own checks (uncommitted 2xx response without
             * {@code Cache-Control: no-store}): overriding them away gave error responses an ETag,
             * so a repeated failing GET could be answered 304 and keep a cached error alive.
             */
            @Override
            protected boolean isEligibleForEtag(HttpServletRequest request, HttpServletResponse response,
                                                int responseStatusCode, InputStream inputStream) {
                return "GET".equals(request.getMethod())
                        && super.isEligibleForEtag(request, response, responseStatusCode, inputStream);
            }

            /**
             * The filter buffers the whole body to hash it, so it must never see a stream: wrapped,
             * the SSE response sent nothing (not even headers) until it ended 30 minutes later, and
             * every open stream kept its events in memory. Actuator responses are skipped too: probes
             * and Prometheus scrapes never send {@code If-None-Match}, so buffering and hashing every
             * scrape body bought nothing.
             */
            @Override
            protected boolean shouldNotFilter(HttpServletRequest request) {
                String path = RateLimiterConfig.requestPath(request);
                String accept = request.getHeader("Accept");
                return path.endsWith(EVENT_STREAM_PATH)
                        || path.startsWith(ACTUATOR_PATH)
                        || (accept != null && accept.contains("text/event-stream"));
            }
        };
    }
}
