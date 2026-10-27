package com.example.taskflow.architecture;

import com.example.taskflow.TaskflowApplication;
import org.junit.jupiter.api.Test;
import org.springframework.modulith.core.ApplicationModules;

/**
 * Spring Modulith verification of the modular monolith. Modules are the direct sub-packages of
 * {@link TaskflowApplication}'s package ({@code appointment}, {@code auth}, {@code catalog},
 * {@code notification}, {@code review}, {@code core}); each declares its allowed dependencies in
 * its {@code package-info.java}. {@code verify()} fails on:
 *
 * <ul>
 *   <li>a dependency cycle between modules;</li>
 *   <li>a reference into another module's non-API packages (e.g. its {@code internal} repositories);</li>
 *   <li>a dependency a module did not declare in {@code allowedDependencies}.</li>
 * </ul>
 *
 * <p>See ADR-022. {@link ArchitectureTest} keeps the coding-standard rules Modulith does not cover.
 * Diagrams: {@code ApplicationModules.of(TaskflowApplication.class).documenter().writeDocumentation()}.
 */
class ModularityTest {

    @Test
    void verifyModularityStructure() {
        ApplicationModules.of(TaskflowApplication.class).verify();
    }
}