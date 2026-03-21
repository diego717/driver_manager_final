import { Database } from '@nozbe/watermelondb'
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite'
import { schemaMigrations, addColumns, createTable } from '@nozbe/watermelondb/Schema/migrations'

import { mySchema } from './schema'
import Incident from './models/Incident'
import Photo from './models/Photo'
import SyncJob from './models/SyncJob'
import LocalCase from './models/LocalCase'

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
  ],
})
