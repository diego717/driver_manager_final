# 2026-04-20 - hardening RBAC tecnico en incidencias y tracking

## Resumen

- se cierra el gap entre matriz RBAC y enforcement real para `tecnico` en rutas de incidencias
- se alinea permiso de gestion de tracking publico en backend, dashboard y mobile
- se restringe `POST /assets/resolve` al permiso de edicion de catalogo de activos
- se documenta la pasada visual en dashboard y tracking publico (layout, estados, tema y mobile viewport)
- se agrega hotfix responsive para evitar desborde visual de acciones en incidencias con ventanas muy angostas
- se ajustan tests para reflejar el nuevo scope SQL y evitar falsos negativos

## Areas tocadas

- worker (rutas de incidencias, tracking y assets)
- dashboard web (RBAC + refactor visual de incidencias, Visual Lab y controles de tema)
- estilos de tracking publico (`public-tracking.css` y `public/public-tracking.css`)
- mobile app (guardas de permisos de tracking)
- tests js del worker

## Contexto

La matriz en `docs/rbac-matriz-web-mobile.md` ya definia limites finos por rol, pero quedaban rutas donde `tecnico` podia consultar o mutar incidencias fuera de su alcance operativo. Tambien habia una desalineacion en tracking publico: el backend usaba un guard de admin mientras la matriz define un permiso mas especifico de gestion de tracking.

## Cambios clave

- incidencias (`worker/routes/incidents.js`)
  - se agregan helpers para detectar sesion web de tecnico y resolver `technician_id` vinculado al usuario
  - se aplica scope de tecnico en:
    - `GET /web/incidents/:id`
    - `GET /web/installations/:id/incidents`
    - `POST /web/installations/:id/incidents`
    - `PATCH /web/incidents/:id/evidence`
    - `PATCH /web/incidents/:id/dispatch-target`
    - `PATCH /web/incidents/:id/status`
    - `POST /web/incidents/:id/photos`
    - `GET /web/photos/:id`
  - `handleIncidentDetailRoute` ahora acepta contexto opcional de ruta web y sesion para poder validar alcance antes de exponer detalle
- wiring del worker (`worker.js`)
  - se pasa contexto `isWebRoute` y `webSession` a `handleIncidentDetailRoute`
  - `createPublicTrackingRouteHandlers` pasa a recibir `requirePublicTrackingManagerRole`
  - `POST /web/assets/resolve` pasa de `requireWebWriteRole` a `requireAssetCatalogEditRole`
- tracking publico (`worker/routes/public-tracking.js`)
  - se reemplaza guard de admin por guard especifico de gestion de tracking
- dashboard (`dashboard-incidents.js`, `public/dashboard-incidents.js`)
  - se normaliza copy de error de permisos para gestion de links publicos
  - se agrega CTA visible para abrir el enlace de tracking (`public-tracking-link`) cuando existe URL activa
  - se reestructura la tarjeta de incidencia con:
    - franja de estado/severidad (`incident-status-strip`) y timestamp
    - grilla secundaria (`incident-secondary-grid`) para despacho, evidencia, resolucion y asignaciones
    - acciones separadas por grupo (`estado` vs `utilidad`) para lectura mas clara
  - se mejora bloque de acciones de cabecera de incidencias con grupos tonales y helper contextual para conformidad
  - se ajusta paleta de severidad en mapa de incidencias para mayor contraste operativo (critical/high/medium/low)
- visual dashboard general (`dashboard.html`, `dashboard.css`, `dashboard.js` + `public/*`)
  - Visual Lab pasa a variante `Amber Ops Console` con layout de consola operativa
  - se agregan botones directos de tema `claro/oscuro` con estado activo sincronizado (`data-theme-value`)
  - los toasts usan iconografia Material Symbols por tipo (`success`, `error`, `warning`, `info`)
  - se agrega soporte mobile para teclado virtual y viewport (`body.keyboard-open`) para evitar solapes en formularios y paneles
  - hotfix responsive en header de incidencias:
    - columnas de acciones con `minmax(min(220px, 100%), 1fr)` para no exceder el ancho disponible
    - stack forzado del header de incidencias en anchos intermedios (`max-width: 1200px`)
    - wrapping defensivo de textos y botones para eliminar desbordes laterales
- visual tracking publico (`public-tracking.css`, `public/public-tracking.css`)
  - se migra a direccion tipografica mono (`JetBrains Mono`) y paleta ambar/ocr para continuidad con dashboard
  - se mejoran badges de estado/conexion y timeline con fondos y bordes por tono semantico
  - header de tracking pasa a grilla responsive con controles mas estables en desktop y mobile
- mobile (`mobile-app/app/(tabs)/work.tsx`)
  - se carga rol de sesion web para decisiones de UI
  - creacion/revocacion/carga de links de tracking quedan bloqueadas para roles sin permiso
  - los CTA de tracking solo se muestran si el rol puede gestionar tracking
- tests
  - `tests_js/worker/routes.test.mjs`: asserts de SQL ajustados para variantes con alias
  - `tests_js/worker.contract.test.mjs`: mock DB actualizado para query de incidencias por instalacion con alias y scope de tecnico

## Impacto

- seguridad: baja riesgo de acceso o mutacion de incidencias fuera del alcance de `tecnico`
- consistencia: UI y backend quedan alineados con la matriz RBAC en tracking y activos
- operacion: menos `403` inesperados y menos acciones visibles que luego fallan por permisos

## Referencias

- `docs/rbac-matriz-web-mobile.md`
- `worker/routes/incidents.js`
- `worker/routes/public-tracking.js`
- `worker.js`
- `dashboard-incidents.js`
- `dashboard.css`
- `dashboard.html`
- `dashboard.js`
- `public/dashboard-incidents.js`
- `public/dashboard.css`
- `public/dashboard.html`
- `public/dashboard.js`
- `public-tracking.css`
- `public/public-tracking.css`
- `mobile-app/app/(tabs)/work.tsx`
- `tests_js/worker/routes.test.mjs`
- `tests_js/worker.contract.test.mjs`

## Validacion

- `node --test tests_js/worker/routes.test.mjs` -> pass
- `node --test tests_js/worker/rbac-core.test.mjs` -> pass
- `npm --prefix mobile-app test` -> pass
- `node --test tests_js/worker.contract.test.mjs` -> pass
