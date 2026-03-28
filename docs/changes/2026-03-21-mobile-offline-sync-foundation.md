# 2026-03-21 - base de mobile offline y sync local

## Resumen

Se consolida la direccion offline-first para la app movil, apoyada en persistencia local, outbox y sincronizacion posterior cuando vuelve la conectividad.

## Areas tocadas

- mobile app
- persistencia local
- sync
- contratos API

## Contexto

Segun `docs/mobile-offline-sync-plan.md`, para esta etapa el proyecto ya contaba con piezas locales relevantes:

- WatermelonDB en `mobile-app/src/db/`
- modelos locales de incidencias y fotos
- campos de sync como `is_synced` y `remote_id`
- almacenamiento local de paths de foto

El cambio de direccion importante no es solo tecnico. Marca el paso desde un flujo online-first a una arquitectura preparada para trabajo de campo con conectividad inestable.

## Cambios clave

- se consolida el uso de persistencia local como base operativa
- se ordena el problema alrededor de outbox, reintentos y sincronizacion
- se prepara la app para operar mejor en escenarios con conectividad irregular

## Impacto

- la app movil deja de depender conceptualmente de tener red en el momento exacto de operar
- se habilita una base mas robusta para captura de incidencias, evidencia y fotos
- se vuelve mas clara la separacion entre persistencia local, cola de salida y sincronizacion remota

## Referencias

- `docs/mobile-offline-sync-plan.md`
- `docs/mobile-offline-sync-backlog.md`

## Validacion

- nota retroactiva basada en el plan y en la estructura actual del repo
- no implica que todo el rollout offline estuviera cerrado en esa fecha, sino que la base del track ya existia
