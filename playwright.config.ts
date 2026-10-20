import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  // GitHub machines are slower and busier: a test that fails there is tried
  // again; one that fails every time is still a failure.
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:4173",
    trace: "retain-on-failure",
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || undefined },
  },
  webServer: {
    command: "npm run build && npm run preview",
    url: "http://localhost:4173",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1400, height: 900 } }, grepInvert: /@mobile/ },
    {
      name: "ipad",
      // WebKit-like constraints are approximated by the iPad user agent:
      // the app switches to its iOS memory profile.
      use: { ...devices["iPad Pro 11"], browserName: "chromium" },
      grep: /@mobile/,
    },
  ],
});
