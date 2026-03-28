# 2026-03-27 - rollout inicial de public tracking con magic link

## Resumen

Se incorpora el seguimiento publico de estado para cliente final mediante Magic Link de solo lectura, con snapshot publico, expiracion, revocacion, rate limiting y actualizacion via SSE.

## Areas tocadas

- worker
- dashboard web
- KV
- SSE
- superficie publica de tracking

## Contexto

Segun `docs/public-tracking-magic-link-implementation-plan.md` y el estado del repo:

- se define `installation` como entidad estable para el MVP
- se introduce `PUBLIC_TRACKING_KV`
- se usa `PUBLIC_TRACKING_SECRET` para firma del token
- se incorpora `PUBLIC_TRACKING_BASE_URL` para resolver el host canonico publico
- se implementan rutas web para emitir, consultar y revocar links
- se implementan rutas publicas `/track/:token`, `/track/:token/state` y `/track/:token/events`
- se agrega cliente publico de lectura con actualizacion en tiempo real
- se protege la superficie anonima con rate limiting especifico

## Cambios clave

- se crea una superficie publica controlada y de solo lectura
- se resuelve el estado compartible desde KV en vez de depender de D1 en cada request publico
- se reutiliza el stack de realtime para un caso externo de bajo alcance

## Impacto

- el proyecto gana una superficie de consulta externa sin requerir cuenta
- se separa mejor la informacion interna de la informacion visible para cliente final
- se extiende el uso del broker realtime a un caso publico de bajo scope

## Referencias

- `docs/public-tracking-magic-link-implementation-plan.md`
- `README.md`

## Validacion

- nota retroactiva basada en el plan, la documentacion y el estado ya descrito en el repo
- la etapa tecnica figura como implementada, mientras que el rollout real dependia de bindings, secrets y smoke manual
