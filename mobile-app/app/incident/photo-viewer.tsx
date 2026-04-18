import { useEffect, useMemo, useState } from "react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  FlatList,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";

import {
  type IncidentPhotoPreviewTarget,
  resolveIncidentPhotoPreviewTarget,
} from "@/src/api/photos";
import ConsoleButton from "@/src/components/ConsoleButton";
import { radii, spacing } from "@/src/theme/layout";
import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies, typeScale } from "@/src/theme/typography";

function normalizeParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default function IncidentPhotoViewerScreen() {
  const palette = useAppPalette();
  const router = useRouter();
  const params = useLocalSearchParams<{
    photoId?: string | string[];
    fileName?: string | string[];
    photoIds?: string | string[];
    initialIndex?: string | string[];
  }>();

  const photoIdText = useMemo(() => normalizeParam(params.photoId), [params.photoId]);
  const fileName = useMemo(
    () => decodeURIComponent(normalizeParam(params.fileName)),
    [params.fileName],
  );
  const photoIds = useMemo(() => {
    const raw = decodeURIComponent(normalizeParam(params.photoIds));
    const parsed = raw
      .split(",")
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((value) => Number.isInteger(value) && value > 0);
    const fallback = Number.parseInt(photoIdText, 10);
    if (!parsed.length && Number.isInteger(fallback) && fallback > 0) {
      return [fallback];
    }
    return parsed;
  }, [params.photoIds, photoIdText]);
  const initialIndex = useMemo(() => {
    const raw = Number.parseInt(normalizeParam(params.initialIndex), 10);
    if (!Number.isInteger(raw) || raw < 0) return 0;
    return Math.min(raw, Math.max(photoIds.length - 1, 0));
  }, [params.initialIndex, photoIds.length]);
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const photoId = photoIds[activeIndex] ?? Number.parseInt(photoIdText, 10);
  const canGoPrev = activeIndex > 0;
  const canGoNext = activeIndex < photoIds.length - 1;

  const [loading, setLoading] = useState(true);
  const [photoTarget, setPhotoTarget] = useState<IncidentPhotoPreviewTarget | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const zoomScale = useSharedValue(1);
  const zoomScaleAtStart = useSharedValue(1);
  const translationX = useSharedValue(0);
  const translationY = useSharedValue(0);
  const translationXAtStart = useSharedValue(0);
  const translationYAtStart = useSharedValue(0);
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
    setActiveIndex(initialIndex);
  }, [initialIndex, photoIdText]);

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
        <Stack.Screen
          options={{
            title:
              photoIds.length > 1
                ? `Evidencia ${activeIndex + 1}/${photoIds.length}`
                : fileName || `Foto #${photoIdText || "N/A"}`,
          }}
        />
        <View style={[styles.container, { backgroundColor: palette.screenBg }]}>
          <View style={styles.topBar}>
            <ConsoleButton
              variant="secondary"
              size="sm"
              style={styles.topBarAction}
              onPress={() => router.back()}
              label="Cerrar"
              textStyle={styles.topBarActionText}
            />
            <ConsoleButton
              variant="subtle"
              size="sm"
              style={styles.topBarAction}
              onPress={resetZoom}
              label="Resetear zoom"
              textStyle={styles.topBarActionText}
            />
          </View>

          {photoIds.length > 1 ? (
            <View
              style={[
                styles.navRail,
                {
                  backgroundColor: palette.heroBg,
                  borderColor: palette.heroBorder,
                },
              ]}
            >
              <ConsoleButton
                variant={canGoPrev ? "secondary" : "subtle"}
                size="sm"
                style={styles.navButton}
                onPress={() => {
                  if (!canGoPrev) return;
                  setActiveIndex((current) => Math.max(0, current - 1));
                }}
                disabled={!canGoPrev}
                accessibilityState={{ disabled: !canGoPrev }}
                label="Anterior"
                textStyle={styles.navButtonText}
              />
              <View style={styles.navCenter}>
                <Text style={[styles.counterText, { color: palette.textPrimary }]}>
                  {activeIndex + 1}/{photoIds.length}
                </Text>
                <Text style={[styles.counterHint, { color: palette.textSecondary }]}>
                  Desliza mentalmente la incidencia sin salir del zoom.
                </Text>
              </View>
              <ConsoleButton
                variant={canGoNext ? "primary" : "subtle"}
                size="sm"
                style={styles.navButton}
                onPress={() => {
                  if (!canGoNext) return;
                  setActiveIndex((current) => Math.min(photoIds.length - 1, current + 1));
                }}
                disabled={!canGoNext}
                accessibilityState={{ disabled: !canGoNext }}
                label="Siguiente"
                textStyle={styles.navButtonText}
              />
            </View>
          ) : null}

          {loading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={palette.loadingSpinner} />
            </View>
          ) : errorMessage ? (
            <View style={styles.centered}>
              <Text style={[styles.errorText, { color: palette.error }]}>{errorMessage}</Text>
            </View>
          ) : photoTarget ? (
            <View style={[styles.imageViewport, { backgroundColor: palette.screenBg }]}>
              <GestureDetector gesture={imageGesture}>
                <Animated.Image
                  source={{ uri: photoTarget.uri, headers: photoTarget.headers }}
                  style={[styles.image, { backgroundColor: palette.screenBg }, animatedImageStyle]}
                  resizeMode="contain"
                />
              </GestureDetector>
            </View>
          ) : null}
          <Text style={[styles.zoomHint, { color: palette.hint }]}>
            Pellizca para zoom, arrastra para mover y doble toque para reiniciar.
          </Text>
          {photoIds.length > 1 ? (
            <FlatList
              horizontal
              data={photoIds}
              keyExtractor={(item) => String(item)}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.thumbRail}
              renderItem={({ item, index }) => {
                const selected = index === activeIndex;
                return (
                  <ConsoleButton
                    variant={selected ? "primary" : "subtle"}
                    size="sm"
                    style={styles.thumbChip}
                    onPress={() => setActiveIndex(index)}
                    accessibilityState={{ selected }}
                    label={`Foto ${index + 1}`}
                    textStyle={styles.thumbChipText}
                  />
                );
              }}
            />
          ) : null}
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
  },
  container: {
    flex: 1,
    padding: spacing.s12,
  },
  topBar: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.s8,
  },
  topBarAction: {
    alignSelf: "flex-start",
    minWidth: 118,
  },
  topBarActionText: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
  navRail: {
    marginTop: spacing.s8,
    borderWidth: 1,
    borderRadius: radii.r12,
    padding: spacing.s10,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s10,
  },
  navButton: {
    minWidth: 104,
    borderRadius: radii.r10,
  },
  navButtonText: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMonoTight,
    textTransform: "uppercase",
  },
  navCenter: {
    flex: 1,
    gap: spacing.s2,
  },
  counterText: {
    fontFamily: fontFamilies.mono,
    ...typeScale.metaMono,
    textAlign: "center",
    textTransform: "uppercase",
  },
  counterHint: {
    fontFamily: fontFamilies.regular,
    ...typeScale.bodyCompact,
    textAlign: "center",
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
    borderRadius: radii.r8,
  },
  image: {
    flex: 1,
    width: "100%",
  },
  zoomHint: {
    marginTop: spacing.s8,
    fontFamily: fontFamilies.regular,
    ...typeScale.bodyCompact,
    textAlign: "center",
  },
  thumbRail: {
    paddingTop: spacing.s10,
    paddingBottom: spacing.s2,
    gap: spacing.s8,
  },
  thumbChip: {
    minHeight: 36,
    borderRadius: radii.full,
    minWidth: 98,
  },
  thumbChipText: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMonoTight,
    textTransform: "uppercase",
  },
  errorText: {},
});
