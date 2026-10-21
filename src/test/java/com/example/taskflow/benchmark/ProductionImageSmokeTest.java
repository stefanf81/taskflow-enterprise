package com.example.taskflow.benchmark;

import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Execute the workflow's actual shutdown assertion against deterministic docker-log streams. */
@Tag("container-config")
class ProductionImageSmokeTest {

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

    private int runShutdownCheck(String dockerStub) throws Exception {
        String workflow = Files.readString(Path.of(".github/workflows/ci.yml"));
        String check = workflow.lines()
                .map(String::strip)
                .filter(line -> line.startsWith("docker logs smoke-backend")
                        && line.contains("Graceful shutdown complete"))
                .findFirst().orElseThrow();
        // The following workflow line prints diagnostics on failure; test the pipeline's
        // real exit status instead of substituting or weakening that failure handler.
        if (check.endsWith("\\")) {
            check = check.substring(0, check.length() - 1);
        }
        Process process = new ProcessBuilder("bash", "-c", "set -euo pipefail\n" + dockerStub + "\n" + check)
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
