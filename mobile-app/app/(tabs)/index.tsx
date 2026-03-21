import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { extractApiError } from "@/src/api/client";
import { listInstallations } from "@/src/api/incidents";
import { getDashboardStatistics } from "@/src/api/statistics";
import EmptyStateCard from "@/src/components/EmptyStateCard";
import InlineFeedback, { type InlineFeedbackTone } from "@/src/components/InlineFeedback";
import ScreenHero from "@/src/components/ScreenHero";
import ScreenScaffold from "@/src/components/ScreenScaffold";
import SectionCard from "@/src/components/SectionCard";
import StatusChip from "@/src/components/StatusChip";
import WebInlineLoginCard from "@/src/components/WebInlineLoginCard";
import { useSharedWebSessionState } from "@/src/session/web-session-store";
import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies } from "@/src/theme/typography";
import { type DashboardStatistics, type InstallationRecord } from "@/src/types/api";
import { deriveRecordIncidentSummary } from "@/src/utils/incidents";

type FeedbackState = {
  tone: InlineFeedbackTone;
  message: string;
} | null;

const MIN_TOUCH_TARGET_SIZE = 44;

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
  const [feedbackMessage, setFeedbackMessage] = useState<FeedbackState>(null);
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    }, [hasActiveSession, loadOverview]),
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
  const focusRecord = prioritizedInstallations[0] || null;
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
      <ScreenHero
        eyebrow="Hoy"
        title="Que sigue ahora"
        description="Escanear es la ruta principal. Si no aplica, usa caso manual o inventario."
      >
        <Text style={[styles.heroMetaText, { color: palette.textSecondary }]}>
          {statistics?.incident_in_progress_count ?? 0} en curso · {installations.length} casos
        </Text>
      </ScreenHero>

      {feedbackMessage ? (
        <InlineFeedback message={feedbackMessage.message} tone={feedbackMessage.tone} />
      ) : null}

      <SectionCard
        title="Entrada principal"
        description="Empieza por el QR cuando estas en campo."
      >
        <TouchableOpacity
          style={[styles.scanButton, { backgroundColor: palette.primaryButtonBg }]}
          onPress={() => router.push("/scan" as never)}
          accessibilityRole="button"
          accessibilityLabel="Escanear equipo para iniciar trabajo"
        >
          <Text style={[styles.scanButtonTitle, { color: palette.primaryButtonText }]}>
            Escanear equipo
          </Text>
          <Text style={[styles.scanButtonBody, { color: palette.primaryButtonText }]}>
            Apunta, resuelve el contexto y sigue.
          </Text>
        </TouchableOpacity>

        <View style={styles.utilityRow}>
          <TouchableOpacity
            style={[
              styles.utilityButton,
              { backgroundColor: palette.refreshBg, borderColor: palette.inputBorder },
            ]}
            onPress={() => router.push("/case/manual" as never)}
            accessibilityRole="button"
            accessibilityLabel="Iniciar caso manual"
          >
            <Text style={[styles.utilityButtonText, { color: palette.refreshText }]}>
              Caso manual
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.utilityButton,
              { backgroundColor: palette.refreshBg, borderColor: palette.inputBorder },
            ]}
            onPress={() => router.push("/explore" as never)}
            accessibilityRole="button"
            accessibilityLabel="Abrir inventario"
          >
            <Text style={[styles.utilityButtonText, { color: palette.refreshText }]}>
              Inventario
            </Text>
          </TouchableOpacity>
        </View>
      </SectionCard>

      <SectionCard
        title="Caso foco"
        description="Si ya hay trabajo abierto, retomas desde aqui."
        aside={(
          <TouchableOpacity
            style={[
              styles.refreshButton,
              { backgroundColor: palette.refreshBg, borderColor: palette.inputBorder },
            ]}
            onPress={() => {
              void loadOverview({ forceRefresh: true });
            }}
            disabled={loadingOverview}
            accessibilityRole="button"
            accessibilityLabel="Refrescar resumen operativo"
            accessibilityState={{ disabled: loadingOverview, busy: loadingOverview }}
          >
            {loadingOverview ? (
              <ActivityIndicator size="small" color={palette.refreshText} />
            ) : (
              <Text style={[styles.refreshButtonText, { color: palette.refreshText }]}>
                Refrescar
              </Text>
            )}
          </TouchableOpacity>
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
              {focusSummary.active} activas · {focusSummary.inProgress} en curso · {focusSummary.paused} pausadas
            </Text>

            <View style={styles.focusActions}>
              <TouchableOpacity
                style={[styles.primaryAction, { backgroundColor: palette.primaryButtonBg }]}
                onPress={() => openCaseContext(focusRecord)}
                accessibilityRole="button"
                accessibilityLabel={`Abrir el caso ${focusRecord.id}`}
              >
                <Text style={[styles.primaryActionText, { color: palette.primaryButtonText }]}>
                  Trabajar este caso
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.secondaryAction,
                  { backgroundColor: palette.refreshBg, borderColor: palette.inputBorder },
                ]}
                onPress={() => openBacklog(focusRecord)}
                accessibilityRole="button"
                accessibilityLabel={`Abrir backlog del caso ${focusRecord.id}`}
              >
                <Text style={[styles.secondaryActionText, { color: palette.refreshText }]}>
                  Ver backlog
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </SectionCard>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  centerContainer: {
    flex: 1,
    padding: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  container: {
    padding: 22,
    gap: 12,
  },
  authHintText: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fontFamilies.regular,
  },
  heroMetaText: {
    fontFamily: fontFamilies.regular,
    fontSize: 13,
    lineHeight: 18,
  },
  scanButton: {
    minHeight: 88,
    borderRadius: 20,
    alignItems: "flex-start",
    justifyContent: "center",
    paddingHorizontal: 18,
    paddingVertical: 16,
    gap: 4,
  },
  scanButtonTitle: {
    fontFamily: fontFamilies.bold,
    fontSize: 17,
    lineHeight: 22,
  },
  scanButtonBody: {
    fontFamily: fontFamilies.regular,
    fontSize: 13,
    lineHeight: 18,
  },
  refreshButton: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    justifyContent: "center",
  },
  refreshButtonText: {
    fontFamily: fontFamilies.semibold,
    fontSize: 13,
  },
  focusCard: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    gap: 12,
  },
  focusHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  focusTitleWrap: {
    flex: 1,
    gap: 4,
  },
  focusTitle: {
    fontFamily: fontFamilies.bold,
    fontSize: 19,
    lineHeight: 24,
  },
  focusBody: {
    fontFamily: fontFamilies.regular,
    fontSize: 13.5,
    lineHeight: 19,
  },
  focusMeta: {
    fontFamily: fontFamilies.regular,
    fontSize: 12.5,
    lineHeight: 18,
  },
  focusActions: {
    gap: 10,
  },
  primaryAction: {
    minHeight: MIN_TOUCH_TARGET_SIZE,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 13,
  },
  primaryActionText: {
    fontFamily: fontFamilies.bold,
    fontSize: 14.5,
  },
  secondaryAction: {
    minHeight: MIN_TOUCH_TARGET_SIZE,
    borderWidth: 1,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },
  secondaryActionText: {
    fontFamily: fontFamilies.semibold,
    fontSize: 13.5,
  },
  utilityRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  utilityButton: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    borderWidth: 1,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
  },
  utilityButtonText: {
    fontFamily: fontFamilies.bold,
    fontSize: 13,
  },
});
