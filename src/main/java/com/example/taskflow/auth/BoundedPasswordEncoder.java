package com.example.taskflow.auth;

import org.springframework.security.authentication.InternalAuthenticationServiceException;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Runs the delegate's hashing (BCrypt: tens of milliseconds of CPU per call) on a few platform
 * threads instead of the caller's thread.
 *
 * <p>Requests run on virtual threads, and a virtual thread keeps its carrier until it blocks: a
 * hash never yields. With logins arriving from many addresses (each address is allowed 20 a
 * minute), every carrier was busy hashing and all other requests queued behind them: on 4 cores,
 * 64 logins in flight took the cached catalog from 6 to 1,009-1,207 ms at p99 (BENCHMARKS.md §75).
 * Here at most {@code threads} hashes run at once, on threads the OS time-slices with the
 * carriers, and the waiting virtual thread parks and frees its carrier.
 *
 * <p>When {@code queueCapacity} hashes are already waiting, the call fails at once with
 * {@link PasswordHashingBusyException} (503 + Retry-After), so a login flood cannot build an
 * unbounded queue of requests that each hold a connection.
 */
final class BoundedPasswordEncoder implements PasswordEncoder, AutoCloseable {

    /** Upper bound on one call's wait, queue included; the queue bound normally ends it far sooner. */
    private static final long MAX_WAIT_SECONDS = 10;

    private final PasswordEncoder delegate;
    private final ThreadPoolExecutor executor;

    BoundedPasswordEncoder(PasswordEncoder delegate, int threads, int queueCapacity) {
        this.delegate = delegate;
        AtomicInteger counter = new AtomicInteger();
        this.executor = new ThreadPoolExecutor(threads, threads, 0L, TimeUnit.MILLISECONDS,
                new ArrayBlockingQueue<>(queueCapacity), runnable -> {
                    Thread thread = new Thread(runnable, "password-hash-" + counter.incrementAndGet());
                    thread.setDaemon(true);
                    return thread;
                }, new ThreadPoolExecutor.AbortPolicy());
    }

    /** One thread fewer than the processors the JVM sees (container-aware), at least one. */
    static int defaultThreads() {
        return Math.max(1, Runtime.getRuntime().availableProcessors() - 1);
    }

    @Override
    public String encode(CharSequence rawPassword) {
        return run(() -> delegate.encode(rawPassword));
    }

    @Override
    public boolean matches(CharSequence rawPassword, String encodedPassword) {
        return run(() -> delegate.matches(rawPassword, encodedPassword));
    }

    @Override
    public boolean upgradeEncoding(String encodedPassword) {
        return delegate.upgradeEncoding(encodedPassword);
    }

    private <T> T run(Callable<T> hashing) {
        Future<T> result;
        try {
            result = executor.submit(hashing);
        } catch (RejectedExecutionException e) {
            throw new PasswordHashingBusyException();
        }
        try {
            return result.get(MAX_WAIT_SECONDS, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            result.cancel(true);
            Thread.currentThread().interrupt();
            throw new PasswordHashingBusyException();
        } catch (TimeoutException e) {
            result.cancel(true);
            throw new PasswordHashingBusyException();
        } catch (ExecutionException e) {
            if (e.getCause() instanceof RuntimeException runtime) {
                throw runtime;
            }
            if (e.getCause() instanceof Error error) {
                throw error;
            }
            throw new IllegalStateException(e.getCause());
        }
    }

    @Override
    public void close() {
        executor.shutdownNow();
    }

    /**
     * Too many password hashes are already waiting. An {@link InternalAuthenticationServiceException},
     * so it takes the existing "temporarily busy" path: 503 with Retry-After from
     * {@code GlobalExceptionHandler}, and {@code AuthController} does not count it as a failed login.
     */
    static final class PasswordHashingBusyException extends InternalAuthenticationServiceException {
        PasswordHashingBusyException() {
            super("Password hashing is saturated");
        }
    }
}
