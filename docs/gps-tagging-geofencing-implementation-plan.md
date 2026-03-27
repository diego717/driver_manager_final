# Plan de implementacion: GPS tagging y geofencing

Este documento aterriza una implementacion incremental de captura GPS en el dashboard web/PWA y su evolucion posterior hacia geofencing.

Estado del documento: actualizado contra el repo al 2026-03-26.

No propone tracking continuo ni historial de trayectorias. El foco es proof-of-presence puntual al crear incidencias, registrar instalaciones y generar la conformidad.

> Alcance inicial: dashboard web/PWA (`dashboard*.js`), Worker (`worker/`, `worker.js`), D1, R2 y PDF de conformidad.
>
> Fuera de alcance inicial: app Expo nativa (`mobile-app/`) con GPS nativo. Si mas adelante se quiere soporte nativo real, eso requiere un track aparte con `expo-location`.

---

## Estado actual resumido

Este plan ya no describe solo trabajo futuro. Al dia de hoy, el repo ya implementa la mayor parte del track original.

### Ya implementado en codigo

- Migraciones D1 de GPS y geofence:
  - `migrations/0017_geolocation_capture.sql`
  - `migrations/0018_geofencing_soft.sql`
  - `migrations/0019_geofence_hard_overrides.sql`
- Captura puntual GPS en dashboard/PWA con `navigator.geolocation`.
- Envio de payload `gps` en:
  - registro manual
  - creacion de incidencia
  - conformidad
- Validacion server-side de GPS en Worker.
- Persistencia de GPS en `installations` e `incidents`.
- Snapshot GPS de conformidad en `installation_conformities.metadata_json`.
- Geofence soft para incidencias y conformidad.
- Geofence hard con override auditado para incidencias y conformidad.
- PDF de conformidad con GPS, precision, timestamp, link a mapa y bloque de geofence.
- Observabilidad GPS/geofence en estadisticas y auditoria.
- Tests de contrato y dashboard para los flujos principales.

### Todavia pendiente o dependiente de rollout

- confirmar que las migraciones 0017, 0018 y 0019 esten aplicadas en todos los entornos reales
- definir politica operativa por tenant para hard geofence
- definir quien carga y mantiene `site_lat`, `site_lng` y `site_radius_m`
- ejecutar smoke manual en navegadores/dispositivos reales y cerrar evidencia
- documentar variables de entorno y runbook de activacion
- mapa estatico embebido en PDF, si se quiere como enhancement posterior

### Lectura correcta del estado

- Fase 1: implementada
- Fase 2: implementada
- Fase 3: implementada en codigo
- Fase 4: implementada a nivel tecnico, pero su activacion efectiva depende de politica y configuracion por tenant

---

## 0) Objetivo

Implementar una primera version de bajo riesgo y alto valor que:

- capture coordenadas, precision y timestamp desde `navigator.geolocation`
- persista esos datos en D1 junto al registro o incidencia
- los exponga en UI, auditoria y PDF de conformidad
- deje preparada la base tecnica para geofencing posterior

La prioridad correcta es:

1. GPS tagging sin bloqueo.
2. GPS tagging visible en PDF y auditoria.
3. Geofencing en modo observacion/advertencia.
4. Geofencing obligatorio con override auditado.

---

## 1) Resumen ejecutivo de decisiones

### Recomendacion funcional

- Fase 1: GPS tagging opt-in fuerte, sin bloquear la operacion.
- Fase 2: conformidad con GPS recomendado y override auditado cuando no haya dato.
- Fase 3: geofencing soft, solo advertencia.
- Fase 4: geofencing hard solo despues de tener datos reales de precision por sitio.

### Recomendacion tecnica

- No agregar dependencias browser para geolocalizacion.
- Usar `navigator.geolocation.getCurrentPosition()` en dashboard/PWA.
- Validar y persistir coordenadas en el Worker; no confiar solo en el cliente.
- Reusar `installation_conformities.metadata_json` para el snapshot GPS de conformidad.
- Dejar la logica de distancia en Worker con Haversine cuando llegue la fase de geofencing.

### Recomendacion de politica

- No bloquear la creacion de registros ni incidencias en el MVP.
- Registrar siempre el resultado del intento de captura: `captured`, `denied`, `timeout`, `unavailable`, `unsupported`, `override`.
- Si mas adelante se exige GPS para cierre/conformidad, hacerlo con override obligatorio y motivo auditado.

---

## 2) Estado actual del repo

Piezas ya disponibles:

- Dashboard web/PWA con JS plano y formularios modales en `dashboard.js` y `dashboard-incidents.js`.
- API en Cloudflare Worker con rutas de registros, incidencias, conformidades y auditoria.
- D1 para `installations`, `incidents` e `installation_conformities`.
- R2 para fotos y PDF de conformidad.
- `installation_conformities.metadata_json` ya existe y sirve para guardar metadata adicional de cierre.
- Audit logs ya existen y pueden registrar overrides o fallos operativos.
- El repo ya incluye helpers de GPS/geofence en `worker/lib/gps.js`, `worker/lib/geofence.js` y observabilidad en `worker/lib/gps-observability.js`.
- El dashboard ya incluye captura puntual y UI asociada en `dashboard-geolocation.js`, `dashboard.js` y `dashboard-incidents.js`.
- El PDF de conformidad ya renderiza GPS y geofence en `worker/services/conformities.js`.

Limitacion estructural importante:

- No existe una entidad separada de `sites`, pero ya se adoptaron columnas `site_lat`, `site_lng` y `site_radius_m` sobre `installations`.
- Eso permite geofencing sobre incidencias y conformidades asociadas a una instalacion existente.
- Sigue sin haber baseline geografica canonica para bloquear seriamente la creacion de un registro manual nuevo.

---

## 3) Modelo de datos recomendado

## 3.1 GPS tagging operativo

Crear una nueva migracion, por ejemplo `migrations/0017_geolocation_capture.sql`, para agregar columnas en `installations` e `incidents`.

### `installations`

Campos sugeridos:

- `gps_lat` REAL
- `gps_lng` REAL
- `gps_accuracy_m` REAL
- `gps_captured_at` TEXT
- `gps_capture_source` TEXT NOT NULL DEFAULT 'none'
- `gps_capture_status` TEXT NOT NULL DEFAULT 'pending'
- `gps_capture_note` TEXT NOT NULL DEFAULT ''

### `incidents`

Campos sugeridos:

- `gps_lat` REAL
- `gps_lng` REAL
- `gps_accuracy_m` REAL
- `gps_captured_at` TEXT
- `gps_capture_source` TEXT NOT NULL DEFAULT 'none'
- `gps_capture_status` TEXT NOT NULL DEFAULT 'pending'
- `gps_capture_note` TEXT NOT NULL DEFAULT ''

### Por que no alcanza con `lat/lng/accuracy/timestamp`

Sin estado ni motivo no se puede distinguir:

- usuario nego permiso
- timeout real en campo
- browser no soportado
- tecnico uso override
- captura no intentada todavia

Ese matiz importa para auditoria y para no castigar al tecnico por condiciones de senal o interiores.

## 3.2 GPS de conformidad

No hace falta abrir otra migracion en la primera etapa.

Recomendacion:

- guardar snapshot GPS de la conformidad dentro de `installation_conformities.metadata_json`
- incluir `lat`, `lng`, `accuracy_m`, `captured_at`, `capture_status`, `capture_source`, `maps_url`

Si mas adelante se necesita filtrar/reportar conformidades por GPS en SQL, ahi si conviene promover esos campos a columnas propias.

## 3.3 Coordenadas de referencia para geofence

No mezclar esto con la fase 1.

Opciones:

1. Pragmatica: agregar a `installations`
   - `site_lat`
   - `site_lng`
   - `site_radius_m`
2. Mas limpia a futuro: crear una tabla `sites`
   - mejor si varios registros comparten ubicacion fisica

Recomendacion para este repo:

- arrancar pragmaticamente con columnas `site_*` en `installations` cuando se abra la fase 3
- no introducir una tabla `sites` hasta que exista un caso claro de reutilizacion cross-record

---

## 4) Contrato API recomendado

Agregar un objeto `gps` opcional a los payloads de escritura.

### Endpoints a extender

- `POST /web/records`
- `POST /web/installations/:id/incidents`
- `POST /web/installations/:id/conformity`
- opcional luego: `PUT /web/installations/:id` para setear coordenadas de referencia del sitio

### Shape sugerido

```json
{
  "gps": {
    "lat": -34.9011,
    "lng": -56.1645,
    "accuracy_m": 18,
    "captured_at": "2026-03-23T21:32:11.000Z",
    "source": "browser",
    "status": "captured",
    "note": ""
  }
}
```

Para override en fases posteriores:

```json
{
  "gps": {
    "status": "override",
    "source": "override",
    "note": "Sin senal en sala tecnica del subsuelo"
  }
}
```

### Reglas de validacion en Worker

- `lat` entre `-90` y `90`
- `lng` entre `-180` y `180`
- `accuracy_m` no negativa
- `captured_at` en ISO valido
- `status` restringido a enum conocida
- si `status = captured`, `lat/lng/accuracy_m/captured_at` deben venir completos
- si `status = override`, `note` debe ser obligatoria

---

## 5) Cambios por capa

## 5.1 Dashboard web/PWA

Archivos principales:

- `dashboard.js`
- `dashboard-incidents.js`
- `dashboard-api.js`
- `dashboard.html` si hace falta UI adicional

### Registro manual (`/web/records`)

Agregar al modal de nuevo registro:

- boton `Capturar ubicacion`
- estado visual: `Ubicacion capturada`, `Permiso denegado`, `Sin senal`, `No disponible`
- resumen visible con lat/lng simplificados y precision `+- Xm`
- reintento manual antes de enviar

No usar `watchPosition`. Solo captura puntual.

### Incidencias (`/web/installations/:id/incidents`)

Agregar al flujo de `createIncidentFromWeb()`:

- intento de captura al abrir el modal o al hacer click en `Capturar ubicacion`
- inclusion del objeto `gps` en `api.createIncident()`
- UI para no esconder la falta de GPS

### Conformidad (`/web/installations/:id/conformity`)

Cuando el flujo de conformidad se use desde dashboard:

- capturar GPS antes de generar PDF
- mostrar al tecnico si el dato es usable o si quedara como excepcion
- si luego se exige GPS, pedir motivo de override en el mismo flujo

### Requisitos UX

- nunca bloquear por default en el MVP
- siempre mostrar precision
- dejar claro que el permiso es puntual para ese cierre/incidencia
- no volver el formulario frágil si el browser rechaza el permiso

## 5.2 Worker

Archivos principales:

- `worker/routes/records.js`
- `worker/routes/incidents.js`
- `worker/routes/conformities.js`
- `worker/routes/installations.js`
- `worker/services/conformities.js`
- `worker/lib/core.js` o helper nuevo para validacion GPS

Trabajo recomendado:

1. Crear helper de normalizacion/validacion GPS reutilizable.
2. Persistir GPS en `installations` al crear registros.
3. Persistir GPS en `incidents` al crear incidencias.
4. Incluir snapshot GPS en `installation_conformities.metadata_json`.
5. Registrar en audit logs:
   - capturas con override
   - geofence fallida
   - geofence override
6. Exponer los campos GPS en respuestas GET para dashboard y mobile.

## 5.3 PDF de conformidad

Archivos principales:

- `worker/services/conformities.js`
- `worker/routes/conformities.js`

Extender el PDF para incluir:

- coordenadas
- precision
- timestamp de captura
- link a Google Maps o equivalente
- estado de captura si no hubo dato valido

Recomendacion de rollout:

1. Version 1 del PDF:
   - solo texto + link
2. Version 2:
   - mapa estatico embebido si existe provider configurado

La generacion del PDF no debe fallar por no poder obtener un mapa estatico. El mapa es best-effort; el documento debe salir igual con texto y link.

## 5.4 Mobile app Expo

No meter esto en la primera entrega salvo que el alcance cambie.

Motivo:

- `navigator.geolocation` cubre browser/PWA
- Expo nativa requiere otra dependencia/capa de permisos
- mezclar ambos tracks aumenta riesgo y difumina la salida del MVP

Si despues se quiere paridad nativa:

- abrir una fase aparte con `mobile-app/`
- alinear tipos en `mobile-app/src/types/api.ts`
- evaluar `expo-location`

---

## 6) Plan por fases

## Fase 1: GPS tagging MVP

### Objetivo

Capturar y guardar GPS en registros e incidencias, sin geofence ni bloqueo.

Estado actual: implementada.

### Trabajo

1. Crear migracion D1 para columnas GPS en `installations` e `incidents`.
2. Extender tipos de API y respuestas.
3. Agregar validacion GPS en Worker.
4. Agregar captura puntual en dashboard:
   - nuevo registro manual
   - nueva incidencia
5. Mostrar estado de captura en UI y payload final.
6. Cubrir tests de contrato y UI.

### Entregable

- El tecnico puede crear un registro o incidencia con GPS adjunto cuando el browser lo permite.
- Si falla, queda traza del motivo sin romper el flujo.

## Fase 2: GPS en conformidad y PDF

### Objetivo

Cerrar la cadena probatoria en el documento final.

Estado actual: implementada.

### Trabajo

1. Extender payload de conformidad para aceptar `gps`.
2. Guardar snapshot GPS en `installation_conformities.metadata_json`.
3. Renderizar coordenadas, precision y timestamp en PDF.
4. Agregar link a mapa.
5. Si hay provider configurado, evaluar mapa estatico best-effort.

### Entregable

- El PDF de conformidad muestra evidencia geografica util y honesta.

## Fase 3: Geofencing soft

### Objetivo

Medir sin bloquear.

Estado actual: implementada en codigo.

### Prerrequisito

Modelar coordenadas de referencia del sitio (`site_lat`, `site_lng`, `site_radius_m`) para instalaciones donde tenga sentido.

### Trabajo

1. Crear migracion para coordenadas de referencia.
2. Agregar UI administrativa para cargarlas o editarlas.
3. Implementar Haversine en Worker.
4. Calcular distancia en operaciones relevantes:
   - crear incidencia
   - generar conformidad
5. Persistir resultado:
   - distancia medida
   - radio permitido
   - resultado `inside` o `outside`
6. Mostrar warning, no bloqueo.
7. Registrar metricas de tasa de fallos y precision observada.

### Entregable

- El sistema sabe si el tecnico esta dentro o fuera del radio, pero no rompe operacion.

## Fase 4: Geofencing hard con override auditado

### Objetivo

Aplicar control real solo donde ya haya datos suficientes.

Estado actual: implementada a nivel tecnico y pendiente de activacion operativa por tenant/flujo.

### Trabajo

1. Habilitar politica por tenant o por flujo.
2. Si `outside`:
   - bloquear por default
   - permitir override solo con motivo obligatorio
3. Registrar override en audit log con:
   - usuario
   - timestamp
   - distancia
   - radio
   - accuracy
   - motivo
4. Exponer la excepcion en UI y PDF si corresponde.

### Entregable

- Control fuerte, pero sin agujeros de auditoria.

---

## 7) Orden de PRs recomendado

1. PR 1: migracion D1 + helpers de validacion GPS + tipos API.
2. PR 2: captura GPS en nuevo registro manual.
3. PR 3: captura GPS en creacion de incidencia.
4. PR 4: snapshot GPS en conformidad + PDF con texto/link.
5. PR 5: observabilidad y auditoria de fallos/overrides.
6. PR 6: coordenadas de referencia + geofence soft.
7. PR 7: geofence hard con override auditado.

No conviene meter mapa estatico en el mismo PR del MVP. Es valor agregado, no prerrequisito.

---

## 8) Testing requerido

## 8.1 Worker

Agregar tests en `tests_js/worker/` para:

- validacion de payload GPS valido
- rechazo de coordenadas invalidas
- creacion de registro con GPS
- creacion de incidencia con GPS
- conformidad con snapshot GPS en `metadata_json`
- override con motivo obligatorio

## 8.2 Dashboard

Agregar tests en `tests_js/` para:

- mock de `navigator.geolocation`
- exito de captura
- permiso denegado
- timeout/unavailable
- inclusion del objeto `gps` en `api.createRecord()` y `api.createIncident()`

## 8.3 Smoke manual

Validar en navegador real:

- HTTPS o localhost
- Android Chrome
- iPhone Safari
- desktop Chrome/Edge
- interior con precision mala
- caso de permiso denegado

---

## 9) Observabilidad y auditoria

El MVP tiene que medir, no solo guardar.

Agregar a auditoria o logs operativos:

- cantidad de capturas exitosas
- cantidad de `denied`
- cantidad de `timeout`
- cantidad de `override`
- precision promedio y percentiles por flujo

Esto sirve para decidir despues:

- si el GPS puede pasar a obligatorio
- que radios de geofence son realistas por tipo de sitio
- en que clientes interiores el GPS no es confiable

---

## 10) Riesgos y mitigaciones

### Precision mala en interiores

Mitigacion:

- guardar `gps_accuracy_m`
- no usar geofence hard hasta tener datos reales
- mostrar `+- Xm` en UI y PDF

### Bloqueo operativo por falta de senal

Mitigacion:

- MVP sin bloqueo
- fase hard solo con override auditado

### Falta de coordenadas de referencia

Mitigacion:

- no prometer geofence sobre flujos que hoy no tienen baseline de sitio
- modelar `site_*` antes de activar validacion

### Dependencia de proveedor de mapa

Mitigacion:

- PDF debe funcionar sin mapa estatico
- usar provider solo como enhancement

### Privacidad y clima laboral

Mitigacion:

- captura puntual, no tracking continuo
- texto claro de consentimiento/uso en UI o politica interna

---

## 11) Criterios de cierre por etapa

### MVP cerrado cuando

- existe migracion aplicada en D1
- dashboard puede adjuntar GPS a registros e incidencias
- Worker valida y persiste GPS
- GETs devuelven los campos GPS
- tests de Worker y dashboard cubren casos principales

### Etapa PDF cerrada cuando

- conformidad acepta snapshot GPS
- PDF muestra coordenadas, precision y timestamp
- el PDF sigue generandose aun sin mapa estatico

### Etapa geofence soft cerrada cuando

- existen coordenadas de referencia por sitio donde aplique
- Worker calcula distancia server-side
- la UI advierte fuera de radio
- se registran metricas de precision y fuera-de-radio

### Etapa geofence hard cerrada cuando

- la politica puede activarse por tenant o flujo
- override deja traza completa
- el bloqueo no depende de logica solo cliente

---

## 14) Proximos pasos recomendados

La mejor continuacion ya no es abrir otra ronda grande de implementacion. La prioridad correcta ahora es cerrar rollout y operacion.

### 14.1 Validacion de despliegue

- confirmar que `0017_geolocation_capture.sql`, `0018_geofencing_soft.sql` y `0019_geofence_hard_overrides.sql` esten aplicadas en D1 local, preview y produccion
- confirmar que las respuestas GET realmente expongan los campos GPS/geofence esperados en el entorno desplegado
- validar que el dashboard servido desde `public/` tenga sincronizados los assets mas recientes

### 14.2 Politica operativa

- definir que tenants o flujos usan hard geofence
- definir radios iniciales por tipo de sitio
- definir quien puede cargar/editar `site_lat`, `site_lng` y `site_radius_m`
- definir si conformidad sin GPS usable queda permitida solo con override o sigue como recomendacion

### 14.3 Configuracion

- documentar y cargar variables de entorno para activar hard geofence
- mantener una tabla operativa simple con:
  - tenant
  - flujo
  - hard geofence on/off
  - radio default recomendado

Variables a dejar documentadas:

- `GEOFENCE_HARD_ENABLED`
- `GEOFENCE_HARD_FLOWS`
- `GEOFENCE_HARD_TENANTS`

### 14.4 Smoke manual de cierre

- Android Chrome
- iPhone Safari
- desktop Chrome/Edge
- permiso denegado
- timeout o unavailable
- precision mala en interior
- incidencia fuera de radio con override
- conformidad fuera de radio con override
- PDF final con bloque GPS/geofence correcto

### 14.5 Enhancement opcional posterior

- mapa estatico embebido en PDF como best-effort
- solo despues de cerrar rollout, policy y smoke tests

---

## 12) Archivos probables a tocar

- `migrations/0017_geolocation_capture.sql`
- `worker/routes/records.js`
- `worker/routes/incidents.js`
- `worker/routes/conformities.js`
- `worker/services/conformities.js`
- `worker/routes/installations.js`
- `dashboard-api.js`
- `dashboard.js`
- `dashboard-incidents.js`
- `tests_js/worker/routes.test.mjs`
- `tests_js/worker.contract.test.mjs`
- `tests_js/dashboard.unit.test.mjs`
- `README.md`

---

## 13) Recomendacion final

Para este repo, la mejor secuencia no es "geofence primero".

La mejor secuencia es:

1. GPS tagging en dashboard/PWA.
2. GPS visible en conformidad/PDF.
3. Recolectar datos reales de precision por sitio.
4. Recién ahi definir radios y politicas de bloqueo.

Eso te da valor probatorio rapido, evita friccion en campo y reduce el riesgo de imponer una regla de geofencing antes de tener una referencia geografica y estadistica confiable.
