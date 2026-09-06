import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  timeout: 30_000,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:4317",
    browserName: "chromium",
    locale: "fr-FR",
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  projects: [390, 700, 980, 1440].map((width) => ({
    name: `chromium-${width}`,
    use: { viewport: { width, height: 900 } }
  })),
  webServer: {
    command: "node --import tsx tests/e2e/server.ts",
    url: "http://127.0.0.1:4317/api/health",
    reuseExistingServer: false,
    timeout: 30_000
  }
});
