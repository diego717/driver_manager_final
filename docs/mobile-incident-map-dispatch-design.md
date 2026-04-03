# Diseño técnico: destino operativo, asignación y mapa mobile

Fecha: 2026-04-02

## 1. Objetivo

Diseñar una capacidad nueva para operar incidencias con destino operativo claro desde web y mobile.

Meta funcional:

1. un `admin` o `super_admin` crea o actualiza una incidencia desde web
2. puede definir un destino operativo para esa incidencia
3. asigna la incidencia a uno o mas tecnicos
4. el tecnico recibe una notificacion push en mobile
5. en mobile ve direccion, referencia y apoyo en mapa para navegar o entrar al detalle

La prioridad no es "dibujar un mapa" sino mejorar el despacho operativo y reducir ambiguedad sobre adonde tiene que ir el tecnico.

## 2. Problema actual

Hoy el proyecto ya tiene varias piezas utiles, pero separadas:

- web ya puede crear incidencias y gestionar asignaciones de tecnicos
- mobile ya tiene:
  - login/sesion
  - geolocalizacion
  - registro de device token
  - pantalla de trabajo con incidencias y asignaciones
- backend ya soporta:
  - `device_tokens`
  - push web
  - `technician_assignments`
  - incidencias con metadata GPS de captura

Lo que falta es un flujo operativo unificado para:

- definir "donde debe ir el tecnico" en un formato realmente util para calle
- notificarlo
- mostrarle ese destino en mobile

## 3. Principio clave

No mezclar:

- evidencia GPS del reporte
- destino operativo de la incidencia

Eso significa que `gps_capture_*` no deberia reutilizarse automaticamente como "lugar al que tiene que ir el tecnico".

Separacion recomendada:

- `gps_capture_*`
  evidencia de donde estaba quien reporto o firmo
- `target_*`
  referencia geografica operativa
- `dispatch_*`
  informacion legible y accionable para la visita

## 4. Propuesta de modelo de datos

Agregar a `incidents` dos grupos de datos relacionados:

### 4.1 Referencia geografica

- `target_lat`
- `target_lng`
- `target_label`
- `target_source`
- `target_updated_at`
- `target_updated_by`

### 4.2 Destino operativo legible

- `dispatch_place_name`
- `dispatch_address`
- `dispatch_reference`
- `dispatch_contact_name`
- `dispatch_contact_phone`
- `dispatch_notes`

Semantica:

- `target_lat` y `target_lng`
  coordenadas operativas del destino
- `target_label`
  texto visible tipo `Sucursal Centro`, `ATM-009`, `Acceso lateral`, etc.
- `target_source`
  origen de esa referencia
- `target_updated_at`
  fecha de ultima actualizacion
- `target_updated_by`
  usuario web que la definio o modifico
- `dispatch_place_name`
  nombre corto del destino, por ejemplo `ATM-009`, `Sucursal Centro`
- `dispatch_address`
  direccion legible y navegable
- `dispatch_reference`
  indicaciones de acceso o ubicacion interna
- `dispatch_contact_name`
  persona de referencia para la visita
- `dispatch_contact_phone`
  telefono de contacto
- `dispatch_notes`
  observaciones operativas cortas para el tecnico

Valores sugeridos para `target_source`:

- `manual_map`
- `reporter_gps`
- `installation_gps`
- `asset_context`
- `mobile_adjustment`

Principio UX:

- el tecnico debe leer primero `dispatch_*`
- el mapa y `target_*` quedan como apoyo visual y navegacion

## 5. Alcance recomendado para Fase 1

La recomendacion es no arrancar creando incidencias desde mapa.

Fase 1 deberia resolver esto:

1. web puede definir destino operativo en una incidencia
2. web puede asignar tecnico
3. backend dispara push por asignacion
4. mobile muestra incidencias asignadas con direccion, referencia y apoyo en mapa
5. mobile permite abrir detalle y navegacion externa

Esto ya aporta valor real sin meterse de entrada en un flujo mas complejo de "crear incidencia tocando el mapa".

## 6. Flujo web propuesto

### 6.1 Crear o editar incidencia

Desde web:

- crear incidencia como hoy
- mostrar bloque nuevo: `Destino operativo`

Opciones de carga:

1. `Usar punto en mapa`
2. `Usar GPS del reporte`
3. `Usar contexto del registro/equipo`
4. `Sin destino operativo`

Campos visibles recomendados:

- `Nombre del lugar`
- `Direccion`
- `Referencia de acceso`
- `Contacto`
- `Telefono`
- `Notas para la visita`

Comportamiento esperado:

- la incidencia puede existir sin `target_*`
- la incidencia deberia poder existir tambien sin `dispatch_*`, pero eso deberia verse como informacion incompleta
- si existe `dispatch_*`, mobile debe priorizar ese bloque sobre las coordenadas
- si existe `target_*`, el mapa y la navegacion deben usarlo como referencia principal

### 6.2 Asignacion

Cuando una incidencia queda asignada a un tecnico:

- se registra o mantiene `technician_assignment`
- se envia push si hay dispositivo activo del tecnico

### 6.3 Mapa web

El mapa web deberia servir para:

- visualizar incidencias con `target_*` o con GPS capturado
- editar la referencia geografica
- entrar al detalle

No hace falta que en Fase 1 sea el lugar principal de creacion.

## 7. Flujo mobile propuesto

### 7.1 Push

Cuando el tecnico recibe una nueva asignacion:

- notificacion push
- titulo ejemplo: `Nueva incidencia asignada`
- cuerpo ejemplo: `ATM-009 · Cliente GPS · prioridad alta`

Payload recomendado:

- `incident_id`
- `installation_id`
- `asset_id`
- `target_lat`
- `target_lng`
- `target_label`
- `dispatch_place_name`
- `dispatch_address`
- `dispatch_reference`
- `severity`
- `deep_link`

### 7.2 Vista mapa mobile

Nueva pestaña sugerida: `Mapa`

Contenido minimo:

- mapa con posicion actual del tecnico
- pins de incidencias asignadas
- filtros por estado y prioridad
- card inferior o lateral al tocar un pin:
  - lugar o destino
  - direccion
  - referencia
  - cliente
  - equipo
  - prioridad
  - distancia estimada
  - boton `Ver incidencia`
  - boton `Ir`

Principio de lectura:

1. destino
2. direccion
3. referencia
4. mapa

### 7.3 Detalle de incidencia

Desde el mapa:

- abrir detalle existente de incidencia
- mantener acciones operativas en el detalle
- no cargar toda la logica de gestion dentro del mapa

El mapa deberia ser:

- entrada
- contexto
- orientacion

No reemplazo completo de la pantalla de trabajo.

## 8. Integracion con notificaciones

El proyecto ya tiene base para esto:

- registro de token en mobile
- almacenamiento de `device_tokens`
- envio de push desde backend para algunos eventos

Se propone reutilizar esa infraestructura.

Evento sugerido para push:

- alta de nueva asignacion activa sobre `incident`

Eventos opcionales mas adelante:

- cambio de prioridad a `critical`
- cambio de `target_*`
- re-asignacion a otro tecnico

## 9. API propuesta

### 9.1 Lectura de incidencias

Agregar en respuestas de incidencia:

- `target_lat`
- `target_lng`
- `target_label`
- `target_source`
- `target_updated_at`
- `target_updated_by`
- `dispatch_place_name`
- `dispatch_address`
- `dispatch_reference`
- `dispatch_contact_name`
- `dispatch_contact_phone`
- `dispatch_notes`

### 9.2 Actualizacion de destino operativo

Opcion recomendada:

- `PATCH /incidents/:id/dispatch-target`

Payload:

```json
{
  "target_lat": -34.9011,
  "target_lng": -56.1645,
  "target_label": "ATM-009 · acceso principal",
  "target_source": "manual_map",
  "dispatch_place_name": "ATM-009",
  "dispatch_address": "Av. Italia 2456",
  "dispatch_reference": "Hall principal, acceso por puerta lateral",
  "dispatch_contact_name": "Marta Perez",
  "dispatch_contact_phone": "+59899111222",
  "dispatch_notes": "Coordinar ingreso antes de manipular el equipo"
}
```

### 9.3 Listado para mapa mobile

Dos opciones:

1. reutilizar endpoints de incidencias + assignments
2. crear endpoint agregado para mobile

Recomendacion:

Fase 1:

- reutilizar lo ya existente si el costo es bajo

Si la composicion queda pesada:

- crear endpoint dedicado:
  - `GET /me/assigned-incidents-map`

Respuesta ideal:

- solo incidencias asignadas al tecnico autenticado
- solo campos necesarios para mapa y card
- incluir siempre los campos legibles de `dispatch_*`

## 10. UX recomendada

### Web

- el destino operativo debe verse como bloque propio
- si una incidencia no tiene `target_*`, mostrar estado claro:
  - `Sin referencia geografica`
- si no tiene `dispatch_address` o `dispatch_reference`, mostrar estado claro:
  - `Falta informacion para visita`
- si usa GPS del reporte como base, mostrarlo explicitamente

### Mobile

- el mapa debe estar enfocado en "que tengo asignado" y no en "todo el universo de incidencias"
- la primera accion del tecnico deberia ser clara:
  - `Ir`
  - `Ver detalle`
  - `Marcar en curso`

Orden de prioridad visual recomendado en mobile:

1. `dispatch_place_name`
2. `dispatch_address`
3. `dispatch_reference`
4. contacto
5. mapa

La coordenada sola no deberia ser el contenido principal de la card.

### Navegacion externa

Conviene soportar:

- abrir Google Maps
- abrir Waze si esta disponible

Eso probablemente entregue mas valor al tecnico que intentar resolver toda la navegacion dentro de la app desde el dia uno.

## 11. Decision tecnologica del mapa mobile

### Recomendacion

Para mobile, la recomendacion es usar `react-native-maps`.

Si se busca mayor paridad visual y funcional entre plataformas:

- Android: Google Maps como provider principal
- iOS: evaluar Google Maps si esa paridad es importante

Si se prioriza menor complejidad inicial en iOS:

- Android: Google Maps
- iOS: provider nativo por defecto

### Por que no Leaflet como base mobile

Leaflet sigue siendo una opcion valida para web, pero no es la mejor base para esta app mobile porque:

- esta pensada principalmente para navegador y DOM
- en React Native normalmente termina montada via `WebView`
- eso agrega complejidad en gestos, rendimiento, integracion nativa y mantenimiento
- para una app operativa de calle conviene una experiencia de mapa nativa

### Por que `react-native-maps` encaja mejor aqui

- ya se alinea con la arquitectura Expo y React Native del proyecto
- resuelve mejor permisos, ubicacion actual y render de marcadores
- facilita abrir navegacion externa sin depender de una capa web embebida
- es mejor base si mas adelante se quiere mostrar ruta, distancia o clustering simple

### Decision propuesta para este repo

- dashboard web: mantener el stack web actual del mapa
- mobile app: usar `react-native-maps`
- no intentar compartir Leaflet entre web y mobile

Principio operativo:

- en mobile el mapa es apoyo visual
- la informacion principal sigue siendo `dispatch_place_name`, `dispatch_address`, `dispatch_reference` y contacto

## 12. Fases sugeridas

## Fase 1

- agregar `target_*` al backend
- agregar `dispatch_*` al backend
- exponer `target_*` en contrato API
- exponer `dispatch_*` en contrato API
- permitir editar destino operativo desde web
- disparar push al asignar tecnico
- abrir detalle desde push en mobile

## Fase 2

- agregar pestaña `Mapa` en mobile
- mostrar incidencias asignadas con pin
- mostrar direccion y referencia como contenido principal
- mostrar distancia estimada y CTA de navegacion

## Fase 3

- permitir definir `target_*` clickeando mapa en web
- mejorar filtros y agrupacion por tecnico/prioridad

## Fase 4

- evaluar crear incidencia desde mapa
- evaluar estados adicionales como `en camino`
- evaluar reglas de cercania o priorizacion por distancia

## 13. Riesgos y decisiones a revisar antes de implementar

### Riesgos tecnicos

- mezclar `gps_capture_*` con `target_*`
- guardar solo coordenadas y olvidar `dispatch_*`
- enviar push sin resolver bien el destinatario
- falta de permisos de ubicacion en mobile
- mapa mobile con demasiada carga visual si se muestran demasiadas incidencias

### Riesgos de producto

- crear incidencias desde mapa demasiado pronto puede confundir mas de lo que ayuda
- si una incidencia tiene ubicacion mala o ambigua, el tecnico pierde confianza en la herramienta
- si la incidencia tiene coordenada pero no direccion ni referencia, el tecnico puede sentir que la app "muestra un punto pero no explica nada"

### Decisiones abiertas

1. una incidencia puede tener multiples tecnicos activos o siempre un owner principal
2. la ubicacion objetivo es opcional u obligatoria para ciertos tipos de incidencia
3. mobile mostrara solo incidencias asignadas al tecnico o tambien las del equipo/supervisor
4. se agrega o no estado `en camino`
5. se usara mapa embebido en mobile o solo navegacion externa como primer paso

## 14. Recomendacion final

La mejor secuencia para este repo es:

1. `target_*` + `dispatch_*`
2. push por asignacion
3. apertura desde notificacion al detalle
4. mapa mobile para incidencias asignadas
5. despues evaluar creacion desde mapa

Es la opcion con mejor relacion entre claridad operativa, complejidad tecnica y valor inmediato para el tecnico en calle.

## 15. Lista de implementacion por capa

Esta lista baja el diseño a trabajo concreto por backend, web y mobile.

### Backend

#### Esquema y persistencia

- agregar columnas nuevas en `incidents`:
  - `target_lat`
  - `target_lng`
  - `target_label`
  - `target_source`
  - `target_updated_at`
  - `target_updated_by`
  - `dispatch_place_name`
  - `dispatch_address`
  - `dispatch_reference`
  - `dispatch_contact_name`
  - `dispatch_contact_phone`
  - `dispatch_notes`
- definir migracion SQL y backfill nulo seguro
- mantener estos campos como opcionales en Fase 1

#### Contrato y rutas

- exponer `target_*` en respuestas de incidencia
- exponer `dispatch_*` en respuestas de incidencia
- aceptar `target_*` y `dispatch_*` en create/update de incidencia segun convenga
- agregar endpoint dedicado recomendado:
  - `PATCH /incidents/:id/dispatch-target`
- validar tipos, longitud maxima y sanitizacion de textos
- registrar `target_updated_at` y `target_updated_by` desde backend

#### Asignacion y push

- detectar cuando una incidencia pasa a estar asignada a un tecnico
- obtener `device_tokens` vigentes del tecnico
- enviar notificacion push con payload minimo:
  - `incident_id`
  - `severity`
  - `target_lat`
  - `target_lng`
  - `dispatch_place_name`
  - `dispatch_address`
  - `dispatch_reference`
  - `deep_link`
- evitar push duplicadas cuando solo se regraba una asignacion sin cambios reales

#### Endpoint agregado para mobile

- evaluar si alcanza con endpoints actuales
- si no alcanza, crear:
  - `GET /me/assigned-incidents-map`
- devolver solo incidencias activas asignadas al tecnico autenticado
- incluir solo campos necesarios para lista, mapa y card

#### Auditoria y observabilidad

- auditar cambios de `dispatch_*` y `target_*`
- loggear intentos fallidos de push
- registrar si una incidencia asignada no tiene destino operativo completo

### Web

#### Formulario de incidencia

- agregar bloque `Destino operativo` en crear/editar incidencia
- incluir campos:
  - `Nombre del lugar`
  - `Direccion`
  - `Referencia`
  - `Contacto`
  - `Telefono`
  - `Notas`
- agregar selector de origen de referencia:
  - `Punto en mapa`
  - `GPS del reporte`
  - `Contexto del equipo/registro`

#### Mapa web

- permitir fijar o ajustar `target_lat` y `target_lng` desde el mapa
- mostrar preview legible del destino operativo junto al pin
- dejar claro si la incidencia:
  - no tiene coordenadas
  - tiene coordenadas pero falta direccion o referencia

#### Detalle y listado

- mostrar badge o estado visible cuando falta informacion de visita
- mostrar `dispatch_place_name` y `dispatch_address` en cards/detalle cuando existan
- mantener separada la evidencia GPS del reporte del destino operativo

#### Validaciones UX

- no obligar coordenada si el flujo no la necesita
- si hay coordenada sin direccion, mostrar aviso suave
- si hay direccion sin coordenada, permitir guardar igualmente en Fase 1

### Mobile

#### Contrato y almacenamiento

- extender tipos API para leer `target_*` y `dispatch_*`
- mapear esos campos en clientes API y repositorios locales
- decidir si deben persistirse offline completos o solo para asignadas activas

#### Notificaciones

- ampliar payload procesado por `useNotifications`
- soportar deep link hacia:
  - detalle de incidencia
  - futura pestaña `Mapa`
- mostrar contenido legible en la notificacion:
  - lugar
  - direccion
  - prioridad

#### Pantalla de detalle

- agregar bloque visible `Destino operativo`
- mostrar en orden:
  - `dispatch_place_name`
  - `dispatch_address`
  - `dispatch_reference`
  - contacto
  - mapa o CTA de navegacion
- agregar CTA:
  - `Abrir en Google Maps`
  - `Abrir en Waze` si esta disponible

#### Pestaña `Mapa`

- agregar nueva pestaña mobile `Mapa`
- usar `react-native-maps`
- mostrar posicion actual del tecnico
- mostrar pins de incidencias asignadas con coordenadas
- agregar filtros simples:
  - abiertas
  - en curso
  - criticas
- al tocar un pin, mostrar card con:
  - lugar
  - direccion
  - referencia
  - distancia estimada
  - `Ver incidencia`
  - `Ir`

#### Offline y sincronizacion

- definir si el mapa usa solo datos sincronizados locales o mezcla lectura online
- asegurar que `dispatch_*` y `target_*` entren en la estrategia offline existente
- decidir comportamiento cuando llega push y la incidencia aun no fue sincronizada localmente

### QA

#### Backend

- crear tests de contrato para `target_*` y `dispatch_*`
- cubrir push al asignar tecnico
- cubrir casos sin coordenada
- cubrir casos con direccion sin coordenada

#### Web

- testear create/edit con destino operativo completo
- testear incidencia sin destino operativo
- testear seleccion de punto desde mapa
- testear que el detalle diferencia GPS capturado vs destino operativo

#### Mobile

- testear apertura desde push
- testear render de detalle con y sin `dispatch_*`
- testear card del mapa con direccion legible
- testear CTA de navegacion externa
- testear comportamiento offline con incidencia asignada nueva

### Orden recomendado de implementacion

1. backend: esquema + contrato + endpoint `dispatch-target`
2. backend: push por asignacion
3. web: bloque `Destino operativo` en crear/editar
4. mobile: leer contrato y mostrar bloque en detalle
5. mobile: deep link desde notificacion
6. mobile: pestaña `Mapa`
7. web: seleccion directa de punto en mapa

### Corte sugerido para una primera entrega

Si se busca una V1 acotada y util:

- backend con `target_*` y `dispatch_*`
- web para editar destino operativo manualmente
- push por asignacion
- mobile mostrando destino operativo en detalle
- CTA de navegacion externa

Eso ya entrega valor real sin depender todavia del mapa embebido en mobile.
