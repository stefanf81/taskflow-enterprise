package com.example.taskflow.benchmark;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Splits a Dockerfile into the uncommented instructions of one named build stage
 * ({@code FROM ... AS <name>} up to the next FROM), with line continuations folded.
 * A commented-out command, a command in another stage, or text in a non-executed
 * instruction (e.g. LABEL) therefore cannot satisfy a stage assertion.
 */
final class DockerfileStages {

    private DockerfileStages() {
    }

    static List<String> instructions(String dockerfile, String stage) {
        Pattern header = Pattern.compile("FROM\\s+.*\\bAS\\s+" + Pattern.quote(stage));
        List<String> instructions = new ArrayList<>();
        boolean inStage = false;
        StringBuilder current = null;
        for (String rawLine : dockerfile.lines().toList()) {
            String line = rawLine.strip();
            if (line.isEmpty() || line.startsWith("#")) {
                continue;
            }
            if (!inStage) {
                inStage = header.matcher(line).matches();
                continue;
            }
            if (current == null && line.startsWith("FROM ")) {
                break;
            }
            current = current == null ? new StringBuilder(line) : current.append(' ').append(line);
            if (!line.endsWith("\\")) {
                instructions.add(current.toString());
                current = null;
            }
        }
        assertTrue(inStage, "the Dockerfile must declare a stage named " + stage);
        assertNull(current, "stage " + stage + " must not end in an unfinished line continuation");
        return instructions;
    }

    /** Joins the stage's instructions that start with the given directive. */
    static String instructions(String dockerfile, String stage, String directive) {
        return instructions(dockerfile, stage).stream()
                .filter(instruction -> instruction.startsWith(directive + " "))
                .collect(Collectors.joining("\n"));
    }
}
