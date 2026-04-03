# Checklist de implementacion - Mobile Incident Map Dispatch

Fecha de inicio: 2026-04-03
Documento base: `docs/mobile-incident-map-dispatch-design.md`

## Objetivo

Usar este documento como checklist vivo para implementar la funcionalidad de destino operativo, asignacion y soporte de mapa mobile.

Convencion de estados:

- `[x]` implementado
- `[~]` parcialmente implementado o ya existe base reutilizable
- `[ ]` pendiente

## Estado actual relevado en el repo

### Ya existe base reutilizable

- `[x]` infraestructura de `device_tokens` en backend
- `[x]` infraestructura de envio push en backend
- `[x]` tabla y rutas de `technician_assignments`
- `[x]` hook mobile `useNotifications`
- `[x]` pantalla mobile de detalle de incidencia
- `[x]` pantalla mobile de trabajo con incidencias asignadas
- `[x]` mapa web de incidencias basado hoy en `gps_capture_*`
- `[x]` dependencia `react-native-maps` instalada en mobile

### Gap principal detectado

- `[x]` campos `target_*` en `incidents`
- `[x]` campos `dispatch_*` en `incidents`
- `[x]` contrato API para `target_*` y `dispatch_*`
- `[x]` endpoint `PATCH /incidents/:id/dispatch-target`
- `[x]` push por asignacion de incidencia a tecnico
- `[x]` deep link desde push a incidencia asignada
- `[x]` bloque `Destino operativo` en web
- `[x]` bloque `Destino operativo` en mobile detalle
- `[x]` pestaña `Mapa` en mobile

## Fase 1 recomendada

### Backend

- `[x]` crear migracion para agregar a `incidents`:
  - `target_lat`
  - `target_lng`
  - `target_label`
  - `target_source`
  - `target_updated_at`
  - `target_updated_by`
  - `dispatch_place_name`
  - `dispatch_address`
  - `dispatch_reference`
  - `dispatch_contact_name`
  - `dispatch_contact_phone`
  - `dispatch_notes`
- `[x]` mantener nuevos campos como opcionales
- `[x]` exponer nuevos campos en lecturas de incidencias
- `[x]` extender `mapIncidentRow` para serializar `target_*` y `dispatch_*`
- `[ ]` aceptar nuevos campos en create/update si aplica
- `[x]` implementar `PATCH /incidents/:id/dispatch-target`
- `[x]` validar `target_source` contra valores permitidos
- `[x]` registrar `target_updated_at`
- `[x]` registrar `target_updated_by`
- `[x]` agregar auditoria para cambios de destino operativo

### Asignacion y push

- `[x]` detectar alta real de asignacion sobre entidad `incident`
- `[x]` obtener tokens vigentes del tecnico asignado
- `[x]` enviar push con payload de incidencia asignada
- `[x]` evitar duplicados cuando se regraba la misma asignacion
- `[x]` definir `deep_link` de apertura a detalle mobile

### Web

- `[x]` agregar bloque `Destino operativo` en crear incidencia
- `[x]` agregar bloque `Destino operativo` en editar incidencia
- `[x]` agregar campos legibles:
  - `Nombre del lugar`
  - `Direccion`
  - `Referencia`
  - `Contacto`
  - `Telefono`
  - `Notas`
- `[x]` agregar selector de origen:
  - `Punto en mapa`
  - `GPS del reporte`
  - `Contexto del equipo/registro`
  - `Sin destino operativo`
- `[x]` mostrar estado visible cuando falta informacion de visita
- `[x]` diferenciar visualmente `gps_capture_*` vs `target_*`

### Mobile

- `[x]` extender tipos API para `target_*` y `dispatch_*`
- `[x]` mapear esos campos en `src/api/incidents.ts`
- `[x]` decidir persistencia offline de esos campos
- `[x]` extender Watermelon schema/model si se guardan offline
- `[x]` mostrar bloque `Destino operativo` en detalle de incidencia
- `[x]` mostrar indicador visible cuando el detalle usa snapshot offline
- `[x]` priorizar en UI:
  - `dispatch_place_name`
  - `dispatch_address`
  - `dispatch_reference`
  - contacto
- `[x]` agregar CTA `Abrir en Google Maps`
- `[x]` agregar CTA `Abrir en Waze` si aplica
- `[~]` ampliar procesamiento de notificaciones para `incident_id` y `deep_link`
- `[x]` abrir detalle desde push

### QA

- `[ ]` test backend de contrato para nuevos campos
- `[ ]` test backend de `PATCH /incidents/:id/dispatch-target`
- `[x]` test backend de push por asignacion
- `[ ]` test web create/edit con destino operativo
- `[ ]` test mobile render con y sin `dispatch_*`
- `[ ]` test mobile apertura desde push
- `[ ]` test mobile CTA de navegacion externa

## Fase 2 recomendada

### Mobile mapa

- `[x]` agregar pestaña `Mapa`
- `[x]` instalar y configurar `react-native-maps`
- `[x]` mostrar posicion actual del tecnico
- `[x]` mostrar incidencias asignadas con `target_lat` y `target_lng`
- `[x]` agregar filtros simples por estado y prioridad
- `[x]` mostrar card con destino, direccion, referencia y distancia
- `[x]` agregar CTA `Ver incidencia`
- `[x]` agregar CTA `Ir`
- `[x]` persistir offline la cola asignada para `work`
- `[x]` mostrar indicador visible cuando `work` usa snapshot offline

### Backend de soporte

- `[x]` evaluar reutilizar endpoints actuales para mapa
- `[x]` si no alcanza, crear `GET /me/assigned-incidents-map`
- `[x]` devolver solo incidencias activas asignadas al tecnico autenticado

## Fase 3 recomendada

- `[x]` permitir fijar `target_lat` y `target_lng` clickeando mapa web
- `[x]` mostrar preview del destino operativo junto al pin
- `[x]` agregar toggle explicito para indicar si la incidencia requiere visita en sitio
- `[ ]` mejorar filtros por tecnico y prioridad en web

## Decisiones pendientes

- `[ ]` definir si una incidencia puede tener multiples tecnicos activos
- `[ ]` definir si alguna categoria exigira destino operativo obligatorio
- `[ ]` definir si mobile mostrara solo asignadas propias o tambien del equipo
- `[ ]` definir si se agrega estado `en camino`
- `[ ]` definir si el mapa mobile sale en la primera entrega o en segunda

## Corte sugerido para primera entrega util

- `[x]` backend con `target_*` y `dispatch_*`
- `[x]` web para editar destino operativo manualmente
- `[x]` push por asignacion a tecnico
- `[x]` mobile mostrando destino operativo en detalle
- `[x]` mobile abriendo detalle desde push
- `[x]` CTA de navegacion externa

## Log de avance

### 2026-04-03

- `[x]` se creo este checklist inicial
- `[x]` se relevo el estado actual del repo para distinguir base existente vs faltantes reales
- `[x]` se definio Fase 1 como primer corte sugerido
- `[x]` se agrego migracion backend `0023_incident_dispatch_target.sql`
- `[x]` se extendio el read model de incidencias para exponer `target_*` y `dispatch_*`
- `[x]` se implemento `PATCH /web/incidents/:id/dispatch-target`
- `[x]` se agrego bloque `Destino operativo` al modal web de crear incidencia
- `[x]` se agrego accion web para editar `Destino operativo` sobre incidencias existentes
- `[x]` se mostro resumen visible del destino operativo en cards de incidencias
- `[x]` mobile ahora lee `target_*` y `dispatch_*` desde API
- `[x]` se agrego bloque `Destino operativo` al detalle mobile
- `[x]` se agregaron CTA de navegacion externa en mobile
- `[x]` asignaciones nuevas de incidencias ahora envian push al tecnico vinculado
- `[x]` se evita duplicar la misma asignacion activa para tecnico + incidencia + rol
- `[x]` la push de asignacion incluye `path`, `incident_id` e `installation_id` para abrir el detalle mobile
- `[x]` se creo `GET /me/assigned-incidents-map` para simplificar la vista mobile
- `[x]` mobile ahora tiene pestaña `Mapa` con pins, filtros y card operativa
- `[x]` se instalo `react-native-maps` y la vista muestra `Ver incidencia` e `Ir`
- `[x]` el mapa mobile ahora usa cache offline local para conservar la ultima cola sincronizada
- `[x]` se agrego tabla local `assigned_incidents_map_cache` para persistir `target_*` y `dispatch_*` operativos
- `[x]` la lista mobile de incidencias ahora cachea snapshots remotos en Watermelon para fallback offline
- `[x]` el detalle mobile de incidencia ahora puede abrir ultimo snapshot local si falla la red
- `[x]` se agrego tabla local `technician_assignments_cache` para persistir asignaciones activas por tecnico
- `[x]` `work` ahora recompone la cola offline usando cache de mapa, cache de asignaciones y tecnico vinculado persistido
- `[x]` `work` y `incident/detail` ahora muestran indicador explicito cuando estan usando snapshot local
- `[x]` el mapa web ahora permite fijar o mover `target_lat` y `target_lng` haciendo click directo sobre el mapa
- `[x]` el mapa web ahora prioriza `target_*` sobre `gps_*` para mostrar el pin operativo actual
- `[x]` web y mobile ahora permiten marcar incidencias que no requieren visita en sitio y ocultan el bloque de despacho cuando aplica
