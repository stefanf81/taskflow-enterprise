package com.example.taskflow.architecture;

import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;

import static com.tngtech.archunit.library.GeneralCodingRules.NO_CLASSES_SHOULD_USE_FIELD_INJECTION;
import static com.tngtech.archunit.library.GeneralCodingRules.NO_CLASSES_SHOULD_ACCESS_STANDARD_STREAMS;

/**
 * Coding-standard rules that Spring Modulith's {@link ModularityTest} does not cover. Module
 * boundaries themselves (cycles, internal access, allowed dependencies) live there.
 */
@AnalyzeClasses(packages = "com.example.taskflow", importOptions = ImportOption.DoNotIncludeTests.class)
public class ArchitectureTest {

    // Module cycles, illegal cross-module access and the allowed dependency graph (package-info
    // @ApplicationModule) are verified by ModularityTest through Spring Modulith.

    // 1. Enforce Constructor-based Dependency Injection (bans obsolete @Autowired field injection)
    @ArchTest
    static final ArchRule no_field_injection_allowed = NO_CLASSES_SHOULD_USE_FIELD_INJECTION;

    // 2. Enforce proper SLF4J logger usage (bans raw System.out or System.err prints in main sources)
    @ArchTest
    static final ArchRule no_standard_streams_allowed = NO_CLASSES_SHOULD_ACCESS_STANDARD_STREAMS;
}

