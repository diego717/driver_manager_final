# Guia rapida de tono y microcopy (web + mobile)

## Objetivo
Mantener un tono operativo, claro y accionable en todos los estados de la interfaz, evitando mensajes genericos.

## Principios
1. Decir que pasa ahora.
2. Decir que puede hacer el usuario despues.
3. Usar lenguaje corto, directo y sin tecnicismos innecesarios.
4. Evitar mensajes ambiguos como "sin informacion" sin sugerir accion.
5. No usar "Inicia sesion..." como placeholder si la vista ya es posterior al login.

## Formato recomendado
- Estado vacio: `No hay X para mostrar.`
- Siguiente accion: `Haz Y para continuar.`
- Ejemplo: `No hay equipos para mostrar. Usa la busqueda para listar equipos.`

## Microcopy por contexto
- Dashboard (centro del turno): `Sin actividad critica por ahora. Revisa registros en curso para priorizar.`
- Mis casos: `Sin casos asignados por ahora. Actualiza o cambia el filtro de estado.`
- Registros: `No hay registros para este filtro. Limpia filtros o actualiza para recargar.`
- Equipos: `No hay equipos para mostrar. Usa la busqueda por codigo, serie o cliente.`
- Equipo y contexto: `Selecciona un equipo para ver su contexto operativo e incidencias.`
- Incidencias: `No hay incidencias en esta vista. Abre un registro o cambia el rango temporal.`
- Mapa: `No hay incidencias geolocalizadas en este rango. Amplia periodo o revisa asignaciones.`
- Tecnicos: `No hay tecnicos para mostrar. Actualiza la lista o revisa el tenant activo.`
- Tenants: `No hay tenants para mostrar. Actualiza la lista o crea un nuevo tenant.`
- Auditoria: `No hay eventos para este periodo. Ajusta filtros para ver actividad.`
- Visual Lab: `Selecciona una variante para comparar estilo, contraste y jerarquia.`

## Estados de feedback (tono)
- Cargando: `Cargando datos...`
- Exito: `Cambios guardados correctamente.`
- Advertencia: `Hay datos incompletos. Revisa los campos marcados.`
- Error recuperable: `No se pudo completar la accion. Intenta nuevamente.`
- Error con accion: `No se pudo actualizar. Reintentar.`

## Checklist rapido antes de merge
1. El mensaje explica contexto y accion siguiente.
2. El texto cabe en 1 o 2 lineas en mobile.
3. El tono es consistente con el resto del producto.
4. No hay mojibake ni caracteres rotos.
