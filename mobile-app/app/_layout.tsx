import FontAwesome from "@expo/vector-icons/FontAwesome";
import { ThemeProvider } from "@react-navigation/native";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
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

export default function RootLayout() {
  const [loaded, error] = useFonts({
    Inter_400Regular: require("../assets/fonts/Inter_400Regular.ttf"),
    Inter_500Medium: require("../assets/fonts/Inter_500Medium.ttf"),
    Inter_600SemiBold: require("../assets/fonts/Inter_600SemiBold.ttf"),
    Inter_700Bold: require("../assets/fonts/Inter_700Bold.ttf"),
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
    ...FontAwesome.font,
  });

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      applyGlobalTypographyDefaults();
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
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
    const initGuardTimeout = setTimeout(() => {
      if (!mounted) return;
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
          setAppLocked(false);
          setBiometricAvailable(false);
          return;
        }

        const availability = await getBiometricAvailability();
        if (!mounted) return;

        setBiometricLabel(availability.biometricLabel);
        setBiometricAvailable(availability.isAvailable);
        if (!availability.isAvailable) {
          setAppLocked(false);
          setLockInitializing(false);
          return;
        }

        setAppLocked(true);
        setLockInitializing(false);
        setTimeout(() => {
          if (!mounted) return;
          void triggerBiometricUnlock(false);
        }, 180);
      } catch (caughtError) {
        if (!mounted) return;
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
      }
    });

    return () => {
      subscription.remove();
    };
  }, [biometricAvailable, biometricEnabled, lockInitializing, triggerBiometricUnlock]);

  useEffect(() => {
    if (!notifications.error) return;
    console.warn(`[notifications] ${notifications.error}`);
  }, [notifications.error]);

  useEffect(() => {
    void refreshSharedWebSessionState({ showLoader: true });
  }, []);

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
