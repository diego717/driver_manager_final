import { useEffect, useMemo, useState } from "react";
import * as Notifications from "expo-notifications";

import { extractApiError } from "@/src/api/client";
import {
  addNotificationListeners,
  configureNotificationHandler,
  registerForPushNotifications,
} from "@/src/services/notifications";

export interface UseNotificationsState {
  loading: boolean;
  permissionStatus: Notifications.PermissionStatus | null;
  expoPushToken: string | null;
  lastNotification: Notifications.Notification | null;
  lastResponse: Notifications.NotificationResponse | null;
  error: string | null;
}

export function useNotifications(): UseNotificationsState {
  const [loading, setLoading] = useState(true);
  const [permissionStatus, setPermissionStatus] =
    useState<Notifications.PermissionStatus | null>(null);
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [lastNotification, setLastNotification] =
    useState<Notifications.Notification | null>(null);
  const [lastResponse, setLastResponse] =
    useState<Notifications.NotificationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    configureNotificationHandler();

    const disposeListeners = addNotificationListeners({
      onNotificationReceived: (notification) => {
        if (!mounted) return;
        setLastNotification(notification);
      },
      onNotificationResponse: (response) => {
        if (!mounted) return;
        setLastResponse(response);
      },
    });

    void (async () => {
      try {
        const registration = await registerForPushNotifications();
        if (!mounted) return;

        setPermissionStatus(registration.permissionStatus);
        setExpoPushToken(registration.token);

        const initialResponse =
          await Notifications.getLastNotificationResponseAsync();
        if (mounted && initialResponse) {
          setLastResponse(initialResponse);
        }
      } catch (caughtError) {
        if (!mounted) return;
        setError(extractApiError(caughtError));
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
      disposeListeners();
    };
  }, []);

  return useMemo(
    () => ({
      loading,
      permissionStatus,
      expoPushToken,
      lastNotification,
      lastResponse,
      error,
    }),
    [
      error,
      expoPushToken,
      lastNotification,
      lastResponse,
      loading,
      permissionStatus,
    ],
  );
}
