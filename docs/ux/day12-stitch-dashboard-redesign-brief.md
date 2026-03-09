# Día 12 - Brief para Stitch (Rediseño Dashboard Operativo)

Fecha: 2026-03-09  
Skills aplicados: `adapt`, `normalize`

## Objetivo
Validar en Stitch una nueva dirección UX/UI para Web antes de implementar código:

- Mejorar foco operativo (decisiones del turno) sobre analítica decorativa.
- Reorganizar navegación lateral para priorizar tareas reales.
- Mantener consistencia con tokens actuales (teal/acento, estados, espaciado) y accesibilidad AA.

## Diagnóstico del diseño actual
- El Dashboard mezcla resumen ejecutivo con tareas operativas.
- Exceso de visualizaciones compitiendo entre sí (3 gráficos + cards + tabla).
- Jerarquía de información débil para identificar “qué hacer ahora”.
- Navegación lateral sin agrupación por intención de uso.

## Dirección de rediseño
Convertir el Dashboard en **Centro de Operación del Turno**.

### Información principal (arriba de todo)
1. Incidencias críticas abiertas.
2. Registros en curso.
3. Registros fuera de SLA.
4. Última sincronización.

### Visual principal (único)
- Tendencia de registros con barras.
- Línea objetivo/SLA superpuesta.
- Toggle temporal: `24h` y `7d`.
- Sin pie chart ni gráfico por marca en esta pantalla.

### Bloque de acción inmediata
- Lista “Atención ahora” (top 5).
- Cada item con: prioridad, cliente/equipo, estado, tiempo en estado, CTA directo.
- CTA sugeridos: `Ver`, `Tomar`, `Resolver`.

## Nueva IA de sidebar
Agrupar por intención:

- Operación
  - Hoy
  - Registros
  - Incidencias
- Activos
  - Equipos
  - Drivers
- Control
  - Auditoría (según rol)
  - Configuración

Regla de prioridad visual:
- `Hoy` y `Incidencias` con mayor prominencia.
- `Auditoría` y `Configuración` baja prominencia.

## Adaptación responsive esperada

### Desktop
- Sidebar fija con grupos y separadores claros.
- Zona principal con:
  - Fila KPI operativa.
  - Gráfico de tendencia ancho completo.
  - Lista “Atención ahora”.

### Mobile
- Navegación inferior: `Hoy`, `Registros`, `Incidencias`, `Más`.
- Layout en una columna.
- CTA siempre dentro de zona cómoda de pulgar.
- Targets mínimos 44x44.

## Prompt principal para Stitch
```text
Rediseña la pantalla principal de SiteOps como “Centro de Operación del Turno”.

Contexto:
- Aplicación operativa para seguimiento de registros e incidencias.
- El diseño actual es funcional pero recargado de métricas poco accionables.
- Quiero una interfaz moderna, clara y sobria, consistente con tema claro/oscuro.

Objetivo UX:
- Priorizar “qué hacer ahora” sobre analítica secundaria.
- Reducir ruido visual y mejorar jerarquía de decisión.

Estructura obligatoria:
1) Sidebar con grupos:
   - Operación: Hoy, Registros, Incidencias
   - Activos: Equipos, Drivers
   - Control: Auditoría, Configuración
2) Header compacto con estado de sincronización y acciones rápidas.
3) Cuatro KPIs operativos:
   - Incidencias críticas abiertas
   - Registros en curso
   - Registros fuera de SLA
   - Última sincronización
4) Un único visual principal:
   - Tendencia de registros (barras) + línea de objetivo/SLA
   - Selector 24h / 7d
5) Lista “Atención ahora” con top 5 casos accionables.

Reglas:
- Mantener claridad, no usar visuales decorativos innecesarios.
- Contraste AA en warning/error.
- Estados de acción claros (primary/secondary/danger).
- Touch targets mínimos 44x44.
- Debe incluir variante mobile:
  - Bottom nav con Hoy, Registros, Incidencias, Más.

Entrega:
- Propuesta desktop y mobile del mismo sistema visual.
- Jerarquía tipográfica clara.
- CTA principal destacado sin saturar color.
```

## Prompt de iteración (después del primer resultado)
```text
Itera la propuesta priorizando aún más la operación:
- Reduce elementos secundarios en el header.
- Haz más evidente la lista “Atención ahora”.
- Aumenta contraste entre prioridad crítica/alta/media.
- Simplifica copys y evita textos largos.
- Mantén consistencia visual con el sistema de colores y espaciado.
```

## Criterios de aceptación (antes de implementar código)
- La acción principal del turno se identifica en menos de 3 segundos.
- El usuario entiende el estado operativo sin leer toda la pantalla.
- Solo existe un visual principal de tendencia.
- Sidebar agrupada por intención, no por listado plano.
- En mobile no se pierde funcionalidad clave.
- Targets y contraste cumplen mínimos de accesibilidad definidos.

## Handoff a implementación
Si el diseño en Stitch queda aprobado:

1. Aplicar estructura en `dashboard.html`.
2. Actualizar layout/tokens en `dashboard.css`.
3. Adaptar render y loaders en `dashboard.js`:
   - Reemplazar cards/visuales actuales.
   - Mantener `trend` como único gráfico principal.
4. Ajustar textos y estados en español consistente.
5. Actualizar tests de accesibilidad y smoke web.
