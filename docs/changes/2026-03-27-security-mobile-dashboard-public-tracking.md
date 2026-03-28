# 2026-03-27 - seguridad, mobile, dashboard y public tracking

## Resumen

Se aplica un bloque de mejoras sobre cuatro frentes: secretos locales, performance mobile, accesibilidad y responsive del dashboard, y endurecimiento tecnico de `public-tracking`.

## Areas tocadas

- seguridad y deploy
- worker
- mobile app
- dashboard web
- cliente publico de tracking
- documentacion operativa

## Contexto

La pasada parte de una auditoria previa sobre riesgos criticos y altos en seguridad, performance mobile, accesibilidad y superficie publica. El objetivo fue bajar riesgo inmediato y ordenar mejor la base tecnica para despliegues y nuevas iteraciones.

## Cambios clave

- se elimina del workspace una credencial Firebase expuesta y se reemplaza por una plantilla segura
- se incorpora un endpoint puntual para detalle de incidencia y se reduce el sobre-fetch desde mobile
- se agregan labels reales al formulario de drivers y un modo de lectura mas usable para tablas en mobile
- se endurece `public-tracking` en headers, estados visibles de conexion y tono visual

## Impacto

- menor riesgo de exposicion accidental de credenciales
- mejor guia para deploy seguro
- mejor aislamiento de la superficie publica de tracking
- menor transferencia y menor trabajo del cliente mobile al abrir detalle de incidencia
- mejor accesibilidad en dashboard
- mejor lectura en pantallas chicas
- tracking publico mas claro sobre su estado de actualizacion

## Referencias

- `worker/routes/incidents.js`
- `worker.js`
- `mobile-app/src/api/incidents.ts`
- `mobile-app/app/incident/detail.tsx`
- `dashboard.html`
- `dashboard.js`
- `dashboard-assets.js`
- `dashboard-audit.js`
- `dashboard.css`
- `public/dashboard.html`
- `public/dashboard.js`
- `public/dashboard-assets.js`
- `public/dashboard-audit.js`
- `public/dashboard.css`
- `worker/lib/public-tracking.js`
- `public-tracking.js`
- `public-tracking.css`
- `public/public-tracking.js`
- `public/public-tracking.css`
- `README.md`
- `docs/secure-deploy.md`
- `firebase-service-account.example.json`

## Validacion

- `node --test tests_js/dashboard.accessibility.test.mjs`
- `node --test tests_js/worker/routes.test.mjs`
- import de `worker.js` validado correctamente
- compilacion TypeScript mobile validada con `mobile-app\\node_modules\\.bin\\tsc.cmd -p mobile-app\\tsconfig.json --noEmit`

## Pendientes

- si la credencial Firebase eliminada era real, todavia requiere rotacion y revocacion fuera del repo
- conviene seguir documentando futuros bloques de trabajo en `docs/changes/`
