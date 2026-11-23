package com.example.taskflow.auth;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

class MetricsScrapeTokenGuardTest {

    // Built, not written out: any 10+ character literal assigned to a TOKEN constant is what
    // gitleaks' generic-api-key rule reports. Only the length matters to the guard (>= 16).
    private static final String TOKEN = "t".repeat(32);

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(AuthPropertiesConfig.class, MetricsScrapeTokenGuard.class);

    @Test
    void rejectsMissingBlankPlaceholderAndShortTokens() {
        assertThrows(IllegalStateException.class, () -> MetricsScrapeTokenGuard.validate(null));
        assertThrows(IllegalStateException.class, () -> MetricsScrapeTokenGuard.validate("   "));
        assertThrows(
                IllegalStateException.class,
                () -> MetricsScrapeTokenGuard.validate("<CHANGE_ME_METRICS_SCRAPE_TOKEN>"));
        assertThrows(IllegalStateException.class, () -> MetricsScrapeTokenGuard.validate("short-token"));
    }

    @Test
    void acceptsAGeneratedToken() {
        assertDoesNotThrow(() -> MetricsScrapeTokenGuard.validate(TOKEN));
    }

    @Test
    void whenRequiredTheContextRefusesToStartWithoutAToken() {
        runner.withPropertyValues("app.metrics.require-scrape-token=true").run(ctx -> {
            assertNotNull(ctx.getStartupFailure());
            assertTrue(rootMessage(ctx.getStartupFailure()).contains("APP_METRICS_SCRAPE_TOKEN"));
        });
    }

    /** Prod: app.metrics.scrape-token bound from an empty APP_METRICS_SCRAPE_TOKEN must still abort. */
    @Test
    void whenRequiredAnEmptyTokenStillFailsTheStart() {
        runner.withPropertyValues("app.metrics.require-scrape-token=true", "app.metrics.scrape-token=")
                .run(ctx -> assertNotNull(ctx.getStartupFailure()));
    }

    @Test
    void whenRequiredAGeneratedTokenStarts() {
        runner.withPropertyValues("app.metrics.require-scrape-token=true", "app.metrics.scrape-token=" + TOKEN)
                .run(ctx -> {
                    assertNull(ctx.getStartupFailure());
                    assertEquals(
                            1, ctx.getBeansOfType(MetricsScrapeTokenGuard.class).size());
                });
    }

    @Test
    void whenNotRequiredAMissingTokenIsAllowedAndTheEndpointStaysOpen() {
        runner.run(ctx -> {
            assertNull(ctx.getStartupFailure());
            assertTrue(ctx.getBeansOfType(MetricsScrapeTokenGuard.class).isEmpty());
            assertFalse(new MetricsScrapeAuthorization(
                            ctx.getBean(MetricsProperties.class).scrapeToken())
                    .protectsTheEndpoint());
        });
    }

    /** The prod profile reads the switch from the environment and leaves it off unless a deployment opts in. */
    @Test
    void theProdProfileDefaultsTheSwitchToOffAndReadsItFromTheEnvironment() throws Exception {
        java.util.Properties prod = new java.util.Properties();
        try (var in = getClass().getClassLoader().getResourceAsStream("application-prod.properties")) {
            prod.load(in);
        }
        assertEquals("${APP_REQUIRE_METRICS_SCRAPE_TOKEN:false}", prod.getProperty("app.metrics.require-scrape-token"));
    }

    private static String rootMessage(Throwable t) {
        while (t.getCause() != null) {
            t = t.getCause();
        }
        return String.valueOf(t.getMessage());
    }
}
