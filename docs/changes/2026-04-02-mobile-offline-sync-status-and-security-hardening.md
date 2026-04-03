# 2026-04-02 - estado real del mobile offline sync y endurecimiento de persistencia local

## Resumen

Se deja registrado el estado actual del rollout de mobile offline sync y se documenta una pasada de endurecimiento para evitar que PII o metadatos sensibles queden en claro dentro de Watermelon/SQLite.

El resultado practico es mixto:

- el flujo offline-first de creacion de incidencias ya tiene persistencia local, outbox, executor y disparo de sync
- el soporte de fotos y casos sigue parcial o preparado, pero no cerrado end-to-end
- la persistencia local ahora saca de SQLite varios campos sensibles y los mueve a `SecureStore`

## Areas tocadas

- mobile app
- persistencia local
- sync engine
- seguridad local
- documentacion

## Contexto

El repo ya traia base real de offline sync en `mobile-app/src/db/`, `mobile-app/src/services/sync/` y `mobile-app/app/incident/create.tsx`, pero todavia convivian varias señales de rollout incompleto:

- operaciones declaradas en `SyncJob` sin executor real
- repositorios marcados como `stub`
- soporte parcial para fotos y casos
- datos sensibles y metadatos locales todavia persistidos en Watermelon/SQLite

La nota busca dejar claro que "hay offline sync" no equivale todavia a "el rollout offline esta terminado".

## Estado actual

### Completo o bastante avanzado

- `create_incident` tiene outbox real en `mobile-app/src/services/sync/incident-outbox-service.ts`
- el sync engine ejecuta jobs pendientes, respeta dependencias y hace retry con backoff en `mobile-app/src/services/sync/sync-engine.ts`
- el bootstrap del motor y el trigger por app start, resume y red se hacen desde `mobile-app/app/_layout.tsx`
- la pantalla de alta de incidencia ya usa el flujo local-first desde `mobile-app/app/incident/create.tsx`
- el estado de sync se expone a UI con `SyncStatusBanner` y `sync-state-store`

### Parcial o preparado

- `upload_photo` existe como operacion tipada en `mobile-app/src/db/models/SyncJob.ts`, pero no tiene executor registrado
- `create_case` existe como operacion tipada, pero no tiene executor registrado ni flujo funcional equivalente
- `cases_local` existe en schema, migraciones y repositorio, pero sigue siendo una base para una fase posterior
- `photos` tiene tabla y modelo local, pero no aparece un pipeline completo de outbox equivalente al de incidencias

### Todavia faltante para considerar el rollout completo

- executor y encolado real para `upload_photo`
- executor y encolado real para `create_case`
- integracion de dependencias entre jobs de evidencia y fotos
- cierre de flujo manual para casos offline con sync posterior
- validacion funcional end-to-end del circuito completo con conectividad intermitente real

## Cambios clave

- se endurece `SecureStore` para sesiones, preferencias y secretos locales sensibles
- se mueve a storage seguro la PII de incidencias offline: `reporterUsername`, `note` y `gpsCaptureNote`
- se prepara el mismo patron para `cases_local`: `clientName` y `notes`
- se mueve a storage seguro metadata sensible de fotos offline: `localPath` y `fileName`
- se sanitizan errores persistidos para no dejar rutas locales o mensajes excesivos en `last_error` o `last_sync_error`

## Impacto

- baja el riesgo de exponer PII si alguien inspecciona la base Watermelon/SQLite del dispositivo
- baja el riesgo de dejar rutas locales o nombres de archivo sensibles en tablas de sync
- queda mas claro que el modulo offline actual es funcional para incidencias, pero no completo para todo el dominio
- se reduce deuda futura porque `cases_local` y fotos ya no nacen con persistencia sensible en claro

## Referencias

- `mobile-app/app/_layout.tsx`
- `mobile-app/app/incident/create.tsx`
- `mobile-app/src/services/sync/incident-outbox-service.ts`
- `mobile-app/src/services/sync/sync-engine.ts`
- `mobile-app/src/services/sync/sync-runner.ts`
- `mobile-app/src/services/sync/sync-policy.ts`
- `mobile-app/src/services/sync/sync-errors.ts`
- `mobile-app/src/db/index.ts`
- `mobile-app/src/db/schema.ts`
- `mobile-app/src/db/models/Incident.ts`
- `mobile-app/src/db/models/Photo.ts`
- `mobile-app/src/db/models/LocalCase.ts`
- `mobile-app/src/db/models/SyncJob.ts`
- `mobile-app/src/db/repositories/incidents-repository.ts`
- `mobile-app/src/db/repositories/photos-repository.ts`
- `mobile-app/src/db/repositories/cases-repository.ts`
- `mobile-app/src/storage/secure.ts`
- `mobile-app/src/storage/app-preferences.ts`
- `docs/mobile-offline-sync-plan.md`
- `docs/mobile-offline-sync-backlog.md`

## Validacion

- `npm test -- --run src/storage/secure.test.ts src/storage/app-preferences.test.ts src/services/sync/sync-mappers.test.ts src/services/sync/sync-errors.test.ts`
- validacion de lectura del codigo para confirmar bootstrap real de `create_incident`
- validacion de lectura del codigo para confirmar ausencia actual de executors para `upload_photo` y `create_case`

## Riesgos pendientes

- fotos offline todavia no muestran un flujo de sync completo aunque la persistencia local ya esta mejor protegida
- casos offline siguen en etapa de base tecnica y no en rollout funcional completo
- el sistema todavia necesita una pasada end-to-end orientada a "modo avion / reconexion / evidencia / caso manual" para cerrarse como capacidad completa
