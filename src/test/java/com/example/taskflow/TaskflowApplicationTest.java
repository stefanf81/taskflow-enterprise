package com.example.taskflow;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest(properties = {"app.rate-limit.enabled=false", "app.stats.cache.ttl=0"})
class TaskflowApplicationTest {

    @Test
    void contextLoads() {
        // This test ensures the application context loads successfully.
    }

    @Test
    void testMain() {
        TaskflowApplication.main(new String[]{"--server.port=0"});
    }
}
