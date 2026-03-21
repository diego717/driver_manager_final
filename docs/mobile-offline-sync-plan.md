# Plan de implementacion: mobile offline sync engine

Este documento aterriza la implementacion de un modo offline-first real para `mobile-app/`, con cola local de operaciones, reintentos y sincronizacion automatica cuando vuelve la conectividad.

No define OCR, IA ni mejoras de captura. El foco es permitir operacion estable en campo cuando no hay senal.

> Alcance: app movil Expo (`mobile-app/`), API/Worker (`worker.js`) y persistencia D1/R2 para incidencias, evidencia y fotos.

---

## 0) Objetivo

Permitir que el tecnico pueda:

- crear incidencias sin conexion
- capturar evidencia y fotos sin conexion
- iniciar un caso manual sin conexion en una segunda etapa
- cerrar la app y reabrirla sin perder trabajo pendiente
- sincronizar automaticamente al volver la red o al retomar la app

El objetivo no es "background magico". El objetivo es que la operacion no dependa de tener red en el momento exacto de la accion.

---

## 1) Estado actual

### Base ya existente

La app ya tiene piezas utiles para este frente:

- WatermelonDB en `mobile-app/src/db/`
- modelo local de `incidents`
- modelo local de `photos`
- campos `is_synced` y `remote_id`
- almacenamiento local de paths de foto

Archivos relevantes:

- `mobile-app/src/db/index.ts`
- `mobile-app/src/db/schema.ts`
- `mobile-app/src/db/models/Incident.ts`
- `mobile-app/src/db/models/Photo.ts`

### Limitaciones actuales

Hoy el flujo real sigue siendo online-first:

- `app/incident/create.tsx` llama directo a API
- `app/incident/upload.tsx` intenta subir metadata y fotos en el acto
- `app/case/manual.tsx` crea caso e incidencia directo contra API
- `src/api/incidents.ts` y `src/api/photos.ts` asumen conectividad disponible

Problema principal:

- existe persistencia local parcial
- no existe outbox real
- no existe mapeo local -> remoto
- no existe engine de sync con dependencias

---

## 2) Principios de implementacion

- Local-first: la app guarda primero en dispositivo.
- Outbox explicita: no alcanza con `is_synced`.
- Idempotencia obligatoria: los retries no deben duplicar datos.
- Sync por etapas: primero incidencia, despues evidencia, despues fotos.
- UX clara: el usuario debe ver que esta pendiente, que fallo y que ya sincronizo.
- Background como refuerzo: no como unica garantia.

---

## 3) Alcance por fases

### Fase 1: incidencias offline sobre casos remotos ya existentes

Permitir:

- crear incidencia sin red dentro de un caso conocido
- verla en la app como pendiente
- sincronizar luego

No incluye:

- crear caso manual offline
- vincular equipos offline

### Fase 2: evidencia y fotos offline

Permitir:

- guardar checklist y nota de evidencia sin red
- capturar y confirmar fotos sin red
- encolar uploads de fotos

### Fase 3: caso manual offline

Permitir:

- iniciar trabajo sin equipo ni red
- encolar creacion del caso
- opcionalmente encolar la primera incidencia ligada a ese caso local

### Fuera de alcance inicial

- resolucion avanzada de conflictos
- merge bidireccional complejo
- sync multi-dispositivo del mismo borrador
- assets/equipos creados offline
- OCR o barcode como parte del sync engine

---

## 4) Arquitectura objetivo

## 4.1 Componentes

### 1. Base local

WatermelonDB mantiene:

- entidades locales de dominio
- metadatos de sincronizacion
- cola de jobs

### 2. Outbox

Tabla explicita `sync_jobs` para modelar:

- que hay que sincronizar
- en que orden
- que depende de que
- cuantos intentos van
- cual fue el ultimo error

### 3. Sync engine

Servicio que:

- lee jobs elegibles
- ejecuta uno por vez
- persiste resultados
- resuelve IDs remotos
- aplica backoff en fallos

### 4. Sync triggers

Disparadores recomendados:

- app startup
- app resume
- red recuperada
- accion manual "Sincronizar ahora"
- background task best-effort

### 5. UI de estado

La app debe exponer:

- estado online/offline
- cantidad de pendientes
- detalle de errores
- accion de reintento

---

## 5) Modelo de datos recomendado

## 5.1 Incidents

La tabla actual `incidents` debe evolucionar para soportar identidad local y remota.

Campos nuevos sugeridos:

- `local_id` TEXT
- `remote_incident_id` INTEGER NULL
- `remote_installation_id` INTEGER NULL
- `sync_status` TEXT
- `sync_attempts` INTEGER
- `last_sync_error` TEXT NULL
- `client_request_id` TEXT

Estados sugeridos para `sync_status`:

- `pending`
- `syncing`
- `failed`
- `synced`

## 5.2 Photos

La tabla actual `photos` ya guarda `local_path`, pero necesita metadata de cola mas rica.

Campos nuevos sugeridos:

- `local_id` TEXT
- `remote_photo_id` INTEGER NULL
- `sync_status` TEXT
- `sync_attempts` INTEGER
- `last_sync_error` TEXT NULL
- `client_request_id` TEXT

Se mantiene:

- `local_path`
- `file_name`
- `content_type`
- `size_bytes`
- `sha256`

## 5.3 Cases local

Para la fase 3 hace falta una nueva tabla local para casos manuales offline.

Tabla sugerida: `cases_local`

Campos:

- `local_id` TEXT
- `remote_id` INTEGER NULL
- `client_name` TEXT
- `notes` TEXT
- `status` TEXT
- `driver_brand` TEXT
- `driver_version` TEXT
- `driver_description` TEXT
- `os_info` TEXT
- `installation_time_seconds` INTEGER
- `sync_status` TEXT
- `sync_attempts` INTEGER
- `last_sync_error` TEXT NULL
- `client_request_id` TEXT
- `created_at`
- `updated_at`

## 5.4 Sync jobs

Tabla nueva: `sync_jobs`

Campos sugeridos:

- `id` TEXT PK
- `entity_type` TEXT
- `entity_local_id` TEXT
- `operation` TEXT
- `depends_on_job_id` TEXT NULL
- `status` TEXT
- `attempt_count` INTEGER
- `next_retry_at` INTEGER
- `last_error` TEXT NULL
- `priority` INTEGER
- `created_at`
- `updated_at`

Valores de `entity_type`:

- `case`
- `incident`
- `incident_evidence`
- `photo`
- `asset_link`

Valores de `status`:

- `pending`
- `syncing`
- `failed`
- `synced`

---

## 6) Orden de sincronizacion

La sincronizacion debe respetar dependencias funcionales.

Orden base:

1. crear caso remoto
2. crear incidencia remota
3. actualizar evidencia de incidencia
4. subir fotos
5. vincular equipo si aplica

Regla clave:

- una foto no se sube hasta que la incidencia local tenga `remote_incident_id`

---

## 7) Fase 1: incidencias offline

## 7.1 Objetivo

Permitir crear una incidencia sin red dentro de un caso remoto existente.

## 7.2 Archivos a tocar

- `mobile-app/src/db/schema.ts`
- `mobile-app/src/db/models/Incident.ts`
- `mobile-app/src/db/index.ts`
- `mobile-app/app/incident/create.tsx`
- `mobile-app/src/api/incidents.ts`
- nuevos archivos en `mobile-app/src/services/sync/`
- nuevos archivos en `mobile-app/src/db/models/`

## 7.3 Trabajo

1. Extender schema local para `incidents` y `sync_jobs`.
2. Crear repositorio local para incidencias pendientes.
3. Crear servicio `incident-outbox-service`.
4. Crear `sync-engine.ts`.
5. Cambiar `app/incident/create.tsx` para:
   - guardar local primero
   - encolar `create_incident`
   - navegar aunque no haya red
6. Si hay red al momento de guardar:
   - se puede disparar un `flush` inmediato
   - pero la fuente de verdad sigue siendo la cola local

## 7.4 Comportamiento UX

Mensajes esperados:

- online: "Incidencia creada y sincronizada."
- offline: "Incidencia guardada en el dispositivo. Pendiente de sincronizar."
- error de sync posterior: "La incidencia sigue guardada localmente, pero fallo la sincronizacion."

## 7.5 Criterio de cierre

- se puede crear incidencia sin red
- la incidencia queda persistida localmente
- al volver la conectividad, la incidencia se sincroniza
- retries no generan duplicados

---

## 8) Fase 2: evidencia y fotos offline

## 8.1 Objetivo

Permitir capturar y confirmar evidencia sin conectividad, con uploads diferidos.

## 8.2 Archivos a tocar

- `mobile-app/src/db/schema.ts`
- `mobile-app/src/db/models/Photo.ts`
- `mobile-app/app/incident/upload.tsx`
- `mobile-app/src/api/photos.ts`
- nuevos servicios en `mobile-app/src/services/sync/`

## 8.3 Trabajo

1. Extender schema de `photos`.
2. Persistir metadata de evidencia localmente.
3. Persistir fotos confirmadas localmente con `local_path`.
4. Encolar jobs:
   - `update_incident_evidence`
   - `upload_photo`
5. Hacer que `upload.tsx` deje de depender del upload inmediato.
6. Resolver mapping local -> remoto antes de intentar cada foto.

## 8.4 Reglas de sincronizacion

- si la incidencia no tiene ID remoto, la foto no se procesa
- si una foto falla, no debe bloquear para siempre el resto de la cola
- si un upload devuelve error transitorio, aplicar retry con backoff
- si un archivo local no existe, marcar error terminal visible en UI

## 8.5 Criterio de cierre

- se pueden capturar fotos sin red
- no se pierden al cerrar/reabrir la app
- las fotos terminan subidas a traves de la API actual y persistidas en R2

---

## 9) Fase 3: caso manual offline

## 9.1 Objetivo

Permitir iniciar trabajo sin equipo y sin red.

## 9.2 Archivos a tocar

- `mobile-app/src/db/schema.ts`
- nuevo modelo `LocalCase`
- `mobile-app/app/case/manual.tsx`
- nuevos servicios `case-outbox-service.ts`

## 9.3 Trabajo

1. Crear tabla `cases_local`.
2. Cambiar `app/case/manual.tsx` para:
   - guardar caso local primero
   - opcionalmente crear incidencia local ligada al `case_local_id`
   - encolar jobs con dependencia
3. Resolver mapeo:
   - `case_local_id -> remote_id`
   - luego `incident.local_id -> remote_incident_id`

## 9.4 Dependencias

Esta fase depende de tener resuelta la infraestructura de:

- `sync_jobs`
- `sync_engine`
- retries idempotentes

## 9.5 Criterio de cierre

- se puede iniciar caso manual offline
- se puede retomar el flujo luego
- el caso remoto se crea antes que la incidencia remota

---

## 10) Servicios y carpetas sugeridas

Estructura sugerida:

```text
mobile-app/src/services/sync/
  sync-engine.ts
  sync-runner.ts
  sync-policy.ts
  sync-errors.ts
  sync-state-store.ts
  incident-outbox-service.ts
  photo-outbox-service.ts
  evidence-outbox-service.ts
  case-outbox-service.ts
  sync-mappers.ts
```

Y repositorios:

```text
mobile-app/src/db/repositories/
  incidents-repository.ts
  photos-repository.ts
  cases-repository.ts
  sync-jobs-repository.ts
```

---

## 11) Disparadores de sincronizacion

No conviene depender de un solo mecanismo.

Disparadores recomendados:

1. `app startup`
2. `app resume`
3. `network regained`
4. boton manual `Sincronizar ahora`
5. `expo-background-task` como apoyo

### Nota sobre background

No prometer:

- sincronizacion instantanea siempre al volver la red

Si prometer:

- la app intentara sincronizar automaticamente cuando haya red y el sistema lo permita
- el usuario siempre podra lanzar un reintento manual

---

## 12) Requisitos de backend obligatorios

Sin esto, el sync engine movil queda fragil.

## 12.1 Idempotencia

La API/Worker debe aceptar `client_request_id` en:

- `POST /records`
- `POST /installations/:id/incidents`
- `PATCH /incidents/:id/evidence`
- upload de fotos

Comportamiento esperado:

- si llega el mismo `client_request_id` por retry, no se duplican entidades
- la API devuelve el mismo resultado logico o resuelve el duplicado

## 12.2 Dedupe de fotos

Para fotos conviene usar:

- `client_request_id`
- `sha256`

Objetivo:

- evitar duplicados por timeout, retry o reenvio

## 12.3 Errores normalizados

La API debe distinguir claramente:

- error transitorio
- error de validacion
- error de autenticacion
- conflicto/idempotencia

Esto simplifica politica de retry en mobile.

---

## 13) Politica de retry

Recomendacion inicial:

- retry secuencial
- exponential backoff
- jitter
- limite maximo de intentos para errores no autorizados

Ejemplo:

- intento 1: inmediato
- intento 2: 30 s
- intento 3: 2 min
- intento 4: 10 min
- intento 5+: 30 min

Errores que no deben reintentarse indefinidamente:

- payload invalido
- sesion ausente o expirada sin posibilidad de renovar
- archivo local faltante

---

## 14) UX y estados visibles

La app debe mostrar estados simples y consistentes:

- `Guardado en el dispositivo`
- `Pendiente de sincronizar`
- `Sincronizando`
- `Sincronizado`
- `Error de sincronizacion`

Puntos de UI recomendados:

- Home: contador de pendientes
- detalle de caso/incidencia: badge de sync
- upload/evidencia: estado por foto
- pantalla o panel de "Sincronizacion"

Acciones visibles:

- `Sincronizar ahora`
- `Reintentar fallidos`
- `Ver pendientes`

---

## 15) Riesgos principales

### 1. Duplicados por retries

Riesgo:

- crear el mismo caso o incidencia mas de una vez

Mitigacion:

- `client_request_id`
- dedupe server-side

### 2. Jobs bloqueados por dependencias

Riesgo:

- fotos que quedan trabadas porque nunca se resolvio la incidencia remota

Mitigacion:

- dependencias explicitas
- trazabilidad por job
- mensajes visibles en UI

### 3. Falsa promesa de background

Riesgo:

- esperar que iOS/Android sincronicen siempre solos al instante

Mitigacion:

- usar background task solo como apoyo
- mantener triggers por foreground y red

### 4. Archivos locales corruptos o faltantes

Riesgo:

- evidencia imposible de subir mas tarde

Mitigacion:

- validacion al confirmar foto
- error terminal visible
- opcion de reemplazar evidencia

---

## 16) Plan de PRs sugerido

### PR 1

`mobile-sync-outbox-foundation`

- migracion de schema
- tabla `sync_jobs`
- servicios base de sync

### PR 2

`mobile-offline-incidents`

- incidencia local-first
- UI de pendiente/sincronizado

### PR 3

`mobile-offline-evidence-and-photos`

- metadata de evidencia local
- fotos en cola

### PR 4

`mobile-offline-manual-cases`

- casos manuales offline
- dependencias caso -> incidencia

### PR 5

`mobile-sync-observability-and-background`

- contadores
- pantalla de sync
- network resume triggers
- background task best-effort

---

## 17) Checklist de aceptacion

- [ ] Se puede crear incidencia sin red sobre un caso ya conocido.
- [ ] Se puede capturar evidencia y fotos sin red.
- [ ] Cerrar y reabrir la app no pierde trabajo pendiente.
- [ ] La app muestra claramente que esta pendiente y que sincronizo.
- [ ] Los retries no duplican casos, incidencias ni fotos.
- [ ] Existe accion manual de reintento.
- [ ] El backend acepta idempotencia por `client_request_id`.
- [ ] El flujo de fotos termina en R2 a traves de la API actual.

---

## 18) Recomendacion de implementacion

El orden correcto para bajar riesgo es:

1. cerrar contrato backend de idempotencia
2. agregar `sync_jobs`
3. migrar `Nueva incidencia`
4. migrar `Evidencia/Fotos`
5. migrar `Caso manual`
6. sumar UI de sync
7. agregar background task como capa extra

No conviene arrancar por background ni por caso manual. Primero hay que hacer solido el camino mas frecuente: incidencia + evidencia.
