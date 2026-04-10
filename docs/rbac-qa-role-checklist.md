# Checklist QA - RBAC por rol

## Objetivo

Validar que la matriz RBAC documentada en `docs/rbac-matriz-web-mobile.md` se refleje de forma consistente en:

- backend
- dashboard web
- mobile app

Tambien validar que cada rol vea solo las vistas correctas y que los flujos principales sigan siendo operables.

## Como registrar resultado

Usar una entrada por prueba:

```md
## Prueba N - nombre corto
- Rol:
- Estado: OK / FALLA / PARCIAL
- Fecha:
- Build / commit:
- Entorno: local / remote / workers.dev
- Plataforma: web / mobile
- Resultado esperado:
- Resultado real:
- Observaciones:
```

## Precondiciones

- tener al menos cuatro usuarios de prueba:
  - `admin`
  - `supervisor`
  - `tecnico`
  - `solo_lectura`
- tener al menos un `tecnico` vinculado a usuario web
- tener al menos:
  - una incidencia `open`
  - una incidencia `in_progress`
  - una incidencia `paused`
  - una incidencia `resolved`
- tener un tecnico con:
  - una incidencia asignada directamente
  - una incidencia heredada por `installation`
  - una incidencia heredada por `asset`
- tener al menos un asset vinculado a un caso/incidencia

## 1. Admin

### 1.1 Navegacion web

- iniciar sesion como `admin`
- revisar menu lateral y menu mobile web

Resultado esperado:

- ve `Dashboard`
- ve `Mis casos`
- ve `Registros`
- ve `Incidencias`
- ve `Mapa`
- ve `Inventario`
- ve `Drivers`
- ve `Configuracion`
- no deberia quedar bloqueado al entrar a secciones operativas del tenant

### 1.2 Tecnicos y usuarios

- abrir `Configuracion`
- revisar panel de tecnicos
- intentar crear o editar un tecnico
- revisar usuarios web del tenant

Resultado esperado:

- puede ver catalogo de tecnicos
- puede crear, editar, activar o desactivar tecnicos
- puede ver y administrar usuarios web del tenant

### 1.3 Incidencias globales

- abrir `Incidencias`
- abrir `Mapa`
- abrir una incidencia resuelta
- intentar reabrirla

Resultado esperado:

- puede ver incidencias tenant-wide
- puede usar mapa global
- puede reabrir incidencias resueltas

### 1.4 Assets

- abrir `Inventario`
- abrir detalle de un asset
- probar vincular asset a instalacion
- probar prestamo o devolucion

Resultado esperado:

- puede ver catalogo global
- puede editar catalogo maestro
- puede vincular assets
- puede gestionar prestamos

## 2. Supervisor

### 2.1 Navegacion web

- iniciar sesion como `supervisor`
- revisar menu lateral

Resultado esperado:

- ve `Dashboard`
- ve `Mis casos`
- ve `Registros`
- ve `Incidencias`
- ve `Mapa`
- ve `Inventario`
- ve `Drivers`
- no ve herramientas de plataforma

### 2.2 Tecnicos

- abrir `Configuracion`
- revisar panel de tecnicos
- intentar crear tecnico
- intentar gestionar asignaciones si existe UI operativa para eso

Resultado esperado:

- puede consultar tecnicos
- no puede crear ni editar ficha base del tecnico
- si el flujo existe, puede coordinar asignaciones operativas

### 2.3 Incidencias

- abrir `Incidencias`
- abrir `Mapa`
- intentar editar destino operativo
- intentar reabrir una resuelta

Resultado esperado:

- puede ver incidencias tenant-wide
- puede usar mapa global
- puede editar destino operativo
- puede reabrir incidencias resueltas

### 2.4 Assets

- abrir `Inventario`
- revisar detalle de asset
- intentar editar catalogo maestro
- intentar vincular asset
- intentar registrar prestamo

Resultado esperado:

- puede ver catalogo global
- no deberia editar datos maestros del catalogo
- puede vincular assets
- puede gestionar prestamos

## 3. Tecnico

### 3.1 Navegacion web

- iniciar sesion como `tecnico`
- revisar menu lateral

Resultado esperado:

- ve `Dashboard`
- ve `Mis casos`
- ve `Registros` solo si el flujo lo requiere
- no ve `Incidencias` tenant-wide
- no ve `Inventario` global
- no ve `Auditoria`
- si existe acceso a `Mapa`, debe ser mapa personal/asignado

### 3.2 Mis casos

- abrir `Mis casos`
- verificar resumen y tabs por estado
- confirmar que aparezcan incidencias asignadas directas y heredadas

Resultado esperado:

- la vista carga sin depender del catalogo global de tecnicos
- aparecen `open`, `in_progress`, `paused` y `resolved` si corresponden
- no aparece mensaje de `Sin tecnico vinculado` si el tecnico esta vinculado correctamente

### 3.3 Mapa asignado

- abrir `Mapa`
- verificar pines y card lateral o detalle
- probar filtros de estado y severidad

Resultado esperado:

- el mapa carga incidencias asignadas del tecnico
- puede mostrar incidencias antiguas o resueltas si siguen asignadas y tienen coordenadas
- no usa el mapa global del tenant

### 3.4 Detalle de incidencia

- abrir una incidencia asignada `open`
- cambiar estado a `in_progress`
- pausarla
- resolverla

Resultado esperado:

- puede operar estados en incidencias asignadas
- puede editar checklist, nota y evidencia

### 3.5 Reapertura bloqueada

- abrir una incidencia resuelta
- revisar acciones visibles

Resultado esperado:

- no deberia poder reabrir la incidencia
- la UI deberia ocultar o deshabilitar acciones de reapertura
- si intenta forzar backend, deberia recibir rechazo

### 3.6 Assets en contexto

- entrar a una incidencia asignada con `asset`
- abrir el equipo desde el contexto del caso o incidencia

Resultado esperado:

- puede ver detalle operativo del equipo relacionado
- no puede navegar el catalogo completo del tenant

## 4. Solo lectura

### 4.1 Navegacion web

- iniciar sesion como `solo_lectura`
- revisar secciones visibles

Resultado esperado:

- puede consultar vistas permitidas
- no ve botones de escritura en incidencias, tecnicos o assets

### 4.2 Incidencias y mapa

- abrir `Incidencias` y `Mapa`
- intentar cambiar estado
- intentar editar destino operativo

Resultado esperado:

- puede ver informacion
- no puede escribir ni cambiar estado
- no puede editar destino operativo

### 4.3 Tecnicos y assets

- abrir panel de tecnicos si esta disponible
- abrir inventario si esta disponible

Resultado esperado:

- acceso de consulta
- sin botones de alta, edicion, prestamo, asignacion o borrado

## 5. Mobile

### 5.1 Admin / supervisor

- iniciar sesion mobile con cuenta `admin` o `supervisor`
- revisar tabs
- abrir `Inventario`
- abrir detalle de incidencia resuelta

Resultado esperado:

- tabs y acciones visibles segun permisos
- inventario disponible
- reapertura visible cuando el rol la permite

### 5.2 Tecnico

- iniciar sesion mobile con cuenta `tecnico`
- revisar tabs
- abrir `Casos`
- abrir `Mapa`
- intentar encontrar `Inventario`

Resultado esperado:

- `Inventario` no aparece como tab global
- `Casos` y `Mapa` siguen disponibles
- puede trabajar incidencias asignadas
- no puede reabrir una incidencia resuelta

### 5.3 Solo lectura

- iniciar sesion mobile con `solo_lectura`
- revisar tabs y detalle de incidencia

Resultado esperado:

- puede consultar donde corresponda
- no puede ejecutar acciones de escritura

## 6. Pruebas de borde

### 6.1 Usuario sin tecnico vinculado

- iniciar sesion con usuario web sin tecnico asociado
- abrir `Mis casos`
- abrir `Mapa` como tecnico si aplica

Resultado esperado:

- aparece estado vacio explicito
- no queda loader infinito
- el copy explica que falta vincular tecnico

### 6.2 Cambio de rol

- cerrar sesion
- entrar con otro rol sin hard refresh

Resultado esperado:

- la navegacion se actualiza
- no quedan secciones visibles del rol anterior
- si el usuario estaba parado en una seccion prohibida, la UI redirige o muestra fallback valido

### 6.3 Forzado backend

- con DevTools o cliente HTTP, intentar abrir un endpoint no permitido para el rol

Resultado esperado:

- backend responde `403`
- la UI no deberia depender solo de ocultar botones

## Referencias

- `docs/rbac-matriz-web-mobile.md`
- `docs/changes/2026-04-08-rbac-ui-technician-map-and-my-cases-alignment.md`
