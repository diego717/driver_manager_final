# 2026-04-03 - destino operativo, mapa mobile y cola offline por tecnico

## Resumen

Se cierra un corte funcional importante para despacho operativo en mobile y web:

- las incidencias ahora pueden guardar un destino operativo explicito con `target_*` y `dispatch_*`
- web puede cargar y editar ese destino
- mobile puede verlo en detalle, abrir navegacion externa y recibir push por asignacion
- la app suma una pestaÃ±a `Mapa` para incidencias asignadas
- la cola de `Trabajo`, el mapa y el detalle ya tienen fallback offline util con indicadores visibles de snapshot local

## Areas tocadas

- backend Worker
- dashboard web
- mobile app
- persistencia offline
- notificaciones push
- documentacion

## Contexto

El diseÃ±o base estaba documentado en `docs/mobile-incident-map-dispatch-design.md`, pero el repo venia con piezas sueltas:

- asignaciones de tecnicos ya existentes
- push notifications ya montadas
- detalle de incidencia en mobile
- mapa web apoyado en `gps_capture_*`

Faltaba convertir eso en un flujo operativo concreto para despacho: definir destino de visita, disparar push por asignacion, mostrarlo en mobile, sumar mapa operativo y asegurar continuidad con red inestable.

## Cambios clave

- se agrega migracion de `incidents` con campos `target_*` y `dispatch_*`
- se extiende el read model y contrato API de incidencias para exponer esos datos
- se implementa `PATCH /web/incidents/:id/dispatch-target` con validacion y auditoria
- dashboard web puede cargar y editar `Destino operativo` en incidencias nuevas y existentes
- el mapa web ahora permite fijar y mover `target_lat` y `target_lng` con click directo sobre el mapa
- el mapa web prioriza `target_*` sobre `gps_*` para representar el pin operativo real cuando ya existe despacho manual
- se agrega `dispatch_required` para marcar incidencias que no requieren visita en sitio y colapsar el bloque de despacho en web y mobile
- alta de asignacion sobre `incident` dispara push al tecnico vinculado con deep link al detalle
- mobile detalle muestra el bloque `Destino operativo` y CTA para Google Maps y Waze
- se agrega `GET /web/me/assigned-incidents-map` para simplificar la cola operativa mobile
- mobile incorpora la pestaÃ±a `Mapa` con incidencias asignadas, filtros simples y card accionable
- se persiste offline la ultima cola de mapa en `assigned_incidents_map_cache`
- la lista y el detalle de incidencias guardan snapshots locales para fallback offline
- se endurece persistencia local moviendo notas sensibles a storage seguro
- se agrega `technician_assignments_cache` y storage seguro del tecnico vinculado para que `Trabajo` recomponga la cola offline sin depender de nuevas llamadas remotas
- `Trabajo` y `Detalle incidencia` muestran seÃ±ales explicitas cuando la UI usa snapshot local

## Impacto

- el operador web puede dejar un destino mas util que una coordenada cruda
- el tecnico recibe la asignacion con apertura directa a la incidencia correcta
- mobile gana una vista de mapa realmente orientada a despacho
- la cola de trabajo sigue siendo util sin red si hubo una sincronizacion previa
- baja el riesgo operativo en campo cuando la conectividad es intermitente

## Referencias

- `docs/mobile-incident-map-dispatch-design.md`
- `docs/mobile-incident-map-dispatch-checklist.md`
- `docs/mobile-offline-sync-qa-checklist.md`
- `migrations/0023_incident_dispatch_target.sql`
- `migrations/0024_incident_dispatch_required.sql`
- `worker/routes/incidents.js`
- `worker/routes/technicians.js`
- `worker/services/incidents.js`
- `worker/lib/core.js`
- `worker.js`
- `dashboard-api.js`
- `dashboard-incidents.js`
- `public/dashboard-api.js`
- `public/dashboard-incidents.js`
- `mobile-app/app/(tabs)/map.tsx`
- `mobile-app/app/(tabs)/work.tsx`
- `mobile-app/app/incident/detail.tsx`
- `mobile-app/src/api/incidents.ts`
- `mobile-app/src/api/technicians.ts`
- `mobile-app/src/db/schema.ts`
- `mobile-app/src/db/index.ts`
- `mobile-app/src/db/models/AssignedIncidentMapCache.ts`
- `mobile-app/src/db/models/TechnicianAssignmentCache.ts`
- `mobile-app/src/db/repositories/assigned-incidents-map-repository.ts`
- `mobile-app/src/db/repositories/incidents-repository.ts`
- `mobile-app/src/db/repositories/technician-assignments-cache-repository.ts`
- `mobile-app/src/storage/secure.ts`

## Validacion

- `node --test tests_js/worker/incidents.service.test.mjs`
- `node --test --test-name-pattern "dispatch-target|incident service loads incidents scoped by tenant and installation" tests_js/worker.contract.test.mjs`
- `node --test tests_js/worker/routes.test.mjs`
- `node --check worker.js`
- `node --check worker/routes/technicians.js`
- `node --check dashboard-api.js`
- `node --check dashboard-incidents.js`
- `node --check public/dashboard-api.js`
- `node --check public/dashboard-incidents.js`
- `node .\\node_modules\\vitest\\vitest.mjs run src\\api\\incidents.test.ts src\\api\\technicians.test.ts src\\storage\\secure.test.ts src\\services\\sync\\sync-mappers.test.ts`
- `node .\\node_modules\\typescript\\bin\\tsc -p tsconfig.json --noEmit`

## Pendientes

- cobertura UI automatizada adicional para web y mobile en los flujos nuevos
- validacion QA manual de los casos offline nuevos en `Trabajo`, `Mapa` y `Detalle incidencia`
