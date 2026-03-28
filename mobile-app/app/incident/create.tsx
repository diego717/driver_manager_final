import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import {
  linkAssetToInstallation,
  resolveAssetByExternalCode,
} from "@/src/api/assets";
import { extractApiError } from "@/src/api/client";
import { listInstallations } from "@/src/api/incidents";
import EmptyStateCard from "@/src/components/EmptyStateCard";
import InlineFeedback, { type InlineFeedbackTone } from "@/src/components/InlineFeedback";
import ScreenHero from "@/src/components/ScreenHero";
import ScreenScaffold from "@/src/components/ScreenScaffold";
import SectionCard from "@/src/components/SectionCard";
import StatusChip from "@/src/components/StatusChip";
import SyncStatusBanner from "@/src/components/SyncStatusBanner";
import WebInlineLoginCard from "@/src/components/WebInlineLoginCard";
import { captureCurrentGpsSnapshot } from "@/src/services/location";
import { enqueueCreateIncident, registerIncidentExecutors } from "@/src/services/sync/incident-outbox-service";
import { runSync } from "@/src/services/sync/sync-runner";
import { useSharedWebSessionState } from "@/src/session/web-session-store";
import { getStoredWebAccessUsername } from "@/src/storage/secure";
import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies, inputFontFamily, textInputAccentColor } from "@/src/theme/typography";
import {
  type GpsCapturePayload,
  type IncidentSeverity,
  type InstallationRecord,
} from "@/src/types/api";
import {
  evaluateGeofencePreview,
  formatGeofenceSummary,
  formatGpsStatusLabel,
  formatGpsSummary,
  hasInstallationSiteConfig,
} from "@/src/utils/gps";

// Register sync executor once
registerIncidentExecutors();

/** Lightweight connectivity probe — no extra dependencies needed */
async function isOnline(): Promise<boolean> {
  try {
    const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL ?? "";
    if (!apiBase) return true; // assume online if no base configured
    await fetch(`${apiBase}/health`, { method: "HEAD", signal: AbortSignal.timeout(3000) });
    return true;
  } catch {
    return false;
  }
}

const MIN_TOUCH_TARGET_SIZE = 44;

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
    assetExternalCode?: string | string[];
    assetRecordId?: string | string[];
  }>();
  const palette = useAppPalette();
  const { checkingSession, hasActiveSession } = useSharedWebSessionState();
  const [installations, setInstallations] = useState<InstallationRecord[]>([]);
  const [reporterUsername, setReporterUsername] = useState("");
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
  const geofencePreview = useMemo(
    () => evaluateGeofencePreview(gpsSnapshot, selectedCase),
    [gpsSnapshot, selectedCase],
  );
  const hasSiteConfig = useMemo(() => hasInstallationSiteConfig(selectedCase), [selectedCase]);
  const requiresGpsOverride = gpsSnapshot.status !== "captured";
  const requiresGeofenceOverride = gpsSnapshot.status === "captured" && geofencePreview.result === "outside";
  const showGpsOverrideField = requiresGpsOverride || requiresGeofenceOverride;

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
      if (!hasActiveSession || !installationId) return;
      void loadCases();
      void captureGps({ silent: true });
    }, [captureGps, hasActiveSession, installationId, loadCases]),
  );

  useEffect(() => {
    return () => {
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current);
      }
    };
  }, []);

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

  const onSubmit = async () => {
    if (!hasActiveSession || !installationId) return;

    if (!note.trim()) {
      notify("warning", "Escribe la incidencia antes de guardar.");
      return;
    }

    let gpsPayload: GpsCapturePayload = gpsSnapshot;
    let geofenceOverrideNote = "";
    const normalizedOverride = gpsOverrideNote.trim();
    if (gpsSnapshot.status !== "captured") {
      if (!normalizedOverride) {
        notify("warning", "Si no hay GPS valido, registra un motivo de override antes de guardar.");
        return;
      }
      gpsPayload = {
        status: "override",
        source: "override",
        note: normalizedOverride,
      };
    } else if (geofencePreview.result === "outside") {
      if (!normalizedOverride) {
        notify("warning", "La captura GPS quedo fuera del radio. Debes justificar la excepcion.");
        return;
      }
      geofenceOverrideNote = normalizedOverride;
    }

    try {
      setSubmitting(true);

      // ── Local-first: save to WatermelonDB and enqueue a sync job ──
      const { localId } = await enqueueCreateIncident({
        installationId,
        note: note.trim(),
        reporterUsername: reporterUsername.trim() || "mobile_user",
        timeAdjustmentSeconds: 0,
        severity,
        source: "mobile",
        gps: gpsPayload,
        geofenceOverrideNote,
      });

      setLastCreatedIncidentId(localId as unknown as number); // localId used for navigation
      setNote("");

      // ── Connectivity-aware feedback ──
      const online = await isOnline();
      if (online) {
        notify("success", "Incidencia guardada. Sincronizando con el servidor...");
        // Non-blocking flush — the engine has a re-entrancy guard
        runSync();
      } else {
        notify("info" as InlineFeedbackTone, "Incidencia guardada en el dispositivo. Pendiente de sincronizar.");
      }

      // Asset link (best-effort, only if online and a code was provided)
      if (online && assetExternalCode.trim()) {
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
            await loadCases();
          }}
          onOpenAdvanced={() => router.push("/modal?focus=login")}
        />
      </ScreenScaffold>
    );
  }

  if (!installationId) {
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
          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: palette.primaryButtonBg }]}
            onPress={() => router.replace("/case/context" as never)}
            accessibilityRole="button"
            accessibilityLabel="Abrir el flujo para resolver el caso"
          >
            <Text style={[styles.primaryButtonText, { color: palette.primaryButtonText }]}>
              Resolver caso
            </Text>
          </TouchableOpacity>
        </SectionCard>
      </ScreenScaffold>
    );
  }

  return (
    <ScreenScaffold contentContainerStyle={styles.container}>
      <ScreenHero
        eyebrow="Nueva incidencia"
        title={`Caso #${installationId}`}
        description="El caso ya esta resuelto. Aqui solo cargas el problema."
      >
        <View style={styles.heroMetaRow}>
          <View
            style={[
              styles.heroMetaChip,
              { backgroundColor: palette.heroEyebrowBg, borderColor: palette.heroBorder },
            ]}
          >
            <Text style={[styles.heroMetaText, { color: palette.heroEyebrowText }]}>
              {selectedCase?.client_name || "Sin cliente"}
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
        title="Caso listo"
        description="Contexto fijo para esta incidencia."
        aside={
          loadingCase ? (
            <ActivityIndicator size="small" color={palette.loadingSpinner} />
          ) : selectedCase ? (
            <StatusChip kind="attention" value={selectedCase.attention_state} />
          ) : undefined
        }
      >
        {selectedCase ? (
          <View style={styles.caseSummaryCard}>
            <Text style={[styles.caseTitle, { color: palette.textPrimary }]}>
              #{selectedCase.id} {selectedCase.client_name ? `- ${selectedCase.client_name}` : ""}
            </Text>
            <Text style={[styles.caseBody, { color: palette.textSecondary }]}>
              {assetExternalCode
                ? `Equipo asociado: ${assetExternalCode}.`
                : "Caso manual o sin equipo asociado confirmado."}
            </Text>
            <View style={styles.contextActionRow}>
              <TouchableOpacity
                style={[
                  styles.secondaryButton,
                  { backgroundColor: palette.secondaryButtonBg, borderColor: palette.inputBorder },
                ]}
                onPress={() => router.push(`/work?installationId=${installationId}` as never)}
                accessibilityRole="button"
                accessibilityLabel={`Abrir el caso ${installationId}`}
              >
                <Text style={[styles.secondaryButtonText, { color: palette.secondaryButtonText }]}>
                  Abrir backlog
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.ghostButton,
                  { backgroundColor: palette.refreshBg, borderColor: palette.inputBorder },
                ]}
                onPress={() =>
                  router.replace(
                    `/case/context?installationId=${installationId}${assetExternalCode ? `&assetExternalCode=${encodeURIComponent(assetExternalCode)}` : ""}${assetRecordId ? `&assetRecordId=${assetRecordId}` : ""}` as never,
                  )
                }
                accessibilityRole="button"
                accessibilityLabel="Cambiar el caso resuelto"
              >
            <Text style={[styles.ghostButtonText, { color: palette.refreshText }]}>
                  Cambiar contexto
                </Text>
              </TouchableOpacity>
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
        title="GPS y geofence"
        description="La incidencia intenta registrar ubicacion y compararla contra el sitio configurado del caso."
        aside={
          <TouchableOpacity
            style={[
              styles.ghostButton,
              { backgroundColor: palette.refreshBg, borderColor: palette.inputBorder },
              capturingGps && styles.buttonDisabled,
            ]}
            onPress={() => {
              void captureGps();
            }}
            disabled={capturingGps}
            accessibilityRole="button"
            accessibilityLabel="Recapturar ubicacion para la incidencia"
            accessibilityState={{ disabled: capturingGps, busy: capturingGps }}
          >
            {capturingGps ? (
              <ActivityIndicator size="small" color={palette.refreshText} />
            ) : (
              <Text style={[styles.ghostButtonText, { color: palette.refreshText }]}>Recapturar</Text>
            )}
          </TouchableOpacity>
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
          <Text
            style={[
              styles.gpsFootnote,
              {
                color:
                  geofencePreview.result === "outside"
                    ? palette.warningText
                    : geofencePreview.result === "inside"
                      ? palette.successText
                      : palette.textMuted,
              },
            ]}
          >
            {formatGeofenceSummary(geofencePreview)}
          </Text>
          {hasSiteConfig ? (
            <Text style={[styles.gpsFootnote, { color: palette.textMuted }]}>
              Sitio: {Number(selectedCase?.site_lat).toFixed(5)}, {Number(selectedCase?.site_lng).toFixed(5)} · radio{" "}
              {Math.round(Number(selectedCase?.site_radius_m) || 0)} m
            </Text>
          ) : null}
        </View>

        {showGpsOverrideField ? (
          <>
            <Text style={[styles.label, { color: palette.label }]}>
              {requiresGeofenceOverride ? "Motivo de excepcion geofence" : "Motivo de override GPS"}
            </Text>
            <TextInput
              value={gpsOverrideNote}
              onChangeText={setGpsOverrideNote}
              style={[
                styles.input,
                styles.overrideInput,
                {
                  backgroundColor: palette.inputBg,
                  borderColor: requiresGeofenceOverride ? palette.warningText : palette.inputBorder,
                  color: palette.textPrimary,
                },
              ]}
              multiline
              placeholder={
                requiresGeofenceOverride
                  ? "Explica por que registras la incidencia fuera del radio configurado."
                  : "Explica por que registras la incidencia sin coordenadas validas."
              }
              placeholderTextColor={palette.placeholder}
              selectionColor={textInputAccentColor}
              cursorColor={textInputAccentColor}
              accessibilityLabel={
                requiresGeofenceOverride ? "Motivo de excepcion geofence" : "Motivo de override GPS"
              }
            />
            <Text
              style={[
                styles.gpsFootnote,
                { color: requiresGeofenceOverride ? palette.warningText : palette.textMuted },
              ]}
            >
              {requiresGeofenceOverride
                ? "Si la politica hard geofence esta activa en web, esta justificacion evita el bloqueo."
                : "Solo se usa cuando el telefono no entrega una ubicacion util para auditar la incidencia."}
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
              <TouchableOpacity
                key={item.value}
                style={[
                  styles.severityChip,
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
                    styles.severityChipLabel,
                    { color: selected ? palette.primaryButtonText : palette.textPrimary },
                  ]}
                >
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity
          style={[
            styles.primaryButton,
            { backgroundColor: palette.primaryButtonBg },
            submitting && styles.buttonDisabled,
          ]}
          onPress={() => {
            void onSubmit();
          }}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel="Crear incidencia"
          accessibilityState={{ disabled: submitting, busy: submitting }}
        >
          {submitting ? (
            <ActivityIndicator color={palette.primaryButtonText} />
          ) : (
            <Text style={[styles.primaryButtonText, { color: palette.primaryButtonText }]}>
              Crear incidencia
            </Text>
          )}
        </TouchableOpacity>
      </SectionCard>

      {lastCreatedIncidentId ? (
        <SectionCard
          title="Siguiente paso"
          description="La incidencia esta guardada. Avanza al backlog del caso o carga evidencia cuando tengas red."
        >
          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: palette.primaryButtonBg }]}
            onPress={() =>
              router.push(
                `/work?installationId=${installationId}` as never,
              )
            }
            accessibilityRole="button"
            accessibilityLabel="Ver backlog del caso"
          >
            <Text style={[styles.primaryButtonText, { color: palette.primaryButtonText }]}>
              Ver backlog del caso
            </Text>
          </TouchableOpacity>
        </SectionCard>
      ) : null}
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
    fontFamily: fontFamilies.semibold,
    fontSize: 12,
  },
  caseSummaryCard: {
    gap: 12,
  },
  caseTitle: {
    fontFamily: fontFamilies.bold,
    fontSize: 17,
    lineHeight: 22,
  },
  caseBody: {
    fontFamily: fontFamilies.regular,
    fontSize: 13,
    lineHeight: 19,
  },
  gpsCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    gap: 6,
  },
  gpsTitle: {
    fontFamily: fontFamilies.bold,
    fontSize: 15,
    lineHeight: 20,
  },
  gpsBody: {
    fontFamily: fontFamilies.regular,
    fontSize: 13,
    lineHeight: 18,
  },
  gpsFootnote: {
    fontFamily: fontFamilies.medium,
    fontSize: 12.5,
    lineHeight: 17,
  },
  contextActionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  reporterText: {
    fontFamily: fontFamilies.regular,
    fontSize: 12.5,
    lineHeight: 18,
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
    fontFamily: inputFontFamily,
    fontSize: 14,
    lineHeight: 19,
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
    gap: 8,
  },
  severityChip: {
    minWidth: 92,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 11,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  severityChipLabel: {
    fontFamily: fontFamilies.bold,
    fontSize: 13.5,
  },
  primaryButton: {
    minHeight: MIN_TOUCH_TARGET_SIZE,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  secondaryButton: {
    minHeight: MIN_TOUCH_TARGET_SIZE,
    borderWidth: 1,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  ghostButton: {
    minHeight: MIN_TOUCH_TARGET_SIZE,
    borderWidth: 1,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  primaryButtonText: {
    fontFamily: fontFamilies.bold,
    fontSize: 14.5,
  },
  secondaryButtonText: {
    fontFamily: fontFamilies.bold,
    fontSize: 13.5,
  },
  ghostButtonText: {
    fontFamily: fontFamilies.semibold,
    fontSize: 13.5,
  },
  buttonDisabled: {
    opacity: 0.72,
  },
});
