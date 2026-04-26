# Manual de Usuario Web - SiteOps

Fecha: 2026-04-18  
Perfil: usuario web ya creado

## 1. Objetivo

Este manual explica como usar el dashboard web de SiteOps para operar registros, incidencias, mapa, equipos, drivers y controles de seguimiento.

## 2. Requisitos previos

- Tener usuario y contrasena activos.
- Acceder a la URL del dashboard de tu entorno.
- Tener un rol asignado (`admin`, `supervisor`, `tecnico`, `solo_lectura`, `super_admin`, `platform_owner`).

## 3. Acceso al sistema

1. Abrir la URL del dashboard.
2. En el modal **Iniciar sesion**, ingresar:
   - `Usuario`
   - `Contrasena`
3. Presionar **Ingresar**.
4. Si los datos son correctos, veras el mensaje de bienvenida y la pantalla **Hoy**.

Si aparece `Credenciales invalidas`, vuelve a intentar o solicita reset al administrador.

## 4. Navegacion principal

El menu lateral incluye estas secciones:

- **Hoy**: KPIs operativos, atencion ahora y tendencia.
- **Mis casos**: bandeja personal del tecnico vinculado.
- **Incidencias**: gestion de incidencias con contexto operativo.
- **Mapa**: incidencias geolocalizadas y edicion de destino operativo.
- **Registros**: listado operativo con filtros, exportacion y acceso por QR.
- **Equipos**: catalogo, detalle, QR e incidencias por equipo.
- **Drivers**: carga y listado de archivos de drivers.
- **Auditoria**: trazas de acciones del sistema.
- **Configuracion**: resumen de sesion, sincronizacion y accesos de administracion.
- **Tenants**: administracion de tenants (solo plataforma).

Acciones rapidas desde encabezado (**Mas acciones**):

- Nueva incidencia
- Escanear QR
- Notificaciones
- Actualizar dashboard
- Cambiar tema

## 5. Flujos principales

### 5.1 Hoy

- Revisa KPIs de incidencias criticas, en curso y fuera de SLA.
- Consulta metricas de salud GPS.
- Usa el grafico de tendencia (24h / 7d).
- Revisa la tarjeta **Atencion ahora** para priorizar eventos.

### 5.2 Mis casos

- Muestra incidencias asignadas al tecnico vinculado al usuario.
- Agrupa por estado: **Pendientes**, **En curso**, **Pausadas**, **Resueltas**.
- Usa **Actualizar** para refrescar la bandeja.

Si no hay tecnico vinculado, la vista mostrara el estado de vinculacion pendiente.

### 5.3 Registros

1. Buscar con el campo de busqueda en tiempo real.
2. Filtrar por marca, estado GPS y rango de fechas.
3. Usar:
   - **Aplicar**
   - **Limpiar Filtros**
   - **Escanear QR**
   - **Exportar** (CSV o Excel)
4. Abrir un registro para trabajar con su contexto.

### 5.4 Incidencias

Desde esta seccion puedes:

- Ver incidencias del tenant (segun rol).
- Crear incidencias nuevas.
- Cambiar estado (abierta, en curso, pausada, resuelta).
- Cargar y editar evidencia (checklist + nota + fotos).
- Editar destino operativo (coordenadas, direccion, contacto, notas).
- Ir a **Equipos** para operar por contexto de activo.

### 5.5 Mapa operativo

- Visualiza incidencias con coordenadas.
- Filtra por rango (7d, 30d, 90d, todo), estado y severidad.
- Selecciona un punto para ver detalle y acciones rapidas.
- Si tienes permisos operativos, puedes ajustar el destino del caso.

### 5.6 Equipos

1. Buscar por codigo, marca, modelo, serie o cliente.
2. Usar **Buscar** o **Actualizar**.
3. Abrir detalle de equipo para:
   - Ver contexto operativo.
   - Ver QR.
   - Crear incidencia asociada.
   - Vincular/desvincular contexto con registro (segun rol).
   - Gestionar prestamos/devoluciones (segun rol).

### 5.7 QR (alta y escaneo)

- **Nuevo equipo + QR** abre la pantalla de alta con generacion de codigo.
- Puedes generar QR de:
  - Equipo (`dm://asset/...`)
  - Instalacion (`dm://installation/{id}`)
- Herramientas avanzadas:
  - Copiar payload
  - Descargar imagen
  - Imprimir etiqueta
- **Escanear QR** permite camara o ingreso manual (fallback).

### 5.8 Drivers

- Completar marca, version y descripcion.
- Seleccionar archivo.
- Presionar **Subir driver**.
- Refrescar listado con **Actualizar**.

### 5.9 Auditoria

- Filtrar por tipo de accion (login, usuarios, incidencias, registros, etc.).
- Actualizar listado cuando necesites ver eventos recientes.

### 5.10 Configuracion

- Ver usuario activo, rol y estado de sincronizacion.
- Acceder rapido a auditoria.
- Cerrar sesion.
- Si tu rol lo permite, gestionar tecnicos y asignaciones desde este panel.

### 5.11 Tenants (plataforma)

- Ver metricas de tenants.
- Crear, editar o eliminar tenants.
- Gestionar usuarios por tenant.

## 6. Permisos por rol (resumen)

- **admin**: operacion completa del tenant + gestion de usuarios/tecnicos.
- **supervisor**: operacion y coordinacion (incluye asignaciones), sin gestion de usuarios.
- **tecnico**: foco en **Mis casos** y operacion de casos asignados.
- **solo_lectura**: consulta sin cambios.
- **platform_owner / super_admin (tenant default)**: control de plataforma y tenants.

Notas de visibilidad importantes:

- `tecnico` no ve el catalogo global de incidencias ni de equipos.
- `tecnico` usa principalmente **Mis casos** y **Mapa**.
- **Auditoria** y gestion de usuarios quedan para roles de administracion.

## 7. Cierre de sesion

- Usar **Cerrar sesion** desde barra lateral o desde **Configuracion**.

## 8. Solucion de problemas rapida

- **No veo una seccion**: probablemente tu rol no tiene acceso.
- **Error de login**: validar usuario/contrasena o solicitar reset.
- **No aparece contenido en Mis casos**: revisar vinculacion de tecnico al usuario web.
- **Mapa sin datos**: verificar incidencias con coordenadas y permisos de rol.
- **Sincronizacion en pausa**: refrescar dashboard o reconectar sesion.

## 9. Buenas practicas de uso

- Trabajar primero desde **Atencion ahora** y **Mis casos**.
- Mantener evidencia y estados al dia para trazabilidad.
- Usar filtros y exportacion en **Registros** para cierres operativos.
- Cerrar sesion al terminar el turno.
