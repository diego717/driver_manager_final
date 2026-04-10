# Historial de cambios

Indice resumido de cambios relevantes del proyecto.

## Como usar este indice

- agregar una linea por nota nueva
- ordenar de mas nuevo a mas antiguo
- mantener descripcion corta y util

## Entradas

- `2026-04-08` - Alineacion RBAC en UI web/mobile, `Mis casos` desacoplado del catalogo de tecnicos y mapa personal del tecnico con incidencias asignadas visibles otra vez. Ver `docs/changes/2026-04-08-rbac-ui-technician-map-and-my-cases-alignment.md`.
- `2026-04-03` - Destino operativo en incidencias, toggle `dispatch_required`, push por asignacion, mapa mobile y cola offline por tecnico con indicadores de snapshot local. Ver `docs/changes/2026-04-03-mobile-incident-dispatch-map-offline-rollout.md`.
- `2026-04-02` - Creacion offline de casos con outbox `create_case` y resolucion basica de incidencias dependientes de casos locales. Ver `docs/changes/2026-04-02-mobile-case-offline-outbox.md`.
- `2026-04-02` - Checklist y nota de evidencia pasan a outbox offline `update_incident_evidence` con payload persistido en storage seguro. Ver `docs/changes/2026-04-02-mobile-incident-evidence-offline-outbox.md`.
- `2026-04-02` - Photo upload offline con outbox local, executor `upload_photo` y wiring del flujo de evidencia a sync posterior. Ver `docs/changes/2026-04-02-mobile-photo-offline-upload-outbox.md`.
- `2026-04-02` - Estado real del mobile offline sync y endurecimiento de persistencia local para PII, metadatos de fotos y errores de sync. Ver `docs/changes/2026-04-02-mobile-offline-sync-status-and-security-hardening.md`.
- `2026-03-29` - Nueva linea `Windows UI v2` con shell QML, login obligatorio, `Drivers` funcional e inicio de migracion real de `Incidencias`. Ver `docs/changes/2026-03-29-windows-ui-v2-refresh-and-functional-migration.md`.
- `2026-03-29` - Tecnicos como entidad operativa, Tenant Admin Center, rol `platform_owner` y borrado seguro de tenants y usuarios. Ver `docs/changes/2026-03-29-technicians-tenant-admin-and-platform-hardening.md`.
- `2026-03-27` - Remediacion de secretos locales, optimizacion mobile, mejoras de dashboard y endurecimiento de public tracking. Ver `docs/changes/2026-03-27-security-mobile-dashboard-public-tracking.md`.
- `2026-03-27` - Rollout inicial de seguimiento publico con Magic Link, snapshot por KV y SSE. Ver `docs/changes/2026-03-27-public-tracking-rollout.md`.
- `2026-03-27` - Base inicial del historial de cambios creada. Ver `docs/change-documentation-rule.md`.
- `2026-03-26` - Expansion funcional de assets y prestamos dentro del dominio operativo. Ver `docs/changes/2026-03-26-assets-and-loans-expansion.md`.
- `2026-03-26` - Consolidacion tecnica historica de GPS tagging y geofence en dashboard, Worker y conformidades. Ver `docs/changes/2026-03-26-gps-geofence-rollout.md`.
- `2026-03-21` - Base de auth web y aislamiento multi-tenant como direccion del sistema. Ver `docs/changes/2026-03-21-web-auth-multi-tenant-foundation.md`.
- `2026-03-21` - Base del track offline-first y sync local para mobile. Ver `docs/changes/2026-03-21-mobile-offline-sync-foundation.md`.
