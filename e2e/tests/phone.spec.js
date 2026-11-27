// Phone layout checks (iPhone size) as the test customer.
const { test, expect } = require('@playwright/test');

test('header chips fit and the waiver panel opens under them', async ({ page }) => {
  await page.goto('/schedule');
  const chip = page.getByRole('button', { name: /Waivers/ });
  await expect(chip).toBeVisible();
  const noSideScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(noSideScroll).toBeTruthy();
  await chip.click();
  const panel = page.getByRole('dialog', { name: 'Waivers and teams' });
  await expect(panel).toBeVisible();
  const c = await chip.boundingBox();
  const p = await panel.boundingBox();
  expect(p.y).toBeGreaterThanOrEqual(c.y + c.height);      // never covers the chips
  expect(p.x).toBeGreaterThanOrEqual(0);
  expect(p.x + p.width).toBeLessThanOrEqual(page.viewportSize().width + 1);
});

test('waiver window fills the phone screen', async ({ page }) => {
  await page.goto('/schedule');
  await page.getByRole('button', { name: /Waivers/ }).click();
  await page.getByRole('button', { name: '+ Add a player' }).click();
  const dlg = page.getByRole('dialog', { name: 'Liability waiver' });
  await expect(dlg).toBeVisible();
  const b = await dlg.boundingBox();
  expect(b.width).toBeGreaterThanOrEqual(page.viewportSize().width - 2);
  await dlg.getByRole('button', { name: 'Close' }).click();
});
