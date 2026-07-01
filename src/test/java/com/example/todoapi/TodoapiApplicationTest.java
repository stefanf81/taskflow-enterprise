package com.example.todoapi;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest
class TodoapiApplicationTest {

    @Test
    void contextLoads() {
        // This test ensures the application context loads successfully.
    }

    @Test
    void testMain() {
        TodoapiApplication.main(new String[]{});
    }
}
