package com.example.todoapi.architecture;

import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static com.tngtech.archunit.library.dependencies.SlicesRuleDefinition.slices;
import static com.tngtech.archunit.library.GeneralCodingRules.NO_CLASSES_SHOULD_USE_FIELD_INJECTION;
import static com.tngtech.archunit.library.GeneralCodingRules.NO_CLASSES_SHOULD_ACCESS_STANDARD_STREAMS;

/**
 * STATE-OF-THE-ART (SOTA) MODULAR MONOLITH ARCHITECTURAL ALIGNMENT TESTS
 * 
 * Why this is used:
 * As codebases grow, developers can easily violate structural boundaries.
 * ArchUnit tests enforce modular boundaries automatically during unit test phases.
 * It prevents architectural decay with zero external dependencies and zero runtime overhead!
 */
@AnalyzeClasses(packages = "com.example.todoapi", importOptions = ImportOption.DoNotIncludeTests.class)
public class ArchitectureTest {

    // 1. Enforce that modules are free of cyclic dependencies
    @ArchTest
    static final ArchRule modules_should_be_free_of_cycles = slices()
            .matching("com.example.todoapi.(*)..")
            .should().beFreeOfCycles();

    // 2. Enforce that Core module does not depend on feature modules
    @ArchTest
    static final ArchRule core_module_should_not_depend_on_feature_modules = noClasses()
            .that().resideInAPackage("..core..")
            .should().dependOnClassesThat().resideInAnyPackage("..appointment..", "..auth..", "..notification..");

    // 3. Enforce Constructor-based Dependency Injection (bans obsolete @Autowired field injection)
    @ArchTest
    static final ArchRule no_field_injection_allowed = NO_CLASSES_SHOULD_USE_FIELD_INJECTION;

    // 4. Enforce proper SLF4J logger usage (bans raw System.out or System.err prints in main sources)
    @ArchTest
    static final ArchRule no_standard_streams_allowed = NO_CLASSES_SHOULD_ACCESS_STANDARD_STREAMS;
}

