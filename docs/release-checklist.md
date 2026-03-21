# Release checklist

Checklist tecnico corto antes de publicar cambios.

## Codigo y tests

- [ ] `python scripts/run_python_tests.py`
- [ ] `npm run test:web`
- [ ] `cd mobile-app && npm test`
- [ ] `cd mobile-app && npm exec tsc -- --noEmit`

## Build y assets

- [ ] `npm run dashboard:sync-assets` si cambiaste dashboard web
- [ ] No quedan artefactos temporales o archivos de review en root
- [ ] `git status` entendible y sin cambios accidentales

## Seguridad y config

- [ ] `npm run deploy:check`
- [ ] `WEB_SESSION_SECRET` configurado en remoto
- [ ] `WEB_LOGIN_PASSWORD` configurado en remoto
- [ ] `RATE_LIMIT_KV` y `WEB_SESSION_KV` presentes y separados
- [ ] Si sigue existiendo HMAC legacy: `DRIVER_MANAGER_API_TENANT_ID` configurado

## Producto y dominio

- [ ] El nombre visible del producto sigue alineado con `SiteOps`
- [ ] Los textos de error nuevos no rompen encoding en consola Windows
- [ ] No se introdujeron estados o validaciones distintas entre desktop, Worker y mobile

## Deploy

- [ ] Ejecutar `npm run deploy` o `npm run deploy:full` segun corresponda
- [ ] Validar `/health`
- [ ] Validar login web
- [ ] Validar dashboard web y un flujo critico de incidencias

## Post deploy

- [ ] Revisar `npm run tail` o logs remotos
- [ ] Verificar que no haya errores de bindings faltantes
- [ ] Confirmar que mobile y desktop sigan consumiendo el contrato esperado
