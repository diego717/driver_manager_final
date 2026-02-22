import React, { useEffect } from "react";
import { act, create } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const notificationsServiceMocks = vi.hoisted(() => ({
  configureNotificationHandler: vi.fn(),
  addNotificationListeners: vi.fn(() => vi.fn()),
  registerForPushNotifications: vi.fn(),
}));

const devicesApiMocks = vi.hoisted(() => ({
  registerDeviceToken: vi.fn(async () => true),
}));

const clientApiMocks = vi.hoisted(() => ({
  extractApiError: vi.fn((error: unknown) =>
    error instanceof Error ? error.message : String(error),
  ),
}));

const expoNotificationsMocks = vi.hoisted(() => ({
  PermissionStatus: {
    GRANTED: "granted",
    DENIED: "denied",
    UNDETERMINED: "undetermined",
  },
  getLastNotificationResponseAsync: vi.fn(async () => null),
}));

vi.mock("@/src/services/notifications", () => notificationsServiceMocks);
vi.mock("@/src/api/devices", () => devicesApiMocks);
vi.mock("@/src/api/client", () => clientApiMocks);
vi.mock("expo-notifications", () => expoNotificationsMocks);
vi.mock("expo-constants", () => ({
  default: {
    deviceName: "Test Device",
    expoConfig: { version: "1.0.0" },
    nativeAppVersion: "1.0.0",
  },
}));
vi.mock("react-native", () => ({
  Platform: { OS: "android" },
}));

import { useNotifications, type UseNotificationsState } from "./useNotifications";

function flushAsync(): Promise<void> {
  return act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useNotifications hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationsServiceMocks.addNotificationListeners.mockReturnValue(vi.fn());
    expoNotificationsMocks.getLastNotificationResponseAsync.mockResolvedValue(null);
  });

  it("keeps tokenRegisteredInApi as null when fcmToken is null", async () => {
    notificationsServiceMocks.registerForPushNotifications.mockResolvedValueOnce({
      permissionStatus: expoNotificationsMocks.PermissionStatus.DENIED,
      expoPushToken: null,
      fcmToken: null,
    });

    const latestRef: { current: UseNotificationsState | null } = { current: null };
    const Probe = () => {
      const state = useNotifications();
      useEffect(() => {
        latestRef.current = state;
      }, [state]);
      return null;
    };

    const treeRef: { current: { unmount: () => void } | null } = { current: null };
    await act(async () => {
      treeRef.current = create(<Probe />);
    });
    await flushAsync();

    expect(devicesApiMocks.registerDeviceToken).not.toHaveBeenCalled();
    expect(latestRef.current?.tokenRegisteredInApi).toBeNull();
    expect(latestRef.current?.loading).toBe(false);

    treeRef.current?.unmount();
  });

  it("does not call registerDeviceToken when push registration has no token", async () => {
    notificationsServiceMocks.registerForPushNotifications.mockResolvedValueOnce({
      permissionStatus: expoNotificationsMocks.PermissionStatus.GRANTED,
      expoPushToken: "expo-token",
      fcmToken: null,
    });

    const Probe = () => {
      useNotifications();
      return null;
    };

    const treeRef: { current: { unmount: () => void } | null } = { current: null };
    await act(async () => {
      treeRef.current = create(<Probe />);
    });
    await flushAsync();

    expect(devicesApiMocks.registerDeviceToken).not.toHaveBeenCalled();
    treeRef.current?.unmount();
  });

  it("sets error when registerForPushNotifications throws", async () => {
    notificationsServiceMocks.registerForPushNotifications.mockRejectedValueOnce(
      new Error("push failure"),
    );

    const latestRef: { current: UseNotificationsState | null } = { current: null };
    const Probe = () => {
      const state = useNotifications();
      useEffect(() => {
        latestRef.current = state;
      }, [state]);
      return null;
    };

    const treeRef: { current: { unmount: () => void } | null } = { current: null };
    await act(async () => {
      treeRef.current = create(<Probe />);
    });
    await flushAsync();

    expect(latestRef.current?.error).toBe("push failure");
    expect(latestRef.current?.loading).toBe(false);
    treeRef.current?.unmount();
  });
});
