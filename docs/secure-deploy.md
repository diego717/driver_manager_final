# Secure deploy

Guia corta para despliegues del Worker y activos web sin relajar controles.

## Antes de desplegar

1. Confirmar que `wrangler.toml` y los bindings remotos esten alineados.
2. Verificar secretos remotos necesarios:
   - `WEB_SESSION_SECRET`
   - `WEB_LOGIN_PASSWORD`
   - `DRIVER_MANAGER_API_TENANT_ID` si todavia existe HMAC legacy operativo
3. Confirmar que `RATE_LIMIT_KV` y `WEB_SESSION_KV` existan y no apunten al mismo store.
4. Regenerar assets del dashboard si cambiaste `dashboard*.js/html/css`.

## Comandos canonicos

Chequeo previo:

```powershell
npm run deploy:check
```

Deploy normal:

```powershell
npm run deploy
```

Deploy completo con migraciones:

```powershell
npm run deploy:full
```

## Comportamientos esperados

- `npm run deploy` debe fallar temprano si falta configuracion de seguridad critica.
- `npm run dashboard:sync-assets` debe ejecutarse antes de servir o desplegar cambios del dashboard.
- No se deben usar URLs productivas hardcodeadas en scripts administrativos.

## Verificaciones post deploy

- `GET /health` responde `200`.
- Login web funciona.
- `GET /web/dashboard` sirve el build esperado.
- `npm run tail` no muestra errores de bindings faltantes.

## No hacer

- No desplegar con `ALLOW_INSECURE_WEB_AUTH_FALLBACK`.
- No mezclar cambios de migracion D1 con cambios grandes de contrato sin tests verdes.
- No publicar mobile distribuida con HMAC global activo en cliente.
