# 2026-03-26 - expansion funcional de assets y prestamos

## Resumen

El proyecto deja de girar solo alrededor de instalaciones e incidencias y gana una capa operativa para activos, vinculacion con instalaciones y prestamos entre clientes o sedes.

## Areas tocadas

- dashboard web
- worker
- mobile
- dominio operativo

## Contexto

El estado del repo y del `README.md` ya muestra para esta etapa:

- seccion `assets` en dashboard
- endpoints dedicados para assets
- flujos de vinculacion asset-instalacion
- consultas de incidencias por asset
- soporte de prestamos y devoluciones
- presencia de migraciones `0008_assets_registry.sql`, `0009_assets_brand_and_metadata.sql`, `0020_asset_loans.sql` y `0021_asset_loan_reminders.sql`

## Cambios clave

- los equipos pasan a modelarse como entidad propia dentro del sistema
- se habilitan acciones operativas sobre el activo: alta, consulta, baja logica, vinculacion y generacion QR
- se incorpora el flujo de prestamos, devoluciones y seguimiento de vencimientos
- se amplian las vistas y acciones del dashboard para trabajar desde contexto de activo y no solo de instalacion
- mobile empieza a consumir y reutilizar contexto de assets en casos, incidencias y QR

## Impacto

- mejora la trazabilidad del parque instalado
- se vuelve mas facil operar incidencias y conformidades con referencia de equipo concreto
- el sistema gana capacidad para escenarios de prestamo temporal y redistribucion de hardware

## Referencias

- `README.md`
- `dashboard-assets.js`
- `worker/routes/`
- migraciones `0008`, `0009`, `0020`, `0021`

## Validacion

- nota retroactiva basada en el estado del repo y en artefactos ya presentes
- marca una expansion funcional relevante del dominio, aunque sus mejoras posteriores hayan seguido en iteraciones posteriores
