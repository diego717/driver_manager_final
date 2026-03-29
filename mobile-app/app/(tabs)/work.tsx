import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { extractApiError } from "@/src/api/client";
import {
  getIncidentById,
  listIncidentsByInstallation,
  listInstallations,
  updateIncidentStatus,
} from "@/src/api/incidents";
import { getAssetIncidents } from "@/src/api/assets";
import {
  createInstallationPublicTrackingLink,
  deleteInstallationPublicTrackingLink,
  getInstallationPublicTrackingLink,
} from "@/src/api/public-tracking";
import { getCurrentLinkedTechnicianContext, getTechnicianAssignments } from "@/src/api/technicians";
import EmptyStateCard from "@/src/components/EmptyStateCard";
import RuntimeChip from "@/src/components/RuntimeChip";
import ScreenHero from "@/src/components/ScreenHero";
import ScreenScaffold from "@/src/components/ScreenScaffold";
import SectionCard from "@/src/components/SectionCard";
import StatusChip from "@/src/components/StatusChip";
import SyncStatusBanner from "@/src/components/SyncStatusBanner";
import WebInlineLoginCard from "@/src/components/WebInlineLoginCard";
import { useSharedWebSessionState } from "@/src/session/web-session-store";
import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies } from "@/src/theme/typography";
import {
  type Incident,
  type IncidentStatus,
  type InstallationRecord,
  type PublicTrackingLink,
  type TechnicianAssignment,
  type TechnicianRecord,
} from "@/src/types/api";
import {
  formatDateTime,
  formatDuration,
  getIncidentStatusLabel,
  getRecordAttentionStateLabel,
  getSeverityLabel,
  normalizeIncidentStatus,
  resolveIncidentEstimatedDurationSeconds,
  resolveIncidentRealDurationSeconds,
  summarizeIncidentBuckets,
} from "@/src/utils/incidents";

const MIN_TOUCH_TARGET_SIZE = 44;

type QueueIncident = Incident & {
  queue_source: "incident" | "installation" | "asset";
  queue_source_label: string;
  assignment_role: string;
};

function getIncidentSortWeight(incident: Pick<Incident, "incident_status" | "severity" | "created_at">): number {
  const status = normalizeIncidentStatus(incident.incident_status);
  const statusWeight =
    status === "in_progress" ? 0 : status === "paused" ? 1 : status === "open" ? 2 : 3;
  const severityWeight =
    incident.severity === "critical" ? 0 : incident.severity === "high" ? 1 : 2;
  const createdAtWeight = new Date(incident.created_at || 0).getTime();
  return statusWeight * 1_000_000_000 + severityWeight * 1_000_000 + createdAtWeight;
}

function sortQueueIncidents(incidents: QueueIncident[]): QueueIncident[] {
  return [...incidents].sort((left, right) => getIncidentSortWeight(left) - getIncidentSortWeight(right));
}

export default function WorkTabScreen() {
  const palette = useAppPalette();
  const router = useRouter();
  const params = useLocalSearchParams<{ installationId?: string | string[] }>();
  const routeInstallationId = useMemo(() => {
    const raw = Array.isArray(params.installationId) ? params.installationId[0] : params.installationId;
    const parsed = Number.parseInt(String(raw || "").trim(), 10);
    return Number.isInteger(parsed) && parsed > 0 ? String(parsed) : "";
  }, [params.installationId]);
  const [installationId, setInstallationId] = useState("1");
  const [loading, setLoading] = useState(false);
  const [loadingInstallations, setLoadingInstallations] = useState(false);
  const [updatingIncidentId, setUpdatingIncidentId] = useState<number | null>(null);
  const [loadingTrackingLink, setLoadingTrackingLink] = useState(false);
  const [trackingActionBusy, setTrackingActionBusy] = useState(false);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [installations, setInstallations] = useState<InstallationRecord[]>([]);
  const [trackingLink, setTrackingLink] = useState<PublicTrackingLink | null>(null);
  const [linkedTechnician, setLinkedTechnician] = useState<TechnicianRecord | null>(null);
  const [technicianAssignments, setTechnicianAssignments] = useState<TechnicianAssignment[]>([]);
  const [queueIncidents, setQueueIncidents] = useState<QueueIncident[]>([]);
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const { checkingSession, hasActiveSession } = useSharedWebSessionState();

  const loadIncidents = useCallback(
    async (targetInstallationId: number) => {
      if (!hasActiveSession) return;
      if (!Number.isInteger(targetInstallationId) || targetInstallationId <= 0) {
        Alert.alert("Dato invalido", "El ID del caso debe ser un numero positivo.");
        return;
      }

      try {
        setLoading(true);
        const response = await listIncidentsByInstallation(targetInstallationId);
        setIncidents(response.incidents);
      } catch (error) {
        Alert.alert("Error", extractApiError(error));
      } finally {
        setLoading(false);
      }
    },
    [hasActiveSession],
  );

  const loadInstallations = useCallback(
    async (options?: { forceRefresh?: boolean }) => {
      if (!hasActiveSession) return;
      try {
        setLoadingInstallations(true);
        const records = await listInstallations(options);
        setInstallations(records);
        setInstallationId((current) => {
          const currentId = Number.parseInt(current, 10);
          return records.some((item) => item.id === currentId) || records.length === 0
            ? current
            : String(records[0].id);
        });
      } catch (error) {
        Alert.alert("Error", `No se pudieron cargar los casos: ${extractApiError(error)}`);
      } finally {
        setLoadingInstallations(false);
      }
    },
    [hasActiveSession],
  );

  const loadTechnicianQueue = useCallback(async () => {
    if (!hasActiveSession) return;

    try {
      setLoadingQueue(true);
      const { technician } = await getCurrentLinkedTechnicianContext();
      setLinkedTechnician(technician);

      if (!technician?.id) {
        setTechnicianAssignments([]);
        setQueueIncidents([]);
        return;
      }

      const assignments = (await getTechnicianAssignments(technician.id)).filter(
        (assignment) => !assignment.unassigned_at,
      );
      setTechnicianAssignments(assignments);

      const directIncidentIds = new Set<number>();
      const installationIds = new Set<number>();
      const assetIds = new Set<number>();
      const assignmentByKey = new Map<string, TechnicianAssignment>();

      assignments.forEach((assignment) => {
        const entityType = String(assignment.entity_type || "").trim();
        const entityId = Number.parseInt(String(assignment.entity_id || "").trim(), 10);
        assignmentByKey.set(`${entityType}:${assignment.entity_id}`, assignment);
        if (!Number.isInteger(entityId) || entityId <= 0) return;
        if (entityType === "incident") directIncidentIds.add(entityId);
        if (entityType === "installation") installationIds.add(entityId);
        if (entityType === "asset") assetIds.add(entityId);
      });

      const queueMap = new Map<number, QueueIncident>();
      const rememberIncident = (
        incident: Incident | null | undefined,
        source: QueueIncident["queue_source"],
        sourceLabel: string,
        assignmentRole: string,
      ) => {
        if (!incident?.id) return;
        if (normalizeIncidentStatus(incident.incident_status) === "resolved") return;
        const existing = queueMap.get(incident.id);
        if (!existing || getIncidentSortWeight(incident) < getIncidentSortWeight(existing)) {
          queueMap.set(incident.id, {
            ...incident,
            queue_source: existing?.queue_source || source,
            queue_source_label: existing?.queue_source_label || sourceLabel,
            assignment_role: existing?.assignment_role || assignmentRole || "owner",
          });
        }
      };

      await Promise.all([
        ...Array.from(directIncidentIds).map(async (incidentId) => {
          try {
            const incident = await getIncidentById(incidentId);
            const assignment = assignmentByKey.get(`incident:${incidentId}`);
            rememberIncident(
              incident,
              "incident",
              `Asignada directo · ${assignment?.assignment_role || "owner"}`,
              String(assignment?.assignment_role || "owner"),
            );
          } catch {
            // Best effort: ignore stale direct assignments.
          }
        }),
        ...Array.from(installationIds).map(async (targetInstallationId) => {
          try {
            const response = await listIncidentsByInstallation(targetInstallationId);
            const assignment = assignmentByKey.get(`installation:${targetInstallationId}`);
            response.incidents.forEach((incident) =>
              rememberIncident(
                incident,
                "installation",
                `Caso #${targetInstallationId} · ${assignment?.assignment_role || "owner"}`,
                String(assignment?.assignment_role || "owner"),
              ));
          } catch {
            // Best effort: ignore stale installation assignments.
          }
        }),
        ...Array.from(assetIds).map(async (assetId) => {
          try {
            const response = await getAssetIncidents(assetId, { limit: 80 });
            const assignment = assignmentByKey.get(`asset:${assetId}`);
            response.incidents.forEach((incident) =>
              rememberIncident(
                incident as Incident,
                "asset",
                `${response.asset?.external_code || `Activo #${assetId}`} · ${assignment?.assignment_role || "owner"}`,
                String(assignment?.assignment_role || "owner"),
              ));
          } catch {
            // Best effort: ignore stale asset assignments.
          }
        }),
      ]);

      const nextQueue = sortQueueIncidents(Array.from(queueMap.values()));
      setQueueIncidents(nextQueue);
      if (!routeInstallationId && nextQueue.length > 0) {
        setInstallationId(String(nextQueue[0].installation_id));
      }
    } catch (error) {
      Alert.alert("Mi cola", extractApiError(error));
      setLinkedTechnician(null);
      setTechnicianAssignments([]);
      setQueueIncidents([]);
    } finally {
      setLoadingQueue(false);
    }
  }, [hasActiveSession, routeInstallationId]);

  const loadTrackingLink = useCallback(
    async (targetInstallationId: number, options?: { silent?: boolean }) => {
      if (!hasActiveSession) return;
      if (!Number.isInteger(targetInstallationId) || targetInstallationId <= 0) return;

      try {
        setLoadingTrackingLink(true);
        const link = await getInstallationPublicTrackingLink(targetInstallationId);
        setTrackingLink(link);
      } catch (error) {
        setTrackingLink(null);
        if (options?.silent !== true) {
          Alert.alert("Tracking publico", extractApiError(error));
        }
      } finally {
        setLoadingTrackingLink(false);
      }
    },
    [hasActiveSession],
  );

  const refreshCurrentInstallation = useCallback(async () => {
    const parsedInstallationId = Number.parseInt(installationId, 10);
    if (!Number.isInteger(parsedInstallationId) || parsedInstallationId <= 0) {
      Alert.alert("Dato invalido", "El ID del caso debe ser un numero positivo.");
      return;
    }
    await loadIncidents(parsedInstallationId);
  }, [installationId, loadIncidents]);

  const onSelectInstallation = useCallback(
    async (id: number) => {
      setInstallationId(String(id));
      await loadIncidents(id);
    },
    [loadIncidents],
  );

  const onChangeStatus = useCallback(
    async (incident: Incident, nextStatus: IncidentStatus) => {
      if (normalizeIncidentStatus(incident.incident_status) === nextStatus) return;

      const runChange = async () => {
        try {
          setUpdatingIncidentId(incident.id);
          await updateIncidentStatus(incident.id, {
            incident_status: nextStatus,
            resolution_note:
              nextStatus === "resolved"
                ? String(
                    incident.resolution_note ||
                      incident.evidence_note ||
                      "Resuelta desde Android",
                  ).trim()
                : "",
            reporter_username: incident.reporter_username || "mobile_user",
          });
          await Promise.all([
            refreshCurrentInstallation(),
            loadInstallations({ forceRefresh: true }),
          ]);
        } catch (error) {
          Alert.alert("Error", extractApiError(error));
        } finally {
          setUpdatingIncidentId(null);
        }
      };

      if (nextStatus !== "resolved") {
        await runChange();
        return;
      }

      Alert.alert(
        "Resolver incidencia",
        `Se marcara la incidencia #${incident.id} como resuelta.`,
        [
          { text: "Cancelar", style: "cancel" },
          { text: "Resolver", onPress: () => void runChange() },
        ],
      );
    },
    [loadInstallations, refreshCurrentInstallation],
  );

  useEffect(() => {
    if (!hasActiveSession) {
      setIncidents([]);
      setInstallations([]);
      setLinkedTechnician(null);
      setTechnicianAssignments([]);
      setQueueIncidents([]);
      return;
    }
    void Promise.all([
      loadInstallations(),
      loadTechnicianQueue(),
    ]);
  }, [hasActiveSession, loadInstallations, loadTechnicianQueue]);

  useEffect(() => {
    if (routeInstallationId) {
      setInstallationId(routeInstallationId);
    }
  }, [routeInstallationId]);

  useFocusEffect(
    useCallback(() => {
      if (!hasActiveSession) return;
      const parsedInstallationId = Number.parseInt(installationId, 10);
      void loadTechnicianQueue();
      if (Number.isInteger(parsedInstallationId) && parsedInstallationId > 0) {
        void Promise.all([
          loadIncidents(parsedInstallationId),
          loadTrackingLink(parsedInstallationId, { silent: true }),
        ]);
      }
    }, [hasActiveSession, installationId, loadIncidents, loadTechnicianQueue, loadTrackingLink]),
  );

  useEffect(() => {
    if (!incidents.some((incident) => normalizeIncidentStatus(incident.incident_status) === "in_progress")) {
      return;
    }
    const timerId = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(timerId);
  }, [incidents]);

  const incidentBuckets = useMemo(() => summarizeIncidentBuckets(incidents), [incidents]);
  const currentInstallationRecord = useMemo(() => {
    const parsedId = Number.parseInt(installationId, 10);
    return installations.find((item) => item.id === parsedId) || null;
  }, [installationId, installations]);
  const activeIncidents = useMemo(
    () => incidents.filter((incident) => normalizeIncidentStatus(incident.incident_status) !== "resolved"),
    [incidents],
  );
  const queueBuckets = useMemo(() => summarizeIncidentBuckets(queueIncidents), [queueIncidents]);
  const queueInstallationIds = useMemo(
    () => Array.from(new Set(queueIncidents.map((incident) => incident.installation_id))).sort((left, right) => left - right),
    [queueIncidents],
  );
  const queueTodaySummary = useMemo(() => {
    return {
      assignments: technicianAssignments.length,
      direct: technicianAssignments.filter((item) => item.entity_type === "incident").length,
      installations: technicianAssignments.filter((item) => item.entity_type === "installation").length,
      assets: technicianAssignments.filter((item) => item.entity_type === "asset").length,
      critical: queueIncidents.filter((item) => item.severity === "critical").length,
    };
  }, [queueIncidents, technicianAssignments]);
  const resolvedIncidents = useMemo(
    () => incidents.filter((incident) => normalizeIncidentStatus(incident.incident_status) === "resolved"),
    [incidents],
  );
  const missionIncident = useMemo(() => {
    const priority = new Map<IncidentStatus, number>([
      ["in_progress", 0],
      ["paused", 1],
      ["open", 2],
      ["resolved", 3],
    ]);
    return [...activeIncidents].sort((left, right) => {
      const leftStatus = normalizeIncidentStatus(left.incident_status);
      const rightStatus = normalizeIncidentStatus(right.incident_status);
      const statusDelta = (priority.get(leftStatus) ?? 99) - (priority.get(rightStatus) ?? 99);
      if (statusDelta !== 0) return statusDelta;
      const leftSeverity = left.severity === "critical" ? 0 : left.severity === "high" ? 1 : 2;
      const rightSeverity = right.severity === "critical" ? 0 : right.severity === "high" ? 1 : 2;
      if (leftSeverity !== rightSeverity) return leftSeverity - rightSeverity;
      return new Date(left.created_at || 0).getTime() - new Date(right.created_at || 0).getTime();
    })[0] ?? null;
  }, [activeIncidents]);
  const activeTrackingUrl = trackingLink?.active === true
    ? String(trackingLink?.tracking_url || "").trim()
    : "";

  const handleCreateTrackingLink = useCallback(async () => {
    const parsedInstallationId = Number.parseInt(installationId, 10);
    if (!Number.isInteger(parsedInstallationId) || parsedInstallationId <= 0) return;
    try {
      setTrackingActionBusy(true);
      const link = await createInstallationPublicTrackingLink(parsedInstallationId);
      setTrackingLink(link);
      Alert.alert("Tracking publico", "Enlace publico listo para compartir.");
    } catch (error) {
      Alert.alert("Tracking publico", extractApiError(error));
    } finally {
      setTrackingActionBusy(false);
    }
  }, [installationId]);

  const handleRevokeTrackingLink = useCallback(async () => {
    const parsedInstallationId = Number.parseInt(installationId, 10);
    if (!Number.isInteger(parsedInstallationId) || parsedInstallationId <= 0) return;
    try {
      setTrackingActionBusy(true);
      await deleteInstallationPublicTrackingLink(parsedInstallationId);
      setTrackingLink((current) => current ? {
        ...current,
        active: false,
        status: "revoked",
        tracking_url: null,
      } : null);
      Alert.alert("Tracking publico", "Enlace publico revocado.");
    } catch (error) {
      Alert.alert("Tracking publico", extractApiError(error));
    } finally {
      setTrackingActionBusy(false);
    }
  }, [installationId]);

  const handleOpenTrackingLink = useCallback(async () => {
    if (!activeTrackingUrl) return;
    const supported = await Linking.canOpenURL(activeTrackingUrl);
    if (!supported) {
      Alert.alert("Tracking publico", "No se pudo abrir el enlace en este dispositivo.");
      return;
    }
    await Linking.openURL(activeTrackingUrl);
  }, [activeTrackingUrl]);

  const handleShareTrackingLink = useCallback(async () => {
    if (!activeTrackingUrl) return;
    try {
      await Share.share({
        message: `Seguimiento del servicio: ${activeTrackingUrl}`,
        url: activeTrackingUrl,
      });
    } catch (error) {
      Alert.alert("Tracking publico", extractApiError(error));
    }
  }, [activeTrackingUrl]);

  const renderIncidentCard = useCallback((incident: Incident | QueueIncident, options?: {
    showInstallationTag?: boolean;
    showQueueMeta?: boolean;
    detailButtonLabel?: string;
  }) => {
    const status = normalizeIncidentStatus(incident.incident_status);
    const busy = updatingIncidentId === incident.id;
    const estimated = resolveIncidentEstimatedDurationSeconds(incident);
    const runtime = resolveIncidentRealDurationSeconds(incident, nowMs);
    const queueIncident = incident as QueueIncident;

    const actionButtons: Array<{ key: IncidentStatus; label: string; primary?: boolean }> = [
      { key: "open", label: "Abrir" },
      { key: "in_progress", label: status === "paused" ? "Reanudar" : "En curso" },
      { key: "paused", label: "Pausar" },
      { key: "resolved", label: "Resolver", primary: true },
    ];

    return (
      <View
        key={incident.id}
        style={[
          styles.card,
          { backgroundColor: palette.cardBg, borderColor: palette.cardBorder },
        ]}
      >
        <View style={styles.cardHeader}>
          <View style={styles.badgesRow}>
            <StatusChip value={status} />
            <StatusChip
              kind="attention"
              value={incident.severity === "critical" ? "critical" : "open"}
            />
          </View>
          <Text style={[styles.metaText, { color: palette.textMuted }]}>
            #{incident.id} · {formatDateTime(incident.created_at)}
          </Text>
        </View>

        <Text style={[styles.noteText, { color: palette.textPrimary }]}>
          {incident.note || "Sin detalle operativo."}
        </Text>
        <Text style={[styles.supportingText, { color: palette.textSecondary }]}>
          Usuario: {incident.reporter_username || "-"} · Fotos: {incident.photos?.length ?? 0} ·
          Severidad: {getSeverityLabel(incident.severity)}
        </Text>
        {options?.showInstallationTag ? (
          <Text style={[styles.supportingText, { color: palette.textMuted }]}>
            Caso #{incident.installation_id}
          </Text>
        ) : null}
        {options?.showQueueMeta && queueIncident.queue_source_label ? (
          <Text style={[styles.supportingText, { color: palette.textMuted }]}>
            Cola: {queueIncident.queue_source_label}
          </Text>
        ) : null}
        {incident.evidence_note?.trim() ? (
          <Text style={[styles.supportingText, { color: palette.textSecondary }]}>
            Nota operativa: {incident.evidence_note}
          </Text>
        ) : null}
        {incident.checklist_items?.length ? (
          <Text style={[styles.supportingText, { color: palette.textSecondary }]}>
            Checklist: {incident.checklist_items.slice(0, 3).join(" · ")}
          </Text>
        ) : null}

        <View style={styles.runtimeGrid}>
          <RuntimeChip label="Estado" value={getIncidentStatusLabel(status)} />
          <RuntimeChip label="Estimado" value={formatDuration(estimated)} />
          <RuntimeChip label="Real" value={formatDuration(runtime)} />
        </View>

        <View style={styles.statusRow}>
          {actionButtons.map((action) => {
            const selected = status === action.key;
            return (
              <TouchableOpacity
                key={`${incident.id}-${action.key}`}
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
                  void onChangeStatus(incident, action.key);
                }}
                disabled={busy}
              >
                {busy && action.primary ? (
                  <ActivityIndicator size="small" color={palette.primaryButtonText} />
                ) : (
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
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[
              styles.detailButton,
              { backgroundColor: palette.refreshBg, borderColor: palette.inputBorder },
            ]}
            onPress={() =>
              router.push(
                `/incident/detail?incidentId=${incident.id}&installationId=${incident.installation_id}` as never,
              )
            }
          >
            <Text style={[styles.detailButtonText, { color: palette.refreshText }]}>
              {options?.detailButtonLabel || "Ver detalle"}
            </Text>
          </TouchableOpacity>
          {options?.showInstallationTag ? (
            <TouchableOpacity
              style={[
                styles.detailButton,
                { backgroundColor: palette.secondaryButtonBg, borderColor: palette.inputBorder },
              ]}
              onPress={() => {
                void onSelectInstallation(incident.installation_id);
              }}
            >
              <Text style={[styles.detailButtonText, { color: palette.secondaryButtonText }]}>
                Abrir caso
              </Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={[
              styles.uploadButton,
              { backgroundColor: palette.uploadButtonBg, borderColor: palette.uploadButtonBg },
            ]}
            onPress={() =>
              router.push(
                `/incident/upload?incidentId=${incident.id}&installationId=${incident.installation_id}` as never,
              )
            }
          >
            <Text style={[styles.uploadButtonText, { color: palette.uploadButtonText }]}>
              Subir evidencia
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }, [nowMs, onChangeStatus, onSelectInstallation, palette, router, updatingIncidentId]);

  if (checkingSession) {
    return (
      <ScreenScaffold scroll={false} centered contentContainerStyle={styles.centerContainer}>
        <ActivityIndicator size="large" color={palette.loadingSpinner} />
        <Text style={[styles.authHintText, { color: palette.textSecondary }]}>
          Verificando sesion web...
        </Text>
      </ScreenScaffold>
    );
  }

  if (!hasActiveSession) {
    return (
      <ScreenScaffold scroll={false} centered contentContainerStyle={styles.centerContainer}>
        <WebInlineLoginCard
          hint="Inicia sesion web para ver casos e incidencias."
          onLoginSuccess={async () => {
            await loadInstallations({ forceRefresh: true });
          }}
          onOpenAdvanced={() => router.push("/modal?focus=login")}
        />
      </ScreenScaffold>
    );
  }

  return (
    <ScreenScaffold contentContainerStyle={styles.container}>
      <ScreenHero
        eyebrow={linkedTechnician ? "Mi cola" : "Casos"}
        title={linkedTechnician ? "Trabajo asignado" : "Backlog operativo"}
        description={
          linkedTechnician
            ? "Tus incidencias asignadas primero, con salto rapido al caso y acciones de campo desde el celular."
            : "Seguimiento por caso: prioridad visible, pausa, reanudacion y cierre sin volver al alta."
        }
        aside={
          <View
            style={[
              styles.heroBadge,
              { backgroundColor: palette.heroEyebrowBg, borderColor: palette.heroBorder },
            ]}
          >
            <Text style={[styles.heroBadgeText, { color: palette.heroEyebrowText }]}>
              {linkedTechnician ? linkedTechnician.display_name : `caso #${installationId || "--"}`}
            </Text>
          </View>
        }
      >
        <View style={styles.heroMetaRow}>
          <View
            style={[
              styles.heroMetaChip,
              { backgroundColor: palette.heroEyebrowBg, borderColor: palette.heroBorder },
            ]}
          >
            <Text style={[styles.heroMetaText, { color: palette.heroEyebrowText }]}>
              {linkedTechnician ? queueBuckets.active : incidentBuckets.active} activas
            </Text>
          </View>
          <View
            style={[
              styles.heroMetaChip,
              { backgroundColor: palette.heroEyebrowBg, borderColor: palette.heroBorder },
            ]}
          >
            <Text style={[styles.heroMetaText, { color: palette.heroEyebrowText }]}>
              {linkedTechnician ? queueBuckets.inProgress : incidentBuckets.inProgress} en curso
            </Text>
          </View>
          <View
            style={[
              styles.heroMetaChip,
              { backgroundColor: palette.heroEyebrowBg, borderColor: palette.heroBorder },
            ]}
          >
            <Text style={[styles.heroMetaText, { color: palette.heroEyebrowText }]}>
              {linkedTechnician ? queueBuckets.paused : incidentBuckets.paused} pausadas
            </Text>
          </View>
          {linkedTechnician ? (
            <View
              style={[
                styles.heroMetaChip,
                { backgroundColor: palette.heroEyebrowBg, borderColor: palette.heroBorder },
              ]}
            >
              <Text style={[styles.heroMetaText, { color: palette.heroEyebrowText }]}>
                {queueInstallationIds.length} casos
              </Text>
            </View>
          ) : null}
        </View>
      </ScreenHero>

      <SyncStatusBanner />

      {linkedTechnician ? (
        <SectionCard
          title="Tecnico activo"
          description="La cola se arma con las asignaciones vigentes de tu usuario web."
          aside={
            loadingQueue ? <ActivityIndicator size="small" color={palette.loadingSpinner} /> : undefined
          }
        >
          <View
            style={[
              styles.focusCard,
              { backgroundColor: palette.surfaceAlt, borderColor: palette.border },
            ]}
          >
            <Text style={[styles.focusTitle, { color: palette.textPrimary }]}>
              {linkedTechnician.display_name}
            </Text>
            <Text style={[styles.focusBody, { color: palette.textSecondary }]}>
              {technicianAssignments.length
                ? `${technicianAssignments.length} asignaciones activas entre incidencias, casos y activos.`
                : "Sin asignaciones activas por ahora."}
            </Text>
            <Text style={[styles.supportingText, { color: palette.textMuted }]}>
              {linkedTechnician.employee_code
                ? `Legajo ${linkedTechnician.employee_code} · `
                : ""}
              {queueInstallationIds.length} casos en cola
            </Text>
          </View>
        </SectionCard>
      ) : null}

      {linkedTechnician ? (
        <SectionCard
          title="Asignaciones de hoy"
          description="Resumen rapido de tu carga para entrar por prioridad y tipo de asignacion."
        >
          <View style={styles.todaySummaryGrid}>
            <View style={[styles.todaySummaryCard, { backgroundColor: palette.surfaceAlt, borderColor: palette.border }]}>
              <Text style={[styles.todaySummaryValue, { color: palette.textPrimary }]}>
                {queueTodaySummary.assignments}
              </Text>
              <Text style={[styles.todaySummaryLabel, { color: palette.textSecondary }]}>
                activas
              </Text>
            </View>
            <View style={[styles.todaySummaryCard, { backgroundColor: palette.surfaceAlt, borderColor: palette.border }]}>
              <Text style={[styles.todaySummaryValue, { color: palette.textPrimary }]}>
                {queueTodaySummary.direct}
              </Text>
              <Text style={[styles.todaySummaryLabel, { color: palette.textSecondary }]}>
                directas
              </Text>
            </View>
            <View style={[styles.todaySummaryCard, { backgroundColor: palette.surfaceAlt, borderColor: palette.border }]}>
              <Text style={[styles.todaySummaryValue, { color: palette.textPrimary }]}>
                {queueTodaySummary.installations}
              </Text>
              <Text style={[styles.todaySummaryLabel, { color: palette.textSecondary }]}>
                por caso
              </Text>
            </View>
            <View style={[styles.todaySummaryCard, { backgroundColor: palette.surfaceAlt, borderColor: palette.border }]}>
              <Text style={[styles.todaySummaryValue, { color: palette.textPrimary }]}>
                {queueTodaySummary.assets}
              </Text>
              <Text style={[styles.todaySummaryLabel, { color: palette.textSecondary }]}>
                por activo
              </Text>
            </View>
            <View style={[styles.todaySummaryCard, { backgroundColor: palette.warningBg, borderColor: palette.warningText }]}>
              <Text style={[styles.todaySummaryValue, { color: palette.warningText }]}>
                {queueTodaySummary.critical}
              </Text>
              <Text style={[styles.todaySummaryLabel, { color: palette.warningText }]}>
                criticas
              </Text>
            </View>
          </View>
        </SectionCard>
      ) : null}

      {linkedTechnician ? (
        <>
          <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>
            Mi cola ({queueIncidents.length})
          </Text>
          {loadingQueue ? (
            <View style={styles.queueLoadingRow}>
              <ActivityIndicator size="small" color={palette.loadingSpinner} />
              <Text style={[styles.supportingText, { color: palette.textSecondary }]}>
                Cargando incidencias asignadas...
              </Text>
            </View>
          ) : queueIncidents.length === 0 ? (
            <EmptyStateCard
              title="Tu cola esta vacia."
              body="Cuando te asignen un caso, una incidencia o un activo, va a aparecer primero aqui."
            />
          ) : (
            queueIncidents.map((incident) =>
              renderIncidentCard(incident, {
                showInstallationTag: true,
                showQueueMeta: true,
                detailButtonLabel: "Seguir incidencia",
              }),
            )
          )}
        </>
      ) : null}

      <View style={styles.topActionsRow}>
        <TouchableOpacity
          style={[
            styles.topActionPrimary,
            { backgroundColor: palette.primaryButtonBg, borderColor: palette.primaryButtonBg },
          ]}
          onPress={() => router.push(`/case/context?installationId=${encodeURIComponent(installationId || "1")}` as never)}
        >
          <Text style={[styles.topActionKicker, { color: palette.primaryButtonText }]}>
            Iniciar trabajo
          </Text>
          <Text style={[styles.topActionText, { color: palette.primaryButtonText }]}>
            Resolver contexto
          </Text>
        </TouchableOpacity>
        <View style={styles.utilityColumn}>
          <TouchableOpacity
            style={[
              styles.topActionUtility,
              { backgroundColor: palette.refreshBg, borderColor: palette.inputBorder },
            ]}
            onPress={() => router.push("/qr?mode=scan")}
          >
            <Text style={[styles.utilityLabel, { color: palette.textMuted }]}>Entrada</Text>
            <Text style={[styles.topActionText, { color: palette.refreshText }]}>Escanear QR</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.topActionUtility,
              { backgroundColor: palette.refreshBg, borderColor: palette.inputBorder },
            ]}
            onPress={() => {
              void refreshCurrentInstallation();
            }}
            disabled={loading}
          >
            <Text style={[styles.utilityLabel, { color: palette.textMuted }]}>Estado</Text>
            {loading ? (
              <ActivityIndicator size="small" color={palette.refreshText} />
            ) : (
              <Text style={[styles.topActionText, { color: palette.refreshText }]}>Refrescar</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>

      <SectionCard
        title="Mision activa"
        description={
          missionIncident
            ? "Un unico foco visible para decidir rapido si hay que empezar, retomar o cerrar."
            : "No hay una incidencia dominante para este caso. Abre otro caso o crea una incidencia nueva."
        }
        aside={
          currentInstallationRecord ? (
            <View
              style={[
                styles.missionBadge,
                {
                  backgroundColor: palette.heroEyebrowBg,
                  borderColor: palette.heroBorder,
                },
              ]}
            >
              <Text style={[styles.missionBadgeText, { color: palette.heroEyebrowText }]}>
                {getRecordAttentionStateLabel(currentInstallationRecord.attention_state)}
              </Text>
            </View>
          ) : null
        }
      >
        {missionIncident ? (
          <View
            style={[
              styles.missionPanel,
              {
                backgroundColor: palette.heroBg,
                borderColor: palette.heroBorder,
                shadowColor: palette.shadowColor,
              },
            ]}
          >
            <View style={styles.missionHeader}>
              <View style={styles.missionHeaderText}>
                <Text style={[styles.missionEyebrow, { color: palette.heroEyebrowText }]}>
                  Caso #{missionIncident.installation_id}
                </Text>
                <Text style={[styles.missionTitle, { color: palette.textPrimary }]}>
                  {missionIncident.note || "Incidencia sin detalle operativo."}
                </Text>
              </View>
              <StatusChip value={missionIncident.incident_status} />
            </View>
            <Text style={[styles.missionSupport, { color: palette.textSecondary }]}>
              #{missionIncident.id} · {getSeverityLabel(missionIncident.severity)} · fotos{" "}
              {missionIncident.photos?.length ?? 0} · {missionIncident.reporter_username || "-"}
            </Text>
            <View style={styles.runtimeGrid}>
              <RuntimeChip
                label="Real"
                value={formatDuration(resolveIncidentRealDurationSeconds(missionIncident, nowMs))}
              />
              <RuntimeChip
                label="Estimado"
                value={formatDuration(resolveIncidentEstimatedDurationSeconds(missionIncident))}
              />
              <RuntimeChip
                label="Estado"
                value={getIncidentStatusLabel(normalizeIncidentStatus(missionIncident.incident_status))}
              />
            </View>
            <View style={styles.missionActionsRow}>
              <TouchableOpacity
                style={[
                  styles.missionPrimaryAction,
                  { backgroundColor: palette.primaryButtonBg, borderColor: palette.primaryButtonBg },
                ]}
                onPress={() => {
                  const status = normalizeIncidentStatus(missionIncident.incident_status);
                  if (status === "in_progress") {
                    router.push(
                      `/incident/detail?incidentId=${missionIncident.id}&installationId=${missionIncident.installation_id}` as never,
                    );
                    return;
                  }
                  void onChangeStatus(
                    missionIncident,
                    status === "paused" ? "in_progress" : "in_progress",
                  );
                }}
              >
                <Text style={[styles.missionPrimaryText, { color: palette.primaryButtonText }]}>
                  {normalizeIncidentStatus(missionIncident.incident_status) === "in_progress"
                    ? "Abrir seguimiento"
                    : normalizeIncidentStatus(missionIncident.incident_status) === "paused"
                      ? "Reanudar ahora"
                      : "Empezar ahora"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.missionSecondaryAction,
                  { backgroundColor: palette.refreshBg, borderColor: palette.inputBorder },
                ]}
                onPress={() =>
                  router.push(
                    `/incident/detail?incidentId=${missionIncident.id}&installationId=${missionIncident.installation_id}` as never,
                  )
                }
              >
                <Text style={[styles.missionSecondaryText, { color: palette.refreshText }]}>
                  Ver detalle
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <EmptyStateCard
            title="Sin mision en curso."
            body="Escanea un QR, abre otro caso o crea una incidencia nueva para fijar un foco operativo claro."
          />
        )}
      </SectionCard>



      {activeIncidents.length === 0 && currentInstallationRecord ? (
        <SectionCard
          title="Cierre operativo"
          description="No quedan incidencias activas en este caso. Ya puedes emitir la conformidad final."
        >
          <View
            style={[
              styles.focusCard,
              { backgroundColor: palette.heroBg, borderColor: palette.heroBorder },
            ]}
          >
            <Text style={[styles.focusTitle, { color: palette.textPrimary }]}>
              Caso #{currentInstallationRecord.id} listo para conformidad
            </Text>
            <Text style={[styles.focusBody, { color: palette.textSecondary }]}>
              Captura la firma del cliente y envia el PDF final por email desde este mismo flujo.
            </Text>
            <TouchableOpacity
              style={[styles.primaryAction, { backgroundColor: palette.primaryButtonBg }]}
              onPress={() =>
                router.push(`/case/conformity?installationId=${currentInstallationRecord.id}` as never)
              }
              accessibilityRole="button"
              accessibilityLabel={`Abrir conformidad final del caso ${currentInstallationRecord.id}`}
            >
              <Text style={[styles.primaryActionText, { color: palette.primaryButtonText }]}>
                Abrir conformidad final
              </Text>
            </TouchableOpacity>
          </View>
        </SectionCard>
      ) : null}

      {currentInstallationRecord ? (
        <SectionCard
          title="Tracking publico"
          description="Genera un enlace de solo lectura para compartir el estado del caso."
          aside={
            loadingTrackingLink ? (
              <ActivityIndicator size="small" color={palette.loadingSpinner} />
            ) : trackingLink?.active ? (
              <View
                style={[
                  styles.missionBadge,
                  { backgroundColor: palette.heroEyebrowBg, borderColor: palette.heroBorder },
                ]}
              >
                <Text style={[styles.missionBadgeText, { color: palette.heroEyebrowText }]}>
                  activo
                </Text>
              </View>
            ) : undefined
          }
        >
          <View
            style={[
              styles.focusCard,
              { backgroundColor: palette.surfaceAlt, borderColor: palette.border },
            ]}
          >
            <Text style={[styles.focusTitle, { color: palette.textPrimary }]}>
              {trackingLink?.active ? "Enlace listo para compartir" : "Sin enlace publico activo"}
            </Text>
            <Text style={[styles.focusBody, { color: palette.textSecondary }]}>
              {trackingLink?.active
                ? trackingLink.snapshot?.summary_text || "El cliente puede seguir el estado actual del caso con este enlace."
                : "Solo admin o platform_owner puede generar el Magic Link publico desde mobile."}
            </Text>
            {trackingLink?.active && activeTrackingUrl ? (
              <Text style={[styles.supportingText, { color: palette.textMuted }]}>
                {activeTrackingUrl}
              </Text>
            ) : null}
            {trackingLink?.active && trackingLink.expires_at ? (
              <Text style={[styles.supportingText, { color: palette.textMuted }]}>
                Expira: {formatDateTime(trackingLink.expires_at)}
              </Text>
            ) : null}
            <View style={styles.contextActionRow}>
              <TouchableOpacity
                style={[
                  styles.primaryAction,
                  { backgroundColor: palette.primaryButtonBg },
                  trackingActionBusy && styles.buttonDisabled,
                ]}
                onPress={() => {
                  void handleCreateTrackingLink();
                }}
                disabled={trackingActionBusy}
                accessibilityRole="button"
                accessibilityLabel={`Crear o regenerar enlace publico del caso ${currentInstallationRecord.id}`}
              >
                {trackingActionBusy ? (
                  <ActivityIndicator color={palette.primaryButtonText} />
                ) : (
                  <Text style={[styles.primaryActionText, { color: palette.primaryButtonText }]}>
                    {trackingLink?.active ? "Regenerar enlace" : "Crear enlace"}
                  </Text>
                )}
              </TouchableOpacity>
              {trackingLink?.active && activeTrackingUrl ? (
                <TouchableOpacity
                  style={[
                    styles.secondaryButton,
                    { backgroundColor: palette.secondaryButtonBg, borderColor: palette.inputBorder },
                  ]}
                  onPress={() => {
                    void handleShareTrackingLink();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Compartir enlace publico del caso ${currentInstallationRecord.id}`}
                >
                  <Text style={[styles.secondaryButtonText, { color: palette.secondaryButtonText }]}>
                    Compartir
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
            {trackingLink?.active && activeTrackingUrl ? (
              <View style={styles.contextActionRow}>
                <TouchableOpacity
                  style={[
                    styles.ghostButton,
                    { backgroundColor: palette.refreshBg, borderColor: palette.inputBorder },
                  ]}
                  onPress={() => {
                    void handleOpenTrackingLink();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Abrir tracking publico del caso ${currentInstallationRecord.id}`}
                >
                  <Text style={[styles.ghostButtonText, { color: palette.refreshText }]}>
                    Abrir seguimiento
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.ghostButton,
                    { backgroundColor: palette.warningBg, borderColor: palette.warningText },
                    trackingActionBusy && styles.buttonDisabled,
                  ]}
                  onPress={() => {
                    void handleRevokeTrackingLink();
                  }}
                  disabled={trackingActionBusy}
                  accessibilityRole="button"
                  accessibilityLabel={`Revocar enlace publico del caso ${currentInstallationRecord.id}`}
                >
                  <Text style={[styles.ghostButtonText, { color: palette.warningText }]}>
                    Revocar enlace
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        </SectionCard>
      ) : null}

      <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>
        Cola del caso ({activeIncidents.length})
      </Text>
      {activeIncidents.length === 0 ? (
        <EmptyStateCard
          title="Sin incidencias activas."
          body="Este caso no tiene incidencias abiertas, en curso o pausadas."
        />
      ) : (
        activeIncidents.map((incident) => {
          const status = normalizeIncidentStatus(incident.incident_status);
          const busy = updatingIncidentId === incident.id;
          const estimated = resolveIncidentEstimatedDurationSeconds(incident);
          const runtime = resolveIncidentRealDurationSeconds(incident, nowMs);

          const actionButtons: Array<{ key: IncidentStatus; label: string; primary?: boolean }> = [
            { key: "open", label: "Abrir" },
            { key: "in_progress", label: status === "paused" ? "Reanudar" : "En curso" },
            { key: "paused", label: "Pausar" },
            { key: "resolved", label: "Resolver", primary: true },
          ];

          return (
            <View
              key={incident.id}
              style={[
                styles.card,
                { backgroundColor: palette.cardBg, borderColor: palette.cardBorder },
              ]}
            >
              <View style={styles.cardHeader}>
                <View style={styles.badgesRow}>
                  <StatusChip value={status} />
                  <StatusChip
                    kind="attention"
                    value={incident.severity === "critical" ? "critical" : "open"}
                  />
                </View>
                <Text style={[styles.metaText, { color: palette.textMuted }]}>
                  #{incident.id} · {formatDateTime(incident.created_at)}
                </Text>
              </View>

              <Text style={[styles.noteText, { color: palette.textPrimary }]}>
                {incident.note || "Sin detalle operativo."}
              </Text>
              <Text style={[styles.supportingText, { color: palette.textSecondary }]}>
                Usuario: {incident.reporter_username || "-"} · Fotos: {incident.photos?.length ?? 0} ·
                Severidad: {getSeverityLabel(incident.severity)}
              </Text>
              {incident.evidence_note?.trim() ? (
                <Text style={[styles.supportingText, { color: palette.textSecondary }]}>
                  Nota operativa: {incident.evidence_note}
                </Text>
              ) : null}
              {incident.checklist_items?.length ? (
                <Text style={[styles.supportingText, { color: palette.textSecondary }]}>
                  Checklist: {incident.checklist_items.slice(0, 3).join(" · ")}
                </Text>
              ) : null}

              <View style={styles.runtimeGrid}>
                <RuntimeChip label="Estado" value={getIncidentStatusLabel(status)} />
                <RuntimeChip label="Estimado" value={formatDuration(estimated)} />
                <RuntimeChip label="Real" value={formatDuration(runtime)} />
              </View>

              <View style={styles.statusRow}>
                {actionButtons.map((action) => {
                  const selected = status === action.key;
                  return (
                    <TouchableOpacity
                      key={`${incident.id}-${action.key}`}
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
                        void onChangeStatus(incident, action.key);
                      }}
                      disabled={busy}
                    >
                      {busy && action.primary ? (
                        <ActivityIndicator size="small" color={palette.primaryButtonText} />
                      ) : (
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
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={[
                    styles.detailButton,
                    { backgroundColor: palette.refreshBg, borderColor: palette.inputBorder },
                  ]}
                  onPress={() =>
                    router.push(
                      `/incident/detail?incidentId=${incident.id}&installationId=${incident.installation_id}` as never,
                    )
                  }
                >
                  <Text style={[styles.detailButtonText, { color: palette.refreshText }]}>
                    Ver detalle
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.uploadButton,
                    { backgroundColor: palette.uploadButtonBg, borderColor: palette.uploadButtonBg },
                  ]}
                  onPress={() =>
                    router.push(
                      `/incident/upload?incidentId=${incident.id}&installationId=${incident.installation_id}` as never,
                    )
                  }
                >
                  <Text style={[styles.uploadButtonText, { color: palette.uploadButtonText }]}>
                    Subir evidencia
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })
      )}


    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  centerContainer: {
    flex: 1,
    padding: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  container: {
    padding: 20,
    gap: 14,
  },
  authHintText: {
    fontSize: 13,
    fontFamily: fontFamilies.regular,
  },
  heroBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  heroBadgeText: {
    fontFamily: fontFamilies.mono,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  heroMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  heroMetaChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  heroMetaText: {
    fontFamily: fontFamilies.mono,
    fontSize: 11.5,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  topActionsRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 10,
  },
  topActionPrimary: {
    flex: 1.35,
    minHeight: MIN_TOUCH_TARGET_SIZE * 2.05,
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  topActionKicker: {
    fontFamily: fontFamilies.mono,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  utilityColumn: {
    flex: 1,
    gap: 10,
  },
  topActionUtility: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  topActionText: {
    fontFamily: fontFamilies.bold,
    fontSize: 14,
    letterSpacing: -0.1,
  },
  focusCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    gap: 12,
  },
  focusTitle: {
    fontFamily: fontFamilies.bold,
    fontSize: 19,
    lineHeight: 24,
    letterSpacing: -0.3,
  },
  focusBody: {
    fontFamily: fontFamilies.regular,
    fontSize: 13.5,
    lineHeight: 19,
  },
  primaryAction: {
    minHeight: MIN_TOUCH_TARGET_SIZE,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 13,
  },
  primaryActionText: {
    fontFamily: fontFamilies.bold,
    fontSize: 14.5,
  },
  contextActionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  secondaryButton: {
    minHeight: MIN_TOUCH_TARGET_SIZE,
    borderWidth: 1,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  secondaryButtonText: {
    fontFamily: fontFamilies.mono,
    fontSize: 12,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  ghostButton: {
    minHeight: MIN_TOUCH_TARGET_SIZE,
    borderWidth: 1,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  ghostButtonText: {
    fontFamily: fontFamilies.mono,
    fontSize: 12,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  buttonDisabled: {
    opacity: 0.72,
  },
  utilityLabel: {
    fontFamily: fontFamilies.mono,
    fontSize: 11,
    marginBottom: 2,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  missionBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minHeight: 30,
    alignSelf: "flex-start",
    justifyContent: "center",
  },
  missionBadgeText: {
    fontFamily: fontFamilies.mono,
    fontSize: 11,
    lineHeight: 13,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  missionPanel: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    gap: 12,
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 12 },
    elevation: 6,
  },
  missionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  missionHeaderText: {
    flex: 1,
    gap: 4,
  },
  missionEyebrow: {
    fontFamily: fontFamilies.mono,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  missionTitle: {
    fontFamily: fontFamilies.bold,
    fontSize: 17,
    lineHeight: 23,
    letterSpacing: -0.2,
  },
  missionSupport: {
    fontFamily: fontFamilies.regular,
    fontSize: 12.5,
    lineHeight: 18,
  },
  missionActionsRow: {
    flexDirection: "row",
    gap: 10,
  },
  missionPrimaryAction: {
    flex: 1.2,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  missionPrimaryText: {
    fontFamily: fontFamilies.bold,
    fontSize: 14,
  },
  missionSecondaryAction: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  missionSecondaryText: {
    fontFamily: fontFamilies.bold,
    fontSize: 13,
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  label: {
    fontSize: 12,
    fontFamily: fontFamilies.mono,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  chipsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  chipText: {
    fontSize: 11.5,
    fontFamily: fontFamilies.mono,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  refreshButton: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    paddingHorizontal: 12,
    paddingVertical: 8,
    justifyContent: "center",
  },
  refreshButtonText: {
    fontFamily: fontFamilies.mono,
    fontSize: 11.5,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  runtimeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  queueLoadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 56,
  },
  todaySummaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  todaySummaryCard: {
    minWidth: 110,
    flexGrow: 1,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 4,
  },
  todaySummaryValue: {
    fontFamily: fontFamilies.bold,
    fontSize: 22,
    lineHeight: 26,
  },
  todaySummaryLabel: {
    fontFamily: fontFamilies.mono,
    fontSize: 11.5,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: fontFamilies.bold,
    marginTop: 2,
    letterSpacing: -0.2,
  },
  card: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    gap: 10,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  badgesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    flex: 1,
  },
  metaText: {
    fontSize: 12,
    fontFamily: fontFamilies.mono,
    textAlign: "right",
    flexShrink: 1,
  },
  noteText: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fontFamilies.semibold,
  },
  supportingText: {
    fontSize: 12.5,
    lineHeight: 18,
    fontFamily: fontFamilies.regular,
  },
  statusRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  statusButton: {
    flexBasis: "47%",
    flexGrow: 1,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  statusButtonText: {
    fontSize: 12,
    fontFamily: fontFamilies.mono,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  actionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  detailButton: {
    alignSelf: "flex-start",
    borderRadius: 12,
    borderWidth: 1,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    paddingHorizontal: 12,
    paddingVertical: 10,
    justifyContent: "center",
  },
  detailButtonText: {
    fontFamily: fontFamilies.mono,
    fontSize: 12,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  uploadButton: {
    alignSelf: "flex-start",
    borderRadius: 12,
    borderWidth: 1,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    paddingHorizontal: 12,
    paddingVertical: 10,
    justifyContent: "center",
  },
  uploadButtonText: {
    fontFamily: fontFamilies.mono,
    fontSize: 12,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  emptyText: {
    fontSize: 12.5,
    fontFamily: fontFamilies.regular,
  },
});
