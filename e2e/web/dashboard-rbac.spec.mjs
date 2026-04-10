import { expect, test } from "@playwright/test";

import {
  DEFAULT_E2E_BASE_URL,
  E2E_SCENARIO,
  seedE2eScenario,
} from "../../scripts/e2e/siteops-e2e.mjs";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await seedE2eScenario({ baseUrl: DEFAULT_E2E_BASE_URL });
});

async function loginThroughDashboard(page, credentials) {
  await page.addInitScript(() => {
    window.EventSource = class EventSourceStub {
      close() {}
      addEventListener() {}
      removeEventListener() {}
    };
  });
  await page.goto("/dashboard");
  await page.locator("#loginUsername").fill(credentials.username);
  await page.locator("#loginPassword").fill(credentials.password);
  await page.locator("#loginForm button[type='submit']").click();
  await expect(page.locator("#loginModal")).toBeHidden();
  await expect(page.locator("#username")).toContainText(credentials.username);
}

async function logoutThroughDashboard(page) {
  await page.locator("#logoutBtn").click();
  await expect(page.locator("#loginModal")).toBeVisible();
}

test("platform owner can sign in and open tenant control", async ({ page }) => {
  await loginThroughDashboard(page, E2E_SCENARIO.platformOwner);

  await expect(page.locator("#userRole")).toContainText("platform_owner");
  await expect(page.locator(".nav-links a[data-section='tenants']")).toBeVisible();

  await page.locator(".nav-links a[data-section='tenants']").click();
  await expect(page.locator("#tenantsSection")).toHaveClass(/active/);
});

test("technician lands on my cases and only sees scoped navigation", async ({ page }) => {
  await loginThroughDashboard(page, E2E_SCENARIO.technicianUser);

  await expect(page.locator("#userRole")).toContainText("tecnico");
  await expect(page.locator(".nav-links a[data-section='incidents']")).toBeHidden();
  await expect(page.locator(".nav-links a[data-section='assets']")).toBeHidden();
  await expect(page.locator(".nav-links a[data-section='incidentMap']")).toBeVisible();

  await page.locator(".nav-links a[data-section='myCases']").click();
  await expect(page.locator("#myCasesSection")).toHaveClass(/active/);
  await expect(page.locator("#myCasesList")).toContainText(E2E_SCENARIO.incident.note);
  await expect(page.locator("#myCasesContext")).toContainText(E2E_SCENARIO.technician.display_name);
});

test("admin keeps global navigation and can log out cleanly", async ({ page }) => {
  await loginThroughDashboard(page, E2E_SCENARIO.admin);

  await expect(page.locator("#userRole")).toContainText("admin");
  await expect(page.locator(".nav-links a[data-section='incidents']")).toBeVisible();
  await expect(page.locator(".nav-links a[data-section='assets']")).toBeVisible();

  await page.locator(".nav-links a[data-section='incidents']").click();
  await expect(page.locator("#incidentsSection")).toHaveClass(/active/);

  await logoutThroughDashboard(page);
});
