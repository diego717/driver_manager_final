import { useCallback, useEffect, useMemo, useState } from "react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { extractApiError } from "@/src/api/client";
import { listIncidentsByInstallation } from "@/src/api/incidents";
import {
  resolveIncidentPhotoPreviewTarget,
  type IncidentPhotoPreviewTarget,
} from "@/src/api/photos";
import { useThemePreference } from "@/src/theme/theme-preference";
import { type Incident } from "@/src/types/api";

function normalizeParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

async function loadWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit = 3,
): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < tasks.length; i += limit) {
    const batch = tasks.slice(i, i + limit);
    results.push(...(await Promise.all(batch.map((task) => task()))));
  }
  return results;
}

export default function IncidentDetailScreen() {
  const { resolvedScheme } = useThemePreference();
  const isDark = resolvedScheme === "dark";
  const router = useRouter();
  const params = useLocalSearchParams<{
    incidentId?: string | string[];
    installationId?: string | string[];
  }>();

  const incidentIdText = useMemo(() => normalizeParam(params.incidentId), [params.incidentId]);
  const installationIdText = useMemo(
    () => normalizeParam(params.installationId),
    [params.installationId],
  );

  const incidentId = Number.parseInt(incidentIdText, 10);
  const installationId = Number.parseInt(installationIdText, 10);

  const [loading, setLoading] = useState(true);
  const [incident, setIncident] = useState<Incident | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [photoPreviews, setPhotoPreviews] = useState<Record<number, IncidentPhotoPreviewTarget>>(
    {},
  );
  const [failedPhotoIds, setFailedPhotoIds] = useState<Record<number, boolean>>({});
  const [loadingPhotoPreviews, setLoadingPhotoPreviews] = useState(false);
  const palette = useMemo(
    () => ({
      screenBg: isDark ? "#020617" : "#f8fafc",
      textPrimary: isDark ? "#e2e8f0" : "#0f172a",
      textSecondary: isDark ? "#cbd5e1" : "#1e293b",
      textMuted: isDark ? "#94a3b8" : "#64748b",
      cardBg: isDark ? "#0f172a" : "#ffffff",
      cardBorder: isDark ? "#334155" : "#cbd5e1",
      itemBg: isDark ? "#111827" : "#f8fafc",
      itemBorder: isDark ? "#334155" : "#e2e8f0",
      buttonBg: isDark ? "#0f172a" : "#ffffff",
      buttonBorder: isDark ? "#334155" : "#cbd5e1",
      buttonText: isDark ? "#cbd5e1" : "#0f172a",
      backBg: isDark ? "#1e293b" : "#e2e8f0",
      feedbackBg: isDark ? "#450a0a" : "#fef2f2",
      feedbackBorder: isDark ? "#7f1d1d" : "#fecaca",
      feedbackText: isDark ? "#fecaca" : "#7f1d1d",
    }),
    [isDark],
  );

  const loadIncident = useCallback(async () => {
    if (!Number.isInteger(installationId) || installationId <= 0) {
      setErrorMessage("installation_id invalido.");
      setLoading(false);
      return;
    }
    if (!Number.isInteger(incidentId) || incidentId <= 0) {
      setErrorMessage("incident_id invalido.");
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setErrorMessage("");
      const response = await listIncidentsByInstallation(installationId);
      const found = response.incidents.find((item) => Number(item.id) === incidentId) || null;
      if (!found) {
        setIncident(null);
        setErrorMessage("La incidencia no existe para esta instalacion.");
        return;
      }
      setIncident(found);
    } catch (error) {
      const message = extractApiError(error);
      setIncident(null);
      setErrorMessage(message);
      Alert.alert("Error", message);
    } finally {
      setLoading(false);
    }
  }, [incidentId, installationId]);

  useEffect(() => {
    void loadIncident();
  }, [loadIncident]);

  useEffect(() => {
    let isMounted = true;

    const loadPhotoPreviews = async () => {
      if (!incident?.photos?.length) {
        if (isMounted) {
          setPhotoPreviews({});
          setFailedPhotoIds({});
          setLoadingPhotoPreviews(false);
        }
        return;
      }

      if (isMounted) {
        setLoadingPhotoPreviews(true);
        setPhotoPreviews({});
        setFailedPhotoIds({});
      }

      const resolvedEntries = await loadWithConcurrency(
        incident.photos.map((photo) => async () => {
          try {
            const previewTarget = await resolveIncidentPhotoPreviewTarget(photo.id);
            return [photo.id, previewTarget] as const;
          } catch {
            return [photo.id, null] as const;
          }
        }),
        3,
      );

      if (!isMounted) return;
      const successMap: Record<number, IncidentPhotoPreviewTarget> = {};
      const failedMap: Record<number, boolean> = {};
      for (const [id, previewTarget] of resolvedEntries) {
        if (previewTarget) {
          successMap[id] = previewTarget;
        } else {
          failedMap[id] = true;
        }
      }
      setPhotoPreviews(successMap);
      setFailedPhotoIds(failedMap);
      setLoadingPhotoPreviews(false);
    };

    void loadPhotoPreviews();
    return () => {
      isMounted = false;
    };
  }, [incident]);

  const onAddEvidence = () => {
    if (!incident) return;
    router.push(
      `/incident/upload?incidentId=${incident.id}&installationId=${incident.installation_id}` as never,
    );
  };

  const onOpenPhoto = (photoId: number, fileName: string) => {
    if (!incident) return;
    router.push(
      `/incident/photo-viewer?photoId=${photoId}&incidentId=${incident.id}&installationId=${incident.installation_id}&fileName=${encodeURIComponent(fileName)}` as never,
    );
  };

  return (
    <ScrollView contentContainerStyle={[styles.container, { backgroundColor: palette.screenBg }]}>
      <Stack.Screen options={{ title: "Detalle incidencia" }} />

      <Text style={[styles.title, { color: palette.textPrimary }]}>Incidencia #{incidentIdText || "N/A"}</Text>

      <View style={styles.topRow}>
        <TouchableOpacity
          style={[
            styles.refreshButton,
            { backgroundColor: palette.buttonBg, borderColor: palette.buttonBorder },
          ]}
          onPress={loadIncident}
          disabled={loading}
        >
          <Text style={[styles.refreshButtonText, { color: palette.buttonText }]}>
            {loading ? "Cargando..." : "Refrescar"}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.backButton, { backgroundColor: palette.backBg }]} onPress={() => router.back()}>
          <Text style={[styles.backButtonText, { color: palette.textPrimary }]}>Volver</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color="#0b7a75" />
        </View>
      ) : errorMessage ? (
        <View
          style={[
            styles.feedbackBox,
            { backgroundColor: palette.feedbackBg, borderColor: palette.feedbackBorder },
          ]}
        >
          <Text style={[styles.feedbackText, { color: palette.feedbackText }]}>Error: {errorMessage}</Text>
        </View>
      ) : incident ? (
        <>
          <View style={[styles.card, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}>
            <Text style={[styles.cardTitle, { color: palette.textPrimary }]}>Datos principales</Text>
            <Text style={[styles.cardText, { color: palette.textSecondary }]}>Instalacion: #{incident.installation_id}</Text>
            <Text style={[styles.cardText, { color: palette.textSecondary }]}>Severidad: {incident.severity}</Text>
            <Text style={[styles.cardText, { color: palette.textSecondary }]}>Fuente: {incident.source}</Text>
            <Text style={[styles.cardText, { color: palette.textSecondary }]}>Usuario: {incident.reporter_username}</Text>
            <Text style={[styles.cardText, { color: palette.textSecondary }]}>
              Ajuste tiempo: {incident.time_adjustment_seconds} s
            </Text>
            <Text style={[styles.cardText, { color: palette.textSecondary }]}>Fecha: {formatDate(incident.created_at)}</Text>
          </View>

          <View style={[styles.card, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}>
            <Text style={[styles.cardTitle, { color: palette.textPrimary }]}>Nota</Text>
            <Text style={[styles.cardText, { color: palette.textSecondary }]}>{incident.note}</Text>
          </View>

          <View style={[styles.card, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}>
            <Text style={[styles.cardTitle, { color: palette.textPrimary }]}>Fotos ({incident.photos?.length ?? 0})</Text>
            {!incident.photos?.length ? (
              <Text style={[styles.hintText, { color: palette.textMuted }]}>Esta incidencia aun no tiene fotos adjuntas.</Text>
            ) : (
              incident.photos.map((photo) => (
                <View
                  key={photo.id}
                  style={[styles.photoItem, { backgroundColor: palette.itemBg, borderColor: palette.itemBorder }]}
                >
                  <Text style={[styles.photoTitle, { color: palette.textPrimary }]}>#{photo.id} - {photo.file_name}</Text>
                  <Text style={[styles.photoMeta, { color: palette.textMuted }]}>Tipo: {photo.content_type}</Text>
                  <Text style={[styles.photoMeta, { color: palette.textMuted }]}>Tamano: {formatBytes(photo.size_bytes)}</Text>
                  <Text style={[styles.photoMeta, { color: palette.textMuted }]}>Fecha: {formatDate(photo.created_at)}</Text>
                  {photoPreviews[photo.id] ? (
                    <TouchableOpacity onPress={() => onOpenPhoto(photo.id, photo.file_name)}>
                      <Image
                        source={{
                          uri: photoPreviews[photo.id].uri,
                          headers: photoPreviews[photo.id].headers,
                        }}
                        style={styles.photoPreview}
                        resizeMode="cover"
                      />
                      <Text style={styles.openPreviewText}>Ver en pantalla completa</Text>
                    </TouchableOpacity>
                  ) : loadingPhotoPreviews && !failedPhotoIds[photo.id] ? (
                    <Text style={[styles.hintText, { color: palette.textMuted }]}>Cargando vista previa...</Text>
                  ) : (
                    <Text style={[styles.hintText, { color: palette.textMuted }]}>No se pudo cargar la vista previa.</Text>
                  )}
                </View>
              ))
            )}
          </View>

          <TouchableOpacity style={styles.primaryButton} onPress={onAddEvidence}>
            <Text style={styles.primaryButtonText}>Adjuntar evidencia</Text>
          </TouchableOpacity>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    gap: 10,
    backgroundColor: "#f8fafc",
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#0f172a",
  },
  topRow: {
    flexDirection: "row",
    gap: 10,
  },
  refreshButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 10,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },
  refreshButtonText: {
    color: "#0f172a",
    fontWeight: "700",
  },
  backButton: {
    flex: 1,
    borderRadius: 10,
    backgroundColor: "#e2e8f0",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },
  backButtonText: {
    color: "#0f172a",
    fontWeight: "700",
  },
  centerBox: {
    paddingVertical: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  feedbackBox: {
    borderWidth: 1,
    borderColor: "#fecaca",
    backgroundColor: "#fef2f2",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  feedbackText: {
    color: "#7f1d1d",
    fontSize: 12,
  },
  card: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 10,
    backgroundColor: "#ffffff",
    padding: 12,
    gap: 6,
  },
  cardTitle: {
    fontWeight: "700",
    color: "#0f172a",
    marginBottom: 2,
  },
  cardText: {
    color: "#1e293b",
    fontSize: 13,
  },
  hintText: {
    color: "#64748b",
    fontSize: 13,
  },
  photoItem: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 3,
    backgroundColor: "#f8fafc",
  },
  photoTitle: {
    color: "#0f172a",
    fontWeight: "700",
    fontSize: 12,
  },
  photoMeta: {
    color: "#475569",
    fontSize: 12,
  },
  photoPreview: {
    marginTop: 6,
    width: "100%",
    height: 160,
    borderRadius: 8,
    backgroundColor: "#cbd5e1",
  },
  openPreviewText: {
    marginTop: 6,
    color: "#0b7a75",
    fontWeight: "700",
    fontSize: 12,
  },
  primaryButton: {
    marginTop: 4,
    borderRadius: 10,
    backgroundColor: "#0b7a75",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 15,
  },
});
