export type IncidentSeverity = "low" | "medium" | "high" | "critical";
export type IncidentSource = "desktop" | "mobile" | "web";

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
  reporter_username: string;
  note: string;
  time_adjustment_seconds: number;
  severity: IncidentSeverity;
  source: IncidentSource;
  created_at: string;
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

export interface ListIncidentsResponse {
  success: boolean;
  installation_id: number;
  incidents: Incident[];
}

export interface UploadPhotoResponse {
  success: boolean;
  photo: IncidentPhoto;
}
