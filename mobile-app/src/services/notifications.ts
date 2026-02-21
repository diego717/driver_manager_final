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
  token: string | null;
}

export async function registerForPushNotifications(): Promise<PushRegistrationResult> {
  configureNotificationHandler();

  if (Platform.OS === "web") {
    return {
      permissionStatus: Notifications.PermissionStatus.UNDETERMINED,
      token: null,
    };
  }

  await ensureIncidentNotificationChannel();
  const permissionStatus = await requestNotificationPermission();
  if (permissionStatus !== Notifications.PermissionStatus.GRANTED) {
    return {
      permissionStatus,
      token: null,
    };
  }

  const projectId = resolveProjectId();
  if (!projectId) {
    throw new Error("No se encontro eas.projectId para registrar notificaciones push.");
  }

  const tokenResponse = await Notifications.getExpoPushTokenAsync({ projectId });

  return {
    permissionStatus,
    token: tokenResponse.data,
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
