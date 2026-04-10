# SiteOps

Monorepo operativo para gestionar instalaciones, incidencias, conformidades y seguimiento de campo en tres superficies:

- Desktop en Python/PyQt6 para operacion interna, drivers e historial.
- Backend/API en Cloudflare Workers con D1, R2, KV y Durable Objects.
- App movil en Expo/React Native para trabajo en terreno.

Actualizado segun el estado del repositorio al 2026-04-03.

## Estado actual

El proyecto ya no es solo un gestor de drivers. Hoy concentra un flujo operativo mas amplio:

- Dashboard web con autenticacion web, metricas, auditoria, incidentes, assets, scanning, realtime y PWA.
- API multi-tenant con rutas para instalaciones, incidencias, estadisticas, dispositivos, auditoria, conformidades y tracking publico.
- Flujo operativo de incidencias con destino operativo, asignacion de tecnicos, push y mapa web/mobile.
- Almacenamiento mixto:
  - D1 para datos operativos y sesiones.
  - R2 para fotos/evidencia y archivos asociados.
  - KV para rate limiting, sesiones web y tracking publico.
  - Durable Object para broker de eventos realtime.
- App movil con login web, captura de incidencias, fotos, QR, sync local/offline-first, biometria, notificaciones y utilidades de geolocalizacion.
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
- Destino operativo por incidencia con `target_*`, `dispatch_*` y toggle `dispatch_required`.
- Edicion de destino operativo desde cards y desde el mapa web.
- Asignaciones de tecnicos con push al tecnico vinculado y deep link al detalle mobile.
- Conformidades de instalacion con generacion de PDF y almacenamiento asociado.
- Assets y prestamos.
- Estadisticas y tendencias.
- Tracking publico con tokens/enlaces dedicados.
- Geolocalizacion activa y mapa operativo de incidencias.
- SSE/realtime mediante `RealtimeEventsBroker`.
- Dashboard/PWA publicado desde `public/`.

### 3. Mobile app (`Expo + React Native`)

Raiz: `mobile-app/`

Capacidades visibles en el codigo actual:

- Expo Router con pantallas para trabajo, drivers, incidencias, casos y QR.
- APIs tipadas para auth, incidents, devices, assets, conformities, statistics y tracking publico.
- SQLite/WatermelonDB como base local.
- Servicios de sync, cola de salida para incidencias, evidencia y manejo de fotos.
- Cola de trabajo offline, detalle offline y cache de asignaciones / mapa para continuidad sin red.
- Pestaña `Mapa` con incidencias asignadas, distancia y CTA de navegacion externa.
- Biometria (`expo-local-authentication`) y notificaciones (`expo-notifications`).
- Soporte de geolocalizacion (`expo-location`) y mapas (`react-native-maps`).

## Incidencias y despacho operativo

Estado del repo al 2026-04-03:

- destino operativo implementado en `incidents` con `target_*` y `dispatch_*`
- toggle `dispatch_required` para incidencias que no requieren visita en sitio
- `PATCH /web/incidents/:id/dispatch-target` implementado
- mapa web con edicion directa de `target_lat` y `target_lng`
- push por asignacion de incidencia a tecnico vinculado
- mobile con detalle operativo, apertura desde push y pestaña `Mapa`
- fallback offline para `Trabajo`, `Mapa` y `Detalle incidencia`

Documentacion relacionada:

- `docs/mobile-incident-map-dispatch-design.md`
- `docs/mobile-incident-map-dispatch-checklist.md`
- `docs/mobile-offline-sync-qa-checklist.md`
- `docs/changes/2026-04-03-mobile-incident-dispatch-map-offline-rollout.md`

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

Migraciones utiles:

```powershell
npm run d1:migrate
npm run d1:migrate:remote
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

## Secretos y manejo local

El repo no debe conservar credenciales reales en archivos versionados ni en copias locales persistentes fuera de un flujo controlado.

Reglas operativas actuales:

- El Worker espera el service account de FCM en el secret remoto `FCM_SERVICE_ACCOUNT_JSON`.
- Si necesitas preparar el payload localmente, usa `firebase-service-account.example.json` solo como plantilla.
- No recrees `firebase-service-account.json` con credenciales reales dentro del repo.
- `.dev.vars`, `mobile-app/.env` y archivos equivalentes deben mantenerse locales.
- Si una credencial toca el workspace por error, rotala antes del siguiente deploy.

Checklist minimo de secretos antes de publicar:

1. Confirmar que existan en Cloudflare los secrets requeridos para el entorno:
   - `WEB_SESSION_SECRET`
   - `WEB_LOGIN_PASSWORD`
   - `PUBLIC_TRACKING_SECRET`
   - `FCM_SERVICE_ACCOUNT_JSON`
2. Confirmar que no existan credenciales reales en archivos locales del repo.
3. Ejecutar `npm run security:verify-deploy` antes de `npm run deploy`.

## Estado GPS

Estado del repo al 2026-04-03:

- GPS tagging: vigente en dashboard, Worker, mobile y PDF de conformidad
- geofence: retirado del flujo activo por decision de producto
- despacho operativo: vigente en dashboard, Worker y mobile

Notas operativas:

1. Mantener migraciones historicas ya aplicadas; no hace falta activar nada nuevo de geofence.
2. Los campos `site_lat`, `site_lng`, `site_radius_m` y columnas `geofence_*` pueden seguir existiendo por compatibilidad de datos.
3. Cualquier documentacion vieja que describa activacion de hard geofence debe considerarse historica.

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

## OCR de etiquetas (mobile/web)

Endpoint:

- `POST /web/scan/asset-label`

Mobile:

- OCR local on-device con `expo-text-extractor` (sin costo por request).
- Fallback remoto opcional con `EXPO_PUBLIC_ENABLE_REMOTE_OCR_FALLBACK=true`.
- Revision estricta opcional para baja confianza:
  - `EXPO_PUBLIC_OCR_STRICT_REVIEW=true`
  - `EXPO_PUBLIC_OCR_LOW_CONFIDENCE_THRESHOLD=0.72`

Variables de entorno relevantes del Worker:

- `OPENAI_API_KEY` (requerida)
- `OPENAI_OCR_MODEL` (opcional, default: `gpt-4.1-mini`)

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

Suites utiles para incidencias, despacho y mapa:

```powershell
node --test tests_js/worker.contract.test.mjs
node --test tests_js/dashboard.unit.test.mjs
node --test tests_js/worker/routes.test.mjs
Set-Location mobile-app
node .\node_modules\vitest\vitest.mjs run src\api\incidents.test.ts src\api\technicians.test.ts
node .\node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
```

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
- `docs/change-documentation-rule.md`
- `docs/changes/INDEX.md`
- `docs/secure-deploy.md`
- `docs/release-checklist.md`
- `docs/operational-recovery.md`
- `docs/incidents-v1.openapi.yaml`
- `docs/postman/README.md`
- `docs/multi-tenant-rollout.md`
- `docs/tenant-request-flow.md`
- `docs/public-tracking-magic-link-implementation-plan.md`
- `docs/gps-tagging-geofencing-implementation-plan.md`
- `docs/mobile-incident-map-dispatch-design.md`
- `docs/mobile-incident-map-dispatch-checklist.md`
- `docs/mobile-offline-sync-qa-checklist.md`

## Notas operativas

- Si cambias `dashboard*.js/html/css`, ejecuta `npm run dashboard:sync-assets`.
- `npm run deploy` valida configuracion de seguridad antes de publicar.
- No distribuyas mobile con secretos HMAC legacy en cliente.
- Antes de tocar `incidents`, revisar migraciones recientes `0017`, `0023` y `0024` y los tests asociados.
- Hay trabajo activo en geolocalizacion, despacho operativo, public tracking, offline mobile y conformidades; revisar docs y cambios recientes antes de tocar contrato.

## Regla de cambios

Para dejar mas claro el recorrido del proyecto, toda modificacion relevante debe dejar rastro en la carpeta de cambios.

- Todo cambio relevante debe registrarse en `docs/changes/`.
- El indice resumido vive en `docs/changes/INDEX.md`.
- La convencion de documentacion vive en `docs/change-documentation-rule.md`.

Esquema sugerido por nota:

- fecha
- resumen
- contexto
- areas tocadas
- cambios clave
- impacto
- referencias
- validacion o riesgos pendientes
