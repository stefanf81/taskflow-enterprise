#!/usr/bin/env bash
# Copy into an application's ci/build_and_test.sh and ADAPT to its build system.
# This is a Java/Maven starting point. Add your real SAST, SCA, unit and integration
# tests; DAST belongs in a separate environment-tested release gate.
#
# REQUIRED: the build outputs must be byte-for-byte reproducible. The publish pipeline builds
# the application on two independent workers and refuses to continue unless the declared
# outputs (APP_BUILD_OUTPUTS) are identical. A default Maven build is NOT reproducible: the jar
# stores build-time timestamps. Setting project.build.outputTimestamp fixes them; here it is
# taken from the commit time, which is the same on every worker. (Verified with Maven 3.9.11 /
# maven-jar-plugin 3.4.1. Spring Boot's repackage goal reads the same property per its docs.)
# Other build tools need their own equivalent, e.g. Gradle: preserveFileTimestamps = false and
# reproducibleFileOrder = true on archive tasks.
#
# The release workflow builds from a `git archive` of the authorized commit (no .git directory)
# and sets APP_COMMIT, SOURCE_DATE_EPOCH and BUILD_OUTPUT_TIMESTAMP (commit time, ISO 8601).
# Read commit metadata from those variables, not from git. The `git show` fallback below is
# only for local runs and the application's own PR workflow, which do have a checkout.
#
# CI_SKIP_TESTS=1 is a hint from the pipeline for the second, comparison-only build. Honouring
# it is optional; skipping tests must not change the outputs.
set -Eeuo pipefail
timestamp="${BUILD_OUTPUT_TIMESTAMP:-$(git show -s --format=%cI HEAD)}"
args=(-B -ntp "-Dproject.build.outputTimestamp=$timestamp")
if [ "${CI_SKIP_TESTS:-0}" = 1 ]; then
  args+=(-DskipTests)
fi
mvn "${args[@]}" clean verify
test -s target/app.jar || { echo 'Missing target/app.jar' >&2; exit 1; }
