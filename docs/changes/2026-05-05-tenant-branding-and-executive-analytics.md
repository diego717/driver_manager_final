# 2026-05-05 - branding multi-tenant y dashboard ejecutivo de analitica

## Resumen

- se incorpora branding por tenant con nombre visual, logo y paleta configurable
- se agrega panel ejecutivo de KPIs con filtros, tendencia y export (CSV/XLSX)
- se extiende el esquema D1 para sitios, taxonomia de incidencias, politicas SLA y agregados diarios KPI
- se agregan rutas backend dedicadas para branding y analitica ejecutiva
- se refuerza compatibilidad con esquemas legacy para evitar caidas durante migraciones parciales

## Areas tocadas

- worker (rutas, servicios y cron de agregacion KPI)
- migraciones D1
- dashboard web y assets publicados
- service worker / versionado de assets
- tests JS de rutas y contrato

## Contexto

El proyecto necesitaba dos capacidades nuevas para escala multi-tenant:

- identidad visual configurable por tenant, sin forks del frontend
- lectura ejecutiva de desempeño (MTTR, SLA, FCR, reincidencia y productividad) con filtros operativos

## Cambios clave

- migracion `migrations/0028_tenant_branding_executive_analytics.sql`
  - nuevas tablas: `tenant_branding`, `tenant_sites`, `incident_categories`, `incident_causes`, `tenant_sla_policies`, `incident_kpi_daily`
  - nuevas columnas: `installations.site_id`, `incidents.site_id`, `incidents.category_code`, `incidents.cause_code`, `technicians.team_name`
  - indices para consultas por tenant/sitio/categoria/causa/severidad/fecha
  - seed inicial de categorias/causas y SLA base por severidad
- branding backend
  - nuevas rutas via `worker/routes/branding.js`:
    - `GET /web/branding`
    - `GET /web/branding/logo`
    - `GET /web/tenants/:tenant_id/branding`
    - `PATCH /web/tenants/:tenant_id/branding`
    - `POST /web/tenants/:tenant_id/branding/logo`
  - normalizacion de colores, limites de upload y auditoria de cambios de branding/logo
- analitica ejecutiva backend
  - nuevas rutas via `worker/routes/analytics.js`:
    - `GET /web/analytics/definitions`
    - `GET /web/analytics/executive`
  - agregacion de KPIs diarios y filtros por rango, sitio, tecnico y equipo
  - fallback controlado ante schema mismatch legacy (responde en lugar de romper)
- dashboard web
  - `dashboard-api.js` agrega cliente para branding/analytics
  - `dashboard.js`, `dashboard.html`, `dashboard.css` agregan:
    - panel ejecutivo con KPIs, tendencia, top causas, productividad y reincidencia
    - export de reporte ejecutivo a CSV/XLSX
    - carga runtime de branding del tenant (nombre, logo y variables CSS)
    - modal de edicion de branding desde `Tenant Admin Center`
- operacion y jobs
  - `worker.js` integra handlers de branding/analytics
  - cron suma refresh de `incident_kpi_daily` junto a tareas existentes
- publicacion
  - `public/*` y `public/sw.js` quedan sincronizados con nuevos bundles/versiones
  - `package.json` incorpora los tests de branding/analytics en `test:worker:raw`

## Impacto

- funcional: cada tenant puede personalizar su identidad visual sin duplicar dashboard
- operativo: aparece una vista ejecutiva con indicadores consolidados y exportables
- tecnico: mejor base de datos para analitica (sitio, categoria, causa, SLA, equipo)
- rollout: menor riesgo en tenants con esquema incompleto gracias al manejo defensivo de compatibilidad

## Referencias

- `migrations/0028_tenant_branding_executive_analytics.sql`
- `worker/routes/branding.js`
- `worker/routes/analytics.js`
- `worker/services/analytics.js`
- `worker/routes/incidents.js`
- `worker/services/incidents.js`
- `worker.js`
- `dashboard-api.js`
- `dashboard.js`
- `dashboard.html`
- `dashboard.css`
- `public/dashboard-api.js`
- `public/dashboard.js`
- `public/dashboard.html`
- `public/dashboard.css`
- `public/sw.js`
- `tests_js/worker/analytics-branding.routes.test.mjs`
- `tests_js/worker.contract.test.mjs`

## Validacion

- se agregan pruebas nuevas de rutas en `tests_js/worker/analytics-branding.routes.test.mjs`
- `test:worker:raw` incluye explicitamente el nuevo archivo de tests
- la nota no asume estado de ejecucion de CI para este commit
