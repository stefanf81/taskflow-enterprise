/**
 * Shared kernel: errors, clock, caching infrastructure (single-flight, Redis back-off, fail-open),
 * async executor and rate limiter. Depends on no other module.
 */
@ApplicationModule(allowedDependencies = {})
package com.example.taskflow.core;

import org.springframework.modulith.ApplicationModule;
