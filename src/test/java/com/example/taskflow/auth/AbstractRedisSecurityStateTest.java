package com.example.taskflow.auth;

import com.example.taskflow.TaskflowApplication;
import com.example.taskflow.core.RedisTestSupport;
import com.example.taskflow.core.TokenRevokedEvent;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.listener.ChannelTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The Redis-backed denylist and login throttle against a real Redis. Two instances with their own
 * connection factories are two replicas; the last test boots two complete applications on one Redis.
 * Every test uses fresh ids, so a shared scratch server is fine; nothing is flushed.
 */
abstract class AbstractRedisSecurityStateTest {

    protected abstract String redisUrl();

    private LettuceConnectionFactory factoryA;
    private LettuceConnectionFactory factoryB;
    private StringRedisTemplate redisA;
    private StringRedisTemplate redisB;
    private final List<String> keysToDelete = new ArrayList<>();

    @BeforeEach
    void connect() {
        factoryA = RedisTestSupport.connect(redisUrl());
        factoryB = RedisTestSupport.connect(redisUrl());
        redisA = new StringRedisTemplate(factoryA);
        redisB = new StringRedisTemplate(factoryB);
    }

    @AfterEach
    void disconnect() {
        if (!keysToDelete.isEmpty()) {
            redisA.delete(keysToDelete);
        }
        RequestContextHolder.resetRequestAttributes();
        factoryA.destroy();
        factoryB.destroy();
    }

    private String freshJti() {
        String jti = UUID.randomUUID().toString();
        keysToDelete.add(RedisTokenRevocationStore.key(jti));
        return jti;
    }

    @Test
    void aRevocationOnOneReplicaIsEnforcedByAnotherWithATtlOfTheTokensLifetime() {
        TokenRevocationList replicaA = new TokenRevocationList(null, new RedisTokenRevocationStore(redisA));
        TokenRevocationList replicaB = new TokenRevocationList(null, new RedisTokenRevocationStore(redisB));
        String jti = freshJti();
        assertFalse(replicaB.isRevoked(jti));

        replicaA.revoke(jti, Instant.now().plusSeconds(120));

        assertTrue(replicaB.isRevoked(jti), "visible to the other replica");
        assertFalse(replicaB.isRevoked(freshJti()), "other tokens unaffected");
        Long ttl = redisA.getExpire(RedisTokenRevocationStore.key(jti), TimeUnit.MILLISECONDS);
        assertNotNull(ttl);
        assertTrue(ttl > 110_000 && ttl <= 120_000, "TTL = remaining token lifetime: " + ttl);
        // A restarted replica (fresh in-memory state) still denies it.
        assertTrue(new TokenRevocationList(null, new RedisTokenRevocationStore(redisB)).isRevoked(jti));
    }

    @Test
    void anAlmostExpiredTokenGetsTheMinimumTtlNeverNone() {
        TokenRevocationList replicaA = new TokenRevocationList(null, new RedisTokenRevocationStore(redisA));
        String jti = freshJti();

        replicaA.revoke(jti, Instant.now().plusMillis(500));

        Long ttl = redisA.getExpire(RedisTokenRevocationStore.key(jti), TimeUnit.MILLISECONDS);
        assertTrue(ttl != null && ttl > 4_000 && ttl <= RedisTokenRevocationStore.MIN_TTL_MILLIS, "ttl=" + ttl);
    }

    @Test
    void aRevocationIsRepublishedOnTheOtherReplicaSoItsAdminStreamsCloseAndItDoesNotEcho() throws Exception {
        List<Object> eventsA = Collections.synchronizedList(new ArrayList<>());
        List<Object> eventsB = Collections.synchronizedList(new ArrayList<>());
        TokenRevocationList replicaA = new TokenRevocationList(eventsA::add, new RedisTokenRevocationStore(redisA));
        TokenRevocationList replicaB = new TokenRevocationList(eventsB::add, new RedisTokenRevocationStore(redisB));
        RedisMessageListenerContainer containerA = subscribe(factoryA, replicaA);
        RedisMessageListenerContainer containerB = subscribe(factoryB, replicaB);
        try {
            String jti = freshJti();
            replicaA.revoke(jti, Instant.now().plusSeconds(60));

            awaitTrue(() -> eventsB.contains(new TokenRevokedEvent(jti)), "replica B re-published the revocation");
            Thread.sleep(300); // give an echo the chance to arrive
            assertEquals(List.of(new TokenRevokedEvent(jti)), List.copyOf(eventsA), "A saw only its own local event");
            assertEquals(List.of(new TokenRevokedEvent(jti)), List.copyOf(eventsB), "B published it exactly once");
        } finally {
            containerA.destroy();
            containerB.destroy();
        }
    }

    private static RedisMessageListenerContainer subscribe(LettuceConnectionFactory factory, TokenRevocationList list)
            throws Exception {
        RedisMessageListenerContainer container = new RedisMessageListenerContainer();
        container.setConnectionFactory(factory);
        container.setAutoStartup(false);
        container.addMessageListener((message, pattern) ->
                list.onRemoteRevocation(new String(message.getBody(), StandardCharsets.UTF_8)),
                new ChannelTopic(RedisTokenRevocationStore.CHANNEL));
        container.afterPropertiesSet();
        RevocationChannelSubscriber subscriber = new RevocationChannelSubscriber(container, 100);
        subscriber.subscribeUntilListening();
        assertTrue(subscriber.isListening());
        return container;
    }

    @Test
    void loginFailuresAreCountedOnceForAllReplicasAndASuccessResetsThemEverywhere() {
        asClient("203.0.113.7");
        String user = "user-" + UUID.randomUUID() + "@example.com";
        keysToDelete.add(RedisLoginFailureCounter.key(user + "|203.0.113.7"));
        LoginAttemptLimiter replicaA = new LoginAttemptLimiter(3, 300, new RedisLoginFailureCounter(redisA));
        LoginAttemptLimiter replicaB = new LoginAttemptLimiter(3, 300, new RedisLoginFailureCounter(redisB));

        replicaA.recordFailure(user);
        replicaB.recordFailure(user);
        assertDoesNotThrow(() -> replicaA.checkAllowed(user));
        replicaA.recordFailure(user);

        TooManyLoginAttemptsException onB = assertThrows(TooManyLoginAttemptsException.class,
                () -> replicaB.checkAllowed(user), "3 failures over two replicas reach the limit of 3");
        long retryAfter = Long.parseLong(onB.getHeaders().getFirst("Retry-After"));
        assertTrue(retryAfter > 290 && retryAfter <= 300, "Retry-After from the shared window: " + retryAfter);
        Long ttl = redisA.getExpire(RedisLoginFailureCounter.key(user + "|203.0.113.7"), TimeUnit.MILLISECONDS);
        assertTrue(ttl != null && ttl > 0 && ttl <= 300_000, "the window key has a TTL: " + ttl);

        replicaB.recordSuccess(user);
        assertDoesNotThrow(() -> replicaA.checkAllowed(user), "a success on B clears the window for A");
        assertFalse(Boolean.TRUE.equals(redisA.hasKey(RedisLoginFailureCounter.key(user + "|203.0.113.7"))));
    }

    @Test
    void aWindowKeyThatLostItsTtlGetsOneOnTheNextFailure() {
        String accountKey = "user-" + UUID.randomUUID() + "|";
        String key = RedisLoginFailureCounter.key(accountKey);
        keysToDelete.add(key);
        redisA.opsForValue().set(key, "4"); // no TTL, e.g. written by hand

        assertEquals(5, new RedisLoginFailureCounter(redisA).increment(accountKey, 60_000));

        Long ttl = redisA.getExpire(key, TimeUnit.MILLISECONDS);
        assertTrue(ttl != null && ttl > 0 && ttl <= 60_000, "ttl=" + ttl);
    }

    /**
     * Two complete backends (each with its own H2 database, same RSA key pair, one Redis): a token
     * logged out on replica A is refused by replica B, and failed logins on both add up.
     */
    @Test
    void twoApplicationReplicasShareLogoutAndTheLoginThrottle() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        KeyPair keys = generator.generateKeyPair();
        String[] args = replicaArgs(keys);
        try (ConfigurableApplicationContext a = new SpringApplicationBuilder(TaskflowApplication.class).run(args);
             ConfigurableApplicationContext b = new SpringApplicationBuilder(TaskflowApplication.class).run(args)) {
            String baseA = "http://127.0.0.1:" + a.getEnvironment().getProperty("local.server.port");
            String baseB = "http://127.0.0.1:" + b.getEnvironment().getProperty("local.server.port");
            HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

            HttpResponse<String> login = post(http, baseA + "/api/v1/auth/mobile/login",
                    "{\"username\":\"admin\",\"password\":\"admin-password\"}", null);
            assertEquals(200, login.statusCode(), login.body());
            String token = new ObjectMapper().readTree(login.body()).get("accessToken").asText();

            assertEquals(200, get(http, baseB + "/api/v1/auth/me", token).statusCode(), "B accepts A's token");
            assertEquals(204, post(http, baseA + "/api/v1/auth/logout", "", token).statusCode());
            assertEquals(401, get(http, baseA + "/api/v1/auth/me", token).statusCode(), "revoked on A");
            assertEquals(401, get(http, baseB + "/api/v1/auth/me", token).statusCode(), "and on B");

            String user = "nobody-" + UUID.randomUUID() + "@example.com";
            keysToDelete.add(RedisLoginFailureCounter.key(user + "|127.0.0.1"));
            String badLogin = "{\"username\":\"" + user + "\",\"password\":\"wrong-password\"}";
            assertEquals(401, post(http, baseA + "/api/v1/auth/login", badLogin, null).statusCode());
            assertEquals(401, post(http, baseB + "/api/v1/auth/login", badLogin, null).statusCode());
            assertEquals(401, post(http, baseA + "/api/v1/auth/login", badLogin, null).statusCode());
            HttpResponse<String> throttled = post(http, baseB + "/api/v1/auth/login", badLogin, null);
            assertEquals(429, throttled.statusCode(), "3 failures across both replicas hit the limit of 3");
            assertTrue(throttled.headers().firstValue("Retry-After").isPresent());
        }
    }

    private String[] replicaArgs(KeyPair keys) {
        URI uri = URI.create(redisUrl());
        List<String> args = new ArrayList<>(List.of(
                "--server.port=0",
                "--app.state.store=redis",
                "--spring.cache.type=redis",
                "--spring.data.redis.host=" + uri.getHost(),
                "--spring.data.redis.port=" + uri.getPort(),
                "--app.rsa.private-key=" + Base64.getEncoder().encodeToString(keys.getPrivate().getEncoded()),
                "--app.rsa.public-key=" + Base64.getEncoder().encodeToString(keys.getPublic().getEncoded()),
                "--spring.datasource.url=jdbc:h2:mem:replica-${random.uuid};MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
                "--app.schedulers.enabled=false",
                "--app.rate-limit.login-max-failures=3",
                "--management.tracing.sampling.probability=0.0",
                "--spring.main.keep-alive=false"));
        if (uri.getUserInfo() != null) {
            args.add("--spring.data.redis.password=" + uri.getUserInfo().substring(uri.getUserInfo().indexOf(':') + 1));
        }
        return args.toArray(String[]::new);
    }

    private static HttpResponse<String> post(HttpClient http, String url, String json, String bearer) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(10))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json));
        if (bearer != null) {
            request.header("Authorization", "Bearer " + bearer);
        }
        return http.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }

    private static HttpResponse<String> get(HttpClient http, String url, String bearer) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(10))
                .header("Authorization", "Bearer " + bearer)
                .GET()
                .build();
        return http.send(request, HttpResponse.BodyHandlers.ofString());
    }

    private static void asClient(String address) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRemoteAddr(address);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    private static void awaitTrue(java.util.function.BooleanSupplier condition, String message) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        while (!condition.getAsBoolean()) {
            if (System.nanoTime() > deadline) {
                throw new AssertionError(message);
            }
            Thread.sleep(20);
        }
    }
}
