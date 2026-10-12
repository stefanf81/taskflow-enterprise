package com.example.taskflow.benchmark;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Reads a Dockerfile's build stages for the container-config guards. Only uncommented
 * instructions count, with line continuations folded, so a commented-out command, a
 * command in another stage, or text in a non-executed instruction (e.g. LABEL) cannot
 * satisfy a stage assertion.
 */
final class DockerfileStages {

    /** {@code FROM [--flag=value ...] <parent> AS <name>}. */
    private static final Pattern STAGE_HEADER =
            Pattern.compile("FROM\\s+(?:--\\S+\\s+)*(\\S+)\\s+AS\\s+(\\S+)", Pattern.CASE_INSENSITIVE);

    private DockerfileStages() {
    }

    /** The stage's own instructions (its FROM line excluded), up to the next FROM. */
    static List<String> instructions(String dockerfile, String stage) {
        Pattern header = Pattern.compile("FROM\\s+.*\\bAS\\s+" + Pattern.quote(stage));
        List<String> instructions = new ArrayList<>();
        boolean inStage = false;
        StringBuilder current = null;
        for (String line : uncommentedLines(dockerfile)) {
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

    /** Joins the stage's own instructions that start with the given directive. */
    static String instructions(String dockerfile, String stage, String directive) {
        return withDirective(instructions(dockerfile, stage), directive);
    }

    /**
     * Joins the instructions with the given directive from the stage and every stage it
     * inherits from, root stage first, so a command moved into a shared parent stage still
     * counts for the child.
     */
    static String inheritedInstructions(String dockerfile, String stage, String directive) {
        List<String> all = new ArrayList<>();
        for (String ancestor : ancestry(dockerfile, stage)) {
            all.addAll(instructions(dockerfile, ancestor));
        }
        return withDirective(all, directive);
    }

    /** The stage or image named in the stage's FROM line. */
    static String parent(String dockerfile, String stage) {
        String parent = parents(dockerfile).get(stage);
        assertTrue(parent != null, "the Dockerfile must declare a stage named " + stage);
        return parent;
    }

    /** The stage and the stages it derives from, root stage first. */
    static List<String> ancestry(String dockerfile, String stage) {
        Map<String, String> parents = parents(dockerfile);
        assertTrue(parents.containsKey(stage), "the Dockerfile must declare a stage named " + stage);
        List<String> chain = new ArrayList<>();
        for (String current = stage; parents.containsKey(current); current = parents.get(current)) {
            assertTrue(!chain.contains(current), "stage " + current + " must not derive from itself");
            chain.add(current);
        }
        Collections.reverse(chain);
        return chain;
    }

    /** The last stage, which an untargeted {@code docker build} produces. */
    static String finalStage(String dockerfile) {
        List<String> names = new ArrayList<>(parents(dockerfile).keySet());
        assertTrue(!names.isEmpty(), "the Dockerfile must declare named stages");
        return names.get(names.size() - 1);
    }

    /** Stage name to parent (stage name or image reference), in declaration order. */
    private static Map<String, String> parents(String dockerfile) {
        Map<String, String> parents = new LinkedHashMap<>();
        for (String line : uncommentedLines(dockerfile)) {
            Matcher matcher = STAGE_HEADER.matcher(line);
            if (matcher.matches()) {
                parents.put(matcher.group(2), matcher.group(1));
            }
        }
        return parents;
    }

    private static List<String> uncommentedLines(String dockerfile) {
        return dockerfile.lines()
                .map(String::strip)
                .filter(line -> !line.isEmpty() && !line.startsWith("#"))
                .toList();
    }

    private static String withDirective(List<String> instructions, String directive) {
        return instructions.stream()
                .filter(instruction -> instruction.startsWith(directive + " "))
                .collect(Collectors.joining("\n"));
    }
}
