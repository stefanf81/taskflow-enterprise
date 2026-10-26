# Java 25 runtime image security assessment — 2026-10-23

## Decision and scope

Keep the latest available official `eclipse-temurin:25-jre-resolute` image,
**digest-pinned**, as requested. The registry was rechecked on 2026-10-23:

```text
sha256:41d9263c0d5b2a74d89af6e29e73b04298bc65e3cb705d03e9e2271ef49fef84
Temurin 25.0.4.1+1 / Ubuntu 26.04
```

Do not treat a version lag alone as a release failure, or a passing image scan
as proof that the runtime has no vulnerabilities. The former blanket requirement
to wait specifically for a 25.0.5 image is replaced by this assessment. The
remaining native-amd64 performance and release-approval requirements in
BENCHMARKS.md §62 still apply. No production deployment, image publication or
new vulnerability suppression was performed.

## Scan evidence

Trivy **0.76.1**, vulnerability scanner only, **all severities**, unfixed findings
included, `--ignorefile /dev/null` (no repository suppressions). Database timestamps:

- Vulnerability DB updated: **2026-10-23 07:12:39 UTC**.
- Java DB updated: **2026-10-23 01:03:33 UTC**.

The production targets were rebuilt with a fresh `APT_BUST` (APT refresh and
upgrade). Both strict `AOTMode=on` build-time application boots passed. The amd64
build ran under emulation on Apple Silicon: this validates image construction,
not native amd64 throughput.

| Scanned image | HIGH / CRITICAL | MEDIUM | LOW | Findings with a published fix in the scan |
| --- | ---: | ---: | ---: | ---: |
| Pinned base, arm64 | 4 / 0 | 54 | 5 | 15 |
| Refreshed production, arm64 | 0 / 0 | 44 | 4 | 0 |
| Refreshed production, amd64 | 0 / 0 | 44 | 4 | 0 |

Counts are package/CVE findings, not unique CVEs. Each production scan has
**38 unique CVEs**, all in Ubuntu packages; application-JAR scanning reports
**0 findings**. The production image has 109 installed packages. The base has
106; its four HIGH findings are in the unused Go `pebble` binary, removed by the
production target. The production APT refresh also fixes the base's
`zlib1g` finding, **CVE-2026-85091**. No scanner-reported HIGH/CRITICAL findings
remain, even without `--ignore-unfixed` or the repository ignore list.

Scanned local image IDs (these are local build outputs, **not** published
production or rollback digests):

- arm64: `sha256:01158ad06f89b4c5886342e6a8b63ac0f9951e53802738f350e3112c41301bfd`
- amd64: `sha256:0248705af3d1846b437e565859d6af7671cdf23efe209732a1aa335d2647d9e0`

Reproduce against the exact image being considered for release:

```bash
trivy image --scanners vuln --ignorefile /dev/null --format json \
  --output production-trivy.json <application-image@digest>
```

Raw JSON for this assessment is retained locally in
`/private/var/folders/g2/csgjk_n94fg3zf5g5q7snpx40000gn/T/opencode/j25/`:
`base-trivy.json`, `prod-trivy.json`, `prod-amd64-trivy.json`. Preserve fresh
reports with release artifacts when promoting an image; these temporary paths
are not durable evidence for a later release.

## Unfixed Ubuntu findings: contextual assessment

All 48 production package findings have an empty fixed-version field in the
Ubuntu feed used by Trivy. That means no fix was reported for those packages in
this scan, not that upstream fixes do not exist or that the issues are harmless.

| Component | Representative findings | Application context and residual risk |
| --- | --- | --- |
| glibc | CVE-2026-18374, CVE-2026-89092 | The JVM links glibc, so this is not an unused dependency. The former requires an attacker-controlled `fopen` mode/`,ccs=` argument; no such application path was identified. The latter targets `nscd`, whose executable is absent. Native-library call paths were not exhaustively audited. |
| dash | CVE-2026-102473, CVE-2026-102474 | Production starts Java directly through tini, with no shell health check. No subprocess APIs were found in application source. This reduces the apparent exposure but does not eliminate all shell/library attack paths after another compromise. |
| PCRE2 | CVE-2026-103111, CVE-2026-86145, CVE-2026-89156/89157/89158/89160/89161/89162 | These concern native regex processing/JIT/serialization. Application Java regexes do not use PCRE2. No application subprocess invocation was found; transitive native usage was not proven absent. |
| Expat / p11-kit | CVE-2025-66382, CVE-2026-13757 | Malformed XML and PKCS#11 RPC parsing respectively. No direct application use of these native parsers was found. JDK XML and JCA usage should not be confused with proof that these specific native paths execute. |
| rust-coreutils / tar | CVE-2026-35341 through CVE-2026-35377 (the affected subset in the scan), CVE-2026-18477, CVE-2026-18508 | Mostly utility file operations, TOCTOU races and archive extraction. No application shell/command execution or uploaded-archive extraction path was found. Read-only root, dropped capabilities and non-root UID reduce impact; writable volumes still exist. |
| systemd libraries / shadow | CVE-2026-40228, CVE-2024-56433 | The container runs neither systemd-journald nor account-provisioning services. All setuid/setgid bits are stripped. No demonstrated remote request path; keep tracking distribution fixes. |

These are contextual observations, **not VEX declarations or false-positive
suppressions**. Reassess when adding native parsing, user-controlled regexes,
subprocesses, archive extraction or new writable mounts.

## JRE coverage gap: known issues outside this Trivy report

Trivy's results enumerate Ubuntu packages and application JARs (plus Go in the
base); they do **not** report the independently installed Temurin JRE as a
vulnerability target. The absence of Java runtime findings is not a clean bill
of health for `/opt/java/openjdk`.

The [OpenJDK advisory dated 2026-10-20](https://openjdk.org/groups/vulnerability/advisories/2026-10-20)
explicitly lists **25.0.4.1** as affected, and recommends upgrading as soon as
possible. This is a **known patched-upstream security gap**, not merely an
unknown consequence of using an older version. APT cannot update this JRE.

Priority findings for this service include:

| CVE / component | Advisory score | Assessment |
| --- | ---: | --- |
| [CVE-2026-91415 — 2D](https://www.cve.org/CVERecord?id=CVE-2026-91415) | HIGH, 7.0 | The `java.desktop` module is present, but no AWT/ImageIO/image-processing APIs were found in application source. Frontend assets are not processed by this backend. No demonstrated request path; module presence means this cannot be dismissed solely because the service is headless. |
| [CVE-2026-91398 — Networking/SOCKS5](https://www.cve.org/CVERecord?id=CVE-2026-91398) | MEDIUM, 6.8 | Requires SOCKS5 exposure. No SOCKS configuration was found in checked-in application/compose configuration. Deployment environment and JVM flags must also be checked; this is not a blanket Networking exemption. |
| [CVE-2026-87294 — Security](https://www.cve.org/CVERecord?id=CVE-2026-87294) | MEDIUM, 6.5 | The application uses Java security APIs for RSA/JWT. The public advisory does not identify enough detail to prove the vulnerable subpath unreachable. Treat as unresolved potentially relevant confidentiality/integrity risk, not a false positive. |
| [CVE-2026-91373 — JSSE](https://www.cve.org/CVERecord?id=CVE-2026-91373) | MEDIUM, 5.3 | Network TLS partial DoS. Checked-in backend transport is HTTP behind nginx and OTLP uses HTTP, reducing direct inbound JSSE exposure. TLS-enabled database/exporter connections or other outbound Java TLS can change reachability; the actual production configuration is in another repository and was not audited here. |

The complete advisory also lists Java 25 issues in other networking, XML,
SQL, security and HotSpot components. No custom XML parser was found in source,
but JDBC and security components are used; this review does **not** certify all
those paths as unreachable. Oracle's CVE records above were cross-checked
against the OpenJDK affected-version matrix; they are not scanner detections.

## Java 21 rollback image (recorded 2026-10-26)

The §62 rollback requires the complete previous **application image** digest,
not just its base: the Java 25 JAR is class-file version 69 (Java 21 accepts at
most 65) and the Dockerfile uses Java 25 AOT flags, so changing only
`JAVA_IMAGE` back will not start.

The last backend image published before the Java 25 upgrade (`fd87e8f`) is:

```
ghcr.io/stefanf81/taskflow-backend@sha256:7a026aae390d96c3a6cfb4eed1639352bd52d1e9a7126f6e422d9b245fe9ec6e
```

| | |
| :--- | :--- |
| Source commit | `0d1a06c24422b626cfdd6a5e98235840257421c0` |
| Workflow run | [#52, 2026-10-21](https://github.com/stefanf81/taskflow-enterprise/actions/runs/39571487017) (`JAVA_VERSION: 21`) |
| Tags pushed then | `:0d1a06c24422b626cfdd6a5e98235840257421c0` and `:latest` |

Run #53 (`d7be207`, 2026-10-23) is the first backend image built after the Java
25 commit, so #52 is the boundary. The immutable commit-SHA tag still addresses
this digest; `:latest` has since moved to Java 25.

**Still required of the operator**, because neither is visible from this
repository:

1. **Confirm this is the digest actually deployed.** The GitOps manifests live
   in the separate `homelab/TF` repository, and the running deployment may pin
   an older image than the newest Java 21 build. Compare against the cluster
   (`kubectl get deploy taskflow-backend -o jsonpath='{..image}'`) and record
   the deployed digest if it differs — that one, not this one, is the rollback
   target.
2. **Pin it against retention.** A digest survives only while something
   references it. Confirm the GHCR package retention policy (and any untagged
   cleanup) will not prune it, or add a durable tag such as
   `:rollback-java21`.

## Operational conclusion

- Keep the current latest-available official base **digest pin**; no new
  `.trivyignore` entries or weakened CI scanner thresholds are needed.
- Scanner gate result: **passes**, including unfixed HIGH/CRITICAL findings in
  the scanned package inventory. This is narrower than an overall security
  approval because the JRE was not covered by the scanner.
- Production approval must explicitly consider the unresolved JRE security/TLS
  risks above and the deployed TLS/SOCKS settings. This assessment does not
  silently accept those risks on the operator's behalf or claim production is
  vulnerability-free. Native amd64 performance and rollback preparation remain
  required independently of security.
- Track the upstream image release and Renovate digest update; move promptly to
  the patched runtime when available, rebuilding the AOT cache, rescanning both
  target architectures and rerunning smoke checks. The current base is a
  deliberate interim candidate, not a reason to stop patching.
