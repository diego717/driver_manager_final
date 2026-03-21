import { appSchema, tableSchema } from '@nozbe/watermelondb'

export const mySchema = appSchema({
  version: 2,
  tables: [
    tableSchema({
      name: 'incidents',
      columns: [
        // Core fields
        { name: 'installation_id', type: 'number', isIndexed: true },
        { name: 'reporter_username', type: 'string' },
        { name: 'note', type: 'string' },
        { name: 'time_adjustment_seconds', type: 'number' },
        { name: 'severity', type: 'string' },
        { name: 'source', type: 'string' },
        { name: 'created_at', type: 'number' },
        // Legacy sync fields (keep for compatibility)
        { name: 'is_synced', type: 'boolean', isIndexed: true },
        { name: 'remote_id', type: 'number', isOptional: true, isIndexed: true },
        // Offline sync v2
        { name: 'local_id', type: 'string', isIndexed: true },
        { name: 'remote_installation_id', type: 'number', isOptional: true },
        { name: 'sync_status', type: 'string', isIndexed: true }, // pending|syncing|failed|synced
        { name: 'sync_attempts', type: 'number' },
        { name: 'last_sync_error', type: 'string', isOptional: true },
        { name: 'client_request_id', type: 'string' },
      ],
    }),
    tableSchema({
      name: 'photos',
      columns: [
        // Core fields
        { name: 'incident_id', type: 'string', isIndexed: true },
        { name: 'r2_key', type: 'string', isOptional: true },
        { name: 'file_name', type: 'string' },
        { name: 'content_type', type: 'string' },
        { name: 'size_bytes', type: 'number' },
        { name: 'sha256', type: 'string', isOptional: true },
        { name: 'created_at', type: 'number' },
        // Legacy sync fields
        { name: 'is_synced', type: 'boolean', isIndexed: true },
        { name: 'local_path', type: 'string' },
        { name: 'remote_id', type: 'number', isOptional: true, isIndexed: true },
        // Offline sync v2
        { name: 'local_id', type: 'string' },
        { name: 'remote_photo_id', type: 'number', isOptional: true },
        { name: 'sync_status', type: 'string', isIndexed: true },
        { name: 'sync_attempts', type: 'number' },
        { name: 'last_sync_error', type: 'string', isOptional: true },
        { name: 'client_request_id', type: 'string' },
      ],
    }),
    tableSchema({
      name: 'sync_jobs',
      columns: [
        { name: 'entity_type', type: 'string' },       // case|incident|incident_evidence|photo
        { name: 'entity_local_id', type: 'string', isIndexed: true },
        { name: 'operation', type: 'string' },          // create_incident|upload_photo|etc
        { name: 'depends_on_job_id', type: 'string', isOptional: true },
        { name: 'status', type: 'string', isIndexed: true }, // pending|syncing|failed|synced
        { name: 'attempt_count', type: 'number' },
        { name: 'next_retry_at', type: 'number' },      // epoch ms; 0 = run immediately
        { name: 'last_error', type: 'string', isOptional: true },
        { name: 'priority', type: 'number' },           // lower = higher priority
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    // Stub for phase 3 (case manual offline)
    tableSchema({
      name: 'cases_local',
      columns: [
        { name: 'local_id', type: 'string', isIndexed: true },
        { name: 'remote_id', type: 'number', isOptional: true },
        { name: 'client_name', type: 'string' },
        { name: 'notes', type: 'string' },
        { name: 'sync_status', type: 'string', isIndexed: true },
        { name: 'sync_attempts', type: 'number' },
        { name: 'last_sync_error', type: 'string', isOptional: true },
        { name: 'client_request_id', type: 'string' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
  ],
})
