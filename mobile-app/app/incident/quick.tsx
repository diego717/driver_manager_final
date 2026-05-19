import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from "react-native";

import { extractApiError } from "@/src/api/client";
import { listInstallations } from "@/src/api/incidents";
import { getCurrentLinkedTechnicianContext } from "@/src/api/technicians";
import ConsoleButton from "@/src/components/ConsoleButton";
import EmptyStateCard from "@/src/components/EmptyStateCard";
import InlineFeedback, { type InlineFeedbackTone } from "@/src/components/InlineFeedback";
import ScreenHero from "@/src/components/ScreenHero";
import ScreenScaffold from "@/src/components/ScreenScaffold";
import SectionCard from "@/src/components/SectionCard";
import SyncStatusBanner from "@/src/components/SyncStatusBanner";
import WebInlineLoginCard from "@/src/components/WebInlineLoginCard";
import { useSharedWebSessionState } from "@/src/session/web-session-store";
import { triggerSuccessHaptic, triggerWarningHaptic } from "@/src/services/haptics";
import { captureCurrentGpsSnapshot } from "@/src/services/location";
import { canReachConfiguredApi } from "@/src/services/network/api-connectivity";
import { enqueueCreateIncident, registerIncidentExecutors } from "@/src/services/sync/incident-outbox-service";
import { runSync } from "@/src/services/sync/sync-runner";
import { radii, spacing } from "@/src/theme/layout";
import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies, inputFontFamily, typeScale } from "@/src/theme/typography";
import { type GpsCapturePayload, type IncidentSeverity, type InstallationRecord } from "@/src/types/api";

registerIncidentExecutors();

type FeedbackState = {
  tone: InlineFeedbackTone;
  message: string;
} | null;

const QUICK_SEVERITY_OPTIONS: Array<{ value: IncidentSeverity; label: string }> = [
  { value: "low", label: "Baja" },
  { value: "medium", label: "Media" },
  { value: "high", label: "Alta" },
  { value: "critical", label: "Critica" },
];

function parsePositiveInt(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(String(raw || "").trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function sortFieldCases(records: InstallationRecord[]): InstallationRecord[] {
  return [...records].sort((left, right) => {
    const leftActive = Number(left.incident_active_count || 0);
    const rightActive = Number(right.incident_active_count || 0);
    if (rightActive !== leftActive) return rightActive - leftActive;
    return Number(right.id) - Number(left.id);
  });
}

export default function QuickIncidentScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ installationId?: string | string[] }>();
  const palette = useAppPalette();
  const { checkingSession, hasActiveSession } = useSharedWebSessionState();

  const [cases, setCases] = useState<InstallationRecord[]>([]);
  const [loadingCases, setLoadingCases] = useState(false);
  const [selectedCaseId, setSelectedCaseId] = useState<number | null>(parsePositiveInt(params.installationId));
  const [reporterUsername, setReporterUsername] = useState("mobile_user");
  const [problemNote, setProblemNote] = useState("");
  const [severity, setSeverity] = useState<IncidentSeverity>("medium");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedCase = useMemo(
    () => cases.find((item) => item.id === selectedCaseId) || null,
    [cases, selectedCaseId],
  );

  const notify = useCallback((tone: InlineFeedbackTone, message: string) => {
    setFeedback({ tone, message });
    if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
    feedbackTimeoutRef.current = setTimeout(() => {
      setFeedback(null);
      feedbackTimeoutRef.current = null;
    }, 5000);
  }, []);

  const loadCases = useCallback(async (options?: { forceRefresh?: boolean; silent?: boolean }) => {
    if (!hasActiveSession) return;
    try {
      setLoadingCases(true);
      const records = await listInstallations({ forceRefresh: options?.forceRefresh === true });
      const sorted = sortFieldCases(records);
      setCases(sorted);
      setSelectedCaseId((current) => {
        if (current && sorted.some((item) => item.id === current)) return current;
        return sorted[0]?.id ?? null;
      });
    } catch (error) {
      if (!options?.silent) {
        notify("error", `No se pudieron cargar casos: ${extractApiError(error)}`);
      }
    } finally {
      setLoadingCases(false);
    }
  }, [hasActiveSession, notify]);

  useEffect(() => {
    if (!hasActiveSession) {
      setCases([]);
      setSelectedCaseId(null);
      return;
    }
    void loadCases({ silent: true });
  }, [hasActiveSession, loadCases]);

  useFocusEffect(
    useCallback(() => {
      if (!hasActiveSession) return;
      void loadCases({ silent: true });
      void getCurrentLinkedTechnicianContext()
        .then(({ user, technician }) => {
          setReporterUsername(String(technician?.display_name || user.username || "mobile_user").trim() || "mobile_user");
        })
        .catch(() => setReporterUsername("mobile_user"));
    }, [hasActiveSession, loadCases]),
  );

  useEffect(() => {
    return () => {
      if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
    };
  }, []);

  const onSubmitQuickIncident = async () => {
    if (!hasActiveSession) return;
    if (!selectedCaseId) {
      void triggerWarningHaptic();
      notify("warning", "Selecciona un caso antes de crear la incidencia.");
      return;
    }
    if (!problemNote.trim()) {
      void triggerWarningHaptic();
      notify("warning", "Describe el problema para poder crear la incidencia.");
      return;
    }

    let gpsPayload: GpsCapturePayload = {
      status: "unavailable",
      source: "browser",
      note: "GPS no capturado en formulario rapido",
    };

    try {
      setSubmitting(true);
      try {
        const gps = await captureCurrentGpsSnapshot();
        if (gps.status === "captured") {
          gpsPayload = gps;
        } else {
          gpsPayload = {
            status: "override",
            source: "override",
            note: gps.note || "GPS no disponible en formulario rapido",
          };
        }
      } catch {
        gpsPayload = {
          status: "override",
          source: "override",
          note: "GPS no disponible en formulario rapido",
        };
      }

      await enqueueCreateIncident({
        installationId: selectedCaseId,
        remoteInstallationId: selectedCaseId,
        localCaseLocalId: null,
        note: problemNote.trim(),
        reporterUsername: reporterUsername || "mobile_user",
        timeAdjustmentSeconds: 0,
        severity,
        source: "mobile",
        gps: gpsPayload,
      });

      setProblemNote("");
      void triggerSuccessHaptic();
      notify("success", "Incidencia creada. Sincronizando...");

      if (await canReachConfiguredApi()) {
        runSync();
      }

      router.replace("/(tabs)" as never);
    } catch (error) {
      void triggerWarningHaptic();
      notify("error", `No se pudo crear la incidencia: ${extractApiError(error)}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (checkingSession) {
    return (
      <ScreenScaffold scroll={false} centered contentContainerStyle={styles.centerContainer}>
        <ActivityIndicator size="large" color={palette.loadingSpinner} />
      </ScreenScaffold>
    );
  }

  if (!hasActiveSession) {
    return (
      <ScreenScaffold scroll={false} centered contentContainerStyle={styles.centerContainer}>
        <WebInlineLoginCard
          hint="Inicia sesion web para crear incidencias rapidas en campo."
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
        title="Incidencia rapida"
        description="Formulario de 3 campos para campo: caso, problema y severidad."
      />

      {feedback ? <InlineFeedback tone={feedback.tone} message={feedback.message} /> : null}

      <SyncStatusBanner />

      <SectionCard title="Caso" description="Campo 1 de 3">
        {cases.length === 0 ? (
          <EmptyStateCard
            title="No hay casos disponibles."
            body="Escanea un equipo o crea un caso manual antes de registrar incidencia."
          />
        ) : (
          <View style={styles.caseList}>
            {cases.slice(0, 6).map((record) => {
              const selected = record.id === selectedCaseId;
              return (
                <ConsoleButton
                  key={record.id}
                  variant={selected ? "primary" : "subtle"}
                  style={styles.caseOption}
                  onPress={() => {
                    setSelectedCaseId(record.id);
                  }}
                >
                    <Text style={[styles.caseTitle, { color: selected ? palette.primaryButtonText : palette.textPrimary }]}>
                      Caso #{record.id} - {record.client_name || "Sin cliente"}
                  </Text>
                </ConsoleButton>
              );
            })}
            <ConsoleButton
              variant="ghost"
              size="sm"
              style={styles.refreshButton}
              onPress={() => {
                void loadCases({ forceRefresh: true });
              }}
              loading={loadingCases}
              label="Refrescar casos"
              textStyle={styles.refreshButtonText}
            />
          </View>
        )}
      </SectionCard>

      <SectionCard title="Problema" description="Campo 2 de 3">
        <TextInput
          value={problemNote}
          onChangeText={setProblemNote}
          placeholder="Describe el problema en una linea clara"
          placeholderTextColor={palette.placeholder}
          style={[
            styles.input,
            styles.problemInput,
            {
              backgroundColor: palette.inputBg,
              borderColor: palette.inputBorder,
              color: palette.textPrimary,
            },
          ]}
          multiline
          selectionColor={palette.accent}
          cursorColor={palette.accent}
        />
      </SectionCard>

      <SectionCard title="Severidad" description="Campo 3 de 3">
        <View style={styles.severityWrap}>
          {QUICK_SEVERITY_OPTIONS.map((option) => {
            const selected = severity === option.value;
            return (
              <ConsoleButton
                key={option.value}
                variant={selected ? "primary" : "ghost"}
                style={styles.severityButton}
                onPress={() => {
                  setSeverity(option.value);
                }}
                label={option.label}
                textStyle={styles.severityButtonText}
              />
            );
          })}
        </View>

        <Text style={[styles.helperText, { color: palette.textMuted }]}>
          Reporta: {reporterUsername} - Caso seleccionado: {selectedCase ? `#${selectedCase.id}` : "ninguno"}
        </Text>

        <ConsoleButton
          variant="primary"
          style={styles.submitButton}
          onPress={() => {
            void onSubmitQuickIncident();
          }}
          loading={submitting}
          disabled={submitting}
          label="Crear incidencia"
          textStyle={styles.submitButtonText}
        />
      </SectionCard>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  centerContainer: {
    flex: 1,
    padding: spacing.s20,
    alignItems: "center",
    justifyContent: "center",
  },
  container: {
    padding: spacing.s20,
    gap: spacing.s12,
  },
  caseList: {
    gap: spacing.s8,
  },
  caseOption: {
    minHeight: 64,
    borderRadius: radii.r12,
    alignItems: "flex-start",
    justifyContent: "center",
    paddingHorizontal: spacing.s12,
    paddingVertical: spacing.s10,
  },
  caseTitle: {
    fontFamily: fontFamilies.semibold,
    ...typeScale.body,
  },
  refreshButton: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: radii.r10,
    minHeight: 56,
    justifyContent: "center",
  },
  refreshButtonText: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
  input: {
    borderWidth: 1,
    borderRadius: radii.r12,
    paddingHorizontal: spacing.s12,
    paddingVertical: spacing.s11,
    fontFamily: inputFontFamily,
    ...typeScale.body,
  },
  problemInput: {
    minHeight: 120,
    textAlignVertical: "top",
  },
  severityWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.s8,
  },
  severityButton: {
    minHeight: 64,
    borderRadius: radii.r12,
    paddingHorizontal: spacing.s14,
    paddingVertical: spacing.s12,
  },
  severityButtonText: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
  helperText: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
  submitButton: {
    minHeight: 64,
    borderRadius: radii.r12,
    justifyContent: "center",
    paddingVertical: spacing.s12,
  },
  submitButtonText: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
});
