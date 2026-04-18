import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Animated, Easing, StyleSheet, Text, View } from "react-native";

import { extractApiError } from "@/src/api/client";
import { listInstallations } from "@/src/api/incidents";
import { getDashboardStatistics } from "@/src/api/statistics";
import { readStoredWebSession } from "@/src/api/webAuth";
import { canManageTechnicians as canManageTechnicianDirectory } from "@/src/auth/roles";
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
import { triggerSelectionHaptic } from "@/src/services/haptics";
import { radii, sizing, spacing } from "@/src/theme/layout";
import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies, typeScale } from "@/src/theme/typography";
import { type DashboardStatistics, type InstallationRecord } from "@/src/types/api";
import { deriveRecordIncidentSummary } from "@/src/utils/incidents";

type FeedbackState = {
  tone: InlineFeedbackTone;
  message: string;
} | null;

const MIN_TOUCH_TARGET_SIZE = sizing.touchTargetMin;

function normalizeRouteParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function buildAttentionRank(record: InstallationRecord): number {
  const attentionState = String(record.attention_state || "").trim().toLowerCase();
  if (attentionState === "critical") return 0;
  if (attentionState === "in_progress") return 1;
  if (attentionState === "paused") return 2;
  if (attentionState === "open") return 3;
  return 4;
}

function sortRecordsForAction(records: InstallationRecord[]): InstallationRecord[] {
  return [...records].sort((left, right) => {
    const attentionDelta = buildAttentionRank(left) - buildAttentionRank(right);
    if (attentionDelta !== 0) return attentionDelta;

    const leftSummary = deriveRecordIncidentSummary(left);
    const rightSummary = deriveRecordIncidentSummary(right);
    if (rightSummary.active !== leftSummary.active) {
      return rightSummary.active - leftSummary.active;
    }

    return Number(right.id) - Number(left.id);
  });
}

export default function TodayScreen() {
  const router = useRouter();
  const queryParams = useLocalSearchParams<{
    installationId?: string | string[];
    assetExternalCode?: string | string[];
    assetRecordId?: string | string[];
  }>();
  const palette = useAppPalette();
  const { checkingSession, hasActiveSession } = useSharedWebSessionState();
  const [installations, setInstallations] = useState<InstallationRecord[]>([]);
  const [statistics, setStatistics] = useState<DashboardStatistics | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [webSessionRole, setWebSessionRole] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<FeedbackState>(null);
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heroEnterAnim = useRef(new Animated.Value(0)).current;
  const cardsEnterAnim = useRef(new Animated.Value(0)).current;

  const qrInstallationId = normalizeRouteParam(queryParams.installationId).trim();
  const qrAssetExternalCode = normalizeRouteParam(queryParams.assetExternalCode).trim();
  const qrAssetRecordId = normalizeRouteParam(queryParams.assetRecordId).trim();

  const notify = useCallback((title: string, message: string) => {
    const normalized = String(title || "").trim().toLowerCase();
    const tone: InlineFeedbackTone = normalized.includes("error")
      ? "error"
      : normalized.includes("sesion") || normalized.includes("invalido")
        ? "warning"
        : "info";
    setFeedbackMessage({ tone, message: `${title}: ${message}` });
    if (feedbackTimeoutRef.current) {
      clearTimeout(feedbackTimeoutRef.current);
    }
    feedbackTimeoutRef.current = setTimeout(() => {
      setFeedbackMessage(null);
      feedbackTimeoutRef.current = null;
    }, 5000);
  }, []);

  const loadOverview = useCallback(async (options?: { forceRefresh?: boolean }) => {
    if (!hasActiveSession) return;
    try {
      setLoadingOverview(true);
      const [stats, records] = await Promise.all([
        getDashboardStatistics(),
        listInstallations(options),
      ]);
      setStatistics(stats);
      setInstallations(records);
    } catch (error) {
      notify("Error", `No se pudo cargar resumen: ${extractApiError(error)}`);
    } finally {
      setLoadingOverview(false);
    }
  }, [hasActiveSession, notify]);

  useFocusEffect(
    useCallback(() => {
      if (!hasActiveSession) return;
      void loadOverview();
      void readStoredWebSession()
        .then((session) => setWebSessionRole(session.role))
        .catch(() => setWebSessionRole(null));
    }, [hasActiveSession, loadOverview]),
  );

  useFocusEffect(
    useCallback(() => {
      if (!hasActiveSession) return;
      heroEnterAnim.setValue(0);
      cardsEnterAnim.setValue(0);
      const enterSequence = Animated.stagger(85, [
        Animated.timing(heroEnterAnim, {
          toValue: 1,
          duration: 280,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(cardsEnterAnim, {
          toValue: 1,
          duration: 320,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]);
      enterSequence.start();
      return () => {
        enterSequence.stop();
      };
    }, [cardsEnterAnim, hasActiveSession, heroEnterAnim]),
  );

  useEffect(() => {
    return () => {
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!hasActiveSession) {
      setInstallations([]);
      setStatistics(null);
      setWebSessionRole(null);
    }
  }, [hasActiveSession]);

  useEffect(() => {
    if (!qrInstallationId && !qrAssetExternalCode && !qrAssetRecordId) return;
    const params = new URLSearchParams();
    if (qrInstallationId) params.set("installationId", qrInstallationId);
    if (qrAssetExternalCode) params.set("assetExternalCode", qrAssetExternalCode);
    if (qrAssetRecordId) params.set("assetRecordId", qrAssetRecordId);
    const query = params.toString();
    router.replace(`/case/context${query ? `?${query}` : ""}` as never);
  }, [qrAssetExternalCode, qrAssetRecordId, qrInstallationId, router]);

  const prioritizedInstallations = useMemo(
    () => sortRecordsForAction(installations),
    [installations],
  );
  const canManageTechnicians = canManageTechnicianDirectory(webSessionRole);
  const focusRecord = prioritizedInstallations[0] || null;
  const heroTranslate = heroEnterAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [10, 0],
  });
  const cardsTranslate = cardsEnterAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [16, 0],
  });
  const focusSummary = useMemo(
    () => deriveRecordIncidentSummary(focusRecord),
    [focusRecord],
  );

  const openCaseContext = useCallback((record?: InstallationRecord | null) => {
    const targetId = Number(record?.id);
    router.push(
      `${Number.isInteger(targetId) && targetId > 0 ? `/case/context?installationId=${targetId}` : "/case/context"}` as never,
    );
  }, [router]);

  const openBacklog = useCallback((record?: InstallationRecord | null) => {
    const targetId = Number(record?.id);
    router.push(
      `${Number.isInteger(targetId) && targetId > 0 ? `/work?installationId=${targetId}` : "/work"}` as never,
    );
  }, [router]);

  if (checkingSession) {
    return (
      <ScreenScaffold scroll={false} centered contentContainerStyle={styles.centerContainer}>
        <ActivityIndicator size="large" color={palette.loadingSpinner} />
        <Text style={[styles.authHintText, { color: palette.textSecondary }]}>
          Preparando el turno...
        </Text>
      </ScreenScaffold>
    );
  }

  if (!hasActiveSession) {
    return (
      <ScreenScaffold scroll={false} centered contentContainerStyle={styles.centerContainer}>
        <WebInlineLoginCard
          hint="Inicia sesion web para ver casos, backlog e inventario desde la app."
          onLoginSuccess={async () => {
            await loadOverview({ forceRefresh: true });
          }}
          onOpenAdvanced={() => router.push("/modal?focus=login")}
        />
      </ScreenScaffold>
    );
  }

  return (
    <ScreenScaffold contentContainerStyle={styles.container}>
      <Animated.View
        style={{
          opacity: heroEnterAnim,
          transform: [{ translateY: heroTranslate }],
        }}
      >
      <ScreenHero
        eyebrow="Hoy"
        title="Centro del turno"
        description="Empieza por la accion prioritaria. Si no aplica QR, abre un caso manual o entra por inventario."
      >
        <Text style={[styles.heroMetaText, { color: palette.textSecondary }]}>
          {statistics?.incident_in_progress_count ?? 0} en curso - {installations.length} casos
        </Text>
      </ScreenHero>
      </Animated.View>

      <Animated.View
        style={{
          opacity: cardsEnterAnim,
          transform: [{ translateY: cardsTranslate }],
        }}
      >
      {feedbackMessage ? (
        <InlineFeedback message={feedbackMessage.message} tone={feedbackMessage.tone} />
      ) : null}

      <SyncStatusBanner />

      <SectionCard
        title="Entrada principal"
        description="Empieza por el QR cuando estas en campo."
      >
        <ConsoleButton
          variant="secondary"
          size="lg"
          style={styles.scanButton}
          onPress={() => {
            void triggerSelectionHaptic();
            router.push("/scan" as never);
          }}
          accessibilityLabel="Escanear equipo para iniciar trabajo"
        >
          <Text style={[styles.scanButtonTitle, { color: palette.accent }]}>
            Escanear equipo
          </Text>
          <Text style={[styles.scanButtonBody, { color: palette.textSecondary }]}>
            Apunta, resuelve el contexto y sigue.
          </Text>
        </ConsoleButton>

        <View style={styles.utilityRow}>
          <ConsoleButton
            variant="ghost"
            style={styles.utilityButton}
            onPress={() => {
              void triggerSelectionHaptic();
              router.push("/case/manual" as never);
            }}
            accessibilityLabel="Iniciar caso manual"
            label="Caso manual"
            textStyle={styles.utilityButtonText}
          />
          <ConsoleButton
            variant="ghost"
            style={styles.utilityButton}
            onPress={() => {
              void triggerSelectionHaptic();
              router.push("/explore" as never);
            }}
            accessibilityLabel="Abrir inventario"
            label="Inventario"
            textStyle={styles.utilityButtonText}
          />
        </View>
      </SectionCard>

      {canManageTechnicians ? (
        <SectionCard
          title="Gestion de tecnicos"
          description="Acceso rapido al directorio operativo del tenant."
        >
          <ConsoleButton
            variant="ghost"
            style={styles.utilityButton}
            onPress={() => {
              void triggerSelectionHaptic();
              router.push("/technicians" as never);
            }}
            accessibilityLabel="Abrir directorio de tecnicos"
            label="Abrir tecnicos"
            textStyle={styles.utilityButtonText}
          />
        </SectionCard>
      ) : null}

      <SectionCard
        title="Caso foco"
        description="Si ya hay trabajo abierto, retomas desde aqui."
        aside={(
          <ConsoleButton
            variant="ghost"
            size="sm"
            style={styles.refreshButton}
            onPress={() => {
              void triggerSelectionHaptic();
              void loadOverview({ forceRefresh: true });
            }}
            loading={loadingOverview}
            accessibilityLabel="Refrescar resumen operativo"
            accessibilityState={{ disabled: loadingOverview, busy: loadingOverview }}
            label="Refrescar"
            textStyle={styles.refreshButtonText}
          />
        )}
      >
        {!focusRecord ? (
          <EmptyStateCard
            title="Todavia no hay un caso arriba."
            body="Empieza por escanear un equipo o inicia un caso manual."
          />
        ) : (
          <View
            style={[
              styles.focusCard,
              { backgroundColor: palette.heroBg, borderColor: palette.heroBorder },
            ]}
          >
            <View style={styles.focusHeader}>
              <View style={styles.focusTitleWrap}>
                <Text style={[styles.focusTitle, { color: palette.textPrimary }]}>
                  Caso #{focusRecord.id}
                </Text>
                <Text style={[styles.focusBody, { color: palette.textSecondary }]}>
                  {focusRecord.client_name || "Sin cliente"}
                </Text>
              </View>
              <StatusChip kind="attention" value={focusRecord.attention_state} />
            </View>

            <Text style={[styles.focusMeta, { color: palette.textMuted }]}>
              {focusSummary.active} activas - {focusSummary.inProgress} en curso - {focusSummary.paused} pausadas
            </Text>

            <View style={styles.focusActions}>
              <ConsoleButton
                variant="primary"
                style={styles.primaryAction}
                onPress={() => {
                  void triggerSelectionHaptic();
                  openCaseContext(focusRecord);
                }}
                accessibilityLabel={`Abrir el caso ${focusRecord.id}`}
                label="Trabajar este caso"
                textStyle={styles.primaryActionText}
              />
              <ConsoleButton
                variant="ghost"
                style={styles.secondaryAction}
                onPress={() => {
                  void triggerSelectionHaptic();
                  openBacklog(focusRecord);
                }}
                accessibilityLabel={`Abrir backlog del caso ${focusRecord.id}`}
                label="Ver backlog"
                textStyle={styles.secondaryActionText}
              />
            </View>
          </View>
        )}
      </SectionCard>
      </Animated.View>
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
    padding: spacing.s22,
    gap: spacing.s14,
  },
  authHintText: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fontFamilies.regular,
  },
  heroMetaText: {
    fontFamily: fontFamilies.mono,
    ...typeScale.metaMono,
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  scanButton: {
    minHeight: 88,
    borderRadius: radii.r14,
    borderWidth: 1,
    borderStyle: "dashed",
    alignItems: "flex-start",
    justifyContent: "center",
    paddingHorizontal: spacing.s18,
    paddingVertical: spacing.s16,
    gap: spacing.s4,
  },
  scanButtonTitle: {
    fontFamily: fontFamilies.display,
    ...typeScale.actionDisplay,
    textTransform: "uppercase",
  },
  scanButtonBody: {
    fontFamily: fontFamilies.medium,
    ...typeScale.bodyCompact,
  },
  refreshButton: {
    borderWidth: 1,
    borderRadius: radii.r10,
    borderStyle: "dashed",
    paddingHorizontal: spacing.s12,
    paddingVertical: spacing.s8,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    justifyContent: "center",
  },
  refreshButtonText: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  focusCard: {
    borderWidth: 1,
    borderRadius: radii.r14,
    padding: spacing.s16,
    gap: spacing.s12,
  },
  focusHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.s12,
  },
  focusTitleWrap: {
    flex: 1,
    gap: spacing.s4,
  },
  focusTitle: {
    fontFamily: fontFamilies.bold,
    ...typeScale.titleStrong,
    letterSpacing: -0.2,
  },
  focusBody: {
    fontFamily: fontFamilies.regular,
    ...typeScale.body,
  },
  focusMeta: {
    fontFamily: fontFamilies.mono,
    ...typeScale.metaMono,
    letterSpacing: 0.9,
    textTransform: "uppercase",
  },
  focusActions: {
    gap: spacing.s10,
  },
  primaryAction: {
    minHeight: MIN_TOUCH_TARGET_SIZE,
    borderRadius: radii.r10,
    borderWidth: 1,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.s13,
  },
  primaryActionText: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
  secondaryAction: {
    minHeight: MIN_TOUCH_TARGET_SIZE,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: radii.r10,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.s12,
  },
  secondaryActionText: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
  utilityRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.s10,
  },
  utilityButton: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: radii.r10,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.s10,
  },
  utilityButtonText: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
});
