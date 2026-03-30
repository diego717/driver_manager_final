# 2026-03-29 - tecnicos, tenant admin center y endurecimiento de plataforma

## Resumen

Se consolida una capa administrativa multi-tenant mas operable: tecnicos como entidad propia, consola de tenants para plataforma, mejor soporte mobile para trabajo de campo y endurecimiento de permisos globales y borrado seguro.

## Areas tocadas

- worker
- dashboard web
- mobile app
- auth web
- multi-tenant
- documentacion operativa

## Contexto

La base multi-tenant ya existia, pero todavia faltaban piezas clave para operar tenants y tecnicos de forma real:

- catalogo de tecnicos por tenant
- asignacion operativa de tecnicos sobre incidencias, instalaciones, activos y casos
- consola de tenants para la capa de plataforma
- separacion mas clara entre rol global y roles por tenant
- borrado administrado de tenants y usuarios con confirmacion y auditoria

## Cambios clave

- se formaliza `technicians` como entidad separada de `web_users`, con asignaciones activas por tipo de entidad
- el dashboard incorpora CRUD de tecnicos, vinculacion con usuario web y gestion de asignaciones
- mobile gana `Mi cola`, contexto de responsables y gestion operativa de asignaciones para `admin` y `super_admin` o `platform_owner`
- se agrega una vista dedicada de tecnicos en mobile para administracion en campo
- se incorpora `Tenant Admin Center` para plataforma con listado, detalle, alta y edicion de tenants
- el detalle de tenant suma gestion de usuarios web del tenant
- se endurece el modelo de permisos para que el alcance global quede reservado al tenant `default`
- se introduce `platform_owner` como rol de plataforma, manteniendo compatibilidad con `super_admin` legado
- se habilita eliminacion de usuarios web y tenants con modal de confirmacion, auditoria y resumen previo de impacto
- el borrado de tenant se hace mas robusto frente a foreign keys y entornos D1 donde ciertos `PRAGMA` no estan autorizados

## Impacto

- mejor aislamiento entre plataforma y tenants cliente
- administracion mas clara de tecnicos y usuarios
- experiencia mobile mas cercana al uso operativo real del tecnico
- menor riesgo de errores manuales al vincular tecnico con usuario web
- mejor soporte para crecimiento comercial y operacion multi-empresa
- borrado mas seguro, trazable y entendible antes de ejecutar acciones irreversibles

## Referencias

- `migrations/0022_technicians_and_assignments.sql`
- `worker/routes/technicians.js`
- `worker/routes/tenants.js`
- `worker/auth/web.js`
- `worker/auth/users.js`
- `worker.js`
- `dashboard.html`
- `dashboard.js`
- `dashboard-api.js`
- `dashboard-navigation.js`
- `dashboard-incidents.js`
- `dashboard-assets.js`
- `dashboard-overview.js`
- `dashboard-modals.js`
- `dashboard-auth.js`
- `dashboard.css`
- `mobile-app/app/(tabs)/work.tsx`
- `mobile-app/app/incident/detail.tsx`
- `mobile-app/app/incident/create.tsx`
- `mobile-app/app/case/conformity.tsx`
- `mobile-app/app/case/context.tsx`
- `mobile-app/app/(tabs)/explore.tsx`
- `mobile-app/app/technicians.tsx`
- `mobile-app/app/modal.tsx`
- `mobile-app/src/components/TechnicianAssignmentsPanel.tsx`
- `mobile-app/src/components/TechnicianDirectoryCard.tsx`
- `mobile-app/src/api/technicians.ts`
- `mobile-app/src/api/webAuth.ts`
- `docs/technicians-and-tenant-model.md`

## Validacion

- `node --test tests_js/worker/auth-routes.test.mjs`
- `node --test tests_js/worker/routes.test.mjs`
- `node --test tests_js/dashboard.unit.test.mjs`
- `npm run test:worker:raw`
- `npm run test:dashboard:raw`
- `npm run dashboard:sync-assets`
- `npx tsc --noEmit` en `mobile-app`
- `npm test` en `mobile-app`

## Pendientes

- conviene agregar impersonacion segura de tenant para soporte de plataforma
- sigue siendo util una migracion futura para convertir usuarios legacy `super_admin` a `platform_owner`
- se puede endurecer aun mas el borrado de tenant pidiendo el `slug` ademas del checkbox cuando el impacto sea alto

## Seguimiento desktop

### Avance PR 1 - base de auth, roles y tenant para Windows

Estado: en curso

Se dejo adelantada la base del track Windows para alinearlo con web y mobile:

- desktop ya conserva roles web modernos (`super_admin`, `admin`, `supervisor`, `tecnico`, `solo_lectura`)
- el runtime desktop pasa a exponer flags de sesion mas granulares, en vez de depender solo de `is_admin`
- la capa HTTP del historial puede heredar `tenant_id` desde la sesion web actual
- los flujos de incidencias del desktop dejan abierta la operacion para `supervisor` y `tecnico` sin habilitar privilegios administrativos

Archivos principales de este avance:

- `managers/user_auth_provider.py`
- `managers/history_request_adapter.py`
- `managers/history_manager.py`
- `ui/main_window.py`
- `ui/main_window_bootstrap.py`
- `ui/main_window_session.py`
- `ui/main_window_incidents.py`
- `handlers/event_handlers.py`

Validacion puntual ejecutada:

- `python -m unittest tests.test_user_auth_provider tests.test_history_manager tests.test_main_window_helpers`

### Avance PR 2 - cliente desktop para tecnicos y asignaciones

Estado: en curso

Se implemento la capa de servicios desktop para consumir el contrato web de tecnicos y asignaciones, aislando HTTP y normalizacion fuera de la UI:

- nuevo servicio `TechnicianWebService` para:
  - listar/crear/editar tecnicos
  - listar asignaciones de tecnico
  - listar asignaciones por entidad
  - crear y quitar asignaciones
- `InstallationHistory` ahora expone fachadas para ese servicio, reutilizando el mismo transporte y sesion web del desktop
- los errores de red/backend del servicio se devuelven con prefijos operativos consistentes para consumo en dialogs PyQt
- se agregaron tests unitarios para contrato, normalizacion y delegacion de `InstallationHistory`

Archivos principales de este avance:

- `managers/technician_web_service.py`
- `managers/history_manager.py`
- `tests/test_technician_web_service.py`
- `tests/test_history_manager.py`

Validacion puntual sugerida para este bloque:

- `python -m unittest tests.test_technician_web_service tests.test_history_manager`

### Avance PR 3 - directorio de tecnicos en Windows

Estado: en curso

Se conecto UI desktop para que las funciones de PR2 queden visibles y operables:

- `Gestion de usuarios` ahora incluye acceso a `Gestionar tecnicos`
- nuevo dialogo `Directorio de tecnicos`:
  - listado con estado, `web_user_id` y conteo de asignaciones activas
  - alta de tecnico
  - edicion de tecnico (incluye activar/desactivar y vinculo con usuario web)
- permisos de edicion de catalogo aplicados por rol:
  - `admin` y `super_admin`: pueden crear/editar
  - otros roles: solo lectura
- el acceso al boton de gestion desde Admin tab ahora tambien se muestra para `admin`

Archivos principales de este avance:

- `ui/dialogs/user_management_ui.py`
- `ui/main_window.py`
- `ui/main_window_session.py`

Validacion puntual ejecutada:

- `python -m unittest tests.test_main_window_helpers tests.test_history_manager tests.test_technician_web_service`

### Avance PR 4 - asignaciones operativas en incidencias

Estado: en curso

Se implemento el slice de asignaciones sobre incidencias y registros (installations) dentro del desktop:

- la vista de incidencias ahora muestra bloque `Asignaciones tecnicas`
- se pueden:
  - listar asignaciones activas de la incidencia seleccionada
  - crear asignacion a tecnico con rol `owner`, `assistant` o `reviewer`
  - quitar asignacion activa
- el panel de `Registros` suma bloque `Asignaciones del registro` con la misma capacidad:
  - listar asignaciones activas de installation
  - crear asignacion por rol
  - quitar asignacion activa
- gestion habilitada solo para roles operativos de coordinacion:
  - `super_admin`
  - `admin`
  - `supervisor`
- usuarios sin permisos de coordinacion mantienen vista de solo lectura en asignaciones

Archivos principales de este avance:

- `ui/ui_components.py`
- `ui/main_window_incidents.py`
- `ui/main_window.py`
- `ui/main_window_connections.py`
- `tests/test_main_window_incident_assignments.py`

Validacion puntual ejecutada:

- `python -m unittest tests.test_main_window_incident_assignments tests.test_main_window_helpers tests.test_history_manager tests.test_technician_web_service`

### Avance PR 5 - homologacion de reportes y auditoria de asignaciones

Estado: en curso

Se completo el primer bloque de homologacion final para Windows:

- reportes Excel (`Instalaciones`) priorizan tecnico estructurado desde asignaciones activas por installation
- si no hay asignacion estructurada, se mantiene fallback al `technician_name` legacy para compatibilidad
- la resolucion de tecnico en reportes ahora evita cache stale entre corridas de reportes y aisla por contexto tenant/id
- las acciones de asignacion en incidencias y registros consolidan trazabilidad de auditoria:
  - creacion exitosa
  - fallo de creacion
  - remocion exitosa
  - fallo de remocion

Archivos principales de este avance:

- `reports/report_generator.py`
- `ui/main_window_incidents.py`
- `tests/test_report_generator.py`
- `tests/test_main_window_incident_assignments.py`

Validacion puntual ejecutada:

- `python -m unittest tests.test_report_generator tests.test_main_window_incident_assignments tests.test_main_window_helpers tests.test_history_manager tests.test_technician_web_service`
