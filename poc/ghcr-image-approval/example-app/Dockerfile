# Built ONLY by the central release pipeline (stefanf81/ghcr-approval-poc,
# application-release.yml), offline and twice, from an approved and signed base.
# The digest is the one pinned in that repository's catalog/Dockerfile.temurin: base approval
# copies the upstream index byte for byte, so the approved digest equals the upstream one.
# Rules enforced by its scripts/check_dockerfile_bases.py: every FROM is an approved
# ghcr.io/stefanf81/approved/... image pinned by digest; no ADD, no RUN flags, no # syntax=.
FROM ghcr.io/stefanf81/approved/eclipse-temurin:21-jre-resolute@sha256:577acb7ab9893a6dfd6bcb138a25a4fb579ef1f3abcd197e24d9752e33457d85
WORKDIR /opt/app
# --chmod is required: the pipeline's image_build step runs under `umask 077` and recreates the
# jar from its packed outputs, so the build-context file is 0600. COPY keeps that mode, and
# the non-root user below could not read the jar.
COPY --chmod=0444 target/app.jar /opt/app/app.jar
USER 10001:10001
ENTRYPOINT ["java", "-jar", "/opt/app/app.jar"]
