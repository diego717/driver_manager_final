import { database } from '../index'
import AssignedIncidentMapCache from '../models/AssignedIncidentMapCache'
import type { AssignedIncidentMapItem } from '../../types/api'

function normalizeOptionalString(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : String(value ?? '').trim()
  return normalized || null
}

function normalizeOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function mapRecord(model: AssignedIncidentMapCache): AssignedIncidentMapItem {
  return {
    id: Number(model.incidentRemoteId),
    installation_id: Number(model.installationId),
    asset_id: model.assetId ?? null,
    note: '',
    severity: normalizeOptionalString(model.severity) || 'low',
    incident_status: normalizeOptionalString(model.incidentStatus) || 'open',
    created_at: normalizeOptionalString(model.createdAtIso) || '',
    target_lat: model.targetLat ?? null,
    target_lng: model.targetLng ?? null,
    target_label: normalizeOptionalString(model.targetLabel),
    dispatch_place_name: normalizeOptionalString(model.dispatchPlaceName),
    dispatch_address: normalizeOptionalString(model.dispatchAddress),
    dispatch_reference: normalizeOptionalString(model.dispatchReference),
    dispatch_contact_name: normalizeOptionalString(model.dispatchContactName),
    dispatch_contact_phone: normalizeOptionalString(model.dispatchContactPhone),
    dispatch_notes: normalizeOptionalString(model.dispatchNotes),
    installation_client_name: normalizeOptionalString(model.installationClientName),
    installation_label: normalizeOptionalString(model.installationLabel),
    asset_code: normalizeOptionalString(model.assetCode),
    assignment_role: normalizeOptionalString(model.assignmentRole) || 'owner',
    assignment_source: normalizeOptionalString(model.assignmentSource),
    assigned_at: normalizeOptionalString(model.assignedAt),
  }
}

export const assignedIncidentsMapRepository = {
  async replaceAll(items: AssignedIncidentMapItem[]): Promise<void> {
    const collection = database.get<AssignedIncidentMapCache>('assigned_incidents_map_cache')
    const existing = await collection.query().fetch()
    const now = Date.now()

    await database.write(async () => {
      await Promise.all(existing.map((record) => record.markAsDeleted()))
      await Promise.all(existing.map((record) => record.destroyPermanently()))

      await Promise.all(
        items.map((item) =>
          collection.create((record) => {
            record.incidentRemoteId = Number(item.id)
            record.installationId = Number(item.installation_id)
            record.assetId = normalizeOptionalNumber(item.asset_id)
            record.severity = normalizeOptionalString(item.severity) || 'low'
            record.incidentStatus = normalizeOptionalString(item.incident_status) || 'open'
            record.createdAtIso = normalizeOptionalString(item.created_at) || ''
            record.targetLat = normalizeOptionalNumber(item.target_lat)
            record.targetLng = normalizeOptionalNumber(item.target_lng)
            record.targetLabel = normalizeOptionalString(item.target_label)
            record.dispatchPlaceName = normalizeOptionalString(item.dispatch_place_name)
            record.dispatchAddress = normalizeOptionalString(item.dispatch_address)
            record.dispatchReference = normalizeOptionalString(item.dispatch_reference)
            record.dispatchContactName = normalizeOptionalString(item.dispatch_contact_name)
            record.dispatchContactPhone = normalizeOptionalString(item.dispatch_contact_phone)
            record.dispatchNotes = normalizeOptionalString(item.dispatch_notes)
            record.installationClientName = normalizeOptionalString(item.installation_client_name)
            record.installationLabel = normalizeOptionalString(item.installation_label)
            record.assetCode = normalizeOptionalString(item.asset_code)
            record.assignmentRole = normalizeOptionalString(item.assignment_role) || 'owner'
            record.assignmentSource = normalizeOptionalString(item.assignment_source)
            record.assignedAt = normalizeOptionalString(item.assigned_at)
            record.cachedAt = new Date(now)
          }),
        ),
      )
    })
  },

  async listAll(): Promise<AssignedIncidentMapItem[]> {
    const records = await database
      .get<AssignedIncidentMapCache>('assigned_incidents_map_cache')
      .query()
      .fetch()
    return records.map(mapRecord)
  },

  async getByRemoteIncidentId(incidentId: number): Promise<AssignedIncidentMapItem | null> {
    const records = await database
      .get<AssignedIncidentMapCache>('assigned_incidents_map_cache')
      .query()
      .fetch()
    const match = records.find((record) => Number(record.incidentRemoteId) === Number(incidentId))
    return match ? mapRecord(match) : null
  },
}
