export type IncidentSeverity = "low" | "medium" | "high" | "critical";
export type IncidentSource = "desktop" | "mobile" | "web";
export type IncidentStatus = "open" | "in_progress" | "paused" | "resolved";
export type InstallationConformityStatus = "generated" | "emailed" | "email_failed";
export type GpsCaptureStatus =
  | "pending"
  | "captured"
  | "denied"
  | "timeout"
  | "unavailable"
  | "unsupported"
  | "override";
export type GpsCaptureSource = "browser" | "none" | "override";
export type GeofenceResult = "not_applicable" | "inside" | "outside";

export interface GpsCapturePayload {
  status: GpsCaptureStatus;
  source?: GpsCaptureSource;
  lat?: number;
  lng?: number;
  accuracy_m?: number;
  captured_at?: string;
  note?: string;
}

export interface CreateIncidentInput {
  note: string;
  time_adjustment_seconds?: number;
  severity?: IncidentSeverity;
  source?: IncidentSource;
  apply_to_installation?: boolean;
  reporter_username?: string;
  gps?: GpsCapturePayload;
  geofence_override_note?: string;
}

export interface IncidentPhoto {
  id: number;
  incident_id: number;
  r2_key: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  sha256: string | null;
  created_at: string;
}

export interface Incident {
  id: number;
  installation_id: number;
  asset_id?: number | null;
  reporter_username: string;
  note: string;
  time_adjustment_seconds: number;
  severity: IncidentSeverity;
  source: IncidentSource;
  created_at: string;
  incident_status?: IncidentStatus;
  status_updated_at?: string | null;
  status_updated_by?: string | null;
  estimated_duration_seconds?: number | null;
  work_started_at?: string | null;
  work_ended_at?: string | null;
  actual_duration_seconds?: number | null;
  resolved_at?: string | null;
  resolved_by?: string | null;
  resolution_note?: string | null;
  checklist_items?: string[];
  evidence_note?: string | null;
  photos: IncidentPhoto[];
}

export interface TechnicianRecord {
  id: number;
  tenant_id: string;
  web_user_id: number | null;
  display_name: string;
  email?: string;
  phone?: string;
  employee_code?: string;
  notes?: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
  active_assignment_count?: number;
}

export interface TechnicianAssignment {
  id: number;
  tenant_id: string;
  technician_id: number;
  entity_type: "installation" | "incident" | "asset" | "zone" | string;
  entity_id: string;
  assignment_role: "owner" | "assistant" | "reviewer" | string;
  assigned_by_user_id?: number | null;
  assigned_by_username?: string;
  assigned_at?: string;
  unassigned_at?: string | null;
  metadata_json?: string | null;
  technician_display_name?: string;
  technician_employee_code?: string;
  technician_is_active?: boolean | null;
}

export interface InstallationRecord {
  id: number;
  timestamp?: string;
  driver_brand?: string;
  driver_version?: string;
  status?: string;
  client_name?: string;
  driver_description?: string;
  installation_time_seconds?: number;
  os_info?: string;
  notes?: string;
  incident_open_count?: number;
  incident_in_progress_count?: number;
  incident_paused_count?: number;
  incident_resolved_count?: number;
  incident_active_count?: number;
  incident_critical_active_count?: number;
  site_lat?: number | null;
  site_lng?: number | null;
  site_radius_m?: number | null;
  attention_state?:
    | "clear"
    | "open"
    | "in_progress"
    | "paused"
    | "resolved"
    | "critical"
    | string;
}

export interface InstallationConformity {
  id: number;
  installation_id: number;
  tenant_id: string;
  signed_by_name: string;
  signed_by_document: string;
  email_to: string;
  summary_note: string;
  technician_note: string;
  signature_r2_key: string;
  pdf_r2_key: string;
  signed_at: string;
  generated_at: string;
  generated_by_user_id?: number | null;
  generated_by_username: string;
  session_version?: number | null;
  request_ip?: string;
  platform: string;
  status: InstallationConformityStatus;
  photo_count: number;
  metadata_json?: string;
  pdf_download_path?: string;
}

export type CreateRecordInput = Omit<InstallationRecord, "id">;

export interface CreateInstallationConformityInput {
  signed_by_name: string;
  signed_by_document?: string;
  email_to: string;
  signature_data_url: string;
  summary_note?: string;
  technician_name?: string;
  technician_note?: string;
  include_all_incident_photos?: boolean;
  photo_ids?: number[];
  send_email?: boolean;
  gps?: GpsCapturePayload;
  geofence_override_note?: string;
}

export interface ApiErrorResponse {
  success?: false;
  error?: {
    code?: string;
    message?: string;
  };
}

export interface CreateIncidentResponse {
  success: boolean;
  incident: Omit<Incident, "photos">;
}

export interface DeleteIncidentResponse {
  success: boolean;
  incident_id: number;
  deleted_at: string;
}

export interface UpdateIncidentStatusInput {
  incident_status: IncidentStatus;
  resolution_note?: string;
  reporter_username?: string;
}

export interface UpdateIncidentEvidenceInput {
  checklist_items?: string[];
  evidence_note?: string | null;
  reporter_username?: string;
}

export interface ListIncidentsResponse {
  success: boolean;
  installation_id: number;
  incidents: Incident[];
}

export interface CreateRecordResponse {
  success: boolean;
  record: InstallationRecord;
}

export interface UpdateInstallationInput {
  notes?: string;
  installation_time_seconds?: number;
  site_lat?: number | null;
  site_lng?: number | null;
  site_radius_m?: number | null;
}

export interface UpdateInstallationResponse {
  success: boolean;
  updated: string;
  installation: InstallationRecord;
}

export interface PublicTrackingLinkSnapshot {
  public_status?: string;
  status_label?: string;
  summary_text?: string;
  client_name?: string | null;
  latest_incident_id?: number | null;
  latest_conformity_id?: number | null;
}

export interface PublicTrackingLink {
  active: boolean;
  status: string;
  token_id?: string | null;
  installation_id?: number | null;
  issued_at?: string | null;
  expires_at?: string | null;
  revoked_at?: string | null;
  tracking_url?: string | null;
  snapshot?: PublicTrackingLinkSnapshot | null;
}

export interface GetPublicTrackingLinkResponse {
  success: boolean;
  link: PublicTrackingLink;
}

export interface CreatePublicTrackingLinkResponse {
  success: boolean;
  link: PublicTrackingLink;
}

export interface DeletePublicTrackingLinkResponse {
  success: boolean;
  revoked: boolean;
}

export interface CreateInstallationConformityResponse {
  success: boolean;
  conformity: InstallationConformity;
}

export interface GetInstallationConformityResponse {
  success: boolean;
  conformity: InstallationConformity | null;
}

export interface UploadPhotoResponse {
  success: boolean;
  photo: IncidentPhoto;
}

export interface DashboardStatistics {
  total_installations: number;
  successful_installations: number;
  failed_installations: number;
  success_rate?: number;
  average_time_minutes?: number;
  unique_clients?: number;
  incident_in_progress_count?: number;
  incident_critical_active_count?: number;
  incident_outside_sla_count?: number;
  incident_sla_minutes?: number;
  by_brand?: Record<string, number>;
  top_drivers?: Record<string, number>;
}
