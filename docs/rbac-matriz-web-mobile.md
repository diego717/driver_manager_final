# Matriz RBAC Web + Mobile

Fecha: 2026-04-07

## Objetivo

Definir de forma explicita:

- que puede ver cada rol
- que puede modificar cada rol
- que flujos quedan reservados para plataforma
- que restricciones adicionales aplican al rol `tecnico`

Esta matriz busca alinear:

- Worker / backend
- dashboard web
- app mobile

## Roles canonicos

Los roles canonicos actuales del proyecto son:

- `admin`
- `supervisor`
- `tecnico`
- `solo_lectura`
- `super_admin`
- `platform_owner`

Referencias actuales:

- [0025_web_user_roles_rbac.sql](/g:/dev/driver_manager/migrations/0025_web_user_roles_rbac.sql)
- [core.js](/g:/dev/driver_manager/worker/lib/core.js)
- [roles.ts](/g:/dev/driver_manager/mobile-app/src/auth/roles.ts)

## Principios operativos

1. `admin` gestiona la operacion completa dentro de su tenant.
2. `supervisor` coordina operacion, despacho y seguimiento, pero no administra usuarios ni catalogos sensibles.
3. `tecnico` trabaja sobre casos asignados o heredados operacionalmente, no sobre todo el tenant.
4. `solo_lectura` consulta, pero no modifica datos.
5. `super_admin` y `platform_owner` quedan reservados para administracion transversal de plataforma.

## Regla clave para tecnico

El rol `tecnico` no deberia operar en modo tenant-wide.

Debe poder ver y modificar solo:

- incidencias asignadas directamente
- incidencias heredadas por asignacion del caso
- incidencias heredadas por asignacion del activo
- datos necesarios para ejecutar trabajo de campo

No deberia:

- ver todas las incidencias del tenant
- re-asignar tecnicos
- administrar usuarios
- administrar catalogo de tecnicos
- eliminar datos criticos

## Matriz propuesta

### 1. Dashboard general

| Modulo / accion | admin | supervisor | tecnico | solo_lectura | plataforma |
| --- | --- | --- | --- | --- | --- |
| Ver KPIs generales del tenant | si | si | si, pero idealmente resumidos | si | si |
| Ver atencion operativa del tenant | si | si | limitado a su trabajo o cola | si | si |
| Ver alertas de carga tecnica | si | si | no necesario global | si | si |

Decision recomendada:

- `tecnico` puede entrar al dashboard, pero con foco en `Mis casos` y no en control global del tenant.

### 2. Mis casos

| Modulo / accion | admin | supervisor | tecnico | solo_lectura | plataforma |
| --- | --- | --- | --- | --- | --- |
| Ver `Mis casos` del usuario vinculado | si | si | si | si | si |
| Ver estados agrupados | si | si | si | si | si |
| Actualizar lista / refrescar | si | si | si | si | si |

Decision recomendada:

- esta vista debe existir para cualquier rol con tecnico vinculado
- en `tecnico` deberia ser la vista principal de trabajo

### 3. Incidencias

| Modulo / accion | admin | supervisor | tecnico | solo_lectura | plataforma |
| --- | --- | --- | --- | --- | --- |
| Ver todas las incidencias del tenant | si | si | no | si | si |
| Ver incidencias asignadas | si | si | si | si | si |
| Crear incidencia | si | si | si | no | si |
| Editar nota, checklist, evidencia | si | si | si, solo asignadas | no | si |
| Cambiar estado | si | si | si, solo asignadas | no | si |
| Resolver incidencia | si | si | si, solo asignadas | no | si |
| Reabrir incidencia | si | si | no por defecto | no | si |
| Borrar incidencia | no por defecto | no | no | no | si |

Decision recomendada:

- `tecnico` puede trabajar la incidencia asignada end-to-end
- `reabrir` conviene reservarlo a `admin` y `supervisor`
- `delete` debe quedar fuera de tenant-level y reservado a plataforma o tooling interno

### 4. Destino operativo y mapa

| Modulo / accion | admin | supervisor | tecnico | solo_lectura | plataforma |
| --- | --- | --- | --- | --- | --- |
| Ver mapa global del tenant | si | si | no por defecto | si | si |
| Ver mapa personal / asignado | si | si | si | si | si |
| Ajustar destino operativo | si | si | si, solo asignadas | no | si |
| Editar referencia, contacto y notas de despacho | si | si | si, solo asignadas | no | si |

Decision recomendada:

- `tecnico` deberia usar mapa personal o asignado
- el mapa global queda mas alineado a `admin` y `supervisor`

### 5. Evidencia, fotos y checklist

| Modulo / accion | admin | supervisor | tecnico | solo_lectura | plataforma |
| --- | --- | --- | --- | --- | --- |
| Ver evidencia | si | si | si, solo asignadas o creadas por el | si | si |
| Subir fotos | si | si | si, solo asignadas | no | si |
| Editar checklist y nota operativa | si | si | si, solo asignadas | no | si |
| Eliminar evidencia | no por defecto | no por defecto | no | no | si |

Decision recomendada:

- agregar borrado de evidencia solo si hay necesidad operativa real y trazabilidad fuerte

### 6. Registros / instalaciones

| Modulo / accion | admin | supervisor | tecnico | solo_lectura | plataforma |
| --- | --- | --- | --- | --- | --- |
| Ver registros del tenant | si | si | limitado a relacionados | si | si |
| Crear registro | si | si | si | no | si |
| Editar registro | si | si | si, si esta trabajando el caso | no | si |
| Crear conformidad | si | si | si | no | si |
| Generar tracking publico | si | si | no por defecto | no | si |
| Revocar tracking publico | si | si | no | no | si |

Decision recomendada:

- si tracking publico se usa como herramienta operativa externa, mejor dejarlo en `admin` y `supervisor`

### 7. Asignaciones de tecnicos

| Modulo / accion | admin | supervisor | tecnico | solo_lectura | plataforma |
| --- | --- | --- | --- | --- | --- |
| Ver asignaciones | si | si | lectura parcial de las propias | si | si |
| Asignar tecnico a incidencia/caso/equipo | si | si | no | no | si |
| Quitar asignacion | si | si | no | no | si |

Decision recomendada:

- mantener este modulo fuera del alcance de `tecnico`

### 8. Assets / equipos

| Modulo / accion | admin | supervisor | tecnico | solo_lectura | plataforma |
| --- | --- | --- | --- | --- | --- |
| Ver catalogo de equipos del tenant | si | si | no por defecto | si | si |
| Ver detalle de un equipo | si | si | si, si esta relacionado a una asignacion o caso | si | si |
| Crear equipo | si | no | no | no | si |
| Editar datos maestros del equipo | si | no | no | no | si |
| Eliminar equipo | no por defecto | no | no | no | si |
| Generar / regenerar QR | si | si | no por defecto | no | si |
| Vincular equipo a instalacion | si | si | no | no | si |
| Desvincular equipo de instalacion | si | si | no | no | si |
| Ver incidencias del equipo | si | si | si, si el equipo esta en su cola operativa | si | si |
| Crear incidencia sobre equipo | si | si | si, si esta trabajando el equipo | no | si |
| Ver prestamos del equipo | si | si | no por defecto | si | si |
| Registrar prestamo / devolucion | si | si | no | no | si |

Decision recomendada:

- separar claramente `catalogo de assets` de `equipo involucrado en trabajo de campo`
- `tecnico` no deberia navegar el inventario completo del tenant
- `tecnico` si deberia poder ver el detalle del equipo cuando ese equipo aparece en un caso o incidencia asignada
- `crear/editar/borrar` assets debe quedar en `admin`
- `supervisor` puede operar sobre vinculaciones y seguimiento, pero no sobre datos maestros del catalogo
- `prestamos` conviene dejarlos en `admin/supervisor` porque afectan trazabilidad e inventario

### 9. Catalogo de tecnicos

| Modulo / accion | admin | supervisor | tecnico | solo_lectura | plataforma |
| --- | --- | --- | --- | --- | --- |
| Ver catalogo de tecnicos | si | si | no necesario | si | si |
| Crear tecnico | si | no | no | no | si |
| Editar tecnico | si | no | no | no | si |
| Vincular usuario web | si | no | no | no | si |
| Activar/desactivar tecnico | si | no | no | no | si |

Decision recomendada:

- `supervisor` no deberia gestionar el catalogo
- `admin` si

### 10. Usuarios web y roles

| Modulo / accion | admin | supervisor | tecnico | solo_lectura | plataforma |
| --- | --- | --- | --- | --- | --- |
| Ver usuarios del tenant | si | no | no | no | si |
| Crear usuario | si | no | no | no | si |
| Cambiar rol | si | no | no | no | si |
| Desactivar usuario | si | no | no | no | si |

Decision recomendada:

- no abrir gestion de usuarios a `supervisor`

### 11. Tenants y plataforma

| Modulo / accion | admin | supervisor | tecnico | solo_lectura | plataforma |
| --- | --- | --- | --- | --- | --- |
| Ver tenant admin center | no | no | no | no | si |
| Crear tenant | no | no | no | no | si |
| Editar tenant | no | no | no | no | si |
| Borrar tenant | no | no | no | no | si |
| Borrados criticos / mantenimiento transversal | no | no | no | no | si |

## Estado actual del codigo

Hoy existe una base util pero todavia gruesa:

- `canManageUsers`
- `canManageTechnicians`
- `canAssignTechnicians`
- `canWriteOperationalData`
- `canReadOperationalData`
- `canDeleteCriticalData`

Referencias:

- [core.js](/g:/dev/driver_manager/worker/lib/core.js#L52)
- [roles.ts](/g:/dev/driver_manager/mobile-app/src/auth/roles.ts#L31)

### Lo que ya esta bien encaminado

- `admin` y plataforma gestionan usuarios/tecnicos
- `supervisor` puede asignar tecnicos
- `tecnico` puede escribir datos operativos
- `solo_lectura` queda fuera de escritura

### Lo que sigue ambiguo

- si `tecnico` ve todas las incidencias o solo las asignadas
- si `tecnico` puede reabrir
- si `tecnico` puede abrir detalle de cualquier asset o solo del asset asociado a su trabajo
- si `supervisor` puede vincular/desvincular assets pero no editar catalogo maestro
- si prestamos de assets quedan en supervisor o solo admin
- si `supervisor` puede editar tecnicos o solo coordinar operacion
- si el mapa global queda visible para `tecnico`
- si tracking publico es solo admin/supervisor o tambien tecnico

## Reglas de implementacion recomendadas

### Backend

1. Mantener helpers base en `worker/lib/core.js`.
2. Agregar helpers especificos por dominio, por ejemplo:
   - `canViewTenantIncident(actor, incident)`
   - `canEditTenantIncident(actor, incident)`
   - `canResolveTenantIncident(actor, incident)`
   - `canReopenTenantIncident(actor, incident)`
   - `canManageDispatchTarget(actor, incident)`
   - `canViewAssetCatalog(actor)`
   - `canViewAssetDetail(actor, asset, context)`
   - `canEditAssetCatalog(actor)`
   - `canManageAssetLoans(actor)`
   - `canViewTechnicianCatalog(actor)`
3. Para `tecnico`, validar contexto real:
   - asignacion directa a incidencia
   - asignacion al caso
   - asignacion al activo

### Web

1. Ocultar navegacion y botones no permitidos por rol.
2. Priorizar `Mis casos` para `tecnico`.
3. Mantener `Técnicos`, `Usuarios`, `Tenants` y herramientas sensibles solo donde corresponda.

4. Diferenciar UI de `inventario` versus `equipo del caso` para que `tecnico` no herede acceso global por accidente.

### Mobile

1. `tecnico` deberia usar:
   - `Casos`
   - `Mapa`
   - `Detalle de incidencia`
   - `Evidencia`
2. Evitar mostrar UI de administracion al tecnico.
3. Si mobile queda tambien para supervisor/admin, respetar la misma matriz.

## Orden sugerido de endurecimiento

1. Documentar esta matriz como fuente base.
2. Definir helpers backend especificos por recurso.
3. Ajustar visibilidad web por rol.
4. Ajustar guardas mobile por rol.
5. Cubrir con tests:
   - backend por endpoint
   - dashboard por secciones visibles
   - mobile por acciones habilitadas

## Decision inicial recomendada

Si hubiera que fijar una politica inicial simple desde ya:

- `admin`: ve y opera todo el tenant; gestiona usuarios y tecnicos.
- `supervisor`: ve todo lo operativo del tenant; asigna y coordina; no administra usuarios ni catalogo de tecnicos.
- `tecnico`: ve y modifica solo trabajo asignado o heredado operacionalmente; no asigna ni administra.
- `solo_lectura`: solo consulta.
- `super_admin` / `platform_owner`: plataforma completa.

## Siguiente paso sugerido

Tomar esta matriz y transformarla en:

1. helpers backend mas finos
2. ocultamiento/disable real de UI web
3. reglas de alcance para `tecnico` sobre incidencias asignadas
