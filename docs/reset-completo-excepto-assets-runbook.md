# Reset Completo Excepto Assets

Este documento describe el mapa de borrado para dejar el entorno operativo en cero sin eliminar el catalogo de `assets`.

No es una orden de ejecucion automatica.
Primero sirve como referencia para decidir alcance, preparar backup y luego convertirlo en script o migracion controlada.

## Objetivo

Resetear:

- registros o casos (`installations`)
- incidencias (`incidents`)
- fotos de incidencia
- conformidades
- asignaciones tecnicas
- tecnicos
- prestamos de assets
- vinculos asset-caso
- auditoria operativa
- tokens push
- snapshots de uso

Conservar:

- `assets`
- usuarios web
- configuracion multi-tenant base

## Tablas Que Se Conservan

Estas no entran en el reset propuesto:

- `assets`
- `web_users`
- `tenants`
- `tenant_user_roles`
- `plan_limits`

Referencias:

- [0008_assets_registry.sql](/g:/dev/driver_manager/migrations/0008_assets_registry.sql)
- [0003_web_users_auth.sql](/g:/dev/driver_manager/migrations/0003_web_users_auth.sql)
- [0007_multi_tenant_foundation.sql](/g:/dev/driver_manager/migrations/0007_multi_tenant_foundation.sql)

## Tablas Que Se Vaciarian

Orden sugerido, de mayor dependencia a menor:

1. `incident_photos`
2. `installation_conformities`
3. `technician_assignments`
4. `asset_installation_links`
5. `asset_loans`
6. `incidents`
7. `installations`
8. `technicians`
9. `device_tokens`
10. `audit_logs`
11. `tenant_audit_events`
12. `tenant_usage_snapshots`

Referencias:

- [0002_incidents_v1.sql](/g:/dev/driver_manager/migrations/0002_incidents_v1.sql)
- [0016_installation_conformities.sql](/g:/dev/driver_manager/migrations/0016_installation_conformities.sql)
- [0022_technicians_and_assignments.sql](/g:/dev/driver_manager/migrations/0022_technicians_and_assignments.sql)
- [0008_assets_registry.sql](/g:/dev/driver_manager/migrations/0008_assets_registry.sql)
- [0020_asset_loans.sql](/g:/dev/driver_manager/migrations/0020_asset_loans.sql)
- [0001_installations_base.sql](/g:/dev/driver_manager/migrations/0001_installations_base.sql)
- [0006_device_tokens.sql](/g:/dev/driver_manager/migrations/0006_device_tokens.sql)
- [0005_audit_logs.sql](/g:/dev/driver_manager/migrations/0005_audit_logs.sql)
- [0007_multi_tenant_foundation.sql](/g:/dev/driver_manager/migrations/0007_multi_tenant_foundation.sql)

## SQL Base De Referencia

Esto no debe correrse sin backup previo.
El orden sirve como guia para un script final.

```sql
PRAGMA foreign_keys = ON;

BEGIN TRANSACTION;

DELETE FROM incident_photos;
DELETE FROM installation_conformities;
DELETE FROM technician_assignments;
DELETE FROM asset_installation_links;
DELETE FROM asset_loans;
DELETE FROM incidents;
DELETE FROM installations;
DELETE FROM technicians;
DELETE FROM device_tokens;
DELETE FROM audit_logs;
DELETE FROM tenant_audit_events;
DELETE FROM tenant_usage_snapshots;

COMMIT;
```

## Reset De Secuencias

Si ademas se quiere reiniciar la numeracion visible de IDs, no alcanza con borrar filas.
Tambien hay que limpiar `sqlite_sequence` para tablas con `AUTOINCREMENT`.

Secuencias a resetear en este alcance:

- `incident_photos`
- `installation_conformities`
- `technician_assignments`
- `asset_installation_links`
- `asset_loans`
- `incidents`
- `installations`
- `technicians`
- `device_tokens`
- `audit_logs`
- `tenant_audit_events`
- `tenant_usage_snapshots`

Referencia de forma:

```sql
DELETE FROM sqlite_sequence
WHERE name IN (
  'incident_photos',
  'installation_conformities',
  'technician_assignments',
  'asset_installation_links',
  'asset_loans',
  'incidents',
  'installations',
  'technicians',
  'device_tokens',
  'audit_logs',
  'tenant_audit_events',
  'tenant_usage_snapshots'
);
```

## Alcance Operativo Importante

### Varios Vuelos Relacionados A Assets

Aunque `assets` se conservan, este reset si elimina datos que los conectan con la operacion:

- `asset_installation_links`
- `asset_loans`
- `technician_assignments` cuando asignan tecnicos a activos

Eso significa que el catalogo de assets queda intacto, pero se pierde:

- historial de vinculacion asset-caso
- prestamos vigentes o historicos
- responsables operativos ligados a assets

### Tracking Publico

El tracking publico no vive en SQL.
Usa `PUBLIC_TRACKING_KV`.

Referencia:

- [public-tracking.js](/g:/dev/driver_manager/worker/lib/public-tracking.js#L84)

Claves relevantes:

- `pt:jti:<token>`
- `pt:code:<short_code>`
- `pt:installation:<tenant_id>:<installation_id>`

Si se borran `installations` y no se limpia este KV, pueden quedar enlaces publicos viejos apuntando a casos ya inexistentes o snapshots inconsistentes.

Para un reset realmente completo, tambien hay que vaciar las entradas de `PUBLIC_TRACKING_KV`.

## Variante Tenant-Specific

Si algun dia el reset tiene que aplicar solo a un tenant y no globalmente, hay que agregar `WHERE tenant_id = ?` en todas las tablas que tengan `tenant_id`.

Ojo:

- `installations` e `incidents` hoy si tienen `tenant_id` por migracion multi-tenant
- los filtros tenant-specific deben revisarse tabla por tabla
- `sqlite_sequence` no se puede resetear parcialmente por tenant, porque es global a la tabla

## Mobile Local

Si el backend se resetea y los celulares siguen con cache vieja, la app puede mostrar:

- incidencias inexistentes
- pines viejos
- jobs offline apuntando a IDs borrados
- asignaciones fantasma

Tablas locales a limpiar en mobile si se quiere coherencia completa:

- `incidents`
- `photos`
- `sync_jobs`
- `cases_local`
- `assigned_incidents_map_cache`
- `technician_assignments_cache`

Referencia:

- [schema.ts](/g:/dev/driver_manager/mobile-app/src/db/schema.ts)

## Checklist Antes De Ejecutar

1. Confirmar si el reset es global o por tenant.
2. Tomar backup de D1.
3. Confirmar si tambien se quiere limpiar `PUBLIC_TRACKING_KV`.
4. Confirmar si tambien se quiere limpiar cache offline mobile.
5. Confirmar si se reinician secuencias o solo se borran datos.
6. Ejecutar en entorno de prueba primero.

## Recomendacion

Cuando llegue el momento real, no hacerlo manualmente desde consola con deletes sueltos.
Conviene preparar uno de estos dos caminos:

- script SQL versionado y revisado
- comando runbook paso a paso con backup, borrado, reset de secuencia y limpieza de KV

Si despues queres, el siguiente paso puede ser convertir este runbook en:

- SQL exacto para D1 local
- SQL exacto para D1 remota
- o checklist operativa completa con comandos `wrangler`
