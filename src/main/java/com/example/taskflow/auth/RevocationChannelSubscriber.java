package com.example.taskflow.auth;

import com.example.taskflow.core.RedisBackoff;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;

/**
 * Starts the token-revocation pub/sub subscription once the application is ready, on a background
 * virtual thread, and keeps retrying (every {@link #RETRY_MILLIS}) while Redis is unreachable.
 *
 * <p>Starting the listener container as an ordinary lifecycle bean would make startup wait for —
 * and possibly fail on — Redis. Revocations themselves do not depend on the subscription (they are
 * checked in Redis on every request); it only lets other replicas close admin event streams at once.
 * Once subscribed, Lettuce re-subscribes by itself after a reconnect.
 */
final class RevocationChannelSubscriber implements DisposableBean {

    static final long RETRY_MILLIS = 30_000;

    private final RedisMessageListenerContainer container;
    private final RedisBackoff backoff = new RedisBackoff("Token revocation channel", RETRY_MILLIS,
            System::currentTimeMillis);
    private final long retryMillis;
    private volatile Thread worker;
    private volatile boolean stopped;

    RevocationChannelSubscriber(RedisMessageListenerContainer container) {
        this(container, RETRY_MILLIS);
    }

    RevocationChannelSubscriber(RedisMessageListenerContainer container, long retryMillis) {
        this.container = container;
        this.retryMillis = retryMillis;
    }

    @EventListener(ApplicationReadyEvent.class)
    void subscribe() {
        if (worker == null && !stopped) {
            worker = Thread.ofVirtual().name("token-revocation-subscriber").start(this::subscribeUntilListening);
        }
    }

    void subscribeUntilListening() {
        while (!stopped) {
            try {
                container.start();
                if (container.isListening()) {
                    backoff.recordSuccess();
                    return;
                }
            } catch (RuntimeException e) {
                backoff.recordFailure(e);
                try {
                    container.stop();
                } catch (RuntimeException ignored) {
                    // the next start() attempt reports the real problem
                }
            }
            try {
                Thread.sleep(retryMillis);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
        }
    }

    boolean isListening() {
        return container.isListening();
    }

    @Override
    public void destroy() {
        stopped = true;
        Thread current = worker;
        if (current != null) {
            current.interrupt();
        }
    }
}
