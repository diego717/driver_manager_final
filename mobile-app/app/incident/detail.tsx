import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { extractApiError } from "@/src/api/client";
import { listIncidentsByInstallation, updateIncidentStatus } from "@/src/api/incidents";
import {
  fetchIncidentPhotoDataUri,
  type IncidentPhotoPreviewTarget,
} from "@/src/api/photos";
import EmptyStateCard from "@/src/components/EmptyStateCard";
import ScreenHero from "@/src/components/ScreenHero";
import ScreenScaffold from "@/src/components/ScreenScaffold";
import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies } from "@/src/theme/typography";
import { type Incident } from "@/src/types/api";

function normalizeParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}
const MIN_TOUCH_TARGET_SIZE = 44;

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

function formatDuration(value: number): string {
  const totalSeconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  if (totalSeconds <= 0) return "0s";

  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (seconds || parts.length === 0) parts.push(`${seconds}s`);
  return parts.join(" ");
}

function normalizeIncidentStatus(value: string | null | undefined): "open" | "in_progress" | "resolved" {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "in_progress") return "in_progress";
  if (normalized === "resolved") return "resolved";
  return "open";
}

function incidentStatusLabel(value: string | null | undefined): string {
  const status = normalizeIncidentStatus(value);
  if (status === "in_progress") return "En curso";
  if (status === "resolved") return "Resuelta";
  return "Abierta";
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
  const palette = useAppPalette();
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
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [resolutionNote, setResolutionNote] = useState("");
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
      const found = response.incidents.find((item) => item.id === incidentId) || null;
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

  useFocusEffect(
    useCallback(() => {
      void loadIncident();
    }, [loadIncident]),
  );

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
            const previewTarget = {
              uri: await fetchIncidentPhotoDataUri(photo.id),
              headers: {},
            };
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

  const onChangeStatus = useCallback(
    async (nextStatus: "open" | "in_progress" | "resolved") => {
      if (!incident) return;
      const currentStatus = normalizeIncidentStatus(incident.incident_status);
      if (currentStatus === nextStatus) return;

      try {
        setUpdatingStatus(true);
        await updateIncidentStatus(incident.id, {
          incident_status: nextStatus,
          resolution_note: nextStatus === "resolved" ? resolutionNote.trim() : "",
          reporter_username: incident.reporter_username || "mobile_user",
        });
        await loadIncident();
      } catch (error) {
        Alert.alert("Error", extractApiError(error));
      } finally {
        setUpdatingStatus(false);
      }
    },
    [incident, loadIncident, resolutionNote],
  );

  const onAddEvidence = useCallback(() => {
    if (!incident) return;
    router.push(
      `/incident/upload?incidentId=${incident.id}&installationId=${incident.installation_id}` as never,
    );
  }, [incident, router]);

  const onOpenPhoto = useCallback((photoId: number, fileName: string) => {
    if (!incident) return;
    router.push(
      `/incident/photo-viewer?photoId=${photoId}&incidentId=${incident.id}&installationId=${incident.installation_id}&fileName=${encodeURIComponent(fileName)}` as never,
    );
  }, [incident, router]);

  const renderPhotoItem = useCallback(
    ({ item }: { item: NonNullable<Incident["photos"]>[number] }) => (
      <View style={[styles.photoItem, { backgroundColor: palette.itemBg, borderColor: palette.itemBorder }]}>
        <Text style={[styles.photoTitle, { color: palette.textPrimary }]}>#{item.id} - {item.file_name}</Text>
        <Text style={[styles.photoMeta, { color: palette.textMuted }]}>Tipo: {item.content_type}</Text>
        <Text style={[styles.photoMeta, { color: palette.textMuted }]}>Tamano: {formatBytes(item.size_bytes)}</Text>
        <Text style={[styles.photoMeta, { color: palette.textMuted }]}>Fecha: {formatDate(item.created_at)}</Text>
        {photoPreviews[item.id] ? (
          <TouchableOpacity
            onPress={() => onOpenPhoto(item.id, item.file_name)}
            accessibilityRole="imagebutton"
            accessibilityLabel={`Abrir vista completa de la foto ${item.id}`}
            accessibilityState={{ disabled: false }}
          >
            <Image
              source={{
                uri: photoPreviews[item.id].uri,
                headers: photoPreviews[item.id].headers,
              }}
              style={[styles.photoPreview, { backgroundColor: palette.previewPlaceholder }]}
              resizeMode="cover"
            />
            <Text style={[styles.openPreviewText, { color: palette.previewLink }]}>Ver en pantalla completa</Text>
          </TouchableOpacity>
        ) : loadingPhotoPreviews && !failedPhotoIds[item.id] ? (
          <Text style={[styles.hintText, { color: palette.textMuted }]}>Cargando vista previa...</Text>
        ) : (
          <Text style={[styles.hintText, { color: palette.textMuted }]}>No se pudo cargar la vista previa.</Text>
        )}
      </View>
    ),
    [failedPhotoIds, loadingPhotoPreviews, onOpenPhoto, palette, photoPreviews],
  );

  return (
    <ScreenScaffold contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: "Detalle incidencia" }} />

      <ScreenHero
        eyebrow="Seguimiento"
        title={`Incidencia #${incidentIdText || "N/A"}`}
        description="Consulta el estado operativo, revisa evidencia y resuelve la incidencia sin salir del contexto de instalacion."
        aside={
          incident ? (
            <View
              style={[
                styles.heroBadge,
                {
                  backgroundColor: palette.heroEyebrowBg,
                  borderColor: palette.heroBorder,
                },
              ]}
            >
              <Text style={[styles.heroBadgeText, { color: palette.heroEyebrowText }]}>
                {incidentStatusLabel(incident.incident_status)}
              </Text>
            </View>
          ) : null
        }
      />

      <View style={styles.topRow}>
        <TouchableOpacity
          style={[
            styles.refreshButton,
            { backgroundColor: palette.buttonBg, borderColor: palette.buttonBorder },
          ]}
          onPress={loadIncident}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel="Refrescar datos de la incidencia"
          accessibilityState={{ disabled: loading, busy: loading }}
        >
          <Text style={[styles.refreshButtonText, { color: palette.buttonText }]}>
            {loading ? "Cargando..." : "Refrescar"}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.backButton, { backgroundColor: palette.backBg }]}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Volver a la pantalla anterior"
          accessibilityState={{ disabled: false }}
        >
          <Text style={[styles.backButtonText, { color: palette.textPrimary }]}>Volver</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color={palette.loadingSpinner} />
        </View>
      ) : errorMessage ? (
        <View
          style={[
            styles.feedbackBox,
            { backgroundColor: palette.errorBg, borderColor: palette.errorBorder },
          ]}
        >
          <Text style={[styles.feedbackText, { color: palette.errorText }]}>Error: {errorMessage}</Text>
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
              Ajuste tiempo: {formatDuration(incident.time_adjustment_seconds ?? 0)}
            </Text>
            <Text style={[styles.cardText, { color: palette.textSecondary }]}>
              Estado: {incidentStatusLabel(incident.incident_status)}
            </Text>
            {incident.resolved_at ? (
              <Text style={[styles.cardText, { color: palette.textSecondary }]}>
                Resuelta: {formatDate(incident.resolved_at)}
              </Text>
            ) : null}
            <View style={styles.statusButtonsRow}>
              <TouchableOpacity
                style={[styles.statusButton, { backgroundColor: palette.refreshBg, borderColor: palette.inputBorder }]}
                onPress={() => void onChangeStatus("open")}
                disabled={updatingStatus || normalizeIncidentStatus(incident.incident_status) === "open"}
                accessibilityRole="button"
              >
                <Text style={[styles.statusButtonText, { color: palette.refreshText }]}>Abrir</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.statusButton, { backgroundColor: palette.refreshBg, borderColor: palette.inputBorder }]}
                onPress={() => void onChangeStatus("in_progress")}
                disabled={updatingStatus || normalizeIncidentStatus(incident.incident_status) === "in_progress"}
                accessibilityRole="button"
              >
                <Text style={[styles.statusButtonText, { color: palette.refreshText }]}>En curso</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.statusButton, { backgroundColor: palette.primaryButtonBg }]}
                onPress={() => void onChangeStatus("resolved")}
                disabled={updatingStatus || normalizeIncidentStatus(incident.incident_status) === "resolved"}
                accessibilityRole="button"
              >
                <Text style={[styles.statusButtonText, { color: palette.primaryButtonText }]}>Resolver</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              value={resolutionNote}
              onChangeText={setResolutionNote}
              style={[
                styles.resolutionInput,
                {
                  backgroundColor: palette.inputBg,
                  borderColor: palette.inputBorder,
                  color: palette.textPrimary,
                },
              ]}
              multiline
              placeholder="Nota de resolución (opcional)"
              placeholderTextColor={palette.textMuted}
            />
            <Text style={[styles.cardText, { color: palette.textSecondary }]}>Fecha: {formatDate(incident.created_at)}</Text>
          </View>

          <View style={[styles.card, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}>
            <Text style={[styles.cardTitle, { color: palette.textPrimary }]}>Nota</Text>
            <Text style={[styles.cardText, { color: palette.textSecondary }]}>{incident.note}</Text>
          </View>

          <View style={[styles.card, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}>
            <Text style={[styles.cardTitle, { color: palette.textPrimary }]}>Checklist aplicado</Text>
            {incident.checklist_items?.length ? (
              incident.checklist_items.map((item, index) => (
                <Text key={`${item}-${index}`} style={[styles.cardText, { color: palette.textSecondary }]}>
                  • {item}
                </Text>
              ))
            ) : (
              <EmptyStateCard
                title="Sin checklist guardado."
                body="Todavia no se registro una validacion guiada para esta incidencia."
              />
            )}
            <Text style={[styles.cardTitle, { color: palette.textPrimary, marginTop: 10 }]}>Nota operativa</Text>
            <Text style={[styles.cardText, { color: palette.textSecondary }]}>
              {incident.evidence_note?.trim() ? incident.evidence_note : "Sin nota operativa."}
            </Text>
          </View>

          <View style={[styles.card, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}>
            <Text style={[styles.cardTitle, { color: palette.textPrimary }]}>Fotos ({incident.photos?.length ?? 0})</Text>
            {!incident.photos?.length ? (
              <EmptyStateCard
                title="Esta incidencia aun no tiene fotos adjuntas."
                body="Usa la accion principal para agregar evidencia fotografica desde el dispositivo."
              />
            ) : (
              <FlatList
                testID="incident-photos-list"
                data={incident.photos}
                keyExtractor={(item) => String(item.id)}
                renderItem={renderPhotoItem}
                initialNumToRender={3}
                windowSize={5}
                removeClippedSubviews
                scrollEnabled={false}
                contentContainerStyle={styles.photosList}
              />
            )}
          </View>

          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: palette.primaryButtonBg }]}
            onPress={onAddEvidence}
            accessibilityRole="button"
            accessibilityLabel="Adjuntar evidencia fotografica"
            accessibilityState={{ disabled: false }}
          >
            <Text style={[styles.primaryButtonText, { color: palette.primaryButtonText }]}>
              Adjuntar evidencia
            </Text>
          </TouchableOpacity>
        </>
      ) : null}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    gap: 10,
  },
  heroBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  heroBadgeText: {
    fontFamily: fontFamilies.bold,
    fontSize: 11.5,
    letterSpacing: 0.3,
  },
  topRow: {
    flexDirection: "row",
    gap: 10,
  },
  refreshButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 14,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },
  refreshButtonText: {
    fontFamily: fontFamilies.bold,
  },
  backButton: {
    flex: 1,
    borderRadius: 14,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },
  backButtonText: {
    fontFamily: fontFamilies.bold,
  },
  centerBox: {
    paddingVertical: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  feedbackBox: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  feedbackText: {
    fontSize: 12,
    fontFamily: fontFamilies.regular,
  },
  card: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    gap: 8,
  },
  cardTitle: {
    fontFamily: fontFamilies.bold,
    marginBottom: 2,
  },
  cardText: {
    fontSize: 13,
    fontFamily: fontFamilies.regular,
  },
  statusButtonsRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 6,
  },
  statusButton: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  statusButtonText: {
    fontSize: 12,
    fontFamily: fontFamilies.bold,
  },
  resolutionInput: {
    borderWidth: 1,
    borderRadius: 14,
    minHeight: MIN_TOUCH_TARGET_SIZE * 1.4,
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    fontFamily: fontFamilies.regular,
    textAlignVertical: "top",
  },
  hintText: {
    fontSize: 13,
    fontFamily: fontFamilies.regular,
  },
  photoItem: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 3,
  },
  photoTitle: {
    fontFamily: fontFamilies.bold,
    fontSize: 12,
  },
  photoMeta: {
    fontSize: 12,
    fontFamily: fontFamilies.regular,
  },
  photoPreview: {
    marginTop: 6,
    width: "100%",
    height: 160,
    borderRadius: 8,
  },
  openPreviewText: {
    marginTop: 6,
    fontFamily: fontFamilies.bold,
    fontSize: 12,
  },
  photosList: {
    gap: 8,
  },
  primaryButton: {
    marginTop: 4,
    borderRadius: 10,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
  },
  primaryButtonText: {
    fontFamily: fontFamilies.bold,
    fontSize: 15,
  },
});
