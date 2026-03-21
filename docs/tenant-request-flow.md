# Tenant request flow

Resumen operativo del flujo de tenant en SiteOps.

## Objetivo

Toda lectura o escritura debe resolverse contra un `tenant_id` explicito.

## Flujo web

1. Usuario inicia sesion en `/web/auth/login`.
2. El Worker resuelve usuario y sesion.
3. El contexto autenticado aporta `tenant_id`.
4. Las queries a D1 filtran por `tenant_id`.
5. Los objetos en R2 usan prefijo `tenants/{tenant_id}/...`.

## Flujo legacy HMAC

1. Cliente firma request no web.
2. El Worker valida HMAC.
3. El Worker compara `X-Tenant-Id` contra `DRIVER_MANAGER_API_TENANT_ID`.
4. Si no coincide, rechaza la request.

## Donde se aplica

- `installations`
- `incidents`
- `incident_photos`
- `web_users`
- `audit_logs`
- `device_tokens`
- assets y sus vinculos

## Reglas

- Nunca asumir tenant por hostname o por UI state.
- Nunca leer o escribir sin filtro de tenant.
- Nunca compartir paths R2 entre tenants.

## Señales de drift

- Un tenant ve datos de otro.
- El `tenant_id` del usuario autenticado no coincide con la fila mutada.
- Un `r2_key` no empieza con `tenants/{tenant_id}/`.

## Referencias

- Diseño completo: [multi-tenant-rollout.md](/g:/dev/driver_manager/docs/multi-tenant-rollout.md)
- Realtime por tenant: [realtime-durable-objects-websocket-plan.md](/g:/dev/driver_manager/docs/realtime-durable-objects-websocket-plan.md)
