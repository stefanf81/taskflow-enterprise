package com.example.taskflow.core.web;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.test.context.runner.WebApplicationContextRunner;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** https://github.com/stefanf81/taskflow-enterprise/issues/219: the trusted-proxy regex and its symptom. */
class TrustedProxyConfigTest {

    private static final String COMPOSE_REGEX = "^172\\.30\\.0\\.\\d{1,3}$";

    @Test
    void theComposeValueCompilesAndMatchesTheProxySubnetOnly() {
        Pattern proxies = TrustedProxyConfig.trustedProxies(COMPOSE_REGEX);

        assertTrue(proxies.matcher("172.30.0.2").matches());
        assertTrue(!proxies.matcher("172.30.1.2").matches());
    }

    /** The YAML/env-file mistake: {@code \\.} reaches the JVM literally and never matches an address. */
    @Test
    void aDoubledBackslashIsRefused() {
        IllegalStateException e = assertThrows(IllegalStateException.class,
                () -> TrustedProxyConfig.trustedProxies("^172\\\\.30\\\\.0\\\\.\\\\d{1,3}$"));
        assertTrue(e.getMessage().contains("doubled backslash"), e.getMessage());
    }

    @Test
    void anEmptyOrInvalidValueIsRefused() {
        assertThrows(IllegalStateException.class, () -> TrustedProxyConfig.trustedProxies(null));
        assertThrows(IllegalStateException.class, () -> TrustedProxyConfig.trustedProxies("  "));
        IllegalStateException invalid = assertThrows(IllegalStateException.class,
                () -> TrustedProxyConfig.trustedProxies("^172\\.30\\.0\\.(\\d{1,3}$"));
        assertTrue(invalid.getMessage().contains("not a valid regular expression"), invalid.getMessage());
    }

    private static int run(TrustedProxyConfig.UntrustedForwardedForFilter filter, String peer, String forwardedFor)
            throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/catalog");
        request.setRemoteAddr(peer);
        if (forwardedFor != null) {
            request.addHeader("X-Forwarded-For", forwardedFor);
        }
        MockFilterChain chain = new MockFilterChain();
        filter.doFilter(request, new MockHttpServletResponse(), chain);
        return chain.getRequest() == null ? 0 : 1;
    }

    @Test
    void anXForwardedForTheValveDidNotConsumeIsCounted() throws Exception {
        SimpleMeterRegistry registry = new SimpleMeterRegistry();
        Counter counter = registry.counter(TrustedProxyConfig.UNTRUSTED_COUNTER);
        var filter = new TrustedProxyConfig.UntrustedForwardedForFilter(
                TrustedProxyConfig.trustedProxies(COMPOSE_REGEX), counter);

        // Correct setup: the valve consumed the header and the address is the client's.
        assertEquals(1, run(filter, "203.0.113.7", null));
        // The peer is the trusted proxy and the header is still there (a chain the valve kept): fine.
        assertEquals(1, run(filter, "172.30.0.2", "203.0.113.7"));
        // Multi-hop chain already processed by RemoteIpValve: remoteAddr is now the client IP,
        // upstream hops remain in X-Forwarded-For, and Globals.REQUEST_FORWARDED_ATTRIBUTE is set.
        MockHttpServletRequest multiHop = new MockHttpServletRequest("GET", "/api/v1/catalog");
        multiHop.setRemoteAddr("203.0.113.7");
        multiHop.addHeader("X-Forwarded-For", "198.51.100.4");
        multiHop.setAttribute(org.apache.catalina.Globals.REQUEST_FORWARDED_ATTRIBUTE, Boolean.TRUE);
        filter.doFilter(multiHop, new MockHttpServletResponse(), new MockFilterChain());
        assertEquals(0.0, counter.count());

        // The symptom: the proxy's address does not match the regex, so the header was ignored.
        assertEquals(1, run(filter, "10.42.0.15\r\nforged", "203.0.113.7"));
        assertEquals(1, run(filter, "10.42.0.15", "198.51.100.4"));
        assertEquals(2.0, counter.count(), "every such request is counted; the request itself goes on");
    }

    @Test
    void theFilterExistsOnlyWithTheNativeForwardedHeaderStrategy() {
        WebApplicationContextRunner runner = new WebApplicationContextRunner()
                .withUserConfiguration(TrustedProxyConfig.class)
                .withConfiguration(AutoConfigurations.of());

        runner.run(context -> assertTrue(context.getBeansOfType(
                org.springframework.boot.web.servlet.FilterRegistrationBean.class).isEmpty()));
        runner.withPropertyValues("server.forward-headers-strategy=native",
                        TrustedProxyConfig.PROXIES_PROPERTY + "=" + COMPOSE_REGEX)
                .run(context -> assertEquals(1, context.getBeansOfType(
                        org.springframework.boot.web.servlet.FilterRegistrationBean.class).size()));
        runner.withPropertyValues("server.forward-headers-strategy=native",
                        TrustedProxyConfig.PROXIES_PROPERTY + "=^172\\\\.30\\\\.0\\\\.\\\\d{1,3}$")
                .run(context -> assertTrue(context.getStartupFailure() != null,
                        "a doubled backslash must stop the start"));
    }
}
