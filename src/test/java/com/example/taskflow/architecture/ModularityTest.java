package com.example.taskflow.architecture;

import com.example.taskflow.TaskflowApplication;
import org.junit.jupiter.api.Test;
import org.springframework.modulith.core.ApplicationModules;

/**
 * Spring Modulith verification of the application's modular monolith structure.
 *
 * <p>Replaces flat, hand-rolled cross-module cycle + dependency rules. Modulith
 * derives modules from the package structure of {@link TaskflowApplication}'s
 * subpackages ({@code appointment}, {@code auth}, {@code catalog},
 * {@code notification}, {@code review}, {@code core}) and verifies that:
 *
 * <ul>
 *   <li>each module's {@code internal/} subpackage is only accessed from within
 *       that same module — repositories in
 *       {@code com.example.taskflow.X.internal} are not directly referenced by
 *       other modules, forcing cross-module access to go through the module's
 *       public service API (e.g. {@code CatalogService.findServiceByName},
 *       {@code AppointmentService.findByPublicId});</li>
 *   <li>the module dependency graph is free of cycles;</li>
 *   <li>module names, named interfaces, and package-info declarations (when
 *       present) are consistent.</li>
 * </ul>
 *
 * <p>The classic ArchUnit rules in {@link ArchitectureTest} (no field injection,
 * no standard streams, no core → feature dependencies) continue to enforce
 * cross-cutting coding standards that Modulith does not cover natively; the two
 * suites complement each other.
 *
 * <p>Auto-generated PlantUML/C4 diagrams of this module structure can be
 * produced by {@code ApplicationModules.of(TaskflowApplication.class)
 * .documenter().writeDocumentation()}.
 */
class ModularityTest {

    @Test
    void verifyModularityStructure() {
        ApplicationModules.of(TaskflowApplication.class).verify();
    }
}