# Operational recovery

Pasos de recuperacion para fallos operativos comunes sin volver a abrir deuda vieja.

## 1. Sesion web invalida

Sintoma:

- `Sesion web expirada` en mobile o desktop.

Accion:

1. Cerrar sesion.
2. Volver a iniciar con `/web/auth/login`.
3. Si persiste, verificar `WEB_SESSION_SECRET`, `WEB_SESSION_KV` y version desplegada del Worker.

## 2. Bootstrap inicial faltante

Sintoma:

- No existen usuarios en `web_users`.

Accion:

1. Ejecutar `POST /web/auth/bootstrap`.
2. Confirmar que el primer usuario puede entrar por `/web/auth/login`.
3. Si migras usuarios legacy, correr luego `python sync_r2_users_to_web_d1.py --api-base-url <worker>`.

## 3. Desktop sin acceso por modo web

Sintoma:

- Desktop no puede abrir sesion en modo `web` o `auto`.

Accion:

1. Confirmar `DRIVER_MANAGER_DESKTOP_AUTH_MODE`.
2. Validar `api_url` o `history_api_url` en `config/config.enc`.
3. Si necesitas persistir credenciales legacy para un entorno privado, usar `python sync_desktop_api_auth.py`.

## 4. `config/config.enc` desalineado

Accion:

1. Respaldar `config/config.enc`.
2. Ejecutar `python scripts/normalize_config_enc.py --api-url <worker> --api-token <token> --api-secret <secret>` solo si el entorno realmente sigue en legacy.
3. Evitar editar secretos a mano en texto plano.

## 5. Huella de datos inconsistente en assets o incidencias

Accion:

1. Usar `python scripts/cleanup_orphans.py --base-url <worker> --admin-user <user> --admin-pass <pass> --dry-run`.
2. Revisar resultado.
3. Ejecutar de nuevo con `--yes` solo si el dry-run es correcto.

## 6. Recovery de tenant

- No mover datos entre tenants manualmente desde clientes.
- Si hay duda de aislamiento, revisar primero `tenant_id` en D1 y `r2_key` en R2.
- La guia de flujo de tenant vive en [tenant-request-flow.md](/g:/dev/driver_manager/docs/tenant-request-flow.md).
