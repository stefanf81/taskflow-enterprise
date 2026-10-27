# ADR-021: Service Worker for the Web App — Scope and Recommendation

**Status:** Proposed (recommendation: **do not adopt yet**; see Decision)

## Context

`@angular/service-worker` is the one widely-adopted Angular performance feature this app
does not use, and it was raised as the clearest remaining gap after §63 took the booking
wizard out of the eager bundle (initial JS 545 → 441 kB raw, 147 → 122 kB transfer).

The assets are already shaped well for it: content-hashed bundles served
`public, immutable, max-age=15552000`, SRI on every script, an integrity-carrying import
map, and Brotli-11 sidecars. For loading the worker script the CSP needs no change: it has
no `worker-src` or `child-src`, so `worker-src` falls back to `script-src`, whose `'self'`
already permits a same-origin worker. Registering it is a different matter (item 6 below).

Before scoping the work, the realistic payoff was estimated against what the app already
does, because that turns out to decide the question.

### What a repeat visit costs today

| | Served from | Cost on a repeat visit |
| :--- | :--- | :--- |
| `main.js`, chunks, CSS | HTTP cache, `immutable` | **0 RTT**, no revalidation |
| Inter woff2 | HTTP cache, 1 h + revalidate | 0 RTT within the hour |
| `index.html` / `index.csr.html` | `no-cache`, ETag | **1 RTT**, usually a 304 |
| `/api/v1/catalog`, `/barbers` | `max-age=300, public` | 0 RTT within 5 min, else 1 RTT |

So the service worker's achievable win on a warm repeat visit is **one RTT for the shell
revalidation**, plus the catalog round trip outside its 5-minute window. The immutable
asset caching that normally makes service workers dramatic is already in place and
already free. The remaining genuine capability is **offline / flaky-network operation**,
which is a product decision, not a performance one.

### What makes it harder here than in a typical Angular app

1. **Two shells, chosen by cookie.** nginx serves the prerendered `index.html` for `/`
   without an `access_token` cookie, and `index.csr.html` for every other route *and* for
   `/` when that cookie is present — which is why `/` alone sends `Vary: Cookie`.
   `ngsw-config.json` has a single `index`, and the generated worker answers navigation
   requests from it. A worker that caches the guest `index.html` and then serves it to a
   signed-in visitor on `/` shows them the guest landing page from cache. Any adoption
   must either keep `/` out of the worker's navigation handling
   (`navigationUrls` exclusions) or force `navigationRequestStrategy: 'freshness'`, which
   gives back the one RTT that was the entire performance case.
2. **Admin SSE must not be intercepted.** `AdminEventsService` holds an `EventSource` on
   `/api/v1/appointments/events`. A `dataGroups` entry or a catch-all fetch handler that
   buffers that response breaks the stream exactly as `ShallowEtagHeaderFilter` did before
   it was made to skip SSE (§44). It must be explicitly excluded, and covered by a test.
3. **Nothing authenticated may be cached.** `/auth/me`, the admin listings and
   `busy-slots` (30 s private, volatile) must stay out of `dataGroups`. Caching `/auth/me`
   in a worker that outlives a logout is a security bug, not a staleness bug. Only the
   public, already-`cachePublic` endpoints (catalog, barbers, barber-ratings) are
   candidates.
4. **Stale slot data has real consequences.** The mobile gotcha already recorded for
   `staleTime` applies harder to a worker: showing a cached slot that is now `DENIED`
   sends a customer into a booking that will fail.
5. **Version skew becomes sticky.** Today a deploy is picked up on the next load because
   both shells are `no-cache`. With a worker, a client stays on the activated version
   until the worker updates; `SwUpdate` handling and a reload prompt become mandatory
   rather than optional.
6. **Trusted Types is enforced.** The CSP sets `require-trusted-types-for 'script'` with
   only the `angular` and `angular#bundler` policies. `navigator.serviceWorker.register()`
   is a Trusted Types sink (it takes a `TrustedScriptURL`), so registration is **expected to
   be blocked** unless Angular passes a URL created through an allowed policy, or a policy
   for it is added to `trusted-types`. What Angular's `provideServiceWorker` does under this
   CSP is unverified and must be checked on the built image before any adoption, not after.

## Decision

**Do not adopt a service worker as a performance measure.** The measured headroom is one
RTT on repeat navigations, and the dual-shell `Vary: Cookie` constraint means the most
likely safe configuration (`freshness` navigation) spends exactly that RTT anyway.

**Revisit if offline or poor-network operation becomes a product requirement** — for
guests browsing the menu on bad mobile connections, or for the admin dashboard on venue
wifi. The capability, not the latency, is what would justify it.

If it is revisited, the scope is:

1. `ngsw-config.json`: `assetGroups` for the hashed bundles (`prefetch`) and `public/`
   assets (`lazy`); `dataGroups` restricted to the three public catalog endpoints with
   `strategy: freshness` and a short `maxAge`; explicit exclusion of
   `/api/v1/appointments/events`, `/api/v1/auth/**`, `busy-slots` and all admin paths.
2. `navigationUrls` excluding `/` while the cookie-driven shell split stands, or a
   documented decision to serve one shell for both cases.
3. `provideServiceWorker('ngsw-worker.js', { enabled: !isDevMode(), registrationStrategy: 'registerWhenStable:30000' })`,
   plus `SwUpdate.versionUpdates` wired to a reload prompt.
4. Verification before merge: Trusted Types check on the built image; an e2e test that the
   admin SSE stream still delivers events with the worker active; an e2e test that a
   signed-in visitor on `/` is not served the cached guest landing; a deploy-skew test
   (activate v1, publish v2, confirm the update prompt).

## Consequences

### Positive (of not adopting)
- No cache layer in front of a cookie-selected shell, which is the failure mode most
  likely to produce a confusing, hard-to-reproduce bug for signed-in users.
- Deploys keep taking effect on the next load.
- No new moving part between the CSP/SRI inventory and what the browser executes.

### Negative (of not adopting)
- No offline capability at all; a dropped connection is a failed page load.
- Repeat visits keep paying one shell-revalidation RTT that a worker could remove.

## Verification

Figures and the §63 bundle numbers come from a production build of this repository; the
cache-header and shell-selection behaviour from `frontend/nginx.conf` and the Dockerfile
CSP generation. The Trusted Types interaction with `ngsw-worker.js` is explicitly **not**
verified and is listed above as a gate, not an assumption.
