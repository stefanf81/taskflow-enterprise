package com.example.taskflow.auth;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * The auth and CSRF cookies, bound from {@code app.cookie.*}.
 *
 * <ul>
 *   <li>{@code secure} (default {@code true}; {@code false} for local http): the {@code Secure}
 *       flag. {@code HttpOnly} and {@code SameSite=Strict} are always set in code.</li>
 * </ul>
 */
@ConfigurationProperties(prefix = "app.cookie")
record CookieProperties(@DefaultValue("true") boolean secure) {
}
