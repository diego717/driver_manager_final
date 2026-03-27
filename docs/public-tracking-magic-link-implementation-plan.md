# Plan de implementacion: Tracking publico con Magic Link

Este documento aterriza la implementacion de un seguimiento publico de estado para cliente final usando Magic Link de solo lectura.

El objetivo es que un cliente pueda abrir una URL desde WhatsApp o email y ver el estado actual del servicio sin crear cuenta, sin instalar app y sin exponer informacion interna.

> Alcance inicial: dashboard web (`dashboard*.js`), Worker (`worker/`, `worker.js`), KV, D1 y SSE.
>
> Fuera de alcance inicial: configuracion avanzada por tenant, fotos publicas, notas internas, identidad completa del tecnico y multiples links activos por instalacion.

---

## 0) Objetivo

Implementar una primera version de bajo riesgo y alto impacto que:

- emita un link publico de solo lectura con expiracion
- valide ese link en el Worker sin tocar D1 en cada request publico
- muestre una vista publica minima y segura del estado
- reciba updates en tiempo real reusando el broker SSE ya existente
- permita revocar o regenerar el link desde el dashboard

La prioridad correcta es:

1. Link publico seguro + snapshot publico por KV.
2. Vista publica movil + bootstrap del estado.
3. SSE publico de scope reducido.
4. Revocacion, expiracion y auditoria operativa.

---

## 1) Recomendacion ejecutiva

### Recomendacion funcional

- Hacer el MVP sobre `installation_id`, porque hoy esa es la entidad estable del repo.
- Mostrar solo una lista blanca hardcodeada de campos publicos.
- No mostrar tecnico, notas internas, evidencia ni checklist en la primera version.
- Permitir un solo link activo por instalacion en el MVP.

### Recomendacion tecnica

- Crear un KV separado: `PUBLIC_TRACKING_KV`.
- Firmar un token tipo JWT HS256 reutilizando los helpers de `base64url` y `hmac` ya presentes en `worker.js`.
- Resolver la URL publica del link desde una configuracion explicita, por ejemplo `PUBLIC_TRACKING_BASE_URL`.
- Guardar en KV el estado activo del link y el snapshot publico cacheado.
- Reusar el broker SSE actual con un canal sintetico por token, por ejemplo `public:{jti}`.
- Leer D1 al emitir o refrescar snapshot, no en cada request publico.

### Recomendacion de politica

- TTL por defecto: 72 horas desde la emision.
- Regenerar un link revoca inmediatamente el anterior.
- Revocacion manual disponible para admin/super_admin.
- Auto-revocacion sugerida: 24 horas despues de conformidad generada o cuando expire el TTL, lo que ocurra primero.

---

## 2) Estado actual del repo

Piezas ya disponibles:

- Dashboard web con JS plano y auth web en `dashboard.js`, `dashboard-incidents.js`, `dashboard-api.js`.
- Worker modular con rutas en `worker/routes/`.
- Auth web con token firmado y versionado via `WEB_SESSION_KV` en `worker/auth/web-session.js`.
- Broker SSE ya implementado en `worker.js` con `RealtimeEventsBroker`.
- Eventos operativos ya emitidos desde incidencias e instalaciones.
- Auditoria central en D1 (`audit_logs`).

Restricciones reales del repo:

- No existe hoy una entidad separada de "orden publica" o "ticket cliente". La entidad mas estable es `installation`.
- Los assets publicos no se sirven libremente; `worker.js` expone una lista blanca de rutas estaticas.
- `EventSource` no permite mandar `Authorization` custom. Para SSE publico el token no debe depender de header Bearer.

Conclusion practica:

- El MVP debe ser installation-centric.
- La UI publica necesita ruta y assets dedicados.
- El SSE publico conviene validarlo por token en path y no por query string.

---

## 3) Modelo funcional recomendado

## 3.1 Entidad del link

En el MVP, el link referencia una instalacion:

- `tenant_id`
- `installation_id`
- `jti` del link
- `exp` de expiracion

No conviene arrancar por incidente individual porque:

- el repo ya agrupa el flujo operativo alrededor de `installations/:id/incidents`
- la conformidad tambien cuelga de `installation_id`
- el cliente quiere "estado del servicio", no necesariamente una incidencia tecnica puntual

## 3.2 Que se muestra al cliente final

Lista blanca hardcodeada inicial:

- referencia visible del servicio (`installation_id` o codigo amigable derivado)
- estado publico actual
- timestamp de ultima actualizacion
- timeline minima de hitos publicos
- mensaje publico derivado del estado
- indicador de cierre/conformidad si ya existe

No mostrar en MVP:

- nombre completo del tecnico
- username interno
- notas internas de instalacion
- `incident.note`
- `resolution_note`
- evidencia, fotos, checklist
- IP, metadata tecnica, auditoria

## 3.3 Mapeo de estado publico

Recomendacion: crear un mapper server-side con traduccion fija, por ejemplo:

- instalacion creada sin incidencias activas -> `registrado`
- incidencia `open` -> `pendiente`
- incidencia `in_progress` -> `en_progreso`
- incidencia `paused` -> `demorado`
- incidencia `resolved` sin conformidad -> `resuelto`
- conformidad generada -> `cerrado`

Este mapeo debe vivir en un helper explicito, no disperso entre UI y rutas.

---

## 4) Modelo de datos y storage

## 4.1 JWT del Magic Link

Payload recomendado:

```json
{
  "iss": "siteops",
  "aud": "public-tracking",
  "scope": "public_tracking",
  "jti": "pt_8f2c...",
  "tenant_id": "tenant-a",
  "installation_id": 123,
  "iat": 1774473600,
  "exp": 1774732800,
  "v": 1
}
```

Recomendacion:

- usar header JWT real (`alg`, `typ`) aunque la implementacion sea liviana
- firmar con secreto separado, por ejemplo `PUBLIC_TRACKING_SECRET`
- no reutilizar `WEB_SESSION_SECRET`

## 4.2 KV recomendado

Agregar namespace nuevo:

- `PUBLIC_TRACKING_KV`

Claves sugeridas:

1. `pt:jti:{jti}`
   - estado canonicamente validable del link
   - incluye snapshot publico cacheado
2. `pt:installation:{tenant_id}:{installation_id}`
   - indice del link activo para esa instalacion

Recomendacion operativa:

- ambas keys deben escribirse con el mismo TTL logico del link + margen corto de limpieza
- `pt:jti:{jti}` es la fuente de verdad
- `pt:installation:{tenant_id}:{installation_id}` es solo indice derivado
- si existe indice pero falta `pt:jti:{jti}`, el Worker debe autocorregir borrando el indice roto
- si al regenerar el link quedan residuos viejos, siempre prevalece el `jti` mas reciente escrito en el indice de instalacion

Valor sugerido para `pt:jti:{jti}`:

```json
{
  "jti": "pt_8f2c",
  "tenant_id": "tenant-a",
  "installation_id": 123,
  "status": "active",
  "issued_at": "2026-03-25T22:00:00.000Z",
  "expires_at": "2026-03-28T22:00:00.000Z",
  "revoked_at": null,
  "channel_id": "public:pt_8f2c",
  "snapshot": {
    "installation_id": 123,
    "public_status": "en_progreso",
    "last_updated_at": "2026-03-25T22:10:00.000Z",
    "milestones": []
  }
}
```

## 4.3 D1 en MVP

No abrir tabla nueva en D1 en la primera iteracion.

Motivo:

- el requerimiento principal es validacion barata en lectura
- la emision y revocacion pueden quedar en KV + `audit_logs`
- agregar tabla ahora aumenta complejidad sin habilitar valor inmediato

Abrir tabla `public_tracking_links` solo si luego hace falta:

- historial consultable
- multiples links activos
- reporteria analitica

## 4.4 Base URL publica del Magic Link

El plan debe asumir una URL publica explicita para construir links compartibles.

Recomendacion:

- agregar variable `PUBLIC_TRACKING_BASE_URL`
- debe apuntar al host canonico publico, por ejemplo `https://estado.example.com`
- no derivarla implicitamente del `request.url` del dashboard
- rechazar configuraciones no HTTPS fuera de desarrollo local controlado

Esto evita emitir links con host interno, preview URL o dominio equivocado.

---

## 5) Contrato API recomendado

## 5.1 Endpoints internos de gestion

Nuevos endpoints web:

- `GET /web/installations/:id/public-tracking-link`
- `POST /web/installations/:id/public-tracking-link`
- `DELETE /web/installations/:id/public-tracking-link`

Comportamiento:

- `GET`: devuelve link activo, expiracion y snapshot resumido si existe
- `POST`: crea o regenera link
- `DELETE`: revoca link activo

Recomendacion MVP:

- solo `admin` y `super_admin` pueden emitir o revocar

## 5.2 Endpoints publicos

Nuevas rutas publicas:

- `GET /track/:token`
- `GET /track/:token/state`
- `GET /track/:token/events`

Uso:

- `/track/:token` sirve HTML publica
- `/track/:token/state` devuelve bootstrap JSON del snapshot
- `/track/:token/events` abre SSE publico con scope de ese token

## 5.3 Respuesta publica sugerida

```json
{
  "success": true,
  "tracking": {
    "installation_id": 123,
    "public_status": "en_progreso",
    "public_message": "Estamos trabajando en tu servicio.",
    "last_updated_at": "2026-03-25T22:10:00.000Z",
    "closed": false,
    "conformity_generated": false,
    "milestones": [
      {
        "type": "incident_created",
        "label": "Solicitud registrada",
        "timestamp": "2026-03-25T21:50:00.000Z"
      },
      {
        "type": "incident_status_updated",
        "label": "Trabajo en curso",
        "timestamp": "2026-03-25T22:10:00.000Z"
      }
    ]
  }
}
```

## 5.4 Validacion del token

El Worker debe validar:

- firma HS256
- `scope = public_tracking`
- `aud = public-tracking`
- `exp` no vencido
- `jti` presente
- key `pt:jti:{jti}` existente en KV
- `status = active`
- `tenant_id` e `installation_id` del JWT iguales a los de KV

El flujo publico debe fallar sin consultar D1 cuando:

- el token esta vencido
- la firma es invalida
- el link fue revocado
- el KV entry ya no existe

---

## 6) Arquitectura recomendada

## 6.1 Lectura publica sin D1 por request

Flujo de lectura:

1. Cliente abre `/track/:token`.
2. Worker valida JWT.
3. Worker resuelve `jti` en `PUBLIC_TRACKING_KV`.
4. Worker devuelve HTML o snapshot desde KV.
5. Si hay SSE, conecta al broker con canal `public:{jti}`.

No se toca D1 en la lectura publica normal.

Fallback recomendado:

- si el token es valido pero el snapshot no existe o esta corrupto, responder `503` con pagina/public JSON de indisponibilidad temporal
- no reconstruir desde D1 en lectura publica del MVP
- registrar metrica o log de `snapshot_miss`

Motivo:

- preserva la regla principal de no tocar D1 en request publico
- evita convertir una falla de cache en un read path caro o inconsistente
- hace visible el problema operativo para corregir el write path

## 6.2 Construccion y refresco del snapshot

Crear helper nuevo, por ejemplo:

- `worker/lib/public-tracking.js`

Responsabilidades:

- `buildPublicTrackingSnapshot(context)`
- `issuePublicTrackingLink(...)`
- `verifyPublicTrackingToken(...)`
- `refreshPublicTrackingSnapshot(...)`
- `revokePublicTrackingLink(...)`

Flujo de refresco:

1. Una operacion interna modifica instalacion, incidencia o conformidad.
2. El Worker consulta en KV si existe link activo para esa instalacion.
3. Si existe, recompone snapshot desde D1.
4. Guarda snapshot actualizado en KV.
5. Publica evento SSE limitado al canal publico de ese link.

Esto mantiene baratas las lecturas publicas y mueve el costo al write path, donde el volumen es menor.

Matriz minima de triggers para refresco:

- `installation_created`: crear snapshot inicial si se emite link despues del alta
- `incident_created`: refrescar snapshot y timeline publica
- `incident_status_updated`: refrescar snapshot y timeline publica
- `incident_deleted`: refrescar snapshot si alteraba el estado publico vigente
- `installation_updated`: refrescar solo si cambia algun campo con visibilidad publica futura
- `installation_deleted`: revocar link y publicar `tracking_revoked`
- `conformity_generated`: refrescar snapshot, marcar `cerrado` y programar auto-revocacion

Cambios que no deben disparar refresh en MVP:

- notas internas
- evidencia/checklist
- fotos
- auditoria
- metadata tecnica sin impacto en estado publico

## 6.3 Reuso de SSE existente

No mezclar clientes publicos con `/web/events`.

Recomendacion:

- reutilizar `RealtimeEventsBroker`
- usar `tenant_id` sintetico como canal, por ejemplo `public:{jti}`
- publicar solo envelopes reducidos:
  - `connected`
  - `tracking_updated`
  - `tracking_revoked`
  - `tracking_expired`

Esto permite reusar casi toda la infraestructura SSE existente sin abrir un stream por tenant completo para publico.

## 6.4 Public page

Crear una pagina publica minima y movil:

- `public-tracking.html`
- `public-tracking.js`
- `public-tracking.css`

o servir HTML inline desde Worker si se quiere reducir superficie. En este repo, la opcion mas consistente es agregar assets dedicados a la lista blanca de `worker.js`.

Requisitos:

- no depender de assets third-party
- `Referrer-Policy: no-referrer`
- `Cache-Control: no-store`
- `X-Robots-Tag: noindex, nofollow`

---

## 7) Cambios por capa

## 7.1 Worker

Archivos probables:

- `worker.js`
- `worker/lib/public-tracking.js`
- `worker/routes/public-tracking.js`
- `worker/routes/incidents.js`
- `worker/routes/installations.js`
- `worker/routes/conformities.js`

Trabajo recomendado:

1. Crear helper de firma y verificacion del Magic Link.
2. Crear helper de snapshot publico con whitelist hardcodeada.
3. Exponer rutas internas de emitir, ver y revocar.
4. Exponer rutas publicas de HTML, state y SSE.
5. Refrescar snapshot publico desde write paths relevantes.
6. Publicar eventos al canal SSE publico.
7. Auditar emision, regeneracion, revocacion y expiracion.

## 7.2 Dashboard

Archivos probables:

- `dashboard-api.js`
- `dashboard.js`
- `dashboard-incidents.js`
- `dashboard-modals.js`
- `dashboard.css`
- `dashboard.html`

UI sugerida:

- boton `Compartir seguimiento`
- modal con:
  - link activo
  - expiracion
  - boton `Copiar`
  - boton `Regenerar`
  - boton `Revocar`

No hace falta configuracion compleja en MVP. Basta con:

- expiracion fija por defecto
- un link activo por instalacion

## 7.3 Static assets

Por la forma en que hoy se sirven assets, hay que tocar:

- whitelist de assets en `worker.js`
- posible sincronizacion en `scripts/sync-dashboard-assets.mjs` si los assets fuente viven fuera de `public/`

## 7.4 Configuracion Cloudflare

Actualizar:

- `wrangler.toml`
- documentacion de `README.md`

Nuevos bindings/secrets:

- `PUBLIC_TRACKING_KV`
- `PUBLIC_TRACKING_SECRET`
- `PUBLIC_TRACKING_BASE_URL`

No conviene reutilizar `WEB_SESSION_KV` para esto.

---

## 8) Politica de visibilidad recomendada

MVP con politica explicita y corta:

- publico: estado, timestamps, hitos derivados, referencia
- privado: nombres internos, notas, fotos, checklist, auditoria, metadata tecnica

Implementacion concreta:

- helper `buildPublicTrackingSnapshot(...)` hace whitelist campo por campo
- prohibido serializar rows crudas de D1 a la respuesta publica
- prohibido reutilizar `mapIncidentRow` o `SELECT *` directamente para publico

Esto evita el accidente clasico de "sumar un campo al backend interno y exponerlo sin querer".

---

## 9) Politica de expiracion y revocacion

Recomendacion concreta para la primera version:

- TTL default: 72 horas
- un link activo por instalacion
- regenerar = revocar anterior + emitir nuevo
- revocacion manual inmediata desde dashboard
- auto-revocar 24 horas despues de conformidad generada

Politica de cleanup recomendada:

- `pt:jti:{jti}` expira por TTL natural
- `pt:installation:{tenant_id}:{installation_id}` expira con TTL ligeramente mayor o se borra al revocar
- en cualquier lectura o write path que detecte indice huerfano, limpiar inmediatamente el indice
- si se agrega cron despues, usarlo solo como red de seguridad, no como mecanismo principal de consistencia

Casos a cubrir:

- instalacion cerrada antes de expirar
- link reenviado a terceros
- cliente abre link vencido
- tecnico o admin necesita cortar acceso ya emitido

UX de link vencido/revocado:

- pagina publica simple, sin detalle tecnico
- mensaje claro: `Este enlace ya no esta disponible`

---

## 10) Fases recomendadas

## Fase 1: Core de token y snapshot

### Objetivo

Emitir y validar links publicos seguros sin D1 en lectura.

### Trabajo

1. Agregar `PUBLIC_TRACKING_KV` y `PUBLIC_TRACKING_SECRET`.
2. Crear helper de JWT HS256 para `scope=public_tracking`.
3. Crear rutas web de `GET/POST/DELETE` de link.
4. Crear snapshot publico derivado desde D1 al emitir.
5. Persistir snapshot y metadata en KV.
6. Agregar auditoria de emitir, regenerar y revocar.

### Entregable

- El dashboard puede generar y revocar un Magic Link por instalacion.
- El Worker valida el link solo con secreto + KV.

## Fase 2: Vista publica

### Objetivo

Entregar una pagina publica util y segura.

### Trabajo

1. Crear HTML/CSS/JS publico.
2. Crear `GET /track/:token`.
3. Crear `GET /track/:token/state`.
4. Mostrar estado actual, ultima actualizacion y timeline minima.
5. Manejar estados `activo`, `vencido`, `revocado`.
6. Manejar `snapshot_miss` o indisponibilidad temporal sin filtrar detalle interno.

### Entregable

- El cliente puede abrir el link y ver el estado sin autenticarse.

## Fase 3: SSE publico

### Objetivo

Actualizar la pagina publica en tiempo real con scope reducido.

### Trabajo

1. Crear `GET /track/:token/events`.
2. Reusar `RealtimeEventsBroker` con canal `public:{jti}`.
3. Refrescar snapshot desde write paths:
   - `worker/routes/incidents.js`
   - `worker/routes/installations.js`
   - `worker/routes/conformities.js`
4. Publicar solo eventos publicos reducidos.
5. Agregar fallback a refresh manual o polling liviano si SSE falla.

### Entregable

- La pagina publica refleja cambios sin reload.

## Fase 4: Hardening operativo

### Objetivo

Cerrar riesgos de uso real.

### Trabajo

1. Auto-revocacion al cierre.
2. Rate limit suave para endpoints publicos si hace falta.
3. Contadores en KV de accesos y errores.
4. Tests de revocacion, expiracion y reuso de links.
5. Documentar runbook de soporte.

### Entregable

- Feature operable sin sorpresas de seguridad ni soporte.

---

## 11) Orden de PRs recomendado

1. PR 1: helper de token + `PUBLIC_TRACKING_KV` + rutas internas de emitir/revocar.
2. PR 2: snapshot publico + bootstrap JSON.
3. PR 3: pagina publica y assets.
4. PR 4: SSE publico y refresco desde write paths.
5. PR 5: expiracion automatica, metricas y hardening.

No conviene meter SSE en el mismo PR que la emision del link. Primero hay que cerrar bien el modelo de visibilidad.

---

## 12) Testing requerido

## 12.1 Worker

Agregar tests para:

- emision de link con claims correctos
- rechazo de token con firma invalida
- rechazo de token vencido
- rechazo de token revocado
- validacion que la lectura publica usa KV y no D1
- snapshot publico sin campos sensibles
- comportamiento con snapshot faltante o corrupto
- regeneracion revoca el link previo
- `DELETE /web/installations/:id/public-tracking-link`

## 12.2 Dashboard

Agregar tests para:

- apertura del modal de compartir
- copiado del link
- estado de link activo
- revocacion y regeneracion

## 12.3 SSE publico

Agregar tests para:

- conexion con token valido
- rechazo con token invalido
- recepcion de `tracking_updated`
- corte cuando el link se revoca

## 12.4 Smoke manual

Validar en navegador real:

- Android Chrome desde WhatsApp
- iPhone Safari desde email
- reconexion SSE despues de background/foreground
- comportamiento de link vencido

---

## 13) Observabilidad y auditoria

Auditar en D1:

- `public_tracking_link_created`
- `public_tracking_link_regenerated`
- `public_tracking_link_revoked`
- `public_tracking_link_auto_revoked`

Medir en KV o logs:

- vistas publicas por link
- errores de validacion
- `snapshot_miss`
- expiraciones
- tasa de reconexion SSE

No recomiendo guardar un audit log D1 por cada view publica en el MVP. Va a generar ruido y costo sin mucho valor.

---

## 14) Riesgos y mitigaciones

### Link reenviado a terceros

Mitigacion:

- asumir que posesion del link otorga lectura
- minimizar datos visibles
- soportar revocacion inmediata

### Exposicion accidental de datos internos

Mitigacion:

- whitelist hardcodeada
- helper publico dedicado
- prohibido serializar objetos internos completos

### Token en URL

Mitigacion:

- usar path, no query string
- `Referrer-Policy: no-referrer`
- assets same-origin
- `no-store`

### Host incorrecto del link emitido

Mitigacion:

- usar `PUBLIC_TRACKING_BASE_URL`
- forzar HTTPS
- no construir el link desde el origin del request autenticado

### Indices de KV huerfanos o inconsistentes

Mitigacion:

- definir `pt:jti:{jti}` como fuente de verdad
- autocorregir `pt:installation:*` cuando apunte a un `jti` inexistente
- borrar indice al revocar o regenerar

### Coste extra en write paths

Mitigacion:

- refrescar snapshot solo si existe link activo
- mantener snapshot pequeno
- no recalcular si no hubo cambio publico

### Ambiguedad del estado publico

Mitigacion:

- definir mapper explicito de estado
- no exponer nomenclatura interna cruda

### Abuso de endpoints publicos o bots de preview

Mitigacion:

- agregar throttling basico por IP desde la primera salida publica
- no contar por defecto los prefetch/link preview como vista de negocio
- aplicar limites suaves a `/track/:token/state` y `/track/:token/events`
- cortar SSE publicos anormalmente frecuentes con backoff o `Retry-After`

---

## 15) Controles minimos de abuso

Estos controles no deben esperar a Fase 4. Deben entrar con la primera exposicion publica del link.

Minimo recomendado:

- rate limit liviano por IP para `/track/:token`, `/track/:token/state` y `/track/:token/events`
- limites mas estrictos para apertura repetida de SSE
- no registrar como view de negocio los requests de unfurl/prefetch evidentes
- respuesta generica y sin detalle para tokens invalidos o inexistentes

Motivo:

- los links se comparten por canales no controlados
- los previews de WhatsApp/email pueden multiplicar requests
- SSE anonimo sin limites desde el primer dia abre una superficie innecesaria

---

## 16) Criterios de cierre

MVP cerrado cuando:

- existe `PUBLIC_TRACKING_KV` y `PUBLIC_TRACKING_SECRET`
- existe `PUBLIC_TRACKING_BASE_URL` valida
- dashboard puede emitir, ver y revocar un link
- Worker valida el link via secreto + KV
- pagina publica carga sin auth
- respuesta publica no expone campos sensibles
- el sistema limpia indices huerfanos de KV al detectarlos

Etapa SSE cerrada cuando:

- la pagina publica recibe updates en tiempo real
- el canal publico no filtra eventos internos
- revocacion corta acceso en siguiente request/reconexion

Etapa hardening cerrada cuando:

- hay politica clara de expiracion
- hay auditoria de emision/revocacion
- existen tests negativos de seguridad

---

## 17) Archivos probables a tocar

- `worker.js`
- `worker/lib/public-tracking.js`
- `worker/routes/public-tracking.js`
- `worker/routes/incidents.js`
- `worker/routes/installations.js`
- `worker/routes/conformities.js`
- `dashboard-api.js`
- `dashboard.js`
- `dashboard-incidents.js`
- `dashboard-modals.js`
- `dashboard.css`
- `dashboard.html`
- `scripts/sync-dashboard-assets.mjs`
- `wrangler.toml`
- `README.md`
- `tests_js/worker.contract.test.mjs`
- `tests_js/worker/routes.test.mjs`
- `tests_js/dashboard.unit.test.mjs`

---

## 18) Recomendacion final

Para este repo, esta es una de las features con mejor relacion impacto/esfuerzo.

La secuencia correcta no es empezar por UI vistosa ni por SSE. La secuencia correcta es:

1. definir visibilidad publica
2. emitir Magic Link seguro
3. servir snapshot desde KV
4. recien despues sumar realtime publico

Si haces eso en ese orden, obtienes valor visible para el cliente final muy rapido sin abrir deuda innecesaria de seguridad o modelado.
