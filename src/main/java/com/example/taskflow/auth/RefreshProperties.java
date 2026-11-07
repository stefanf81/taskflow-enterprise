package com.example.taskflow.auth;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.validation.annotation.Validated;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

/**
 * Refresh sessions, bound from {@code app.auth.refresh.*}.
 *
 * <ul>
 *   <li>{@code customer-lifetime-seconds} / {@code admin-lifetime-seconds}: the fixed deadline of a
 *       login's session family; rotation never extends it.</li>
 *   <li>{@code reuse-grace-seconds} (default 30): how long a just-used credential may be presented
 *       again (a second tab renewing at the same moment, or a retry after a lost response) and get
 *       a further credential of the same family. Later reuse is treated as theft and revokes the
 *       whole family. 0 disables the grace window.</li>
 * </ul>
 */
@Validated
@ConfigurationProperties("app.auth.refresh")
record RefreshProperties(@DefaultValue("2592000") @Min(1) long customerLifetimeSeconds,
                         @DefaultValue("28800") @Min(1) long adminLifetimeSeconds,
                         @DefaultValue("30") @Min(0) @Max(300) long reuseGraceSeconds) {}
