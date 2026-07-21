import { browser } from 'k6/browser';
import { check } from 'k6';

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
};

export default async function () {
  const page = await browser.newPage();

  try {
    await page.goto(__ENV.BASE_URL);

    // Wait until the Angular app has finished loading
    await page.waitForLoadState('networkidle');

    const title = await page.title();

    check(title, {
      'page title exists': (t) => t.length > 0,
    });

  } finally {
    await page.close();
  }
}
