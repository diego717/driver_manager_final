import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  FlatList,
  Image,
  Linking,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";

import { extractApiError } from "@/src/api/client";
import {
  deleteIncident,
  getIncidentById,
  getLastIncidentDetailSource,
  updateIncidentStatus,
} from "@/src/api/incidents";
import {
  type IncidentPhotoPreviewTarget,
  resolveIncidentPhotoPreviewTarget,
} from "@/src/api/photos";
import { getCurrentLinkedTechnicianContext, getTechnicianAssignmentsByEntity } from "@/src/api/technicians";
import { readStoredWebSession } from "@/src/api/webAuth";
import { canAssignTechnicians, canDeleteCriticalData, canReopenIncidents } from "@/src/auth/roles";
import EmptyStateCard from "@/src/components/EmptyStateCard";
import RuntimeChip from "@/src/components/RuntimeChip";
import ScreenHero from "@/src/components/ScreenHero";
import ScreenScaffold from "@/src/components/ScreenScaffold";
import SectionCard from "@/src/components/SectionCard";
import StatusChip from "@/src/components/StatusChip";
import TechnicianAssignmentsPanel from "@/src/components/TechnicianAssignmentsPanel";
import { useReducedMotion } from "@/src/hooks/useReducedMotion";
import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies, inputFontFamily, textInputAccentColor } from "@/src/theme/typography";
import { type Incident, type TechnicianAssignment, type TechnicianRecord } from "@/src/types/api";
import { buildIncidentNavigationTargets } from "@/src/utils/incident-dispatch";
import {
  formatDateTime,
  formatDuration,
  getIncidentStatusLabel,
  getSeverityLabel,
  normalizeIncidentStatus,
  resolveIncidentEstimatedDurationSeconds,
  resolveIncidentRealDurationSeconds,
} from "@/src/utils/incidents";

const MIN_TOUCH_TARGET_SIZE = 44;

function normalizeParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
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
  for (let index = 0; index < tasks.length; index += limit) {
    const batch = tasks.slice(index, index + limit);
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
  const [usingOfflineSnapshot, setUsingOfflineSnapshot] = useState(false);
  const [photoPreviews, setPhotoPreviews] = useState<Record<number, IncidentPhotoPreviewTarget>>(
    {},
  );
  const [failedPhotoIds, setFailedPhotoIds] = useState<Record<number, boolean>>({});
  const [loadingPhotoPreviews, setLoadingPhotoPreviews] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [deletingIncident, setDeletingIncident] = useState(false);
  const [resolutionNote, setResolutionNote] = useState("");
  const [webSessionRole, setWebSessionRole] = useState<string | null>(null);
  const [linkedTechnician, setLinkedTechnician] = useState<TechnicianRecord | null>(null);
  const [directAssignmentSummary, setDirectAssignmentSummary] = useState<TechnicianAssignment[]>([]);
  const [inheritedAssignmentSummary, setInheritedAssignmentSummary] = useState<TechnicianAssignment[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);
  const { width: windowWidth } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const activePhotoOpacity = useState(() => new Animated.Value(1))[0];
  const activePhotoTranslateY = useState(() => new Animated.Value(0))[0];

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
      const found = await getIncidentById(incidentId);
      setUsingOfflineSnapshot(getLastIncidentDetailSource() === "cache");
      if (Number(found.installation_id) !== installationId) {
        setIncident(null);
        setErrorMessage("La incidencia no existe para esta instalacion.");
        return;
      }
      setIncident(found);
      setActivePhotoIndex(0);
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
      void readStoredWebSession()
        .then((session) => setWebSessionRole(session.role))
        .catch(() => setWebSessionRole(null));
      void getCurrentLinkedTechnicianContext()
        .then(({ technician }) => setLinkedTechnician(technician))
        .catch(() => setLinkedTechnician(null));
    }, [loadIncident]),
  );

  useEffect(() => {
    let mounted = true;
    if (!incident) {
      setDirectAssignmentSummary([]);
      setInheritedAssignmentSummary([]);
      return () => {
        mounted = false;
      };
    }

    void Promise.all([
      getTechnicianAssignmentsByEntity("incident", incident.id).catch(() => []),
      getTechnicianAssignmentsByEntity("installation", incident.installation_id).catch(() => []),
      incident.asset_id
        ? getTechnicianAssignmentsByEntity("asset", incident.asset_id).catch(() => [])
        : Promise.resolve([]),
    ]).then(([incidentAssignments, installationAssignments, assetAssignments]) => {
      if (!mounted) return;
      const directAssignments = incidentAssignments.filter((assignment) => !assignment.unassigned_at);
      const seen = new Set<number>();
      const inheritedAssignments = [...installationAssignments, ...assetAssignments].filter((assignment) => {
        if (!assignment?.id || seen.has(assignment.id)) return false;
        seen.add(assignment.id);
        return !assignment.unassigned_at;
      });
      setDirectAssignmentSummary(directAssignments);
      setInheritedAssignmentSummary(inheritedAssignments);
    });

    return () => {
      mounted = false;
    };
  }, [incident]);

  const assignmentSummary = useMemo(() => {
    const seen = new Set<number>();
    return [...directAssignmentSummary, ...inheritedAssignmentSummary].filter((assignment) => {
      if (!assignment?.id || seen.has(assignment.id)) return false;
      seen.add(assignment.id);
      return true;
    });
  }, [directAssignmentSummary, inheritedAssignmentSummary]);

  useEffect(() => {
    if (normalizeIncidentStatus(incident?.incident_status) !== "in_progress") {
      return;
    }
    const timerId = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(timerId);
  }, [incident]);

  useEffect(() => {
    if (reducedMotion) {
      activePhotoOpacity.setValue(1);
      activePhotoTranslateY.setValue(0);
      return;
    }

    activePhotoOpacity.setValue(0.58);
    activePhotoTranslateY.setValue(6);
    Animated.parallel([
      Animated.timing(activePhotoOpacity, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(activePhotoTranslateY, {
        toValue: 0,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [activePhotoIndex, activePhotoOpacity, activePhotoTranslateY, reducedMotion]);

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

  const onChangeStatus = useCallback(
    async (nextStatus: "open" | "in_progress" | "paused" | "resolved") => {
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

  const onDeleteIncident = useCallback(() => {
    if (!incident || deletingIncident) return;

    Alert.alert(
      "Eliminar incidencia",
      `La incidencia #${incident.id} dejara de verse en la app y en web. Esta accion solo la puede hacer platform_owner.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: () => {
            void (async () => {
              try {
                setDeletingIncident(true);
                await deleteIncident(incident.id);
                Alert.alert("Incidencia eliminada", `La incidencia #${incident.id} fue ocultada.`);
                router.back();
              } catch (error) {
                Alert.alert("Error", extractApiError(error));
              } finally {
                setDeletingIncident(false);
              }
            })();
          },
        },
      ],
    );
  }, [deletingIncident, incident, router]);

  const onOpenPhoto = useCallback(
    (photoId: number, fileName: string, initialIndex: number) => {
      if (!incident) return;
      const photoIds = incident.photos?.map((photo) => photo.id).join(",") || String(photoId);
      router.push(
        `/incident/photo-viewer?photoId=${photoId}&incidentId=${incident.id}&installationId=${incident.installation_id}&initialIndex=${initialIndex}&photoIds=${encodeURIComponent(photoIds)}&fileName=${encodeURIComponent(fileName)}` as never,
      );
    },
    [incident, router],
  );

  const photoCardWidth = Math.max(260, windowWidth - 72);
  const photoSnapInterval = photoCardWidth + 12;
  const activePhoto = incident?.photos?.[activePhotoIndex] ?? null;
  const navigationTargets = useMemo(() => buildIncidentNavigationTargets(incident), [incident]);

  const openExternalUrl = useCallback(async (targetUrl: string | null, label: string) => {
    if (!targetUrl) {
      Alert.alert("Sin destino", `No hay datos suficientes para abrir ${label}.`);
      return;
    }

    try {
      const supported = await Linking.canOpenURL(targetUrl);
      if (!supported) {
        Alert.alert("No disponible", `No se pudo abrir ${label} en este dispositivo.`);
        return;
      }
      await Linking.openURL(targetUrl);
    } catch (error) {
      Alert.alert("Error", extractApiError(error));
    }
  }, []);

  const renderPhotoItem = useCallback(
    ({
      item,
      index,
    }: {
      item: NonNullable<Incident["photos"]>[number];
      index: number;
    }) => (
      <View
        style={[
          styles.photoItem,
          {
            width: photoCardWidth,
            backgroundColor: palette.itemBg,
            borderColor: palette.itemBorder,
          },
        ]}
      >
        <View style={styles.photoHead}>
          <View
            style={[
              styles.photoIndexPill,
              {
                backgroundColor: palette.heroEyebrowBg,
                borderColor: palette.heroBorder,
              },
            ]}
          >
            <Text style={[styles.photoIndexText, { color: palette.previewLink }]}>
              {index + 1}/{incident?.photos?.length ?? 1}
            </Text>
          </View>
          <Text style={[styles.photoMetaCompact, { color: palette.textMuted }]}>
            {formatDateTime(item.created_at)}
          </Text>
        </View>
        <Text style={[styles.photoTitle, { color: palette.textPrimary }]} numberOfLines={1}>
          {item.file_name}
        </Text>
        {photoPreviews[item.id] ? (
          <TouchableOpacity
            onPress={() => onOpenPhoto(item.id, item.file_name, index)}
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
          </TouchableOpacity>
        ) : loadingPhotoPreviews && !failedPhotoIds[item.id] ? (
          <Text style={[styles.hintText, { color: palette.textMuted }]}>
            Cargando vista previa...
          </Text>
        ) : (
          <Text style={[styles.hintText, { color: palette.textMuted }]}>
            No se pudo cargar la vista previa.
          </Text>
        )}
        <View style={styles.photoFooter}>
          <View style={styles.photoStats}>
            <Text style={[styles.photoMeta, { color: palette.textMuted }]}>
              {item.content_type}
            </Text>
            <Text style={[styles.photoMeta, { color: palette.textMuted }]}>
              {formatBytes(item.size_bytes)}
            </Text>
          </View>
          <Text style={[styles.openPreviewText, { color: palette.previewLink }]}>
            Abrir y deslizar
          </Text>
        </View>
      </View>
    ),
    [failedPhotoIds, incident?.photos?.length, loadingPhotoPreviews, onOpenPhoto, palette, photoCardWidth, photoPreviews],
  );

  const status = normalizeIncidentStatus(incident?.incident_status);
  const runtime = resolveIncidentRealDurationSeconds(incident, nowMs);
  const estimated = resolveIncidentEstimatedDurationSeconds(incident);
  const canDeleteIncident = canDeleteCriticalData(webSessionRole);
  const canManageTechnicianAssignments = canAssignTechnicians(webSessionRole);
  const canReopenResolvedIncident =
    status !== "resolved" || canReopenIncidents(webSessionRole);
  const statusActions = [
    { key: "open" as const, label: "Abrir" },
    {
      key: "in_progress" as const,
      label: status === "paused" ? "Reanudar" : "En curso",
    },
    { key: "paused" as const, label: "Pausar" },
    { key: "resolved" as const, label: "Resolver", primary: true },
  ].filter((action) => canReopenResolvedIncident || action.key === "resolved");
  const currentTechnicianAssigned = Boolean(
    linkedTechnician?.id &&
      assignmentSummary.some((assignment) => assignment.technician_id === linkedTechnician.id),
  );

  return (
    <ScreenScaffold contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: "Detalle incidencia" }} />

      <ScreenHero
        eyebrow="Seguimiento"
        title={`Incidencia #${incidentIdText || "N/A"}`}
        description="Estado operativo, tiempo acumulado, evidencia y fotos desde una sola pantalla."
        aside={incident ? <StatusChip value={incident.incident_status} /> : null}
      />

      {usingOfflineSnapshot ? (
        <View
          style={[
            styles.feedbackBox,
            { backgroundColor: palette.warningBg, borderColor: palette.warningText },
          ]}
        >
          <Text style={[styles.feedbackText, { color: palette.warningText }]}>
            Mostrando el ultimo snapshot local disponible para esta incidencia.
          </Text>
        </View>
      ) : null}

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
          <Text style={[styles.feedbackText, { color: palette.errorText }]}>
            Error: {errorMessage}
          </Text>
        </View>
      ) : incident ? (
        <>
          <SectionCard
            title="Datos principales"
            description="El tiempo real y la pausa siguen la misma regla que en web."
          >
            <Text style={[styles.cardText, { color: palette.textSecondary }]}>
              Instalacion: #{incident.installation_id}
            </Text>
            <Text style={[styles.cardText, { color: palette.textSecondary }]}>
              Usuario: {incident.reporter_username}
            </Text>
            <Text style={[styles.cardText, { color: palette.textSecondary }]}>
              Severidad: {getSeverityLabel(incident.severity)}
            </Text>
            <Text style={[styles.cardText, { color: palette.textSecondary }]}>
              Fuente: {incident.source}
            </Text>
            <Text style={[styles.cardText, { color: palette.textSecondary }]}>
              Fecha: {formatDateTime(incident.created_at)}
            </Text>
            {linkedTechnician ? (
              <Text
                style={[
                  styles.cardText,
                  { color: currentTechnicianAssigned ? palette.successText : palette.textSecondary },
                ]}
              >
                Tu asignacion: {currentTechnicianAssigned ? "en tu cola" : "sin asignacion directa"}
              </Text>
            ) : null}
            {incident.resolved_at ? (
              <Text style={[styles.cardText, { color: palette.textSecondary }]}>
                Resuelta: {formatDateTime(incident.resolved_at)}
              </Text>
            ) : null}

            <View style={styles.runtimeGrid}>
              <RuntimeChip label="Estado" value={getIncidentStatusLabel(status)} />
              <RuntimeChip label="Estimado" value={formatDuration(estimated)} />
              <RuntimeChip label="Real" value={formatDuration(runtime)} />
            </View>

            <View style={styles.statusButtonsRow}>
              {statusActions.map((action) => {
                const selected = status === action.key;
                return (
                  <TouchableOpacity
                    key={action.key}
                    style={[
                      styles.statusButton,
                      {
                        backgroundColor:
                          selected || action.primary
                            ? palette.primaryButtonBg
                            : palette.refreshBg,
                        borderColor: action.primary
                          ? palette.primaryButtonBg
                          : palette.inputBorder,
                      },
                    ]}
                    onPress={() => {
                      void onChangeStatus(action.key);
                    }}
                    disabled={updatingStatus || (status === "resolved" && action.key === "resolved")}
                    accessibilityRole="button"
                  >
                    <Text
                      style={[
                        styles.statusButtonText,
                        {
                          color:
                            selected || action.primary
                              ? palette.primaryButtonText
                              : palette.refreshText,
                        },
                      ]}
                    >
                      {action.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {status === "resolved" && !canReopenResolvedIncident ? (
              <Text style={[styles.cardText, { color: palette.textMuted }]}>
                Solo admin, supervisor o plataforma pueden reabrir una incidencia resuelta.
              </Text>
            ) : null}
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
              placeholder="Nota de resolucion (opcional)"
              placeholderTextColor={palette.textMuted}
              selectionColor={textInputAccentColor}
              cursorColor={textInputAccentColor}
            />
          </SectionCard>

          {assignmentSummary.length ? (
            <SectionCard
              title="Responsables"
              description="Asignaciones heredadas de la incidencia, del caso o del activo."
            >
              {assignmentSummary.map((assignment) => (
                <Text key={assignment.id} style={[styles.cardText, { color: palette.textSecondary }]}>
                  {assignment.technician_display_name || `Tecnico #${assignment.technician_id}`} - {assignment.assignment_role} - {assignment.entity_type}
                </Text>
              ))}
            </SectionCard>
          ) : null}

          {canManageTechnicianAssignments ? (
            <SectionCard
              title="Gestion operativa"
              description="Asigna o quita responsables directos de esta incidencia desde mobile."
            >
              <TechnicianAssignmentsPanel
                entityType="incident"
                entityId={incident.id}
                entityLabel={`Incidencia #${incident.id}`}
                canManage={canManageTechnicianAssignments}
                currentLinkedTechnicianId={linkedTechnician?.id ?? null}
                emptyText="Sin tecnicos asignados directo a esta incidencia."
                onAssignmentsChanged={setDirectAssignmentSummary}
              />
            </SectionCard>
          ) : null}

          <SectionCard title="Nota" description="Contexto principal de la incidencia.">
            <Text style={[styles.cardText, { color: palette.textSecondary }]}>
              {incident.note}
            </Text>
          </SectionCard>

          <SectionCard
            title="Destino operativo"
            description="Prioriza lugar, direccion y referencia para la visita antes que la coordenada sola."
          >
            {incident.dispatch_required === false ? (
              <Text style={[styles.cardText, { color: palette.textSecondary }]}>
                Esta incidencia no requiere visita en sitio ni datos de despacho operativo.
              </Text>
            ) : (
              <>
                <Text style={[styles.dispatchPrimary, { color: palette.textPrimary }]}>
                  {incident.dispatch_place_name?.trim() ||
                    incident.target_label?.trim() ||
                    "Sin destino operativo definido"}
                </Text>
                <Text style={[styles.cardText, { color: palette.textSecondary }]}>
                  Direccion: {incident.dispatch_address?.trim() || "Falta direccion legible"}
                </Text>
                <Text style={[styles.cardText, { color: palette.textSecondary }]}>
                  Referencia: {incident.dispatch_reference?.trim() || "Falta referencia de acceso"}
                </Text>
                {(incident.dispatch_contact_name || incident.dispatch_contact_phone) ? (
                  <Text style={[styles.cardText, { color: palette.textSecondary }]}>
                    Contacto: {[incident.dispatch_contact_name, incident.dispatch_contact_phone]
                      .map((value) => String(value || "").trim())
                      .filter(Boolean)
                      .join(" | ")}
                  </Text>
                ) : null}
                {incident.dispatch_notes?.trim() ? (
                  <Text style={[styles.cardText, { color: palette.textSecondary }]}>
                    Notas: {incident.dispatch_notes.trim()}
                  </Text>
                ) : null}
                {incident.target_source?.trim() ? (
                  <Text style={[styles.cardText, { color: palette.textSecondary }]}>
                    Origen: {incident.target_source.trim()}
                  </Text>
                ) : null}
                {(incident.target_lat !== null && incident.target_lat !== undefined && incident.target_lng !== null && incident.target_lng !== undefined) ? (
                  <Text style={[styles.cardText, { color: palette.textSecondary }]}>
                    Coordenadas: {incident.target_lat}, {incident.target_lng}
                  </Text>
                ) : null}

                <View style={styles.navigationButtonsRow}>
                  <TouchableOpacity
                    style={[
                      styles.statusButton,
                      {
                        backgroundColor: palette.primaryButtonBg,
                        borderColor: palette.primaryButtonBg,
                      },
                    ]}
                    onPress={() => {
                      void openExternalUrl(navigationTargets.google, "Google Maps");
                    }}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.statusButtonText, { color: palette.primaryButtonText }]}>
                      Abrir en Google Maps
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.statusButton,
                      {
                        backgroundColor: palette.refreshBg,
                        borderColor: palette.inputBorder,
                      },
                    ]}
                    onPress={() => {
                      void openExternalUrl(navigationTargets.waze, "Waze");
                    }}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.statusButtonText, { color: palette.refreshText }]}>
                      Abrir en Waze
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </SectionCard>

          <SectionCard title="Checklist y evidencia" description="Resumen rapido del trabajo realizado.">
            {incident.checklist_items?.length ? (
              incident.checklist_items.map((item, index) => (
                <Text key={`${item}-${index}`} style={[styles.cardText, { color: palette.textSecondary }]}>
                  - {item}
                </Text>
              ))
            ) : (
              <EmptyStateCard
                title="Sin checklist guardado."
                body="Todavia no se registro una validacion guiada para esta incidencia."
              />
            )}
            <Text style={[styles.cardText, { color: palette.textSecondary }]}>
              Nota operativa: {incident.evidence_note?.trim() ? incident.evidence_note : "Sin nota operativa."}
            </Text>
          </SectionCard>

          <SectionCard
            title={`Fotos (${incident.photos?.length ?? 0})`}
            description="Desliza entre evidencias sin salir del detalle y abre el visor completo cuando necesites zoom."
            aside={
              activePhoto ? (
                <View
                  style={[
                    styles.photoCounterBadge,
                    {
                      backgroundColor: palette.heroEyebrowBg,
                      borderColor: palette.heroBorder,
                    },
                  ]}
                >
                  <Text style={[styles.photoCounterText, { color: palette.heroEyebrowText }]}>
                    {activePhotoIndex + 1}/{incident.photos?.length ?? 1}
                  </Text>
                </View>
              ) : null
            }
          >
            {!incident.photos?.length ? (
              <EmptyStateCard
                title="Esta incidencia aun no tiene fotos adjuntas."
                body="Usa la accion principal para agregar evidencia fotografica desde el dispositivo."
              />
            ) : (
              <>
                <Text style={[styles.photoRailHint, { color: palette.textSecondary }]}>
                  {activePhoto
                    ? `Vista activa: ${activePhoto.file_name}`
                    : "Desliza para recorrer las fotos de la incidencia."}
                </Text>
                <Animated.View
                  style={{
                    opacity: activePhotoOpacity,
                    transform: [{ translateY: activePhotoTranslateY }],
                  }}
                >
                  <Text style={[styles.photoRailHint, { color: palette.textSecondary }]}>
                    {activePhoto
                      ? `Tomada ${formatDateTime(activePhoto.created_at)}. Toca la foto para verla completa.`
                      : "Desliza para recorrer las fotos de la incidencia."}
                  </Text>
                </Animated.View>
                <FlatList
                  testID="incident-photos-list"
                  data={incident.photos}
                  keyExtractor={(item) => String(item.id)}
                  renderItem={renderPhotoItem}
                  initialNumToRender={2}
                  windowSize={3}
                  removeClippedSubviews
                  horizontal
                  decelerationRate="fast"
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.photosList}
                  snapToAlignment="start"
                  snapToInterval={photoSnapInterval}
                  onMomentumScrollEnd={(event) => {
                    const nextIndex = Math.round(
                      event.nativeEvent.contentOffset.x / photoSnapInterval,
                    );
                    setActivePhotoIndex(
                      Math.max(0, Math.min(nextIndex, (incident.photos?.length ?? 1) - 1)),
                    );
                  }}
                />
              </>
            )}
          </SectionCard>

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
          {canDeleteIncident ? (
            <TouchableOpacity
              style={[
                styles.secondaryDangerButton,
                {
                  backgroundColor: palette.errorBg,
                  borderColor: palette.errorBorder,
                },
              ]}
              onPress={onDeleteIncident}
              disabled={deletingIncident}
              accessibilityRole="button"
              accessibilityLabel="Eliminar incidencia"
              accessibilityState={{ disabled: deletingIncident, busy: deletingIncident }}
            >
              <Text style={[styles.secondaryDangerButtonText, { color: palette.errorText }]}>
                {deletingIncident ? "Eliminando..." : "Eliminar incidencia"}
              </Text>
            </TouchableOpacity>
          ) : null}
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
  cardText: {
    fontSize: 13,
    fontFamily: fontFamilies.regular,
  },
  dispatchPrimary: {
    fontSize: 18,
    lineHeight: 24,
    fontFamily: fontFamilies.bold,
  },
  runtimeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  navigationButtonsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
  },
  statusButtonsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 6,
  },
  statusButton: {
    minWidth: "47%",
    flexGrow: 1,
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
    fontFamily: inputFontFamily,
    textAlignVertical: "top",
  },
  hintText: {
    fontSize: 13,
    fontFamily: fontFamilies.regular,
  },
  photoItem: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
    marginRight: 12,
  },
  photoHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  photoIndexPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  photoIndexText: {
    fontFamily: fontFamilies.bold,
    fontSize: 11,
  },
  photoTitle: {
    fontFamily: fontFamilies.bold,
    fontSize: 14,
  },
  photoMeta: {
    fontSize: 12,
    fontFamily: fontFamilies.regular,
  },
  photoMetaCompact: {
    fontSize: 11.5,
    fontFamily: fontFamilies.regular,
  },
  photoPreview: {
    width: "100%",
    height: 220,
    borderRadius: 16,
  },
  photoFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  photoStats: {
    gap: 2,
  },
  openPreviewText: {
    fontFamily: fontFamilies.bold,
    fontSize: 12,
  },
  photosList: {
    paddingRight: 10,
  },
  photoCounterBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  photoCounterText: {
    fontFamily: fontFamilies.bold,
    fontSize: 11.5,
  },
  photoRailHint: {
    fontFamily: fontFamilies.regular,
    fontSize: 13,
    lineHeight: 18,
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
  secondaryDangerButton: {
    marginTop: 4,
    borderRadius: 10,
    borderWidth: 1,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
  },
  secondaryDangerButtonText: {
    fontFamily: fontFamilies.bold,
    fontSize: 15,
  },
});
