import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeState = vi.hoisted(() => ({
  os: "ios",
  appOwnership: undefined as string | undefined,
  executionEnvironment: undefined as string | undefined,
  projectId: undefined as string | undefined,
  extraProjectId: undefined as string | undefined,
}));

const notificationMocks = vi.hoisted(() => ({
  PermissionStatus: {
    GRANTED: "granted",
    DENIED: "denied",
    UNDETERMINED: "undetermined",
  },
  AndroidImportance: {
    HIGH: "high",
  },
  setNotificationHandler: vi.fn(),
  setNotificationChannelAsync: vi.fn(async () => undefined),
  getPermissionsAsync: vi.fn(async () => ({ status: "undetermined" })),
  requestPermissionsAsync: vi.fn(async () => ({ status: "granted" })),
  getDevicePushTokenAsync: vi.fn(async () => ({ type: "fcm", data: "token-1" })),
  getExpoPushTokenAsync: vi.fn(async () => ({ data: "expo-token-1" })),
  addNotificationReceivedListener: vi.fn(() => ({ remove: vi.fn() })),
  addNotificationResponseReceivedListener: vi.fn(() => ({ remove: vi.fn() })),
}));

vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return runtimeState.os;
    },
  },
}));

vi.mock("expo-constants", () => ({
  default: {
    get appOwnership() {
      return runtimeState.appOwnership;
    },
    get executionEnvironment() {
      return runtimeState.executionEnvironment;
    },
    get easConfig() {
      return runtimeState.projectId ? { projectId: runtimeState.projectId } : undefined;
    },
    get expoConfig() {
      return runtimeState.extraProjectId
        ? { extra: { eas: { projectId: runtimeState.extraProjectId } } }
        : undefined;
    },
  },
}));

vi.mock("expo-notifications", () => notificationMocks);

vi.mock("@/src/theme/palette", () => ({
  getAppPalette: () => ({
    accent: "#0f8b84",
  }),
}));

async function loadNotificationsModule() {
  vi.resetModules();
  return import("./notifications");
}

describe("notifications service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeState.os = "ios";
    runtimeState.appOwnership = undefined;
    runtimeState.executionEnvironment = undefined;
    runtimeState.projectId = undefined;
    runtimeState.extraProjectId = undefined;
  });

  it("configures the notification handler only once per module instance", async () => {
    const notifications = await loadNotificationsModule();

    notifications.configureNotificationHandler();
    notifications.configureNotificationHandler();

    expect(notificationMocks.setNotificationHandler).toHaveBeenCalledTimes(1);
  });

  it("skips native registration entirely on web", async () => {
    runtimeState.os = "web";
    const notifications = await loadNotificationsModule();

    const result = await notifications.registerForPushNotifications();

    expect(result).toEqual({
      permissionStatus: "undetermined",
      expoPushToken: null,
      fcmToken: null,
    });
    expect(notificationMocks.getPermissionsAsync).not.toHaveBeenCalled();
  });

  it("skips Android push token registration inside Expo Go", async () => {
    runtimeState.os = "android";
    runtimeState.appOwnership = "expo";
    const notifications = await loadNotificationsModule();

    const result = await notifications.registerForPushNotifications();

    expect(result).toEqual({
      permissionStatus: "undetermined",
      expoPushToken: null,
      fcmToken: null,
    });
    expect(notificationMocks.setNotificationChannelAsync).not.toHaveBeenCalled();
  });

  it("registers channel permissions and normalizes byte-array FCM tokens", async () => {
    runtimeState.os = "android";
    runtimeState.projectId = "project-123";
    notificationMocks.getDevicePushTokenAsync.mockResolvedValueOnce({
      type: "fcm",
      data: [116, 111, 107, 101, 110],
    });

    const notifications = await loadNotificationsModule();
    const result = await notifications.registerForPushNotifications();

    expect(notificationMocks.setNotificationChannelAsync).toHaveBeenCalledWith("incidents", {
      name: "Incidencias",
      importance: "high",
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#0f8b84",
      sound: "default",
    });
    expect(notificationMocks.getExpoPushTokenAsync).toHaveBeenCalledWith({
      projectId: "project-123",
    });
    expect(result).toEqual({
      permissionStatus: "granted",
      expoPushToken: "expo-token-1",
      fcmToken: "token",
    });
  });

  it("removes registered listeners on cleanup", async () => {
    const receivedRemove = vi.fn();
    const responseRemove = vi.fn();
    notificationMocks.addNotificationReceivedListener.mockReturnValueOnce({
      remove: receivedRemove,
    });
    notificationMocks.addNotificationResponseReceivedListener.mockReturnValueOnce({
      remove: responseRemove,
    });

    const notifications = await loadNotificationsModule();
    const cleanup = notifications.addNotificationListeners({
      onNotificationReceived: vi.fn(),
      onNotificationResponse: vi.fn(),
    });

    cleanup();

    expect(receivedRemove).toHaveBeenCalledTimes(1);
    expect(responseRemove).toHaveBeenCalledTimes(1);
  });
});
