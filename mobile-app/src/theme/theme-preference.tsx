import React, { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useColorScheme as useSystemColorScheme } from "react-native";

import {
  getStoredThemeMode,
  setStoredThemeMode,
  type ThemeMode,
} from "../storage/secure";

type ResolvedScheme = "light" | "dark";

interface ThemePreferenceContextValue {
  mode: ThemeMode;
  resolvedScheme: ResolvedScheme;
  loading: boolean;
  setMode: (mode: ThemeMode) => Promise<void>;
}

const ThemePreferenceContext = createContext<ThemePreferenceContextValue | undefined>(undefined);

export function ThemePreferenceProvider({ children }: { children: ReactNode }) {
  const systemScheme = useSystemColorScheme();
  const [mode, setModeState] = useState<ThemeMode>("light");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    void (async () => {
      try {
        const storedMode = await getStoredThemeMode();
        if (isMounted && storedMode) {
          setModeState(storedMode);
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, []);

  const resolvedScheme: ResolvedScheme =
    mode === "system" ? (systemScheme === "dark" ? "dark" : "light") : mode;

  const setMode = async (nextMode: ThemeMode) => {
    setModeState(nextMode);
    await setStoredThemeMode(nextMode);
  };

  const value = useMemo<ThemePreferenceContextValue>(
    () => ({
      mode,
      resolvedScheme,
      loading,
      setMode,
    }),
    [loading, mode, resolvedScheme],
  );

  return (
    <ThemePreferenceContext.Provider value={value}>
      {children}
    </ThemePreferenceContext.Provider>
  );
}

export function useThemePreference(): ThemePreferenceContextValue {
  const ctx = useContext(ThemePreferenceContext);
  if (!ctx) {
    throw new Error("useThemePreference must be used within ThemePreferenceProvider");
  }
  return ctx;
}
