// Checks as a coach (the E2E Coach test account): the staff screens load,
// and a coach only gets what a coach is allowed. Read-only: nothing is booked,
// blocked or changed, so no staff alert emails go out.
const { test, expect } = require('@playwright/test');
const { readTokens } = require('../lib');

let tok;
test.beforeAll(() => { tok = readTokens(); });

test('staff schedule loads with the coach badge and coach-only tabs', async ({ page }) => {
  await page.goto('/staff');
  await expect(page.getByText('Coach', { exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Schedule' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Bookings' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Reports' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Team' })).toHaveCount(0);
  await expect(page.getByText('E2E Coach')).toBeVisible();
});

test('coach permissions from the server', async ({ request }) => {
  const h = { Authorization: `Bearer ${tok.coach.access_token}` };
  const start = new Date();
  const end = new Date(start.getTime() + 86400000);
  const r = await request.get(`/api/staff/day?start=${start.toISOString()}&end=${end.toISOString()}`, { headers: h });
  expect(r.status()).toBe(200);
  const day = await r.json();
  expect(Array.isArray(day.cages)).toBeTruthy();
  expect(day.role).toBe('coach');
  expect(day.perms?.reports).toBeFalsy();
  expect(day.perms?.team).toBeFalsy();
});

test('customer search finds the test customer', async ({ request }) => {
  const h = { Authorization: `Bearer ${tok.coach.access_token}` };
  const r = await request.get('/api/staff/customers?q=e2e-customer', { headers: h });
  expect(r.status()).toBe(200);
  const { customers } = await r.json();
  expect(customers.some((c) => c.email === tok.customer.email)).toBeTruthy();
});

test('coach cannot rename a customer unless allowed', async ({ request }) => {
  const h = { Authorization: `Bearer ${tok.coach.access_token}` };
  const now = new Date().toISOString();
  const { perms } = await (await request.get(`/api/staff/day?start=${now}&end=${now}`, { headers: h })).json();
  // Same name it already has, so nothing changes even if coaches are allowed to edit.
  const r = await request.patch('/api/staff/customers', { headers: h, data: { id: tok.customer.uid, firstName: 'E2E', lastName: 'Customer', phone: '' } });
  expect(r.status()).toBe(perms?.edit_customers ? 200 : 403);
});

test('staff can download a customer waiver PDF', async ({ request }) => {
  const h = { Authorization: `Bearer ${tok.coach.access_token}` };
  const r = await request.get(`/api/waiver-pdf?id=${tok.customer.waiverId}`, { headers: h });
  expect(r.status()).toBe(200);
});
