# Base vendible multiempresa (fase inicial)

Este documento aterriza la implementacion inicial para convertir SiteOps en una base **multi-tenant** vendible sin romper el stack actual (Worker + D1 + R2 + apps).

## Objetivo de esta fase

1. Habilitar aislamiento logico por `tenant_id` en D1 y R2.
2. Definir roles por empresa (`admin`, `supervisor`, `tecnico`, `solo_lectura`).
3. Capturar auditoria minima por tenant (quien, que, cuando).
4. Dejar lista la estructura para limites tecnicos por plan.

## Que ya se implementa en esta iteracion

Se agrega la migracion `0007_multi_tenant_foundation.sql` con:

- Tabla `tenants`.
- Tabla `plan_limits` con planes base (`starter`, `growth`, `scale`).
- Columna `tenant_id` en tablas criticas existentes (`installations`, `incidents`, `incident_photos`, `web_users`, `audit_logs`, `device_tokens`).
- Tabla `tenant_user_roles` para roles por empresa.
- La auditoria operativa se centraliza en `audit_logs` (fuente unica).
- Tabla `tenant_usage_snapshots` para consumo mensual (usuarios, storage, incidencias).

## Diseno funcional por requerimiento

### 1) Multi-tenant end-to-end

**Contexto de tenant obligatorio por request**:

- Web: extraer `tenant_id` del token de sesion.
- API HMAC (desktop/mobile): recibir `X-Tenant-Id` y validar existencia/estado.

**Regla de oro**: todas las consultas D1 deben filtrar por `tenant_id` (lectura y escritura).

Checklist de codigo en `worker.js`:

- Crear helper `resolveTenantContext(request, env, authContext)`.
- Validar tenant activo en tabla `tenants`.
- Inyectar `tenantId` en handlers y queries.
- Rechazar request sin tenant con `400`/`403` segun caso.

### 2) Roles por empresa

Roles operativos definidos:

- `admin`: gestion total dentro de su tenant.
- `supervisor`: lectura amplia + gestion operativa limitada.
- `tecnico`: creacion/edicion de incidencias y acciones de campo.
- `solo_lectura`: acceso consulta, sin mutaciones.

Implementacion recomendada:

- Mantener `web_users` como identidad global.
- Autorizar por `tenant_user_roles` (`tenant_id + user_id + role`).
- Anadir helper `requireTenantRole(allowedRoles)` por endpoint.

Matriz inicial sugerida:

- `GET` datos tenant: `admin/supervisor/tecnico/solo_lectura`.
- `POST/PUT` instalaciones e incidencias: `admin/supervisor/tecnico`.
- Gestion de usuarios/roles tenant: `admin`.

### 3) Aislamiento de archivos en R2 por prefijo tenant

Convencion de key:

```text
tenants/{tenant_id}/incidents/{incident_id}/{photo_id}.{ext}
```

Acciones en Worker:

- Al subir foto, construir `r2_key` con prefijo tenant.
- En lecturas/listados, validar que `r2_key` pertenezca al tenant autenticado.
- Registrar tamano acumulado en `tenant_usage_snapshots.storage_bytes`.

### 4) Auditoria minima por tenant

Cada evento sensible registra:

- `tenant_id`
- `actor_user_id` / `actor_username`
- `action`
- `entity_type` + `entity_id`
- `occurred_at`
- `metadata_json` opcional

Eventos minimos:

- login exitoso/fallido
- alta/edicion/baja de instalacion
- creacion/actualizacion de incidencia
- subida/eliminacion de foto
- cambio de rol o estado de usuario

### 5) Planes y limites tecnicos

Limites iniciales en `plan_limits`:

- `max_users`
- `max_storage_bytes`
- `max_incidents_per_month`

Enforcement recomendado:

1. Resolver plan del tenant (`tenants.plan_code`).
2. Obtener limites de `plan_limits`.
3. Calcular uso actual.
4. Bloquear operacion con `409` si excede.

Ejemplos de bloqueo:

- alta de usuario sobre `max_users`
- upload foto sobre `max_storage_bytes`
- nueva incidencia sobre `max_incidents_per_month`

## Plan de ejecucion sugerido (sprints cortos)

### Sprint A - Contexto tenant + filtros obligatorios

- Aplicar migracion `0007`.
- Agregar `resolveTenantContext`.
- Propagar `tenant_id` a endpoints criticos (`installations`, `incidents`, `audit-logs`, `devices`).
- Anadir tests de aislamiento (tenant A no ve datos tenant B).

### Sprint B - RBAC tenant + auditoria

- Integrar `tenant_user_roles` en login/autorizacion.
- Implementar `requireTenantRole` por endpoint.
- Registrar eventos en `audit_logs` con `tenant_id`.
- Anadir tests de permisos por rol.

### Sprint C - R2 isolation + limites

- Migrar formato `r2_key` con prefijo tenant.
- Implementar calculo y persistencia de uso.
- Enforzar limites por plan.
- Anadir tests de cuotas y errores esperados.

## Riesgos a vigilar

- Queries legacy sin `tenant_id` (fuga de datos).
- Endpoints web y mobile con logica de auth diferente.
- Backfill de tenant para datos historicos (`default`) y transicion sin downtime.

## Definiciones operativas recomendadas

- Tenant por defecto para legado: `default`.
- Politica inicial: un usuario puede pertenecer a multiples tenants (N:N con `tenant_user_roles`).
- Logs de auditoria: retencion configurable por plan o politica legal.
