# Windows UI v2

## Decision

Dejar de iterar sobre la interfaz legacy basada en `QWidget` como superficie principal.

La nueva direccion para Windows es:

- mantener Qt
- migrar la composicion visual a una capa nueva
- usar `Qt Quick / QML` para el shell y las pantallas nuevas
- mover funcionalidad por slices, no por retoques cosmeticos sobre tabs heredadas

## Why

La UI actual tiene demasiada deuda de layout:

- composiciones rigidas
- widgets apilados que compiten por altura
- demasiadas dependencias entre layout y logica
- costo alto para cambios visuales pequenos

Seguir ajustando esa base consume tiempo y no mejora lo suficiente la calidad percibida.

## Current foundation

Ya existe un shell inicial de `Windows UI v2` en:

- [main.py](/g:/dev/driver_manager/main.py)
- [main_window_v2.py](/g:/dev/driver_manager/ui/main_window_v2.py)
- [App.qml](/g:/dev/driver_manager/ui/qml/App.qml)

Launcher:

```bash
python main.py --ui-v2
```

## Migration order

1. Shell, navegacion y command surfaces
2. Drivers
3. Incidencias
4. Historial y reportes
5. Administracion
6. Dialogos y flujos auxiliares

## Rules

- no mezclar lenguaje legacy y v2 en la misma pantalla nueva
- cada pantalla nueva debe nacer con jerarquia, spacing y responsive desktop resueltos
- la logica Python existente debe reutilizarse cuando sirva, pero no debe dictar la composicion visual
- si una vista legacy dificulta el rediseño, se reemplaza completa
