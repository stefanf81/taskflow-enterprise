/**
 * Cache infrastructure: the Redis cache manager decorators (single-flight loads with a cross-replica
 * lease, Redis back-off), the fail-open cache error handler and the typed per-cache serializers.
 * {@link com.example.taskflow.core.cache.CacheConfig}'s static helpers are the named interface
 * {@code cache} that feature modules use to register their own caches.
 */
@NamedInterface("cache")
package com.example.taskflow.core.cache;

import org.springframework.modulith.NamedInterface;
