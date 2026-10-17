package com.example.taskflow.appointment;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * The admin event stream over a real socket. Unit tests call the controller directly and MockMvc
 * never flushes, so neither can see a servlet filter that buffers the stream: the
 * {@code ShallowEtagHeaderFilter} used to hold every SSE byte (headers included) until the stream
 * ended, so browsers never received a single event.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {"app.rate-limit.enabled=false", "spring.cache.type=simple"})
class AppointmentEventStreamHttpIntegrationTest {

    @LocalServerPort
    private int port;

    @Test
    void readyEventReachesTheClientImmediately() throws Exception {
        HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
        String base = "http://127.0.0.1:" + port;

        HttpResponse<String> login = http.send(HttpRequest.newBuilder(URI.create(base + "/api/v1/auth/mobile/login"))
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofString(
                                "{\"username\":\"admin\",\"password\":\"admin-password\"}"))
                        .build(),
                HttpResponse.BodyHandlers.ofString());
        assertEquals(200, login.statusCode(), login.body());
        String token = new ObjectMapper().readTree(login.body()).get("accessToken").asText();

        CompletableFuture<HttpResponse<InputStream>> stream = http.sendAsync(
                HttpRequest.newBuilder(URI.create(base + "/api/v1/appointments/events"))
                        .header("Authorization", "Bearer " + token)
                        .header("Accept", "text/event-stream")
                        .GET()
                        .build(),
                HttpResponse.BodyHandlers.ofInputStream());

        // The stream stays open for 30 minutes; anything slower than a few seconds means buffering.
        HttpResponse<InputStream> response = stream.get(10, TimeUnit.SECONDS);
        try (InputStream body = response.body()) {
            assertEquals(200, response.statusCode());
            BufferedReader reader = new BufferedReader(new InputStreamReader(body, StandardCharsets.UTF_8));
            String firstLine = CompletableFuture.supplyAsync(() -> {
                try {
                    return reader.readLine();
                } catch (java.io.IOException e) {
                    throw new java.io.UncheckedIOException(e);
                }
            }).get(10, TimeUnit.SECONDS);
            assertEquals("event:ready", firstLine);
        }
    }
}
