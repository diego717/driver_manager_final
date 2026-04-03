import { database } from '../index'
import TechnicianAssignmentCache from '../models/TechnicianAssignmentCache'
import type { TechnicianAssignment } from '../../types/api'

function normalizeOptionalString(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : String(value ?? '').trim()
  return normalized || null
}

export const technicianAssignmentsCacheRepository = {
  async replaceForTechnician(
    technicianId: number,
    assignments: TechnicianAssignment[],
  ): Promise<void> {
    const collection = database.get<TechnicianAssignmentCache>('technician_assignments_cache')
    const existing = await collection.query().fetch()
    const targetId = Number(technicianId)
    const now = Date.now()

    await database.write(async () => {
      const toDelete = existing.filter((record) => Number(record.technicianId) === targetId)
      await Promise.all(toDelete.map((record) => record.markAsDeleted()))
      await Promise.all(toDelete.map((record) => record.destroyPermanently()))

      await Promise.all(
        assignments.map((assignment) =>
          collection.create((record) => {
            record.technicianId = targetId
            record.tenantId = normalizeOptionalString(assignment.tenant_id) || ''
            record.entityType = normalizeOptionalString(assignment.entity_type) || ''
            record.entityId = normalizeOptionalString(assignment.entity_id) || ''
            record.assignmentRole = normalizeOptionalString(assignment.assignment_role) || 'owner'
            record.assignedByUserId =
              assignment.assigned_by_user_id === null || assignment.assigned_by_user_id === undefined
                ? null
                : Number(assignment.assigned_by_user_id)
            record.assignedByUsername = normalizeOptionalString(assignment.assigned_by_username)
            record.assignedAt = normalizeOptionalString(assignment.assigned_at)
            record.unassignedAt = normalizeOptionalString(assignment.unassigned_at)
            record.metadataJson = normalizeOptionalString(assignment.metadata_json)
            record.technicianDisplayName = normalizeOptionalString(assignment.technician_display_name)
            record.technicianEmployeeCode = normalizeOptionalString(assignment.technician_employee_code)
            record.technicianIsActive =
              assignment.technician_is_active === null || assignment.technician_is_active === undefined
                ? null
                : Boolean(assignment.technician_is_active)
            record.cachedAt = new Date(now)
          }),
        ),
      )
    })
  },

  async listByTechnicianId(technicianId: number): Promise<TechnicianAssignment[]> {
    const records = await database.get<TechnicianAssignmentCache>('technician_assignments_cache').query().fetch()
    return records
      .filter((record) => Number(record.technicianId) === Number(technicianId))
      .map((record, index) => ({
        id: -1 * (index + 1),
        tenant_id: normalizeOptionalString(record.tenantId) || '',
        technician_id: Number(record.technicianId),
        entity_type: normalizeOptionalString(record.entityType) || '',
        entity_id: normalizeOptionalString(record.entityId) || '',
        assignment_role: normalizeOptionalString(record.assignmentRole) || 'owner',
        assigned_by_user_id:
          record.assignedByUserId === null || record.assignedByUserId === undefined
            ? null
            : Number(record.assignedByUserId),
        assigned_by_username: normalizeOptionalString(record.assignedByUsername) || '',
        assigned_at: normalizeOptionalString(record.assignedAt) || undefined,
        unassigned_at: normalizeOptionalString(record.unassignedAt),
        metadata_json: normalizeOptionalString(record.metadataJson),
        technician_display_name: normalizeOptionalString(record.technicianDisplayName) || '',
        technician_employee_code: normalizeOptionalString(record.technicianEmployeeCode) || '',
        technician_is_active:
          record.technicianIsActive === null || record.technicianIsActive === undefined
            ? null
            : Boolean(record.technicianIsActive),
      }))
  },
}
