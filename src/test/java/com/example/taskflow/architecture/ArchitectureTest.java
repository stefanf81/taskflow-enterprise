package com.example.taskflow.architecture;

import com.tngtech.archunit.base.DescribedPredicate;
import com.tngtech.archunit.core.domain.AccessTarget;
import com.tngtech.archunit.core.domain.JavaAccess;
import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.Year;
import java.time.YearMonth;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static com.tngtech.archunit.library.GeneralCodingRules.NO_CLASSES_SHOULD_USE_FIELD_INJECTION;
import static com.tngtech.archunit.library.GeneralCodingRules.NO_CLASSES_SHOULD_ACCESS_STANDARD_STREAMS;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Coding-standard rules that Spring Modulith's {@link ModularityTest} does not cover. Module
 * boundaries themselves (cycles, internal access, allowed dependencies) live there.
 */
@AnalyzeClasses(packages = {"com.example.taskflow", "db.migration"}, importOptions = ImportOption.DoNotIncludeTests.class)
public class ArchitectureTest {

    // Module cycles, illegal cross-module access and the allowed dependency graph (package-info
    // @ApplicationModule) are verified by ModularityTest through Spring Modulith.

    // 1. Enforce Constructor-based Dependency Injection (bans obsolete @Autowired field injection)
    @ArchTest
    static final ArchRule no_field_injection_allowed = NO_CLASSES_SHOULD_USE_FIELD_INJECTION;

    // 2. Enforce proper SLF4J logger usage (bans raw System.out or System.err prints in main sources)
    @ArchTest
    static final ArchRule no_standard_streams_allowed = NO_CLASSES_SHOULD_ACCESS_STANDARD_STREAMS;

    /** The java.time types whose no-arg {@code now()} reads the JVM's wall clock and default zone. */
    private static final List<Class<?>> WALL_CLOCK_TYPES = List.of(LocalDate.class, LocalDateTime.class,
            LocalTime.class, Instant.class, ZonedDateTime.class, OffsetDateTime.class, Year.class, YearMonth.class);

    /**
     * Calls that may keep the no-arg {@code now()}, as {@code "<fully qualified class>#<method>"} with
     * the reason. Keep it minimal: every entry is time a test cannot control. Empty: every former
     * call takes the injected shop {@code Clock} or, for JWTs, {@code TokenProvider.TOKEN_CLOCK}.
     */
    private static final Map<String, String> NO_ARG_NOW_ALLOWLIST = Map.of();

    private static final DescribedPredicate<JavaAccess<?>> NO_ARG_NOW = DescribedPredicate.describe(
            "a no-arg now() of " + WALL_CLOCK_TYPES.stream().map(Class::getSimpleName).toList(),
            ArchitectureTest::isNoArgNow);

    // 3. AGENTS.md: inject the Clock, never call no-arg now(). "Past", "today" and "tomorrow" are
    //    decided in the shop's time zone (ClockConfig), and tests replace the Clock to move time.
    //    Method references (Instant::now) count as well as calls.
    @ArchTest
    static final ArchRule no_wall_clock_now = noClasses()
            .should().accessTargetWhere(NO_ARG_NOW)
            .because("AGENTS.md: inject the Clock and use now(clock); see NO_ARG_NOW_ALLOWLIST for exceptions");

    private static boolean isNoArgNow(JavaAccess<?> access) {
        if (!(access.getTarget() instanceof AccessTarget.CodeUnitAccessTarget target)
                || !"now".equals(target.getName())
                || !target.getRawParameterTypes().isEmpty()
                || WALL_CLOCK_TYPES.stream().noneMatch(type -> target.getOwner().isEquivalentTo(type))) {
            return false;
        }
        String origin = access.getOriginOwner().getName() + "#" + access.getOrigin().getName();
        return !NO_ARG_NOW_ALLOWLIST.containsKey(origin);
    }

    /** The rule itself must catch calls and method references, and leave now(clock) alone. */
    @Test
    void theWallClockRuleCatchesNoArgNowCallsAndReferences() {
        JavaClasses offenders = new ClassFileImporter().importClasses(CallsNow.class, ReferencesNow.class);
        AssertionError error = assertThrows(AssertionError.class, () -> no_wall_clock_now.check(offenders));
        assertTrue(error.getMessage().contains("was violated (2 times)"), error.getMessage());
        assertTrue(error.getMessage().contains("CallsNow.today()"), error.getMessage());
        assertTrue(error.getMessage().contains("ReferencesNow.now()"), error.getMessage());

        JavaClasses compliant = new ClassFileImporter().importClasses(UsesClock.class);
        assertDoesNotThrow(() -> no_wall_clock_now.check(compliant));
    }

    static final class CallsNow {
        LocalDate today() {
            return LocalDate.now();
        }
    }

    static final class ReferencesNow {
        Supplier<Instant> now() {
            return Instant::now;
        }
    }

    static final class UsesClock {
        LocalDateTime now(java.time.Clock clock) {
            return LocalDateTime.now(clock);
        }
    }
}
