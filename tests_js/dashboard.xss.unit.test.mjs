import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import { cleanupDashboardApps, setupDashboardApp } from "./helpers/dashboard.test-helpers.mjs";

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
    cleanupDashboardApps();
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

  it("accepts DOM nodes for action modal fields and rejects legacy HTML strings", () => {
    const payload = "<img src=x onerror=window.__fieldXss=1>";
    const input = window.document.createElement("input");
    input.id = "actionNodeField";
    input.type = "text";
    input.value = payload;

    window.openActionModal({
      title: "Prueba",
      submitLabel: "Guardar",
      fields: input,
      focusId: "actionNodeField",
      onSubmit: async () => {},
    });

    assert.equal(window.__fieldXss, undefined);
    assert.equal(window.document.querySelector("#actionModalFields img"), null);
    assert.equal(window.document.getElementById("actionNodeField").value, payload);
    assert.throws(
      () => window.openActionModal({ title: "Legacy", fieldsHtml: "<input>" }),
      /fieldsHtml/,
    );
  });

  it("renders confirm modal acknowledgement text as plain content", () => {
    const payload = "<img src=x onerror=window.__confirmXss=1>";

    window.openActionConfirmModal({
      title: "Confirmar",
      submitLabel: "Continuar",
      acknowledgementText: payload,
      onSubmit: async () => {},
    });

    assert.equal(window.__confirmXss, undefined);
    assert.equal(window.document.querySelector("#actionModalFields img"), null);
    assert.match(window.document.querySelector("#actionModalFields span").textContent, /<img src=x/);
  });

  it("keeps incident modal note payloads as textarea values", () => {
    const payload = "<img src=x onerror=window.__incidentModalXss=1>";

    window.openIncidentModal({
      installationId: 45,
      note: payload,
      severity: "high",
    });

    assert.equal(window.__incidentModalXss, undefined);
    assert.equal(window.document.querySelector("#actionModalFields img"), null);
    assert.equal(window.document.getElementById("actionIncidentNote").value, payload);
  });

  it("renders evidence checklist preset labels as plain text", async () => {
    const payload = "<img src=x onerror=window.__evidenceXss=1>";
    const incidents = window.createDashboardIncidents({
      api: {
        updateIncidentEvidence: async () => ({ success: true }),
      },
      bindIncidentEstimatedDurationFields: () => {},
      canCurrentUserEditAssets: () => true,
      closeActionModal: window.closeActionModal,
      createMaterialIconNode: () => window.document.createElement("span"),
      escapeHtml: window.escapeHtml,
      formatDuration: () => "0m",
      formatDurationToHHMM: () => "00:00",
      getActiveSectionName: () => "incidents",
      getCurrentSelectedAssetId: () => null,
      getCurrentSelectedInstallationId: () => 45,
      getCurrentUser: () => ({ username: "ops-admin", role: "admin" }),
      incidentChecklistPresets: [payload],
      incidentEstimatedDurationMaxSeconds: 86400,
      incidentEstimatedDurationPresets: [],
      incidentStatusLabel: (status) => status,
      isSectionActive: () => true,
      loadAssetDetail: async () => {},
      loadInstallations: async () => {},
      loadPhotoWithAuth: async () => {},
      normalizeIncidentChecklistItems: (items) => Array.isArray(items) ? items.map((item) => String(item || "").trim()) : [],
      normalizeIncidentStatus: (status) => String(status || "open"),
      normalizeSeverity: (severity) => String(severity || "medium"),
      openActionConfirmModal: window.openActionConfirmModal,
      openActionModal: window.openActionModal,
      parseStrictInteger: (value) => {
        const normalized = String(value ?? "").trim();
        if (!/^-?\d+$/.test(normalized)) return null;
        const parsed = Number.parseInt(normalized, 10);
        return Number.isInteger(parsed) ? parsed : null;
      },
      readIncidentEstimatedDurationFromModal: () => ({ seconds: 0, error: "" }),
      recordAttentionStateIconName: () => "info",
      renderContextualEmptyState: () => {},
      requireActiveSession: () => true,
      resolveIncidentEstimatedDurationSeconds: () => 0,
      resolveIncidentRealDurationSeconds: () => 0,
      resolveIncidentRuntimeStartMs: () => 0,
      setActionModalError: window.setActionModalError,
      setCurrentSelectedAssetId: () => {},
      setCurrentSelectedInstallationId: () => {},
      setElementTextWithMaterialIcon: () => {},
      showNotification: () => {},
      showQrModal: () => {},
      ensureIncidentRuntimeTicker: () => {},
      stopIncidentRuntimeTicker: () => {},
    });

    await incidents.updateIncidentEvidenceFromWeb({
      id: 91,
      checklist_items: [payload],
      evidence_note: "",
    });

    assert.equal(window.__evidenceXss, undefined);
    assert.equal(window.document.querySelector("#actionModalFields img"), null);
    assert.match(
      window.document.querySelector("#actionModalFields .incident-checklist-grid span").textContent,
      /<img src=x/,
    );
  });

  it("keeps asset link notes as textarea values without injecting markup", () => {
    const payload = "<img src=x onerror=window.__assetXss=1>";

    window.openAssetLinkModal({
      assetId: 7,
      installationId: 45,
      notes: payload,
    });

    assert.equal(window.__assetXss, undefined);
    assert.equal(window.document.querySelector("#actionModalFields img"), null);
    assert.equal(window.document.getElementById("actionAssetNotes").value, payload);
  });
});
