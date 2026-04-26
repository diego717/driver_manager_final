# 2026-04-20 - mejoras operativas en UI de equipos, drivers y tenants

## Resumen

- equipos: se agrega indicador visible de incidencias activas por fila para evitar abrir cada detalle
- equipos: se refuerza la lectura de estado operativo con badges mas claros y CTA de incidencia destacado cuando hay pendientes
- drivers: se separa visualmente `Descargar` vs `Eliminar` y se agrega badge `Ultimo` por marca
- tenants: se incorporan badges de rol con color semantico y separacion visual de la accion destructiva
- tenants: se bloquea borrado de usuarios protegidos (`platform_owner` / `diegosasen`) en UI y en guard de logica
- mapa incidencias: se reordena el panel derecho con jerarquia operativa (cliente, severidad, estado y direccion primero)
- mapa incidencias: la lista de `Puntos recientes` suma dot de severidad, badge de estado y resaltado claro del punto activo
- mapa incidencias: los chips de resumen distinguen urgencia real (`critica` en rojo, `activas` en ambar)
- mapa incidencias: `Abrir caso` queda como CTA primario y acciones de coordenada/Maps pasan a bloque secundario
- mapa incidencias: filtros de estado y severidad muestran conteos por opcion y estado visual activo
- mapa incidencias: ajuste responsive para evitar quiebres visuales al reducir demasiado el ancho de ventana

## Areas tocadas

- dashboard web (`assets`, `drivers`, `tenants`)
- dashboard web (`incidents` / mapa operativo)
- assets publicados (`public/dashboard-*.js`, `public/dashboard.css`)
- worker (`GET /web/assets`) para exponer contadores de incidencias activas por equipo

## Contexto

Se priorizo reducir friccion operativa en tareas de triage y administracion:

- detectar rapido equipos con pendientes sin entrar al detalle
- reducir riesgo de borrado accidental en la tabla de drivers
- hacer legible la jerarquia de roles en tenants y endurecer proteccion de cuentas criticas

## Cambios clave

- equipos (`dashboard-assets.js`, `public/dashboard-assets.js`)
  - nueva meta por fila: `incident_active_count` + `incident_critical_active_count`
  - indicador visual en la celda de equipo cuando hay incidencias activas (`asset-row-incident-indicator`)
  - boton `Incidencia` con tono de alerta cuando el equipo ya tiene pendientes
  - badge de estado con clase dedicada `asset-status-badge`
- backend assets list (`worker.js`)
  - `GET /web/assets` ahora devuelve:
    - `incident_active_count`
    - `incident_critical_active_count`
  - contadores calculados por equipo considerando:
    - incidencias vinculadas directamente por `asset_id`
    - incidencias por enlace historico `asset_installation_links`
  - fallback para esquemas legacy sin columna `incidents.asset_id`
- drivers (`dashboard-drivers.js`, `public/dashboard-drivers.js`)
  - se calcula la version mas reciente por marca (timestamp/version) y se marca con badge `Ultimo`
  - `Descargar` usa estilo dedicado (`table-action-btn-download`)
  - `Eliminar` pasa a estilo destructivo suave (`btn-danger-subtle table-action-btn-danger`)
- tenants (`dashboard.js`, `public/dashboard.js`)
  - se agrega badge de rol por usuario (`settings-role-badge-*`) para `admin`, `supervisor`, `tecnico`, `solo_lectura`, `super_admin`, `platform_owner`
  - se separa visualmente la accion `Eliminar` del flujo principal (`settings-user-danger-zone`)
  - usuarios protegidos no se pueden eliminar:
    - bloqueo visual (boton deshabilitado)
    - bloqueo de logica en `confirmDeleteTenantUser`
- mapa de incidencias (`dashboard-incidents.js`, `public/dashboard-incidents.js`, `dashboard.css`, `public/dashboard.css`)
  - panel lateral con prioridad operativa:
    - cliente + severidad/estado + registro como bloque principal
    - direccion/destino operativo destacado antes de metadata tecnica
  - lista `Puntos recientes` enriquecida:
    - dot de severidad por fila
    - badge de estado + badge de severidad
    - tiempo relativo y resaltado del item seleccionado
  - acciones del panel separadas por jerarquia:
    - `Abrir caso` como CTA primario ancho completo
    - `Mover/Elegir destino`, `Editar destino` y `Ver en Maps` como secundarias
  - filtros con feedback:
    - opciones de `Estado` y `Severidad` con conteo dinamico (`Etiqueta (n)`)
    - estilo activo en selects cuando hay filtro aplicado
  - chips de cabecera del mapa con tono semantico para urgencia
  - refuerzo responsive:
    - grid de acciones secundarias a una columna en ancho chico
    - ajustes en recent list para evitar overflow en pantallas muy angostas

## Impacto

- operativo: menos clicks para detectar pendientes en equipos y menos tiempo de barrido
- seguridad operativa: menor probabilidad de eliminar drivers/usuarios por error
- claridad: lectura de permisos y responsabilidades mas inmediata en tenants
- triage en campo: lectura mucho mas rapida de urgencia/cliente/destino sin abrir varios puntos en el mapa

## Referencias

- `dashboard-assets.js`
- `dashboard-drivers.js`
- `dashboard.js`
- `dashboard-incidents.js`
- `dashboard.css`
- `public/dashboard-assets.js`
- `public/dashboard-drivers.js`
- `public/dashboard.js`
- `public/dashboard-incidents.js`
- `public/dashboard.css`
- `worker.js`

## Validacion

- `node --check dashboard-assets.js`
- `node --check dashboard-drivers.js`
- `node --check dashboard.js`
- `node --check dashboard-incidents.js`
- `node --check public/dashboard-assets.js`
- `node --check public/dashboard-drivers.js`
- `node --check public/dashboard.js`
- `node --check public/dashboard-incidents.js`
- `node --check worker.js`
- `node --test tests_js/worker/routes.test.mjs` -> pass
- `node --test tests_js/worker.contract.test.mjs` -> pass
- `node --test --test-name-pattern="drivers|tenant|asset detail" tests_js/dashboard.unit.test.mjs` -> pass (focalizado)
- `node --test --test-name-pattern="incident map" tests_js/dashboard.unit.test.mjs` -> pass (focalizado)
