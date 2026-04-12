# 2026-04-12 - presupuestos por instalacion y bloqueo de conformidad sin aprobado

## Resumen

- se implementa un flujo de presupuesto separado para instalaciones (creacion, PDF, email e historial)
- se mantiene la conformidad final como flujo independiente, pero ahora exige presupuesto aprobado
- se bloquea el cierre de conformidad cuando no existe un presupuesto aprobado para la instalacion
- se agrega excepcion comercial por instalacion para garantia/abono/cortesia, permitiendo cierre sin presupuesto cuando corresponde

## Areas tocadas

- worker (rutas, servicios, auditoria)
- migraciones D1
- dashboard web y assets publicados
- tests js (worker y dashboard)
- contratos tipados mobile (sin UI nueva)

## Contexto

El flujo anterior permitia cerrar conformidad sin una referencia formal de presupuesto aprobado. Esta version agrega trazabilidad comercial y evita cierres operativos sin aprobacion economica previa.

## Cambios clave

- datos
  - nueva tabla `installation_budgets` con estados de envio/aprobacion, montos en centavos y metadatos de auditoria
  - nuevo `budget_id` en `installation_conformities`
  - indices para historial, ultimo aprobado y unicidad de `budget_number` por tenant
  - nuevos campos en `installations`: `commercial_closure_mode`, `commercial_closure_note`, `commercial_closure_set_at`, `commercial_closure_set_by`
- API de presupuestos
  - `POST /web/installations/:installation_id/budgets`
  - `GET /web/installations/:installation_id/budgets`
  - `GET /web/installations/:installation_id/budgets/latest`
  - `GET /web/installations/:installation_id/budgets/:budget_id/pdf`
  - `POST /web/installations/:installation_id/budgets/:budget_id/approve`
- regla de conformidad
  - `POST /web/installations/:installation_id/conformity` acepta `budget_id` opcional
  - si no llega `budget_id`, resuelve automaticamente el ultimo aprobado
  - si no existe aprobado, responde `409` y bloquea el cierre
  - si llega `budget_id`, valida tenant/instalacion y que sea el ultimo aprobado
  - excepcion comercial: si `commercial_closure_mode` no requiere presupuesto (`warranty_included`, `plan_included`, `courtesy_included`), permite conformidad sin `budget_id`
  - en modo sin presupuesto, exige `commercial_closure_note` para trazabilidad
- PDF y email
  - nuevo PDF de presupuesto con secciones de incidencia, alcance, exclusiones, costos, plazo, validez y aprobacion
  - envio por Resend con adjunto PDF y `delivery_status` (`emailed` o `email_failed`)
- auditoria
  - eventos `generate_installation_budget` y `approve_installation_budget`
  - auditoria de conformidad extendida con `budget_id` y `budget_number`
- dashboard web
  - CTA `Presupuesto` en el header del caso
  - boton `Cobertura` para definir si el caso requiere presupuesto o queda cubierto por garantia/abono/cortesia
  - panel de estado (ultimo generado y ultimo aprobado)
  - modal de creacion de presupuesto
  - modal de aprobacion con `approved_by_name` y `approved_by_channel`
  - bloque de presupuesto asociado en conformidad y submit con `budget_id`
  - boton de conformidad deshabilitado cuando no hay incidencias activas, no hay presupuesto aprobado y el caso si requiere presupuesto

## Impacto

- funcional
  - mejora la trazabilidad entre presupuesto comercial y cierre tecnico
  - evita cierres sin aprobacion economica
- operativo
  - agrega historial y estado de aprobacion para seguimiento del caso
  - define politica de reemplazo: solo habilita cierre el ultimo presupuesto aprobado
- compatibilidad
  - mobile no suma UI en v1
  - backend mantiene compatibilidad si no se envia `budget_id`, siempre que pueda autoresolver el ultimo aprobado

## Referencias

- `migrations/0026_installation_budgets.sql`
- `migrations/0027_installations_commercial_closure_mode.sql`
- `worker/services/budgets.js`
- `worker/routes/budgets.js`
- `worker/routes/conformities.js`
- `worker/services/conformities.js`
- `worker.js`
- `worker/routes/system.js`
- `dashboard-api.js`
- `dashboard-incidents.js`
- `mobile-app/src/types/api.ts`
- `tests_js/worker/budgets.test.mjs`
- `tests_js/worker/conformities.test.mjs`
- `tests_js/dashboard.unit.test.mjs`
- `tests_js/dashboard.accessibility.test.mjs`
- `tests_js/helpers/dashboard.test-helpers.mjs`

## Validacion

- `npm run test:worker:raw` -> pass
- `node --test tests_js/worker/conformities.test.mjs tests_js/worker/budgets.test.mjs` -> pass
- `node --test tests_js/worker/routes.test.mjs` -> pass
- `node --test tests_js/worker.contract.test.mjs` -> pass
- dashboard:
  - tests focalizados del flujo nuevo de presupuesto/conformidad -> pass
  - existen fallos preexistentes no vinculados (copy/encoding/login/export)
- `npm run dashboard:sync-assets` ejecutado para publicar assets actualizados
