# SiteOps

Monorepo operativo para gestionar instalaciones, incidencias, conformidades y seguimiento de campo en tres superficies:

- Desktop en Python/PyQt6 para operacion interna, drivers e historial.
- Backend/API en Cloudflare Workers con D1, R2, KV y Durable Objects.
- App movil en Expo/React Native para trabajo en terreno.

Actualizado segun el estado del repositorio al 2026-03-26.

## Estado actual

El proyecto ya no es solo un gestor de drivers. Hoy concentra un flujo operativo mas amplio:

- Dashboard web con autenticacion web, metricas, auditoria, incidentes, assets, scanning, realtime y PWA.
- API multi-tenant con rutas para instalaciones, incidencias, estadisticas, dispositivos, auditoria, conformidades y tracking publico.
- Almacenamiento mixto:
  - D1 para datos operativos y sesiones.
  - R2 para fotos/evidencia y archivos asociados.
  - KV para rate limiting, sesiones web y tracking publico.
  - Durable Object para broker de eventos realtime.
- App movil con login web, captura de incidencias, fotos, QR, sync local, biometria y utilidades de geolocalizacion.
- Cliente desktop que sigue cubriendo flujos legacy y web segun configuracion.

## Componentes

### 1. Desktop (`Python + PyQt6`)

Entrada principal: `main.py`

Capacidades relevantes:

- Gestion de drivers y archivos.
- Historial de instalaciones/incidencias desde la API.
- Soporte de autenticacion `legacy`, `web` y `auto`.
- Build de ejecutable con `build.py`.

### 2. Worker + dashboard web (`Cloudflare`)

Entradas principales:

- `worker.js`
- `dashboard.html`
- `dashboard.js`
- `dashboard.css`

Capacidades visibles en el codigo actual:

- Auth web: bootstrap, login, logout, sesion actual y administracion de usuarios web.
- Instalaciones y records operativos.
- Incidencias con evidencia, estados, fotos y metricas.
- Conformidades de instalacion con generacion de PDF y almacenamiento asociado.
- Assets y prestamos.
- Estadisticas y tendencias.
- Tracking publico con tokens/enlaces dedicados.
- Geolocalizacion y soporte de geofencing en librerias/migraciones recientes.
- SSE/realtime mediante `RealtimeEventsBroker`.
- Dashboard/PWA publicado desde `public/`.

### 3. Mobile app (`Expo + React Native`)

Raiz: `mobile-app/`

Capacidades visibles en el codigo actual:

- Expo Router con pantallas para trabajo, drivers, incidencias, casos y QR.
- APIs tipadas para auth, incidents, devices, assets, conformities, statistics y tracking publico.
- SQLite/WatermelonDB como base local.
- Servicios de sync, cola de salida para incidencias y manejo de fotos.
- Biometria (`expo-local-authentication`) y notificaciones (`expo-notifications`).
- Soporte de geolocalizacion (`expo-location`).

## Arquitectura rapida

```text
Desktop (PyQt6) ----\
                     \
Mobile (Expo) --------> Cloudflare Worker -> D1
                     /                    -> R2
Dashboard web -------/                    -> KV
                                          -> Durable Object (realtime)
```

## Requisitos

- Python 3.12+
- Node.js 22+
- npm
- Cuenta/proyecto Cloudflare con D1, R2, KV y Durable Objects
- PowerShell para los scripts documentados aqui

## Puesta en marcha

### Desktop

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
python main.py
```

Build local:

```powershell
python build.py
```

### Worker y dashboard

```powershell
npm ci
npm run dev
```

Notas:

- `npm run dev` sincroniza antes los assets del dashboard hacia `public/`.
- `npm run dev:remote` usa la base remota de D1 en vez de la local.

Deploy:

```powershell
npm run deploy
```

Deploy completo:

```powershell
npm run deploy:full
```

### Mobile

```powershell
Set-Location mobile-app
npm ci
Copy-Item .env.example .env
npm start
```

Comandos utiles:

```powershell
npm run start:lan
npm run start:tunnel
npm run android
npm run ios
npm run build:android:apk
npm run build:android:aab
```

## Configuracion Cloudflare

Bindings definidos hoy en `wrangler.toml`:

- D1: `DB`
- R2: `INCIDENTS_BUCKET`, `DRIVERS_BUCKET`
- KV: `RATE_LIMIT_KV`, `WEB_SESSION_KV`, `PUBLIC_TRACKING_KV`
- Durable Object: `REALTIME_EVENTS`
- Static assets binding: `ASSETS`

Migraciones D1:

```powershell
npm run d1:migrate
npm run d1:migrate:remote
```

## Rollout GPS y geofence

Estado del repo al 2026-03-26:

- GPS tagging: implementado en dashboard, Worker, D1 y PDF de conformidad
- geofence soft: implementado
- geofence hard con override auditado: implementado a nivel tecnico, pendiente de activacion operativa segun tenant/flujo

Checklist minimo antes de activar en un entorno real:

1. Aplicar migraciones D1:
   - `0017_geolocation_capture.sql`
   - `0018_geofencing_soft.sql`
   - `0019_geofence_hard_overrides.sql`
2. Confirmar que el dashboard publicado tenga assets sincronizados:
   - `npm run dashboard:sync-assets`
3. Cargar coordenadas de referencia en instalaciones donde aplique:
   - `site_lat`
   - `site_lng`
   - `site_radius_m`
4. Definir politica por tenant:
   - solo observacion
   - hard geofence con override obligatorio
5. Ejecutar smoke manual en navegador real antes de endurecer politica.

Variables de entorno relevantes para hard geofence:

- `GEOFENCE_HARD_ENABLED`
- `GEOFENCE_HARD_FLOWS`
- `GEOFENCE_HARD_TENANTS`

Ejemplo operativo:

```powershell
$env:GEOFENCE_HARD_ENABLED="true"
$env:GEOFENCE_HARD_FLOWS="incidents,conformity"
$env:GEOFENCE_HARD_TENANTS="tenant-a,tenant-b"
```

Smoke checks recomendados:

- registro manual con GPS capturado
- incidencia con GPS capturado
- incidencia fuera de radio con override auditado
- conformidad con GPS capturado
- conformidad sin GPS usable con override GPS
- conformidad fuera de radio con override geofence
- PDF final mostrando GPS/geofence
- permiso denegado y timeout sin romper el flujo

Referencia detallada:

- `docs/gps-tagging-geofencing-implementation-plan.md`

## Rollout Public Tracking

Estado del repo al 2026-03-27:

- Magic Link publico: implementado
- lectura publica via KV: implementada
- cliente publico: implementado
- SSE publico: implementado
- rate limiting especifico para `/track/*`: implementado

Checklist minimo antes de activar en un entorno real:

1. Confirmar bindings y secrets:
   - `PUBLIC_TRACKING_KV`
   - `PUBLIC_TRACKING_SECRET`
   - `PUBLIC_TRACKING_BASE_URL`
2. Confirmar que `PUBLIC_TRACKING_BASE_URL` use HTTPS y apunte al host canonico publico.
3. Confirmar que `RATE_LIMIT_KV` exista para proteger rutas anonimas `/track/*`.
4. Sincronizar assets publicados:
   - `npm run dashboard:sync-assets`
5. Ejecutar smoke manual:
   - crear enlace
   - abrir `/track/:token`
   - validar `/track/:token/state`
   - validar actualizacion por SSE
   - revocar enlace y confirmar `410`
   - abrir muchas veces `/track/:token/events` y confirmar `429` cuando corresponda

Variables de entorno relevantes:

- `PUBLIC_TRACKING_SECRET`
- `PUBLIC_TRACKING_BASE_URL`

Referencia detallada:

- `docs/public-tracking-magic-link-implementation-plan.md`

## Autenticacion

El repositorio mantiene dos modelos:

- `web`: modelo recomendado para clientes distribuidos.
- `legacy`: solo para compatibilidad controlada.
- `auto`: transicion para desktop.

Variable principal del desktop:

```powershell
$env:DRIVER_MANAGER_DESKTOP_AUTH_MODE="web"
```

Referencia operativa: `docs/auth-modes.md`

## Tests

### Raiz del repo

```powershell
python scripts/run_python_tests.py
npm run test:web
npm run test:dashboard
npm run test:worker
```

Cobertura actual por tipo:

- `tests/`: suite Python para desktop/core/managers/handlers.
- `tests_js/`: dashboard, contract tests y rutas/servicios del Worker.
- `mobile-app/tests/` y `mobile-app/src/**/*.test.*`: UI, servicios y utilidades de mobile.

### Mobile

```powershell
Set-Location mobile-app
npm test
npm exec tsc -- --noEmit
```

## Estructura del repo

```text
.
|- core/                  # seguridad, config y logging desktop
|- managers/              # servicios de dominio desktop
|- handlers/              # handlers de UI/reportes desktop
|- ui/                    # ventanas/dialogos PyQt6
|- worker/                # rutas, auth, libs y servicios del backend
|- migrations/            # migraciones D1
|- public/                # build publico del dashboard/PWA
|- tests/                 # tests Python
|- tests_js/              # tests Node del dashboard y Worker
|- mobile-app/            # aplicacion Expo
|- docs/                  # docs operativas, planes y contratos
|- worker.js              # entrada principal del Worker
|- dashboard.*            # fuentes del dashboard web
`- main.py                # entrada principal desktop
```

## Documentacion util

- `docs/auth-modes.md`
- `docs/secure-deploy.md`
- `docs/release-checklist.md`
- `docs/operational-recovery.md`
- `docs/incidents-v1.openapi.yaml`
- `docs/postman/README.md`
- `docs/multi-tenant-rollout.md`
- `docs/tenant-request-flow.md`
- `docs/public-tracking-magic-link-implementation-plan.md`
- `docs/gps-tagging-geofencing-implementation-plan.md`

## Notas operativas

- Si cambias `dashboard*.js/html/css`, ejecuta `npm run dashboard:sync-assets`.
- `npm run deploy` valida configuracion de seguridad antes de publicar.
- No distribuyas mobile con secretos HMAC legacy en cliente.
- Hay trabajo activo en geolocalizacion, geofencing, public tracking y conformidades; revisar migraciones recientes y tests asociados antes de tocar contrato.
