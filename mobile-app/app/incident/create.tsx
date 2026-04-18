import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  linkAssetToInstallation,
  resolveAssetByExternalCode,
} from "@/src/api/assets";
import { extractApiError } from "@/src/api/client";
import { listInstallations } from "@/src/api/incidents";
import { getCurrentLinkedTechnicianContext } from "@/src/api/technicians";
import ConsoleButton from "@/src/components/ConsoleButton";
import EmptyStateCard from "@/src/components/EmptyStateCard";
import InlineFeedback, { type InlineFeedbackTone } from "@/src/components/InlineFeedback";
import ScreenHero from "@/src/components/ScreenHero";
import ScreenScaffold from "@/src/components/ScreenScaffold";
import SectionCard from "@/src/components/SectionCard";
import StatusChip from "@/src/components/StatusChip";
import SyncStatusBanner from "@/src/components/SyncStatusBanner";
import WebInlineLoginCard from "@/src/components/WebInlineLoginCard";
import { triggerSuccessHaptic, triggerWarningHaptic } from "@/src/services/haptics";
import { captureCurrentGpsSnapshot } from "@/src/services/location";
import { canReachConfiguredApi } from "@/src/services/network/api-connectivity";
import { enqueueCreateIncident, registerIncidentExecutors } from "@/src/services/sync/incident-outbox-service";
import { runSync } from "@/src/services/sync/sync-runner";
import { useSharedWebSessionState } from "@/src/session/web-session-store";
import { radii, sizing, spacing } from "@/src/theme/layout";
import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies, inputFontFamily, textInputAccentColor, typeScale } from "@/src/theme/typography";
import {
  type GpsCapturePayload,
  type IncidentSeverity,
  type InstallationRecord,
  type TechnicianRecord,
} from "@/src/types/api";
import {
  formatGpsStatusLabel,
  formatGpsSummary,
} from "@/src/utils/gps";

// Register sync executor once
registerIncidentExecutors();

/** Lightweight connectivity probe — no extra dependencies needed */
async function isOnline(): Promise<boolean> {
  return canReachConfiguredApi();
}

const MIN_TOUCH_TARGET_SIZE = sizing.touchTargetMin;

const SEVERITY_OPTIONS: Array<{
  value: IncidentSeverity;
  label: string;
}> = [
  {
    value: "low",
    label: "Baja",
  },
  {
    value: "medium",
    label: "Media",
  },
  {
    value: "high",
    label: "Alta",
  },
  {
    value: "critical",
    label: "Critica",
  },
];

type FeedbackState = {
  tone: InlineFeedbackTone;
  message: string;
} | null;

function normalizeRouteParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function parsePositiveInt(value: string | string[] | undefined): number | null {
  const normalized = normalizeRouteParam(value).trim();
  const parsed = Number.parseInt(normalized, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export default function CreateIncidentScreen() {
  const router = useRouter();
  const queryParams = useLocalSearchParams<{
    installationId?: string | string[];
    localCaseLocalId?: string | string[];
    assetExternalCode?: string | string[];
    assetRecordId?: string | string[];
  }>();
  const palette = useAppPalette();
  const { checkingSession, hasActiveSession } = useSharedWebSessionState();
  const [installations, setInstallations] = useState<InstallationRecord[]>([]);
  const [localCaseSummary, setLocalCaseSummary] = useState<{
    localId: string;
    clientName: string;
    notes: string;
  } | null>(null);
  const [reporterUsername, setReporterUsername] = useState("");
  const [linkedTechnician, setLinkedTechnician] = useState<TechnicianRecord | null>(null);
  const [note, setNote] = useState("");
  const [severity, setSeverity] = useState<IncidentSeverity>("medium");
  const [submitting, setSubmitting] = useState(false);
  const [loadingCase, setLoadingCase] = useState(false);
  const [capturingGps, setCapturingGps] = useState(false);
  const [gpsSnapshot, setGpsSnapshot] = useState<GpsCapturePayload>({
    status: "pending",
    source: "none",
    note: "",
  });
  const [gpsOverrideNote, setGpsOverrideNote] = useState("");
  const [feedbackMessage, setFeedbackMessage] = useState<FeedbackState>(null);
  const [lastCreatedIncidentId, setLastCreatedIncidentId] = useState<number | null>(null);
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const capturingGpsRef = useRef(false);

  const installationId = useMemo(
    () => parsePositiveInt(queryParams.installationId),
    [queryParams.installationId],
  );
  const localCaseLocalId = useMemo(
    () => normalizeRouteParam(queryParams.localCaseLocalId).trim(),
    [queryParams.localCaseLocalId],
  );
  const assetExternalCode = useMemo(
    () => normalizeRouteParam(queryParams.assetExternalCode).trim(),
    [queryParams.assetExternalCode],
  );
  const assetRecordId = useMemo(
    () => parsePositiveInt(queryParams.assetRecordId),
    [queryParams.assetRecordId],
  );

  const selectedCase = useMemo(() => {
    if (!installationId) return null;
    return (
      installations.find((item) => item.id === installationId) || {
        id: installationId,
        client_name: "Caso cargado por contexto",
      }
    );
  }, [installationId, installations]);
  const selectedCaseLabel = selectedCase?.client_name || localCaseSummary?.clientName || "Sin cliente";
  const resolvedCaseTitle = installationId
    ? `Caso #${installationId}`
    : localCaseSummary
      ? "Caso local pendiente"
      : "Nueva incidencia";
  const requiresGpsOverride = gpsSnapshot.status !== "captured";
  const showGpsOverrideField = requiresGpsOverride;

  const clearFeedbackSoon = useCallback(() => {
    if (feedbackTimeoutRef.current) {
      clearTimeout(feedbackTimeoutRef.current);
    }
    feedbackTimeoutRef.current = setTimeout(() => {
      setFeedbackMessage(null);
      feedbackTimeoutRef.current = null;
    }, 5000);
  }, []);

  const notify = useCallback(
    (tone: InlineFeedbackTone, message: string) => {
      setFeedbackMessage({ tone, message });
      clearFeedbackSoon();
    },
    [clearFeedbackSoon],
  );

  const loadCases = useCallback(async () => {
    if (!hasActiveSession || !installationId) return;
    try {
      setLoadingCase(true);
      const records = await listInstallations({ forceRefresh: true });
      setInstallations(records);
    } catch (error) {
      notify("error", `No se pudo cargar el caso: ${extractApiError(error)}`);
    } finally {
      setLoadingCase(false);
    }
  }, [hasActiveSession, installationId, notify]);

  const loadLocalCaseSummary = useCallback(async () => {
    if (!hasActiveSession || !localCaseLocalId) {
      setLocalCaseSummary(null);
      return;
    }

    try {
      const { casesRepository } = await import("@/src/db/repositories/cases-repository");
      const localCase = await casesRepository.getByLocalId(localCaseLocalId);
      if (!localCase) {
        setLocalCaseSummary(null);
        return;
      }
      const sensitive = await casesRepository.resolveSensitiveFields(localCase);
      setLocalCaseSummary({
        localId: localCaseLocalId,
        clientName: sensitive.clientName || "Caso local",
        notes: sensitive.notes || "",
      });
    } catch {
      setLocalCaseSummary(null);
    }
  }, [hasActiveSession, localCaseLocalId]);

  const captureGps = useCallback(async (options?: { silent?: boolean }) => {
    if (capturingGpsRef.current) return;
    try {
      capturingGpsRef.current = true;
      setCapturingGps(true);
      const snapshot = await captureCurrentGpsSnapshot();
      setGpsSnapshot(snapshot);
      if (snapshot.status === "captured" && options?.silent !== true) {
        notify("info", "Ubicacion capturada para respaldar la incidencia.");
      }
    } catch (error) {
      setGpsSnapshot({
        status: "unavailable",
        source: "browser",
        note: extractApiError(error),
      });
    } finally {
      capturingGpsRef.current = false;
      setCapturingGps(false);
    }
  }, [notify]);

  useFocusEffect(
    useCallback(() => {
      if (!hasActiveSession) return;
      if (installationId) {
        void loadCases();
      }
      if (localCaseLocalId) {
        void loadLocalCaseSummary();
      }
      void captureGps({ silent: true });
    }, [captureGps, hasActiveSession, installationId, loadCases, loadLocalCaseSummary, localCaseLocalId]),
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
      setReporterUsername("");
      setLinkedTechnician(null);
      return;
    }

    let mounted = true;
    void getCurrentLinkedTechnicianContext()
      .then(({ user, technician }) => {
        if (!mounted) return;
        setLinkedTechnician(technician);
        setReporterUsername(
          String(technician?.display_name || user.username || "mobile_user").trim(),
        );
      })
      .catch(() => {
        if (!mounted) return;
        setReporterUsername("mobile_user");
        setLinkedTechnician(null);
      });
    return () => {
      mounted = false;
    };
  }, [hasActiveSession]);

  const onSubmit = async () => {
    if (!hasActiveSession || (!installationId && !localCaseLocalId)) return;

    if (!note.trim()) {
      void triggerWarningHaptic();
      notify("warning", "Escribe la incidencia antes de guardar.");
      return;
    }

    let gpsPayload: GpsCapturePayload = gpsSnapshot;
    const normalizedOverride = gpsOverrideNote.trim();
    if (gpsSnapshot.status !== "captured") {
      if (!normalizedOverride) {
        void triggerWarningHaptic();
        notify("warning", "Si no hay GPS valido, registra un motivo de override antes de guardar.");
        return;
      }
      gpsPayload = {
        status: "override",
        source: "override",
        note: normalizedOverride,
      };
    }

    try {
      setSubmitting(true);

      // ── Local-first: save to WatermelonDB and enqueue a sync job ──
      const { localId } = await enqueueCreateIncident({
        installationId: installationId ?? 0,
        remoteInstallationId: installationId ?? null,
        localCaseLocalId: localCaseLocalId || null,
        note: note.trim(),
        reporterUsername: reporterUsername.trim() || "mobile_user",
        timeAdjustmentSeconds: 0,
        severity,
        source: "mobile",
        gps: gpsPayload,
      });

      setLastCreatedIncidentId(localId as unknown as number); // localId used for navigation
      setNote("");

      // ── Connectivity-aware feedback ──
      const online = await isOnline();
      if (online) {
        void triggerSuccessHaptic();
        notify("success", "Incidencia guardada. Sincronizando con el servidor...");
        // Non-blocking flush — the engine has a re-entrancy guard
        runSync();
      } else {
        void triggerSuccessHaptic();
        notify("info" as InlineFeedbackTone, "Incidencia guardada en el dispositivo. Pendiente de sincronizar.");
      }

      // Asset link (best-effort, only if online and a code was provided)
      if (online && installationId && assetExternalCode.trim()) {
        try {
          let resolvedAssetId = assetRecordId;
          if (!resolvedAssetId || resolvedAssetId <= 0) {
            const resolved = await resolveAssetByExternalCode(assetExternalCode);
            const resolvedId = Number(resolved.asset?.id);
            if (!Number.isInteger(resolvedId) || resolvedId <= 0) {
              throw new Error("No se obtuvo asset_id valido para el equipo.");
            }
            resolvedAssetId = resolvedId;
          }
          await linkAssetToInstallation(
            resolvedAssetId,
            installationId,
            `Vinculado al crear incidencia (${localId}) desde mobile`,
          );
        } catch (linkError) {
          const warn = extractApiError(linkError);
          notify("warning", `Incidencia guardada, pero no se pudo vincular el equipo: ${warn}`);
        }
      }
    } catch (error) {
      void triggerWarningHaptic();
      notify("error", `Error al guardar la incidencia: ${extractApiError(error)}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (checkingSession) {
    return (
      <ScreenScaffold scroll={false} centered contentContainerStyle={styles.centerContainer}>
        <ActivityIndicator size="large" color={palette.loadingSpinner} />
        <Text style={[styles.authHintText, { color: palette.textSecondary }]}>
          Preparando incidencia...
        </Text>
      </ScreenScaffold>
    );
  }

  if (!hasActiveSession) {
    return (
      <ScreenScaffold scroll={false} centered contentContainerStyle={styles.centerContainer}>
        <WebInlineLoginCard
          hint="Inicia sesion web para crear incidencias dentro de un caso."
          onLoginSuccess={async () => {
            await Promise.all([
              installationId ? loadCases() : Promise.resolve(),
              localCaseLocalId ? loadLocalCaseSummary() : Promise.resolve(),
              captureGps({ silent: true }),
            ]);
          }}
          onOpenAdvanced={() => router.push("/modal?focus=login")}
        />
      </ScreenScaffold>
    );
  }

  if (!installationId && !localCaseLocalId) {
    return (
      <ScreenScaffold contentContainerStyle={styles.container}>
        <ScreenHero
          eyebrow="Nueva incidencia"
          title="Falta resolver el caso"
          description="La incidencia nueva solo se puede crear dentro de un caso ya resuelto."
        />
        <SectionCard
          title="Primero el contexto"
          description="Vuelve al flujo de inicio para elegir equipo, caso existente o caso manual."
        >
          <EmptyStateCard
            title="No hay caso seleccionado."
            body="La app necesita saber sobre que caso vas a trabajar antes de abrir la incidencia."
          />
          <ConsoleButton
            variant="primary"
            style={styles.primaryButton}
            onPress={() => router.replace("/case/context" as never)}
            accessibilityLabel="Abrir el flujo para resolver el caso"
            label="Resolver caso"
            textStyle={styles.primaryButtonText}
          />
        </SectionCard>
      </ScreenScaffold>
    );
  }

  return (
      <ScreenScaffold contentContainerStyle={styles.container}>
      <ScreenHero
        eyebrow="Nueva incidencia"
        title={resolvedCaseTitle}
        description={
          installationId
            ? "El caso ya esta resuelto. Aqui solo cargas el problema."
            : "La incidencia queda asociada al caso local y se sincroniza cuando el caso obtenga ID remoto."
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
              {selectedCaseLabel}
            </Text>
          </View>
          {assetExternalCode ? (
            <View
              style={[
                styles.heroMetaChip,
                { backgroundColor: palette.heroEyebrowBg, borderColor: palette.heroBorder },
              ]}
            >
              <Text style={[styles.heroMetaText, { color: palette.heroEyebrowText }]}>
                equipo {assetExternalCode}
              </Text>
            </View>
          ) : null}
        </View>
      </ScreenHero>

      {feedbackMessage ? (
        <InlineFeedback message={feedbackMessage.message} tone={feedbackMessage.tone} />
      ) : null}

      <SyncStatusBanner />

      <SectionCard
        title={installationId ? "Caso listo" : "Caso local"}
        description={
          installationId
            ? "Contexto fijo para esta incidencia."
            : "Este caso aun no termino de sincronizar, pero ya puedes cargar la incidencia."
        }
        aside={
          loadingCase ? (
            <ActivityIndicator size="small" color={palette.loadingSpinner} />
          ) : selectedCase ? (
            <StatusChip kind="attention" value={selectedCase.attention_state} />
          ) : undefined
        }
      >
        {selectedCase || localCaseSummary ? (
          <View style={styles.caseSummaryCard}>
            <Text style={[styles.caseTitle, { color: palette.textPrimary }]}>
              {installationId
                ? `#${selectedCase?.id} ${selectedCase?.client_name ? `- ${selectedCase.client_name}` : ""}`
                : `${localCaseSummary?.clientName || "Caso local"} · pendiente de sincronizar`}
            </Text>
            <Text style={[styles.caseBody, { color: palette.textSecondary }]}>
              {assetExternalCode
                ? `Equipo asociado: ${assetExternalCode}.`
                : installationId
                  ? "Caso manual o sin equipo asociado confirmado."
                  : (localCaseSummary?.notes?.trim() || "Caso manual guardado localmente.")}
            </Text>
            <View style={styles.contextActionRow}>
              {installationId ? (
                <ConsoleButton
                  variant="subtle"
                  style={styles.secondaryButton}
                  onPress={() => router.push(`/work?installationId=${installationId}` as never)}
                  accessibilityLabel={`Abrir el caso ${installationId}`}
                  label="Abrir backlog"
                  textStyle={styles.secondaryButtonText}
                />
              ) : null}
              <ConsoleButton
                variant="ghost"
                style={styles.ghostButton}
                onPress={() =>
                  router.replace(
                    installationId
                      ? `/case/context?installationId=${installationId}${assetExternalCode ? `&assetExternalCode=${encodeURIComponent(assetExternalCode)}` : ""}${assetRecordId ? `&assetRecordId=${assetRecordId}` : ""}` as never
                      : "/case/manual" as never,
                  )
                }
                accessibilityLabel={installationId ? "Cambiar el caso resuelto" : "Volver al caso manual"}
                label={installationId ? "Cambiar contexto" : "Volver al caso manual"}
                textStyle={styles.ghostButtonText}
              />
            </View>
          </View>
        ) : (
          <EmptyStateCard
            title="Todavia no se pudo cargar el caso."
            body="Refresca o vuelve al paso anterior para resolverlo otra vez."
          />
        )}
      </SectionCard>

      <SectionCard
        title="GPS"
        description="La incidencia intenta registrar tu ubicacion actual como respaldo operativo."
        aside={
          <ConsoleButton
            variant="ghost"
            size="sm"
            style={[styles.ghostButton, capturingGps && styles.buttonDisabled]}
            onPress={() => {
              void captureGps();
            }}
            loading={capturingGps}
            accessibilityLabel="Recapturar ubicacion para la incidencia"
            accessibilityState={{ disabled: capturingGps, busy: capturingGps }}
            label="Recapturar"
            textStyle={styles.ghostButtonText}
          />
        }
      >
        <View
          style={[
            styles.gpsCard,
            {
              backgroundColor:
                gpsSnapshot.status === "captured"
                  ? palette.infoBg
                  : gpsSnapshot.status === "override" || gpsSnapshot.status === "denied"
                    ? palette.warningBg
                    : palette.surfaceAlt,
              borderColor:
                gpsSnapshot.status === "captured"
                  ? palette.infoBorder
                  : gpsSnapshot.status === "override" || gpsSnapshot.status === "denied"
                    ? palette.warningText
                    : palette.border,
            },
          ]}
        >
          <Text style={[styles.gpsTitle, { color: palette.textPrimary }]}>
            {formatGpsStatusLabel(gpsSnapshot.status)}
          </Text>
          <Text style={[styles.gpsBody, { color: palette.textSecondary }]}>
            {formatGpsSummary(gpsSnapshot)}
          </Text>
        </View>

        {showGpsOverrideField ? (
          <>
            <Text style={[styles.label, { color: palette.label }]}>Motivo de override GPS</Text>
            <TextInput
              value={gpsOverrideNote}
              onChangeText={setGpsOverrideNote}
              style={[
                styles.input,
                styles.overrideInput,
                {
                  backgroundColor: palette.inputBg,
                  borderColor: palette.inputBorder,
                  color: palette.textPrimary,
                },
              ]}
              multiline
              placeholder="Explica por que registras la incidencia sin coordenadas validas."
              placeholderTextColor={palette.placeholder}
              selectionColor={textInputAccentColor}
              cursorColor={textInputAccentColor}
              accessibilityLabel="Motivo de override GPS"
            />
            <Text style={[styles.gpsFootnote, { color: palette.textMuted }]}>
              Solo se usa cuando el telefono no entrega una ubicacion util para auditar la incidencia.
            </Text>
          </>
        ) : null}
      </SectionCard>

      <SectionCard
        title="Incidencia"
        description="Solo lo necesario para crearla."
      >
        <Text style={[styles.reporterText, { color: palette.textSecondary }]}>
          Reporta: {reporterUsername || "mobile_user"}
        </Text>
        {linkedTechnician ? (
          <Text style={[styles.reporterText, { color: palette.textMuted }]}>
            Tecnico vinculado: {linkedTechnician.display_name}
            {linkedTechnician.employee_code ? ` · ${linkedTechnician.employee_code}` : ""}
          </Text>
        ) : null}

        <Text style={[styles.label, { color: palette.label }]}>Problema</Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          style={[
            styles.input,
            styles.noteInput,
            { backgroundColor: palette.inputBg, borderColor: palette.inputBorder, color: palette.textPrimary },
          ]}
          multiline
          placeholder="Describe la incidencia"
          placeholderTextColor={palette.placeholder}
          selectionColor={textInputAccentColor}
          cursorColor={textInputAccentColor}
          accessibilityLabel="Nota de la incidencia"
        />

        <View style={styles.severityWrap}>
          {SEVERITY_OPTIONS.map((item) => {
            const selected = severity === item.value;
            return (
              <ConsoleButton
                key={item.value}
                variant={selected ? "primary" : "subtle"}
                size="sm"
                style={styles.severityChip}
                onPress={() => setSeverity(item.value)}
                accessibilityLabel={`Seleccionar severidad ${item.label}`}
                accessibilityState={{ selected }}
              >
                <Text
                  style={[
                    styles.severityChipLabel,
                    { color: selected ? palette.primaryButtonText : palette.severityLabel },
                  ]}
                >
                  {item.label}
                </Text>
              </ConsoleButton>
            );
          })}
        </View>

        <ConsoleButton
          variant="primary"
          style={[styles.primaryButton, submitting && styles.buttonDisabled]}
          onPress={() => {
            void onSubmit();
          }}
          loading={submitting}
          accessibilityLabel="Crear incidencia"
          accessibilityState={{ disabled: submitting, busy: submitting }}
          label="Crear incidencia"
          textStyle={styles.primaryButtonText}
        />
      </SectionCard>

      {lastCreatedIncidentId ? (
        <SectionCard
          title="Siguiente paso"
          description="La incidencia esta guardada. Avanza al backlog del caso o carga evidencia cuando tengas red."
        >
          <ConsoleButton
            variant="primary"
            style={styles.primaryButton}
            onPress={() =>
              router.push(
                installationId
                  ? `/work?installationId=${installationId}` as never
                  : "/(tabs)" as never,
              )
            }
            accessibilityLabel={installationId ? "Ver backlog del caso" : "Volver al inicio"}
            label={installationId ? "Ver backlog del caso" : "Volver al inicio"}
            textStyle={styles.primaryButtonText}
          />
        </SectionCard>
      ) : null}
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
  caseSummaryCard: {
    gap: spacing.s12,
  },
  caseTitle: {
    fontFamily: fontFamilies.semibold,
    ...typeScale.titleStrong,
    fontSize: 18,
    lineHeight: 22,
  },
  caseBody: {
    fontFamily: fontFamilies.regular,
    ...typeScale.body,
  },
  gpsCard: {
    borderWidth: 1,
    borderRadius: radii.r14,
    padding: spacing.s14,
    gap: spacing.s6,
  },
  gpsTitle: {
    fontFamily: fontFamilies.semibold,
    ...typeScale.body,
  },
  gpsBody: {
    fontFamily: fontFamilies.regular,
    ...typeScale.bodyCompact,
  },
  gpsFootnote: {
    fontFamily: fontFamilies.medium,
    ...typeScale.bodyCompact,
  },
  contextActionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.s10,
  },
  reporterText: {
    fontFamily: fontFamilies.regular,
    ...typeScale.bodyCompact,
  },
  label: {
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
  noteInput: {
    minHeight: 120,
    textAlignVertical: "top",
  },
  overrideInput: {
    minHeight: 96,
    textAlignVertical: "top",
  },
  severityWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.s8,
  },
  severityChip: {
    minWidth: 92,
    borderRadius: radii.r10,
    paddingHorizontal: spacing.s12,
    paddingVertical: spacing.s10,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  severityChipLabel: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
  primaryButton: {
    minHeight: MIN_TOUCH_TARGET_SIZE,
    borderRadius: radii.r10,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.s13,
    paddingHorizontal: spacing.s14,
  },
  secondaryButton: {
    minHeight: MIN_TOUCH_TARGET_SIZE,
    borderRadius: radii.r10,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.s12,
    paddingHorizontal: spacing.s14,
  },
  ghostButton: {
    minHeight: MIN_TOUCH_TARGET_SIZE,
    borderRadius: radii.r10,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.s12,
    paddingHorizontal: spacing.s14,
  },
  primaryButtonText: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
  secondaryButtonText: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
  ghostButtonText: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
  buttonDisabled: {
    opacity: 0.72,
  },
});
