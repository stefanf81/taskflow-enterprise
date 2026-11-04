package com.example.taskflow.core.web;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Metrics;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.core.env.Environment;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;

/**
 * Guards the trusted-proxy setting behind the rate limiter
 * (https://github.com/stefanf81/taskflow-enterprise/issues/219).
 *
 * <p>With {@code server.forward-headers-strategy=native} (the prod profile) Tomcat's
 * {@code RemoteIpValve} takes the client address from {@code X-Forwarded-For} only when the peer
 * matches {@code server.tomcat.remoteip.internal-proxies} ({@code APP_TRUSTED_PROXY_REGEX}). When it
 * matches nothing, nothing fails: every request simply carries the proxy's address, and all clients
 * share one rate-limit bucket. The classic cause is a regex written with doubled backslashes in YAML
 * or an env file ({@code \\.} reaches the JVM as a literal backslash plus any character).
 *
 * <ul>
 *   <li><b>At startup</b> the value must be set, compile, and contain no doubled backslash; otherwise
 *       the application does not start.</li>
 *   <li><b>At runtime</b> the address cannot be checked in advance (the proxy's address is only known
 *       when it connects), so a filter watches for the symptom: a request that still carries
 *       {@code X-Forwarded-For} although its peer is not a trusted proxy. The valve removes the header
 *       it consumed, so this only happens when the peer was not trusted: a misconfigured regex, or a
 *       client reaching the backend directly. The first one is logged at WARN with the peer address,
 *       and every one is counted ({@value #UNTRUSTED_COUNTER} in {@code /actuator/prometheus}).</li>
 * </ul>
 */
@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = "server.forward-headers-strategy", havingValue = "native")
class TrustedProxyConfig {

    static final String PROXIES_PROPERTY = "server.tomcat.remoteip.internal-proxies";
    static final String UNTRUSTED_COUNTER = "taskflow.proxy.untrusted.forwarded";
    private static final String FORWARDED_FOR = "X-Forwarded-For";

    private static final Logger log = LoggerFactory.getLogger(TrustedProxyConfig.class);

    /** Compiles the configured regex or refuses the start; see the class comment. */
    static Pattern trustedProxies(String regex) {
        if (regex == null || regex.isBlank()) {
            throw new IllegalStateException(PROXIES_PROPERTY + " (APP_TRUSTED_PROXY_REGEX) is empty: Tomcat would "
                    + "trust no proxy and every client would share one rate-limit bucket.");
        }
        if (regex.contains("\\\\")) {
            throw new IllegalStateException(PROXIES_PROPERTY + " (APP_TRUSTED_PROXY_REGEX) contains a doubled "
                    + "backslash, so it matches a literal backslash and never the proxy's address. Write single "
                    + "backslashes in YAML and env files, e.g. ^172\\.30\\.0\\.\\d{1,3}$");
        }
        try {
            return Pattern.compile(regex);
        } catch (PatternSyntaxException e) {
            throw new IllegalStateException(PROXIES_PROPERTY + " (APP_TRUSTED_PROXY_REGEX) is not a valid "
                    + "regular expression: " + e.getDescription(), e);
        }
    }

    @Bean
    FilterRegistrationBean<OncePerRequestFilter> untrustedForwardedForFilter(
            Environment environment, ObjectProvider<MeterRegistry> registry) {
        Pattern proxies = trustedProxies(environment.getProperty(PROXIES_PROPERTY));
        Counter counter = Counter.builder(UNTRUSTED_COUNTER)
                .description("Requests with X-Forwarded-For from a peer that is not a trusted proxy")
                .register(registry.getIfAvailable(() -> Metrics.globalRegistry));
        FilterRegistrationBean<OncePerRequestFilter> registration =
                new FilterRegistrationBean<>(new UntrustedForwardedForFilter(proxies, counter));
        // Before the rate limiter (HIGHEST_PRECEDENCE + 20), which keys on the same address.
        registration.setOrder(Ordered.HIGHEST_PRECEDENCE + 10);
        registration.addUrlPatterns("/*");
        return registration;
    }

    static final class UntrustedForwardedForFilter extends OncePerRequestFilter {

        private final Pattern proxies;
        private final Counter counter;
        private final AtomicBoolean warned = new AtomicBoolean();

        UntrustedForwardedForFilter(Pattern proxies, Counter counter) {
            this.proxies = proxies;
            this.counter = counter;
        }

        @Override
        protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                        FilterChain chain) throws ServletException, IOException {
            String peer = request.getRemoteAddr();
            if (request.getHeader(FORWARDED_FOR) != null && peer != null && !proxies.matcher(peer).matches()) {
                counter.increment();
                if (warned.compareAndSet(false, true)) {
                    log.warn("A request from {} carried X-Forwarded-For, but {} does not match that peer, so its "
                                    + "client address was ignored. If {} is the reverse proxy, APP_TRUSTED_PROXY_REGEX is "
                                    + "wrong and every client shares one rate-limit bucket (logged once; counted in {}).",
                            peer, PROXIES_PROPERTY, peer, UNTRUSTED_COUNTER);
                }
            }
            chain.doFilter(request, response);
        }
    }
}
