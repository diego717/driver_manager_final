# 2026-04-02 - incident evidence offline con outbox para checklist y nota

## Resumen

Se completa otro bloque del mobile offline sync: el `checklist` y la `nota operativa` de evidencia ya no dependen de un `PATCH` directo al backend al momento de guardar, sino que tambien entran a un outbox local `update_incident_evidence`.

## Areas tocadas

- mobile app
- sync engine
- evidencia de incidencias
- seguridad local

## Contexto

Despues de cerrar `upload_photo` con outbox, quedaba un hueco funcional importante: las fotos si podian quedar pendientes para sincronizar despues, pero la metadata de evidencia seguia siendo best-effort y online-first.

Eso implicaba que una incidencia podia terminar con fotos en cola y sin checklist o nota sincronizados de forma consistente.

## Cambios clave

- se agrega un nuevo outbox `update_incident_evidence`
- el payload sensible de evidencia se persiste en `SecureStore` en vez de Watermelon/SQLite
- se implementa executor para enviar `checklist_items` y `evidence_note` a la API cuando el job corre
- el bootstrap general del sync registra tambien este executor
- `app/incident/upload` ahora encola la metadata de evidencia en vez de hacer `PATCH` directo como unica via

## Impacto

- el flujo de evidencia queda mas alineado con offline-first
- fotos y metadata de evidencia ya no viven en dos modelos distintos de confiabilidad
- se reduce perdida de contexto cuando el tecnico guarda evidencia con conectividad inestable
- la nota operativa no queda persistida en claro dentro de Watermelon/SQLite

## Referencias

- `mobile-app/app/incident/upload.tsx`
- `mobile-app/app/_layout.tsx`
- `mobile-app/src/services/sync/incident-evidence-outbox-service.ts`
- `mobile-app/src/services/sync/incident-evidence-outbox-service.test.ts`
- `mobile-app/src/storage/secure.ts`
- `mobile-app/src/storage/secure.test.ts`

## Validacion

- `npm test -- --run src/services/sync/incident-evidence-outbox-service.test.ts src/services/sync/photo-outbox-service.test.ts src/storage/secure.test.ts src/services/sync/sync-errors.test.ts`
- `mobile-app\\node_modules\\.bin\\tsc.cmd -p tsconfig.json --noEmit`

## Pendientes

- `create_case` sigue pendiente como flujo offline completo
- falta resolver una ruta end-to-end para evidencia cuando la incidencia base tambien es local y aun no tiene `remoteId`
- conviene agregar pruebas de integracion que cubran reconexion real con fotos + metadata en cola
