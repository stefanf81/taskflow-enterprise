package com.example.taskflow.auth;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * Registers the auth module's {@code app.*} properties. The admin account itself is configured with
 * Spring Boot's own {@code spring.security.user.*} keys, which Boot binds already, so they are read
 * where they are used instead of being bound a second time here.
 */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties({
        JwtProperties.class,
        RsaKeyProperties.class,
        CookieProperties.class,
        CorsProperties.class,
        LoginThrottleProperties.class,
        MetricsProperties.class})
class AuthPropertiesConfig {
}
