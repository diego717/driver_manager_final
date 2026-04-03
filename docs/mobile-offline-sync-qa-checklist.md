# Checklist QA - Mobile Offline Sync

## Objetivo

Validar que el flujo offline-first de mobile funcione de punta a punta para:

- `create_case`
- `create_incident`
- `update_incident_evidence`
- `upload_photo`

Tambien validar:

- persistencia local entre reinicios
- reintentos de sync
- orden correcto de jobs dependientes
- ausencia de duplicados
- asociaciones correctas entre caso, incidencia y fotos

## Como registrar resultado

Usar una entrada por prueba:

```md
## Prueba N - nombre corto
- Estado: OK / FALLA / PARCIAL
- Fecha:
- Build:
- Dispositivo:
- Red inicial: online / offline
- Resultado esperado:
- Resultado real:
- Observaciones:
```

## Pruebas

### 1. Caso manual offline

- apagar red
- abrir `Caso manual`
- completar cliente y nota
- guardar
- confirmar que la app no falle
- cerrar completamente la app
- volver a abrir
- activar red
- confirmar que el caso aparezca en servidor

Resultado esperado:

- el caso queda guardado localmente sin perderse
- al volver la conectividad se sincroniza
- no se crea duplicado

### 2. Caso manual + incidencia inicial offline

- apagar red
- crear caso manual
- completar tambien la incidencia inicial
- guardar
- cerrar completamente la app
- volver a abrir
- activar red
- confirmar que primero se cree el caso y luego la incidencia

Resultado esperado:

- el caso aparece en servidor
- la incidencia aparece asociada al caso correcto
- no hay duplicados

### 3. Incidencia offline en caso existente

- partir de un caso remoto ya existente
- apagar red
- crear una nueva incidencia
- confirmar guardado local
- cerrar y reabrir la app
- activar red
- confirmar que la incidencia llega al backend

Resultado esperado:

- la incidencia se sincroniza despues
- queda asociada al caso correcto

### 4. Metadata de evidencia offline

- apagar red
- abrir `Subir foto` para una incidencia existente
- marcar checklist
- escribir nota operativa
- guardar
- cerrar y reabrir la app
- activar red
- confirmar que checklist y nota llegan al backend

Resultado esperado:

- la metadata no se pierde
- sincroniza al volver la red

### 5. Fotos offline

- apagar red
- abrir `Subir foto`
- confirmar una o mas fotos
- guardar
- cerrar y reabrir la app
- activar red
- confirmar que las fotos suben correctamente

Resultado esperado:

- las fotos quedan en cola
- luego se sincronizan
- no quedan asociadas a otra incidencia

### 6. Cadena completa offline

- apagar red
- crear caso manual
- crear incidencia inicial
- cargar checklist
- escribir nota operativa
- confirmar fotos
- guardar
- cerrar y reabrir la app
- activar red
- esperar sync

Resultado esperado:

- orden correcto:
  - caso
  - incidencia
  - metadata de evidencia
  - fotos
- todo queda asociado correctamente

### 7. Retry manual

- provocar un fallo de red o backend temporal
- verificar que el banner de sync refleje pendiente o error
- usar reintento manual
- confirmar que luego sincronice

Resultado esperado:

- el trabajo no se pierde
- el reintento funciona

### 8. Persistencia entre reinicios

- guardar datos offline
- cerrar completamente la app
- abrir nuevamente
- verificar que los jobs sigan pendientes

Resultado esperado:

- los jobs y datos siguen presentes
- no se pierde la cola local

### 9. Duplicados

- repetir reintento manual
- abrir/cerrar la app varias veces antes de recuperar red
- verificar backend

Resultado esperado:

- no se crean casos duplicados
- no se crean incidencias duplicadas
- no se suben fotos duplicadas

### 10. Asociaciones correctas

- revisar en backend o UI final:
  - caso correcto
  - incidencia correcta
  - fotos correctas

Resultado esperado:

- cada foto pertenece a la incidencia correcta
- cada incidencia pertenece al caso correcto

### 11. Cache offline del mapa de incidencias asignadas

- abrir pestaña `Mapa` con red
- confirmar que carga incidencias asignadas con destino operativo
- apagar red
- cerrar completamente la app
- volver a abrir
- entrar otra vez en `Mapa`

Resultado esperado:

- la vista muestra la ultima cola sincronizada disponible
- los campos `dispatch_*` y `target_*` siguen visibles en la card
- la app indica que esta usando cache offline o ultima lectura disponible

### 12. Fallback offline de lista y detalle de incidencias

- abrir un caso con incidencias teniendo red
- entrar al detalle de una incidencia y volver
- apagar red
- volver a `Casos`
- abrir nuevamente la misma incidencia

Resultado esperado:

- la lista del caso sigue mostrando las incidencias previamente sincronizadas
- el detalle abre usando el ultimo snapshot local disponible
- siguen visibles `dispatch_*`, estado y datos operativos basicos aun sin red

### 13. Cola offline de trabajo por tecnico

- iniciar sesion con un tecnico vinculado y con asignaciones activas
- abrir `Trabajo` con red
- confirmar que carga la cola y el resumen de asignaciones
- apagar red
- cerrar completamente la app
- volver a abrir
- entrar otra vez en `Trabajo`

Resultado esperado:

- la vista sigue mostrando la ultima cola sincronizada del tecnico
- no depende de recomponer incidencias una por una desde API
- se mantiene el conteo basico de asignaciones, casos y prioridades

### 14. Indicadores visibles de snapshot local

- abrir `Trabajo` y `Detalle incidencia` con red
- apagar red
- volver a abrir ambos flujos usando datos previamente sincronizados

Resultado esperado:

- `Trabajo` muestra un indicador visible de `Snapshot local`
- el bloque de tecnico activo aclara que se usa la ultima cola sincronizada
- `Detalle incidencia` muestra aviso de ultimo snapshot local disponible

### 15. Seguridad local basica

Si inspeccionas almacenamiento local del dispositivo:

- revisar Watermelon/SQLite
- confirmar que no aparezcan en claro:
  - notas sensibles
  - cliente sensible
  - rutas locales de fotos
  - nombres reales de archivos sensibles

Resultado esperado:

- esos datos no deben quedar expuestos en claro dentro de SQLite

## Campos recomendados para bug report

Si una prueba falla, registrar:

- prueba
- paso exacto
- mensaje visto en pantalla
- estado de red
- si el fallo fue:
  - no sincroniza
  - duplica
  - asocia mal
  - pierde datos
  - muestra error inesperado
- si se recupera al reintentar

## Estado de cierre sugerido

Se puede considerar el rollout razonablemente validado cuando:

- todas las pruebas 1 a 10 pasan
- la 11 confirma cache offline util en mapa
- la 12 confirma fallback offline util en lista y detalle
- la 13 confirma cola offline util en `Trabajo`
- la 14 confirma indicadores visibles de snapshot local
- la 15 no muestra exposicion evidente de datos sensibles
- no aparecen duplicados en backend
- el orden de sync encadenado se mantiene estable
