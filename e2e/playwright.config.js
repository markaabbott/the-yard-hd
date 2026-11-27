// Automated checks against the LIVE site. Nothing here pays: the one test that
// starts a booking stops before the card form and releases the hold.
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,          // one booking test at a time on the live site
  workers: 1,
  retries: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: require.resolve('./global-setup.js'),
  globalTeardown: require.resolve('./global-teardown.js'),
  use: {
    baseURL: process.env.APP_URL || 'https://app.theyardhd.com',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'public', testMatch: /public\.spec\.js/, use: { ...devices['Desktop Chrome'] } },
    { name: 'customer', testMatch: /customer\.spec\.js/, use: { ...devices['Desktop Chrome'], storageState: '.auth/customer.json' } },
    { name: 'customer-phone', testMatch: /phone\.spec\.js/, use: { ...devices['iPhone 13'], storageState: '.auth/customer.json' } },
    { name: 'coach', testMatch: /coach\.spec\.js/, use: { ...devices['Desktop Chrome'], storageState: '.auth/coach.json' } },
  ],
});
