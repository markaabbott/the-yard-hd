// Signed-out checks: the public website matches the app's settings, the app's
// public pages load, and private API routes refuse anyone not signed in.
const { test, expect } = require('@playwright/test');
const { SITE_URL, admin } = require('../lib');

const money = (c) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
let s;
test.beforeAll(async () => {
  const { data } = await admin().from('facility_settings').select('*').eq('id', 1).single();
  s = data;
});

test('website shows the same prices and policies as the app', async ({ page }) => {
  await page.goto(SITE_URL);
  await expect(page).toHaveTitle(/The Yard HD/);
  const pk = page.locator('.pkg');
  const p2 = s.party_packages['120'], p3 = s.party_packages['180'];
  const dep = (c) => money(Math.floor((c * s.party_deposit_percent) / 100));
  await expect(pk.nth(0)).toContainText(money(p2));
  await expect(pk.nth(0)).toContainText(`${dep(p2)} deposit`);
  await expect(pk.nth(1)).toContainText(money(p3));
  await expect(pk.nth(1)).toContainText(`${dep(p3)} deposit`);
  const body = page.locator('body');
  await expect(body).toContainText(`${s.party_deposit_percent}% deposit`);
  await expect(body).toContainText(`Free cancellation up to ${s.cancel_free_hours} hours out`);
  await expect(body).toContainText(`half back between ${s.cancel_free_hours} and ${s.cancel_half_hours} hours`);
  await expect(body).toContainText(`From ${money(s.drop_in_prices['30'])}`, { ignoreCase: true });
  await expect(page.locator('a[href="https://x.com/theyardhd"]').first()).toBeVisible();
  // Every Book button goes to the booking app.
  const books = page.locator('a', { hasText: /book/i });
  for (const href of await books.evaluateAll((els) => els.map((e) => e.href))) expect(href).toContain('app.theyardhd.com');
});

test('website redirects and serves its icons', async ({ request }) => {
  for (const p of ['/favicon.ico', '/apple-touch-icon.png', '/site.webmanifest']) {
    const r = await request.get(SITE_URL + p);
    expect(r.status(), p).toBe(200);
  }
  const m = await request.get(`${SITE_URL}/site.webmanifest`);
  expect(m.headers()['content-type']).toContain('manifest+json');
  const old = await request.get(`${SITE_URL}/about/`, { maxRedirects: 0 });
  expect([301, 302]).toContain(old.status());
});

test('sign-in page offers Google, Apple and email', async ({ page }) => {
  await page.goto('/signin');
  await expect(page.getByRole('button', { name: /google/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /apple/i })).toBeVisible();
  await expect(page.getByPlaceholder('you@email.com')).toBeVisible();
});

test('signed-out visitors are sent to sign in', async ({ page }) => {
  await page.goto('/schedule');
  await expect(page).toHaveURL(/\/signin/);
});

test('terms show the current cancellation windows', async ({ page }) => {
  await page.goto('/terms');
  await expect(page.locator('body')).toContainText(`free until ${s.cancel_free_hours} hours before`);
  await expect(page.locator('body')).toContainText(`inside ${s.cancel_half_hours} hours`);
});

test('a dead team link explains itself', async ({ page }) => {
  await page.goto('/join/not-a-real-team-link-123');
  await expect(page.locator('body')).toContainText(/no longer active|not working/i);
});

test('private API routes refuse signed-out requests', async ({ request }) => {
  const now = new Date().toISOString();
  const checks = [
    ['GET', `/api/staff/day?start=${now}&end=${now}`],
    ['GET', '/api/staff/customers?q=a'],
    ['GET', '/api/teams'],
    ['GET', '/api/waiver-pdf?id=00000000-0000-0000-0000-000000000000'],
    ['POST', '/api/sign-waiver'],
    ['POST', '/api/release-hold'],
  ];
  for (const [method, url] of checks) {
    const r = method === 'GET' ? await request.get(url) : await request.post(url, { data: { groupId: '00000000-0000-0000-0000-000000000000' } });
    expect([401, 403], `${method} ${url}`).toContain(r.status());
  }
});
