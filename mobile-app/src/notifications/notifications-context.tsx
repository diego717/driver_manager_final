import React, { createContext, useContext, type ReactNode } from "react";

import type { UseNotificationsState } from "@/src/hooks/useNotifications";

const defaultNotificationsState: UseNotificationsState = {
  loading: true,
  permissionStatus: null,
  expoPushToken: null,
  fcmPushToken: null,
  tokenRegisteredInApi: null,
  lastNotification: null,
  lastResponse: null,
  error: null,
};

const NotificationsContext = createContext<UseNotificationsState>(defaultNotificationsState);

export function NotificationsProvider(props: {
  value: UseNotificationsState;
  children: ReactNode;
}) {
  return (
    <NotificationsContext.Provider value={props.value}>
      {props.children}
    </NotificationsContext.Provider>
  );
}

export function useNotificationsContext(): UseNotificationsState {
  return useContext(NotificationsContext);
}
