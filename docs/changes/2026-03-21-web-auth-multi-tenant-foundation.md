# 2026-03-21 - base de auth web y aislamiento multi-tenant

## Resumen

Se consolida la direccion del proyecto hacia autenticacion web como modelo objetivo y hacia aislamiento por tenant como base vendible del sistema.

## Areas tocadas

- auth
- worker
- desktop
- mobile
- multi-tenant
- auditoria

## Contexto

Tomando como referencia `docs/auth-modes.md` y `docs/multi-tenant-rollout.md`, para esta etapa el proyecto ya reflejaba una transicion clara:

- `web` pasa a ser el flujo recomendado para clientes distribuidos
- `legacy` queda acotado a compatibilidad controlada
- `auto` se usa como puente para desktop en migracion
- el Worker empieza a ordenar su modelo de sesion web sobre `WEB_SESSION_KV` y `WEB_SESSION_SECRET`
- el track multi-tenant define `tenant_id` como filtro obligatorio para datos criticos
- la auditoria operativa se centraliza como fuente unica por tenant

## Cambios clave

- se formaliza la separacion entre auth web y HMAC legacy
- se define el uso de `tenant_id` como regla de oro para lecturas y escrituras
- se prepara el terreno para RBAC por empresa y limites por plan
- mobile se alinea con auth web y deja fuera el modelo de secretos HMAC globales en distribucion

## Impacto

- el proyecto gana una direccion mas segura y distribuible
- se reduce la dependencia de secretos compartidos en cliente
- se establece una base mas robusta para vender y operar el sistema en esquema multiempresa

## Referencias

- `docs/auth-modes.md`
- `docs/multi-tenant-rollout.md`

## Validacion

- nota retroactiva construida desde la documentacion y el estado funcional descrito en el repo
- representa una consolidacion de arquitectura y politica operativa, no necesariamente el cierre final de todo el rollout
