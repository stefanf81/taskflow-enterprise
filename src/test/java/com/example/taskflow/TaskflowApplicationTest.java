package com.example.taskflow;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(properties = {"app.rate-limit.enabled=false", "app.stats.cache.ttl=0"})
class TaskflowApplicationTest {

    @Autowired
    private ApplicationContext applicationContext;

    @Test
    void contextLoads() {
        assertNotNull(applicationContext, "ApplicationContext should load successfully");
        assertTrue(applicationContext.containsBean("taskflowApplication"), "TaskflowApplication bean should be in context");
    }

    @Test
    void testMain() {
        assertDoesNotThrow(() -> TaskflowApplication.main(new String[]{"--server.port=0"}),
                "Main application method should execute without throwing exceptions");
    }
}
