# Runbook retirado: geofence

Al 2 de abril de 2026, geofence fue retirado del flujo activo del producto.

Este documento queda solo como referencia historica para entender:

- por que existen migraciones `0018_geofencing_soft.sql` y `0019_geofence_hard_overrides.sql`
- por que persisten columnas `site_*` y `geofence_*` en algunos esquemas y lecturas
- por que puede haber auditoria o datos historicos con referencias a geofence

Estado actual:

- GPS tagging sigue vigente
- geofence no debe activarse ni documentarse como capacidad operativa actual
- cualquier variable `GEOFENCE_HARD_*` debe considerarse obsoleta

Si en el futuro se quisiera reintroducir una restriccion geoespacial, conviene crear una propuesta nueva desde cero en lugar de reactivar este rollout historico.
