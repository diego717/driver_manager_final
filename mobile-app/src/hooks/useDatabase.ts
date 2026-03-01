import { createContext, createElement, type ReactNode, useContext } from "react";
import { Database } from "@nozbe/watermelondb";

import { database } from "../db";

const DatabaseContext = createContext<Database | null>(null);

export const DatabaseProvider = ({ children }: { children: ReactNode }) =>
  createElement(DatabaseContext.Provider, { value: database }, children);

export const useDatabase = () => {
  const db = useContext(DatabaseContext);
  if (!db) {
    throw new Error("useDatabase must be used within a DatabaseProvider");
  }
  return db;
};
