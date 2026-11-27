// Checks as a signed-in customer (the E2E Customer test account). Nothing is
// paid: the booking test stands in for the payment step and releases the hold.
const { test, expect } = require('@playwright/test');
const { admin, readTokens } = require('../lib');

const money = (c) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
let s, tok;
test.beforeAll(async () => {
  const { data } = await admin().from('facility_settings').select('*').eq('id', 1).single();
  s = data;
  tok = readTokens();
});

async function openSchedule(page) {
  await page.goto('/schedule');
  await expect(page.getByText('E2E Customer')).toBeVisible();
}
const tab = (page, name) => page.getByRole('tab', { name: new RegExp(name, 'i') });

test('header shows who is signed in and that the waiver is on file', async ({ page }) => {
  await openSchedule(page);
  await expect(page.getByText(tok.customer.email)).toBeVisible();
  const chip = page.getByRole('button', { name: /Waivers/ });
  await expect(chip).toContainText('✓');
  await expect(page.getByText('Liability waiver needed')).toHaveCount(0);
});

test('waiver panel lists the waiver and downloads its PDF', async ({ page }) => {
  await openSchedule(page);
  await page.getByRole('button', { name: /Waivers/ }).click();
  const panel = page.getByRole('dialog', { name: 'Waivers and teams' });
  await expect(panel).toContainText('E2E Player');
  const [dl] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: 'PDF' }).first().click()]);
  expect(dl.suggestedFilename()).toMatch(/^Waiver - .*\.pdf$/);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
});

test('customer cannot reach staff data or another person\'s waiver', async ({ request }) => {
  const h = { Authorization: `Bearer ${tok.customer.access_token}` };
  const now = new Date().toISOString();
  expect((await request.get(`/api/staff/day?start=${now}&end=${now}`, { headers: h })).status()).toBe(403);
  expect((await request.get('/api/staff/customers?q=a', { headers: h })).status()).toBe(403);
  const other = await request.get(`/api/waiver-pdf?id=${tok.coach.waiverId}`, { headers: h });
  expect(other.status()).toBe(403);
  const own = await request.get(`/api/waiver-pdf?id=${tok.customer.waiverId}`, { headers: h });
  expect(own.status()).toBe(200);
  expect(own.headers()['content-type']).toContain('application/pdf');
});

test('drop-in prices match the settings for every length', async ({ page }) => {
  await openSchedule(page);
  await page.getByRole('button', { name: '›' }).click();      // tomorrow: every slot is in the future
  await page.getByRole('button', { name: 'Open' }).first().click();
  for (const [label, mins] of [['30 min', '30'], ['1 hr', '60'], ['1.5 hr', '90'], ['2 hr', '120']]) {
    const b = page.getByRole('button', { name: label, exact: true });
    if (!(await b.isEnabled())) continue;                       // not enough open time after this slot
    await b.click();
    const c = s.drop_in_prices[mins];
    const amt = c % 100 ? (c / 100).toFixed(2).replace('.', '\\.') : `${c / 100}(\\.00)?`;
    await expect(page.locator('body')).toContainText(new RegExp(`Total\\s*\\$${amt}\\b`));
  }
  await page.getByRole('button', { name: 'Close' }).first().click();
});

test('party and team tabs show the current packages and hold length', async ({ page }) => {
  await openSchedule(page);
  await tab(page, 'party').click();
  const p = s.party_packages;
  await expect(page.locator('body')).toContainText(`2 hours ${money(p['120'])}, 3 hours ${money(p['180'])}`);
  await expect(page.locator('body')).toContainText(`${s.party_deposit_percent}% deposit today`);
  await tab(page, 'team').click();
  await page.getByRole('button', { name: '›' }).click();
  await page.getByRole('button', { name: 'Open' }).first().click();
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six'];
  await expect(page.locator('body')).toContainText(`held ${words[s.series_horizon_months]} month`);
});

test('booking a cage holds it, then releasing frees it (no payment)', async ({ page }) => {
  // Three weeks out, last slot of the day, Cage 3: the least likely time a real customer is booking.
  await openSchedule(page);
  for (let i = 0; i < 21; i++) await page.getByRole('button', { name: '›' }).click();
  await expect(page.getByRole('button', { name: 'Open' }).first()).toBeVisible();
  const open = page.getByRole('button', { name: 'Open' });
  const slot = open.last();
  // Stand in for Stripe so no live PaymentIntent is created.
  await page.route('**/api/create-payment-intent', (r) => r.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'E2E test: payment step skipped.' }) }));
  const holdReq = page.waitForResponse((r) => r.url().includes('/rpc/book_hold'));
  await slot.click();
  await page.getByRole('button', { name: '30 min', exact: true }).click();
  await page.getByRole('button', { name: /confirm booking/i }).click();
  const held = await holdReq;
  expect(held.ok()).toBeTruthy();
  await expect(page.getByText('E2E test: payment step skipped.')).toBeVisible();   // error shows instead of freezing
  const release = page.waitForResponse((r) => r.url().includes('/api/release-hold'));
  await page.getByRole('button', { name: 'Close' }).first().click();
  expect((await release).status()).toBe(200);
  await expect(page.getByRole('button', { name: /confirm booking/i })).toHaveCount(0);
});

test('waiver window: Continue unlocks at the end, bad dates are caught', async ({ page }) => {
  await openSchedule(page);
  await page.getByRole('button', { name: /Waivers/ }).click();
  await page.getByRole('button', { name: '+ Add a player' }).click();
  const dlg = page.getByRole('dialog', { name: 'Liability waiver' });
  await expect(dlg).toContainText('Step 1 of 2');
  const cont = dlg.getByRole('button', { name: 'Continue' });
  await expect(cont).toBeDisabled();
  await dlg.getByLabel('Waiver text').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(cont).toBeEnabled();
  await cont.click();
  await expect(dlg).toContainText('Step 2 of 2');
  await expect(dlg).toContainText('Signing as E2E Customer');
  await dlg.getByPlaceholder('MM/DD/YYYY').fill('13452015');
  await expect(dlg).toContainText('Check the date of birth');
  await expect(dlg.getByRole('button', { name: /sign waiver/i })).toBeDisabled();
  await dlg.getByRole('button', { name: 'Close' }).click();
  await expect(dlg).toBeHidden();
});

test('team link: create, open as a parent, delete', async ({ page, browser }) => {
  const name = `E2E Team ${Date.now().toString().slice(-5)}`;
  await openSchedule(page);
  await page.getByRole('button', { name: /Waivers/ }).click();
  const panel = page.getByRole('dialog', { name: 'Waivers and teams' });
  await panel.getByRole('button', { name: '+ New team link' }).click();
  await panel.getByPlaceholder(/Team name/).fill(name);
  await panel.getByRole('button', { name: 'Create' }).click();
  await expect(panel).toContainText(`Team "${name}" created`);
  await panel.getByRole('button', { name: new RegExp(name) }).click();
  const link = await panel.getByLabel(`Link for ${name}`).inputValue();
  expect(link).toMatch(/\/join\/[A-Za-z0-9_-]{10,}$/);

  // A signed-out parent sees the team name and a sign-in button.
  const parent = await browser.newContext();
  const pp = await parent.newPage();
  await pp.goto(link);
  await expect(pp.getByRole('heading', { name: new RegExp(`Join ${name}`, 'i') })).toBeVisible();
  await expect(pp.getByRole('button', { name: /sign in to continue/i })).toBeVisible();
  await parent.close();

  await panel.getByRole('button', { name: `More for ${name}` }).click();
  await panel.getByRole('button', { name: 'Delete team list' }).click();
  await panel.getByRole('button', { name: 'Yes' }).click();
  await expect(panel).not.toContainText(name);
});

test('membership tab lists plans without buying', async ({ page }) => {
  await openSchedule(page);
  await tab(page, 'member').click();
  const { data: plans } = await admin().from('membership_plans').select('name, price_cents').eq('active', true);
  for (const p of plans) {
    await expect(page.locator('body')).toContainText(p.name, { ignoreCase: true });
    await expect(page.locator('body')).toContainText(money(p.price_cents));
  }
  await expect(page.getByRole('button', { name: /buy plan|add these hours/i }).first()).toBeVisible();
});
