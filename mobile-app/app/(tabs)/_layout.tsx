import React, { useCallback, useEffect, useRef, useState } from "react";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Link, Tabs } from "expo-router";
import { AppState, Pressable, type AppStateStatus } from "react-native";

import BiometricLockScreen from "@/src/components/BiometricLockScreen";
import Colors from "@/constants/Colors";
import { useClientOnlyValue } from "@/components/useClientOnlyValue";
import {
  authenticateWithBiometrics,
  getBiometricAvailability,
} from "@/src/services/biometric";
import { getBiometricEnabled } from "@/src/storage/app-preferences";
import { useThemePreference } from "@/src/theme/theme-preference";

// You can explore the built-in icon families and icons on the web at https://icons.expo.fyi/
function TabBarIcon(props: {
  name: React.ComponentProps<typeof FontAwesome>["name"];
  color: string;
}) {
  return <FontAwesome size={28} style={{ marginBottom: -3 }} {...props} />;
}

export default function TabLayout() {
  const { resolvedScheme } = useThemePreference();
  const colorScheme = resolvedScheme;
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricLabel, setBiometricLabel] = useState("biometria");
  const [tabLocked, setTabLocked] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    void (async () => {
      try {
        const enabled = await getBiometricEnabled();
        if (!mounted) return;
        setBiometricEnabled(enabled);
        if (!enabled) return;

        const availability = await getBiometricAvailability();
        if (!mounted) return;
        setBiometricAvailable(availability.isAvailable);
        setBiometricLabel(availability.biometricLabel);
      } catch {
        if (!mounted) return;
        setBiometricEnabled(false);
        setBiometricAvailable(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const unlockTabs = useCallback(
    async (allowDeviceFallback: boolean) => {
      if (!biometricEnabled || !biometricAvailable) {
        setTabLocked(false);
        return;
      }

      setAuthenticating(true);
      setLockError(null);

      try {
        const authResult = await authenticateWithBiometrics({
          allowDeviceFallback,
          promptMessage: "Verifica tu identidad para continuar",
          cancelLabel: "Cancelar",
          fallbackLabel: "Usar codigo",
        });

        if (authResult.success) {
          setTabLocked(false);
          return;
        }

        setTabLocked(true);
        setLockError(authResult.error ?? "No se pudo validar la identidad.");
      } finally {
        setAuthenticating(false);
      }
    },
    [biometricAvailable, biometricEnabled],
  );

  useEffect(() => {
    if (!biometricEnabled || !biometricAvailable) return;

    const subscription = AppState.addEventListener("change", (nextState) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextState;

      if (
        (previousState === "inactive" || previousState === "background") &&
        nextState === "active"
      ) {
        setTabLocked(true);
        setLockError(null);
        void unlockTabs(false);
      }
    });

    return () => {
      subscription.remove();
    };
  }, [biometricAvailable, biometricEnabled, unlockTabs]);

  return (
    <>
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: Colors[colorScheme ?? "light"].tint,
          // Disable the static render of the header on web
          // to prevent a hydration error in React Navigation v6.
          headerShown: useClientOnlyValue(false, true),
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: "Crear",
            tabBarIcon: ({ color }) => (
              <TabBarIcon name="plus-circle" color={color} />
            ),
            headerRight: () => (
              <Link href="/modal" asChild>
                <Pressable>
                  {({ pressed }) => (
                    <FontAwesome
                      name="cog"
                      size={25}
                      color={Colors[colorScheme ?? "light"].text}
                      style={{ marginRight: 15, opacity: pressed ? 0.5 : 1 }}
                    />
                  )}
                </Pressable>
              </Link>
            ),
          }}
        />
        <Tabs.Screen
          name="two"
          options={{
            title: "Incidencias",
            tabBarIcon: ({ color }) => <TabBarIcon name="list-alt" color={color} />,
          }}
        />
      </Tabs>

      {tabLocked ? (
        <BiometricLockScreen
          busy={authenticating}
          biometricLabel={biometricLabel}
          errorMessage={lockError}
          onRetry={() => {
            void unlockTabs(false);
          }}
          onUseFallbackCode={() => {
            void unlockTabs(true);
          }}
        />
      ) : null}
    </>
  );
}
