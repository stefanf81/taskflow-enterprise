import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';

/**
 * CSP + SRI regression guard for the static nginx image.
 *
 * Angular emits inline scripts: the `<script type="importmap">` that carries the
 * sha384 integrity hashes for lazily loaded chunks (both pages) and, on the
 * prerendered landing page, event replay's dispatch contract and bootstrap call.
 * A `script-src 'self'` policy blocks them; a blocked import map silently drops
 * the SRI metadata. The frontend Dockerfile therefore hashes the exact text of
 * each one at image build time and nginx serves `script-src 'self' 'sha384-…'`.
 *
 * The global `bypassCSP: true` (needed so Playwright/axe can inject scripts
 * behind the production policy) hides exactly this class of regression, so
 * this spec opts back in. The header itself is verified through
 * `page.request`, and the expected hash is recomputed independently with
 * `node:crypto` rather than trusting the value the server advertises.
 */
test.use({ bypassCSP: false });

const IMPORT_MAP_PATTERN = /<script type="importmap">([^<]*)<\/script>/;
// Inline (no `src`) script elements; `application/json` blocks (ng-state) are data, not script.
const INLINE_SCRIPT_PATTERN = /<script((?:(?!\bsrc=)[^>])*)>([\s\S]*?)<\/script>/g;

function inlineScriptHashes(html: string): string[] {
  return [...html.matchAll(INLINE_SCRIPT_PATTERN)]
    .filter(([, attributes]) => !attributes?.includes('application/json'))
    .map(
      ([, , text]) =>
        `sha384-${createHash('sha384')
          .update(text ?? '')
          .digest('base64')}`,
    );
}

test.describe('Content-Security-Policy (nginx image)', () => {
  test.skip(!process.env['E2E_DOCKER'], 'CSP only exists behind the nginx image');

  test('requires a matching CSRF header for cookie-authenticated mutations', async ({
    request,
  }) => {
    const login = await request.post('/api/v1/auth/login', {
      data: { username: 'admin', password: 'admin-password' },
    });
    expect(login.ok()).toBe(true);
    const csrf = await request.get('/api/v1/auth/csrf');
    expect(csrf.ok()).toBe(true);
    expect(await csrf.json()).toHaveProperty('token');

    expect((await request.post('/api/v1/auth/logout')).status()).toBe(403);
    expect(
      (
        await request.post('/api/v1/auth/logout', { headers: { 'X-XSRF-TOKEN': 'wrong-token' } })
      ).status(),
    ).toBe(403);
    expect((await request.get('/api/v1/auth/me')).status()).toBe(200);
    // Authentication can rotate the cookie. Like Angular, read its current value
    // when issuing the mutation rather than reusing the earlier /csrf response.
    const token =
      (await request.storageState()).cookies.find((cookie) => cookie.name === 'XSRF-TOKEN')
        ?.value ?? '';
    expect(token).toBeTruthy();
    expect(
      (await request.post('/api/v1/auth/logout', { headers: { 'X-XSRF-TOKEN': token } })).status(),
    ).toBe(204);
  });

  test('enforces Trusted Types while allowing hydration, deferred forms and lazy dashboards', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));

    const response = await page.goto('/');
    const csp = response?.headers()['content-security-policy'] ?? '';
    expect(csp).toContain("require-trusted-types-for 'script'");
    expect(csp).toContain('trusted-types angular angular#bundler;');
    expect(csp).toContain("form-action 'none'");
    expect(response?.headers()['content-security-policy-report-only']).toBeUndefined();

    await expect(page.locator('#cancelEmail')).toBeAttached();
    await expect(page.locator('#reviewEmail')).toBeAttached();
    await page.getByRole('button', { name: 'Owner Portal' }).click();
    await page.locator('#username').fill('admin');
    await page.locator('#password').fill('admin-password');
    await page.locator('.modal-card button[type="submit"]').click();
    await expect(page.locator('h1')).toContainText('TaskFlow Owner Panel');
    await page.getByRole('button', { name: 'Schedules & Time-Off' }).click();
    await expect(page.getByRole('heading', { name: 'Barber Schedules & Time-Off' })).toBeVisible();

    expect(
      errors.filter((message) => /trusted|content.security.policy|refused to/i.test(message)),
    ).toEqual([]);

    // Verify actual browser enforcement, not just the presence of a header.
    expect(
      await page.evaluate(() => {
        try {
          document.createElement('script').setAttribute('src', '/untrusted.js');
          return false;
        } catch (error) {
          return error instanceof TypeError;
        }
      }),
    ).toBe(true);
  });

  test('never leaks verification emails through native forms, even without JavaScript', async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      baseURL,
      javaScriptEnabled: false,
      bypassCSP: false,
    });
    try {
      for (const id of ['cancelEmail', 'reviewEmail']) {
        // Use a fresh page after each blocked navigation (Chromium leaves it pending).
        const page = await context.newPage();
        await page.goto('/');
        await expect(page.locator('form')).toHaveCount(2);
        await page.locator(`#${id}`).fill('private@example.com');
        await expect(page.locator(`form:has(#${id})`)).toHaveAttribute('method', 'post');
        // Call native submit directly: no Angular handler or hydration can protect this path.
        // With JavaScript disabled, DOM event callbacks do not run; observe Chromium's
        // own CSP enforcement message rather than installing a securitypolicyviolation handler.
        await Promise.all([
          page.waitForEvent('console', {
            predicate: (message) =>
              message.text().includes("form-action 'none'") &&
              message.text().includes('request has been blocked'),
          }),
          page.locator(`form:has(#${id})`).evaluate((form: HTMLFormElement) => form.submit()),
        ]);
        expect(new URL(page.url()).search).toBe('');
        expect(new URL(page.url()).pathname).toBe('/');
        await page.close();
      }
    } finally {
      await context.close();
    }
  });

  test('allows the inline import map without blocking SRI-bearing scripts', async ({ page }) => {
    const consoleMessages: string[] = [];
    page.on('console', (message) => consoleMessages.push(message.text()));
    page.on('pageerror', (error) => consoleMessages.push(error.message));

    await page.goto('/');
    await expect(page.locator('h1').first()).toBeVisible();

    const response = await page.request.get('/');
    expect(response.ok()).toBe(true);
    const body = await response.text();
    expect(body).toContain('type="importmap"');

    const importMapJson = IMPORT_MAP_PATTERN.exec(body)?.[1] ?? '';
    expect(importMapJson, 'index.html must contain an inline import map').not.toBe('');
    const expectedHash = `sha384-${createHash('sha384').update(importMapJson).digest('base64')}`;

    const contentSecurityPolicy = response.headers()['content-security-policy'] ?? '';
    expect(contentSecurityPolicy).toContain(`'${expectedHash}'`);

    const inlineRefusals = consoleMessages.filter((message) =>
      /Refused to (execute|apply).*inline/i.test(message),
    );
    expect(inlineRefusals).toEqual([]);
  });

  test('authorizes every inline script of the prerendered landing and the client shell', async ({
    page,
  }) => {
    // `/` is the prerendered landing (index.html, event replay); any other route gets the
    // client-rendered shell (index.csr.html, `ngcm`, import map only).
    const landing = await page.request.get('/');
    const landingHtml = await landing.text();
    expect(landingHtml).toContain('id="ng-event-dispatch-contract"');
    expect(landingHtml).not.toContain('ngcm');
    const shell = await page.request.get('/admin');
    const shellHtml = await shell.text();
    expect(shellHtml).toContain('<body ngcm');

    const csp = landing.headers()['content-security-policy'] ?? '';
    expect(shell.headers()['content-security-policy']).toBe(csp);
    const landingHashes = inlineScriptHashes(landingHtml);
    expect(landingHashes).toHaveLength(3);
    for (const hash of [...landingHashes, ...inlineScriptHashes(shellHtml)]) {
      expect(csp).toContain(`'${hash}'`);
    }
  });

  test('serves the client shell on `/` to a browser with a session cookie, varying on Cookie', async ({
    page,
  }) => {
    // nginx routes on the cookie's presence only; the backend never sees this request.
    const signedIn = await page.request.get('/', { headers: { cookie: 'access_token=e2e' } });
    expect(await signedIn.text()).toContain('<body ngcm');
    expect(signedIn.headers()['vary'] ?? '').toMatch(/\bCookie\b/i);

    const guest = await page.request.get('/');
    expect(await guest.text()).toContain('id="ng-event-dispatch-contract"');
    expect(guest.headers()['vary'] ?? '').toMatch(/\bCookie\b/i);

    const shell = await page.request.get('/admin');
    expect(shell.headers()['vary'] ?? '').not.toMatch(/\bCookie\b/i);
  });
});
