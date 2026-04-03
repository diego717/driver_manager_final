import FontAwesome from "@expo/vector-icons/FontAwesome";
import { ThemeProvider } from "@react-navigation/native";
import { useFonts } from "expo-font";
import { Stack, useRouter } from "expo-router";
import * as Network from "expo-network";
import * as SplashScreen from "expo-splash-screen";
import React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  AppState,
  Easing,
  Image,
  StyleSheet,
  Text,
  View,
  type AppStateStatus,
} from "react-native";
import "react-native-reanimated";
import { SafeAreaProvider } from "react-native-safe-area-context";

import BiometricLockScreen from "@/src/components/BiometricLockScreen";
import AppHeaderTitle from "@/src/components/AppHeaderTitle";
import { useNotifications } from "@/src/hooks/useNotifications";
import { refreshSharedWebSessionState } from "@/src/session/web-session-store";
import { getNavigationTheme, useAppPalette } from "@/src/theme/palette";
import {
  authenticateWithBiometrics,
  getBiometricAvailability,
} from "@/src/services/biometric";
import { getBiometricEnabled } from "@/src/storage/app-preferences";
import { ThemePreferenceProvider, useThemePreference } from "@/src/theme/theme-preference";
import { applyGlobalTypographyDefaults, fontFamilies } from "@/src/theme/typography";

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

let syncBootstrapAttempted = false;

async function bootstrapSyncInfrastructure(): Promise<null | (() => void)> {
  if (syncBootstrapAttempted) {
    const { runSync } = await import("@/src/services/sync/sync-runner");
    return runSync;
  }

  try {
    const [{ registerIncidentExecutors }, { registerPhotoExecutors }, { registerIncidentEvidenceExecutors }, { registerCaseExecutors }, { runSync }] = await Promise.all([
      import("@/src/services/sync/incident-outbox-service"),
      import("@/src/services/sync/photo-outbox-service"),
      import("@/src/services/sync/incident-evidence-outbox-service"),
      import("@/src/services/sync/case-outbox-service"),
      import("@/src/services/sync/sync-runner"),
    ]);
    registerIncidentExecutors();
    registerPhotoExecutors();
    registerIncidentEvidenceExecutors();
    registerCaseExecutors();
    syncBootstrapAttempted = true;
    return runSync;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[sync] bootstrap skipped: ${message}`);
    return null;
  }
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SourceSans3_400Regular: require("../assets/fonts/SourceSans3-Regular.ttf"),
    SourceSans3_500Medium: require("../assets/fonts/SourceSans3-Medium.ttf"),
    SourceSans3_600SemiBold: require("../assets/fonts/SourceSans3-Semibold.ttf"),
    SourceSans3_700Bold: require("../assets/fonts/SourceSans3-Bold.ttf"),
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
    ...FontAwesome.font,
  });
  const fontsReady = loaded || Boolean(error);

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (!error) return;
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[fonts] fallback enabled: ${message}`);
  }, [error]);

  useEffect(() => {
    if (fontsReady) {
      applyGlobalTypographyDefaults();
      void SplashScreen.hideAsync();
    }
  }, [fontsReady]);

  if (!fontsReady) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <ThemePreferenceProvider>
        <RootLayoutNav />
      </ThemePreferenceProvider>
    </SafeAreaProvider>
  );
}

export function RootLayoutNav() {
  const router = useRouter();
  const { resolvedScheme } = useThemePreference();
  const palette = useAppPalette();
  const navigationTheme = useMemo(() => getNavigationTheme(resolvedScheme), [resolvedScheme]);
  const notifications = useNotifications();
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const [lockInitializing, setLockInitializing] = useState(true);
  const [appLocked, setAppLocked] = useState(true);
  const [authenticating, setAuthenticating] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);
  const [biometricLabel, setBiometricLabel] = useState("biometria");
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const bootScaleAnim = useRef(new Animated.Value(1)).current;
  const bootOpacityAnim = useRef(new Animated.Value(0.88)).current;
  const networkReachableRef = useRef<boolean | null>(null);
  const lastHandledNotificationResponseIdRef = useRef<string | null>(null);

  const triggerSync = useCallback(() => {
    void (async () => {
      const runSync = await bootstrapSyncInfrastructure();
      runSync?.();
    })();
  }, []);

  const triggerBiometricUnlock = useCallback(async (allowDeviceFallback: boolean) => {
    setAuthenticating(true);
    setLockError(null);

    try {
      const authResult = await authenticateWithBiometrics({
        allowDeviceFallback,
        promptMessage: "Desbloquea SiteOps",
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
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(bootScaleAnim, {
            toValue: 1.06,
            duration: 760,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(bootOpacityAnim, {
            toValue: 1,
            duration: 760,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(bootScaleAnim, {
            toValue: 1,
            duration: 760,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(bootOpacityAnim, {
            toValue: 0.9,
            duration: 760,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      ]),
    );

    if (lockInitializing) {
      pulse.start();
    } else {
      pulse.stop();
      bootScaleAnim.setValue(1);
      bootOpacityAnim.setValue(1);
    }
    return () => pulse.stop();
  }, [bootOpacityAnim, bootScaleAnim, lockInitializing]);

  useEffect(() => {
    let mounted = true;
    let initFinished = false;
    const finishInitialization = () => {
      initFinished = true;
      clearTimeout(initGuardTimeout);
    };
    const initGuardTimeout = setTimeout(() => {
      if (!mounted || initFinished) return;
      setAppLocked(true);
      setLockError(
        "No se pudo inicializar la seguridad biometrica. Reintenta para desbloquear.",
      );
      setLockInitializing(false);
    }, 5500);

    void (async () => {
      try {
        const biometricEnabled = await getBiometricEnabled();
        if (!mounted) return;
        setBiometricEnabled(biometricEnabled);

        if (!biometricEnabled) {
          finishInitialization();
          setAppLocked(false);
          setBiometricAvailable(false);
          setLockInitializing(false);
          return;
        }

        const availability = await getBiometricAvailability();
        if (!mounted) return;

        setBiometricLabel(availability.biometricLabel);
        setBiometricAvailable(availability.isAvailable);
        if (!availability.isAvailable) {
          finishInitialization();
          setAppLocked(false);
          setLockInitializing(false);
          return;
        }

        finishInitialization();
        setAppLocked(true);
        setLockInitializing(false);
        setTimeout(() => {
          if (!mounted) return;
          void triggerBiometricUnlock(false);
        }, 180);
      } catch (caughtError) {
        if (!mounted) return;
        finishInitialization();
        setAppLocked(true);
        setBiometricAvailable(false);
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
      initFinished = true;
      clearTimeout(initGuardTimeout);
    };
  }, [triggerBiometricUnlock]);

  useEffect(() => {
    if (lockInitializing || !biometricEnabled || !biometricAvailable) return;

    const subscription = AppState.addEventListener("change", (nextState) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextState;

      if (
        (previousState === "inactive" || previousState === "background") &&
        nextState === "active"
      ) {
        setAppLocked(true);
        setLockError(null);
        void triggerBiometricUnlock(false);
        // App-resume sync trigger (runs after biometric lockscreen clears)
        triggerSync();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [biometricAvailable, biometricEnabled, lockInitializing, triggerBiometricUnlock, triggerSync]);

  useEffect(() => {
    if (!notifications.error) return;
    console.warn(`[notifications] ${notifications.error}`);
  }, [notifications.error]);

  useEffect(() => {
    const response = notifications.lastResponse;
    if (!response) return;

    const responseId = response.notification.request.identifier || null;
    if (responseId && lastHandledNotificationResponseIdRef.current === responseId) {
      return;
    }

    const payload = response.notification.request.content.data as Record<string, unknown> | undefined;
    const explicitPath = typeof payload?.path === "string" ? payload.path.trim() : "";
    const incidentId = Number.parseInt(String(payload?.incidentId || payload?.incident_id || "").trim(), 10);
    const installationId = Number.parseInt(String(payload?.installationId || payload?.installation_id || "").trim(), 10);

    let targetPath = "";
    if (explicitPath) {
      targetPath = explicitPath;
    } else if (Number.isInteger(incidentId) && incidentId > 0 && Number.isInteger(installationId) && installationId > 0) {
      targetPath = `/incident/detail?incidentId=${incidentId}&installationId=${installationId}`;
    } else if (Number.isInteger(installationId) && installationId > 0) {
      targetPath = `/work?installationId=${installationId}`;
    }

    if (!targetPath) return;
    if (responseId) {
      lastHandledNotificationResponseIdRef.current = responseId;
    }
    router.push(targetPath as never);
  }, [notifications.lastResponse, router]);

  useEffect(() => {
    let mounted = true;
    let subscription: { remove: () => void } | null = null;

    const toReachable = (state: Network.NetworkState): boolean =>
      Boolean(state.isConnected && state.isInternetReachable !== false);

    void (async () => {
      try {
        const initialState = await Network.getNetworkStateAsync();
        if (!mounted) return;
        networkReachableRef.current = toReachable(initialState);

        subscription = Network.addNetworkStateListener((state) => {
          const previousReachable = networkReachableRef.current;
          const nextReachable = toReachable(state);
          networkReachableRef.current = nextReachable;

          if (previousReachable === false && nextReachable) {
            triggerSync();
          }
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[sync] network listener unavailable: ${message}`);
      }
    })();

    return () => {
      mounted = false;
      subscription?.remove();
    };
  }, [triggerSync]);

  useEffect(() => {
    void refreshSharedWebSessionState({ showLoader: true });
    // Startup sync trigger — flush any pending jobs from previous sessions
    triggerSync();
  }, [triggerSync]);

  return (
    <ThemeProvider value={navigationTheme}>
      <View style={styles.root}>
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: palette.surface },
            headerTintColor: palette.textPrimary,
            headerTitleAlign: "center",
            headerTitleStyle: { fontFamily: fontFamilies.semibold },
            headerTitle: ({ children }) => <AppHeaderTitle title={String(children || "SiteOps")} />,
            headerShadowVisible: false,
            headerBackTitleStyle: { fontFamily: fontFamilies.regular },
            contentStyle: { backgroundColor: palette.screenBg },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="case/context"
            options={{ title: "Resolver contexto" }}
          />
          <Stack.Screen
            name="case/manual"
            options={{ title: "Caso manual" }}
          />
          <Stack.Screen
            name="incident/create"
            options={{ title: "Nueva incidencia" }}
          />
          <Stack.Screen
            name="incident/detail"
            options={{ title: "Detalle incidencia" }}
          />
          <Stack.Screen name="incident/upload" options={{ title: "Subir foto" }} />
          <Stack.Screen name="scan/index" options={{ title: "Escaner" }} />
          <Stack.Screen name="qr-generator" options={{ title: "Generar QR" }} />
          <Stack.Screen name="incident/photo-viewer" options={{ title: "Foto" }} />
          <Stack.Screen name="drivers" options={{ title: "Drivers R2" }} />
          <Stack.Screen
            name="modal"
            options={{ title: "Configuracion API", presentation: "modal" }}
          />
        </Stack>

        {lockInitializing ? (
          <View style={[styles.lockLoadingOverlay, { backgroundColor: palette.overlayBg }]}>
            <Animated.View
              style={[
                styles.bootCard,
                {
                  backgroundColor: palette.surface,
                  borderColor: palette.border,
                  opacity: bootOpacityAnim,
                  transform: [{ scale: bootScaleAnim }],
                },
              ]}
            >
              <Image
                source={require("../assets/images/icon.png")}
                style={styles.bootLogo}
                resizeMode="contain"
              />
              <Text style={[styles.bootTitle, { color: palette.textPrimary }]}>SiteOps</Text>
              <Text style={[styles.bootSubtitle, { color: palette.textSecondary }]}>
                Inicializando seguridad...
              </Text>
            </Animated.View>
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
    alignItems: "center",
    justifyContent: "center",
  },
  bootCard: {
    minWidth: 220,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 22,
    paddingVertical: 20,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  bootLogo: {
    width: 74,
    height: 74,
  },
  bootTitle: {
    fontFamily: fontFamilies.bold,
    fontSize: 18,
    lineHeight: 22,
  },
  bootSubtitle: {
    fontFamily: fontFamilies.regular,
    fontSize: 13,
    lineHeight: 18,
  },
});
