# Driver Manager

[![Tests](https://github.com/diego717/driver_manager_final/actions/workflows/tests.yml/badge.svg)](https://github.com/diego717/driver_manager_final/actions/workflows/tests.yml)

Driver Manager es un monorepo con tres componentes:

- App de escritorio en Python/PyQt6 para gestion de drivers y historial.
- API en Cloudflare Workers (D1 + R2) para instalaciones e incidencias.
- App movil en Expo/React Native para reportar incidencias y subir fotos.

## Quick Start

### Desktop (Python)

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
python main.py
```

Detalles: ver [Desktop (Python)](#desktop-python).

### Worker (Cloudflare)

```powershell
npm ci
npm run dev
```

Deploy:

```powershell
npm run deploy
```

Detalles: ver [Worker (Cloudflare)](#worker-cloudflare).

### Mobile (Expo)

```powershell
cd mobile-app
npm ci
Copy-Item .env.example .env
npm start
```

APK (EAS):

```powershell
npx eas-cli login
npm run build:android:apk
```

Detalles: ver [Mobile app (Expo)](#mobile-app-expo) y [APK Android con EAS (recomendado)](#apk-android-con-eas-recomendado).

## Novedades recientes

- Desktop:
  - `UserManagerV2` ahora usa cache TTL corta para lectura de usuarios en nube y refresca cache al guardar.
  - Logging legacy de accesos con persistencia mas robusta (escritura atomica local y reintentos con merge para reducir perdida por concurrencia).
  - Eliminada la ruta de migracion legacy en `MainWindow` durante inicializacion de usuario.
- Mobile:
  - Pantallas principales alineadas con `ThemePreferenceProvider` para modo claro/oscuro real (incluye `+not-found` y pantallas de incidencias/fotos).
  - Flujo de "crear registro manual" en `Crear incidencia` ahora es opcional/colapsable para separar mejor los flujos.
  - Limpieza de estilos: colores de estado y botones movidos a paletas dinamicas en pantalla.

## Arquitectura

- `main.py`: entrada de la app desktop.
- `worker.js`: API HTTP para instalaciones, estadisticas e incidencias.
- `mobile-app/`: cliente movil (Expo Router).
- `mobile-app/app.config.js`: config dinamica Expo/EAS (Firebase file vars para builds remotos).
- `migrations/0002_incidents_v1.sql`: migracion de incidencias y fotos.
- `docs/incidents-v1.openapi.yaml`: contrato OpenAPI.
- `docs/postman/`: coleccion y entorno de Postman.
- `docs/multi-tenant-rollout.md`: plan de rollout multiempresa (tenant, roles, R2 y limites).
- `docs/operational-differentiation-implementation.md`: plan de implementacion para workflow+SLA, offline Android, tablero web y push critico.

## Requisitos

- Python 3.12+ (recomendado para alinear con CI).
- Node.js 22+ y npm.
- Cuenta Cloudflare con D1 y R2.
- `wrangler` (incluido como devDependency en el proyecto raiz).

## Estructura del repo

```text
.
|- core/               # seguridad, config, logging
|- managers/           # cloud, historial, instalacion, usuarios
|- handlers/           # eventos y reportes UI
|- reports/            # generacion de Excel
|- tests/              # unit tests Python
|- worker.js           # Cloudflare Worker API
|- migrations/         # migraciones D1
|- tests_js/           # contract tests del Worker
|- mobile-app/         # app Expo
`- docs/               # OpenAPI + Postman
```

## Desktop (Python)

### Ejecutar en desarrollo (PowerShell)

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
python main.py
```

### Modo portable

En la raiz del proyecto (o junto al `.exe`) crea `portable_config.json` con, como minimo:

```json
{
  "account_id": "TU_ACCOUNT_ID",
  "access_key_id": "TU_R2_ACCESS_KEY_ID",
  "secret_access_key": "TU_R2_SECRET_ACCESS_KEY",
  "bucket_name": "TU_BUCKET_DE_DRIVERS",
  "desktop_auth_mode": "auto",
  "api_url": "https://tu-worker.workers.dev",
  "api_tenant_id": "TENANT_LEGACY_PERMITIDO",
  "api_token": "TOKEN_OPCIONAL_SOLO_PARA_LEGACY_PRIVADO",
  "api_secret": "SECRET_OPCIONAL_SOLO_PARA_FIRMAS_HMAC_LEGACY"
}
```

### Auth mode desktop (feature flag)

El cliente desktop soporta un feature flag para autenticación:

- `DRIVER_MANAGER_DESKTOP_AUTH_MODE=legacy` (default): login contra `users.json` y rutas legacy firmadas. Úsalo solo para integraciones privadas/heredadas.
- `DRIVER_MANAGER_DESKTOP_AUTH_MODE=web`: login por `username/password` contra `/web/auth/login` y consumo exclusivo de `/web/*` con Bearer.
- `DRIVER_MANAGER_DESKTOP_AUTH_MODE=auto`: usa `/web/*` cuando hay sesión web activa; si no, cae a legacy firmado solo si configuraste `api_token`/`api_secret`.

Con `web` (o `auto` con sesión web activa), el desktop usa Bearer `/web/*` para:
- gestión de drivers (`/web/drivers`)
- historial/estadísticas (`/web/installations`, `/web/statistics`)
- incidencias/fotos (`/web/installations/:id/incidents`, `/web/incidents/:id/photos`)

Ejemplo (PowerShell):

```powershell
$env:DRIVER_MANAGER_DESKTOP_AUTH_MODE="web"
python main.py
```

Notas:

- `history_api_url` tambien es aceptado como fallback para `api_url`.
- Mobile distribuida usa solo `/web/*` + sesión corta; no requiere `API_TOKEN` ni `API_SECRET`.
- En el primer inicio, la app inyecta esta config en `config/config.enc` y elimina `portable_config.json`.
- `config/`, `*.enc` y `portable_config.json` ya estan ignorados en `.gitignore`.

### Compilar ejecutable

```powershell
python build.py
```

El ejecutable queda en `dist/`.

## Worker (Cloudflare)

### Instalar y correr local

```powershell
npm ci
npm run dev
```

`npm run dev` usa la base D1 local (`.wrangler/state/...`).  
Si quieres ver en `localhost` los mismos datos que Android (D1 remota), usa:

```powershell
npm run dev:remote
```

### Deploy

```powershell
npm run deploy
```

`npm run deploy` ahora ejecuta una verificacion de seguridad previa (`security:verify-deploy`) que:
- valida bindings KV criticos (`RATE_LIMIT_KV` y `WEB_SESSION_KV`) en `wrangler.toml`
- valida que exista `WEB_SESSION_SECRET` en el Worker remoto
- valida que exista `DRIVER_MANAGER_API_TENANT_ID` si detecta credenciales legacy HMAC
- bloquea deploy si detecta `ALLOW_INSECURE_WEB_AUTH_FALLBACK` en remoto

Comandos utiles:

```powershell
npm run tail                 # logs en vivo del Worker
npm run test:web             # tests del dashboard + contract tests Worker
npm run users:tenant         # script de gestion de usuarios por tenant (CLI Python)
```

### Configuracion Cloudflare

`wrangler.toml` ya define:

- D1 binding: `DB`
- R2 binding para fotos de incidencias: `INCIDENTS_BUCKET`
- KV binding para rate limit de login web: `RATE_LIMIT_KV`
- KV binding para versionado/revocacion de sesion web: `WEB_SESSION_KV`

Si aun no tienes el KV namespace creado:

```powershell
wrangler kv namespace create RATE_LIMIT_KV
wrangler kv namespace create RATE_LIMIT_KV --preview
wrangler kv namespace create WEB_SESSION_KV
wrangler kv namespace create WEB_SESSION_KV --preview
```

Luego reemplaza en `wrangler.toml`:

- `REPLACE_WITH_RATE_LIMIT_KV_ID`
- `REPLACE_WITH_RATE_LIMIT_KV_PREVIEW_ID`
- `REPLACE_WITH_WEB_SESSION_KV_ID`
- `REPLACE_WITH_WEB_SESSION_KV_PREVIEW_ID`

Solo para compatibilidad con clientes legacy firmados o integraciones privadas puedes configurar:

```powershell
wrangler secret put API_TOKEN
wrangler secret put API_SECRET
wrangler secret put DRIVER_MANAGER_API_TENANT_ID
```

> Recomendado para produccion mobile: no embebas `API_SECRET` ni `API_TOKEN` en apps distribuidas. Usa solo `/web/*` + Bearer de sesion corta.
> Seguridad legacy: `DRIVER_MANAGER_API_TENANT_ID` fija el unico tenant permitido para rutas HMAC no-web. Si necesitas multi-tenant real, usa `/web/*` con sesion por usuario en lugar de secretos globales.

Por seguridad, CORS para `localhost/127.0.0.1` ahora queda deshabilitado por defecto.
Si necesitas habilitarlo en desarrollo local, define explicitamente:

```powershell
wrangler secret put ALLOW_LOCALHOST_CORS
```

Valor sugerido solo en local: `true`.  
Compatibilidad legacy: `ALLOW_LOCALHOST_ORIGINS=true` tambien habilita localhost.

Para habilitar acceso web por sesion de usuario:

```powershell
wrangler secret put WEB_SESSION_SECRET
wrangler secret put WEB_LOGIN_PASSWORD
Get-Content .\firebase-service-account.json -Raw | npx wrangler secret put FCM_SERVICE_ACCOUNT_JSON
```

Con eso:
- `WEB_SESSION_SECRET` firma y valida la sesion web (cookie HttpOnly).
- `WEB_LOGIN_PASSWORD` se usa para bootstrap inicial de usuarios web.
- `FCM_SERVICE_ACCOUNT_JSON` habilita envio de push FCM HTTP v1 desde el Worker.

Politica de sesion web recomendada:
- Expo web no comparte autenticacion entre tabs como requisito del producto.
- El bearer de sesion web en clientes Expo se guarda en `sessionStorage`, no en `localStorage`.
- `localStorage` solo se lee para migrar sesiones legacy existentes y se limpia en cuanto se detectan.
- Logout, expirada de token y cambios de version/revocacion se validan contra `WEB_SESSION_KV` como fuente de verdad.

Importante para produccion:
- No habilites `ALLOW_INSECURE_WEB_AUTH_FALLBACK`.
- Si existe por pruebas locales, eliminalo antes de deploy:

```powershell
wrangler secret delete ALLOW_INSECURE_WEB_AUTH_FALLBACK
```

### Migraciones D1

```powershell
npm run d1:migrate
```

Para aplicar migraciones sobre la D1 remota:

```powershell
npm run d1:migrate:remote
```

Las migraciones incluidas crean:

- `0001_installations_base.sql`: tabla `installations` base.
- `0002_incidents_v1.sql`: tablas de incidencias y fotos.
- `0003_web_users_auth.sql`: tabla `web_users` para login web por usuario.
- `0004_web_users_hash_types.sql`: soporte de hash tipo `pbkdf2/bcrypt/legacy`.
- `0005_audit_logs.sql`: tabla `audit_logs` para auditoria centralizada en D1.
- `0006_device_tokens.sql`: tabla `device_tokens` para registro de dispositivos y push.
- `0007_multi_tenant_foundation.sql`: base multi-tenant (tenants, roles por tenant, auditoria tenant y limites de plan).
- `0008_assets_registry.sql`: registro de equipos (assets), asociaciones e historial.
- `0009_assets_brand_and_metadata.sql`: metadata extendida para equipos (marca/modelo/serie/cliente/notas).
- `0012_incidents_asset_link.sql`: enlace opcional `asset_id` en incidencias para flujo asset-first.
- `0013_incident_duration_fields.sql`: duracion estimada/real y marcas de inicio-fin por incidencia.

## Mobile app (Expo)

```powershell
cd mobile-app
npm ci
Copy-Item .env.example .env
npm start
```

Variables en `mobile-app/.env`:

- `EXPO_PUBLIC_API_BASE_URL`
- `EXPO_PUBLIC_ALLOW_HTTP_API_BASE_URL` (solo debug/local si necesitas URL HTTP)

No uses `EXPO_PUBLIC_API_TOKEN` ni `EXPO_PUBLIC_API_SECRET`: la autenticacion mobile en produccion usa exclusivamente login web (`/web/auth/login`) y Bearer de corta duracion con expiracion/revocacion server-side.

### APK Android con EAS (recomendado)

La app usa `app.config.js` para resolver archivos Firebase de forma dinamica:

- Android: variable de entorno `GOOGLE_SERVICES_JSON` (tipo `file` en EAS).
- iOS (opcional): `GOOGLE_SERVICE_INFO_PLIST` (tipo `file` en EAS).

Si no existe variable de archivo en EAS, se usa fallback local (`./google-services.json`) solo para desarrollo local.

#### 1) Login EAS

```powershell
cd mobile-app
npx eas-cli login
```

#### 2) Cargar archivo Firebase en EAS (no subir a git)

```powershell
npx eas-cli env:create --environment preview --name GOOGLE_SERVICES_JSON --type file --visibility secret
```

Opcional para produccion:

```powershell
npx eas-cli env:create --environment production --name GOOGLE_SERVICES_JSON --type file --visibility secret
```

Ver variables configuradas:

```powershell
npx eas-cli env:list --environment preview
```

#### 3) Generar APK

```powershell
npm run build:android:apk
```

Notas:

- El build profile `preview` genera `.apk` (`eas.json`).
- `cli.appVersionSource` esta configurado en `remote` para evitar warnings futuros de EAS.
- Si cambias assets/config y no se refleja en Expo Go, reinicia con cache limpia:

```powershell
npm run start -- --clear
```

## Endpoints principales del Worker

- `GET /health`
- `GET /installations`
- `GET /installations/:id`
- `POST /installations`
- `POST /records` (alta manual)
- `PUT /installations/:id`
- `DELETE /installations/:id`
- `GET /statistics`
- `GET /audit-logs`
- `POST /audit-logs`
- `GET /installations/:installationId/incidents`
- `POST /installations/:installationId/incidents`
- `POST /incidents/:incidentId/photos`
- `GET /photos/:photoId`

Endpoints web (sin HMAC en cliente):

- `POST /web/auth/login`
- `POST /web/auth/bootstrap` (crear primer usuario web)
- `GET /web/auth/users` (listar usuarios, requiere admin)
- `POST /web/auth/users` (crear usuarios adicionales, requiere admin)
- `PATCH /web/auth/users/:user_id` (activar/desactivar o cambiar rol, requiere admin)
- `POST /web/auth/users/:user_id/force-password` (forzar nueva contraseña, requiere admin)
- `POST /web/auth/import-users` (importar hashes de usuarios legacy, requiere admin)
- `GET /web/auth/me`
- `POST /web/auth/logout` (revoca version de sesion)
- `GET /web/installations`
- `POST /web/installations`
- `POST /web/records`
- `PUT /web/installations/:id`
- `DELETE /web/installations/:id`
- `GET /web/statistics`
- `GET /web/audit-logs`
- `POST /web/audit-logs`
- `POST /web/devices`
- `GET /web/installations/:installationId/incidents`
- `POST /web/installations/:installationId/incidents`
- `POST /web/incidents/:incidentId/photos`
- `GET /web/photos/:photoId`

Notas API:

- Firma HMAC: `METHOD|PATH|TIMESTAMP|SHA256(body)|NONCE` (solo para clientes legacy/no-publicos).
- Headers HMAC requeridos: `X-API-Token`, `X-Request-Timestamp`, `X-Request-Nonce`, `X-Request-Signature`.
- En upload binario (`POST /incidents/:incidentId/photos`) tambien se requiere `X-Body-SHA256`.
- Ventana anti-replay: 300 segundos.
- Requests mobile distribuidos con header `X-Client-Platform: mobile` no pueden usar HMAC en rutas legacy.
- Web token: `Authorization: Bearer <token>` emitido por `/web/auth/login` (TTL 8 horas), renovable con nuevo login/refresh y revocable server-side por version de sesion.
- Login web: `username + password` contra `web_users` (bootstrap inicial con `/web/auth/bootstrap`).
- Password policy web: minimo 12 caracteres, mayuscula, minuscula, numero y caracter especial.
- Login web rate limit: maximo 5 intentos fallidos por `IP+username` en 15 minutos (requiere `RATE_LIMIT_KV`).
- Import de usuarios legacy: `/web/auth/import-users` acepta hashes `bcrypt`, `pbkdf2_sha256` y `legacy_pbkdf2_hex`.
- Migracion automatica: usuarios con hash `bcrypt` se re-hashean a `pbkdf2_sha256` en login exitoso.
- Registro de push: `/web/devices` vincula `fcm_token` al usuario web autenticado.
- Push por incidencia critica: en `severity=critical` se notifica a `admin/super_admin` activos (si `FCM_SERVICE_ACCOUNT_JSON` esta configurado).
- Fotos permitidas: `image/jpeg`, `image/png`, `image/webp`.
- Validacion de imagen: `Content-Type` + magic bytes (JPEG/PNG/WEBP).
- Limite por foto: 5 MB (post-compresion recomendada en cliente movil).

Migracion desktop (seguridad):
- En modo `legacy`, el cliente desktop falla en cerrado si faltan credenciales firmadas (`DRIVER_MANAGER_API_TOKEN`/`DRIVER_MANAGER_API_SECRET` o `config.enc`).
- En modo `web`, el cliente desktop requiere una sesión web activa y no usa secretos HMAC globales.
- En modo `auto`, el cliente desktop usa sesión web cuando existe y solo cae a HMAC si configuraste credenciales legacy explícitas.
- Solo para debug local puedes permitir requests sin firma con `DRIVER_MANAGER_ALLOW_UNSIGNED_REQUESTS=true` (no usar en produccion).

Ejemplo rapido de flujo web:

```powershell
# 1) Bootstrap inicial (solo una vez, si no hay usuarios web)
curl -X POST "$BASE_URL/web/auth/bootstrap" `
  -H "Content-Type: application/json" `
  -d "{\"bootstrap_password\":\"TU_WEB_LOGIN_PASSWORD\",\"username\":\"admin_root\",\"password\":\"TuPass#Segura2026\"}"

# 2) Login web por usuario
curl -X POST "$BASE_URL/web/auth/login" `
  -H "Content-Type: application/json" `
  -d "{\"username\":\"admin_root\",\"password\":\"TuPass#Segura2026\"}"

# 3) Usar token en endpoints /web/*
curl "$BASE_URL/web/installations" `
  -H "Authorization: Bearer TU_ACCESS_TOKEN"
```

### Migrar usuarios desktop (R2) a D1 web_users

Script incluido:

```powershell
python sync_r2_users_to_web_d1.py --api-base-url https://tu-worker.example.workers.dev
```

El script:
- Descifra `config/config.enc` con tu password maestra desktop.
- Descarga `system/users.json` desde R2.
- Hace login web con un admin existente.
- Importa usuarios hacia D1 (`/web/auth/import-users`) preservando hashes.
- Usa `--api-base-url` o `DRIVER_MANAGER_HISTORY_API_URL`; ya no lee `mobile-app/.env`.

## Testing

### Python (desktop)

```powershell
python scripts/run_python_tests.py
```

Raiz oficial Python: `tests/`. No uses `python -m unittest` sin `start_dir`, porque vuelve a mezclar discovery fuera de la suite soportada.

### Web + dashboard + Worker

```powershell
npm run test:web
```

Ese comando:
- sincroniza assets del dashboard a `public/`
- ejecuta tests del dashboard contra `public/` como fuente de verdad
- ejecuta contract tests del Worker

Si quieres correrlos por separado:

```powershell
npm run test:dashboard
npm run test:worker
```

### Mobile tests

```powershell
cd mobile-app
npm test
```

CI (`.github/workflows/tests.yml`) ejecuta los mismos comandos oficiales: `python scripts/run_python_tests.py`, `npm run test:web` y `npm test` en `mobile-app/`.

## Documentacion API

- OpenAPI: `docs/incidents-v1.openapi.yaml`
- Postman quick start: `docs/postman/README.md`
- Coleccion: `docs/postman/incidents-v1.postman_collection.json`
- Environment template: `docs/postman/incidents-v1.postman_environment.json`

## Seguridad

- Config desktop cifrada en `config/config.enc` con cifrado simetrico + validacion HMAC.
- No commitear secretos ni archivos locales (`.env`, `portable_config.json`, `config/`, `*.enc`).
- Usa claves de Cloudflare con permisos minimos y rotacion periodica.

## Troubleshooting

- Error `npm error could not determine executable to run` al hacer login EAS:
  - Usa `npx eas-cli login` (no `npx eas login`).
- Error EAS: `"google-services.json" is missing`:
  - Carga `GOOGLE_SERVICES_JSON` como variable de tipo `file` en EAS (`preview` y/o `production`).
  - Verifica con `npx eas-cli env:list --environment preview`.
- Expo Go no refleja cambios:
  - Reinicia Metro con cache limpia: `npm --prefix mobile-app run start -- --clear`.
- Dashboard web sigue mostrando comportamiento viejo:
  - Hard refresh (`Ctrl+F5`) y, si aplica, unregister del Service Worker.
  - Si cambias assets web, ejecuta `npm run dashboard:sync-assets` antes de `npm run deploy`.
- Error de sesion web invalida despues de habilitar edicion:
  - Asegurate de estar en una version desplegada reciente del dashboard/worker y recargar.
  - Cerrar sesion y volver a iniciar tambien fuerza refresh de token/sesion.

## Licencia

MIT.
