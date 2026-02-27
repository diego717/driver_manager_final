import { appSchema, tableSchema } from '@nozbe/watermelondb'

export const mySchema = appSchema({
  version: 2,
  tables: [
    tableSchema({
      name: 'incidents',
      columns: [
        { name: 'installation_id', type: 'number', isIndexed: true },
        { name: 'reporter_username', type: 'string' },
        { name: 'note', type: 'string' },
        { name: 'time_adjustment_seconds', type: 'number' },
        { name: 'severity', type: 'string' },
        { name: 'source', type: 'string' },
        { name: 'checklist_applied_json', type: 'string', isOptional: true },
        { name: 'created_at', type: 'number' }, // WatermelonDB expects numbers for dates
        // Local-only fields
        { name: 'is_synced', type: 'boolean', isIndexed: true, isOptional: false },
        { name: 'remote_id', type: 'number', isOptional: true, isIndexed: true },
      ]
    }),
    tableSchema({
      name: 'photos',
      columns: [
        { name: 'incident_id', type: 'string', isIndexed: true },
        { name: 'r2_key', type: 'string', isOptional: true },
        { name: 'file_name', type: 'string' },
        { name: 'content_type', type: 'string' },
        { name: 'size_bytes', type: 'number' },
        { name: 'sha256', type: 'string', isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'captured_at', type: 'number', isOptional: true },
        { name: 'latitude', type: 'number', isOptional: true },
        { name: 'longitude', type: 'number', isOptional: true },
        { name: 'accuracy_m', type: 'number', isOptional: true },
        // Local-only fields
        { name: 'is_synced', type: 'boolean', isIndexed: true, isOptional: false },
        { name: 'local_path', type: 'string' },
        { name: 'remote_id', type: 'number', isOptional: true, isIndexed: true },
      ]
    })
  ]
})
