# Runbook: activacion de GPS y geofence

Documento operativo corto para activar, validar y revertir GPS/geofence en entornos reales.

Actualizado segun el repo al 2026-03-26.

---

## 0) Alcance

Aplica al stack web actual:

- dashboard/PWA
- Worker Cloudflare
- D1
- PDF de conformidad

No cubre activacion de GPS nativo en Expo.

---

## 1) Estado funcional actual

El repo ya soporta:

- GPS tagging en registros manuales
- GPS tagging en incidencias
- GPS tagging en conformidad
- geofence soft en incidencias y conformidad
- geofence hard con override auditado en incidencias y conformidad
- PDF con bloque GPS/geofence

Lo que depende de operacion no es el codigo base, sino:

- migraciones aplicadas
- configuracion por tenant
- carga de coordenadas del sitio
- validacion manual en dispositivos reales

---

## 2) Pre-checklist de activacion

Antes de habilitar una politica real:

1. Confirmar migraciones D1 aplicadas:
   - `0017_geolocation_capture.sql`
   - `0018_geofencing_soft.sql`
   - `0019_geofence_hard_overrides.sql`
2. Confirmar que el dashboard publicado tenga assets sincronizados.
3. Confirmar que el tenant tenga instalaciones con:
   - `site_lat`
   - `site_lng`
   - `site_radius_m`
4. Confirmar que el equipo operativo entiende la diferencia entre:
   - warning geofence
   - override GPS
   - override geofence
5. Confirmar que auditoria y estadisticas responden correctamente.

Si falta cualquiera de esos puntos, no activar hard geofence.

---

## 3) Secuencia recomendada de rollout

La activacion correcta es gradual:

1. GPS tagging sin bloqueo.
2. Geofence soft con warning y observacion.
3. Recoleccion de precision real por sitio.
4. Hard geofence solo para tenants/sitios ya calibrados.

No activar hard geofence como primer paso.

---

## 4) Variables operativas

Variables relevantes para hard geofence:

- `GEOFENCE_HARD_ENABLED`
- `GEOFENCE_HARD_FLOWS`
- `GEOFENCE_HARD_TENANTS`

Semantica esperada:

- `GEOFENCE_HARD_ENABLED`
  - `true`: habilita evaluacion hard
  - `false`: deja solo soft/warning
- `GEOFENCE_HARD_FLOWS`
  - lista CSV
  - valores esperados: `incidents`, `conformity`
- `GEOFENCE_HARD_TENANTS`
  - lista CSV de tenants autorizados
  - vacio o no definido debe tratarse con cautela segun la politica elegida al desplegar

Ejemplo conservador:

```powershell
$env:GEOFENCE_HARD_ENABLED="true"
$env:GEOFENCE_HARD_FLOWS="incidents"
$env:GEOFENCE_HARD_TENANTS="tenant-a"
```

Ejemplo mas amplio:

```powershell
$env:GEOFENCE_HARD_ENABLED="true"
$env:GEOFENCE_HARD_FLOWS="incidents,conformity"
$env:GEOFENCE_HARD_TENANTS="tenant-a,tenant-b"
```

---

## 5) Activacion por etapa

## 5.1 Etapa A: GPS tagging

Objetivo:

- capturar y persistir GPS sin bloquear operacion

Validaciones:

- registro manual envia `gps`
- incidencia envia `gps`
- conformidad envia `gps`
- PDF muestra GPS cuando existe
- permiso denegado o timeout no rompe flujo

Criterio de salida:

- el flujo funciona en campo y auditoria refleja estados de captura

## 5.2 Etapa B: Geofence soft

Objetivo:

- medir distancia sin bloquear

Validaciones:

- existen instalaciones con `site_*`
- incidencias fuera de radio generan warning
- conformidad fuera de radio genera warning
- dashboard y PDF muestran resultado de geofence

Criterio de salida:

- el equipo ya puede ver que radios reales funcionan y cuales no

## 5.3 Etapa C: Geofence hard

Objetivo:

- exigir override cuando el tecnico quede fuera del radio

Validaciones:

- hard geofence activado solo para tenants seleccionados
- incidencia fuera de radio sin override queda bloqueada
- incidencia fuera de radio con override se registra
- conformidad fuera de radio sin override queda bloqueada
- conformidad fuera de radio con override se registra
- auditoria guarda motivo, distancia, radio y actor

Criterio de salida:

- la operacion entiende el flujo y no hay falsos positivos inaceptables

---

## 6) Smoke test minimo

Ejecutar como minimo:

- Android Chrome
- iPhone Safari
- desktop Chrome o Edge

Casos:

1. Registro manual con GPS capturado.
2. Registro manual con permiso denegado.
3. Incidencia con GPS capturado.
4. Incidencia fuera de radio.
5. Incidencia fuera de radio con override.
6. Conformidad con GPS capturado.
7. Conformidad sin GPS usable con override GPS.
8. Conformidad fuera de radio con override geofence.
9. PDF final mostrando:
   - coordenadas
   - precision
   - timestamp
   - maps link
   - resultado geofence

---

## 7) Señales a monitorear

Mirar especialmente:

- tasa de `captured`
- tasa de `denied`
- tasa de `timeout`
- precision promedio
- p95 de precision
- cantidad de warnings outside
- cantidad de overrides

Si suben mucho `timeout`, `unavailable` o overrides, no endurecer politica todavia.

---

## 8) Carga de coordenadas del sitio

No conviene inventar radios universales.

Recomendacion practica:

- empezar por sitios con buena referencia fisica
- usar radios conservadores
- revisar resultados reales antes de endurecer

Conviene registrar para cada tenant:

- instalacion o sitio
- coordenada de referencia
- radio acordado
- fecha de calibracion
- responsable de la carga

---

## 9) Rollback

Si hay falsos positivos o friccion operativa:

1. Desactivar hard geofence:
   - `GEOFENCE_HARD_ENABLED=false`
2. Mantener geofence soft para seguir observando.
3. No borrar auditoria ni metadata GPS ya registrada.
4. Revisar:
   - radios demasiado chicos
   - coordenadas mal cargadas
   - precision mala en interiores
   - tenant equivocado en activacion

Rollback esperado:

- el sistema vuelve a warning/observacion
- no se pierde trazabilidad historica

---

## 10) Comandos y referencias

Migraciones:

```powershell
npm run d1:migrate
npm run d1:migrate:remote
```

Tests utiles:

```powershell
npm run test:worker
npm run test:dashboard
```

Referencias:

- `README.md`
- `docs/gps-tagging-geofencing-implementation-plan.md`
- `tests_js/worker.contract.test.mjs`
- `tests_js/dashboard.unit.test.mjs`
