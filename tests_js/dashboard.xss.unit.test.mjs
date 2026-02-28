import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const dashboardScript = fs.readFileSync(new URL('../public/dashboard.js', import.meta.url), 'utf8');

function createDashboardDom() {
  return new JSDOM(`<!DOCTYPE html><html><head></head><body>
    <form id="loginForm"></form>
    <input id="loginUsername" />
    <input id="loginPassword" />
    <p id="loginError"></p>
    <button id="logoutBtn"></button>
    <button id="refreshBtn"></button>
    <button id="applyFilters"></button>
    <button id="refreshAudit"></button>
    <select id="auditActionFilter"></select>
    <div class="nav-links">
      <a data-section="dashboard"></a>
      <a data-section="installations"></a>
      <a data-section="incidents"></a>
      <a data-section="audit"></a>
    </div>
    <h1 id="pageTitle"></h1>
    <div id="photoModal"><span class="close"></span></div>
    <img id="photoViewer" />
    <div id="dashboardSection" class="section active"></div>
    <div id="installationsSection" class="section"></div>
    <div id="incidentsSection" class="section"></div>
    <div id="auditSection" class="section"></div>
    <div id="recentInstallations"></div>
    <div id="installationsTable"></div>
    <div id="incidentsList"></div>
    <div id="auditLogs"></div>
    <div id="filterChips"></div>
    <button id="clearFilters"></button>
    <input id="searchInput" />
    <input id="brandFilter" />
    <input id="statusFilter" />
    <input id="startDate" />
    <input id="endDate" />
    <div id="loginModal"></div>
    <span id="username"></span>
    <span id="userRole"></span>
    <canvas id="successChart"></canvas>
    <canvas id="brandChart"></canvas>
    <canvas id="trendChart"></canvas>
  </body></html>`, {
    runScripts: 'dangerously',
    url: 'http://localhost/'
  });
}

describe('dashboard render XSS hardening', () => {
  let dom;
  let { window } = globalThis;

  beforeEach(() => {
    dom = createDashboardDom();
    window = dom.window;

    window.Chart = class {
      static defaults = { color: '', borderColor: '', font: {} };
      destroy() {}
      update() {}
    };
    window.fetch = async () => ({ status: 200, ok: true, json: async () => ({}) });
    window.EventSource = class { close() {} };

    window.eval(dashboardScript);
  });

  it('renders recent/installations/audit text payloads safely', () => {
    const payload = '<img src=x onerror=window.__xss=1>';

    window.renderRecentInstallations([
      { id: payload, client_name: payload, driver_brand: payload, status: payload, timestamp: '2025-01-01T10:00:00Z' }
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
        timestamp: '2025-01-01T10:00:00Z'
      }
    ]);
    window.renderAuditLogs([
      {
        timestamp: '2025-01-01T10:00:00Z',
        action: payload,
        username: payload,
        success: true,
        details: payload
      }
    ]);

    assert.equal(window.__xss, undefined);
    assert.equal(window.document.querySelector('#recentInstallations td img'), null);
    assert.equal(window.document.querySelector('#installationsTable td img'), null);
    assert.equal(window.document.querySelector('#auditLogs td img'), null);

    const notesCell = window.document.querySelector('#installationsTable tbody tr td:nth-child(7)');
    assert.ok(notesCell.textContent.includes('<img src=x onerror=window.__xs'));
  });

  it('renders incidents and filter chips with malicious text as plain content', async () => {
    const payload = '<img src=x onerror=window.__chipXss=1>';

    window.document.getElementById('searchInput').value = payload;
    window.document.getElementById('brandFilter').value = payload;
    window.document.getElementById('statusFilter').value = 'failed';
    window.document.getElementById('startDate').value = '2025-01-01';
    window.updateFilterChips();

    await window.renderIncidents([
      {
        severity: payload,
        reporter_username: payload,
        created_at: '2025-01-01T10:00:00Z',
        note: payload,
        photos: []
      }
    ], payload);

    assert.equal(window.__chipXss, undefined);
    assert.equal(window.document.querySelector('#filterChips img'), null);
    assert.equal(window.document.querySelector('#incidentsList p img'), null);

    const chipValue = window.document.querySelector('#filterChips .chip-value');
    assert.match(chipValue.textContent, /<img src=x onerror=window.__chipXss=1>/);

    const incidentNote = window.document.querySelector('#incidentsList .incident-card p');
    assert.match(incidentNote.textContent, /<img src=x onerror=window.__chipXss=1>/);
  });
});
