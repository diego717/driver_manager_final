# Plan de implementacion: alineacion de Windows con web y mobile

Fecha: 2026-03-28

## 1. Objetivo

Emparejar la app de Windows con el estado actual de web y mobile sin reescribir el cliente desktop desde cero.

La idea no es replicar toda la UX del dashboard o de la app movil, sino cerrar las brechas funcionales y de arquitectura mas importantes:

- auth web como flujo principal
- roles tenant-aware reales
- gestion de tecnicos
- asignaciones operativas
- consistencia de nombres, permisos y tenant context

## 2. Diagnostico resumido

El repo ya tiene piezas clave implementadas fuera de Windows:

- backend multi-tenant con `tenant_id`
- rutas web para `technicians` y `technician_assignments`
- mobile con UI para directorio de tecnicos y asignaciones
- dashboard web con gestion mas avanzada de tecnicos y roles operativos

La app Windows ya avanzo en la transicion a auth web, pero sigue rezagada en estos puntos:

- mezcla de modos `legacy`, `web` y `auto`
- UI de usuarios mas cercana al modelo viejo que al modelo tenant moderno
- falta una superficie real para `technicians`
- faltan asignaciones operativas visibles y editables
- algunos roles siguen degradados al modelo `viewer`

## 3. Objetivos concretos de paridad

Se considera que Windows llega a una paridad suficiente cuando cumpla al menos esto:

1. login web y sesion tenant-aware reales
2. soporte de roles `super_admin`, `admin`, `supervisor`, `tecnico`, `solo_lectura`
3. directorio de tecnicos editable desde desktop
4. vinculo entre tecnico y usuario web
5. asignaciones de tecnicos sobre incidencias e instalaciones
6. nombre tecnico consistente en vistas, auditoria y reportes
7. dependencia minima de `legacy` para flujos nuevos

## 4. Estrategia general

El trabajo debe hacerse por capas y no por pantallas aisladas.

Orden correcto:

1. corregir sesion, roles y tenant context
2. crear la capa de servicios desktop para tecnicos
3. exponer UI de gestion
4. integrar asignaciones en flujos operativos
5. homologar reportes, auditoria y deuda de transicion

Esto baja el riesgo de construir UI nueva arriba de permisos o contratos incorrectos.

## 5. Plan por PRs

## PR 1 - Base de auth, roles y tenant para desktop

### Objetivo

Dejar la app Windows alineada con el modelo actual de auth web y RBAC por tenant.

### Archivos probables

- `managers/user_auth_provider.py`
- `managers/user_manager_v2.py`
- `ui/main_window_session.py`
- `managers/history_request_adapter.py`
- `ui/main_window.py`

### Trabajo

- soportar roles nuevos en desktop:
  - `super_admin`
  - `admin`
  - `supervisor`
  - `tecnico`
  - `solo_lectura`
- dejar de degradar roles tenant a `viewer`
- usar `tenant_id` de sesion web como fuente principal en modo `web`
- revisar guards de tabs, acciones y estados de sesion
- mantener `legacy` solo como compatibilidad controlada
- mantener `auto` como modo transicional, no como objetivo final

### Criterios de aceptacion

- un usuario `supervisor` puede iniciar sesion y conserva su rol real
- un usuario `tecnico` no recibe permisos administrativos
- un usuario `solo_lectura` puede consultar pero no mutar
- en modo `web`, las requests desktop salen con tenant alineado a sesion

### Riesgos

- romper compatibilidad en flujos legacy si los guards quedan demasiado agresivos
- mantener reglas duplicadas de permisos entre UI y managers

### Estimacion

- 1 a 2 dias

## PR 2 - Cliente desktop para tecnicos y asignaciones

### Objetivo

Crear una capa Python limpia para consumir el contrato ya disponible de `/web/technicians` y `/web/technician-assignments`.

### Archivos probables

- `managers/technician_web_service.py`
- `managers/history_request_adapter.py`
- `managers/history_manager.py`
- tests nuevos en `tests/`

### Trabajo

- implementar cliente para:
  - listar tecnicos
  - crear tecnico
  - actualizar tecnico
  - listar asignaciones de un tecnico
  - listar asignaciones por entidad
  - crear asignacion
  - quitar asignacion
- reutilizar Bearer de sesion actual del desktop
- normalizar payloads y errores para consumo desde PyQt
- evitar mezclar HTTP crudo dentro de la UI

### Criterios de aceptacion

- el desktop puede consumir CRUD base de tecnicos
- el desktop puede crear y quitar asignaciones
- los errores backend se traducen a mensajes consistentes para la UI
- no se agregan secretos nuevos al cliente Windows

### Riesgos

- dejar la logica repartida entre demasiados managers
- mezclar contratos legacy y web dentro del mismo servicio

### Estimacion

- 1 dia

## PR 3 - Directorio de tecnicos en Windows

### Objetivo

Entregar una pantalla de gestion de `technicians` comparable a la de web/mobile, adaptada al estilo desktop.

### Archivos probables

- `ui/dialogs/user_management_ui.py`
- `ui/dialogs/technician_management_dialog.py`
- `ui/main_window.py`
- `ui/ui_components.py`

### Trabajo

- separar la gestion de usuarios web de la gestion de tecnicos
- crear dialogo o panel para tecnicos con:
  - `display_name`
  - `employee_code`
  - `email`
  - `phone`
  - `notes`
  - `web_user_id`
  - `is_active`
- permitir alta, edicion y activacion/desactivacion
- mostrar conteo de asignaciones activas cuando este disponible
- restringir acciones segun rol

### Criterios de aceptacion

- `admin` y `super_admin` pueden gestionar tecnicos
- `supervisor`, `tecnico` y `solo_lectura` no pueden editar catalogo
- se puede vincular y desvincular usuario web
- la UI ya no mezcla “usuario” con “tecnico” como si fueran lo mismo

### Riesgos

- intentar encajar toda la funcionalidad nueva dentro del dialogo actual de usuarios
- dejar una UI confusa si no se separan bien los conceptos

### Estimacion

- 2 dias

## PR 4 - Asignaciones operativas en incidencias e instalaciones

### Objetivo

Habilitar en Windows la gestion de asignaciones tecnicas sobre trabajo operativo.

### Archivos probables

- `ui/main_window_incidents.py`
- `ui/main_window.py`
- `ui/ui_components.py`
- `ui/dialogs/technician_assignment_dialog.py`
- tests nuevos en `tests/`

### Trabajo

- mostrar tecnicos asignados en incidencias
- mostrar tecnicos asignados en instalaciones cuando aplique
- permitir crear y quitar asignaciones
- soportar roles de asignacion:
  - `owner`
  - `assistant`
  - `reviewer`
- habilitar gestion solo para:
  - `super_admin`
  - `admin`
  - `supervisor`

### Criterios de aceptacion

- una incidencia muestra sus tecnicos asignados
- se puede asignar y quitar sin salir del flujo operativo
- la UI distingue titular, apoyo y revision
- todas las operaciones respetan aislamiento por tenant

### Riesgos

- sobrecargar vistas ya complejas
- agregar asignaciones en demasiados lugares a la vez

### Estimacion

- 2 a 3 dias

## PR 5 - Homologacion funcional, reportes y salida de transicion

### Objetivo

Cerrar la brecha final entre Windows y las otras dos plataformas.

### Archivos probables

- `ui/main_window_incidents.py`
- `reports/report_generator.py`
- `handlers/report_handlers.py`
- `tests/`
- `docs/changes/`

### Trabajo

- usar `display_name` del tecnico de forma consistente en:
  - incidencias
  - conformidades
  - reportes
  - auditoria
- reemplazar texto libre de tecnico por catalogo o sugerencia estructurada donde tenga sentido
- agregar tests de permisos y smoke de tecnicos/asignaciones
- documentar estrategia de retiro de `auto`
- reducir superficie `legacy` en flujos nuevos

### Criterios de aceptacion

- el nombre tecnico en Windows coincide con web/mobile
- no hay mutaciones disponibles para `solo_lectura`
- los reportes usan datos consistentes con tenant y tecnico
- queda documentado el estado final de rollout

### Riesgos

- convivir demasiado tiempo con nombre libre y tecnico estructurado en paralelo
- cerrar UI sin cerrar trazabilidad en reportes

### Estimacion

- 1 a 2 dias

## 6. Orden recomendado de ejecucion

Orden sugerido:

1. PR 1
2. PR 2
3. PR 3
4. PR 4
5. PR 5

No conviene empezar por las pantallas operativas sin antes corregir auth, rol y tenant context.

## 7. Vertical slice recomendado para avanzar rapido

Si se busca impacto rapido con bajo retrabajo, conviene atacar primero este slice:

1. PR 1 completo
2. PR 2 completo
3. PR 3 solo directorio de tecnicos
4. PR 4 solo asignaciones en incidencias

Con eso Windows ya gana una paridad visible fuerte con web/mobile sin esperar el cierre de todos los frentes.

## 8. Dependencias y precondiciones

Antes de cerrar el track Windows conviene confirmar:

- que el contrato de `worker/routes/technicians.js` se mantiene estable
- que los roles web emitidos por sesion son los definitivos para esta etapa
- que `tenant_id` en desktop deja de depender de configuracion manual para modo `web`
- que los tests de permisos cubren `supervisor`, `tecnico` y `solo_lectura`

## 9. Riesgos transversales

Riesgos principales:

- mezclar modelo legacy y web en la misma UI sin fronteras claras
- dejar decisiones de permisos solo en la capa visual
- mantener `viewer` como categoria ambigua cuando el modelo real ya usa otros roles
- permitir que el desktop siga operando con tenant de config y no de sesion
- duplicar logica entre dashboard, mobile y desktop sin una capa desktop ordenada

Mitigaciones:

- centralizar permisos en managers/sesion
- centralizar cliente web de tecnicos en un solo servicio
- usar feature flags o rollout parcial si hace falta
- cerrar tests de contrato y permisos antes de ampliar superficie UI

## 10. Checklist de aceptacion final

- [ ] desktop autentica via flujo web como camino principal
- [ ] desktop interpreta correctamente roles tenant modernos
- [ ] desktop expone directorio de tecnicos
- [ ] desktop permite vincular tecnico con usuario web
- [ ] desktop permite asignar tecnicos a incidencias
- [ ] desktop puede mostrar asignaciones sobre instalaciones
- [ ] desktop usa nombre tecnico consistente en vistas y reportes
- [ ] los flujos nuevos no requieren secretos HMAC globales
- [ ] `legacy` queda acotado a compatibilidad controlada
- [ ] `auto` queda documentado como transicion

## 11. Referencias del repo

- `docs/technicians-and-tenant-model.md`
- `docs/auth-modes.md`
- `docs/multi-tenant-rollout.md`
- `worker/routes/technicians.js`
- `mobile-app/src/components/TechnicianDirectoryCard.tsx`
- `mobile-app/src/components/TechnicianAssignmentsPanel.tsx`
- `ui/main_window.py`
- `ui/dialogs/user_management_ui.py`
