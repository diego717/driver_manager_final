import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

export const INCIDENTS_NOTIFICATION_CHANNEL_ID = "incidents";

interface ExpoConfigExtra {
  eas?: {
    projectId?: string;
  };
}

let notificationHandlerConfigured = false;

function resolveProjectId(): string | undefined {
  const easProjectId = Constants.easConfig?.projectId;
  const extra = Constants.expoConfig?.extra as ExpoConfigExtra | undefined;
  return easProjectId ?? extra?.eas?.projectId;
}

export function configureNotificationHandler(): void {
  if (notificationHandlerConfigured) return;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });

  notificationHandlerConfigured = true;
}

export async function ensureIncidentNotificationChannel(): Promise<void> {
  if (Platform.OS !== "android") return;

  await Notifications.setNotificationChannelAsync(INCIDENTS_NOTIFICATION_CHANNEL_ID, {
    name: "Incidencias",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#0b7a75",
    sound: "default",
  });
}

export async function requestNotificationPermission(): Promise<Notifications.PermissionStatus> {
  const currentPermission = await Notifications.getPermissionsAsync();
  let permissionStatus = currentPermission.status;

  if (permissionStatus !== Notifications.PermissionStatus.GRANTED) {
    const requestedPermission = await Notifications.requestPermissionsAsync();
    permissionStatus = requestedPermission.status;
  }

  return permissionStatus;
}

export interface PushRegistrationResult {
  permissionStatus: Notifications.PermissionStatus;
  expoPushToken: string | null;
  fcmToken: string | null;
}

function toPushTokenString(value: unknown): string | null {
  // Defensive normalization: Android/Expo push token payload shape has varied
  // across SDK/device combinations (string, numeric values, byte arrays).
  // We keep all historical cases to avoid dropping valid FCM tokens in the field.
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (Array.isArray(value)) {
    const joined = value
      .map((item) => (typeof item === "number" ? item : null))
      .filter((item): item is number => item !== null)
      .map((item) => String.fromCharCode(item))
      .join("");
    const normalized = joined.trim();
    return normalized.length > 0 ? normalized : null;
  }

  if (ArrayBuffer.isView(value)) {
    const view = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const normalized = String.fromCharCode(...view).trim();
    return normalized.length > 0 ? normalized : null;
  }

  return null;
}

export async function registerForPushNotifications(): Promise<PushRegistrationResult> {
  configureNotificationHandler();

  if (Platform.OS === "web") {
    return {
      permissionStatus: Notifications.PermissionStatus.UNDETERMINED,
      expoPushToken: null,
      fcmToken: null,
    };
  }

  await ensureIncidentNotificationChannel();
  const permissionStatus = await requestNotificationPermission();
  if (permissionStatus !== Notifications.PermissionStatus.GRANTED) {
    return {
      permissionStatus,
      expoPushToken: null,
      fcmToken: null,
    };
  }

  const deviceTokenResponse = await Notifications.getDevicePushTokenAsync();
  const fcmToken =
    deviceTokenResponse.type === "fcm"
      ? toPushTokenString(deviceTokenResponse.data)
      : null;

  let expoPushToken: string | null = null;
  const projectId = resolveProjectId();
  if (projectId) {
    const tokenResponse = await Notifications.getExpoPushTokenAsync({ projectId });
    expoPushToken = tokenResponse.data || null;
  }

  return {
    permissionStatus,
    expoPushToken,
    fcmToken,
  };
}

export function addNotificationListeners(params: {
  onNotificationReceived?: (notification: Notifications.Notification) => void;
  onNotificationResponse?: (response: Notifications.NotificationResponse) => void;
}): () => void {
  const receivedSubscription = params.onNotificationReceived
    ? Notifications.addNotificationReceivedListener(params.onNotificationReceived)
    : null;

  const responseSubscription = params.onNotificationResponse
    ? Notifications.addNotificationResponseReceivedListener(
        params.onNotificationResponse,
      )
    : null;

  return () => {
    receivedSubscription?.remove();
    responseSubscription?.remove();
  };
}
