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

### Deploy

```powershell
npm run deploy
```

### Configuracion Cloudflare

`wrangler.toml` ya define:

- D1 binding: `DB`
- R2 binding para fotos de incidencias: `INCIDENTS_BUCKET`

Para auth firmada, configura secretos del Worker:

```powershell
wrangler secret put API_TOKEN
wrangler secret put API_SECRET
```

Si `API_TOKEN`/`API_SECRET` no existen, el Worker entra en modo desarrollo y no exige auth.

### Migraciones D1

```powershell
npm run d1:migrate
```

La migracion incluida (`0002_incidents_v1.sql`) crea tablas de incidencias/fotos.  
Si partes desde cero, debes tener tambien la tabla `installations` base requerida por `worker.js`.

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

- `GET /installations`
- `POST /installations`
- `POST /records` (alta manual)
- `PUT /installations/:id`
- `DELETE /installations/:id`
- `GET /statistics`
- `GET /installations/:installationId/incidents`
- `POST /installations/:installationId/incidents`
- `POST /incidents/:incidentId/photos`

Notas API:

- Firma HMAC: `METHOD|PATH|TIMESTAMP|SHA256(body)`.
- Ventana anti-replay: 300 segundos.
- Fotos permitidas: `image/jpeg`, `image/png`, `image/webp`.
- Limite por foto: 8 MB.

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
