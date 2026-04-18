import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { extractApiError } from "@/src/api/client";
import ConsoleButton from "@/src/components/ConsoleButton";
import EmptyStateCard from "@/src/components/EmptyStateCard";
import InlineFeedback from "@/src/components/InlineFeedback";
import ScreenHero from "@/src/components/ScreenHero";
import ScreenScaffold from "@/src/components/ScreenScaffold";
import SectionCard from "@/src/components/SectionCard";
import WebInlineLoginCard from "@/src/components/WebInlineLoginCard";
import { canReachConfiguredApi } from "@/src/services/network/api-connectivity";
import { enqueueCreateCase } from "@/src/services/sync/case-outbox-service";
import { enqueueCreateIncident } from "@/src/services/sync/incident-outbox-service";
import { runSyncAsync } from "@/src/services/sync/sync-runner";
import { useSharedWebSessionState } from "@/src/session/web-session-store";
import { getStoredWebAccessUsername } from "@/src/storage/secure";
import { radii, sizing, spacing } from "@/src/theme/layout";
import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies, inputFontFamily, typeScale } from "@/src/theme/typography";
import { type IncidentSeverity } from "@/src/types/api";

const MIN_TOUCH_TARGET_SIZE = sizing.touchTargetMin;

const SEVERITY_OPTIONS: Array<{
  value: IncidentSeverity;
  label: string;
  helper: string;
}> = [
  { value: "low", label: "Baja", helper: "Seguimiento simple o consulta sin bloqueo." },
  { value: "medium", label: "Media", helper: "Afecta la operacion y conviene resolver hoy." },
  { value: "high", label: "Alta", helper: "Bloquea una tarea principal o varios usuarios." },
  { value: "critical", label: "Critica", helper: "Operacion detenida o riesgo alto." },
];

export default function ManualCaseScreen() {
  const palette = useAppPalette();
  const router = useRouter();
  const { checkingSession, hasActiveSession } = useSharedWebSessionState();
  const [clientName, setClientName] = useState("");
  const [caseNote, setCaseNote] = useState("");
  const [incidentNote, setIncidentNote] = useState("");
  const [reporterUsername, setReporterUsername] = useState("");
  const [severity, setSeverity] = useState<IncidentSeverity>("medium");
  const [submitting, setSubmitting] = useState(false);
  const [lastCreatedCaseId, setLastCreatedCaseId] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let mounted = true;
    void getStoredWebAccessUsername().then((storedUsername) => {
      if (!mounted || !storedUsername) return;
      setReporterUsername(storedUsername);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const submitLabel = useMemo(() => {
    return incidentNote.trim() ? "Iniciar caso y crear incidencia" : "Iniciar caso";
  }, [incidentNote]);

  const onSubmit = async () => {
    if (!hasActiveSession || submitting) return;

    try {
      setSubmitting(true);
      setErrorMessage("");
      const online = await canReachConfiguredApi();
      const queuedCase = await enqueueCreateCase({
        clientName: clientName.trim() || "Sin cliente",
        notes: caseNote.trim(),
        status: "manual",
        driverBrand: "Caso manual",
        driverVersion: "Sin equipo",
        driverDescription: "Caso iniciado desde mobile sin equipo asociado",
        osInfo: "mobile",
        installationTimeSeconds: 0,
      });

      let queuedIncident:
        | {
            localId: string;
            jobId: string;
          }
        | null = null;

      if (incidentNote.trim()) {
        queuedIncident = await enqueueCreateIncident({
          installationId: 0,
          remoteInstallationId: null,
          localCaseLocalId: queuedCase.localId,
          dependsOnJobId: queuedCase.jobId,
          note: incidentNote.trim(),
          reporterUsername: reporterUsername.trim() || "mobile_user",
          severity,
          source: "mobile",
          timeAdjustmentSeconds: 0,
          gps: {
            status: "pending",
            source: "none",
            note: "Pendiente de contexto remoto",
          },
        });
      }

      if (online) {
        await runSyncAsync({ force: true });
      }

      const { casesRepository } = await import("@/src/db/repositories/cases-repository");
      const queuedLocalCase = await casesRepository.getByLocalId(queuedCase.localId);
      const remoteInstallationId = Number(queuedLocalCase?.remoteId || 0);
      if (remoteInstallationId > 0) {
        setLastCreatedCaseId(remoteInstallationId);
      }

      if (!queuedIncident) {
        if (remoteInstallationId > 0) {
          router.replace(`/incident/create?installationId=${remoteInstallationId}` as never);
          return;
        }

        router.replace(`/incident/create?localCaseLocalId=${encodeURIComponent(queuedCase.localId)}` as never);
        return;
      }

      const { incidentsRepository } = await import("@/src/db/repositories/incidents-repository");
      const queuedLocalIncident = await incidentsRepository.getByLocalId(queuedIncident.localId);
      const remoteIncidentId = Number(queuedLocalIncident?.remoteId || 0);

      if (remoteInstallationId > 0 && remoteIncidentId > 0) {
        router.replace(
          `/incident/upload?incidentId=${remoteIncidentId}&installationId=${remoteInstallationId}` as never,
        );
        return;
      }

      const uploadParams = new URLSearchParams({
        localIncidentLocalId: queuedIncident.localId,
        incidentJobId: queuedIncident.jobId,
      });
      if (remoteInstallationId > 0) {
        uploadParams.set("installationId", String(remoteInstallationId));
      }

      router.replace(`/incident/upload?${uploadParams.toString()}` as never);
    } catch (error) {
      setLastCreatedCaseId(null);
      setErrorMessage(extractApiError(error));
    } finally {
      setSubmitting(false);
    }
  };

  if (checkingSession) {
    return (
      <ScreenScaffold scroll={false} centered contentContainerStyle={styles.centerContainer}>
        <ActivityIndicator size="large" color={palette.loadingSpinner} />
        <Text style={[styles.authHintText, { color: palette.textSecondary }]}>
          Preparando alta manual...
        </Text>
      </ScreenScaffold>
    );
  }

  if (!hasActiveSession) {
    return (
      <ScreenScaffold scroll={false} centered contentContainerStyle={styles.centerContainer}>
        <WebInlineLoginCard
          hint="Inicia sesion web para abrir casos manuales e incidencias."
          onLoginSuccess={async () => undefined}
          onOpenAdvanced={() => router.push("/modal?focus=login")}
        />
      </ScreenScaffold>
    );
  }

  return (
    <ScreenScaffold contentContainerStyle={styles.container}>
      <ScreenHero
        eyebrow="Caso manual"
        title="Iniciar trabajo sin equipo"
        description="Cuando no hay equipo registrado, el caso sigue siendo la base. Si ya conoces el problema, puedes crear la primera incidencia en la misma accion."
      />

      {errorMessage ? <InlineFeedback message={errorMessage} tone="error" /> : null}

      <SectionCard
        title="Datos minimos del caso"
        description="El caso ordena el trabajo. El cliente y el contexto inicial quedan listos antes de abrir el seguimiento."
      >
        <Text style={[styles.label, { color: palette.label }]}>Cliente</Text>
        <TextInput
          value={clientName}
          onChangeText={setClientName}
          style={[
            styles.input,
            { backgroundColor: palette.inputBg, borderColor: palette.inputBorder, color: palette.textPrimary },
          ]}
          placeholder="Cliente o area"
          placeholderTextColor={palette.placeholder}
          accessibilityLabel="Cliente del caso manual"
        />

        <Text style={[styles.label, { color: palette.label }]}>Contexto del caso</Text>
        <TextInput
          value={caseNote}
          onChangeText={setCaseNote}
          style={[
            styles.input,
            styles.multilineInput,
            { backgroundColor: palette.inputBg, borderColor: palette.inputBorder, color: palette.textPrimary },
          ]}
          multiline
          placeholder="Describe por que se abre este trabajo"
          placeholderTextColor={palette.placeholder}
          accessibilityLabel="Contexto del caso manual"
        />
      </SectionCard>

      <SectionCard
        title="Primera incidencia"
        description="Opcional. Si ya sabes cual es el problema, la app crea el caso y la primera incidencia juntas."
      >
        <Text style={[styles.label, { color: palette.label }]}>Problema inicial</Text>
        <TextInput
          value={incidentNote}
          onChangeText={setIncidentNote}
          style={[
            styles.input,
            styles.multilineInput,
            { backgroundColor: palette.inputBg, borderColor: palette.inputBorder, color: palette.textPrimary },
          ]}
          multiline
          placeholder="Describe la incidencia inicial"
          placeholderTextColor={palette.placeholder}
          accessibilityLabel="Nota inicial de la incidencia"
        />

        <Text style={[styles.label, { color: palette.label }]}>Severidad</Text>
        <View style={styles.severityList}>
          {SEVERITY_OPTIONS.map((item) => {
            const selected = severity === item.value;
            return (
              <ConsoleButton
                key={item.value}
                variant={selected ? "primary" : "subtle"}
                style={styles.severityOption}
                onPress={() => setSeverity(item.value)}
                accessibilityLabel={`Seleccionar severidad ${item.label}`}
                accessibilityState={{ selected }}
              >
                <Text
                  style={[
                    styles.severityLabel,
                    {
                      color: selected ? palette.primaryButtonText : palette.severityLabel,
                    },
                  ]}
                >
                  {item.label}
                </Text>
                <Text
                  style={[
                    styles.severityHelper,
                    {
                      color: selected ? palette.primaryButtonText : palette.severityCriteria,
                    },
                  ]}
                >
                  {item.helper}
                </Text>
              </ConsoleButton>
            );
          })}
        </View>
      </SectionCard>

      <SectionCard
        title="Guardar"
        description="Si no completas la incidencia inicial, al guardar pasaras directo a la pantalla de nueva incidencia dentro del caso creado."
      >
        {lastCreatedCaseId ? (
          <EmptyStateCard
            title={`Caso #${lastCreatedCaseId} creado`}
            body="La app esta llevando el flujo al siguiente paso."
          />
        ) : null}
        <ConsoleButton
          variant="primary"
          style={[styles.primaryButton, submitting && styles.disabled]}
          onPress={() => {
            void onSubmit();
          }}
          loading={submitting}
          accessibilityLabel={submitLabel}
          accessibilityState={{ disabled: submitting, busy: submitting }}
          label={submitLabel}
          textStyle={styles.primaryButtonText}
        />
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
    padding: spacing.s22,
    gap: spacing.s12,
  },
  authHintText: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fontFamilies.regular,
  },
  label: {
    ...typeScale.buttonMono,
    fontFamily: fontFamilies.mono,
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
  multilineInput: {
    minHeight: 104,
    textAlignVertical: "top",
  },
  severityList: {
    gap: spacing.s8,
  },
  severityOption: {
    borderRadius: radii.r10,
    paddingHorizontal: spacing.s12,
    paddingVertical: spacing.s10,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    gap: spacing.s4,
    alignItems: "flex-start",
  },
  severityLabel: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
  severityHelper: {
    fontFamily: fontFamilies.regular,
    ...typeScale.bodyCompact,
  },
  primaryButton: {
    minHeight: MIN_TOUCH_TARGET_SIZE,
    borderRadius: radii.r10,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.s13,
    paddingHorizontal: spacing.s14,
  },
  primaryButtonText: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
  disabled: {
    opacity: 0.72,
  },
});
