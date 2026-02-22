import { useEffect, useMemo, useState } from "react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  Image,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

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
  const palette = {
    screenBg: isDark ? "#020617" : "#f8fafc",
    textPrimary: isDark ? "#e2e8f0" : "#0f172a",
    buttonBg: isDark ? "#0f172a" : "#ffffff",
    buttonBorder: isDark ? "#334155" : "#cbd5e1",
    error: isDark ? "#fca5a5" : "#b91c1c",
  };

  useEffect(() => {
    let isMounted = true;

    const loadTarget = async () => {
      if (!Number.isInteger(photoId) || photoId <= 0) {
        setErrorMessage("photo_id invalido.");
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setErrorMessage("");
        const resolved = await resolveIncidentPhotoPreviewTarget(photoId);
        if (!isMounted) return;
        setPhotoTarget(resolved);
      } catch {
        if (!isMounted) return;
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

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color="#ffffff" />
          </View>
        ) : errorMessage ? (
          <View style={styles.centered}>
            <Text style={[styles.errorText, { color: palette.error }]}>{errorMessage}</Text>
          </View>
        ) : photoTarget ? (
          <Image
            source={{ uri: photoTarget.uri, headers: photoTarget.headers }}
            style={styles.image}
            resizeMode="contain"
          />
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
    alignSelf: "flex-end",
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
  image: {
    flex: 1,
    width: "100%",
    backgroundColor: "#020617",
  },
  errorText: {
    color: "#fca5a5",
  },
});
