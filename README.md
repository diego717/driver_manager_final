# Driver Manager

[![Tests](https://github.com/diego717/driver_manager_final/actions/workflows/tests.yml/badge.svg)](https://github.com/diego717/driver_manager_final/actions/workflows/tests.yml)

Driver Manager es un monorepo con tres componentes:

- App de escritorio en Python/PyQt6 para gestion de drivers y historial.
- API en Cloudflare Workers (D1 + R2) para instalaciones e incidencias.
- App movil en Expo/React Native para reportar incidencias y subir fotos.

## Arquitectura

- `main.py`: entrada de la app desktop.
- `worker.js`: API HTTP para instalaciones, estadisticas e incidencias.
- `mobile-app/`: cliente movil (Expo Router).
- `migrations/0002_incidents_v1.sql`: migracion de incidencias y fotos.
- `docs/incidents-v1.openapi.yaml`: contrato OpenAPI.
- `docs/postman/`: coleccion y entorno de Postman.

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
  "api_url": "https://tu-worker.workers.dev",
  "api_token": "TOKEN_OPCIONAL_PARA_AUTH",
  "api_secret": "SECRET_OPCIONAL_PARA_FIRMAS_HMAC"
}
```

Notas:

- `history_api_url` tambien es aceptado como fallback para `api_url`.
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

### Configuracion Cloudflare

`wrangler.toml` ya define:

- D1 binding: `DB`
- R2 binding para fotos de incidencias: `INCIDENTS_BUCKET`
- KV binding para rate limit de login web: `RATE_LIMIT_KV`

Si aun no tienes el KV namespace creado:

```powershell
wrangler kv namespace create RATE_LIMIT_KV
wrangler kv namespace create RATE_LIMIT_KV --preview
```

Luego reemplaza en `wrangler.toml`:

- `REPLACE_WITH_RATE_LIMIT_KV_ID`
- `REPLACE_WITH_RATE_LIMIT_KV_PREVIEW_ID`

Para auth firmada, configura secretos del Worker:

```powershell
wrangler secret put API_TOKEN
wrangler secret put API_SECRET
```

Si `API_TOKEN`/`API_SECRET` no existen, el Worker responde `503` y rechaza requests protegidas.

Para habilitar acceso web sin exponer `API_SECRET` en frontend:

```powershell
wrangler secret put WEB_SESSION_SECRET
wrangler secret put WEB_LOGIN_PASSWORD
Get-Content .\firebase-service-account.json -Raw | npx wrangler secret put FCM_SERVICE_ACCOUNT_JSON
```

Con eso:
- `WEB_SESSION_SECRET` firma y valida el Bearer web.
- `WEB_LOGIN_PASSWORD` se usa para bootstrap inicial de usuarios web.
- `FCM_SERVICE_ACCOUNT_JSON` habilita envio de push FCM HTTP v1 desde el Worker.

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

## Mobile app (Expo)

```powershell
cd mobile-app
npm ci
Copy-Item .env.example .env
npm start
```

Variables en `mobile-app/.env`:

- `EXPO_PUBLIC_API_BASE_URL`
- `EXPO_PUBLIC_API_TOKEN`
- `EXPO_PUBLIC_API_SECRET`

## Sincronizar auth Mobile -> Desktop

Script util para copiar token/secret del `.env` movil al `config/config.enc` desktop:

```powershell
python sync_desktop_api_auth.py
```

Lee `mobile-app/.env`, pide password maestra del desktop y actualiza:

- `api_token`
- `api_secret`
- `api_url` (si `EXPO_PUBLIC_API_BASE_URL` esta presente)

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

- Firma HMAC: `METHOD|PATH|TIMESTAMP|SHA256(body)`.
- Ventana anti-replay: 300 segundos.
- Web token: `Authorization: Bearer <token>` emitido por `/web/auth/login` (TTL 8 horas).
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
python sync_r2_users_to_web_d1.py
```

El script:
- Descifra `config/config.enc` con tu password maestra desktop.
- Descarga `system/users.json` desde R2.
- Hace login web con un admin existente.
- Importa usuarios hacia D1 (`/web/auth/import-users`) preservando hashes.

## Testing

### Python (desktop)

```powershell
python -m unittest discover -s tests -v
```

### Worker contract tests

```powershell
node --test tests_js/*.test.mjs
```

### Mobile tests

```powershell
cd mobile-app
npm test
```

CI (`.github/workflows/tests.yml`) ejecuta estas tres suites.

## Documentacion API

- OpenAPI: `docs/incidents-v1.openapi.yaml`
- Postman quick start: `docs/postman/README.md`
- Coleccion: `docs/postman/incidents-v1.postman_collection.json`
- Environment template: `docs/postman/incidents-v1.postman_environment.json`

## Seguridad

- Config desktop cifrada en `config/config.enc` con cifrado simetrico + validacion HMAC.
- No commitear secretos ni archivos locales (`.env`, `portable_config.json`, `config/`, `*.enc`).
- Usa claves de Cloudflare con permisos minimos y rotacion periodica.

## Licencia

MIT.
