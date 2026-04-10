import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./web",
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "../reports/playwright/html" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:8787",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  outputDir: "../reports/playwright/artifacts",
  webServer: {
    command: "npm run dev:e2e",
    url: "http://127.0.0.1:8787/health",
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
});
