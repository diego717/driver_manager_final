import assert from 'node:assert/strict';
import test from 'node:test';

import { createAnalyticsRouteHandlers } from '../../worker/routes/analytics.js';
import { createBrandingRouteHandlers } from '../../worker/routes/branding.js';

function jsonResponse(_request, _env, _corsPolicy, payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

test('analytics definitions route returns executive metric dictionary', async () => {
  const handlers = createAnalyticsRouteHandlers({ jsonResponse });

  const response = await handlers.handleAnalyticsRoute(
    new Request('https://worker.example/web/analytics/definitions'),
    { DB: null },
    new URL('https://worker.example/web/analytics/definitions'),
    {},
    ['analytics', 'definitions'],
    true,
    { role: 'admin', tenant_id: 'tenant-a' },
    'tenant-b',
  );

  assert.ok(response instanceof Response);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  const metrics = body.metrics && typeof body.metrics === 'object' ? body.metrics : {};
  assert.equal(Object.prototype.hasOwnProperty.call(metrics, 'mttr_minutes'), true);
  assert.match(String(metrics?.fcr_pct || ''), /7 dias/i);
});

test('analytics executive route rejects oversized date range', async () => {
  const handlers = createAnalyticsRouteHandlers({ jsonResponse });
  await assert.rejects(
    handlers.handleAnalyticsRoute(
      new Request('https://worker.example/web/analytics/executive?start_date=2024-01-01&end_date=2026-05-04'),
      { DB: null },
      new URL('https://worker.example/web/analytics/executive?start_date=2024-01-01&end_date=2026-05-04'),
      {},
      ['analytics', 'executive'],
      true,
      { role: 'admin', tenant_id: 'tenant-a' },
      'tenant-a',
    ),
    (error) => {
      assert.equal(error?.status, 400);
      assert.match(String(error?.message || ''), /maximo permitido/i);
      return true;
    },
  );
});

test('analytics executive route scopes KPI queries to authenticated tenant', async () => {
  const calls = [];
  const db = {
    prepare(sql) {
      const normalized = String(sql || '').replace(/\s+/g, ' ').trim();
      const call = { normalized, bound: [] };
      return {
        bind(...args) {
          call.bound = args;
          return this;
        },
        async all() {
          calls.push(call);
          if (normalized.includes('SELECT COUNT(*) AS total FROM incident_kpi_daily')) {
            return { results: [{ total: 1 }] };
          }
          if (normalized.includes('SUM(d.resolved_count)')) {
            return {
              results: [{
                resolved_total: 4,
                mttr_seconds_sum: 7200,
                sla_on_time_count: 3,
                sla_late_count: 1,
                fcr_count: 2,
              }],
            };
          }
          if (normalized.includes('FROM incident_kpi_daily d LEFT JOIN technicians t')) {
            return {
              results: [{
                technician_id: 12,
                technician_label: 'Tecnico Uno',
                team_name: 'NOC',
                closed_tickets: 4,
                fcr_hits: 2,
              }],
            };
          }
          if (normalized.includes('GROUP BY d.cause_code')) {
            return { results: [{ cause_code: 'power', cause_label: 'Energia', incidents: 2 }] };
          }
          if (normalized.includes('GROUP BY d.day')) {
            return {
              results: [{
                day: '2026-05-01',
                resolved_count: 4,
                sla_on_time_count: 3,
                sla_late_count: 1,
                mttr_seconds_sum: 7200,
              }],
            };
          }
          if (normalized.includes('GROUP BY i.asset_id')) {
            return { results: [{ asset_id: 99, incidents: 2 }] };
          }
          if (normalized.includes('GROUP BY i.site_id')) {
            return { results: [{ site_id: 7, site_name: 'Montevideo', incidents: 2 }] };
          }
          if (normalized.includes('GROUP BY category_code')) {
            return { results: [{ category_code: 'software', category_label: 'Software', incidents: 2 }] };
          }
          if (normalized.includes('FROM tenant_sites')) {
            return { results: [{ id: 7, code: 'MVD', name: 'Montevideo' }] };
          }
          if (normalized.includes('SELECT DISTINCT team_name FROM technicians')) {
            return { results: [{ team_name: 'NOC' }] };
          }
          if (normalized.includes('SELECT id, display_name, team_name FROM technicians')) {
            return { results: [{ id: 12, display_name: 'Tecnico Uno', team_name: 'NOC' }] };
          }
          throw new Error(`Unexpected SQL: ${normalized}`);
        },
      };
    },
  };

  const handlers = createAnalyticsRouteHandlers({ jsonResponse });
  const response = await handlers.handleAnalyticsRoute(
    new Request('https://worker.example/web/analytics/executive?start_date=2026-05-01&end_date=2026-05-04'),
    { DB: db },
    new URL('https://worker.example/web/analytics/executive?start_date=2026-05-01&end_date=2026-05-04'),
    {},
    ['analytics', 'executive'],
    true,
    { role: 'admin', tenant_id: 'tenant-a' },
    'tenant-b',
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.kpis?.resolved_tickets, 4);

  const scopedCall = calls.find((entry) => entry.normalized.includes('SUM(d.resolved_count)'));
  assert.ok(scopedCall);
  assert.equal(scopedCall.bound[0], 'tenant-a');
  assert.notEqual(scopedCall.bound[0], 'tenant-b');
});

test('branding route returns default fallback branding when tenant has no custom config', async () => {
  const db = {
    prepare(sql) {
      const normalized = String(sql || '').replace(/\s+/g, ' ').trim();
      return {
        bind() {
          return this;
        },
        async all() {
          if (normalized.includes('FROM tenants')) {
            return { results: [{ id: 'tenant-a', name: 'Acme SA' }] };
          }
          if (normalized.includes('FROM tenant_branding')) {
            return { results: [] };
          }
          throw new Error(`Unexpected SQL: ${normalized}`);
        },
      };
    },
  };

  const handlers = createBrandingRouteHandlers({
    jsonResponse,
    corsHeaders: () => ({}),
    canManageAllTenants: () => false,
    assertSameTenantOrSuperAdmin() {},
    nowIso: () => '2026-05-05T12:00:00.000Z',
    async logAuditEvent() {},
    getClientIpForRateLimit: () => '127.0.0.1',
  });

  const response = await handlers.handleBrandingRoute(
    new Request('https://worker.example/web/branding'),
    { DB: db },
    new URL('https://worker.example/web/branding'),
    {},
    ['branding'],
    true,
    { role: 'admin', tenant_id: 'tenant-a', sub: 'admin' },
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.branding?.display_name, 'Acme SA');
  assert.equal(body.branding?.primary_color, '#d97706');
  assert.equal(body.branding?.secondary_color, '#b45309');
});

test('analytics executive route keeps responding when aggregate refresh fails due legacy schema', async () => {
  const db = {
    prepare(sql) {
      const normalized = String(sql || '').replace(/\s+/g, ' ').trim();
      return {
        bind() {
          return this;
        },
        async all() {
          if (normalized.includes('SELECT COUNT(*) AS total FROM incident_kpi_daily WHERE tenant_id = ?')) {
            return { results: [{ total: 0 }] };
          }
          if (normalized.includes('SELECT COUNT(*) AS total FROM incident_kpi_daily')) {
            return { results: [{ total: 0 }] };
          }
          if (normalized.includes('INSERT INTO incident_kpi_daily')) {
            throw new Error('no such column: audit_logs.details');
          }
          if (normalized.includes('SUM(d.resolved_count)')) {
            return {
              results: [{
                resolved_total: 0,
                mttr_seconds_sum: 0,
                sla_on_time_count: 0,
                sla_late_count: 0,
                fcr_count: 0,
              }],
            };
          }
          if (normalized.includes('FROM incident_kpi_daily d LEFT JOIN technicians t')) {
            return { results: [] };
          }
          if (normalized.includes('GROUP BY d.cause_code')) {
            return { results: [] };
          }
          if (normalized.includes('GROUP BY d.day')) {
            return { results: [] };
          }
          if (normalized.includes('GROUP BY i.asset_id')) {
            return { results: [] };
          }
          if (normalized.includes('GROUP BY i.site_id')) {
            return { results: [] };
          }
          if (normalized.includes('GROUP BY category_code')) {
            return { results: [] };
          }
          if (normalized.includes('FROM tenant_sites')) {
            return { results: [] };
          }
          if (normalized.includes('SELECT DISTINCT team_name FROM technicians')) {
            return { results: [] };
          }
          if (normalized.includes('SELECT id, display_name, team_name FROM technicians')) {
            return { results: [] };
          }
          if (normalized.includes('DELETE FROM incident_kpi_daily')) {
            return { results: [] };
          }
          throw new Error(`Unexpected SQL: ${normalized}`);
        },
        async run() {
          if (normalized.includes('DELETE FROM incident_kpi_daily')) {
            return {};
          }
          if (normalized.includes('INSERT INTO incident_kpi_daily')) {
            throw new Error('no such column: audit_logs.details');
          }
          return {};
        },
      };
    },
  };

  const handlers = createAnalyticsRouteHandlers({ jsonResponse });
  const response = await handlers.handleAnalyticsRoute(
    new Request('https://worker.example/web/analytics/executive?start_date=2026-05-01&end_date=2026-05-04'),
    { DB: db },
    new URL('https://worker.example/web/analytics/executive?start_date=2026-05-01&end_date=2026-05-04'),
    {},
    ['analytics', 'executive'],
    true,
    { role: 'admin', tenant_id: 'tenant-a' },
    'tenant-a',
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.kpis?.resolved_tickets, 0);
  assert.equal(Array.isArray(body.top_causes), true);
});

test('analytics executive productivity query avoids ambiguous team_name grouping', async () => {
  const calls = [];
  const db = {
    prepare(sql) {
      const normalized = String(sql || '').replace(/\s+/g, ' ').trim();
      const call = { normalized, bound: [] };
      return {
        bind(...args) {
          call.bound = args;
          return this;
        },
        async all() {
          calls.push(call);

          if (normalized.includes('GROUP BY d.technician_id, technician_label, team_name')) {
            throw new Error('ambiguous column name: team_name');
          }
          if (normalized.includes('SELECT COUNT(*) AS total FROM incident_kpi_daily WHERE tenant_id = ?')) {
            return { results: [{ total: 1 }] };
          }
          if (normalized.includes('SUM(d.resolved_count)')) {
            return {
              results: [{
                resolved_total: 2,
                mttr_seconds_sum: 600,
                sla_on_time_count: 2,
                sla_late_count: 0,
                fcr_count: 2,
              }],
            };
          }
          if (normalized.includes('FROM incident_kpi_daily d LEFT JOIN technicians t')) {
            return {
              results: [{
                technician_id: 1,
                technician_label: 'Tecnico',
                team_name: 'NOC',
                closed_tickets: 2,
                fcr_hits: 2,
              }],
            };
          }
          if (normalized.includes('GROUP BY d.cause_code')) {
            return { results: [] };
          }
          if (normalized.includes('GROUP BY d.day')) {
            return { results: [] };
          }
          if (normalized.includes('GROUP BY i.asset_id')) {
            return { results: [] };
          }
          if (normalized.includes('GROUP BY i.site_id')) {
            return { results: [] };
          }
          if (normalized.includes('GROUP BY category_code')) {
            return { results: [] };
          }
          if (normalized.includes('FROM tenant_sites')) {
            return { results: [] };
          }
          if (normalized.includes('SELECT DISTINCT team_name FROM technicians')) {
            return { results: [] };
          }
          if (normalized.includes('SELECT id, display_name, team_name FROM technicians')) {
            return { results: [] };
          }
          throw new Error(`Unexpected SQL: ${normalized}`);
        },
      };
    },
  };

  const handlers = createAnalyticsRouteHandlers({ jsonResponse });
  const response = await handlers.handleAnalyticsRoute(
    new Request('https://worker.example/web/analytics/executive?start_date=2026-05-01&end_date=2026-05-04'),
    { DB: db },
    new URL('https://worker.example/web/analytics/executive?start_date=2026-05-01&end_date=2026-05-04'),
    {},
    ['analytics', 'executive'],
    true,
    { role: 'admin', tenant_id: 'tenant-a' },
    'tenant-a',
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);

  const productivityCall = calls.find((entry) => entry.normalized.includes('FROM incident_kpi_daily d LEFT JOIN technicians t'));
  assert.ok(productivityCall);
  assert.match(
    productivityCall.normalized,
    /GROUP BY d\.technician_id, technician_label, COALESCE\(NULLIF\(TRIM\(t\.team_name\), ''\), ''\)/,
  );
});
