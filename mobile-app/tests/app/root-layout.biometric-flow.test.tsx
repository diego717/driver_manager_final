import React from "react";
import Module from "node:module";
import { act, create } from "react-test-renderer";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

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

const webSessionStoreMocks = vi.hoisted(() => ({
  refreshSharedWebSessionState: vi.fn(async () => false),
}));

const syncRunnerMocks = vi.hoisted(() => ({
  runSync: vi.fn(),
}));

const networkMocks = vi.hoisted(() => ({
  listener: null as null | ((state: {
    isConnected?: boolean | null;
    isInternetReachable?: boolean | null;
  }) => void),
  getNetworkStateAsync: vi.fn(async () => ({
    isConnected: true,
    isInternetReachable: true,
  })),
  addNetworkStateListener: vi.fn((cb: (state: {
    isConnected?: boolean | null;
    isInternetReachable?: boolean | null;
  }) => void) => {
    networkMocks.listener = cb;
    return {
      remove: () => {
        if (networkMocks.listener === cb) {
          networkMocks.listener = null;
        }
      },
    };
  }),
}));

const originalModuleLoad = (Module as any)._load as (...args: any[]) => unknown;
(Module as any)._load = function patchedLoad(request: string, parent: unknown, isMain: boolean) {
  if (request.endsWith(".png")) {
    return 1;
  }
  return originalModuleLoad.call(this, request, parent, isMain);
};

vi.mock("react-native-reanimated", () => ({}));

vi.mock("react-native", () => ({
  ActivityIndicator: ({ children }: any) =>
    React.createElement("ActivityIndicator", null, children),
  Image: ({ children, ...props }: any) => React.createElement("Image", props, children),
  Platform: {
    OS: "ios",
    select: (options: Record<string, unknown>) => options.ios ?? options.default,
  },
  Text: ({ children, ...props }: any) => React.createElement("Text", props, children),
  View: ({ children }: any) => React.createElement("View", null, children),
  Animated: {
    Value: function AnimatedValue(this: any, initial: number) {
      this._value = initial;
      this.setValue = (next: number) => {
        this._value = next;
      };
    } as any,
    View: ({ children, ...props }: any) => React.createElement("AnimatedView", props, children),
    timing: () => ({
      start: (cb?: () => void) => cb?.(),
      stop: () => undefined,
    }),
    sequence: () => ({
      start: (cb?: () => void) => cb?.(),
      stop: () => undefined,
    }),
    parallel: () => ({
      start: (cb?: () => void) => cb?.(),
      stop: () => undefined,
    }),
    loop: () => ({
      start: (cb?: () => void) => cb?.(),
      stop: () => undefined,
    }),
  },
  Easing: {
    quad: () => 0,
    inOut: (fn: unknown) => fn,
  },
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
    useRouter: () => ({
      push: vi.fn(),
      replace: vi.fn(),
      back: vi.fn(),
    }),
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

vi.mock("expo-network", () => networkMocks);

vi.mock("@/src/theme/theme-preference", () => ({
  ThemePreferenceProvider: ({ children }: any) => React.createElement(React.Fragment, null, children),
  useThemePreference: () => ({
    mode: "light",
    resolvedScheme: "light",
    loading: false,
    setMode: async () => undefined,
  }),
}));
vi.mock("@/src/theme/palette", () => ({
  useAppPalette: () => ({
    surface: "#ffffff",
    textPrimary: "#111111",
    screenBg: "#f5f7fa",
    overlayBg: "rgba(0, 0, 0, 0.4)",
    primaryButtonText: "#ffffff",
  }),
  getNavigationTheme: () => ({
    dark: false,
    colors: {
      primary: "#0f756d",
      background: "#f5f7fa",
      card: "#ffffff",
      text: "#111111",
      border: "#dce1e8",
      notification: "#dc2626",
    },
    fonts: {},
  }),
}));

vi.mock("@/src/components/BiometricLockScreen", () => ({
  default: (props: any) => React.createElement("BiometricLockScreenMock", props),
}));

vi.mock("@/src/services/biometric", () => biometricMocks);
vi.mock("@/src/storage/app-preferences", () => appPreferencesMocks);
vi.mock("@/src/hooks/useNotifications", () => notificationsHookMocks);
vi.mock("@/src/session/web-session-store", () => webSessionStoreMocks);
vi.mock("@/src/services/sync/incident-outbox-service", () => ({
  registerIncidentExecutors: vi.fn(),
}));
vi.mock("@/src/services/sync/sync-runner", () => syncRunnerMocks);

import { RootLayoutNav } from "@/app/_layout";

afterAll(() => {
  (Module as any)._load = originalModuleLoad;
});

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
    networkMocks.listener = null;
    networkMocks.getNetworkStateAsync.mockResolvedValue({
      isConnected: true,
      isInternetReachable: true,
    });
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
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

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

  it("triggers sync when connectivity is restored", async () => {
    appPreferencesMocks.getBiometricEnabled.mockResolvedValue(false);

    const treeRef: { current: { unmount: () => void } | null } = { current: null };
    await act(async () => {
      treeRef.current = create(<RootLayoutNav />);
    });
    await flushAsync();

    expect(syncRunnerMocks.runSync).toHaveBeenCalledTimes(1);

    await act(async () => {
      networkMocks.listener?.({
        isConnected: false,
        isInternetReachable: false,
      });
      networkMocks.listener?.({
        isConnected: true,
        isInternetReachable: true,
      });
      await Promise.resolve();
    });

    expect(syncRunnerMocks.runSync).toHaveBeenCalledTimes(2);
    treeRef.current?.unmount();
  });
});
