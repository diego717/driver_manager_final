import { createContext, useContext, ReactNode } from 'react'
import { Database } from '@nozbe/watermelondb'
import { database } from '../db'

const DatabaseContext = createContext<Database | null>(null)

export const DatabaseProvider = ({ children }: { children: ReactNode }) => {
  return (
    <DatabaseContext.Provider value={database}>
      {children}
    </DatabaseContext.Provider>
  )
}

export const useDatabase = () => {
  const db = useContext(DatabaseContext)
  if (!db) {
    throw new Error('useDatabase must be used within a DatabaseProvider')
  }
  return db
}
