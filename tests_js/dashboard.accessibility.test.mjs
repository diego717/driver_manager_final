import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

import {
  cleanupDashboardApps,
  loadPublicDashboardHtml,
  setupDashboardApp,
} from "./helpers/dashboard.test-helpers.mjs";

test.afterEach(() => {
  cleanupDashboardApps();
});

function loadDashboardHtml() {
  return loadPublicDashboardHtml();
}

async function setupDomWithDashboardScript() {
  const { dom } = await setupDashboardApp();
  return dom;
}

test("dashboard action buttons expose explicit aria-labels", async () => {
  const dom = await setupDomWithDashboardScript();
  const { document } = dom.window;

  const themeToggle = document.getElementById("overflowThemeBtn");
  const refreshBtn = document.getElementById("refreshBtn");
  const closePhotoBtn = document.querySelector("#photoModal .close");

  assert.equal(themeToggle.tagName, "BUTTON");
  assert.ok(themeToggle.getAttribute("aria-label"));

  assert.equal(refreshBtn.tagName, "BUTTON");
  assert.equal(refreshBtn.getAttribute("aria-label"), "Actualizar dashboard");

  assert.equal(closePhotoBtn.tagName, "BUTTON");
  assert.equal(closePhotoBtn.getAttribute("type"), "button");
  assert.equal(closePhotoBtn.getAttribute("aria-label"), "Cerrar visor de foto");
});

test("all dashboard modals expose accessible dialog semantics", () => {
  const html = loadDashboardHtml();
  const dom = new JSDOM(html);
  const { document } = dom.window;

  const modalIds = ["loginModal", "photoModal", "qrModal", "qrPasswordModal", "actionModal"];
  modalIds.forEach((modalId) => {
    const modal = document.getElementById(modalId);
    assert.ok(modal, `${modalId} should exist`);
    assert.equal(modal.getAttribute("role"), "dialog");
    assert.ok(modal.hasAttribute("aria-modal"));

    const labelledBy = String(modal.getAttribute("aria-labelledby") || "").trim();
    const describedBy = String(modal.getAttribute("aria-describedby") || "").trim();
    assert.ok(labelledBy, `${modalId} should define aria-labelledby`);
    assert.ok(describedBy, `${modalId} should define aria-describedby`);

    labelledBy.split(/\s+/).forEach((targetId) => {
      assert.ok(document.getElementById(targetId), `${modalId} missing labelledby target: ${targetId}`);
    });
    describedBy.split(/\s+/).forEach((targetId) => {
      assert.ok(document.getElementById(targetId), `${modalId} missing describedby target: ${targetId}`);
    });
  });
});

test("dashboard filters and chart summaries expose accessible labels", () => {
  const html = loadDashboardHtml();
  const dom = new JSDOM(html);
  const { document } = dom.window;

  [
    ["searchInput", "Buscar registros"],
    ["brandFilter", "Filtrar por marca"],
    ["startDate", "Fecha de inicio"],
    ["endDate", "Fecha de fin"],
    ["assetsSearchInput", "Buscar equipos"],
    ["auditActionFilter", "Filtrar auditoría por acción"],
    ["driverBrandInput", "Marca"],
    ["driverVersionInput", "Versión"],
    ["driverDescriptionInput", "Descripción"],
    ["driverFileInput", "Archivo de driver"],
  ].forEach(([id, labelText]) => {
    const control = document.getElementById(id);
    assert.ok(control, `${id} should exist`);
    const label = document.querySelector(`label[for="${id}"]`);
    assert.ok(label, `${id} should have a label`);
    assert.match(label.textContent || "", new RegExp(labelText, "i"));
  });

  const trendChart = document.getElementById("trendChart");
  assert.ok(trendChart);
  assert.equal(trendChart.getAttribute("role"), "img");
  assert.equal(trendChart.getAttribute("aria-labelledby"), "trendChartTitle");
  assert.equal(trendChart.getAttribute("aria-describedby"), "trendChartSummary");

  ["trendChartTitle", "trendChartSummary", "successChartSummary", "brandChartSummary"].forEach((id) => {
    assert.ok(document.getElementById(id), `${id} should exist`);
  });
});

test("gps observability copy renders without mojibake", () => {
  const html = loadDashboardHtml();
  const dom = new JSDOM(html);
  const { document } = dom.window;

  assert.match(document.getElementById("gpsOpsTitle")?.textContent || "", /Salud de captura y contexto GPS/);
  assert.match(document.body.textContent || "", /auditoría operativa/);
  assert.match(document.body.textContent || "", /Capturas útiles/);
  assert.match(document.body.textContent || "", /Sin datos todavía/);
  assert.doesNotMatch(document.body.textContent || "", /Ã|Â/);
});

test("login modal keeps keyboard focus trapped and closes on Escape", async () => {
  const dom = await setupDomWithDashboardScript();
  const { window } = dom;
  const { document } = window;

  const trigger = document.getElementById("refreshBtn");
  const loginUsername = document.getElementById("loginUsername");
  const loginPassword = document.getElementById("loginPassword");
  const submitBtn = document.querySelector("#loginForm button[type=\"submit\"]");
  const loginModal = document.getElementById("loginModal");

  trigger.focus();
  window.showLogin();

  assert.ok(loginModal.classList.contains("active"));
  assert.equal(document.activeElement, loginUsername);

  submitBtn.focus();
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
  assert.equal(document.activeElement, loginUsername);

  loginUsername.focus();
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
  assert.equal(document.activeElement, submitBtn);

  loginPassword.focus();
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

  assert.ok(!loginModal.classList.contains("active"));
});

test("qr modal traps keyboard focus and restores focus on Escape close", async () => {
  const dom = await setupDomWithDashboardScript();
  const { window } = dom;
  const { document } = window;

  const trigger = document.getElementById("refreshBtn");
  const qrModal = document.getElementById("qrModal");
  const valueInput = document.getElementById("qrValueInput");
  const focusables = () =>
    Array.from(
      qrModal.querySelectorAll(
        "button:not([disabled]), input:not([type=\"hidden\"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex=\"-1\"])",
      ),
    ).filter((node) => node instanceof window.HTMLElement && !node.hasAttribute("disabled"));

  trigger.focus();
  window.showQrModal({ type: "installation", value: "245" });

  assert.ok(qrModal.classList.contains("active"));
  assert.equal(document.activeElement, valueInput);

  const modalFocusables = focusables();
  const first = modalFocusables[0];
  const last = modalFocusables[modalFocusables.length - 1];
  last.focus();
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
  assert.equal(document.activeElement, first);

  first.focus();
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
  assert.equal(document.activeElement, last);

  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.ok(!qrModal.classList.contains("active"));
  assert.equal(document.activeElement, trigger);
});

test("escape closes nested qr password modal first, then qr modal, with correct focus restoration", async () => {
  const dom = await setupDomWithDashboardScript();
  const { window } = dom;
  const { document } = window;

  const trigger = document.getElementById("refreshBtn");
  const qrModal = document.getElementById("qrModal");
  const qrPasswordModal = document.getElementById("qrPasswordModal");
  const serialInput = document.getElementById("qrAssetSerialInput");
  const passwordInput = document.getElementById("qrPasswordInput");

  trigger.focus();
  window.showQrModal({ type: "asset" });
  assert.ok(qrModal.classList.contains("active"));
  assert.equal(document.activeElement, serialInput);

  window.openQrPasswordModal();
  assert.ok(qrPasswordModal.classList.contains("active"));
  assert.equal(document.activeElement, passwordInput);

  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.ok(!qrPasswordModal.classList.contains("active"));
  assert.ok(qrModal.classList.contains("active"));
  assert.equal(document.activeElement, serialInput);

  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.ok(!qrModal.classList.contains("active"));
  assert.equal(document.activeElement, trigger);
});

test("action and photo modals close with Escape and restore focus to trigger", async () => {
  const dom = await setupDomWithDashboardScript();
  const { window } = dom;
  const { document } = window;

  const trigger = document.getElementById("refreshBtn");
  const actionModal = document.getElementById("actionModal");
  const photoModal = document.getElementById("photoModal");
  const photoCloseButton = document.querySelector("#photoModal .close");
  const probeInput = document.createElement("input");
  probeInput.id = "actionProbeInput";
  probeInput.type = "text";
  probeInput.value = "ok";

  trigger.focus();
  window.openActionModal({
    title: "Confirmar",
    submitLabel: "Guardar",
    fields: probeInput,
    focusId: "actionProbeInput",
    onSubmit: async () => {},
  });
  assert.ok(actionModal.classList.contains("active"));
  assert.equal(document.activeElement?.id, "actionProbeInput");

  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.ok(!actionModal.classList.contains("active"));
  assert.equal(document.activeElement, trigger);

  trigger.focus();
  window.openAccessibleModal("photoModal", { preferredElement: photoCloseButton });
  assert.ok(photoModal.classList.contains("active"));
  assert.equal(document.activeElement, photoCloseButton);

  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.ok(!photoModal.classList.contains("active"));
  assert.equal(document.activeElement, trigger);
});

test("clickable table rows are keyboard accessible with Enter and Space", async () => {
  const dom = await setupDomWithDashboardScript();
  const { window } = dom;
  const { document } = window;

  window.renderInstallationsTable([
    {
      id: 77,
      client_name: "Cliente QA",
      driver_brand: "Entrust",
      installation_time_seconds: 9,
      notes: "prueba",
      timestamp: "2026-03-09T10:00:00.000Z",
      attention_state: "open",
      incident_active_count: 1,
      incident_resolved_count: 0,
    },
  ]);

  const row = document.querySelector("#installationsTable tr[data-id]");
  assert.ok(row, "installation row should exist");
  assert.equal(row.getAttribute("role"), "button");
  assert.equal(row.getAttribute("tabindex"), "0");

  let activated = 0;
  row.addEventListener("click", () => {
    activated += 1;
  });

  row.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  row.dispatchEvent(new window.KeyboardEvent("keydown", { key: " ", bubbles: true }));

  assert.equal(activated, 2);

  window.renderAssetsTable([
    {
      id: 99,
      external_code: "EQ-99",
      brand: "Entrust",
      model: "Sigma SL3",
      serial_number: "SN-99",
      client_name: "Cliente QA",
      installation_count: 0,
      created_at: "2026-03-09T10:00:00.000Z",
      updated_at: "2026-03-09T10:00:00.000Z",
    },
  ]);

  const assetRow = document.querySelector("#assetsTable tr[data-asset-id]");
  assert.ok(assetRow, "asset row should exist");
  assert.equal(assetRow.getAttribute("role"), "button");
  assert.equal(assetRow.getAttribute("tabindex"), "0");
});

test("manual record action renders icon + clean text without mojibake", async () => {
  const dom = await setupDomWithDashboardScript();
  const { window } = dom;
  const { document } = window;

  window.setupAdvancedFilters();

  const actionButton = document.getElementById("createManualRecordBtn");
  assert.ok(actionButton, "createManualRecordBtn should exist");
  assert.match(actionButton.textContent, /Nuevo registro manual/);
  assert.equal(actionButton.textContent.includes("Y\""), false);
  assert.equal(actionButton.textContent.includes("YY"), false);

  const icon = actionButton.querySelector(".material-symbols-outlined");
  assert.ok(icon, "manual action should include material icon");
  assert.equal(icon.textContent.trim(), "edit_note");
});

test("incidents header action labels keep material icons and readable copy", async () => {
  const dom = await setupDomWithDashboardScript();
  const { window } = dom;
  const { document } = window;

  await window.renderIncidents([], 31);

  const heading = document.querySelector("#incidentsList .incidents-header h3");
  const headingIcon = heading?.querySelector(".material-symbols-outlined");
  assert.ok(heading);
  assert.ok(headingIcon);
  assert.equal(headingIcon.textContent.trim(), "warning");
  assert.match(heading.textContent, /Incidencias del registro #31/i);

  const createButton = document.querySelector('#incidentsList .incidents-header-actions [data-role="create-incident-trigger"]');
  const conformityButton = document.querySelector('#incidentsList .incidents-header-actions [data-role="conformity-trigger"]');
  const backButton = Array.from(document.querySelectorAll("#incidentsList .incidents-header-actions .btn-secondary"))
    .find((button) => button.textContent.includes("Volver"));

  assert.ok(createButton);
  assert.ok(conformityButton);
  assert.ok(backButton);
  assert.equal(createButton.querySelector(".material-symbols-outlined")?.textContent.trim(), "add_alert");
  assert.equal(conformityButton.querySelector(".material-symbols-outlined")?.textContent.trim(), "rule");
  assert.equal(backButton.querySelector(".material-symbols-outlined")?.textContent.trim(), "arrow_back");
  assert.match(createButton.textContent, /Abrir nueva incidencia/);
  assert.match(conformityButton.textContent, /Enviar conformidad final/);
  assert.equal(conformityButton.disabled, true);
  assert.match(backButton.textContent, /Volver/);
  assert.equal(backButton.textContent.includes("?"), false);
});

test("dashboard surface has semantic landmarks and accessible navigation hooks", () => {
  const html = loadDashboardHtml();
  const dom = new JSDOM(html);
  const { document } = dom.window;

  assert.ok(document.querySelector("nav.sidebar"));
  assert.ok(document.querySelector("main.main-content"));

  const navLinks = Array.from(document.querySelectorAll(".nav-links a"));
  assert.ok(navLinks.length >= 4);
  navLinks.forEach((link) => {
    assert.equal(link.getAttribute("href"), "#");
    assert.ok(link.dataset.section);
  });
});
