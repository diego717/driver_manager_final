import { Model } from '@nozbe/watermelondb'
import { date, field, text } from '@nozbe/watermelondb/decorators'

export default class AssignedIncidentMapCache extends Model {
  static table = 'assigned_incidents_map_cache'

  @field('incident_remote_id') incidentRemoteId: number
  @field('installation_id') installationId: number
  @field('asset_id') assetId: number | null
  @text('severity') severity: string
  @text('incident_status') incidentStatus: string
  @text('created_at_iso') createdAtIso: string
  @field('target_lat') targetLat: number | null
  @field('target_lng') targetLng: number | null
  @text('target_label') targetLabel: string | null
  @text('dispatch_place_name') dispatchPlaceName: string | null
  @text('dispatch_address') dispatchAddress: string | null
  @text('dispatch_reference') dispatchReference: string | null
  @text('dispatch_contact_name') dispatchContactName: string | null
  @text('dispatch_contact_phone') dispatchContactPhone: string | null
  @text('dispatch_notes') dispatchNotes: string | null
  @text('installation_client_name') installationClientName: string | null
  @text('installation_label') installationLabel: string | null
  @text('asset_code') assetCode: string | null
  @text('assignment_role') assignmentRole: string | null
  @text('assignment_source') assignmentSource: string | null
  @text('assigned_at') assignedAt: string | null
  @date('cached_at') cachedAt: Date
}
