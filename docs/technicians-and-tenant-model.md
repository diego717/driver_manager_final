# Tecnicos y Modelo Tenant

Documento de definicion funcional y tecnica para consolidar:

- la entidad `tecnico`
- su asignacion operativa
- la separacion de roles por tenant
- el manejo de credenciales y secretos multi-tenant

Fecha: 2026-03-28

## 1. Objetivo

Pasar del estado actual, donde "tecnico" existe mayormente como dato operativo libre, a un modelo consistente donde:

- cada tenant administra su propio staff tecnico
- los tecnicos pueden existir con o sin acceso al sistema
- las asignaciones operativas son trazables
- el aislamiento por tenant cubre identidad, datos y almacenamiento
- las credenciales sensibles no se mezclan entre tenants ni se distribuyen en clientes

## 2. Estado actual del repo

Hoy el proyecto ya tiene una base multi-tenant inicial:

- `web_users.tenant_id`
- tablas `tenants`, `plan_limits`, `tenant_user_roles`, `tenant_usage_snapshots`
- documentacion que define `tenant_id` como filtro obligatorio

Pero todavia hay gaps importantes:

- `tecnico` no es una entidad formal propia
- la auth web real sigue usando sobre todo `web_users.role` y `web_users.tenant_id`
- los permisos efectivos de escritura todavia estan centrados en `admin` y `super_admin`
- la documentacion pide prefijos R2 por tenant, pero hay flujos que aun no los usan en todas las keys

## 3. Principios de diseno

### 3.1 Tecnico no es lo mismo que usuario

Separar:

- identidad operativa: la persona que hace el trabajo
- identidad de acceso: la cuenta que inicia sesion

Eso permite:

- registrar tecnicos tercerizados o temporales sin login
- conservar historial aunque cambie la cuenta del usuario
- asignar trabajo a una persona aunque no use dashboard o mobile

### 3.2 Tenant como frontera dura

Todo objeto operativo debe pertenecer a un tenant explicito:

- usuarios
- tecnicos
- instalaciones
- incidencias
- activos
- fotos y PDFs en R2
- auditoria

### 3.3 Super admin es de plataforma, no de empresa

`super_admin` administra la plataforma completa.

`admin`, `supervisor`, `tecnico` y `solo_lectura` son roles dentro de un tenant.

## 4. Modelo propuesto

## 4.1 Roles

### Plataforma

- `super_admin`
  - puede ver y operar en cualquier tenant
  - puede crear tenants
  - puede crear o bloquear admins tenant
  - puede hacer soporte cross-tenant

### Tenant

- `admin`
  - administra usuarios y tecnicos de su tenant
  - administra configuracion operativa de su tenant
  - puede asignar trabajo y operar sobre datos del tenant

- `supervisor`
  - coordina operacion
  - puede asignar tecnicos y actualizar trabajo operativo
  - no cambia credenciales sensibles ni configuracion de plataforma

- `tecnico`
  - ejecuta trabajo de campo
  - puede crear o actualizar incidencias, conformidades y evidencia segun flujo
  - no administra usuarios ni secretos

- `solo_lectura`
  - consulta datos
  - no muta informacion

## 4.2 Entidad `technicians`

Tabla propuesta:

```sql
CREATE TABLE technicians (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  web_user_id INTEGER,
  display_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  employee_code TEXT,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, employee_code),
  UNIQUE (tenant_id, web_user_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (web_user_id) REFERENCES web_users(id) ON DELETE SET NULL
);
```

Sentido de cada campo:

- `tenant_id`: frontera de aislamiento
- `web_user_id`: opcional, para tecnico con login
- `display_name`: nombre visible en asignaciones, PDFs y reportes
- `employee_code`: identificador interno del cliente
- `is_active`: baja logica

## 4.3 Asignaciones

No conviene acoplar toda asignacion a un solo campo. Hay distintos niveles operativos.

Propuesta inicial:

```sql
CREATE TABLE technician_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  technician_id INTEGER NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('installation', 'incident', 'asset', 'zone')),
  entity_id TEXT NOT NULL,
  assignment_role TEXT NOT NULL DEFAULT 'owner'
    CHECK (assignment_role IN ('owner', 'assistant', 'reviewer')),
  assigned_by_user_id INTEGER,
  assigned_by_username TEXT NOT NULL,
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  unassigned_at TEXT,
  metadata_json TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (technician_id) REFERENCES technicians(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_by_user_id) REFERENCES web_users(id) ON DELETE SET NULL
);
```

Uso recomendado:

- asignacion a `installation`: tecnico habitual o responsable principal
- asignacion a `incident`: responsable puntual de una incidencia
- asignacion a `asset`: tecnico referente de un equipo
- asignacion a `zone`: cobertura territorial o por sede

## 4.4 Vinculo entre tecnico y usuario web

Casos soportados:

- tecnico sin login
  - existe en `technicians`
  - `web_user_id = NULL`

- tecnico con login
  - existe en `technicians`
  - se vincula a `web_users.id`
  - su usuario tiene rol `tecnico`

- usuario no tecnico
  - existe en `web_users`
  - no necesita fila en `technicians`

Esto evita forzar que toda cuenta sea un tecnico.

## 5. Reglas de gestion

## 5.1 Quien administra tecnicos

La lista de tecnicos debe ser modificable por:

- `super_admin`
- `admin` del tenant

Opcionalmente, en una segunda fase:

- `supervisor` puede editar disponibilidad o datos no sensibles

Lo que no debe pasar:

- un `admin` de tenant A creando o editando tecnicos de tenant B
- un `tecnico` gestionando usuarios o tecnicos

## 5.2 Quien asigna tecnicos

Permisos sugeridos:

- `super_admin`: si
- `admin`: si
- `supervisor`: si
- `tecnico`: no, salvo autoasignacion controlada en fase futura
- `solo_lectura`: no

## 6. Matriz de permisos inicial

| Accion | super_admin | admin | supervisor | tecnico | solo_lectura |
|---|---|---|---|---|---|
| Ver datos tenant | si | si | si | si | si |
| Crear/editar tecnicos | si | si | no | no | no |
| Desactivar tecnicos | si | si | no | no | no |
| Crear usuarios tenant | si | si | no | no | no |
| Resetear password | si | si | no | no | no |
| Asignar tecnicos | si | si | si | no | no |
| Crear incidencia | si | si | si | si | no |
| Actualizar evidencia | si | si | si | si | no |
| Cerrar conformidad | si | si | si | si | no |
| Ver auditoria tenant | si | si | si | no o parcial | si o parcial |
| Operar en otro tenant | si | no | no | no | no |

Nota operativa:

- el acceso de `tecnico` a auditoria puede limitarse a sus propias acciones o directamente omitirse en v1
- `solo_lectura` puede ver dashboards y listados, pero sin mutaciones

## 7. Tenant membership

## 7.1 Recomendacion para esta etapa

Modelo simple y estable:

- `super_admin` global
- todo otro usuario pertenece a un solo tenant activo

Ventajas:

- simplifica login, UI y soporte
- reduce errores de aislamiento
- evita seleccionar tenant activo en cada sesion

## 7.2 Evolucion posible

Si aparece necesidad comercial real, luego pasar a:

- `web_users` como identidad global
- `tenant_user_roles` como membresia N:N
- selector de tenant activo en sesion

Pero no lo recomendaria como paso inmediato porque aumenta mucho la complejidad operativa.

## 8. Credenciales y secretos

## 8.1 Lo que debe quedar como secreto de plataforma

No debe pertenecer a un tenant ni viajar a clientes:

- `WEB_SESSION_SECRET`
- secretos de firma
- secretos de integracion global del Worker
- credenciales de servicio para push o correo

## 8.2 Lo que puede ser secreto por tenant

Ejemplos:

- SMTP dedicado de un cliente
- API keys de integraciones del cliente
- webhook secrets por tenant
- branding y configuracion sensible de dominios o links

Recomendacion:

- no guardar estos secretos en texto plano en D1
- guardar solo metadata en D1
- cifrar el valor real con una clave maestra del Worker o moverlo a un store seguro externo

Tabla sugerida:

```sql
CREATE TABLE tenant_secrets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  secret_name TEXT NOT NULL,
  secret_ciphertext TEXT NOT NULL,
  secret_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  rotated_at TEXT,
  UNIQUE (tenant_id, secret_name),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
```

## 8.3 Regla de clientes distribuidos

Web y mobile deben seguir con auth web.

No distribuir:

- `API_SECRET`
- `API_TOKEN`
- secretos HMAC globales

Esto ya esta alineado con `docs/auth-modes.md`.

## 9. Aislamiento de datos y storage

## 9.1 D1

Toda query de lectura y escritura debe filtrar por `tenant_id`.

## 9.2 R2

Convencion objetivo:

```text
tenants/{tenant_id}/incidents/{installation_id}/{incident_id}/...
tenants/{tenant_id}/conformities/{installation_id}/...
tenants/{tenant_id}/signatures/{installation_id}/...
```

Esto debe ser consistente con la documentacion ya existente.

## 9.3 Auditoria

Toda accion sensible debe registrar:

- `tenant_id`
- actor
- accion
- entidad
- timestamp
- metadata relevante

## 10. Migracion recomendada

## Fase 1

- crear tabla `technicians`
- crear tabla `technician_assignments`
- exponer CRUD web para tecnicos
- usar catalogo de tecnicos en dashboard para asignacion

## Fase 2

- habilitar rol `tecnico` real en permisos de escritura operativa
- permitir vincular `technicians.web_user_id`
- mostrar nombre tecnico consistente en incidencias y conformidades

## Fase 3

- migrar storage R2 a prefijos `tenants/{tenant_id}/...`
- agregar validaciones de pertenencia tenant en todas las keys recuperadas

## Fase 4

- si hace falta, mover de tenant unico por usuario a membresias N:N reales
- agregar selector de tenant activo en sesion

## 11. Decision recomendada

Para la siguiente iteracion, la recomendacion concreta es:

1. Mantener `super_admin` global.
2. Mantener `admin`, `supervisor`, `tecnico`, `solo_lectura` como roles por tenant.
3. Crear `technicians` como entidad separada de `web_users`.
4. Permitir que `admin` y `super_admin` administren la lista de tecnicos.
5. Permitir que `admin` y `supervisor` asignen tecnicos.
6. Mantener por ahora un solo tenant por usuario no `super_admin`.
7. Endurecer storage para que toda key de R2 lleve prefijo `tenant_id`.

## 12. Impacto esperado

Con este modelo ganamos:

- mejor trazabilidad operativa
- soporte a tecnicos con y sin login
- permisos mas claros para cada actor
- menor riesgo de fuga cross-tenant
- una base mas ordenada para vender la plataforma a multiples empresas
