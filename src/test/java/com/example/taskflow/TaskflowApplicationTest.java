package com.example.taskflow;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest
class TaskflowApplicationTest {

    @Test
    void contextLoads() {
        // This test ensures the application context loads successfully.
    }

    @Test
    void testMain() {
        TaskflowApplication.main(new String[]{});
    }
}
