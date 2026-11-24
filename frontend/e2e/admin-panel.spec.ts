import { APIRequestContext, Page, expect, test } from '@playwright/test';

/**
 * The owner's panel: a URL per section (refresh and Back keep the place), the calendar and bulk
 * approve. Bookings are made through the public API so the test does not depend on the wizard.
 */

const BARBER = 'Sara the Stylist';
const SERVICE = 'Classic Haircut';
const HOURS = ['09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00'];

/** A future, non-Sunday date at a random offset, so runs against a long-lived backend do not collide. */
function randomDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + 20 + Math.floor(Math.random() * 50));
  if (date.getDay() === 0) date.setDate(date.getDate() + 1);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Books a slot as a guest; retries other slots when one is taken. Returns the date and time. */
async function book(
  request: APIRequestContext,
  name: string,
  date = randomDate(),
): Promise<{ date: string; time: string }> {
  const csrf = await (await request.get('/api/v1/auth/csrf')).json();
  for (let attempt = 0; attempt < 20; attempt++) {
    const time = HOURS[Math.floor(Math.random() * HOURS.length)]!;
    const response = await request.post('/api/v1/appointments', {
      headers: { [csrf.headerName]: csrf.token, Origin: 'http://localhost:4200' },
      data: {
        barberName: BARBER,
        bookingDate: date,
        bookingTime: time,
        customerName: name,
        customerEmail: `panel.${Math.floor(Math.random() * 1e9)}@example.com`,
        customerPhone: '555-0100',
        serviceType: SERVICE,
      },
    });
    if (response.status() === 201) return { date, time };
  }
  throw new Error('no free slot found');
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.fill('#username', 'admin');
  await page.fill('#password', 'admin-password');
  await page.click('.modal-card button[type="submit"]');
  await expect(page.locator('h1')).toContainText('TaskFlow Owner Panel');
}

test.describe('owner panel', () => {
  test('every section has its own URL that survives a refresh and the Back button', async ({
    page,
  }) => {
    await signIn(page);
    await expect(page).toHaveURL(/\/admin\/appointments$/);

    const nav = page.getByRole('navigation', { name: 'Owner sections' });
    await nav.getByRole('link', { name: 'Schedules & Time-Off' }).click();
    await expect(page).toHaveURL(/\/admin\/schedules$/);
    await expect(nav.getByRole('link', { name: 'Schedules & Time-Off' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await page.reload();
    await expect(page).toHaveURL(/\/admin\/schedules$/);
    await expect(page.getByRole('heading', { name: /Barber Schedules/ })).toBeVisible();

    await nav.getByRole('link', { name: 'Calendar' }).click();
    await expect(page).toHaveURL(/\/admin\/calendar$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/admin\/schedules$/);
    await expect(page.getByRole('heading', { name: /Barber Schedules/ })).toBeVisible();

    // The redundant controls are gone.
    await expect(page.getByRole('button', { name: /Sync DB/i })).toHaveCount(0);
    await expect(page.getByText('Owner Guidelines')).toHaveCount(0);
  });

  test('the calendar shows a booking in its barber column and hour, day and week', async ({
    page,
    request,
  }) => {
    const name = `Calendar Guest ${Math.floor(Math.random() * 1e6)}`;
    const { date } = await book(request, name);

    await signIn(page);
    await page
      .getByRole('navigation', { name: 'Owner sections' })
      .getByRole('link', {
        name: 'Calendar',
      })
      .click();
    await page.locator('#calendar-date').fill(date);

    const event = page.locator('.calendar-event', { hasText: name });
    await expect(event).toBeVisible();
    // Its column is the barber's.
    const column = await event.evaluate((el) => {
      const cell = el.closest('td')!;
      const index = Array.from(cell.parentElement!.children).indexOf(cell);
      const table = cell.closest('table')!;
      return table.querySelectorAll('thead th')[index]?.textContent?.trim();
    });
    expect(column).toBe(BARBER);

    // Open the booking and approve it from the panel.
    await event.click();
    const details = page.getByRole('region', { name: 'Selected booking' });
    await expect(details).toContainText(name);
    await expect(details).toContainText('Pending');
    await details.getByRole('button', { name: 'Approve' }).click();
    await expect(details).toContainText('Approved');
    await expect(details.getByRole('button', { name: 'Approve' })).toHaveCount(0);
    await details.getByRole('button', { name: 'Close' }).click();
    await expect(details).toHaveCount(0);

    await page.getByRole('button', { name: 'Week', exact: true }).click();
    await expect(page.locator('.calendar-event', { hasText: name })).toBeVisible();
    await page.getByLabel('Barber').selectOption('Alex the Barber');
    await expect(page.locator('.calendar-event', { hasText: name })).toHaveCount(0);
  });

  test('bulk approve approves every ticked pending booking', async ({ page, request }) => {
    const token = `Bulk${Math.floor(Math.random() * 1e6)}`;
    for (const suffix of ['A', 'B']) await book(request, `${token} ${suffix}`);

    await signIn(page);
    await page.locator('input[placeholder="Search customers..."]').fill(token);
    const rows = page.locator('.appt-row', { hasText: token });
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('Pending');

    await page.getByLabel(/Select all 2 pending/).check();
    await expect(page.getByText('2 selected')).toBeVisible();
    await page.getByRole('button', { name: 'Approve selected' }).click();

    await expect(page.locator('.alert-success')).toContainText('2 appointments APPROVED');
    await expect(rows.first()).toContainText('Approved');
    await expect(rows.last()).toContainText('Approved');
    // Nothing pending is left to select.
    await expect(page.getByLabel(/Select all/)).toHaveCount(0);
  });
});
