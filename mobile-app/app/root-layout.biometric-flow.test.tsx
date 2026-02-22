import React from "react";
import { act, create } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const appStateRef = vi.hoisted(() => ({
  current: "active",
  listener: null as null | ((state: "active" | "background" | "inactive") => void),
}));

const biometricMocks = vi.hoisted(() => ({
  getBiometricAvailability: vi.fn(),
  authenticateWithBiometrics: vi.fn(),
}));

const appPreferencesMocks = vi.hoisted(() => ({
  getBiometricEnabled: vi.fn(),
}));

const notificationsHookMocks = vi.hoisted(() => ({
  useNotifications: vi.fn(() => ({
    loading: false,
    permissionStatus: null,
    expoPushToken: null,
    fcmPushToken: null,
    tokenRegisteredInApi: null,
    lastNotification: null,
    lastResponse: null,
    error: null,
  })),
}));

vi.mock("react-native-reanimated", () => ({}));

vi.mock("react-native", () => ({
  ActivityIndicator: ({ children }: any) =>
    React.createElement("ActivityIndicator", null, children),
  View: ({ children }: any) => React.createElement("View", null, children),
  StyleSheet: {
    create: (styles: any) => styles,
    absoluteFillObject: {},
  },
  AppState: {
    get currentState() {
      return appStateRef.current;
    },
    addEventListener: (_event: string, cb: (state: "active" | "background" | "inactive") => void) => {
      appStateRef.listener = cb;
      return {
        remove: () => {
          if (appStateRef.listener === cb) appStateRef.listener = null;
        },
      };
    },
  },
}));

vi.mock("@react-navigation/native", () => ({
  ThemeProvider: ({ children }: any) => React.createElement("ThemeProvider", null, children),
  DarkTheme: {},
  DefaultTheme: {},
}));

vi.mock("expo-router", () => {
  const Stack = ({ children }: any) => React.createElement("Stack", null, children);
  (Stack as any).Screen = ({ children }: any) => React.createElement("StackScreen", null, children);
  return {
    Stack,
    ErrorBoundary: () => null,
  };
});

vi.mock("@expo/vector-icons/FontAwesome", () => ({
  default: Object.assign(() => null, { font: {} }),
}));

vi.mock("expo-font", () => ({
  useFonts: () => [true, null],
}));

vi.mock("expo-splash-screen", () => ({
  preventAutoHideAsync: vi.fn(async () => undefined),
  hideAsync: vi.fn(async () => undefined),
}));

vi.mock("@/src/theme/theme-preference", () => ({
  ThemePreferenceProvider: ({ children }: any) => React.createElement(React.Fragment, null, children),
  useThemePreference: () => ({
    mode: "light",
    resolvedScheme: "light",
    loading: false,
    setMode: async () => undefined,
  }),
}));

vi.mock("@/src/components/BiometricLockScreen", () => ({
  default: (props: any) => React.createElement("BiometricLockScreenMock", props),
}));

vi.mock("@/src/services/biometric", () => biometricMocks);
vi.mock("@/src/storage/app-preferences", () => appPreferencesMocks);
vi.mock("@/src/hooks/useNotifications", () => notificationsHookMocks);

import { RootLayoutNav } from "./_layout";

function flushAsync(): Promise<void> {
  return act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("critical integration flow: biometric lock lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appStateRef.current = "active";
    appStateRef.listener = null;
  });

  it("locks when app returns to foreground and unlocks after successful biometric auth", async () => {
    appPreferencesMocks.getBiometricEnabled.mockResolvedValue(true);
    biometricMocks.getBiometricAvailability.mockResolvedValue({
      isAvailable: true,
      hasHardware: true,
      isEnrolled: true,
      supportedAuthenticationTypes: [2],
      biometricLabel: "Face ID",
    });

    let resolveSecondAttempt: ((value: { success: boolean }) => void) | null = null;
    biometricMocks.authenticateWithBiometrics
      .mockResolvedValueOnce({ success: true })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecondAttempt = resolve as (value: { success: boolean }) => void;
          }),
      );

    const treeRef: { current: { unmount: () => void; root: any } | null } = { current: null };
    await act(async () => {
      treeRef.current = create(<RootLayoutNav />);
    });
    await flushAsync();

    expect(biometricMocks.authenticateWithBiometrics).toHaveBeenCalledTimes(1);
    expect(
      treeRef.current?.root.findAll((node: any) => node.type === "BiometricLockScreenMock"),
    ).toHaveLength(0);

    await act(async () => {
      appStateRef.listener?.("background");
      appStateRef.current = "background";
      appStateRef.listener?.("active");
      appStateRef.current = "active";
      await Promise.resolve();
    });

    expect(biometricMocks.authenticateWithBiometrics).toHaveBeenCalledTimes(2);
    expect(
      treeRef.current?.root.findAll((node: any) => node.type === "BiometricLockScreenMock"),
    ).toHaveLength(1);

    await act(async () => {
      resolveSecondAttempt?.({ success: true });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      treeRef.current?.root.findAll((node: any) => node.type === "BiometricLockScreenMock"),
    ).toHaveLength(0);
    treeRef.current?.unmount();
  });
});
