import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';

/**
 * CSP + SRI regression guard for the static nginx image.
 *
 * Angular emits an inline `<script type="importmap">` that carries the sha384
 * integrity hashes for lazily loaded chunks. A `script-src 'self'` policy
 * blocks that inline element, silently discarding the SRI metadata. The
 * frontend Dockerfile therefore hashes the exact element text at image build
 * time and nginx serves `script-src 'self' 'sha384-…'`.
 *
 * The global `bypassCSP: true` (needed so Playwright/axe can inject scripts
 * behind the production policy) hides exactly this class of regression, so
 * this spec opts back in. The header itself is verified through
 * `page.request`, and the expected hash is recomputed independently with
 * `node:crypto` rather than trusting the value the server advertises.
 */
test.use({ bypassCSP: false });

const IMPORT_MAP_PATTERN = /<script type="importmap">([^<]*)<\/script>/;

test.describe('Content-Security-Policy (nginx image)', () => {
  test.skip(!process.env['E2E_DOCKER'], 'CSP only exists behind the nginx image');

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
});
