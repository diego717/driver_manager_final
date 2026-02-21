import FontAwesome from "@expo/vector-icons/FontAwesome";
import { DarkTheme, DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import "react-native-reanimated";

import BiometricLockScreen from "@/src/components/BiometricLockScreen";
import { useNotifications } from "@/src/hooks/useNotifications";
import {
  authenticateWithBiometrics,
  getBiometricAvailability,
} from "@/src/services/biometric";
import { getBiometricEnabled } from "@/src/storage/app-preferences";
import { ThemePreferenceProvider, useThemePreference } from "@/src/theme/theme-preference";

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from "expo-router";

export const unstable_settings = {
  // Ensure that reloading on `/modal` keeps a back button present.
  initialRouteName: '(tabs)',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
  });

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return (
    <ThemePreferenceProvider>
      <RootLayoutNav />
    </ThemePreferenceProvider>
  );
}

function RootLayoutNav() {
  const { resolvedScheme } = useThemePreference();
  const notifications = useNotifications();
  const [lockInitializing, setLockInitializing] = useState(true);
  const [appLocked, setAppLocked] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);
  const [biometricLabel, setBiometricLabel] = useState("biometria");

  const triggerBiometricUnlock = useCallback(async (allowDeviceFallback: boolean) => {
    setAuthenticating(true);
    setLockError(null);

    try {
      const authResult = await authenticateWithBiometrics({
        allowDeviceFallback,
        promptMessage: "Desbloquea Driver Manager",
        cancelLabel: "Cancelar",
        fallbackLabel: "Usar codigo",
      });

      if (authResult.success) {
        setAppLocked(false);
        return;
      }

      setAppLocked(true);
      setLockError(authResult.error ?? "No se pudo validar la identidad.");
    } finally {
      setAuthenticating(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const initGuardTimeout = setTimeout(() => {
      if (!mounted) return;
      setLockInitializing(false);
    }, 7000);

    void (async () => {
      try {
        const biometricEnabled = await getBiometricEnabled();
        if (!mounted) return;

        if (!biometricEnabled) {
          setAppLocked(false);
          return;
        }

        const availability = await getBiometricAvailability();
        if (!mounted) return;

        setBiometricLabel(availability.biometricLabel);
        if (!availability.isAvailable) {
          setAppLocked(false);
          setLockInitializing(false);
          return;
        }

        setAppLocked(true);
        setLockInitializing(false);
        void triggerBiometricUnlock(false);
      } catch (caughtError) {
        if (!mounted) return;
        setAppLocked(false);
        setLockError(
          caughtError instanceof Error
            ? caughtError.message
            : "No se pudo cargar seguridad biometrica.",
        );
        setLockInitializing(false);
      }
    })();

    return () => {
      mounted = false;
      clearTimeout(initGuardTimeout);
    };
  }, [triggerBiometricUnlock]);

  useEffect(() => {
    if (!notifications.expoPushToken) return;
    console.log(`[notifications] expo token listo: ${notifications.expoPushToken}`);
  }, [notifications.expoPushToken]);

  useEffect(() => {
    if (!notifications.fcmPushToken) return;
    console.log(`[notifications] fcm token listo: ${notifications.fcmPushToken}`);
  }, [notifications.fcmPushToken]);

  useEffect(() => {
    if (notifications.tokenRegisteredInApi === null) return;
    if (notifications.tokenRegisteredInApi) {
      console.log("[notifications] token registrado en API.");
      return;
    }
    console.log("[notifications] token no registrado (sin sesion web activa).");
  }, [notifications.tokenRegisteredInApi]);

  useEffect(() => {
    if (!notifications.error) return;
    console.warn(`[notifications] ${notifications.error}`);
  }, [notifications.error]);

  return (
    <ThemeProvider value={resolvedScheme === "dark" ? DarkTheme : DefaultTheme}>
      <View style={styles.root}>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="incident/detail"
            options={{ title: "Detalle incidencia" }}
          />
          <Stack.Screen name="incident/upload" options={{ title: "Subir foto" }} />
          <Stack.Screen name="incident/photo-viewer" options={{ title: "Foto" }} />
          <Stack.Screen
            name="modal"
            options={{ title: "Configuracion API", presentation: "modal" }}
          />
        </Stack>

        {lockInitializing ? (
          <View style={styles.lockLoadingOverlay}>
            <ActivityIndicator size="large" color="#ffffff" />
          </View>
        ) : null}

        {appLocked ? (
          <BiometricLockScreen
            busy={authenticating}
            biometricLabel={biometricLabel}
            errorMessage={lockError}
            onRetry={() => {
              void triggerBiometricUnlock(false);
            }}
            onUseFallbackCode={() => {
              void triggerBiometricUnlock(true);
            }}
          />
        ) : null}
      </View>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  lockLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 40,
    backgroundColor: "rgba(15, 23, 42, 0.82)",
    alignItems: "center",
    justifyContent: "center",
  },
});
