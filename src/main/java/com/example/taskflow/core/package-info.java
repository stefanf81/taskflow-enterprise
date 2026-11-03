/**
 * Shared kernel. Depends on no other module.
 *
 * <ul>
 *   <li>Base package (the API every module may use): {@link com.example.taskflow.core.DomainException}
 *       and its {@code ConflictException}/{@code ResourceNotFoundException}, {@code LogSanitizer},
 *       the shop {@code Clock} ({@code ClockConfig}, {@code app.shop.*}), the bounded async executor
 *       ({@code AsyncConfig}, ADR-010), {@code SharedStateStore}, {@code FixedWindowCounter}, the
 *       {@code app.schedulers.*} switch and the Clock-based entity timestamps.</li>
 *   <li>{@code core.cache} (named interface {@code cache}): cache managers, serializers, fail-open handling.</li>
 *   <li>{@code core.redis} (named interface {@code redis}): Redis back-off and connection recovery.</li>
 *   <li>{@code core.web} (internal): exception handler, ETag filter, rate limiter, OpenAPI customizer.</li>
 * </ul>
 */
@ApplicationModule(allowedDependencies = {})
package com.example.taskflow.core;

import org.springframework.modulith.ApplicationModule;
