# Backlog de implementacion: mobile offline sync

Este backlog traduce [mobile-offline-sync-plan.md](/g:/dev/driver_manager/docs/mobile-offline-sync-plan.md) a un orden de ejecucion concreto.

La idea no es listar tareas genericas. Cada bloque busca dejar un corte funcional verificable.

---

## 0) Orden recomendado

Orden de implementacion:

1. Contrato backend de idempotencia.
2. Fundaciones locales de sync.
3. Incidencias offline sobre casos ya existentes.
4. Evidencia y fotos offline.
5. Caso manual offline.
6. Triggers, observabilidad y hardening.

No conviene empezar por:

- background tasks
- caso manual offline
- conflictos avanzados

Primero hay que estabilizar el camino mas frecuente: incidencia + evidencia.

---

## 1) Epic: contrato backend de idempotencia

### Objetivo

Evitar duplicados cuando el cliente reintenta operaciones locales pendientes.

### Tareas

- [ ] Definir `client_request_id` como campo aceptado para creacion de casos.
- [ ] Definir `client_request_id` como campo aceptado para creacion de incidencias.
- [ ] Definir `client_request_id` para actualizacion de evidencia.
- [ ] Definir dedupe de fotos por `client_request_id` y `sha256`.
- [ ] Documentar comportamiento esperado cuando llega el mismo request dos veces.
- [ ] Normalizar errores de API para distinguir:
  - validacion
  - auth
  - conflicto/idempotencia
  - error transitorio

### Archivos probables

- [worker.js](/g:/dev/driver_manager/worker.js)
- [incidents-v1.openapi.yaml](/g:/dev/driver_manager/docs/incidents-v1.openapi.yaml)
- tests del Worker

### Criterio de cierre

- El backend puede recibir retries sin crear duplicados.
- El contrato queda documentado y testeado.

---

## 2) Epic: fundaciones locales de sync

### Objetivo

Agregar la infraestructura local minima para una outbox real.

### Tareas de schema

- [ ] Extender tabla `incidents` con identidad local y metadata de sync.
- [ ] Extender tabla `photos` con metadata de sync.
- [ ] Agregar tabla `sync_jobs`.
- [ ] Preparar migracion para `cases_local`, aunque se use despues.

### Tareas de modelos

- [ ] Actualizar [Incident.ts](/g:/dev/driver_manager/mobile-app/src/db/models/Incident.ts).
- [ ] Actualizar [Photo.ts](/g:/dev/driver_manager/mobile-app/src/db/models/Photo.ts).
- [ ] Crear modelo `SyncJob`.
- [ ] Crear modelo `LocalCase` o dejarlo preparado para fase 3.

### Tareas de repositorios

- [ ] Crear `incidents-repository.ts`.
- [ ] Crear `photos-repository.ts`.
- [ ] Crear `sync-jobs-repository.ts`.
- [ ] Crear `cases-repository.ts` o stub inicial.

### Tareas de servicios

- [ ] Crear `sync-engine.ts`.
- [ ] Crear `sync-policy.ts`.
- [ ] Crear `sync-errors.ts`.
- [ ] Crear `sync-mappers.ts`.
- [ ] Crear `sync-state-store.ts`.

### Archivos probables

- [schema.ts](/g:/dev/driver_manager/mobile-app/src/db/schema.ts)
- [index.ts](/g:/dev/driver_manager/mobile-app/src/db/index.ts)
- `mobile-app/src/db/models/*`
- `mobile-app/src/db/repositories/*`
- `mobile-app/src/services/sync/*`

### Criterio de cierre

- Existe cola local persistente.
- Se pueden crear y leer jobs pendientes.
- Hay una base clara para retries y dependencias.

---

## 3) Epic: incidencias offline

### Objetivo

Permitir crear incidencias sin red dentro de casos ya conocidos.

### Tareas de dominio

- [ ] Definir DTO local de incidencia pendiente.
- [ ] Asociar incidencia local a `installationId` remoto conocido.
- [ ] Guardar `client_request_id` por incidencia.
- [ ] Definir estados `pending`, `syncing`, `failed`, `synced`.

### Tareas de flujo

- [ ] Cambiar [create.tsx](/g:/dev/driver_manager/mobile-app/app/incident/create.tsx) para guardar local primero.
- [ ] Encolar job `create_incident`.
- [ ] Navegar al siguiente paso aunque no haya red.
- [ ] Si hay red, disparar `flush` inmediato no bloqueante.

### Tareas de sync

- [ ] Implementar executor `create_incident`.
- [ ] Persistir `remote_incident_id` cuando sincroniza.
- [ ] Actualizar estado local de la incidencia.
- [ ] Guardar ultimo error de sync cuando falle.

### Tareas de UI

- [ ] Mostrar feedback online/offline claro al crear.
- [ ] Mostrar badge de sync en detalle de incidencia.
- [ ] Exponer un contador minimo de pendientes en home o work tab.

### Archivos probables

- [create.tsx](/g:/dev/driver_manager/mobile-app/app/incident/create.tsx)
- [work.tsx](/g:/dev/driver_manager/mobile-app/app/(tabs)/work.tsx)
- [index.tsx](/g:/dev/driver_manager/mobile-app/app/(tabs)/index.tsx)
- `mobile-app/src/services/sync/incident-outbox-service.ts`

### Criterio de cierre

- Se puede crear incidencia sin red.
- La incidencia queda en el dispositivo.
- Al recuperar conectividad, sincroniza sin duplicarse.

---

## 4) Epic: evidencia y fotos offline

### Objetivo

Permitir que la evidencia no dependa de subir en el momento.

### Tareas de metadata

- [ ] Persistir checklist local.
- [ ] Persistir nota de evidencia local.
- [ ] Encolar job `update_incident_evidence`.

### Tareas de fotos

- [ ] Persistir foto confirmada con `local_path`.
- [ ] Calcular o guardar `sha256`.
- [ ] Encolar job `upload_photo`.
- [ ] Asociar foto a incidencia local aunque aun no exista ID remoto.

### Tareas de sync

- [ ] Implementar executor `update_incident_evidence`.
- [ ] Implementar executor `upload_photo`.
- [ ] Resolver dependencia: no subir foto sin `remote_incident_id`.
- [ ] Tratar error terminal si falta archivo local.

### Tareas de UI

- [ ] Ajustar [upload.tsx](/g:/dev/driver_manager/mobile-app/app/incident/upload.tsx) para no depender del upload inmediato.
- [ ] Mostrar estado por foto:
  - pendiente
  - sincronizando
  - error
  - sincronizada
- [ ] Agregar accion `Reintentar`.

### Archivos probables

- [upload.tsx](/g:/dev/driver_manager/mobile-app/app/incident/upload.tsx)
- [photos.ts](/g:/dev/driver_manager/mobile-app/src/api/photos.ts)
- `mobile-app/src/services/sync/photo-outbox-service.ts`
- `mobile-app/src/services/sync/evidence-outbox-service.ts`

### Criterio de cierre

- Se pueden confirmar fotos sin red.
- La metadata y fotos quedan en cola.
- La app las sincroniza despues sin perderlas.

---

## 5) Epic: caso manual offline

### Objetivo

Permitir iniciar trabajo sin equipo ni red.

### Tareas de modelo

- [ ] Crear tabla `cases_local`.
- [ ] Crear modelo `LocalCase`.
- [ ] Agregar relacion logica entre `case_local_id` e incidencia local.

### Tareas de flujo

- [ ] Cambiar [manual.tsx](/g:/dev/driver_manager/mobile-app/app/case/manual.tsx) para guardar local primero.
- [ ] Si hay incidencia inicial, crearla local tambien.
- [ ] Encolar jobs con dependencia:
  - `create_case`
  - `create_incident`

### Tareas de sync

- [ ] Implementar executor `create_case`.
- [ ] Guardar mapeo `case_local_id -> remote_id`.
- [ ] Resolver dependencias antes de `create_incident`.

### Tareas de UI

- [ ] Mostrar que el caso fue guardado localmente.
- [ ] Permitir retomar luego el caso pendiente.
- [ ] Mostrar estado del caso en backlog o home.

### Archivos probables

- [manual.tsx](/g:/dev/driver_manager/mobile-app/app/case/manual.tsx)
- `mobile-app/src/db/models/LocalCase.ts`
- `mobile-app/src/services/sync/case-outbox-service.ts`

### Criterio de cierre

- Se puede iniciar caso manual offline.
- Se puede crear incidencia inicial ligada a ese caso.
- Al sincronizar, se respeta el orden correcto.

---

## 6) Epic: triggers de sincronizacion

### Objetivo

Hacer que la cola se procese de forma natural sin depender de que el usuario entre a una pantalla exacta.

### Tareas

- [ ] Agregar trigger al iniciar app.
- [ ] Agregar trigger al volver al foreground.
- [ ] Agregar trigger al recuperar red.
- [ ] Agregar accion manual `Sincronizar ahora`.
- [ ] Agregar `expo-background-task` como apoyo.

### Nota

No prometer que el background corre siempre de inmediato. En iOS y Android eso no esta garantizado.

### Archivos probables

- [app/_layout.tsx](/g:/dev/driver_manager/mobile-app/app/_layout.tsx)
- nuevos hooks o servicios de sync
- config Expo si se incorpora background task

### Criterio de cierre

- El sync intenta correr en momentos naturales del uso.
- El usuario siempre tiene una accion manual de retry.

---

## 7) Epic: observabilidad y UX de sync

### Objetivo

Que el usuario entienda el estado del trabajo pendiente y que soporte tecnico tenga trazabilidad local.

### Tareas

- [ ] Mostrar contador global de pendientes.
- [ ] Mostrar errores visibles de sync.
- [ ] Crear vista o panel de "Sincronizacion".
- [ ] Mostrar fecha/hora de ultimo intento.
- [ ] Agregar logs locales minimos del sync engine.

### Tareas de metricas sugeridas

- [ ] `sync_job_created`
- [ ] `sync_job_started`
- [ ] `sync_job_succeeded`
- [ ] `sync_job_failed`
- [ ] `sync_retry_scheduled`

### Criterio de cierre

- El usuario sabe que quedo pendiente.
- Se puede diagnosticar por que no sincronizo.

---

## 8) Epic: hardening y casos limite

### Objetivo

Cerrar los problemas que aparecen despues del flujo feliz.

### Tareas

- [ ] Manejar sesion expirada durante sync.
- [ ] Manejar archivo local inexistente.
- [ ] Manejar payload invalido no reintentable.
- [ ] Manejar red intermitente sin duplicar jobs.
- [ ] Evitar que una foto trabada bloquee toda la cola.
- [ ] Agregar backoff con jitter.

### Criterio de cierre

- La cola no se rompe con un solo error.
- Los fallos quedan aislados y visibles.

---

## 9) Testing por fase

## Fase fundacional

- [ ] tests de schema/migracion local
- [ ] tests de repositorios
- [ ] tests de `sync-policy`

## Incidencias offline

- [ ] test: crear incidencia offline genera job pendiente
- [ ] test: flush exitoso marca synced
- [ ] test: retry no duplica incidencia

## Evidencia y fotos

- [ ] test: foto local queda en cola
- [ ] test: foto espera a que exista incidencia remota
- [ ] test: error terminal por archivo faltante

## Caso manual offline

- [ ] test: caso local se crea y encola job
- [ ] test: incidencia depende del caso remoto

## Integracion/UI

- [ ] test del flujo `create -> pending -> synced`
- [ ] test del flujo `upload evidence offline`
- [ ] test de badge o contador de pendientes

---

## 10) Corte recomendado por sprint

### Sprint 1

- contrato backend de idempotencia
- schema local
- `sync_jobs`
- servicios base de sync

### Sprint 2

- incidencias offline
- feedback UI minimo
- flush al volver la red o foreground

### Sprint 3

- evidencia offline
- fotos offline
- reintentos por foto

### Sprint 4

- caso manual offline
- panel de sync
- hardening

---

## 11) Definicion de listo por fase

### Fase 1 lista si

- la infraestructura local existe
- hay jobs persistentes
- el engine puede ejecutar una operacion simple

### Fase 2 lista si

- una incidencia puede vivir localmente y luego sincronizar

### Fase 3 lista si

- evidencia y fotos no dependen de red inmediata

### Fase 4 lista si

- un caso manual puede empezar y cerrarse mas tarde contra backend

---

## 12) Secuencia de implementacion inmediata

Si hubiera que arrancar ya, el orden exacto seria:

1. cerrar backend de idempotencia
2. extender [schema.ts](/g:/dev/driver_manager/mobile-app/src/db/schema.ts)
3. crear `SyncJob`
4. crear `sync-engine.ts`
5. migrar [create.tsx](/g:/dev/driver_manager/mobile-app/app/incident/create.tsx)
6. migrar [upload.tsx](/g:/dev/driver_manager/mobile-app/app/incident/upload.tsx)
7. migrar [manual.tsx](/g:/dev/driver_manager/mobile-app/app/case/manual.tsx)
8. sumar triggers y panel de sync

Ese es el camino con menor riesgo y mayor retorno operativo.
