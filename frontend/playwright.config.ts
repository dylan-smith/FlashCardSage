import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  // The load generator has its own config (playwright.load.config.ts) and runs for minutes, not seconds.
  testIgnore: '**/load.spec.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [
        ['github'],
        ['html'],
        ['junit', { outputFile: 'playwright-report/results.xml' }],
      ]
    : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
  webServer: [
    {
      command: 'dotnet run --project ../backend/FlashCardSage.Api',
      url: 'http://localhost:5269/health',
      // Never reuse an API that is already running: it may use a real database, and the tests delete
      // every flash card. If port 5269 is taken, Playwright fails instead.
      reuseExistingServer: false,
      timeout: 120000,
      env: {
        ASPNETCORE_URLS: 'http://localhost:5269',
        ASPNETCORE_ENVIRONMENT: 'Development',
        // Always in-memory: the tests delete existing flash cards, so keep them away from a real database.
        UseInMemoryDatabase: 'true',
        // Development turns it on already; set here too since the tests depend on it (see e2e/fixtures.ts).
        Authentication__AllowTestSignIn: 'true',
        // Development makes the test user "Admin" an admin already; set here too since the admin tests depend on it.
        Admin__Users__0: 'test:admin',
        // There's no Foundry, so every picture is the same sample one, which still goes through the real cache.
        ImageGeneration__UseSamplePicture: 'true',
        // Where the API sends an app's sign-in for the user's consent: the frontend below.
        Frontend__BaseUrl: 'http://localhost:4173',
      },
    },
    {
      command: 'npm run build && npm run preview -- --port 4173 --strictPort',
      env: { VITE_ENABLE_TEST_SIGN_IN: 'true' },
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
    },
  ],
})
