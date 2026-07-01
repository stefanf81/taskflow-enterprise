package com.example.taskflow.appointment;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.util.StopWatch;

import org.springframework.context.annotation.Import;
import com.example.taskflow.auth.TestSecurityConfig;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.*;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * HIGH-PERFORMANCE CONCURRENCY AND LATENCY BENCHMARK TEST (BARBER BOOKING DOMAIN)
 * 
 * Why this is used:
 * To proactively prevent performance regressions under simulated real-world customer traffic.
 * This test simulates multiple concurrent threads making asynchronous, paginated requests against 
 * our booking database and validates that average latency remains below a threshold.
 */
@SpringBootTest(properties = "app.rate-limit.enabled=false")
@AutoConfigureMockMvc
@Import(TestSecurityConfig.class)
public class AppointmentControllerBenchmarkExample {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private AppointmentRepository appointmentRepository;

    @Autowired
    private ObjectMapper objectMapper;

    private String authHeader;
    private static final int DATABASE_SIZE = 100;     // Pre-populated items size
    private static final int CONCURRENT_USERS = 5;    // Active concurrent threads
    private static final int TOTAL_REQUESTS = 50;     // Total load requests
    private static final long MAX_LATENCY_MS = 100;   // Max tolerated avg latency per call

    @BeforeEach
    void setUp() throws Exception {
        appointmentRepository.deleteAll();

        // 1. Populate the database with dummy appointments to simulate load volume
        List<Appointment> loadData = new ArrayList<>();
        for (int i = 0; i < DATABASE_SIZE; i++) {
            loadData.add(new Appointment("Client " + i, "client" + i + "@example.com", "555-01" + i, "Barber Alex", LocalDate.now().plusDays(i), "10:00 AM", "Classic Haircut"));
        }
        appointmentRepository.saveAll(loadData);

        // 2. Perform secure login to get the JWT Bearer token
        Map<String, String> loginRequest = new HashMap<>();
        loginRequest.put("username", "admin");
        loginRequest.put("password", "admin-password");

        String responseJson = mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(loginRequest)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        @SuppressWarnings("unchecked")
        Map<String, Object> responseMap = objectMapper.readValue(responseJson, Map.class);
        authHeader = "Bearer " + responseMap.get("token").toString();
    }

    @Test
    void executeConcurrentLoadBenchmark() throws Exception {
        ExecutorService executorService = Executors.newFixedThreadPool(CONCURRENT_USERS);
        CountDownLatch startLatch = new CountDownLatch(1);
        CountDownLatch finishLatch = new CountDownLatch(TOTAL_REQUESTS);

        StopWatch stopWatch = new StopWatch("TaskFlow API Benchmark");
        stopWatch.start("Concurrent REST API Load Test");

        List<Future<Long>> futures = new ArrayList<>();

        for (int i = 0; i < TOTAL_REQUESTS; i++) {
            futures.add(executorService.submit(() -> {
                startLatch.await();
                
                long requestStart = System.nanoTime();
                mockMvc.perform(get("/api/v1/appointments?page=0&size=10&status=PENDING")
                                .header("Authorization", authHeader))
                        .andExpect(status().isOk());
                long requestEnd = System.nanoTime();
                
                finishLatch.countDown();
                return (requestEnd - requestStart) / 1_000_000; // Convert to milliseconds
            }));
        }

        startLatch.countDown();

        boolean completedInTime = finishLatch.await(15, TimeUnit.SECONDS);
        stopWatch.stop();

        assertTrue(completedInTime, "Benchmark timed out before all requests completed.");

        long totalLatencyMs = 0;
        long minLatencyMs = Long.MAX_VALUE;
        long maxLatencyMs = 0;

        for (Future<Long> future : futures) {
            long latency = future.get();
            totalLatencyMs += latency;
            minLatencyMs = Math.min(minLatencyMs, latency);
            maxLatencyMs = Math.max(maxLatencyMs, latency);
        }

        double avgLatency = (double) totalLatencyMs / TOTAL_REQUESTS;
        double throughput = (double) TOTAL_REQUESTS / (stopWatch.getTotalTimeSeconds());

        System.out.println("\n=========================================================================");
        System.out.println("📊 TASKFLOW FULL-STACK REST API BENCHMARK METRICS");
        System.out.println("=========================================================================");
        System.out.printf("  %-30s : %d items\n", "Pre-populated Data Volume", DATABASE_SIZE);
        System.out.printf("  %-30s : %d users\n", "Concurrent Users (Threads)", CONCURRENT_USERS);
        System.out.printf("  %-30s : %d calls\n", "Total Executed HTTP Requests", TOTAL_REQUESTS);
        System.out.printf("  %-30s : %.2f seconds\n", "Total Elapsed Execution Time", stopWatch.getTotalTimeSeconds());
        System.out.printf("  %-30s : %.2f req/sec\n", "Overall Throughput", throughput);
        System.out.println("-------------------------------------------------------------------------");
        System.out.printf("  %-30s : %d ms\n", "Minimum Latency", minLatencyMs);
        System.out.printf("  %-30s : %d ms\n", "Maximum Latency", maxLatencyMs);
        System.out.printf("  %-30s : %.2f ms\n", "Average Latency", avgLatency);
        System.out.println("=========================================================================");

        executorService.shutdown();

        assertTrue(avgLatency < MAX_LATENCY_MS, 
                String.format("Performance regression! Average latency of %.2fms exceeded the %dms SLA limit.", avgLatency, MAX_LATENCY_MS));
    }
}
