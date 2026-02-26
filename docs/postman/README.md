# Postman Quick Start (Incidents v1)

## Files
- `incidents-v1.postman_collection.json`
- `incidents-v1.postman_environment.json`

## Import
1. Open Postman.
2. `Import` -> select both JSON files.
3. Choose environment: `Driver Manager - Incidents v1 (Template)`.

## Set Variables
1. `base_url`: your Worker URL.
2. `installation_id`: an existing installation id in D1.
3. `access_token`: Bearer token obtenido de `/web/auth/login`.
4. `photo_file_path`: local image file path for upload.

Opcional legacy (solo clientes no-publicos): `api_token` + `api_secret` para HMAC.

## Run Order
1. `Create Incident`
2. `Upload Incident Photo`
3. `List Incidents by Installation`

`Create Incident` test script stores `incident_id` automatically in environment.

## Auth Notes
- Recomendado: usar `Authorization: Bearer <access_token>` contra rutas `/web/*`.
- El flujo mobile productivo no debe distribuir `api_secret` embebido en la app.
- HMAC (`api_token`/`api_secret`) queda solo para integraciones legacy/no-publicas.
