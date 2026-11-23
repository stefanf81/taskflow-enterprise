package com.example.taskflow.benchmark;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/** Execute the workflow's actual shutdown assertion against deterministic docker-log streams. */
@Tag("container-config")
class ProductionImageSmokeTest {

    private static final String BASH_BINARY = resolveBash();

    private static String resolveBash() {
        for (String candidate : new String[] {"/bin/bash", "/usr/bin/bash", "/usr/local/bin/bash"}) {
            if (new File(candidate).canExecute()) {
                return candidate;
            }
        }
        return "/bin/bash";
    }

    @Test
    void gracefulShutdownWithLongLogs_doesNotFailFromSigpipe() throws Exception {
        // More than a pipe buffer after the matching line reliably exposes grep -q's
        // early close: the producer must be allowed to finish writing its whole log.
        assertEquals(0, runShutdownCheck("""
                docker() {
                  printf 'Graceful shutdown complete\\n'
                  for ((i=0; i<1024; i++)); do
                    printf '%4096s\\n' ''
                  done
                }
                """));
    }

    @Test
    void missingGracefulShutdownMessage_stillFails() throws Exception {
        assertEquals(1, runShutdownCheck("docker() { printf 'Shutdown requested only\\n'; }"));
    }

    @Test
    void failedDockerLogs_stillFailsEvenIfTheMessageWasWritten() throws Exception {
        assertEquals(42, runShutdownCheck("docker() { printf 'Graceful shutdown complete\\n'; return 42; }"));
    }

    /** The prod image logs ECS JSON; the ERROR check must see an error in either format. */
    @Test
    void errorLogCheck_matchesPlainAndEcsErrorsOnly() throws Exception {
        String plainError = "2026-11-23 10:00:00.000 [main] [,] ERROR o.s.boot.SpringApplication - boom";
        String ecsError = "{\"@timestamp\":\"2026-11-23T10:00:00Z\",\"log\":{\"level\":\"ERROR\",\"logger\":\"x\"},"
                + "\"message\":\"boom\",\"ecs\":{\"version\":\"8.11\"}}";
        String ecsInfo = "{\"@timestamp\":\"2026-11-23T10:00:00Z\",\"log\":{\"level\":\"INFO\",\"logger\":\"x\"},"
                + "\"message\":\"Started TaskflowApplication\",\"ecs\":{\"version\":\"8.11\"}}";
        assertEquals(0, runErrorCheck(plainError), "plain ERROR line must be found");
        assertEquals(0, runErrorCheck(ecsError), "ECS ERROR record must be found");
        assertEquals(1, runErrorCheck(ecsInfo), "an INFO record must not count as an error");
    }

    /** Exit 0 = the workflow's ERROR condition matched (the step would fail), 1 = clean log. */
    private int runErrorCheck(String logLine) throws Exception {
        String workflow = Files.readString(Path.of(".github/workflows/ci.yml"));
        String condition = workflow.lines()
                .map(String::strip)
                .filter(line -> line.startsWith("if docker logs smoke-backend") && line.contains("ERROR"))
                .findFirst().orElseThrow()
                .replaceFirst("^if ", "").replaceFirst("; then$", "");
        String stub = "docker() { printf '%s\\n' '" + logLine.replace("'", "'\\''") + "'; }";
        Process process = new ProcessBuilder(BASH_BINARY, "-c", "set -euo pipefail\n" + stub + "\n" + condition)
                .redirectOutput(ProcessBuilder.Redirect.DISCARD)
                .redirectError(ProcessBuilder.Redirect.DISCARD)
                .start();
        try {
            assertTrue(process.waitFor(10, TimeUnit.SECONDS), "error log check must not hang");
            return process.exitValue();
        } finally {
            if (process.isAlive()) {
                process.destroyForcibly();
            }
        }
    }

    private int runShutdownCheck(String dockerStub) throws Exception {
        String workflow = Files.readString(Path.of(".github/workflows/ci.yml"));
        String check = workflow.lines()
                .map(String::strip)
                .filter(line ->
                        line.startsWith("docker logs smoke-backend") && line.contains("Graceful shutdown complete"))
                .findFirst()
                .orElseThrow();
        // The following workflow line prints diagnostics on failure; test the pipeline's
        // real exit status instead of substituting or weakening that failure handler.
        if (check.endsWith("\\")) {
            check = check.substring(0, check.length() - 1);
        }
        Process process = new ProcessBuilder(BASH_BINARY, "-c", "set -euo pipefail\n" + dockerStub + "\n" + check)
                .redirectOutput(ProcessBuilder.Redirect.DISCARD)
                .redirectError(ProcessBuilder.Redirect.DISCARD)
                .start();
        try {
            assertTrue(process.waitFor(10, TimeUnit.SECONDS), "shutdown log assertion must not hang");
            return process.exitValue();
        } finally {
            if (process.isAlive()) {
                process.destroyForcibly();
            }
        }
    }
}
