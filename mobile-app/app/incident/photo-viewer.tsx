import { useEffect, useMemo, useState } from "react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";

import {
  resolveIncidentPhotoPreviewTarget,
  type IncidentPhotoPreviewTarget,
} from "@/src/api/photos";
import { useThemePreference } from "@/src/theme/theme-preference";

function normalizeParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default function IncidentPhotoViewerScreen() {
  const { resolvedScheme } = useThemePreference();
  const isDark = resolvedScheme === "dark";
  const router = useRouter();
  const params = useLocalSearchParams<{
    photoId?: string | string[];
    fileName?: string | string[];
  }>();

  const photoIdText = useMemo(() => normalizeParam(params.photoId), [params.photoId]);
  const fileName = useMemo(() => decodeURIComponent(normalizeParam(params.fileName)), [params.fileName]);
  const photoId = Number.parseInt(photoIdText, 10);

  const [loading, setLoading] = useState(true);
  const [photoTarget, setPhotoTarget] = useState<IncidentPhotoPreviewTarget | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const zoomScale = useSharedValue(1);
  const zoomScaleAtStart = useSharedValue(1);
  const translationX = useSharedValue(0);
  const translationY = useSharedValue(0);
  const translationXAtStart = useSharedValue(0);
  const translationYAtStart = useSharedValue(0);
  const palette = {
    screenBg: isDark ? "#020617" : "#f8fafc",
    textPrimary: isDark ? "#e2e8f0" : "#0f172a",
    buttonBg: isDark ? "#0f172a" : "#ffffff",
    buttonBorder: isDark ? "#334155" : "#cbd5e1",
    error: isDark ? "#fca5a5" : "#b91c1c",
    hint: isDark ? "#94a3b8" : "#475569",
  };

  const resetZoom = () => {
    zoomScale.value = 1;
    zoomScaleAtStart.value = 1;
    translationX.value = 0;
    translationY.value = 0;
    translationXAtStart.value = 0;
    translationYAtStart.value = 0;
  };

  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      zoomScaleAtStart.value = zoomScale.value;
    })
    .onUpdate((event) => {
      const nextScale = zoomScaleAtStart.value * event.scale;
      zoomScale.value = Math.min(4, Math.max(1, nextScale));
    })
    .onEnd(() => {
      if (zoomScale.value <= 1) {
        translationX.value = 0;
        translationY.value = 0;
      }
    });

  const panGesture = Gesture.Pan()
    .onStart(() => {
      translationXAtStart.value = translationX.value;
      translationYAtStart.value = translationY.value;
    })
    .onUpdate((event) => {
      if (zoomScale.value <= 1) return;
      translationX.value = translationXAtStart.value + event.translationX;
      translationY.value = translationYAtStart.value + event.translationY;
    })
    .onEnd(() => {
      if (zoomScale.value <= 1) {
        translationX.value = 0;
        translationY.value = 0;
      }
    });

  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      resetZoom();
    });

  const imageGesture = Gesture.Exclusive(
    doubleTapGesture,
    Gesture.Simultaneous(pinchGesture, panGesture),
  );

  const animatedImageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translationX.value },
      { translateY: translationY.value },
      { scale: zoomScale.value },
    ],
  }));

  useEffect(() => {
    let isMounted = true;

    const loadTarget = async () => {
      if (!Number.isInteger(photoId) || photoId <= 0) {
        resetZoom();
        setErrorMessage("photo_id invalido.");
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setErrorMessage("");
        const resolved = await resolveIncidentPhotoPreviewTarget(photoId);
        if (!isMounted) return;
        resetZoom();
        setPhotoTarget(resolved);
      } catch {
        if (!isMounted) return;
        resetZoom();
        setPhotoTarget(null);
        setErrorMessage("No se pudo cargar la imagen.");
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    void loadTarget();
    return () => {
      isMounted = false;
    };
  }, [photoId]);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.screenBg }]}>
        <Stack.Screen options={{ title: fileName || `Foto #${photoIdText || "N/A"}` }} />
        <View style={[styles.container, { backgroundColor: palette.screenBg }]}>
          <TouchableOpacity
            style={[
              styles.closeButton,
              { backgroundColor: palette.buttonBg, borderColor: palette.buttonBorder },
            ]}
            onPress={() => router.back()}
          >
            <Text style={[styles.closeButtonText, { color: palette.textPrimary }]}>Cerrar</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.resetZoomButton,
              { backgroundColor: palette.buttonBg, borderColor: palette.buttonBorder },
            ]}
            onPress={resetZoom}
          >
            <Text style={[styles.closeButtonText, { color: palette.textPrimary }]}>Restablecer zoom</Text>
          </TouchableOpacity>

          {loading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color="#ffffff" />
            </View>
          ) : errorMessage ? (
            <View style={styles.centered}>
              <Text style={[styles.errorText, { color: palette.error }]}>{errorMessage}</Text>
            </View>
          ) : photoTarget ? (
            <View style={styles.imageViewport}>
              <GestureDetector gesture={imageGesture}>
                <Animated.Image
                  source={{ uri: photoTarget.uri, headers: photoTarget.headers }}
                  style={[styles.image, animatedImageStyle]}
                  resizeMode="contain"
                />
              </GestureDetector>
            </View>
          ) : null}
          <Text style={[styles.zoomHint, { color: palette.hint }]}>
            Pellizca para zoom, arrastra para mover y doble toque para reiniciar.
          </Text>
        </View>
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    backgroundColor: "#020617",
  },
  container: {
    flex: 1,
    backgroundColor: "#020617",
    padding: 12,
  },
  closeButton: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 6,
    backgroundColor: "#0f172a",
  },
  resetZoomButton: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
    backgroundColor: "#0f172a",
  },
  closeButtonText: {
    color: "#e2e8f0",
    fontWeight: "700",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  imageViewport: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: "#020617",
    borderRadius: 8,
  },
  image: {
    flex: 1,
    width: "100%",
    backgroundColor: "#020617",
  },
  zoomHint: {
    marginTop: 8,
    fontSize: 12,
    color: "#94a3b8",
    textAlign: "center",
  },
  errorText: {
    color: "#fca5a5",
  },
});
