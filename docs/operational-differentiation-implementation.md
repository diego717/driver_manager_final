# Implementación: Diferenciación operativa

Este documento describe cómo implementar los 4 pilares de diferenciación operativa solicitados:

1. Workflow configurable de incidencias + SLA (vencimientos, prioridades, escalado).
2. Android offline-first (crear incidencia/fotos sin red + cola de sync).
3. Web tablero operativo (lista/kanban + filtros por estado, severidad, técnico).
4. Notificaciones push por eventos críticos (asignación, vencimiento SLA, cierre).

> Alcance: guía de implementación técnica por fases, alineada con la arquitectura actual (`worker.js` + D1 + R2 + `mobile-app`).

---

## 0) Estado actual y objetivo

### Estado actual (resumen)

- Incidencias con severidad y fotos ya existen en D1/R2.
- Existe app móvil Expo con APIs para incidencias/fotos.
- Existe dashboard web con vistas tabulares y auth web.
- Ya hay FCM para eventos críticos básicos.

### Objetivo de esta implementación

Pasar de un flujo "registro de incidencias" a un **flujo operativo completo** con:

- Estados configurables por tenant.
- SLA trazable y medible.
- Operación offline robusta en Android.
- Gestión visual en tablero web (lista/kanban).
- Notificaciones push orientadas al ciclo operativo.

---

## 1) Workflow configurable de incidencias + SLA

## 1.1 Modelo de datos sugerido

Agregar migración nueva (ej: `0008_incident_workflow_sla.sql`) con estas tablas:

### `incident_workflows`

Define workflows por tenant.

- `id` PK
- `tenant_id` TEXT NOT NULL
- `name` TEXT NOT NULL
- `is_default` INTEGER (0/1)
- `created_at`, `updated_at`

### `incident_workflow_states`

Estados del workflow (orden y comportamiento).

- `id` PK
- `workflow_id` FK
- `tenant_id` TEXT NOT NULL
- `code` TEXT (`nuevo`, `asignado`, `en_progreso`, `bloqueado`, `resuelto`, `cerrado`)
- `label` TEXT
- `kind` TEXT CHECK (`open`, `in_progress`, `waiting`, `resolved`, `closed`)
- `position` INTEGER
- `is_initial` INTEGER
- `is_terminal` INTEGER
- `sla_pauses` INTEGER (si pausa contador de SLA)

### `incident_workflow_transitions`

Reglas de transición entre estados.

- `id` PK
- `workflow_id` FK
- `tenant_id` TEXT NOT NULL
- `from_state_id` FK
- `to_state_id` FK
- `allowed_roles` TEXT (JSON array)
- `requires_comment` INTEGER
- `requires_assignee` INTEGER

### `incident_sla_policies`

Políticas SLA por severidad/prioridad.

- `id` PK
- `tenant_id` TEXT NOT NULL
- `name` TEXT
- `severity` TEXT (`low|medium|high|critical`)
- `priority` TEXT (`p1|p2|p3|p4`)
- `target_first_response_minutes` INTEGER
- `target_resolution_minutes` INTEGER
- `escalation_after_minutes` INTEGER
- `active` INTEGER

### Alteraciones en `incidents`

Nuevas columnas:

- `workflow_id` INTEGER
- `state_id` INTEGER
- `priority` TEXT DEFAULT `p3`
- `assigned_user_id` INTEGER NULL
- `sla_policy_id` INTEGER NULL
- `sla_first_response_due_at` TEXT NULL
- `sla_resolution_due_at` TEXT NULL
- `first_response_at` TEXT NULL
- `resolved_at` TEXT NULL
- `closed_at` TEXT NULL
- `escalated_at` TEXT NULL

### `incident_state_history`

Bitácora de cambios de estado.

- `id` PK
- `tenant_id` TEXT NOT NULL
- `incident_id` FK
- `from_state_id` FK
- `to_state_id` FK
- `changed_by_user_id` FK
- `comment` TEXT
- `changed_at` TEXT

## 1.2 API (Worker) a implementar

Nuevos endpoints web/api:

- `GET /web/workflows`
- `POST /web/workflows`
- `GET /web/workflows/:id/states`
- `POST /web/workflows/:id/transitions`
- `GET /web/sla-policies`
- `POST /web/sla-policies`
- `PATCH /web/installations/:id/incidents/:incidentId/state`
- `PATCH /web/installations/:id/incidents/:incidentId/assign`

Comportamiento clave:

1. Al crear incidencia:
   - asignar workflow default del tenant.
   - colocar `state_id` inicial.
   - calcular vencimientos SLA según severidad/prioridad.
2. Al cambiar estado:
   - validar transición permitida por rol.
   - registrar en `incident_state_history`.
   - disparar eventos de notificación.
3. Job de vencimientos:
   - detectar incidencias vencidas/no resueltas.
   - marcar escalado y notificar.

## 1.3 Reglas operativas mínimas

- `critical` ⇒ `priority = p1` por defecto.
- Si pasa `target_first_response_minutes` sin `first_response_at`: flag `first_response_breached`.
- Si pasa `target_resolution_minutes` sin `resolved_at`: flag `resolution_breached`.
- Escalado automático a `supervisor/admin` si supera `escalation_after_minutes`.

## 1.4 Métricas SLA

KPIs iniciales por tenant:

- `% first response en SLA`
- `% resolución en SLA`
- `MTTA` (mean time to acknowledge)
- `MTTR` (mean time to resolve)
- abiertos/vencidos por severidad y técnico

---

## 2) Android offline-first (incidencia + fotos + cola sync)

## 2.1 Principios

- **Source of truth local** en SQLite (ya existe en `mobile-app/src/db`).
- Toda acción crea operación local primero (optimistic UI).
- Un sincronizador en background sube operaciones pendientes cuando hay red.

## 2.2 Modelo local recomendado

Extender DB móvil con:

### `sync_queue`

- `id` TEXT PK (uuid)
- `tenant_id` TEXT
- `entity_type` (`incident`, `photo`, `incident_state_change`)
- `entity_local_id` TEXT
- `operation` (`create`, `update`, `upload`)
- `payload_json` TEXT
- `status` (`pending`, `in_progress`, `failed`, `done`)
- `attempt_count` INTEGER
- `last_error` TEXT
- `next_retry_at` INTEGER (epoch ms)
- `created_at`, `updated_at`

### Incidencias locales

Agregar campos de sync:

- `local_id` TEXT
- `server_id` INTEGER NULL
- `sync_status` (`local_only`, `synced`, `conflict`, `failed`)
- `last_synced_at`

### Fotos locales

- referencia a archivo local (`file://...`)
- `server_photo_id` nullable
- `upload_status`
- checksum opcional

## 2.3 Flujo offline

1. Usuario crea incidencia sin red.
2. Se guarda en SQLite local con `sync_status=local_only`.
3. Se inserta operación en `sync_queue`.
4. Si agrega fotos, cada foto crea su operación `upload` ligada a incidencia local.
5. Sync worker procesa cola por orden:
   - crea incidencia (obtiene `server_id`).
   - mapea ids locales→servidor.
   - sube fotos.
6. Si falla, reintento con exponential backoff + jitter.

## 2.4 Resolución de conflictos

Estrategia inicial simple:

- `create`: idempotencia por `client_generated_id` enviado al backend.
- `update`: `last-write-wins` con marca temporal + auditoría.
- Si backend responde conflicto estructural, marcar `sync_status=conflict` y pedir acción manual en UI.

## 2.5 Requerimientos UX

- Badge de conectividad: `Online/Offline`.
- Indicador de cola pendiente (`N por sincronizar`).
- Vista “Errores de sincronización” con botón reintentar.
- Permitir operar sin red en create + adjuntar fotos.

---

## 3) Web tablero operativo (lista + kanban)

## 3.1 Vistas

### Lista operativa

Columnas mínimas:

- ID incidencia
- Cliente/instalación
- Estado
- Severidad
- Prioridad
- Técnico asignado
- Vencimiento SLA
- Tiempo restante / vencido

### Kanban operativo

- Columnas por estado workflow (`Nuevo`, `Asignado`, `En progreso`, ...).
- Tarjetas con severidad, prioridad, técnico y timers SLA.
- Drag & drop para transición (si rol lo permite).

## 3.2 Filtros requeridos

- Estado
- Severidad
- Técnico asignado
- Rango fecha creación
- Vencidas SLA (sí/no)
- Texto libre (cliente, nota, ID)

## 3.3 API de soporte

- `GET /web/incidents?view=list|kanban&state=&severity=&assignee=&sla_breached=`
- `GET /web/incidents/kanban` (agrupado por estado)
- `PATCH /web/incidents/:id/state`
- `PATCH /web/incidents/:id/assign`

## 3.4 Consideraciones de performance

- Índices D1 por `tenant_id + state_id + severity + assigned_user_id + created_at`.
- Paginación cursor-based en lista.
- En Kanban: limitar payload inicial y lazy-load de columnas extensas.

---

## 4) Push por eventos críticos

## 4.1 Eventos a notificar

1. **Asignación** de incidencia a técnico.
2. **Vencimiento SLA inminente** (ej. faltan 15 min).
3. **SLA vencido** (escalado).
4. **Cierre/Resolución** de incidencia.

## 4.2 Matriz de destinatarios inicial

- Asignación: técnico asignado + supervisor.
- SLA inminente/vencido: técnico asignado + supervisor + admin.
- Cierre: creador (si aplica) + supervisor.

## 4.3 Implementación técnica

- Reusar `device_tokens` y FCM HTTP v1.
- Agregar preferencias de notificación por usuario/tenant (opcional fase 2).
- Incluir payload con:
  - `event_type`
  - `incident_id`
  - `tenant_id`
  - `state`
  - `deep_link` (pantalla detalle)

## 4.4 Jobs/Timers

Necesario proceso periódico para SLA:

- Cron Worker cada X minutos:
  - buscar incidencias por vencer y vencidas.
  - evitar duplicados con marcas (`sla_warning_sent_at`, `sla_breach_sent_at`).

---

## 5) Plan por fases (entregable)

## Fase 1 (base de operación)

- Migración workflow/SLA (`0008`).
- API básica de estados/assign.
- Lista web con filtros.
- Android queue simple (create incidente + fotos).

## Fase 2 (madurez operativa)

- Kanban con drag&drop y validación de transiciones.
- Escalado SLA automático + push de vencimiento.
- Métricas SLA en dashboard.

## Fase 3 (escala y hardening)

- Preferencias de notificación por usuario.
- Conflictos offline avanzados.
- Optimización de consultas y archivado histórico.

---

## 6) Criterios de aceptación (DoD)

1. Se puede crear incidencia y fotos sin red en Android y sincronizar luego.
2. Cada incidencia tiene estado workflow válido y due dates SLA calculados.
3. Web permite operar incidencias en lista y kanban con filtros solicitados.
4. Cambios críticos generan push al público correcto.
5. Auditoría registra transiciones y acciones clave por tenant.

---

## 7) Riesgos y mitigaciones

- **Riesgo:** complejidad de sync offline + fotos.
  - **Mitigación:** empezar con operaciones idempotentes y cola secuencial.
- **Riesgo:** ruido de push (fatiga de notificaciones).
  - **Mitigación:** deduplicación + preferencias por usuario.
- **Riesgo:** degradación de performance en tablero.
  - **Mitigación:** índices compuestos + paginación + endpoints agregados por vista.

---

## 8) Recomendación inmediata (siguiente sprint)

Para avanzar rápido y con menor riesgo:

1. Implementar `0008_incident_workflow_sla.sql`.
2. Habilitar `PATCH state/assign` en Worker con auditoría.
3. Crear `sync_queue` en mobile + sincronización de create incidencia/foto.
4. Publicar lista web operativa con filtros (dejar Kanban para iteración siguiente).
5. Encender push de asignación y cierre (SLA warnings en sprint posterior).

Con esto tienes una primera versión claramente diferenciada y vendible en operación real.
