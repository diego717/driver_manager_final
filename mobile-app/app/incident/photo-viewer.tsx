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
  fetchIncidentPhotoDataUri,
} from "@/src/api/photos";

function normalizeParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default function IncidentPhotoViewerScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    photoId?: string | string[];
    fileName?: string | string[];
  }>();

  const photoIdText = useMemo(() => normalizeParam(params.photoId), [params.photoId]);
  const fileName = useMemo(() => decodeURIComponent(normalizeParam(params.fileName)), [params.fileName]);
  const photoId = Number.parseInt(photoIdText, 10);

  const [loading, setLoading] = useState(true);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

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
        const resolved = await fetchIncidentPhotoDataUri(photoId);
        if (!isMounted) return;
        setPhotoUri(resolved);
      } catch {
        if (!isMounted) return;
        setPhotoUri(null);
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
    <SafeAreaView style={styles.safeArea}>
      <Stack.Screen options={{ title: fileName || `Foto #${photoIdText || "N/A"}` }} />
      <View style={styles.container}>
        <TouchableOpacity style={styles.closeButton} onPress={() => router.back()}>
          <Text style={styles.closeButtonText}>Cerrar</Text>
        </TouchableOpacity>

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color="#ffffff" />
          </View>
        ) : errorMessage ? (
          <View style={styles.centered}>
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : photoUri ? (
          <Image
            source={{ uri: photoUri }}
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
