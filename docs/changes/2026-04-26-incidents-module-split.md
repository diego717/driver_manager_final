# 2026-04-26 - refactor de incidencias: separacion de modulos mapa/comercial

## Resumen

- se separa `dashboard-incidents.js` en modulos dedicados para reducir acoplamiento
- se incorporan `dashboard-incidents-map.js` y `dashboard-incidents-commercial.js` como bundles independientes
- se actualiza el pipeline de sync de assets para versionar y publicar los nuevos archivos
- se ajusta el service worker para precachear los nuevos scripts

## Areas tocadas

- dashboard web (carga de scripts y runtime de incidencias)
- assets publicados (`public/*`)
- build/sync de frontend (`scripts/sync-dashboard-assets.mjs`)
- tests de embed/helpers del dashboard

## Contexto

`dashboard-incidents.js` concentraba logica de mapa, comercial y flujo general en un solo archivo grande, lo que hacia mas dificil mantener y evolucionar el modulo sin regresiones.

## Cambios clave

- `dashboard.html` y `public/dashboard.html`
  - se agregan scripts `dashboard-incidents-map.js` y `dashboard-incidents-commercial.js` antes de `dashboard-incidents.js`
- `dashboard-incidents.js` y `public/dashboard-incidents.js`
  - se elimina logica extraida y queda como orquestador principal del flujo de incidencias
- nuevos modulos
  - `dashboard-incidents-map.js` + `public/dashboard-incidents-map.js`
  - `dashboard-incidents-commercial.js` + `public/dashboard-incidents-commercial.js`
- sync y versionado de assets
  - `scripts/sync-dashboard-assets.mjs` incorpora nuevas fuentes, hashes y reemplazos en HTML/SW
  - `public/sw.js` suma ambos scripts a `STATIC_ASSETS` y `STATIC_ASSET_PATHS`
- ajuste menor de robustez UI
  - en `dashboard.js` se endurece la validacion del boton limpiar filtros (`tagName === 'BUTTON'`)

## Impacto

- mantenibilidad: menor complejidad en el archivo principal de incidencias
- release: el build de `public/` queda alineado con el nuevo split
- operacion: sin cambios funcionales mayores esperados para usuario final

## Referencias

- `dashboard-incidents.js`
- `dashboard-incidents-map.js`
- `dashboard-incidents-commercial.js`
- `dashboard.html`
- `dashboard.js`
- `scripts/sync-dashboard-assets.mjs`
- `public/dashboard-incidents.js`
- `public/dashboard-incidents-map.js`
- `public/dashboard-incidents-commercial.js`
- `public/dashboard.html`
- `public/sw.js`
- `tests_js/dashboard.embed.test.mjs`
- `tests_js/helpers/dashboard.test-helpers.mjs`

## Validacion

- se actualizaron tests de embed/helpers para contemplar los nuevos archivos inyectados
- no se detectaron cambios de contrato HTTP en este refactor
