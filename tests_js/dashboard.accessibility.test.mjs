import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

function loadDashboardHtml() {
  const filePath = path.join(process.cwd(), 'dashboard.html');
  const raw = fs.readFileSync(filePath, 'utf-8');
  return raw.replace(/<script\s+src="https:\/\/cdn\.jsdelivr\.net[^>]*><\/script>/i, '');
}

function setupDomWithDashboardScript() {
  const html = loadDashboardHtml();
  const dom = new JSDOM(html, {
    url: 'http://localhost:8787/dashboard',
    runScripts: 'outside-only'
  });

  const { window } = dom;
  const context = dom.getInternalVMContext();

  window.localStorage.clear();
  window.Chart = {
    defaults: {
      color: '#94a3b8',
      borderColor: '#334155',
      font: {}
    }
  };

  window.fetch = async () => ({
    status: 200,
    json: async () => ({})
  });

  window.matchMedia = () => ({
    matches: false,
    addEventListener() {}
  });

  window.EventSource = class {
    close() {}
  };

  const apiScriptPath = path.join(process.cwd(), 'dashboard-api.js');
  const apiScriptContent = fs.readFileSync(apiScriptPath, 'utf-8');
  const apiScript = new vm.Script(apiScriptContent, { filename: 'dashboard-api.js' });
  apiScript.runInContext(context);

  const dashboardScriptPath = path.join(process.cwd(), 'dashboard.js');
  const dashboardScriptContent = fs.readFileSync(dashboardScriptPath, 'utf-8');
  const dashboardScript = new vm.Script(dashboardScriptContent, { filename: 'dashboard.js' });
  dashboardScript.runInContext(context);

  return dom;
}

test('dashboard icon buttons expose explicit aria-label and pressed state', () => {
  const dom = setupDomWithDashboardScript();
  const { document } = dom.window;

  const themeToggle = document.getElementById('themeToggle');
  const refreshBtn = document.getElementById('refreshBtn');
  const closePhotoBtn = document.querySelector('#photoModal .close');

  assert.equal(themeToggle.tagName, 'BUTTON');
  assert.ok(themeToggle.getAttribute('aria-label'));
  assert.ok(['true', 'false'].includes(themeToggle.getAttribute('aria-pressed')));

  assert.equal(refreshBtn.tagName, 'BUTTON');
  assert.equal(refreshBtn.getAttribute('aria-label'), 'Actualizar dashboard');

  assert.equal(closePhotoBtn.tagName, 'BUTTON');
  assert.equal(closePhotoBtn.getAttribute('type'), 'button');
  assert.equal(closePhotoBtn.getAttribute('aria-label'), 'Cerrar visor de foto');
});

test('all dashboard modals expose accessible dialog semantics', () => {
  const html = loadDashboardHtml();
  const dom = new JSDOM(html);
  const { document } = dom.window;

  const modalIds = ['loginModal', 'photoModal', 'qrModal', 'qrPasswordModal', 'actionModal'];
  modalIds.forEach((modalId) => {
    const modal = document.getElementById(modalId);
    assert.ok(modal, `${modalId} should exist`);
    assert.equal(modal.getAttribute('role'), 'dialog');
    assert.equal(modal.getAttribute('aria-modal'), 'true');

    const labelledBy = String(modal.getAttribute('aria-labelledby') || '').trim();
    const describedBy = String(modal.getAttribute('aria-describedby') || '').trim();
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

test('login modal keeps keyboard focus trapped and restores focus to trigger on close', () => {
  const dom = setupDomWithDashboardScript();
  const { window } = dom;
  const { document } = window;

  const trigger = document.getElementById('themeToggle');
  const loginUsername = document.getElementById('loginUsername');
  const loginPassword = document.getElementById('loginPassword');
  const submitBtn = document.querySelector('#loginForm button[type="submit"]');
  const loginModal = document.getElementById('loginModal');

  trigger.focus();
  window.showLogin();

  assert.ok(loginModal.classList.contains('active'));
  assert.equal(document.activeElement, loginUsername);

  submitBtn.focus();
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  assert.equal(document.activeElement, loginUsername);

  loginUsername.focus();
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
  assert.equal(document.activeElement, submitBtn);

  loginPassword.focus();
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

  assert.ok(!loginModal.classList.contains('active'));
  assert.equal(document.activeElement, trigger);
});

test('qr modal traps keyboard focus and restores focus on Escape close', () => {
  const dom = setupDomWithDashboardScript();
  const { window } = dom;
  const { document } = window;

  const trigger = document.getElementById('themeToggle');
  const qrModal = document.getElementById('qrModal');
  const valueInput = document.getElementById('qrValueInput');
  const focusables = () =>
    Array.from(
      qrModal.querySelectorAll(
        'button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((node) => node instanceof window.HTMLElement && !node.hasAttribute('disabled'));

  trigger.focus();
  window.showQrModal({ type: 'installation', value: '245' });

  assert.ok(qrModal.classList.contains('active'));
  assert.equal(document.activeElement, valueInput);

  const modalFocusables = focusables();
  const first = modalFocusables[0];
  const last = modalFocusables[modalFocusables.length - 1];
  last.focus();
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  assert.equal(document.activeElement, first);

  first.focus();
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
  assert.equal(document.activeElement, last);

  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.ok(!qrModal.classList.contains('active'));
  assert.equal(document.activeElement, trigger);
});

test('escape closes nested qr password modal first, then qr modal, with correct focus restoration', () => {
  const dom = setupDomWithDashboardScript();
  const { window } = dom;
  const { document } = window;

  const trigger = document.getElementById('themeToggle');
  const qrModal = document.getElementById('qrModal');
  const qrPasswordModal = document.getElementById('qrPasswordModal');
  const serialInput = document.getElementById('qrAssetSerialInput');
  const passwordInput = document.getElementById('qrPasswordInput');

  trigger.focus();
  window.showQrModal({ type: 'asset' });
  assert.ok(qrModal.classList.contains('active'));
  assert.equal(document.activeElement, serialInput);

  window.openQrPasswordModal();
  assert.ok(qrPasswordModal.classList.contains('active'));
  assert.equal(document.activeElement, passwordInput);

  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.ok(!qrPasswordModal.classList.contains('active'));
  assert.ok(qrModal.classList.contains('active'));
  assert.equal(document.activeElement, serialInput);

  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.ok(!qrModal.classList.contains('active'));
  assert.equal(document.activeElement, trigger);
});

test('action and photo modals close with Escape and restore focus to trigger', () => {
  const dom = setupDomWithDashboardScript();
  const { window } = dom;
  const { document } = window;

  const trigger = document.getElementById('themeToggle');
  const actionModal = document.getElementById('actionModal');
  const photoModal = document.getElementById('photoModal');
  const photoCloseButton = document.querySelector('#photoModal .close');

  trigger.focus();
  window.openActionModal({
    title: 'Confirmar',
    submitLabel: 'Guardar',
    fieldsHtml: '<input id="actionProbeInput" type="text" value="ok">',
    focusId: 'actionProbeInput',
    onSubmit: async () => {},
  });
  assert.ok(actionModal.classList.contains('active'));
  assert.equal(document.activeElement?.id, 'actionProbeInput');

  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.ok(!actionModal.classList.contains('active'));
  assert.equal(document.activeElement, trigger);

  trigger.focus();
  window.openAccessibleModal('photoModal', { preferredElement: photoCloseButton });
  assert.ok(photoModal.classList.contains('active'));
  assert.equal(document.activeElement, photoCloseButton);

  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.ok(!photoModal.classList.contains('active'));
  assert.equal(document.activeElement, trigger);
});

test('clickable table rows are keyboard accessible with Enter and Space', () => {
  const dom = setupDomWithDashboardScript();
  const { window } = dom;
  const { document } = window;

  window.renderInstallationsTable([
    {
      id: 77,
      client_name: 'Cliente QA',
      driver_brand: 'Entrust',
      installation_time_seconds: 9,
      notes: 'prueba',
      timestamp: '2026-03-09T10:00:00.000Z',
      attention_state: 'open',
      incident_active_count: 1,
      incident_resolved_count: 0,
    },
  ]);

  const row = document.querySelector('#installationsTable tr[data-id]');
  assert.ok(row, 'installation row should exist');
  assert.equal(row.getAttribute('role'), 'button');
  assert.equal(row.getAttribute('tabindex'), '0');

  let activated = 0;
  row.addEventListener('click', () => {
    activated += 1;
  });

  row.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  row.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true }));

  assert.equal(activated, 2);

  window.renderAssetsTable([
    {
      id: 99,
      external_code: 'EQ-99',
      brand: 'Entrust',
      model: 'Sigma SL3',
      serial_number: 'SN-99',
      client_name: 'Cliente QA',
      installation_count: 0,
      created_at: '2026-03-09T10:00:00.000Z',
      updated_at: '2026-03-09T10:00:00.000Z',
    },
  ]);

  const assetRow = document.querySelector('#assetsTable tr[data-asset-id]');
  assert.ok(assetRow, 'asset row should exist');
  assert.equal(assetRow.getAttribute('role'), 'button');
  assert.equal(assetRow.getAttribute('tabindex'), '0');
});

test('manual record action renders icon + clean text without mojibake', () => {
  const dom = setupDomWithDashboardScript();
  const { window } = dom;
  const { document } = window;

  window.setupAdvancedFilters();

  const actionButton = document.getElementById('createManualRecordBtn');
  assert.ok(actionButton, 'createManualRecordBtn should exist');
  assert.match(actionButton.textContent, /Nuevo registro manual/);
  assert.equal(actionButton.textContent.includes('Y"'), false);
  assert.equal(actionButton.textContent.includes('YY'), false);

  const icon = actionButton.querySelector('.material-symbols-outlined');
  assert.ok(icon, 'manual action should include material icon');
  assert.equal(icon.textContent.trim(), 'edit_note');
});

test('incidents header action labels keep material icons and readable copy', async () => {
  const dom = setupDomWithDashboardScript();
  const { window } = dom;
  const { document } = window;

  await window.renderIncidents([], 31);

  const heading = document.querySelector('#incidentsList .incidents-header h3');
  const headingIcon = heading?.querySelector('.material-symbols-outlined');
  assert.ok(heading);
  assert.ok(headingIcon);
  assert.equal(headingIcon.textContent.trim(), 'warning');
  assert.match(heading.textContent, /Incidencias de Registro #31/);

  const createButton = document.querySelector('#incidentsList .incidents-header-actions .btn-primary');
  const backButton = document.querySelector('#incidentsList .incidents-header-actions .btn-secondary');
  assert.ok(createButton);
  assert.ok(backButton);
  assert.equal(createButton.querySelector('.material-symbols-outlined')?.textContent.trim(), 'add_circle');
  assert.equal(backButton.querySelector('.material-symbols-outlined')?.textContent.trim(), 'arrow_back');
  assert.match(createButton.textContent, /Crear incidencia/);
  assert.match(backButton.textContent, /Volver/);
  assert.equal(backButton.textContent.includes('?'), false);
});

test('dashboard surface has semantic landmarks and accessible navigation hooks', () => {
  const html = loadDashboardHtml();
  const dom = new JSDOM(html);
  const { document } = dom.window;

  assert.ok(document.querySelector('nav.sidebar'));
  assert.ok(document.querySelector('main.main-content'));

  const navLinks = Array.from(document.querySelectorAll('.nav-links a'));
  assert.ok(navLinks.length >= 4);
  navLinks.forEach((link) => {
    assert.equal(link.getAttribute('href'), '#');
    assert.ok(link.dataset.section);
  });
});
