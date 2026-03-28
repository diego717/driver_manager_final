# Regla de documentacion de cambios

Este proyecto debe dejar rastro simple y claro de los cambios relevantes durante su evolucion.

## Regla base

Todo cambio que afecte al menos una de estas areas debe dejar una nota en `docs/changes/`:

- backend o rutas del Worker
- dashboard web o assets publicados
- mobile app
- desktop
- auth, seguridad, secretos o deploy
- contratos, migraciones o comportamiento funcional

## Donde se documenta

- Historial detallado: `docs/changes/`
- Indice resumido: `docs/changes/INDEX.md`
- Regla operativa: este archivo

## Formato recomendado por nota

Cada nota puede usar este esquema base:

```md
# YYYY-MM-DD - tema-del-cambio

## Resumen
- que cambio
- por que cambio

## Areas tocadas
- worker
- dashboard
- mobile

## Contexto
- que problema, etapa o decision explica el cambio

## Cambios clave
- decisiones tecnicas o funcionales principales

## Impacto
- funcional
- operativo
- seguridad
- performance

## Referencias
- rutas, pantallas, servicios, migraciones o docs relacionadas

## Validacion
- tests ejecutados
- smoke manual
- riesgos pendientes
```

Si una nota no necesita todas las secciones, se puede omitir alguna. La prioridad es mantener claridad y consistencia.

## Convencion de nombres

Usar una de estas opciones:

- `YYYY-MM-DD-tema.md`
- `YYYY-MM-DD-area-tema.md`

Ejemplos:

- `2026-03-27-public-tracking.md`
- `2026-03-27-security-and-mobile.md`

## Que no hace falta documentar

No hace falta crear una nota separada para:

- cambios triviales de copy
- formato sin impacto
- refactors internos pequenos sin efecto funcional

Si varios cambios chicos forman parte de una misma jornada o tema, conviene agruparlos en una sola nota.

## Frecuencia sugerida

- minimo una nota por bloque relevante de trabajo
- idealmente el mismo dia del cambio
- actualizar `docs/changes/INDEX.md` al agregar una nota nueva

## Criterio editorial

- usar frases cortas y directas
- preferir ASCII simple para evitar problemas de encoding
- describir el impacto real antes que detallar de mas la implementacion
- mantener el tono operativo, no promocional
