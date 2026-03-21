# Plan de implementacion: remediacion tecnica

Este documento traduce la auditoria tecnica del proyecto en un flujo de implementacion ejecutable.

No es un backlog generico. La idea es ordenar los arreglos por dependencia tecnica, riesgo y retorno.

> Alcance: desktop PyQt (`ui/`, `core/`, `managers/`), Worker Cloudflare (`worker.js`), dashboard web estatico (`dashboard*.js/html/css`), app movil Expo (`mobile-app/`) y pipeline de tests/CI.

---

## 0) Objetivo

Cerrar los principales riesgos detectados en la auditoria:

1. Inconsistencias de contrato en autenticacion web.
2. Superficie de secretos demasiado amplia.
3. Sesiones web con almacenamiento fragil en clientes web.
4. Configuracion Cloudflare poco robusta.
5. Monolitos grandes y alto acoplamiento.
6. Drift entre fuentes, artefactos generados y tests.
7. Tooling y CI incompletos o desalineados.

---

## 1) Resumen ejecutivo del orden recomendado

Orden propuesto:

1. Congelar contrato de autenticacion web.
2. Reducir superficie de secretos y cerrar flujos legacy innecesarios.
3. Endurecer sesiones y configuracion de seguridad.
4. Normalizar tests, CI y fuentes de verdad.
5. Refactorizar monolitos por etapas.
6. Limpiar inconsistencias de dominio, scripts y configuracion residual.

No conviene empezar por refactor grande. Primero hay que fijar el comportamiento esperado.

---

## 2) Principios de implementacion

- No mezclar cambios de contrato con refactors grandes en el mismo PR.
- Cada fase debe dejar tests pasando antes de abrir la siguiente.
- Cuando un flujo tenga version legacy y version nueva, definir una sola ruta objetivo y marcar la otra como deprecated.
- Si una pieza toca seguridad, contrato o storage, agregar test de regresion antes o junto con el cambio.
- Reducir fallback implicitos. El sistema hoy tiene demasiados "si falla A, proba B".

---

## 3) Fase 1: estabilizar autenticacion web

### Objetivo

Definir y consolidar el contrato real de login, bootstrap, logout y validacion de sesion.

### Problemas que resuelve

- `login` del Worker devuelve `access_token`, pero hay tests que esperan `undefined`.
- `bootstrap` no devuelve el mismo contrato que consume mobile.
- Desktop, mobile y Worker conviven con HMAC legacy y Bearer/cookie sin limites completamente claros.

### Archivos principales

- `worker.js`
- `tests_js/worker.contract.test.mjs`
- `mobile-app/src/api/webAuth.ts`
- `mobile-app/src/api/client.ts`
- `managers/user_manager_v2.py`
- `managers/history_manager.py`

### Trabajo

1. Definir el contrato objetivo para:
   - `POST /web/auth/login`
   - `POST /web/auth/bootstrap`
   - `POST /web/auth/logout`
   - `GET /web/auth/me`
2. Elegir un modelo de sesion oficial:
   - Opcion A: cookie HttpOnly como mecanismo principal y Bearer solo para mobile nativa.
   - Opcion B: Bearer como contrato explicito para mobile/desktop y cookie como compatibilidad web.
3. Hacer que `login` y `bootstrap` devuelvan el mismo shape cuando ambos inician sesion.
4. Actualizar `mobile-app/src/api/webAuth.ts` para que no dependa de contratos divergentes.
5. Actualizar `tests_js/worker.contract.test.mjs` para reflejar el contrato real.
6. Revisar `UserManagerV2._authenticate_web()` y el token actual de desktop para que dependan de la misma semantica.

### Entregables

- Contrato unico documentado en codigo y tests.
- Worker contract tests verdes.
- Cliente mobile y desktop alineados al mismo flujo.

### Criterio de cierre

- `npm run test:worker` pasa completo.
- No existen tests que esperen `access_token` ausente si el endpoint inicia sesion.
- `bootstrap` y `login` comparten convencion de respuesta y persistencia.

---

## 4) Fase 2: reducir superficie de secretos

### Objetivo

Eliminar el uso operativo de secretos globales donde ya existe autenticacion por sesion.

### Problemas que resuelve

- Existe `mobile-app/.env` con secretos sensibles.
- Desktop puede leer secretos desde `mobile-app/.env` via fallback.
- El proyecto sigue cargando conceptos legacy de HMAC incluso donde ya no hacen falta.

### Archivos principales

- `managers/history_manager.py`
- `mobile-app/.env.example`
- `README.md`
- scripts que usan base URLs o secretos por defecto
- cualquier flujo HMAC no estrictamente necesario para integraciones privadas

### Trabajo

1. Quitar el fallback desktop hacia `mobile-app/.env`.
2. Definir politicamente:
   - HMAC queda solo para integraciones privadas/legacy.
   - Mobile distribuida usa solo `/web/*` + sesion corta.
   - Desktop define explicitamente si opera en `legacy`, `web` o `auto`.
3. Eliminar cualquier necesidad de `EXPO_PUBLIC_API_TOKEN` y `EXPO_PUBLIC_API_SECRET` en mobile.
4. Revisar scripts con defaults a URLs productivas fijas y moverlos a:
   - variable de entorno
   - parametro obligatorio
   - o default no productivo
5. Verificar documentacion y ejemplos para que no incentiven secretos embebidos.

### Entregables

- `HistoryManager` sin dependencia de `mobile-app/.env`.
- Flujo mobile sin HMAC global.
- Scripts operativos sin defaults peligrosos a produccion.

### Criterio de cierre

- Ningun cliente distribuido requiere `API_SECRET`.
- Ningun modulo de desktop lee secretos desde `mobile-app/.env`.
- La documentacion ya no mezcla estrategia legacy con estrategia recomendada sin aclaracion.

---

## 5) Fase 3: endurecer sesiones y seguridad de storage

### Objetivo

Reducir impacto de XSS o fuga local sobre sesiones web y cerrar relajaciones inseguras.

### Problemas que resuelve

- Sesiones web se guardan en `localStorage` en entorno web.
- El Worker tiene fallback de storage de sesion sobre KV de rate limit.
- `UserManagerV2` admite recuperacion best-effort con HMAC invalido para usuarios cloud.

### Archivos principales

- `mobile-app/src/storage/secure.ts`
- `mobile-app/src/storage/runtime.ts`
- `worker.js`
- `managers/user_manager_v2.py`
- `scripts/verify-security-deploy-config.mjs`

### Trabajo

1. Redefinir storage web de sesion:
   - Si la app Expo web realmente necesita compartir tabs, justificarlo.
   - Si no, pasar de `localStorage` a una estrategia menos persistente.
   - Si sigue en `localStorage`, dejarlo explicitamente marcado como riesgo aceptado y limitar alcance.
2. Eliminar fallback de `WEB_SESSION_KV` hacia `RATE_LIMIT_KV` en Worker.
3. Hacer que `verify-security-deploy-config.mjs` valide no solo presencia de bindings, sino tambien:
   - IDs distintos para `RATE_LIMIT_KV` y `WEB_SESSION_KV`
   - ausencia de secretos inseguros
4. Remover recuperacion de usuarios con HMAC invalido o moverla a una herramienta de reparacion offline/manual.
5. Revisar expiracion, revocacion y logout para que invaliden una sola fuente de verdad.

### Entregables

- Session store separado del rate limiter.
- Politica explicita de almacenamiento de sesion web.
- Carga de usuarios con integridad estricta.

### Criterio de cierre

- El Worker falla de forma explicita si falta `WEB_SESSION_KV`.
- No hay fallback silencioso entre stores de seguridad distintos.
- La base de usuarios no se recupera automaticamente desde payloads con integridad rota.

---

## 6) Fase 4: normalizar tests, CI y fuentes de verdad

### Objetivo

Asegurar que lo que se testea sea lo mismo que realmente se sirve o ejecuta.

### Problemas que resuelve

- `test:web` no corre todos los tests del dashboard.
- Los tests del dashboard leen fuentes root, pero runtime sirve `public/`.
- El descubrimiento global de tests Python es ruidoso por contenido vendorizado.
- Hay tests muy superficiales para componentes grandes.

### Archivos principales

- `package.json`
- `.github/workflows/tests.yml`
- `tests_js/dashboard.*`
- `scripts/sync-dashboard-assets.mjs`
- configuracion Python de tests

### Trabajo

1. Definir una unica fuente de verdad para el dashboard:
   - O se testean archivos fuente y se garantiza build deterministico.
   - O se testea el output sincronizado en `public/`.
2. Incluir pruebas de dashboard XSS/a11y en el comando principal y en CI.
3. Aislar tests Python del contenido vendorizado:
   - mantener `tests/` como raiz oficial
   - evitar `discover` global
   - documentar el comando correcto
4. Reemplazar tests de string-matching superficiales por tests de comportamiento donde tenga sentido.
5. Agregar smoke tests minimos para contratos criticos:
   - auth web
   - driver upload/list/delete
   - incidents create/status/photo

### Entregables

- CI ejecuta el set real de tests relevantes.
- Los comandos locales y CI coinciden.
- No hay drift entre archivos testeados y archivos servidos.

### Criterio de cierre

- `npm run test:web` cubre contract + dashboard.
- GitHub Actions ejecuta los mismos comandos documentados.
- No existen tests relevantes fuera de la ruta oficial sin integracion a CI.

---

## 7) Fase 5: refactor del Worker por modulos

### Objetivo

Bajar complejidad y acoplamiento del backend principal.

### Problemas que resuelve

- `worker.js` concentra rutas, auth, validacion, acceso a D1/R2, SSE, push y helpers.
- Cualquier cambio importante genera alto riesgo de regresion lateral.

### Enfoque

No reescribir todo de una vez. Extraer por dominios y mantener `worker.js` como entrypoint fino.

### Corte sugerido

1. `worker/auth/`
   - Bearer/cookie web
   - HMAC legacy
   - rate limit
2. `worker/routes/`
   - `auth`
   - `installations`
   - `incidents`
   - `drivers`
   - `assets`
   - `statistics`
   - `devices`
3. `worker/services/`
   - audit log
   - push notifications
   - realtime events
4. `worker/lib/`
   - validation
   - json/body helpers
   - response helpers
   - tenant normalization

### Estrategia

1. Extraer primero helpers puros sin cambiar comportamiento.
2. Luego mover rutas menos riesgosas.
3. Dejar auth y session handling para un PR separado, una vez estabilizado el contrato.

### Criterio de cierre

- `worker.js` queda como ensamblador.
- Cada dominio tiene tests propios.
- No se pierde cobertura de contratos existentes.

---

## 8) Fase 6: refactor del desktop y panel web

### Objetivo

Reducir puntos unicos de fallo en desktop y dashboard.

### Problemas que resuelve

- `MainWindow` tiene demasiadas responsabilidades.
- `UserManagerV2` y `InstallationHistory` mezclan storage, auth, reglas de negocio, compatibilidad y recovery.
- `dashboard.js` es demasiado grande para evolucion segura.

### Desktop

Separar:

1. bootstrap de aplicacion
2. estado de sesion
3. coordinacion de tabs
4. acciones de incidencias
5. acciones de drivers
6. carga de thumbnails/fotos

### Dashboard

Separar:

1. bootstrap y navegacion
2. auth/session UI
3. incidents
4. assets
5. drivers
6. audit
7. realtime/SSE
8. modales compartidos

### Managers Python

Separar `UserManagerV2` en:

- auth provider
- user repository
- audit/access log service
- password policy adapter
- tenant web admin service

Separar `InstallationHistory` en:

- request signer / auth adapter
- installations API client
- incidents API client
- assets API client
- statistics API client

### Criterio de cierre

- Ningun archivo nuevo supera tamano razonable sin justificacion.
- Las dependencias entre capas son mas simples de testear.
- Los managers dejan de ser "objetos dios".

---

## 9) Fase 7: limpieza de artefactos, defaults y consistencia de dominio

### Objetivo

Eliminar ruido acumulado que hoy complica entender el proyecto.

### Problemas que resuelve

- coexistencia de "Driver Manager" y "SiteOps"
- scripts con URLs hardcodeadas
- artefactos que parecen fuente pero no estan integrados
- mensajes con emojis que rompen encoding en consola Windows

### Trabajo

1. Definir nombre canonical del producto.
2. Alinear:
   - `README`
   - window titles
   - `app.json`
   - nombres de scripts y docs
3. Revisar `dashboard_assets.js`, `build_dashboard.py`, `embed_dashboard.py` y similares:
   - integrar
   - o archivar
   - o eliminar
4. Remover defaults a URLs productivas de scripts administrativos.
5. Limpiar mensajes/logs no ASCII en puntos donde ya se observan problemas de encoding.

### Criterio de cierre

- El proyecto tiene una narrativa de producto consistente.
- No quedan scripts con destino productivo por default salvo justificacion fuerte.
- No hay artefactos dudosos sin duenio funcional.

---

## 10) Fase 8: cierre de deuda y endurecimiento final

### Objetivo

Cerrar lo que quede como deuda residual despues de estabilizar arquitectura y seguridad.

### Trabajo

1. Revisar validaciones y errores para homogeneidad entre desktop, Worker y mobile.
2. Consolidar documentacion tecnica:
   - auth modes
   - deploy seguro
   - recovery operativo
   - flujo de tenants
3. Medir y reducir deuda visible:
   - helpers duplicados
   - tests redundantes
   - imports o dependencias sin uso
4. Agregar checklist de release tecnica.

---

## 11) Dependencias entre fases

- Fase 1 bloquea Fase 2 y Fase 3 en todo lo relacionado con sesion.
- Fase 2 y Fase 3 deben completarse antes de cambios grandes en deploy y onboarding tecnico.
- Fase 4 debe arrancar temprano, pero cerrar antes de refactors grandes.
- Fase 5 y Fase 6 no deberian empezar sin contratos y tests ya estabilizados.
- Fase 7 conviene dejarla despues de los cambios funcionales para no generar ruido innecesario en diffs.

---

## 12) Propuesta de PRs

### PR 1

`auth-web-contract-stabilization`

- alinea Worker + mobile + tests
- sin refactor estructural grande

### PR 2

`remove-secret-sprawl-and-legacy-fallbacks`

- elimina fallback a `mobile-app/.env`
- limpia secretos y docs

### PR 3

`session-hardening-and-cloudflare-config-validation`

- separa stores
- endurece validaciones de deploy
- elimina recoveries inseguros

### PR 4

`dashboard-and-ci-source-of-truth`

- integra tests faltantes
- fija comando oficial
- alinea build/test/runtime

### PR 5

`worker-modularization-phase-1`

- extrae helpers y primeras rutas

### PR 6

`desktop-and-dashboard-decomposition-phase-1`

- parte `MainWindow`, `dashboard.js`, managers principales

### PR 7

`naming-cleanup-and-operational-polish`

- branding
- scripts
- defaults
- logs

---

## 13) Checklist resumido

- [x] Contrato unico para login/bootstrap/me/logout
- [x] Worker contract tests 100% verdes
- [ ] Mobile sin secretos HMAC distribuidos
- [ ] Desktop sin fallback a `mobile-app/.env`
- [x] Session store separado de rate limit store
- [x] Sin recovery automatico de usuarios con HMAC invalido
- [x] Dashboard tests integrados a `test:web` y CI
- [x] Fuente unica de verdad para dashboard
- [ ] `worker.js` modularizado por dominios
- [ ] `MainWindow`, `UserManagerV2`, `InstallationHistory` desacoplados
- [x] URLs productivas removidas como defaults en scripts
- [x] Naming de producto unificado
- [x] Checklist de release tecnico agregado

---

## 14) Riesgos de implementacion

- Cambiar auth sin congelar contrato puede romper desktop y mobile al mismo tiempo.
- Refactorizar `worker.js` antes de estabilizar tests puede introducir regresiones silenciosas.
- Eliminar fallbacks inseguros puede exponer dependencias operativas hoy ocultas.
- Cambiar storage de sesion web puede afectar Expo web si existe uso real multi-tab.

Por eso el orden importa.

---

## 15) Definicion de proyecto "sano"

Se puede considerar que este frente quedo razonablemente saneado cuando:

- el flujo recomendado de autenticacion es uno solo y esta documentado
- no hay secretos globales donde deberia haber sesion por usuario
- los tests cubren el runtime real
- los modulos grandes ya no concentran demasiadas responsabilidades
- el deploy falla temprano ante configuraciones inseguras
- el repo es entendible sin depender de conocimiento historico del autor
