package com.example.taskflow.core;

import java.util.concurrent.Executor;
import java.util.concurrent.ThreadPoolExecutor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.aop.interceptor.AsyncUncaughtExceptionHandler;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.AsyncConfigurer;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

/**
 * Bounded async executor — replaces Spring's unbounded default from
 * {@code @EnableAsync} (core=8, max=Integer.MAX_VALUE,
 * queue=Integer.MAX_VALUE).
 *
 * <p>Config follows jhipster / spring-boot-best-practice: bounded pool with
 * {@link ThreadPoolExecutor.CallerRunsPolicy} so burst load applies
 * backpressure to the caller instead of OOMing the heap. The async queue plus
     * Logback {@code AsyncAppender queue 16384} (logback-spring.xml) would otherwise
 * grow without practical bound.
 *
 * <p>Tuning: core=8 (matches Spring default), max=64, queue=100,
 * keepAlive=60s. At 64 threads the pool can absorb the burst-heavy
 * notification/outbox path without exhausting the 25-connection Hikari pool or
 * the 1.25 GiB heap (MaxRAMPercentage=50 of 2560M). CallerRunsPolicy prevents
 * silent task drops — use {@code @Async} return types ({@code CompletableFuture})
 * if you need explicit rejection handling.
 */
@Configuration
public class AsyncConfig implements AsyncConfigurer {

    private static final Logger log = LoggerFactory.getLogger(AsyncConfig.class);

    @Bean(name = "taskExecutor")
    @Override
    public Executor getAsyncExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(8);
        executor.setMaxPoolSize(64);
        executor.setQueueCapacity(100);
        executor.setKeepAliveSeconds(60);
        executor.setThreadNamePrefix("taskflow-async-");
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(30);
        executor.initialize();
        log.info(
                "Async executor configured: core={}, max={}, queue={}, keepAlive={}s, rejection=CALLER_RUNS",
                executor.getCorePoolSize(),
                executor.getMaxPoolSize(),
                executor.getQueueCapacity(),
                executor.getKeepAliveSeconds());
        return executor;
    }

    @Override
    public AsyncUncaughtExceptionHandler getAsyncUncaughtExceptionHandler() {
        return (ex, method, params) ->
                log.error(
                        "Unhandled async exception in {}.{}: {}",
                        method.getDeclaringClass().getSimpleName(),
                        method.getName(),
                        LogSanitizer.safeMessage(ex),
                        ex);
    }
}
