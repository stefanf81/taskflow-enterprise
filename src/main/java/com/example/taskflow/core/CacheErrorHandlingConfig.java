package com.example.taskflow.core;

import org.springframework.cache.annotation.CachingConfigurer;
import org.springframework.cache.interceptor.CacheErrorHandler;
import org.springframework.context.annotation.Configuration;

/** Registers {@link FailOpenCacheErrorHandler} for every {@code @Cacheable}/{@code @CacheEvict}. */
@Configuration
public class CacheErrorHandlingConfig implements CachingConfigurer {

    @Override
    public CacheErrorHandler errorHandler() {
        return new FailOpenCacheErrorHandler();
    }
}
