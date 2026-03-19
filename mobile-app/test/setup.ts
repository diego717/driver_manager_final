import React from "react";
import { vi } from "vitest";

// Mirror Expo's native global in tests so imported modules can branch safely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).__DEV__ = false;

vi.mock("react-native-safe-area-context", () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  SafeAreaConsumer: ({ children }: { children: (insets: { top: number; right: number; bottom: number; left: number }) => React.ReactNode }) =>
    children({ top: 0, right: 0, bottom: 0, left: 0 }),
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  initialWindowMetrics: {
    frame: { x: 0, y: 0, width: 320, height: 640 },
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
  },
}));

vi.mock("expo-web-browser", () => ({
  openBrowserAsync: vi.fn(async () => ({ type: "opened" })),
}));
