import { Database } from '@nozbe/watermelondb'
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite'

import { mySchema } from './schema'
import { migrations } from './migrations'
import Incident from './models/Incident'
import Photo from './models/Photo'

const adapter = new SQLiteAdapter({
  schema: mySchema,
  migrations,
  // (You might want to provide jsi: true here for improved performance.)
})

export const database = new Database({
  adapter,
  modelClasses: [
    Incident,
    Photo,
  ],
})
