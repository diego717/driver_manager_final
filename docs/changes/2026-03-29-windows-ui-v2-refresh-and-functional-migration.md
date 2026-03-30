# 2026-03-29 - windows ui v2, refresh visual y migracion funcional inicial

## Resumen

Se abre una nueva linea de trabajo para Windows basada en `Qt Quick / QML`, dejando de iterar sobre la UI legacy y empezando una migracion pantalla por pantalla a una capa visual y funcional nueva.

## Areas tocadas

- desktop windows
- ui v2
- qml
- auth desktop
- catalogo de drivers
- incidencias
- activos y qr
- documentacion operativa

## Contexto

La interfaz desktop heredada venia acumulando limitaciones estructurales:

- layouts rigidos y dificiles de mantener
- demasiados ajustes visuales sobre una base que ya nacio mal compuesta
- friccion constante entre mejoras de estilo y roturas de layout
- dificultad para acercar Windows al nivel visual de web y mobile

Por eso se tomo la decision de abrir una `UI v2` paralela, con shell nuevo, composicion nueva y migracion gradual de funcionalidades reales.

## Cambios clave

- se agrega un launcher experimental para abrir la nueva capa visual con `python main.py --ui-v2`
- se crea `MainWindowV2` como nueva ventana principal para la migracion desktop
- se incorpora una base `QML` nueva con shell editorial-operativo, tipografia compartida y layout de dos rails
- la `UI v2` ya exige autenticacion al iniciar, reutilizando `UserManagerV2` y `LoginDialog`
- `Drivers` deja de ser maqueta:
  - lista real de drivers desde backend actual
  - filtro por marca
  - detalle del paquete seleccionado
  - descarga
  - instalacion
  - refresh de catalogo
  - subida de driver con metadata y publicacion a nube
  - accesos operativos a QR, asociacion de equipo y gestion de activos
- `Incidencias v2` deja de ser placeholder:
  - carga real de registros
  - carga real de incidencias por registro
  - filtros de limite, severidad y periodo
  - detalle de incidencia
  - cambio de estado
  - subida de foto
  - visor de foto
  - lectura de asignaciones
- el visor de fotos en incidencias se rediseña como bloque principal con slide:
  - preview grande
  - navegacion anterior/siguiente
  - contador de evidencia
  - sin ruido tecnico como nombre de archivo o mime type
- se ajustan multiples puntos de layout para evitar cortes verticales en paneles de `Drivers` e `Incidencias`

## Impacto

- Windows deja de depender exclusivamente de la UI legacy para evolucionar
- la nueva base visual se alinea mucho mejor con web y mobile
- ya existe una ruta concreta para migrar pantallas con funcionalidad real, no solo mockups
- se reduce el costo de seguir corrigiendo layouts viejos en PyQt widgets
- el equipo gana una base mas mantenible para siguientes iteraciones de UX desktop

## Referencias

- `main.py`
- `ui/main_window_v2.py`
- `ui/qml/App.qml`
- `ui/v2_drivers_bridge.py`
- `ui/v2_incidents_bridge.py`
- `docs/windows-ui-v2-migration.md`
- `ui/dialogs/quick_upload_dialog.py`
- `ui/dialogs/qr_generator_dialog.py`
- `ui/dialogs/asset_management_dialog.py`
- `ui/dialogs/user_management_ui.py`

## Validacion

- `python -m py_compile main.py ui/main_window_v2.py ui/v2_drivers_bridge.py ui/v2_incidents_bridge.py`
- carga offscreen de `MainWindowV2`
- verificacion de catalogo real de drivers cargado en `v2`
- verificacion estructural de `Incidencias v2` y de sus bindings QML

## Pendientes

- completar el flujo real de `Incidencias v2` con asignaciones editables desde la nueva UI
- migrar `Historial / reportes` a la misma base visual y funcional
- migrar `Administracion` a la `v2`
- limpiar el warning de logging Unicode en consola Windows por mensajes con `✅`
- validar de punta a punta con sesion real cada flujo de incidencias y fotos, no solo con bootstrap tecnico
