import { Database } from '@nozbe/watermelondb'
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite'
import { schemaMigrations, addColumns, createTable } from '@nozbe/watermelondb/Schema/migrations'

import { mySchema } from './schema'
import Incident from './models/Incident'
import Photo from './models/Photo'
import SyncJob from './models/SyncJob'
import LocalCase from './models/LocalCase'
import AssignedIncidentMapCache from './models/AssignedIncidentMapCache'
import TechnicianAssignmentCache from './models/TechnicianAssignmentCache'

/**
 * WatermelonDB migrations from v1 → v2.
 * This preserves existing data on device upgrade.
 */
const migrations = schemaMigrations({
  migrations: [
    {
      toVersion: 2,
      steps: [
        // Extend incidents table
        addColumns({
          table: 'incidents',
          columns: [
            { name: 'local_id', type: 'string', isIndexed: true },
            { name: 'remote_installation_id', type: 'number', isOptional: true },
            { name: 'sync_status', type: 'string', isIndexed: true },
            { name: 'sync_attempts', type: 'number' },
            { name: 'last_sync_error', type: 'string', isOptional: true },
            { name: 'client_request_id', type: 'string' },
          ],
        }),
        // Extend photos table
        addColumns({
          table: 'photos',
          columns: [
            { name: 'local_id', type: 'string' },
            { name: 'remote_photo_id', type: 'number', isOptional: true },
            { name: 'sync_status', type: 'string', isIndexed: true },
            { name: 'sync_attempts', type: 'number' },
            { name: 'last_sync_error', type: 'string', isOptional: true },
            { name: 'client_request_id', type: 'string' },
          ],
        }),
        // New sync_jobs table
        createTable({
          name: 'sync_jobs',
          columns: [
            { name: 'entity_type', type: 'string' },
            { name: 'entity_local_id', type: 'string', isIndexed: true },
            { name: 'operation', type: 'string' },
            { name: 'depends_on_job_id', type: 'string', isOptional: true },
            { name: 'status', type: 'string', isIndexed: true },
            { name: 'attempt_count', type: 'number' },
            { name: 'next_retry_at', type: 'number' },
            { name: 'last_error', type: 'string', isOptional: true },
            { name: 'priority', type: 'number' },
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
        // New cases_local table (stub for phase 3)
        createTable({
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
    },
    {
      toVersion: 3,
      steps: [
        addColumns({
          table: 'incidents',
          columns: [
            { name: 'gps_capture_status', type: 'string' },
            { name: 'gps_capture_source', type: 'string' },
            { name: 'gps_lat', type: 'number', isOptional: true },
            { name: 'gps_lng', type: 'number', isOptional: true },
            { name: 'gps_accuracy_m', type: 'number', isOptional: true },
            { name: 'gps_captured_at', type: 'string', isOptional: true },
            { name: 'gps_capture_note', type: 'string' },
            // Legacy column kept only for on-device schema compatibility during upgrades.
            { name: 'geofence_override_note', type: 'string' },
          ],
        }),
      ],
    },
    {
      toVersion: 4,
      steps: [
        addColumns({
          table: 'photos',
          columns: [
            { name: 'remote_incident_id', type: 'number', isOptional: true },
            { name: 'local_incident_local_id', type: 'string', isOptional: true },
          ],
        }),
      ],
    },
    {
      toVersion: 5,
      steps: [
        addColumns({
          table: 'incidents',
          columns: [
            { name: 'local_case_local_id', type: 'string', isOptional: true },
          ],
        }),
      ],
    },
    {
      toVersion: 6,
      steps: [
        createTable({
          name: 'assigned_incidents_map_cache',
          columns: [
            { name: 'incident_remote_id', type: 'number', isIndexed: true },
            { name: 'installation_id', type: 'number', isIndexed: true },
            { name: 'asset_id', type: 'number', isOptional: true },
            { name: 'severity', type: 'string' },
            { name: 'incident_status', type: 'string', isIndexed: true },
            { name: 'created_at_iso', type: 'string' },
            { name: 'target_lat', type: 'number', isOptional: true },
            { name: 'target_lng', type: 'number', isOptional: true },
            { name: 'target_label', type: 'string', isOptional: true },
            { name: 'dispatch_place_name', type: 'string', isOptional: true },
            { name: 'dispatch_address', type: 'string', isOptional: true },
            { name: 'dispatch_reference', type: 'string', isOptional: true },
            { name: 'dispatch_contact_name', type: 'string', isOptional: true },
            { name: 'dispatch_contact_phone', type: 'string', isOptional: true },
            { name: 'dispatch_notes', type: 'string', isOptional: true },
            { name: 'installation_client_name', type: 'string', isOptional: true },
            { name: 'installation_label', type: 'string', isOptional: true },
            { name: 'asset_code', type: 'string', isOptional: true },
            { name: 'assignment_role', type: 'string', isOptional: true },
            { name: 'assignment_source', type: 'string', isOptional: true },
            { name: 'assigned_at', type: 'string', isOptional: true },
            { name: 'cached_at', type: 'number', isIndexed: true },
          ],
        }),
      ],
    },
    {
      toVersion: 7,
      steps: [
        addColumns({
          table: 'incidents',
          columns: [
            { name: 'asset_id', type: 'number', isOptional: true },
            { name: 'incident_status', type: 'string' },
            { name: 'status_updated_at', type: 'string', isOptional: true },
            { name: 'status_updated_by', type: 'string', isOptional: true },
            { name: 'estimated_duration_seconds', type: 'number', isOptional: true },
            { name: 'work_started_at', type: 'string', isOptional: true },
            { name: 'work_ended_at', type: 'string', isOptional: true },
            { name: 'actual_duration_seconds', type: 'number', isOptional: true },
            { name: 'resolved_at', type: 'string', isOptional: true },
            { name: 'resolved_by', type: 'string', isOptional: true },
            { name: 'resolution_note', type: 'string', isOptional: true },
            { name: 'target_lat', type: 'number', isOptional: true },
            { name: 'target_lng', type: 'number', isOptional: true },
            { name: 'target_label', type: 'string', isOptional: true },
            { name: 'target_source', type: 'string', isOptional: true },
            { name: 'target_updated_at', type: 'string', isOptional: true },
            { name: 'target_updated_by', type: 'string', isOptional: true },
            { name: 'dispatch_place_name', type: 'string', isOptional: true },
            { name: 'dispatch_address', type: 'string', isOptional: true },
            { name: 'dispatch_reference', type: 'string', isOptional: true },
            { name: 'dispatch_contact_name', type: 'string', isOptional: true },
            { name: 'dispatch_contact_phone', type: 'string', isOptional: true },
            { name: 'dispatch_notes', type: 'string', isOptional: true },
            { name: 'checklist_items_json', type: 'string', isOptional: true },
            { name: 'evidence_note', type: 'string', isOptional: true },
          ],
        }),
      ],
    },
    {
      toVersion: 8,
      steps: [
        createTable({
          name: 'technician_assignments_cache',
          columns: [
            { name: 'technician_id', type: 'number', isIndexed: true },
            { name: 'tenant_id', type: 'string' },
            { name: 'entity_type', type: 'string', isIndexed: true },
            { name: 'entity_id', type: 'string', isIndexed: true },
            { name: 'assignment_role', type: 'string' },
            { name: 'assigned_by_user_id', type: 'number', isOptional: true },
            { name: 'assigned_by_username', type: 'string', isOptional: true },
            { name: 'assigned_at', type: 'string', isOptional: true },
            { name: 'unassigned_at', type: 'string', isOptional: true },
            { name: 'metadata_json', type: 'string', isOptional: true },
            { name: 'technician_display_name', type: 'string', isOptional: true },
            { name: 'technician_employee_code', type: 'string', isOptional: true },
            { name: 'technician_is_active', type: 'boolean', isOptional: true },
            { name: 'cached_at', type: 'number', isIndexed: true },
          ],
        }),
      ],
    },
    {
      toVersion: 9,
      steps: [
        addColumns({
          table: 'incidents',
          columns: [
            { name: 'dispatch_required', type: 'boolean' },
          ],
        }),
      ],
    },
  ],
})

const adapter = new SQLiteAdapter({
  schema: mySchema,
  migrations,
  // jsi: true — enable for better performance once confirmed available
})

export const database = new Database({
  adapter,
  modelClasses: [
    Incident,
    Photo,
    SyncJob,
    LocalCase,
    AssignedIncidentMapCache,
    TechnicianAssignmentCache,
  ],
})
