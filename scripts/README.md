# TaskFlow Workspace Utility Scripts

This directory contains utility, benchmarking, and CI/CD security automation scripts used across the TaskFlow monorepo.

## Scripts Inventory

| Script | Runtime | Description |
| :--- | :--- | :--- |
| `check-openapi-contract.js` | Node.js | Fetches `/v3/api-docs` from a running backend, canonicalizes key ordering, and validates or writes the canonical `api/openapi.json` contract baseline. |
| `sync-api-types.js` | Node.js | Deterministically generates TypeScript API interfaces for Web (`frontend/src/app/types/api.ts`) and Mobile (`mobile/src/types/api.ts`) from `api/openapi.json`. |
| `prepare-nuclei-sarif.py` | Python 3 | Ingests raw Nuclei scanner output and formats it into strict GitHub Code Scanning SARIF format with deterministic run metadata and error handling. |
| `test_nuclei_sarif.py` | Python 3 | Unit tests covering `prepare-nuclei-sarif.py` SARIF translation logic. |
| `zap2sarif.py` | Python 3 | Parses OWASP ZAP DAST API and Web JSON reports and converts them to SARIF format for GitHub Advanced Security ingestion. |
| `benchmark-cds-startup.sh` | Bash | Measures Spring Boot cold-start latency with and without JVM Class Data Sharing (`application.jsa`). |
| `benchmark-glibc-tuning.sh` | Bash | Generates load sweeps via `hey` and measures container RSS memory across glibc allocator configurations (`MALLOC_ARENA_MAX=2` vs defaults). |
| `prepare-booking-time-migration.sh` | Bash | K8s PreSync job script used by GitOps to backfill and zero-pad 4-character appointment times (`H:mm` → `HH:mm`) prior to SQL `TIME` column conversion. |

---

## Detailed Usage

### 1. OpenAPI Contract Management

#### Validate Contract Baseline
Checks whether the checked-in `api/openapi.json` is canonical and formatted correctly:
```bash
npm run api:spec:check
# Runs: node scripts/check-openapi-contract.js api/openapi.json
```

#### Update Contract Baseline from Running Backend
Fetches the live OpenAPI specification from a running local backend (`:8080`), authenticates with admin credentials, and updates `api/openapi.json`:
```bash
npm run api:spec:update
# Runs: node scripts/check-openapi-contract.js --write --auth http://localhost:8080/v3/api-docs
```

#### Generate / Check Client TypeScript Types
Generates client contracts for Angular Web and React Native Mobile:
```bash
npm run sync:api-types
# Runs: node scripts/sync-api-types.js api/openapi.json
```

Verify that client types are synchronized and not stale (fails in CI if stale):
```bash
npm run sync:api-types:check
# Runs: node scripts/sync-api-types.js --check api/openapi.json
```

---

### 2. DAST & Security Scanning SARIF Converters

#### Convert OWASP ZAP Reports
```bash
python3 scripts/zap2sarif.py <path-to-zap-report.json> <output.sarif>
```

#### Convert Nuclei Reports
```bash
python3 scripts/prepare-nuclei-sarif.py \
  --input nuclei-output.json \
  --output nuclei.sarif \
  --exit-code 0 \
  --category nightly-external-nuclei
```

Run test suite:
```bash
python3 -m unittest scripts/test_nuclei_sarif.py -v
```

---

### 3. Performance & Benchmark Scripts

#### Benchmark JVM CDS Cold Start
```bash
./scripts/benchmark-cds-startup.sh
```

#### Benchmark glibc Memory Allocator (`MALLOC_ARENA_MAX`)
```bash
./scripts/benchmark-glibc-tuning.sh
```
