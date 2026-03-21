export type IncidentSeverity = "low" | "medium" | "high" | "critical";
export type IncidentSource = "desktop" | "mobile" | "web";
export type IncidentStatus = "open" | "in_progress" | "paused" | "resolved";

export interface CreateIncidentInput {
  note: string;
  time_adjustment_seconds?: number;
  severity?: IncidentSeverity;
  source?: IncidentSource;
  apply_to_installation?: boolean;
  reporter_username?: string;
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
  attention_state?:
    | "clear"
    | "open"
    | "in_progress"
    | "paused"
    | "resolved"
    | "critical"
    | string;
}

export type CreateRecordInput = Omit<InstallationRecord, "id">;

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
