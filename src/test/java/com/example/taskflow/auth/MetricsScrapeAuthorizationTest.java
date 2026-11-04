package com.example.taskflow.auth;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.web.access.intercept.RequestAuthorizationContext;

import static org.assertj.core.api.Assertions.assertThat;

class MetricsScrapeAuthorizationTest {

    private static boolean granted(MetricsScrapeAuthorization manager, String authorization) {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/actuator/prometheus");
        if (authorization != null) {
            request.addHeader("Authorization", authorization);
        }
        return manager.authorize(() -> null, new RequestAuthorizationContext(request)).isGranted();
    }

    @Test
    void withoutATokenTheEndpointStaysOpen() {
        for (String blank : new String[] {null, "", "   "}) {
            MetricsScrapeAuthorization manager = new MetricsScrapeAuthorization(blank);
            assertThat(manager.protectsTheEndpoint()).isFalse();
            assertThat(granted(manager, null)).isTrue();
        }
    }

    @Test
    void withATokenOnlyTheExactBearerValueIsGranted() {
        MetricsScrapeAuthorization manager = new MetricsScrapeAuthorization(" s3cret ");
        assertThat(manager.protectsTheEndpoint()).isTrue();
        assertThat(granted(manager, "Bearer s3cret")).isTrue();
        assertThat(granted(manager, "bearer s3cret")).isTrue();
        assertThat(granted(manager, "Bearer  s3cret ")).isTrue();
        assertThat(granted(manager, null)).isFalse();
        assertThat(granted(manager, "s3cret")).isFalse();
        assertThat(granted(manager, "Bearer S3CRET")).isFalse();
        assertThat(granted(manager, "Bearer s3cre")).isFalse();
        assertThat(granted(manager, "Bearer s3crets")).isFalse();
        assertThat(granted(manager, "Basic s3cret")).isFalse();
        assertThat(granted(manager, "Bearer")).isFalse();
    }
}
