import { browser } from 'k6/browser';
import { check } from 'k6';

if (!__ENV.BASE_URL) {
  throw new Error('BASE_URL environment variable is required');
}

export const options = {
  scenarios: {
    browser: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      options: {
        browser: {
          type: 'chromium',
        },
      },
    },
  },
  thresholds: {
    // Fail the test if any check fails — without this, check() records pass/fail
    // but does not fail the run, so a broken page would still exit 0.
    checks: ['rate==1.0'],
  },
};

export default async function () {
  let page;
  try {
    page = await browser.newPage();

    // Avoid 'networkidle' on an SPA — periodic XHR/SSE/WebSocket traffic can
    // prevent it from ever settling, causing flakes or hangs.
    await page.goto(__ENV.BASE_URL, {
      waitUntil: 'domcontentloaded',
      timeout: '60s',
    });

    const title = await page.title();

    check(title, {
      'title contains TaskFlow': (t) => t.includes('TaskFlow'),
    });
  } finally {
    if (page) {
      await page.close();
    }
  }
}
