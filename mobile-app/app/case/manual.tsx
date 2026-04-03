import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { extractApiError } from "@/src/api/client";
import {
  createIncident,
  createInstallationRecord,
} from "@/src/api/incidents";
import EmptyStateCard from "@/src/components/EmptyStateCard";
import InlineFeedback from "@/src/components/InlineFeedback";
import ScreenHero from "@/src/components/ScreenHero";
import ScreenScaffold from "@/src/components/ScreenScaffold";
import SectionCard from "@/src/components/SectionCard";
import WebInlineLoginCard from "@/src/components/WebInlineLoginCard";
import { enqueueCreateCase } from "@/src/services/sync/case-outbox-service";
import { enqueueCreateIncident } from "@/src/services/sync/incident-outbox-service";
import { runSync } from "@/src/services/sync/sync-runner";
import { useSharedWebSessionState } from "@/src/session/web-session-store";
import { getStoredWebAccessUsername } from "@/src/storage/secure";
import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies } from "@/src/theme/typography";
import { type IncidentSeverity } from "@/src/types/api";

const MIN_TOUCH_TARGET_SIZE = 44;

async function isOnline(): Promise<boolean> {
  try {
    const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL ?? "";
    if (!apiBase) return true;
    await fetch(`${apiBase}/health`, { method: "HEAD", signal: AbortSignal.timeout(3000) });
    return true;
  } catch {
    return false;
  }
}

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
      const online = await isOnline();

      if (!online) {
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

        if (incidentNote.trim()) {
          await enqueueCreateIncident({
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

        runSync();
        router.replace("/(tabs)" as never);
        return;
      }

      const createdCase = await createInstallationRecord({
        client_name: clientName.trim() || "Sin cliente",
        notes: caseNote.trim(),
        status: "manual",
        driver_brand: "Caso manual",
        driver_version: "Sin equipo",
        driver_description: "Caso iniciado desde mobile sin equipo asociado",
        os_info: "mobile",
        installation_time_seconds: 0,
      });

      setLastCreatedCaseId(createdCase.record.id);

      if (!incidentNote.trim()) {
        router.replace(`/incident/create?installationId=${createdCase.record.id}` as never);
        return;
      }

      const createdIncident = await createIncident(createdCase.record.id, {
        note: incidentNote.trim(),
        reporter_username: reporterUsername.trim() || "mobile_user",
        severity,
        source: "mobile",
        time_adjustment_seconds: 0,
        apply_to_installation: false,
      });

      router.replace(
        `/incident/upload?incidentId=${createdIncident.incident.id}&installationId=${createdCase.record.id}` as never,
      );
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
              <TouchableOpacity
                key={item.value}
                style={[
                  styles.severityOption,
                  {
                    backgroundColor: selected ? palette.primaryButtonBg : palette.severityBg,
                    borderColor: selected ? palette.primaryButtonBg : palette.severityBorder,
                  },
                ]}
                onPress={() => setSeverity(item.value)}
                accessibilityRole="button"
                accessibilityLabel={`Seleccionar severidad ${item.label}`}
                accessibilityState={{ selected }}
              >
                <Text
                  style={[
                    styles.severityLabel,
                    {
                      color: selected ? palette.primaryButtonText : palette.textPrimary,
                    },
                  ]}
                >
                  {item.label}
                </Text>
                <Text
                  style={[
                    styles.severityHelper,
                    {
                      color: selected ? palette.primaryButtonText : palette.textSecondary,
                    },
                  ]}
                >
                  {item.helper}
                </Text>
              </TouchableOpacity>
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
        <TouchableOpacity
          style={[
            styles.primaryButton,
            { backgroundColor: palette.primaryButtonBg },
            submitting && styles.disabled,
          ]}
          onPress={() => {
            void onSubmit();
          }}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel={submitLabel}
          accessibilityState={{ disabled: submitting, busy: submitting }}
        >
          {submitting ? (
            <ActivityIndicator color={palette.primaryButtonText} />
          ) : (
            <Text style={[styles.primaryButtonText, { color: palette.primaryButtonText }]}>
              {submitLabel}
            </Text>
          )}
        </TouchableOpacity>
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
  label: {
    fontSize: 13.5,
    fontFamily: fontFamilies.semibold,
  },
  input: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  multilineInput: {
    minHeight: 104,
    textAlignVertical: "top",
  },
  severityList: {
    gap: 8,
  },
  severityOption: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 11,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    gap: 4,
  },
  severityLabel: {
    fontFamily: fontFamilies.bold,
    fontSize: 13.5,
  },
  severityHelper: {
    fontFamily: fontFamilies.regular,
    fontSize: 12.5,
    lineHeight: 18,
  },
  primaryButton: {
    minHeight: MIN_TOUCH_TARGET_SIZE,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  primaryButtonText: {
    fontFamily: fontFamilies.bold,
    fontSize: 15,
  },
  disabled: {
    opacity: 0.72,
  },
});
