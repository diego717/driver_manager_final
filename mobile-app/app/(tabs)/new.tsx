import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { extractApiError } from "@/src/api/client";
import { listInstallations } from "@/src/api/incidents";
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
import { radii, spacing } from "@/src/theme/layout";
import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies, typeScale } from "@/src/theme/typography";
import { type InstallationRecord } from "@/src/types/api";
import { deriveRecordIncidentSummary } from "@/src/utils/incidents";

type FeedbackState = {
  tone: InlineFeedbackTone;
  message: string;
} | null;

function buildAttentionRank(record: InstallationRecord): number {
  const attentionState = String(record.attention_state || "").trim().toLowerCase();
  if (attentionState === "critical") return 0;
  if (attentionState === "in_progress") return 1;
  if (attentionState === "paused") return 2;
  if (attentionState === "open") return 3;
  return 4;
}

function sortInstallationsForField(records: InstallationRecord[]): InstallationRecord[] {
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

export default function NewFieldActionScreen() {
  const palette = useAppPalette();
  const router = useRouter();
  const { checkingSession, hasActiveSession } = useSharedWebSessionState();
  const [installations, setInstallations] = useState<InstallationRecord[]>([]);
  const [loadingInstallations, setLoadingInstallations] = useState(false);
  const [selectedInstallationId, setSelectedInstallationId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((tone: InlineFeedbackTone, message: string) => {
    setFeedback({ tone, message });
    if (feedbackTimeoutRef.current) {
      clearTimeout(feedbackTimeoutRef.current);
    }
    feedbackTimeoutRef.current = setTimeout(() => {
      setFeedback(null);
      feedbackTimeoutRef.current = null;
    }, 5000);
  }, []);

  const loadCases = useCallback(async (options?: { forceRefresh?: boolean; silent?: boolean }) => {
    if (!hasActiveSession) return;
    try {
      setLoadingInstallations(true);
      const records = await listInstallations({ forceRefresh: options?.forceRefresh === true });
      const sorted = sortInstallationsForField(records);
      setInstallations(sorted);
      setSelectedInstallationId((current) => {
        if (current && sorted.some((item) => item.id === current)) return current;
        return sorted[0]?.id ?? null;
      });
    } catch (error) {
      if (!options?.silent) {
        notify("error", `No se pudieron cargar casos: ${extractApiError(error)}`);
      }
    } finally {
      setLoadingInstallations(false);
    }
  }, [hasActiveSession, notify]);

  useEffect(() => {
    if (!hasActiveSession) {
      setInstallations([]);
      setSelectedInstallationId(null);
      setFeedback(null);
      return;
    }
    void loadCases({ silent: true });
  }, [hasActiveSession, loadCases]);

  useFocusEffect(
    useCallback(() => {
      if (!hasActiveSession) return;
      void loadCases({ silent: true });
    }, [hasActiveSession, loadCases]),
  );

  useEffect(() => {
    return () => {
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current);
      }
    };
  }, []);

  const selectedCase = useMemo(() => {
    if (!selectedInstallationId) return null;
    return installations.find((item) => item.id === selectedInstallationId) || null;
  }, [installations, selectedInstallationId]);

  const selectedCaseSummary = useMemo(
    () => deriveRecordIncidentSummary(selectedCase),
    [selectedCase],
  );

  if (checkingSession) {
    return (
      <ScreenScaffold scroll={false} centered contentContainerStyle={styles.centerContainer}>
        <ActivityIndicator size="large" color={palette.loadingSpinner} />
        <Text style={[styles.authHintText, { color: palette.textSecondary }]}>Preparando acciones rapidas...</Text>
      </ScreenScaffold>
    );
  }

  if (!hasActiveSession) {
    return (
      <ScreenScaffold scroll={false} centered contentContainerStyle={styles.centerContainer}>
        <WebInlineLoginCard
          hint="Inicia sesion web para crear incidencias y abrir casos desde mobile."
          onLoginSuccess={async () => {
            await loadCases({ forceRefresh: true, silent: true });
          }}
          onOpenAdvanced={() => router.push("/modal?focus=login")}
        />
      </ScreenScaffold>
    );
  }

  return (
    <ScreenScaffold contentContainerStyle={styles.container}>
      <ScreenHero
        eyebrow="Nueva"
        title="Abrir trabajo"
        description="Elige el camino mas rapido: escaneo, caso manual o incidencia directa sobre el caso prioritario."
      />

      {feedback ? <InlineFeedback tone={feedback.tone} message={feedback.message} /> : null}

      <SyncStatusBanner />

      <SectionCard
        title="Accion principal"
        description={selectedCase ? `Caso sugerido: #${selectedCase.id}` : "Sin caso sugerido"}
        aside={
          <ConsoleButton
            variant="ghost"
            size="sm"
            style={styles.refreshButton}
            onPress={() => {
              void triggerSelectionHaptic();
              void loadCases({ forceRefresh: true });
            }}
            loading={loadingInstallations}
            label="Refrescar"
            textStyle={styles.refreshButtonText}
          />
        }
      >
        <View style={styles.primaryActionsStack}>
          <ConsoleButton
            variant="primary"
            style={styles.primaryAction}
            onPress={() => {
              void triggerSelectionHaptic();
              if (!selectedCase?.id) {
                notify("warning", "Primero elige un caso o inicia por escaneo.");
                return;
              }
              router.push(`/incident/quick?installationId=${selectedCase.id}` as never);
            }}
          >
            <Text style={[styles.primaryActionTitle, { color: palette.primaryButtonText }]}>Crear incidencia rapida</Text>
            <Text style={[styles.primaryActionBody, { color: palette.primaryButtonText }]}>Formulario de 3 campos y envio directo</Text>
          </ConsoleButton>

          <View style={styles.supportingActionRow}>
            <ConsoleButton
              variant="secondary"
              style={styles.supportingAction}
              onPress={() => {
                void triggerSelectionHaptic();
                router.push("/scan" as never);
              }}
              label="Escanear equipo"
              textStyle={styles.supportingActionText}
            />
            <ConsoleButton
              variant="ghost"
              style={styles.supportingAction}
              onPress={() => {
                void triggerSelectionHaptic();
                router.push("/case/manual" as never);
              }}
              label="Caso manual"
              textStyle={styles.supportingActionText}
            />
          </View>
        </View>
      </SectionCard>

      <SectionCard
        title="Caso objetivo"
        description="Puedes cambiar el caso antes de crear la incidencia."
      >
        {!installations.length ? (
          <EmptyStateCard
            title="No hay casos disponibles."
            body="Inicia por escaneo QR o crea un caso manual para continuar."
          />
        ) : (
          <>
            {selectedCase ? (
              <View style={[styles.caseFocusCard, { backgroundColor: palette.heroBg, borderColor: palette.heroBorder }]}> 
                <View style={styles.caseFocusHeader}>
                  <View style={styles.caseFocusTextWrap}>
                    <Text style={[styles.caseFocusTitle, { color: palette.textPrimary }]}>Caso #{selectedCase.id}</Text>
                    <Text style={[styles.caseFocusBody, { color: palette.textSecondary }]}>{selectedCase.client_name || "Sin cliente"}</Text>
                  </View>
                  <StatusChip kind="attention" value={selectedCase.attention_state} />
                </View>
                <Text style={[styles.caseFocusMeta, { color: palette.textMuted }]}> 
                  {selectedCaseSummary.active} activas - {selectedCaseSummary.inProgress} en curso - {selectedCaseSummary.criticalActive} criticas
                </Text>
              </View>
            ) : null}

            <View style={styles.caseList}>
              {installations.slice(0, 6).map((record) => {
                const selected = record.id === selectedInstallationId;
                return (
                  <ConsoleButton
                    key={record.id}
                    variant={selected ? "primary" : "subtle"}
                    style={styles.caseOptionButton}
                    onPress={() => {
                      void triggerSelectionHaptic();
                      setSelectedInstallationId(record.id);
                    }}
                  >
                    <Text style={[styles.caseOptionTitle, { color: selected ? palette.primaryButtonText : palette.textPrimary }]}> 
                      #{record.id} - {record.client_name || "Sin cliente"}
                    </Text>
                    <Text style={[styles.caseOptionMeta, { color: selected ? palette.primaryButtonText : palette.textSecondary }]}> 
                      {deriveRecordIncidentSummary(record).active} activas
                    </Text>
                  </ConsoleButton>
                );
              })}
            </View>
          </>
        )}
      </SectionCard>
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
  primaryActionsStack: {
    gap: spacing.s10,
  },
  primaryAction: {
    minHeight: 96,
    borderRadius: radii.r14,
    alignItems: "flex-start",
    justifyContent: "center",
    paddingHorizontal: spacing.s16,
    paddingVertical: spacing.s14,
    gap: spacing.s5,
  },
  primaryActionTitle: {
    fontFamily: fontFamilies.display,
    ...typeScale.actionDisplay,
    fontSize: 30,
    lineHeight: 28,
    letterSpacing: 0.75,
    textTransform: "uppercase",
  },
  primaryActionBody: {
    fontFamily: fontFamilies.medium,
    ...typeScale.bodyCompact,
  },
  supportingActionRow: {
    flexDirection: "row",
    gap: spacing.s8,
  },
  supportingAction: {
    flex: 1,
    minHeight: 64,
    borderRadius: radii.r12,
    justifyContent: "center",
  },
  supportingActionText: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
  caseFocusCard: {
    borderWidth: 1,
    borderRadius: radii.r14,
    paddingHorizontal: spacing.s14,
    paddingVertical: spacing.s12,
    gap: spacing.s8,
  },
  caseFocusHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.s10,
  },
  caseFocusTextWrap: {
    flex: 1,
    gap: spacing.s3,
  },
  caseFocusTitle: {
    fontFamily: fontFamilies.bold,
    ...typeScale.titleStrong,
  },
  caseFocusBody: {
    fontFamily: fontFamilies.regular,
    ...typeScale.bodyCompact,
  },
  caseFocusMeta: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
  caseList: {
    gap: spacing.s8,
  },
  caseOptionButton: {
    minHeight: 64,
    borderRadius: radii.r12,
    alignItems: "flex-start",
    justifyContent: "center",
    paddingHorizontal: spacing.s12,
    paddingVertical: spacing.s10,
    gap: spacing.s4,
  },
  caseOptionTitle: {
    fontFamily: fontFamilies.semibold,
    ...typeScale.body,
  },
  caseOptionMeta: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
});
