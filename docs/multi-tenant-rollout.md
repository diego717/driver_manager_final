# Base vendible multiempresa (fase inicial)

Este documento aterriza la implementación inicial para convertir Driver Manager en una base **multi-tenant** vendible sin romper el stack actual (Worker + D1 + R2 + apps).

## Objetivo de esta fase

1. Habilitar aislamiento lógico por `tenant_id` en D1 y R2.
2. Definir roles por empresa (`admin`, `supervisor`, `tecnico`, `solo_lectura`).
3. Capturar auditoría mínima por tenant (quién, qué, cuándo).
4. Dejar lista la estructura para límites técnicos por plan.

## Qué ya se implementa en esta iteración

Se agrega la migración `0007_multi_tenant_foundation.sql` con:

- Tabla `tenants`.
- Tabla `plan_limits` con planes base (`starter`, `growth`, `scale`).
- Columna `tenant_id` en tablas críticas existentes (`installations`, `incidents`, `incident_photos`, `web_users`, `audit_logs`, `device_tokens`).
- Tabla `tenant_user_roles` para roles por empresa.
- Tabla `tenant_audit_events` para auditoría mínima por tenant.
- Tabla `tenant_usage_snapshots` para consumo mensual (usuarios/storage/incidencias).

## Diseño funcional por requerimiento

### 1) Multi-tenant end-to-end

**Contexto de tenant obligatorio por request**:

- Web: extraer `tenant_id` del token de sesión.
- API HMAC (desktop/mobile): recibir `X-Tenant-Id` y validar existencia/estado.

**Regla de oro**: todas las consultas D1 deben filtrar por `tenant_id` (lectura y escritura).

Checklist de código en `worker.js`:

- Crear helper `resolveTenantContext(request, env, authContext)`.
- Validar tenant activo en tabla `tenants`.
- Inyectar `tenantId` en handlers y queries.
- Rechazar request sin tenant con `400`/`403` según caso.

### 2) Roles por empresa

Roles operativos definidos:

- `admin`: gestión total dentro de su tenant.
- `supervisor`: lectura amplia + gestión operativa limitada.
- `tecnico`: creación/edición de incidencias y acciones de campo.
- `solo_lectura`: acceso consulta, sin mutaciones.

Implementación recomendada:

- Mantener `web_users` como identidad global.
- Autorizar por `tenant_user_roles` (`tenant_id + user_id + role`).
- Añadir helper `requireTenantRole(allowedRoles)` por endpoint.

Matriz inicial sugerida:

- `GET` datos tenant: `admin/supervisor/tecnico/solo_lectura`.
- `POST/PUT` instalaciones e incidencias: `admin/supervisor/tecnico`.
- gestión de usuarios/roles tenant: `admin`.

### 3) Aislamiento de archivos en R2 por prefijo tenant

Convención de key:

```text
tenants/{tenant_id}/incidents/{incident_id}/{photo_id}.{ext}
```

Acciones en Worker:

- Al subir foto, construir `r2_key` con prefijo tenant.
- En lecturas/listados, validar que `r2_key` pertenezca al tenant autenticado.
- Registrar tamaño acumulado en `tenant_usage_snapshots.storage_bytes`.

### 4) Auditoría mínima por tenant

Cada evento sensible registra:

- `tenant_id`
- `actor_user_id` / `actor_username`
- `action`
- `entity_type` + `entity_id`
- `occurred_at`
- `metadata_json` opcional

Eventos mínimos:

- login exitoso/fallido
- alta/edición/baja de instalación
- creación/actualización de incidencia
- subida/eliminación de foto
- cambio de rol o estado de usuario

### 5) Planes y límites técnicos

Límites iniciales en `plan_limits`:

- `max_users`
- `max_storage_bytes`
- `max_incidents_per_month`

Enforcement recomendado:

1. Resolver plan del tenant (`tenants.plan_code`).
2. Obtener límites de `plan_limits`.
3. Calcular uso actual.
4. Bloquear operación con `409` si excede.

Ejemplos de bloqueo:

- alta de usuario sobre `max_users`
- upload foto sobre `max_storage_bytes`
- nueva incidencia sobre `max_incidents_per_month`

## Plan de ejecución sugerido (sprints cortos)

### Sprint A - Contexto tenant + filtros obligatorios

- Aplicar migración `0007`.
- Agregar `resolveTenantContext`.
- Propagar `tenant_id` a endpoints críticos (`installations`, `incidents`, `audit-logs`, `devices`).
- Añadir tests de aislamiento (tenant A no ve datos tenant B).

### Sprint B - RBAC tenant + auditoría

- Integrar `tenant_user_roles` en login/autorización.
- Implementar `requireTenantRole` por endpoint.
- Registrar eventos en `tenant_audit_events`.
- Añadir tests de permisos por rol.

### Sprint C - R2 isolation + límites

- Migrar formato `r2_key` con prefijo tenant.
- Implementar cálculo y persistencia de uso.
- Enforzar límites por plan.
- Añadir tests de cuotas y errores esperados.

## Riesgos a vigilar

- Queries legacy sin `tenant_id` (fuga de datos).
- Endpoints web y mobile con lógica de auth diferente.
- Backfill de tenant para datos históricos (`default`) y transición sin downtime.

## Definiciones operativas recomendadas

- Tenant por defecto para legado: `default`.
- Política inicial: un usuario puede pertenecer a múltiples tenants (N:N con `tenant_user_roles`).
- Logs de auditoría: retención configurable por plan o política legal.
