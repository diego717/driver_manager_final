import { useEffect, useMemo, useState } from "react";
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
import { fetchIncidentPhotoDataUri } from "@/src/api/photos";
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

export default function IncidentDetailScreen() {
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
  const [photoPreviews, setPhotoPreviews] = useState<Record<number, string>>({});
  const [failedPhotoIds, setFailedPhotoIds] = useState<Record<number, boolean>>({});
  const [loadingPhotoPreviews, setLoadingPhotoPreviews] = useState(false);

  const loadIncident = async () => {
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
  };

  useEffect(() => {
    void loadIncident();
  }, [incidentId, installationId]);

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

      const resolvedEntries = await Promise.all(
        incident.photos.map(async (photo) => {
          try {
            const dataUri = await fetchIncidentPhotoDataUri(photo.id);
            return [photo.id, dataUri] as const;
          } catch {
            return [photo.id, null] as const;
          }
        }),
      );

      if (!isMounted) return;
      const successMap: Record<number, string> = {};
      const failedMap: Record<number, boolean> = {};
      for (const [id, dataUri] of resolvedEntries) {
        if (dataUri) {
          successMap[id] = dataUri;
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
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: "Detalle incidencia" }} />

      <Text style={styles.title}>Incidencia #{incidentIdText || "N/A"}</Text>

      <View style={styles.topRow}>
        <TouchableOpacity style={styles.refreshButton} onPress={loadIncident} disabled={loading}>
          <Text style={styles.refreshButtonText}>{loading ? "Cargando..." : "Refrescar"}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>Volver</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color="#0b7a75" />
        </View>
      ) : errorMessage ? (
        <View style={styles.feedbackBox}>
          <Text style={styles.feedbackText}>Error: {errorMessage}</Text>
        </View>
      ) : incident ? (
        <>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Datos principales</Text>
            <Text style={styles.cardText}>Instalacion: #{incident.installation_id}</Text>
            <Text style={styles.cardText}>Severidad: {incident.severity}</Text>
            <Text style={styles.cardText}>Fuente: {incident.source}</Text>
            <Text style={styles.cardText}>Usuario: {incident.reporter_username}</Text>
            <Text style={styles.cardText}>
              Ajuste tiempo: {incident.time_adjustment_seconds} s
            </Text>
            <Text style={styles.cardText}>Fecha: {formatDate(incident.created_at)}</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Nota</Text>
            <Text style={styles.cardText}>{incident.note}</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Fotos ({incident.photos?.length ?? 0})</Text>
            {!incident.photos?.length ? (
              <Text style={styles.hintText}>Esta incidencia aun no tiene fotos adjuntas.</Text>
            ) : (
              incident.photos.map((photo) => (
                <View key={photo.id} style={styles.photoItem}>
                  <Text style={styles.photoTitle}>#{photo.id} - {photo.file_name}</Text>
                  <Text style={styles.photoMeta}>Tipo: {photo.content_type}</Text>
                  <Text style={styles.photoMeta}>Tamano: {formatBytes(photo.size_bytes)}</Text>
                  <Text style={styles.photoMeta}>Fecha: {formatDate(photo.created_at)}</Text>
                  {photoPreviews[photo.id] ? (
                    <TouchableOpacity onPress={() => onOpenPhoto(photo.id, photo.file_name)}>
                      <Image
                        source={{ uri: photoPreviews[photo.id] }}
                        style={styles.photoPreview}
                        resizeMode="cover"
                      />
                      <Text style={styles.openPreviewText}>Ver en pantalla completa</Text>
                    </TouchableOpacity>
                  ) : loadingPhotoPreviews && !failedPhotoIds[photo.id] ? (
                    <Text style={styles.hintText}>Cargando vista previa...</Text>
                  ) : (
                    <Text style={styles.hintText}>No se pudo cargar la vista previa.</Text>
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
