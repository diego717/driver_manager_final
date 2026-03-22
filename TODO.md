# Incidencias Eliminadas - Auditoría Super Admin

✅ **PLAN APROBADO POR USUARIO** - Implementación completa

## 📋 Checklist de Trabajo

### 1. Backend (worker/routes/incidents.js) - ✅ PENDIENTE
- [ ] Soporte `?include_deleted=1` en GET `/web/installations/:id/incidents`
- [ ] Restricción `super_admin` solamente (403 otros roles)
- [ ] Devolver `deleted_at`, `deleted_by`, `deletion_reason`

### 2. Frontend API (dashboard-api.js) - ✅ PENDIENTE
- [ ] `getIncidents(installationId, {includeDeleted: true})` envía param

### 3. Frontend UI (dashboard-incidents.js) - ✅ PENDIENTE
- [ ] Toggle "Mostrar eliminadas (auditoría)" solo super_admin
- [ ] Cards eliminadas: read-only + metadata auditoría
- [ ] Toggle persiste y recarga lista

### 4. Operativo (README.md) - ✅ PENDIENTE
- [ ] Comandos migración `0015_incident_soft_delete.sql`

---

**PRÓXIMO PASO**: Confirmar migración D1 aplicada → `npm run d1:migrate:remote`
**VALIDAR**: `curl "https://driver-manager-db.../web/installations/33/incidents"` → ve `deleted_at`

