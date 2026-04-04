import React from "react";
import { vi } from "vitest";

// Mirror Expo's native global in tests so imported modules can branch safely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).__DEV__ = false;
// Tell React test helpers that this environment supports act().
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const secureStoreState = new Map<string, string>();
const originalConsoleError = console.error.bind(console);
const originalConsoleWarn = console.warn.bind(console);
const REACT_TEST_NOISE_PATTERNS = [
  "react-test-renderer is deprecated.",
  "The current testing environment is not configured to support act(...)",
  "not wrapped in act(...)",
];

function shouldSuppressReactTestNoise(firstArg: unknown): boolean {
  const message = typeof firstArg === "string" ? firstArg : "";
  return REACT_TEST_NOISE_PATTERNS.some((pattern) => message.includes(pattern));
}

console.error = (...args: unknown[]) => {
  if (shouldSuppressReactTestNoise(args[0])) return;
  originalConsoleError(...args);
};

console.warn = (...args: unknown[]) => {
  if (shouldSuppressReactTestNoise(args[0])) return;
  originalConsoleWarn(...args);
};

vi.mock("expo-modules-core", () => ({
  EventEmitter: class EventEmitter {
    addListener() {
      return { remove: () => undefined };
    }
    removeAllListeners() {}
    emit() {}
  },
  Platform: { OS: "ios", select: (obj: Record<string, unknown>) => obj.ios ?? obj.default },
  requireNativeModule: () => ({}),
  requireOptionalNativeModule: () => null,
}));

vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: "after_first_unlock_this_device_only",
  setItemAsync: vi.fn(async (key: string, value: string) => {
    secureStoreState.set(key, value);
  }),
  getItemAsync: vi.fn(async (key: string) => secureStoreState.get(key) ?? null),
  deleteItemAsync: vi.fn(async (key: string) => {
    secureStoreState.delete(key);
  }),
}));

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

vi.mock("expo-haptics", () => ({
  NotificationFeedbackType: {
    Success: "success",
    Warning: "warning",
  },
  ImpactFeedbackStyle: {
    Light: "light",
  },
  notificationAsync: vi.fn(async () => undefined),
  selectionAsync: vi.fn(async () => undefined),
  impactAsync: vi.fn(async () => undefined),
}));

vi.mock("@/src/db/repositories/assigned-incidents-map-repository", () => ({
  assignedIncidentsMapRepository: {
    listAll: vi.fn(async () => []),
    replaceAll: vi.fn(async () => undefined),
    getByRemoteIncidentId: vi.fn(async () => null),
  },
}));
