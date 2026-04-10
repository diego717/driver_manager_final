# 2026-04-08 - alineacion RBAC UI, mapa asignado y `Mis casos`

## Resumen

Se completa una pasada importante de alineacion entre permisos backend y experiencia visible en web/mobile:

- la UI web y mobile ahora esconden acciones y secciones que backend ya no permite por rol
- `tecnico` deja de ver modulos tenant-wide como catalogo de tecnicos, inventario global y mapa global
- `tecnico` conserva sus vistas personales de trabajo: `Mis casos` y mapa asignado
- `Mis casos` deja de depender del catalogo completo de tecnicos para resolver el tecnico vinculado
- el mapa asignado vuelve a mostrar incidencias del tecnico aunque sean antiguas o resueltas, siempre que sigan asignadas y tengan coordenadas

## Areas tocadas

- worker / RBAC
- dashboard web
- mobile app
- documentacion de roles

## Contexto

Despues de formalizar la matriz RBAC en `docs/rbac-matriz-web-mobile.md` y endurecer permisos finos en backend, faltaba cerrar dos cosas:

- reflejar esos limites en la UI para no mostrar tabs, botones o vistas que luego terminaban en `403`
- preservar el flujo real de campo del `tecnico`, especialmente en `Mis casos` y el mapa personal de incidencias asignadas

El primer endurecimiento visual habia dejado una regresion funcional:

- `Mis casos` seguia consultando el catalogo de tecnicos, que ahora esta bloqueado para `tecnico`
- el mapa personal seguia heredando reglas del mapa global, como el filtro temporal inicial y el descarte de incidencias resueltas

## Cambios clave

- se agregan helpers mas finos para UI sobre mapa global, catalogo de activos, catalogo de tecnicos y reapertura de incidencias
- dashboard web oculta o redirige secciones no permitidas segun rol
- `incidentMap` vuelve a estar disponible para `tecnico`, pero solo como mapa personal / asignado
- `Mis casos` primero consulta `/web/me/technician` para obtener el tecnico vinculado del usuario actual
- `Mis casos` conserva fallback al flujo anterior para compatibilidad de tests y despliegues intermedios
- `renderContextualEmptyState` pasa a reemplazar contenido previo para evitar loaders mezclados con estados vacios
- se agrega `GET /web/me/technician`
- `GET /web/me/assigned-incidents-map` expone mas metadatos utiles para pintar el mapa del tecnico:
  - `gps_lat`, `gps_lng`
  - `gps_accuracy_m`
  - `status_updated_at`
  - `resolved_at`
  - `dispatch_required`
- el mapa asignado deja de excluir incidencias `resolved`
- el mapa asignado fuerza por defecto el rango `Todo` en vez de `30d`, para no esconder asignaciones viejas que siguen siendo relevantes
- mobile oculta `Inventario` cuando el rol no puede ver catalogo global y bloquea reapertura visual de incidencias resueltas cuando el rol no tiene ese permiso

## Impacto

- menor friccion entre lo que la UI sugiere y lo que backend realmente permite
- menos errores de “no aparece nada” para `tecnico` en vistas personales
- mejor separacion entre herramientas globales de coordinacion y herramientas personales de campo
- el mapa asignado queda mas alineado con `Mis casos`
- baja el riesgo de confundir ausencia de pines con ausencia real de asignaciones

## Referencias

- `docs/rbac-matriz-web-mobile.md`
- `worker/lib/core.js`
- `worker/routes/incidents.js`
- `worker/routes/technicians.js`
- `worker.js`
- `dashboard.html`
- `dashboard.js`
- `dashboard-auth.js`
- `dashboard-api.js`
- `dashboard-assets.js`
- `dashboard-incidents.js`
- `dashboard-my-cases.js`
- `public/dashboard-auth.js`
- `public/dashboard-api.js`
- `public/dashboard-assets.js`
- `public/dashboard-incidents.js`
- `public/dashboard-my-cases.js`
- `mobile-app/src/auth/roles.ts`
- `mobile-app/src/auth/roles.test.ts`
- `mobile-app/app/(tabs)/_layout.tsx`
- `mobile-app/app/(tabs)/explore.tsx`
- `mobile-app/app/incident/detail.tsx`

## Validacion

- `node --test tests_js/worker/rbac-core.test.mjs`
- `node --test tests_js/worker/routes.test.mjs`
- `node --test tests_js/dashboard.unit.test.mjs`
- `node --check worker.js`
- `node --check worker/routes/incidents.js`
- `node --check worker/routes/technicians.js`
- `node --check dashboard-auth.js`
- `node --check dashboard.js`
- `node --check dashboard-api.js`
- `node --check dashboard-assets.js`
- `node --check dashboard-incidents.js`
- `node --check dashboard-my-cases.js`
- `npm run dashboard:sync-assets`
- `cd mobile-app && npx tsc --noEmit`
- `cd mobile-app && npx vitest run src/auth/roles.test.ts`

## Pendientes

- extender la misma politica visual a mas pantallas mobile relacionadas con activos y registros
- agregar QA manual multirol con cuentas reales (`admin`, `supervisor`, `tecnico`, `solo_lectura`)
- revisar si conviene mostrar un copy mas explicito en web cuando `tecnico` entra al mapa personal sin incidencias con coordenadas
