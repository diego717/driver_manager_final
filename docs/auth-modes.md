# Auth modes

Esta es la referencia canonica para los modos de autenticacion activos en SiteOps.

## Regla principal

- `web` es el flujo recomendado para clientes distribuidos.
- `legacy` queda solo para integraciones privadas o compatibilidad controlada.
- `auto` existe para transicion operativa del desktop, no como modelo objetivo de largo plazo.

## Desktop

Variable principal:

```text
DRIVER_MANAGER_DESKTOP_AUTH_MODE=legacy|web|auto
```

### `legacy`

- Login contra `users.json` y rutas firmadas con HMAC.
- Requiere `api_token`, `api_secret` y `DRIVER_MANAGER_API_TENANT_ID`.
- Usar solo cuando el entorno esta controlado y no hay migracion completa a `/web/*`.

### `web`

- Login por `username/password` contra `/web/auth/login`.
- Consume solo endpoints `/web/*` con Bearer.
- No requiere secretos HMAC globales en el cliente.

### `auto`

- Intenta sesion web primero.
- Solo cae a HMAC si hay credenciales legacy configuradas de forma explicita.
- Sirve como modo de compatibilidad durante migraciones.

## Mobile

- Produccion usa solo `/web/*` + Bearer de sesion corta.
- No debe distribuir `API_SECRET` ni `API_TOKEN`.
- Expo web usa cookie de sesion `HttpOnly` para autenticacion y solo persiste metadata no sensible en `sessionStorage`.

## Worker

- `/web/*`: Bearer + `WEB_SESSION_KV` + `WEB_SESSION_SECRET`.
- Rutas no web firmadas: solo para HMAC legacy y con tenant acotado por `DRIVER_MANAGER_API_TENANT_ID`.
- Requests mobile distribuidos con `X-Client-Platform: mobile` no deben usar HMAC legacy.

## Bootstrap y usuarios web

- `POST /web/auth/bootstrap`: crear primer usuario web.
- `POST /web/auth/login`: abrir sesion.
- `GET /web/auth/me`: validar contexto actual.
- `POST /web/auth/logout`: revocar sesion.
- `POST /web/auth/import-users`: migrar hashes legacy a `web_users`.

## Decisiones operativas

- Si el cliente es publico o distribuido: usar `web`.
- Si el cliente es un desktop interno en transicion: usar `auto`.
- Si el flujo depende de secretos globales: documentar por que sigue en `legacy` y fecha estimada de retiro.
