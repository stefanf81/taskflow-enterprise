import { browser } from 'k6/browser';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL;
if (!BASE_URL) throw new Error('BASE_URL environment variable is required');

// How long to wait for time-slot API to return after picking a date.
const SLOT_LOAD_MS = 1500;

// web.dev "good" CWV budgets are only meaningful when the browser is close to
// the origin. The remote CI smoke test runs from a GitHub runner (US) against
// the EU-hosted origin, so its FCP/LCP reflect cross-region latency rather than
// real-user CWV. Default to enforcing them (same-region local/isolated runs)
// and let remote CI opt out with `-e ENFORCE_CWV=false`, keeping the functional
// and availability checks as the gate there.
const ENFORCE_CWV = __ENV.ENFORCE_CWV !== 'false';

// Directory for a screenshot of the page when a scenario fails (the workflow uploads it).
// Unset: no screenshot.
const RESULTS_DIR = __ENV.RESULTS_DIR;

// Also click a lookbook card the moment it appears, before the page has loaded (BENCHMARKS.md
// §70: production dropped that click). The booking flow below waits for the page to load
// first, so without this nothing here would notice the regression. `-e CHECK_EARLY_CLICK=false`
// skips it.
const CHECK_EARLY_CLICK = __ENV.CHECK_EARLY_CLICK !== 'false';

// Added to every request of the early-click page, so its scripts arrive after the prerendered
// card is clickable. Unthrottled, a runner close to the edge got them in ~45 ms and the check
// passed against a deployment that loses the click (k6 run 43112226328).
const EARLY_CLICK_LATENCY_MS = Number(__ENV.EARLY_CLICK_LATENCY_MS || 300);

export const options = {
  scenarios: {
    browser: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      options: { browser: { type: 'chromium' } },
    },
  },
  thresholds: {
    checks: ['rate==1.0'],
    // Gate real application traffic only. The anonymous session bootstrap
    // (GET /api/v1/auth/me -> 401 without a cookie, /api/v1/auth/csrf) is the
    // expected guest state, not a failure; the page.on('metric') handler below
    // re-tags it as `auth-probe` so it is excluded from this submetric.
    'browser_http_req_failed{url:app}': ['rate<0.01'],
    // ----- Web vital performance gates — CWV good thresholds -----
    // TTFB <800ms good per web.dev, FCP <1800, LCP <2500. Scoped to the booking flow's page
    // (`url:app`): the early-click page is throttled on purpose.
    ...(ENFORCE_CWV
      ? {
          'browser_web_vital_ttfb{url:app}': ['p(95)<800'],
          'browser_web_vital_fcp{url:app}': ['p(95)<1800'],
          'browser_web_vital_lcp{url:app}': ['p(95)<2500'],
        }
      : {}),
  },
};

export default async function () {
  // Each part gets its own browser context (k6 allows one open context at a time; closing a page
  // does not close its context). An error that escapes either one becomes a failed check:
  // an uncaught one did not fail the run (k6 run 43112226328 went green without the booking
  // flow).
  let failure = null;
  try {
    await bookingFlow();
  } catch (err) {
    failure = err;
  }
  if (CHECK_EARLY_CLICK) {
    try {
      await earlyClick();
    } catch (err) {
      console.error(`\n[FAIL] Early click threw: ${(err && err.message) || err}`);
      check(false, { '6.1 a lookbook click made while the page loads is not lost': () => false });
    }
  }
  if (failure) throw failure;
}

async function earlyClick() {
  console.log('--- 6. Lookbook click while the page loads ---');
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    // Kept out of the {url:app} submetrics (request failures, web vitals).
    page.on('metric', (metric) => {
      metric.tag({ name: 'early-click', matches: [{ url: /.*/ }] });
    });
    await page.throttleNetwork({ latency: EARLY_CLICK_LATENCY_MS, download: -1, upload: -1 });
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const card = page.locator('app-lookbook button').first();
    await card.waitFor({ state: 'visible', timeout: 10000 });
    await card.click();
    const advanced = await page
      .locator('#step-panel-2')
      .waitFor({ state: 'visible', timeout: 10000 })
      .then(
        () => true,
        () => false,
      );
    check(advanced, {
      '6.1 a lookbook click made while the page loads is not lost': (v) => v === true,
    });
    if (!advanced && RESULTS_DIR) {
      await page
        .screenshot({ path: `${RESULTS_DIR}/failed-early-click.png`, fullPage: true })
        .catch((screenshotError) => console.error(`screenshot failed: ${screenshotError}`));
    }
  } finally {
    await context.close();
  }
}

async function bookingFlow() {
  let context;
  let page;
  try {
    context = await browser.newContext();
    page = await context.newPage();
  } catch (err) {
    console.error(`\n[FAIL] Could not open the browser page: ${(err && err.message) || err}`);
    check(false, { 'scenario "init" completed': () => false });
    throw err;
  }

  // Separate the expected anonymous session bootstrap from real application
  // traffic before navigation. Collapse per-URL cardinality into `app`, then
  // re-tag /auth/me and /auth/csrf as `auth-probe`; the
  // browser_http_req_failed{url:app} threshold then gates only app requests.
  page.on('metric', (metric) => {
    metric.tag({ name: 'app', matches: [{ url: /.*/ }] });
    metric.tag({
      name: 'auth-probe',
      matches: [{ url: /\/api\/v1\/auth\/(me|csrf)$/ }],
    });
  });

  let scenario = 'init';

  try {
    // ==============================================================
    // 1. PAGE LOAD — LANDING PAGE SMOKE TEST
    // ==============================================================
    scenario = 'page-load';
    console.log('--- 1. Page Load ---');

    await page.goto(BASE_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await page
      .locator('#step-panel-1')
      .waitFor({ state: 'visible', timeout: 10000 });
    // The landing page is prerendered: the wizard and the lookbook are on screen before main.js
    // has run, so "visible" does not mean "ready". This test checks that the booking flow works,
    // so let the page finish loading (scripts, lazy chunks, the first API answers) before
    // touching it. Clicks made earlier are a separate guarantee, pinned with controlled script
    // latency by frontend/e2e/early-interaction.spec.ts (BENCHMARKS.md §70: this test clicked a
    // lookbook card 80 ms after it appeared, and the page lost the click).
    await page.waitForLoadState('networkidle', { timeout: 30000 });

    const title = await page.title();
    check(title, {
      '1.1 title contains TaskFlow': (t) => t.includes('TaskFlow'),
    });

    // Confirm the wizard stepper (4-step tablist) rendered.
    const stepTabs = page.locator('button[role="tab"]');
    const tabCount = await stepTabs.count();
    check(tabCount, {
      '1.2 wizard stepper has 4 steps': (c) => c === 4,
    });

    // ==============================================================
    // 2. BOOKING WIZARD — LOOKBOOK SHORTCUT (picks service + advances)
    // ==============================================================
    scenario = 'wizard-step1-lookbook';
    console.log('--- 2. Wizard — Lookbook card ---');

    // Wait for the lookbook rather than falling back to an unrelated card in the first wizard
    // step (it is deferred until the browser is idle when the page is rendered client-side).
    // Cards are semantic <button> elements (a11y refactor); do not target div[role=button].
    const lookbookCard = page.locator('app-lookbook button').first();
    await lookbookCard.waitFor({ state: 'visible', timeout: 10000 });
    await lookbookCard.click();
    await page
      .locator('#step-panel-2')
      .waitFor({ state: 'visible', timeout: 10000 });
    check(await page.locator('#step-panel-2').count(), {
      '2.1 lookbook advances to stylist selection': (c) => c === 1,
    });

    // ==============================================================
    // 3. BOOKING WIZARD — STEP 2: STYLIST SELECTION
    // ==============================================================
    scenario = 'wizard-step2-stylist';
    console.log('--- 3. Wizard — Stylist selection ---');

    // Stylist cards are <app-stylist-card> buttons named by their visible text.
    const stylistCard = page
      .locator('#step-panel-2 app-stylist-card button')
      .first();
    await stylistCard.waitFor({ state: 'visible', timeout: 10000 });
    await stylistCard.click();
    check(await page.locator('#step-panel-2 app-stylist-card button').count(), {
      '3.1 a stylist is available for selection': (c) => c >= 1,
    });

    // Advance to step 3 only after the selected stylist has rendered.
    await page.locator('.wizard-footer-controls button.btn-submit').click();
    await page
      .locator('#step-panel-3')
      .waitFor({ state: 'visible', timeout: 10000 });

    // ==============================================================
    // 4. BOOKING WIZARD — STEP 3: DATE & TIME SLOT
    // ==============================================================
    scenario = 'wizard-step3-datetime';
    console.log('--- 4. Wizard — Date & time slot ---');

    // Click first available date in the carousel.
    const dateBtns = page.locator('#step-panel-3 button.date-chip-btn');
    await dateBtns.first().waitFor({ state: 'visible', timeout: 10000 });
    const dateCount = await dateBtns.count();
    check(dateCount, {
      '4.1 date carousel has at least 1 day': (c) => c >= 1,
    });

    let timeSlotPicked = false;
    if (dateCount > 0) {
      await dateBtns.first().click();
      // The carousel only offers bookable days, so the busy-slots answer ends in either the slot
      // grid or the step's error alert ("Checking slot availability..." until then). Wait for
      // one of them instead of a fixed pause, which counted an empty grid on a slow network.
      await page
        .locator('.time-slots-grid button.slot-picker-btn, #step-panel-3 [role="alert"]')
        .first()
        .waitFor({ state: 'visible', timeout: SLOT_LOAD_MS + 10000 })
        .catch(() => undefined);

      // Time-slot buttons live in the dedicated grid; date buttons share the
      // `slot-picker-btn` class, so scope to the grid to avoid clicking a date.
      const slotBtns = page.locator(
        '.time-slots-grid button.slot-picker-btn:not([disabled])',
      );
      const totalSlotBtns = await page.locator('.time-slots-grid button.slot-picker-btn').count();
      const slotError = await page.locator('#step-panel-3 [role="alert"]').count();
      const slotCount = await slotBtns.count();
      check(totalSlotBtns, {
        '4.2 time-slot grid rendered without error': (c) => c > 0 && slotError === 0,
      });

      if (slotCount > 0) {
        await slotBtns.first().click();
        timeSlotPicked = true;
        check(true, { '4.3 time slot selected': () => true });

        // Advance to step 4.
        await page.locator('.wizard-footer-controls button.btn-submit').click();
        await page
          .locator('#step-panel-4')
          .waitFor({ state: 'visible', timeout: 10000 });
      } else {
        console.log(
          '  (no available slots — shop may be closed; skipping step 4)',
        );
        check(true, {
          '4.3 no time slots (shop closed or all booked) — step skipped': () =>
            true,
        });
      }
    }

    // ==============================================================
    // 5. BOOKING WIZARD — STEP 4: CUSTOMER INFO FORM
    // ==============================================================
    if (timeSlotPicked) {
      scenario = 'wizard-step4-form';
      console.log('--- 5. Wizard — Customer info form ---');

      const nameInput = page.locator('#customerName');
      if ((await nameInput.count()) > 0) {
        await nameInput.fill('K6 Test User');
        check(true, { '5.1 customer name filled': () => true });
      }

      const emailInput = page.locator('#customerEmail');
      if ((await emailInput.count()) > 0) {
        await emailInput.fill('k6-test@example.com');
        check(true, { '5.2 customer email filled': () => true });
      }

      const phoneInput = page.locator('#customerPhone');
      if ((await phoneInput.count()) > 0) {
        await phoneInput.fill('+1-555-0000');
        check(true, { '5.3 customer phone filled': () => true });
      }

      // Verify the submit button exists (do NOT click — we don't want to
      // create test bookings on the production database).
      const submitBtn = page.locator('#step-panel-4 button[type="submit"]');
      check((await submitBtn.count()) > 0, {
        '5.4 submit button visible (not clicked)': (v) => v === true,
      });
    }

    console.log('=== All scenarios completed ===');
  } catch (err) {
    // k6 browser rejects with a plain value for some failures (a locator timeout has no
    // `message`), which used to log "threw: undefined".
    console.error(`\n[FAIL] Scenario "${scenario}" threw: ${(err && err.message) || err}`);
    if (RESULTS_DIR) {
      // What the page looked like when it failed, e.g. the wizard still on step 1.
      await page
        .screenshot({ path: `${RESULTS_DIR}/failed-${scenario}.png`, fullPage: true })
        .catch((screenshotError) => console.error(`screenshot failed: ${screenshotError}`));
    }
    // Turn an aborted scenario into a failed check so the `checks rate==1.0`
    // threshold fails the run. A bare rethrow alone does not guarantee a
    // non-zero exit, which previously let a scenario failure pass unnoticed.
    check(false, { [`scenario "${scenario}" completed`]: () => false });
    throw err;
  } finally {
    await context.close();
  }
}
