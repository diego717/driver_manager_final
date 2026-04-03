# 2026-04-02 - case creation offline con outbox y encadenamiento basico a incidencias

## Resumen

Se agrega soporte real de offline sync para `create_case` en mobile y se introduce un encadenamiento basico para que una incidencia local pueda depender de un caso local pendiente.

## Areas tocadas

- mobile app
- sync engine
- casos manuales
- incidencias offline
- persistencia local

## Contexto

Despues de cerrar `upload_photo` y `update_incident_evidence`, seguia pendiente una pieza estructural del offsync: la apertura de casos manuales.

Sin eso, el tecnico podia guardar incidencias y evidencia offline solo cuando ya existia un caso remoto, pero no podia cerrar el ciclo completo cuando el trabajo empezaba desde un caso nuevo creado en campo.

## Cambios clave

- se agrega `case-outbox-service` con:
  - encolado de `create_case`
  - executor para crear el caso remoto al volver conectividad
  - registro del executor en bootstrap
- `case/manual` ahora usa el outbox cuando no hay conectividad
- `case/context` tambien puede encolar un caso nuevo desde un asset cuando no hay conectividad
- se extiende el modelo de incidencias para poder referenciar `local_case_local_id`
- el executor de `create_incident` ahora puede resolver el `remoteInstallationId` desde un caso local ya sincronizado

## Impacto

- el flujo offline ya no depende totalmente de que exista un caso remoto previo
- se puede abrir un caso manual sin conectividad y dejarlo listo para sync posterior
- una incidencia local puede quedar enlazada a un caso local pendiente para ser creada despues

## Referencias

- `mobile-app/app/case/manual.tsx`
- `mobile-app/app/case/context.tsx`
- `mobile-app/app/_layout.tsx`
- `mobile-app/src/services/sync/case-outbox-service.ts`
- `mobile-app/src/services/sync/case-outbox-service.test.ts`
- `mobile-app/src/services/sync/incident-outbox-service.ts`
- `mobile-app/src/services/sync/incident-outbox-service.test.ts`
- `mobile-app/src/db/repositories/cases-repository.ts`
- `mobile-app/src/db/repositories/incidents-repository.ts`
- `mobile-app/src/db/models/Incident.ts`
- `mobile-app/src/db/schema.ts`
- `mobile-app/src/db/index.ts`

## Validacion

- `npm test -- --run src/services/sync/case-outbox-service.test.ts src/services/sync/incident-outbox-service.test.ts src/services/sync/incident-evidence-outbox-service.test.ts src/services/sync/photo-outbox-service.test.ts src/storage/secure.test.ts`
- `mobile-app\\node_modules\\.bin\\tsc.cmd -p tsconfig.json --noEmit`

## Pendientes

- la navegacion UX despues de crear caso+incidencia offline todavia es mas simple que el flujo online
- falta una pasada de integracion end-to-end para validar flush real de `create_case -> create_incident -> update_incident_evidence -> upload_photo`
- sigue siendo recomendable una capa de observabilidad/diagnostico para jobs encadenados en campo
