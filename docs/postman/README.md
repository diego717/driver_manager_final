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
3. `api_token`: token used by your Worker auth (if enabled).
4. `api_secret`: HMAC secret used by Worker auth (if enabled).
5. `photo_file_path`: local image file path for upload.

## Run Order
1. `Create Incident`
2. `Upload Incident Photo`
3. `List Incidents by Installation`

`Create Incident` test script stores `incident_id` automatically in environment.

## Auth Notes
- If `api_secret` is empty, the collection sends `dev-signature` for development mode.
- If `api_secret` is set, signature is auto-generated in pre-request script using:
  `METHOD|PATH|TIMESTAMP|SHA256(raw_body)`.
- Limitation: Postman cannot hash local file bytes in `body: file` mode from scripts.
  For strict auth on photo upload, use your app/client code or `curl` with a precomputed signature.
