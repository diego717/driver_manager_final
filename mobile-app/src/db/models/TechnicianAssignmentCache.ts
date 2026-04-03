import { Model } from '@nozbe/watermelondb'
import { date, field, text } from '@nozbe/watermelondb/decorators'

export default class TechnicianAssignmentCache extends Model {
  static table = 'technician_assignments_cache'

  @field('technician_id') technicianId!: number
  @text('tenant_id') tenantId!: string
  @text('entity_type') entityType!: string
  @text('entity_id') entityId!: string
  @text('assignment_role') assignmentRole!: string
  @field('assigned_by_user_id') assignedByUserId!: number | null
  @text('assigned_by_username') assignedByUsername!: string | null
  @text('assigned_at') assignedAt!: string | null
  @text('unassigned_at') unassignedAt!: string | null
  @text('metadata_json') metadataJson!: string | null
  @text('technician_display_name') technicianDisplayName!: string | null
  @text('technician_employee_code') technicianEmployeeCode!: string | null
  @field('technician_is_active') technicianIsActive!: boolean | null
  @date('cached_at') cachedAt!: Date
}
