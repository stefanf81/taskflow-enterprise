package com.example.taskflow.auth;

import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.util.StopWatch;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * STATE-OF-THE-ART ASYMMETRIC RSA-2048 JWT BENCHMARK
 *
 * Why this is used:
 * In a stateless REST API, JWT signature parsing and verification occur on every single incoming HTTP call.
 * This makes cryptographic token parsing the primary CPU bottleneck of your backend security gateway.
 * Isolating this micro-benchmark from Database and network I/O allows us to measure the raw cryptographic
 * throughput (Operations per Second) of our native Spring Security OAuth2 resource server encoder/decoder layer under load.
 */
@Tag("benchmark")
@SpringBootTest(properties = {"app.rate-limit.enabled=false", "app.stats.cache.ttl=0"})
public class JwtSecurityBenchmarkTest {

    @Autowired
    private JwtEncoder jwtEncoder;

    @Autowired
    private JwtDecoder jwtDecoder;

    private static final int ITERATIONS = 1000;       // Total ops to execute
    private static final double MAX_PARSE_LATENCY_MS = 1.0; // SLA: token validation must be < 1.0ms

    @Test
    void benchmarkJwtCryptographicOperations() {
        StopWatch stopWatch = new StopWatch("JWT Cryptography Benchmark");

        // 1. Benchmark Token Generation (Asymmetric RSA-2048 Sign)
        stopWatch.start("Token Generation (RSA-2048 Sign)");
        List<String> tokens = new ArrayList<>(ITERATIONS);
        Instant now = Instant.now();
        for (int i = 0; i < ITERATIONS; i++) {
            JwtClaimsSet claims = JwtClaimsSet.builder()
                    .issuer("taskflow")
                    .audience(java.util.List.of("taskflow-api"))
                    .issuedAt(now)
                    .expiresAt(now.plusSeconds(3600))
                    .subject("benchmark-user")
                    .build();
            tokens.add(jwtEncoder.encode(JwtEncoderParameters.from(claims)).getTokenValue());
        }
        stopWatch.stop();
        long genTimeNs = stopWatch.lastTaskInfo().getTimeNanos();

        // 2. Benchmark Token Validation & Claims Parsing (Asymmetric RSA-2048 Verify)
        stopWatch.start("Token Parsing & Signature Verification");
        int validCount = 0;
        for (String token : tokens) {
            Jwt decoded = jwtDecoder.decode(token);
            if (decoded != null && "benchmark-user".equals(decoded.getSubject())) {
                validCount++;
            }
        }
        stopWatch.stop();
        long parseTimeNs = stopWatch.lastTaskInfo().getTimeNanos();

        // Calculate Metrics
        double genTimeMs = genTimeNs / 1_000_000.0;
        double parseTimeMs = parseTimeNs / 1_000_000.0;

        double genOpsPerSec = (ITERATIONS / (genTimeNs / 1_000_000_000.0));
        double parseOpsPerSec = (ITERATIONS / (parseTimeNs / 1_000_000_000.0));

        double avgGenLatencyMs = genTimeMs / ITERATIONS;
        double avgParseLatencyMs = parseTimeMs / ITERATIONS;

        // Print out a beautifully typeset cryptographic benchmark metrics table
        System.out.println("\n=========================================================================");
        System.out.println("\uD83D\uDD10 SECURITY LAYER: ASYMMETRIC RSA-2048 JWT BENCHMARK");
        System.out.println("=========================================================================");
        System.out.printf("  %-35s : %d cycles\n", "Benchmark Operations Iterations", ITERATIONS);
        System.out.printf("  %-35s : %s\n", "Signature Algorithm", "Asymmetric RSA-2048");
        System.out.println("-------------------------------------------------------------------------");
        System.out.printf("  %-35s : %.2f ms\n", "Total Token Generation Time", genTimeMs);
        System.out.printf("  %-35s : %.2f tokens/sec\n", "Token Generation Throughput", genOpsPerSec);
        System.out.printf("  %-35s : %.4f ms\n", "Average Generation Latency", avgGenLatencyMs);
        System.out.println("-------------------------------------------------------------------------");
        System.out.printf("  %-35s : %.2f ms\n", "Total Token Parsing & Verify Time", parseTimeMs);
        System.out.printf("  %-35s : %.2f tokens/sec\n", "Token Validation Throughput", parseOpsPerSec);
        System.out.printf("  %-35s : %.4f ms\n", "Average Validation Latency", avgParseLatencyMs);
        System.out.println("=========================================================================");

        // Assert that parsing remains fast (strict SLA protection)
        assertTrue(avgParseLatencyMs < MAX_PARSE_LATENCY_MS,
                String.format("Cryptographic regression! Average token verification of %.4fms exceeded the %.2fms SLA.", avgParseLatencyMs, MAX_PARSE_LATENCY_MS));

        assertTrue(validCount == ITERATIONS, "Verification failed! Not all tokens were validated correctly.");
    }
}
