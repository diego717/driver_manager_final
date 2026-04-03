# 2026-04-02 - photo upload offline con outbox y executor

## Resumen

Se cierra una parte importante del rollout de mobile offline sync: las fotos de evidencia ya no dependen de subir directo a la API en el momento exacto, sino que pueden entrar a un outbox local `upload_photo` y sincronizarse despues.

## Areas tocadas

- mobile app
- persistencia local
- sync engine
- evidencia y fotos

## Contexto

Hasta esta pasada, el flujo de `app/incident/upload` seguia intentando subir cada foto directamente al backend. Eso dejaba un hueco claro frente al resto del modelo offline-first:

- `create_incident` si tenia outbox y executor
- `upload_photo` existia como operacion tipada, pero sin pipeline real

## Cambios clave

- se agrega soporte de schema para asociar una foto pendiente con una incidencia remota o con una incidencia local ya encolada
- se crea `photo-outbox-service` con:
  - encolado de `upload_photo`
  - executor para procesar el job
  - registro del executor en bootstrap
- `app/incident/upload` deja de depender de subir fotos directamente y ahora encola evidencia local para sync posterior
- el bootstrap general del sync en `app/_layout.tsx` ahora registra tambien el executor de fotos
- se mantiene la proteccion de metadatos sensibles de foto fuera de Watermelon/SQLite

## Impacto

- la carga de evidencia queda alineada con el enfoque offline-first del resto del modulo
- una foto puede quedar guardada localmente y sincronizarse despues cuando vuelva conectividad
- se reduce perdida operativa por intentos de carga en campo con red inestable
- el sistema ya tiene una base mejor para dependencias entre `create_incident` y `upload_photo`

## Referencias

- `mobile-app/app/incident/upload.tsx`
- `mobile-app/app/_layout.tsx`
- `mobile-app/src/services/sync/photo-outbox-service.ts`
- `mobile-app/src/services/sync/photo-outbox-service.test.ts`
- `mobile-app/src/db/models/Photo.ts`
- `mobile-app/src/db/models/Incident.ts`
- `mobile-app/src/db/repositories/photos-repository.ts`
- `mobile-app/src/db/schema.ts`
- `mobile-app/src/db/index.ts`

## Validacion

- `npm test -- --run src/services/sync/photo-outbox-service.test.ts src/services/sync/sync-errors.test.ts src/storage/secure.test.ts src/services/sync/sync-mappers.test.ts`
- `mobile-app\\node_modules\\.bin\\tsc.cmd -p tsconfig.json --noEmit`

## Pendientes

- el checklist y la nota de evidencia siguen siendo best-effort contra API y todavia no tienen outbox dedicado
- `create_case` sigue pendiente como flujo offline completo
- queda una pasada futura para validar dependencias reales entre foto pendiente e incidencia local pendiente en escenarios manuales end-to-end
