import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import { setupDashboardApp } from "./helpers/dashboard.test-helpers.mjs";

describe("dashboard render XSS hardening", () => {
  let dom;
  let window;

  beforeEach(async () => {
    const setup = await setupDashboardApp();
    dom = setup.dom;
    window = dom.window;
  });

  afterEach(() => {
    dom?.window?.close();
    dom = null;
    window = null;
  });

  it("renders recent/installations/audit text payloads safely", () => {
    const payload = "<img src=x onerror=window.__xss=1>";

    window.renderRecentInstallations([
      {
        id: payload,
        client_name: payload,
        driver_brand: payload,
        status: payload,
        timestamp: "2025-01-01T10:00:00Z",
      },
    ]);
    window.renderInstallationsTable([
      {
        id: payload,
        client_name: payload,
        driver_brand: payload,
        driver_version: payload,
        status: payload,
        installation_time_seconds: 1,
        notes: payload,
        timestamp: "2025-01-01T10:00:00Z",
      },
    ]);
    window.renderAuditLogs([
      {
        timestamp: "2025-01-01T10:00:00Z",
        action: payload,
        username: payload,
        success: true,
        details: payload,
      },
    ]);

    assert.equal(window.__xss, undefined);
    assert.equal(window.document.querySelector("#recentInstallations td img"), null);
    assert.equal(window.document.querySelector("#installationsTable td img"), null);
    assert.equal(window.document.querySelector("#auditLogs td img"), null);

    const installationRow = window.document.querySelector("#installationsTable tbody tr");
    assert.ok(installationRow.textContent.includes("<img src=x onerror=window.__xss=1>"));
  });

  it("renders incidents and filter chips with malicious text as plain content", async () => {
    const payload = "<img src=x onerror=window.__chipXss=1>";

    window.document.getElementById("searchInput").value = payload;
    window.document.getElementById("brandFilter").value = payload;
    window.document.getElementById("startDate").value = "2025-01-01";
    window.updateFilterChips();

    await window.renderIncidents(
      [
        {
          severity: payload,
          reporter_username: payload,
          created_at: "2025-01-01T10:00:00Z",
          note: payload,
          photos: [],
        },
      ],
      payload,
    );

    assert.equal(window.__chipXss, undefined);
    assert.equal(window.document.querySelector("#filterChips img"), null);
    assert.equal(window.document.querySelector("#incidentsList p img"), null);

    const chipValue = window.document.querySelector("#filterChips .chip-value");
    assert.match(chipValue.textContent, /<img src=x onerror=window.__chipXss=1>/);

    const incidentNote = window.document.querySelector("#incidentsList .incident-card p");
    assert.match(incidentNote.textContent, /<img src=x onerror=window.__chipXss=1>/);
  });
});
