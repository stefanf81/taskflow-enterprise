package com.example.taskflow.core;

import jakarta.persistence.EntityManagerFactory;
import org.hibernate.engine.spi.SessionFactoryImplementor;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

/**
 * DATA-7: hibernate-jcache and caffeine-jcache are on the classpath and entities carry
 * {@code @Cache}, so the second-level and query caches must be switched off explicitly rather than
 * left to library defaults. {@code HibernateL2CacheBenchmarkTest} turns them on again for itself via
 * its own properties.
 */
@SpringBootTest(properties = {"app.rate-limit.enabled=false", "app.schedulers.enabled=false"})
class HibernateCacheSettingsTest {

    @Autowired
    private EntityManagerFactory entityManagerFactory;

    @Test
    void secondLevelAndQueryCachesAreDisabledInTheDefaultContext() {
        var options = entityManagerFactory.unwrap(SessionFactoryImplementor.class).getSessionFactoryOptions();

        assertFalse(options.isSecondLevelCacheEnabled(), "effective Hibernate L2 cache setting");
        assertFalse(options.isQueryCacheEnabled(), "effective Hibernate query cache setting");
        assertEquals("false", String.valueOf(
                entityManagerFactory.getProperties().get("hibernate.cache.use_second_level_cache")));
        assertEquals("false", String.valueOf(
                entityManagerFactory.getProperties().get("hibernate.cache.use_query_cache")));
    }
}
