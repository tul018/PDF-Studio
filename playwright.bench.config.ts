import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/bench",
  timeout: 300_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
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
    timeout: 300_000,
  },
  projects: [{ name: "bench", use: { ...devices["Desktop Chrome"], viewport: { width: 1400, height: 900 } } }],
});
