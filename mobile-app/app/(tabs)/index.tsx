import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  Animated,
  PanResponder,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { extractApiError } from "@/src/api/client";
import { updateIncidentStatus } from "@/src/api/incidents";
import {
  getCurrentLinkedTechnicianContext,
  getLastAssignedIncidentsMapSource,
  getLastLinkedTechnicianContextSource,
  listAssignedIncidentsMap,
} from "@/src/api/technicians";
import ConsoleButton from "@/src/components/ConsoleButton";
import EmptyStateCard from "@/src/components/EmptyStateCard";
import InlineFeedback, { type InlineFeedbackTone } from "@/src/components/InlineFeedback";
import ScreenHero from "@/src/components/ScreenHero";
import ScreenScaffold from "@/src/components/ScreenScaffold";
import SectionCard from "@/src/components/SectionCard";
import StatusChip from "@/src/components/StatusChip";
import SyncStatusBanner from "@/src/components/SyncStatusBanner";
import WebInlineLoginCard from "@/src/components/WebInlineLoginCard";
import { useSharedWebSessionState } from "@/src/session/web-session-store";
import {
  triggerSelectionHaptic,
  triggerSuccessHaptic,
  triggerWarningHaptic,
} from "@/src/services/haptics";
import { radii, spacing } from "@/src/theme/layout";
import { type AppPalette, useAppPalette } from "@/src/theme/palette";
import { fontFamilies, typeScale } from "@/src/theme/typography";
import { type AssignedIncidentMapItem, type IncidentStatus, type TechnicianRecord } from "@/src/types/api";
import { getIncidentStatusLabel, getSeverityLabel, normalizeIncidentStatus } from "@/src/utils/incidents";

type FeedbackState = {
  tone: InlineFeedbackTone;
  message: string;
} | null;

const SWIPE_STATUS_ORDER: IncidentStatus[] = ["open", "in_progress", "paused", "resolved"];

function getQueueSortWeight(incident: AssignedIncidentMapItem): number {
  const status = normalizeIncidentStatus(incident.incident_status);
  const statusWeight =
    status === "in_progress" ? 0 : status === "paused" ? 1 : status === "open" ? 2 : 3;
  const severity = String(incident.severity || "").trim().toLowerCase();
  const severityWeight =
    severity === "critical" ? 0 : severity === "high" ? 1 : severity === "medium" ? 2 : 3;
  const createdAtWeight = new Date(incident.created_at || 0).getTime();
  return statusWeight * 1_000_000_000 + severityWeight * 1_000_000 + createdAtWeight;
}

function sortQueueIncidents(incidents: AssignedIncidentMapItem[]): AssignedIncidentMapItem[] {
  return [...incidents].sort((left, right) => getQueueSortWeight(left) - getQueueSortWeight(right));
}

function formatIncidentAge(createdAt: string, nowMs: number): string {
  const createdMs = new Date(createdAt || 0).getTime();
  if (!Number.isFinite(createdMs) || createdMs <= 0) return "Sin hora";
  const deltaSeconds = Math.max(0, Math.round((nowMs - createdMs) / 1000));
  if (deltaSeconds < 60) return "Ahora";
  if (deltaSeconds < 3600) return `Hace ${Math.floor(deltaSeconds / 60)} min`;
  if (deltaSeconds < 86_400) return `Hace ${Math.floor(deltaSeconds / 3600)} h`;
  return `Hace ${Math.floor(deltaSeconds / 86_400)} d`;
}

function buildPrimaryActionLabel(status: IncidentStatus): string {
  if (status === "in_progress") return "Abrir seguimiento";
  if (status === "paused") return "Reanudar";
  return "Tomar ahora";
}

function buildSwipeTargetStatus(status: IncidentStatus, deltaX: number): IncidentStatus | null {
  const index = SWIPE_STATUS_ORDER.indexOf(status);
  if (index < 0) return null;
  if (deltaX <= -72) {
    return SWIPE_STATUS_ORDER[Math.min(index + 1, SWIPE_STATUS_ORDER.length - 1)] ?? null;
  }
  if (deltaX >= 72) {
    return SWIPE_STATUS_ORDER[Math.max(index - 1, 0)] ?? null;
  }
  return null;
}

function buildSwipeHint(status: IncidentStatus): { left: string; right: string } {
  const index = SWIPE_STATUS_ORDER.indexOf(status);
  const next = SWIPE_STATUS_ORDER[Math.min(index + 1, SWIPE_STATUS_ORDER.length - 1)] ?? status;
  const prev = SWIPE_STATUS_ORDER[Math.max(index - 1, 0)] ?? status;
  return {
    left: next === status ? "Sin siguiente" : `Izq: ${getIncidentStatusLabel(next)}`,
    right: prev === status ? "Sin anterior" : `Der: ${getIncidentStatusLabel(prev)}`,
  };
}

type QueueCardProps = {
  incident: AssignedIncidentMapItem;
  index: number;
  nowMs: number;
  busy: boolean;
  palette: AppPalette;
  onOpenPrimaryAction: (incident: AssignedIncidentMapItem) => void;
  onOpenDetail: (incident: AssignedIncidentMapItem) => void;
  onChangeStatus: (incident: AssignedIncidentMapItem, nextStatus: IncidentStatus) => void;
};

function QueueIncidentCard(props: QueueCardProps) {
  const {
    incident,
    index,
    nowMs,
    busy,
    palette,
    onOpenPrimaryAction,
    onOpenDetail,
    onChangeStatus,
  } = props;
  const status = normalizeIncidentStatus(incident.incident_status);
  const translateX = useRef(new Animated.Value(0)).current;
  const swipeHint = useMemo(() => buildSwipeHint(status), [status]);

  const resetPosition = useCallback(() => {
    Animated.spring(translateX, {
      toValue: 0,
      useNativeDriver: true,
      bounciness: 6,
      speed: 18,
    }).start();
  }, [translateX]);

  const panResponder = useMemo(
    () => PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        if (busy) return false;
        return Math.abs(gestureState.dx) > 12 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy);
      },
      onPanResponderMove: (_, gestureState) => {
        const clamped = Math.max(-88, Math.min(88, gestureState.dx));
        translateX.setValue(clamped);
      },
      onPanResponderRelease: (_, gestureState) => {
        const targetStatus = buildSwipeTargetStatus(status, gestureState.dx);
        if (targetStatus && targetStatus !== status) {
          onChangeStatus(incident, targetStatus);
        }
        resetPosition();
      },
      onPanResponderTerminate: () => {
        resetPosition();
      },
    }),
    [busy, incident, onChangeStatus, resetPosition, status, translateX],
  );

  return (
    <View
      style={[
        styles.swipeContainer,
        {
          backgroundColor: palette.surfaceAlt,
          borderColor: palette.border,
        },
      ]}
    >
      <View style={styles.swipeHintRow}>
        <Text style={[styles.swipeHintText, { color: palette.textMuted }]}>{swipeHint.right}</Text>
        <Text style={[styles.swipeHintText, { color: palette.textMuted }]}>{swipeHint.left}</Text>
      </View>

      <Animated.View
        style={[
          styles.incidentCard,
          {
            backgroundColor: palette.cardBg,
            borderColor: palette.cardBorder,
            transform: [{ translateX }],
          },
        ]}
        {...panResponder.panHandlers}
      >
        <View style={styles.incidentHeader}>
          <View style={styles.incidentHeaderTextWrap}>
            <Text style={[styles.incidentTitle, { color: palette.textPrimary }]}>
              #{index + 1} · Incidencia {incident.id}
            </Text>
            <Text style={[styles.incidentSubtitle, { color: palette.textSecondary }]}>
              Caso #{incident.installation_id} · {incident.installation_client_name || "Sin cliente"}
            </Text>
          </View>
          <StatusChip value={incident.incident_status} />
        </View>

        <View style={styles.metaRow}>
          <Text style={[styles.metaText, { color: palette.textMuted }]}>{getSeverityLabel(incident.severity)}</Text>
          <Text style={[styles.metaText, { color: palette.textMuted }]}>{formatIncidentAge(incident.created_at, nowMs)}</Text>
          <Text style={[styles.metaText, { color: palette.textMuted }]}>{incident.assignment_role || "owner"}</Text>
        </View>

        <Text style={[styles.incidentNote, { color: palette.textSecondary }]} numberOfLines={3}>
          {incident.note || "Sin nota registrada."}
        </Text>

        <View style={styles.primaryActionRow}>
          <ConsoleButton
            variant="primary"
            style={styles.primaryActionButton}
            onPress={() => {
              void triggerSelectionHaptic();
              onOpenPrimaryAction(incident);
            }}
            disabled={busy}
            loading={busy}
            label={buildPrimaryActionLabel(status)}
            textStyle={styles.primaryActionText}
          />
          <ConsoleButton
            variant="subtle"
            style={styles.secondaryActionButton}
            onPress={() => {
              void triggerSelectionHaptic();
              onOpenDetail(incident);
            }}
            label="Detalle"
            textStyle={styles.secondaryActionText}
          />
        </View>

        <View style={styles.statusRail}>
          <ConsoleButton
            variant={status === "in_progress" ? "primary" : "ghost"}
            style={styles.statusRailButton}
            onPress={() => {
              onChangeStatus(incident, "in_progress");
            }}
            disabled={busy || status === "in_progress"}
            label="En curso"
            textStyle={styles.statusRailText}
          />
          <ConsoleButton
            variant={status === "paused" ? "primary" : "ghost"}
            style={styles.statusRailButton}
            onPress={() => {
              onChangeStatus(incident, "paused");
            }}
            disabled={busy || status === "paused"}
            label="Pausar"
            textStyle={styles.statusRailText}
          />
          <ConsoleButton
            variant={status === "resolved" ? "primary" : "warning"}
            style={styles.statusRailButton}
            onPress={() => {
              if (status === "resolved") return;
              Alert.alert(
                "Resolver incidencia",
                `Se marcara la incidencia #${incident.id} como resuelta.`,
                [
                  { text: "Cancelar", style: "cancel" },
                  {
                    text: "Resolver",
                    onPress: () => {
                      onChangeStatus(incident, "resolved");
                    },
                  },
                ],
              );
            }}
            disabled={busy || status === "resolved"}
            label={status === "resolved" ? "Resuelta" : "Resolver"}
            textStyle={styles.statusRailText}
          />
        </View>

        <Text style={[styles.statusHint, { color: palette.textMuted }]}>
          Estado actual: {getIncidentStatusLabel(status)}
        </Text>
      </Animated.View>
    </View>
  );
}

export default function FieldQueueScreen() {
  const palette = useAppPalette();
  const router = useRouter();
  const { checkingSession, hasActiveSession } = useSharedWebSessionState();
  const [linkedTechnician, setLinkedTechnician] = useState<TechnicianRecord | null>(null);
  const [queueIncidents, setQueueIncidents] = useState<AssignedIncidentMapItem[]>([]);
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [updatingIncidentId, setUpdatingIncidentId] = useState<number | null>(null);
  const [usingOfflineQueueSnapshot, setUsingOfflineQueueSnapshot] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<FeedbackState>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((tone: InlineFeedbackTone, message: string) => {
    setFeedbackMessage({ tone, message });
    if (feedbackTimeoutRef.current) {
      clearTimeout(feedbackTimeoutRef.current);
    }
    feedbackTimeoutRef.current = setTimeout(() => {
      setFeedbackMessage(null);
      feedbackTimeoutRef.current = null;
    }, 5200);
  }, []);

  const loadQueue = useCallback(async (options?: { silent?: boolean }) => {
    if (!hasActiveSession) return;
    try {
      setLoadingQueue(true);
      const [queueResponse, linkedContext] = await Promise.all([
        listAssignedIncidentsMap(),
        getCurrentLinkedTechnicianContext().catch(() => ({ user: null as never, technician: null })),
      ]);
      setQueueIncidents(sortQueueIncidents(queueResponse.incidents || []));
      setLinkedTechnician(queueResponse.technician || linkedContext.technician || null);
      setUsingOfflineQueueSnapshot(
        getLastAssignedIncidentsMapSource() === "cache" ||
          getLastLinkedTechnicianContextSource() === "cache",
      );
    } catch (error) {
      if (!options?.silent) {
        notify("error", `No se pudo cargar mi cola: ${extractApiError(error)}`);
      }
    } finally {
      setLoadingQueue(false);
    }
  }, [hasActiveSession, notify]);

  useFocusEffect(
    useCallback(() => {
      if (!hasActiveSession) return;
      void loadQueue({ silent: true });
    }, [hasActiveSession, loadQueue]),
  );

  useEffect(() => {
    if (!hasActiveSession) {
      setQueueIncidents([]);
      setLinkedTechnician(null);
      setFeedbackMessage(null);
      setUsingOfflineQueueSnapshot(false);
      return;
    }
    void loadQueue();
  }, [hasActiveSession, loadQueue]);

  useEffect(() => {
    if (!queueIncidents.some((incident) => normalizeIncidentStatus(incident.incident_status) === "in_progress")) {
      return;
    }
    const timerId = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(timerId);
  }, [queueIncidents]);

  useEffect(() => {
    return () => {
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current);
      }
    };
  }, []);

  const queueSummary = useMemo(() => {
    const active = queueIncidents.filter((incident) => normalizeIncidentStatus(incident.incident_status) !== "resolved");
    return {
      total: active.length,
      critical: active.filter((incident) => String(incident.severity || "").trim().toLowerCase() === "critical").length,
      inProgress: active.filter((incident) => normalizeIncidentStatus(incident.incident_status) === "in_progress").length,
      paused: active.filter((incident) => normalizeIncidentStatus(incident.incident_status) === "paused").length,
    };
  }, [queueIncidents]);

  const onChangeStatus = useCallback(async (incident: AssignedIncidentMapItem, nextStatus: IncidentStatus) => {
    const currentStatus = normalizeIncidentStatus(incident.incident_status);
    if (currentStatus === nextStatus) return;

    try {
      setUpdatingIncidentId(incident.id);
      await updateIncidentStatus(incident.id, {
        incident_status: nextStatus,
        reporter_username: "mobile_user",
        resolution_note: nextStatus === "resolved" ? "Resuelta desde mi cola mobile" : "",
      });
      await loadQueue({ silent: true });
      void triggerSuccessHaptic();
    } catch (error) {
      void triggerWarningHaptic();
      notify("error", `No se pudo cambiar estado: ${extractApiError(error)}`);
    } finally {
      setUpdatingIncidentId(null);
    }
  }, [loadQueue, notify]);

  const onOpenPrimaryAction = useCallback((incident: AssignedIncidentMapItem) => {
    const status = normalizeIncidentStatus(incident.incident_status);
    if (status === "in_progress") {
      router.push(`/incident/detail?incidentId=${incident.id}&installationId=${incident.installation_id}` as never);
      return;
    }

    void onChangeStatus(incident, "in_progress");
  }, [onChangeStatus, router]);

  if (checkingSession) {
    return (
      <ScreenScaffold scroll={false} centered contentContainerStyle={styles.centerContainer}>
        <ActivityIndicator size="large" color={palette.loadingSpinner} />
        <Text style={[styles.authHintText, { color: palette.textSecondary }]}>Preparando tu cola de campo...</Text>
      </ScreenScaffold>
    );
  }

  if (!hasActiveSession) {
    return (
      <ScreenScaffold scroll={false} centered contentContainerStyle={styles.centerContainer}>
        <WebInlineLoginCard
          hint="Inicia sesion web para cargar incidencias asignadas y actuar desde mobile."
          onLoginSuccess={async () => {
            await loadQueue();
          }}
          onOpenAdvanced={() => router.push("/modal?focus=login")}
        />
      </ScreenScaffold>
    );
  }

  return (
    <ScreenScaffold contentContainerStyle={styles.container}>
      <ScreenHero
        eyebrow="Mi cola"
        title="Operacion en campo"
        description="Prioriza incidencias asignadas. Desliza para cambiar estado o usa accion primaria."
      >
        <View style={styles.heroMetaRow}>
          <View style={[styles.heroMetaChip, { backgroundColor: palette.heroEyebrowBg, borderColor: palette.heroBorder }]}>
            <Text style={[styles.heroMetaText, { color: palette.heroEyebrowText }]}>{queueSummary.total} activas</Text>
          </View>
          <View style={[styles.heroMetaChip, { backgroundColor: palette.heroEyebrowBg, borderColor: palette.heroBorder }]}>
            <Text style={[styles.heroMetaText, { color: palette.heroEyebrowText }]}>{queueSummary.critical} criticas</Text>
          </View>
          <View style={[styles.heroMetaChip, { backgroundColor: palette.heroEyebrowBg, borderColor: palette.heroBorder }]}>
            <Text style={[styles.heroMetaText, { color: palette.heroEyebrowText }]}>{queueSummary.inProgress} en curso</Text>
          </View>
        </View>
      </ScreenHero>

      {feedbackMessage ? <InlineFeedback message={feedbackMessage.message} tone={feedbackMessage.tone} /> : null}

      {usingOfflineQueueSnapshot ? (
        <InlineFeedback
          tone="warning"
          message="Mostrando snapshot local. Se actualiza en cuanto vuelve conectividad."
        />
      ) : null}

      <SyncStatusBanner />

      <SectionCard
        title="Entrada rapida"
        description={linkedTechnician?.display_name ? `Tecnico vinculado: ${linkedTechnician.display_name}` : "Sin tecnico vinculado"}
        aside={
          <ConsoleButton
            variant="ghost"
            size="sm"
            style={styles.refreshButton}
            onPress={() => {
              void triggerSelectionHaptic();
              void loadQueue();
            }}
            loading={loadingQueue}
            label="Refrescar"
            textStyle={styles.refreshButtonText}
          />
        }
      >
        <View style={styles.quickEntryRow}>
          <ConsoleButton
            variant="primary"
            style={styles.quickEntryPrimary}
            onPress={() => {
              void triggerSelectionHaptic();
              router.push("/scan" as never);
            }}
          >
            <Text style={[styles.quickEntryTitle, { color: palette.primaryButtonText }]}>Escanear equipo</Text>
            <Text style={[styles.quickEntryBody, { color: palette.primaryButtonText }]}>Abrir contexto inmediato</Text>
          </ConsoleButton>
          <ConsoleButton
            variant="ghost"
            style={styles.quickEntrySecondary}
            onPress={() => {
              void triggerSelectionHaptic();
              router.push("/incident/quick" as never);
            }}
            label="Nueva incidencia"
            textStyle={styles.quickEntrySecondaryText}
          />
        </View>
      </SectionCard>

      <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Incidencias asignadas</Text>

      {queueIncidents.length === 0 ? (
        <EmptyStateCard
          title="No hay incidencias activas en tu cola."
          body="Escanea un equipo para abrir contexto o espera nuevas asignaciones."
        />
      ) : (
        queueIncidents.map((incident, index) => (
          <QueueIncidentCard
            key={incident.id}
            incident={incident}
            index={index}
            nowMs={nowMs}
            busy={updatingIncidentId === incident.id}
            palette={palette}
            onChangeStatus={onChangeStatus}
            onOpenPrimaryAction={onOpenPrimaryAction}
            onOpenDetail={(targetIncident) => {
              router.push(`/incident/detail?incidentId=${targetIncident.id}&installationId=${targetIncident.installation_id}` as never);
            }}
          />
        ))
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  centerContainer: {
    flex: 1,
    padding: spacing.s22,
    alignItems: "center",
    justifyContent: "center",
  },
  container: {
    padding: spacing.s20,
    gap: spacing.s14,
  },
  authHintText: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fontFamilies.regular,
  },
  heroMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.s8,
  },
  heroMetaChip: {
    borderWidth: 1,
    borderRadius: radii.full,
    paddingHorizontal: spacing.s10,
    paddingVertical: spacing.s7,
  },
  heroMetaText: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
  refreshButton: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: radii.r10,
    paddingHorizontal: spacing.s12,
    paddingVertical: spacing.s8,
  },
  refreshButtonText: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
  quickEntryRow: {
    gap: spacing.s10,
  },
  quickEntryPrimary: {
    minHeight: 92,
    borderRadius: radii.r14,
    alignItems: "flex-start",
    justifyContent: "center",
    paddingHorizontal: spacing.s16,
    paddingVertical: spacing.s14,
    gap: spacing.s4,
  },
  quickEntryTitle: {
    fontFamily: fontFamilies.display,
    ...typeScale.actionDisplay,
    fontSize: 30,
    lineHeight: 28,
    letterSpacing: 0.72,
    textTransform: "uppercase",
  },
  quickEntryBody: {
    fontFamily: fontFamilies.medium,
    ...typeScale.bodyCompact,
  },
  quickEntrySecondary: {
    minHeight: 64,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: radii.r12,
    justifyContent: "center",
    paddingVertical: spacing.s10,
  },
  quickEntrySecondaryText: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
  sectionTitle: {
    fontFamily: fontFamilies.display,
    ...typeScale.sectionDisplay,
    textTransform: "uppercase",
  },
  swipeContainer: {
    borderWidth: 1,
    borderRadius: radii.r16,
    overflow: "hidden",
  },
  swipeHintRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.s12,
    paddingVertical: spacing.s8,
  },
  swipeHintText: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMonoTight,
    textTransform: "uppercase",
  },
  incidentCard: {
    borderTopWidth: 1,
    borderColor: "transparent",
    paddingHorizontal: spacing.s14,
    paddingVertical: spacing.s14,
    gap: spacing.s10,
  },
  incidentHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.s10,
  },
  incidentHeaderTextWrap: {
    flex: 1,
    gap: spacing.s3,
  },
  incidentTitle: {
    fontFamily: fontFamilies.bold,
    ...typeScale.titleStrong,
  },
  incidentSubtitle: {
    fontFamily: fontFamilies.regular,
    ...typeScale.bodyCompact,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.s8,
  },
  metaText: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
  incidentNote: {
    fontFamily: fontFamilies.regular,
    ...typeScale.body,
  },
  primaryActionRow: {
    flexDirection: "row",
    gap: spacing.s8,
  },
  primaryActionButton: {
    flex: 1.25,
    minHeight: 64,
    borderRadius: radii.r12,
    justifyContent: "center",
  },
  primaryActionText: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
  secondaryActionButton: {
    flex: 1,
    minHeight: 64,
    borderRadius: radii.r12,
    justifyContent: "center",
  },
  secondaryActionText: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
  statusRail: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.s8,
  },
  statusRailButton: {
    flexBasis: "31%",
    flexGrow: 1,
    minHeight: 64,
    borderRadius: radii.r12,
    justifyContent: "center",
    paddingHorizontal: spacing.s8,
  },
  statusRailText: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
  statusHint: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMonoTight,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
});
