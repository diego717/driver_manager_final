# 2026-03-26 - rollout tecnico de GPS y geofence

> Nota historica: al 2 de abril de 2026, geofence fue retirado del flujo activo del producto. Esta nota describe el rollout original y no el estado vigente.

## Resumen

Se consolida el track de GPS tagging y geofencing en dashboard, Worker, D1 y PDF de conformidad, quedando la mayor parte del trabajo tecnico implementado y pendiente principalmente de rollout operativo por tenant.

## Areas tocadas

- dashboard web
- worker
- migraciones D1
- conformidades
- auditoria y observabilidad

## Contexto

Segun `docs/gps-tagging-geofencing-implementation-plan.md`, para esta etapa el repo ya reflejaba:

- migraciones `0017_geolocation_capture.sql`, `0018_geofencing_soft.sql` y `0019_geofence_hard_overrides.sql`
- captura puntual GPS en dashboard/PWA
- envio de payload `gps` en registros manuales, incidencias y conformidad
- validacion server-side en Worker
- persistencia de GPS en `installations` e `incidents`
- snapshot GPS/geofence en conformidades y PDF final
- geofence soft y hard con override auditado
- observabilidad GPS/geofence en estadisticas y auditoria

## Cambios clave

- se incorpora captura GPS puntual en flujos operativos sensibles
- se persiste contexto GPS/geofence en registros, incidencias y conformidades
- se agrega observabilidad y trazabilidad para endurecimiento posterior por tenant

## Impacto

- el sistema gana prueba de presencia puntual y trazabilidad operativa
- conformidades y auditoria pasan a incluir mejor contexto geografico
- se prepara una politica de endurecimiento por tenant sin obligar activacion inmediata en todos los entornos

## Referencias

- `docs/gps-tagging-geofencing-implementation-plan.md`
- `docs/gps-geofence-runbook.md`

## Validacion

- nota retroactiva basada en la documentacion y el estado funcional descrito en el repo
- el cierre operativo seguia dependiendo de migraciones aplicadas, smoke manual y politica por tenant
