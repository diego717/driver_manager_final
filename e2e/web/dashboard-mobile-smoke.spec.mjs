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

async function expectSectionWithoutHorizontalOverflow(page, sectionId) {
  const metrics = await page.evaluate((id) => {
    const section = document.getElementById(id);
    if (!section) return null;
    return {
      sectionScrollWidth: section.scrollWidth,
      sectionClientWidth: section.clientWidth,
      pageScrollWidth: document.documentElement.scrollWidth,
      pageClientWidth: document.documentElement.clientWidth,
    };
  }, sectionId);

  expect(metrics).not.toBeNull();
  expect(metrics.sectionScrollWidth).toBeLessThanOrEqual(metrics.sectionClientWidth + 2);
  expect(metrics.pageScrollWidth).toBeLessThanOrEqual(metrics.pageClientWidth + 2);
}

test("mobile operational sections render without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginThroughDashboard(page, E2E_SCENARIO.admin);

  await expect(page.locator("#dashboardSection")).toHaveClass(/active/);
  await expectSectionWithoutHorizontalOverflow(page, "dashboardSection");

  await page.locator(".nav-links a[data-section='installations']").click();
  await expect(page.locator("#installationsSection")).toHaveClass(/active/);
  await expectSectionWithoutHorizontalOverflow(page, "installationsSection");

  await page.locator(".nav-links a[data-section='incidents']").click();
  await expect(page.locator("#incidentsSection")).toHaveClass(/active/);
  await expectSectionWithoutHorizontalOverflow(page, "incidentsSection");

  await page.locator(".nav-links a[data-section='incidentMap']").click();
  await expect(page.locator("#incidentMapSection")).toHaveClass(/active/);
  await expectSectionWithoutHorizontalOverflow(page, "incidentMapSection");
});

test("mobile closes overlays on section changes and keeps overflow menu stable", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await loginThroughDashboard(page, E2E_SCENARIO.admin);

  const overflowToggle = page.locator("#headerOverflowBtn");
  const overflowMenu = page.locator("#headerOverflowMenu");

  await overflowToggle.click();
  await expect(overflowMenu).toHaveClass(/is-open/);
  const firstBox = await overflowMenu.boundingBox();
  expect(firstBox).not.toBeNull();

  await page.locator("#overflowThemeBtn").click();
  await expect(overflowMenu).not.toHaveClass(/is-open/);

  await overflowToggle.click();
  await expect(overflowMenu).toHaveClass(/is-open/);
  const secondBox = await overflowMenu.boundingBox();
  expect(secondBox).not.toBeNull();

  expect(Math.abs(firstBox.width - secondBox.width)).toBeLessThanOrEqual(2);
  expect(Math.abs(firstBox.x - secondBox.x)).toBeLessThanOrEqual(3);

  await page.locator("#mobileNavMoreBtn").click();
  await expect(page.locator("#mobileNavPanel")).toHaveClass(/is-open/);
  await page.locator("#mobileNavPanel [data-mobile-section='myCases']").click();

  await expect(page.locator("#myCasesSection")).toHaveClass(/active/);
  await expect(page.locator("#mobileNavPanel")).not.toHaveClass(/is-open/);
  await expect(overflowMenu).not.toHaveClass(/is-open/);
});
