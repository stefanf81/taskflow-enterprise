/**
 * Best-effort Redis use: {@link com.example.taskflow.core.redis.RedisBackoff} (skip Redis for a while
 * after a failure, one probe per interval), {@link com.example.taskflow.core.redis.RedisConnectionRecovery}
 * (replace the shared connection after repeated command timeouts) and the Lettuce keepalive settings.
 * Named interface {@code redis}: the auth module's shared security state builds on it.
 */
@NamedInterface("redis")
package com.example.taskflow.core.redis;

import org.springframework.modulith.NamedInterface;
