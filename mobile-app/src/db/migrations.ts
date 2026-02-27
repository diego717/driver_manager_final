import { schemaMigrations, addColumns } from '@nozbe/watermelondb/Schema/migrations'

export const migrations = schemaMigrations({
  migrations: [
    {
      toVersion: 2,
      steps: [
        addColumns({
          table: 'incidents',
          columns: [{ name: 'checklist_applied_json', type: 'string', isOptional: true }],
        }),
        addColumns({
          table: 'photos',
          columns: [
            { name: 'captured_at', type: 'number', isOptional: true },
            { name: 'latitude', type: 'number', isOptional: true },
            { name: 'longitude', type: 'number', isOptional: true },
            { name: 'accuracy_m', type: 'number', isOptional: true },
          ],
        }),
      ],
    },
  ],
})
