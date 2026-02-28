# Cierre comercial y escalamiento — Plan de implementación

Este documento aterriza las 5 iniciativas propuestas para cerrar la fase comercial y llevar el producto a un nivel robusto de operación multiempresa.

## Objetivo general

Pasar de una solución funcional a una oferta **escalable, vendible y operable** con:
- Métricas ejecutivas por cliente (tenant).
- Personalización de marca por tenant.
- Automatización de entregables (reportes PDF/Excel).
- Carga masiva de datos para acelerar onboarding en Windows.
- Empaquetado comercial + onboarding guiado + kit de ventas.

---

## 1) Dashboard ejecutivo por empresa

### Alcance funcional
Panel por tenant con al menos:
- **MTTR** (tiempo medio de resolución).
- **Cumplimiento SLA** (% en tiempo / fuera de tiempo).
- **Reincidencia** (tickets repetidos por activo/sede/categoría).
- **Productividad** (tickets cerrados por técnico, por período, FCR si aplica).

### Entregables
- API de KPIs por tenant (filtros por período, sede, equipo, técnico).
- Vista dashboard (web) con tarjetas KPI + tendencias + top causales.
- Definiciones formales de métricas (diccionario de datos) para evitar ambigüedad comercial.

### Criterios de aceptación
- Todos los KPIs calculan por tenant sin fuga de datos entre empresas.
- Respuesta < 2s para período mensual con dataset objetivo.
- Exportable (ver punto 3) y consistente con los datos operativos.

### Riesgos y mitigación
- **Riesgo:** métricas inconsistentes por falta de normalización histórica.  
  **Mitigación:** tabla/materialized view de agregados diarios y validación cruzada.

---

## 2) Branding por tenant

### Alcance funcional
Configurable por empresa:
- Logo.
- Nombre comercial.
- Paleta de colores (primario/secundario/estado).
- Dominio por subruta (ej: `/acme`) o alternativa por subdominio a futuro.

### Entregables
- Modelo de datos de branding por tenant.
- Capa de theming en frontend (runtime, no hardcode).
- Gestión de assets (logo) con validaciones de formato/tamaño.

### Criterios de aceptación
- Cambiar branding sin redeploy.
- Fallback seguro a tema default si falta algún asset.
- Aislamiento correcto por tenant en navegación y sesión.

### Riesgos y mitigación
- **Riesgo:** impacto visual no uniforme en componentes legacy.  
  **Mitigación:** inventario UI + tokens de diseño + prueba visual regresiva.

---

## 3) Exportes automáticos PDF/Excel por período

### Alcance funcional
- Programación de exportes (diario/semanal/mensual).
- Tipos de reportes: ejecutivo, operativo, SLA y productividad.
- Formatos: PDF (presentación) + Excel (análisis).
- Envío por correo/lista de distribución o descarga desde panel.

### Entregables
- Job scheduler + cola de procesamiento.
- Plantillas de reporte con branding tenant.
- Historial de ejecuciones (éxito/falla, duración, tamaño).

### Criterios de aceptación
- Reintentos automáticos ante fallos transitorios.
- Trazabilidad completa (auditoría) de quién configuró y cuándo se envió.
- Integridad: el reporte refleja exactamente el rango solicitado.

### Riesgos y mitigación
- **Riesgo:** reportes pesados en picos horarios.  
  **Mitigación:** colas asincrónicas, límites por tenant y procesamiento off-peak.

---

## 4) Windows: importación masiva CSV/Excel de instalaciones/equipos

### Alcance funcional
- Asistente en desktop para importar instalaciones/equipos desde CSV/XLSX.
- Mapping de columnas + vista previa + validación previa a persistencia.
- Modo dry-run para detectar errores antes de aplicar cambios.

### Entregables
- Parser robusto CSV/XLSX (encoding, delimitadores, fechas).
- Reglas de validación (campos obligatorios, formatos, duplicados).
- Reporte de resultados (insertados, actualizados, rechazados con causa).

### Criterios de aceptación
- Importación de lotes grandes sin bloquear UI.
- Idempotencia configurable (upsert por clave natural/externa).
- Registro auditable por usuario/archivo/fecha.

### Riesgos y mitigación
- **Riesgo:** datos sucios del cliente frenan onboarding.  
  **Mitigación:** plantillas oficiales + prevalidaciones + catálogo de errores accionables.

---

## 5) Packaging comercial + onboarding guiado + material de ventas

### Alcance funcional
- Definición de planes (Starter, Pro, Enterprise) con límites y features.
- Onboarding guiado (checklist por hitos y “time-to-value”).
- Kit comercial: deck, one-pager, ROI calculator, casos de uso por vertical.

### Entregables
- Matriz de pricing/feature flags por plan.
- Flujo onboarding in-app (paso a paso + progreso).
- Playbook comercial y material estándar para demos.

### Criterios de aceptación
- Demo repetible en < 20 min con historia de valor clara.
- Nuevo cliente operativo base en < 7 días.
- Objeciones comerciales cubiertas con evidencia (KPIs y casos).

### Riesgos y mitigación
- **Riesgo:** promesa comercial supera madurez operativa.  
  **Mitigación:** gate de salida por readiness checklist técnico/comercial.

---

## ¿Con esto alcanza para algo “muy robusto”?

Sí, este paquete deja la base **muy sólida**. Para cerrar robustez empresarial, recomiendo agregar explícitamente estos frentes transversales:

1. **Seguridad y cumplimiento**
   - RBAC fino por tenant/rol.
   - Auditoría inmutable de acciones críticas.
   - Políticas de retención y borrado.

2. **Facturación y gobierno comercial**
   - Suscripciones, límites por plan y control de consumo.
   - Gestión de trial, upgrades y renovaciones.

3. **Observabilidad y SRE**
   - Métricas técnicas (latencia, error rate, colas).
   - Alertas y SLO por módulo crítico.
   - Plan de contingencia y backups verificados.

4. **Calidad y releases**
   - Entorno staging multi-tenant.
   - Suite de regresión (API/UI/import/export).
   - Rollback rápido y changelog por versión.

5. **Éxito de cliente (postventa)**
   - QBR trimestral con KPI de valor.
   - NPS/CSAT y circuito de feedback a roadmap.

---

## Hoja de ruta sugerida (12 semanas)

### Fase 1 (Semanas 1-4): Fundaciones
- Modelo multi-tenant para KPIs + branding.
- Definición de métricas y diccionario de datos.
- Diseño de exportes y arquitectura de colas.

### Fase 2 (Semanas 5-8): Entrega de valor comercial
- Dashboard ejecutivo v1.
- Branding tenant v1.
- Importación masiva Windows v1 (dry-run + reporte errores).

### Fase 3 (Semanas 9-12): Escalamiento operativo
- Exportes automáticos productivos.
- Onboarding guiado + packaging comercial.
- Hardening: observabilidad, auditoría y QA de regresión.

---

## Checklist de salida (Go-to-Market Ready)

- [ ] KPIs ejecutivos validados con al menos 2 tenants piloto.
- [ ] Branding tenant en producción sin redeploy.
- [ ] Exportes automáticos estables por 2 ciclos completos.
- [ ] Importación masiva validada con datasets reales de clientes.
- [ ] Material comercial unificado y demo script cerrado.
- [ ] Onboarding guiado medido con tasa de finalización.
- [ ] Seguridad, auditoría y backup con pruebas documentadas.

---

## Resultado esperado

Con estas 5 líneas más los frentes transversales sugeridos, el producto queda en un nivel **comercialmente vendible y operacionalmente escalable**, con mejor velocidad de onboarding, mejor retención y mayor claridad de valor para cada empresa.
