import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import {
  getAssetIncidents,
  linkAssetToInstallation,
  resolveAssetByExternalCode,
  type AssetIncidentsResponse,
} from "@/src/api/assets";
import { extractApiError } from "@/src/api/client";
import {
  createInstallationRecord,
  listIncidentsByInstallation,
  listInstallations,
} from "@/src/api/incidents";
import ConsoleButton from "@/src/components/ConsoleButton";
import EmptyStateCard from "@/src/components/EmptyStateCard";
import InlineFeedback, { type InlineFeedbackTone } from "@/src/components/InlineFeedback";
import ScreenHero from "@/src/components/ScreenHero";
import ScreenScaffold from "@/src/components/ScreenScaffold";
import SectionCard from "@/src/components/SectionCard";
import StatusChip from "@/src/components/StatusChip";
import WebInlineLoginCard from "@/src/components/WebInlineLoginCard";
import { canReachConfiguredApi } from "@/src/services/network/api-connectivity";
import { enqueueCreateCase } from "@/src/services/sync/case-outbox-service";
import { useSharedWebSessionState } from "@/src/session/web-session-store";
import { radii, spacing } from "@/src/theme/layout";
import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies, typeScale } from "@/src/theme/typography";
import { type Incident, type InstallationRecord } from "@/src/types/api";
import { deriveRecordIncidentSummary, normalizeIncidentStatus } from "@/src/utils/incidents";

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

function getIncidentSortWeight(incident: Pick<Incident, "incident_status" | "severity" | "created_at">): number {
  const status = normalizeIncidentStatus(incident.incident_status);
  const statusWeight =
    status === "in_progress" ? 0 : status === "paused" ? 1 : status === "open" ? 2 : 3;
  const severityWeight =
    incident.severity === "critical" ? 0 : incident.severity === "high" ? 1 : incident.severity === "medium" ? 2 : 3;
  const createdWeight = new Date(incident.created_at || 0).getTime();
  return statusWeight * 1_000_000_000 + severityWeight * 1_000_000 + createdWeight;
}

function pickLatestActiveIncident(incidents: Incident[]): Incident | null {
  const active = incidents.filter((item) => normalizeIncidentStatus(item.incident_status) !== "resolved");
  if (!active.length) return null;
  return [...active].sort((left, right) => getIncidentSortWeight(left) - getIncidentSortWeight(right))[0] || null;
}

export default function CaseContextScreen() {
  const router = useRouter();
  const palette = useAppPalette();
  const queryParams = useLocalSearchParams<{
    installationId?: string | string[];
    assetExternalCode?: string | string[];
    assetRecordId?: string | string[];
  }>();
  const { checkingSession, hasActiveSession } = useSharedWebSessionState();

  const [installations, setInstallations] = useState<InstallationRecord[]>([]);
  const [assetDetail, setAssetDetail] = useState<AssetIncidentsResponse | null>(null);
  const [resolvedAssetId, setResolvedAssetId] = useState<number | null>(parsePositiveInt(queryParams.assetRecordId));
  const [caseIncidents, setCaseIncidents] = useState<Incident[]>([]);
  const [loadingContext, setLoadingContext] = useState(false);
  const [loadingIncidents, setLoadingIncidents] = useState(false);
  const [creatingCase, setCreatingCase] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<FeedbackState>(null);
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const routeInstallationId = useMemo(
    () => parsePositiveInt(queryParams.installationId),
    [queryParams.installationId],
  );
  const routeAssetExternalCode = useMemo(
    () => normalizeRouteParam(queryParams.assetExternalCode).trim(),
    [queryParams.assetExternalCode],
  );

  const hasPrefilledContext = Boolean(routeInstallationId || routeAssetExternalCode || resolvedAssetId);

  const resolvedCaseId = useMemo(() => {
    if (routeInstallationId) return routeInstallationId;
    const linkedInstallationId = Number(assetDetail?.active_link?.installation_id);
    return Number.isInteger(linkedInstallationId) && linkedInstallationId > 0 ? linkedInstallationId : null;
  }, [assetDetail?.active_link?.installation_id, routeInstallationId]);

  const selectedCase = useMemo(() => {
    if (!resolvedCaseId) return null;
    return (
      installations.find((item) => item.id === resolvedCaseId) || {
        id: resolvedCaseId,
        client_name: assetDetail?.asset?.client_name || "Caso resuelto por contexto",
      }
    );
  }, [assetDetail?.asset?.client_name, installations, resolvedCaseId]);

  const selectedSummary = useMemo(
    () => deriveRecordIncidentSummary(selectedCase),
    [selectedCase],
  );

  const latestActiveIncident = useMemo(
    () => pickLatestActiveIncident(caseIncidents),
    [caseIncidents],
  );

  const canSendConformity = Boolean(selectedCase) && selectedSummary.active === 0;

  const notify = useCallback((tone: InlineFeedbackTone, message: string) => {
    setFeedbackMessage({ tone, message });
    if (feedbackTimeoutRef.current) {
      clearTimeout(feedbackTimeoutRef.current);
    }
    feedbackTimeoutRef.current = setTimeout(() => {
      setFeedbackMessage(null);
      feedbackTimeoutRef.current = null;
    }, 5000);
  }, []);

  const loadCaseIncidents = useCallback(async (installationId: number) => {
    if (!hasActiveSession) return;
    try {
      setLoadingIncidents(true);
      const response = await listIncidentsByInstallation(installationId);
      setCaseIncidents(response.incidents || []);
    } catch (error) {
      notify("warning", `No se pudieron cargar incidencias del caso: ${extractApiError(error)}`);
    } finally {
      setLoadingIncidents(false);
    }
  }, [hasActiveSession, notify]);

  const loadContext = useCallback(async () => {
    if (!hasActiveSession || !hasPrefilledContext) return;

    try {
      setLoadingContext(true);
      const recordsPromise = listInstallations({ forceRefresh: true });
      const assetPromise = (async () => {
        if (resolvedAssetId) {
          return getAssetIncidents(resolvedAssetId);
        }
        if (routeAssetExternalCode) {
          const resolved = await resolveAssetByExternalCode(routeAssetExternalCode);
          const assetId = Number(resolved.asset?.id);
          if (!Number.isInteger(assetId) || assetId <= 0) {
            throw new Error("No se pudo resolver el equipo escaneado.");
          }
          setResolvedAssetId(assetId);
          return getAssetIncidents(assetId);
        }
        return null;
      })();

      const [records, assetResponse] = await Promise.all([recordsPromise, assetPromise]);
      setInstallations(records);
      setAssetDetail(assetResponse);
    } catch (error) {
      notify("error", `No se pudo resolver el contexto: ${extractApiError(error)}`);
    } finally {
      setLoadingContext(false);
    }
  }, [hasActiveSession, hasPrefilledContext, notify, resolvedAssetId, routeAssetExternalCode]);

  useFocusEffect(
    useCallback(() => {
      if (!hasActiveSession || !hasPrefilledContext) return;
      void loadContext();
    }, [hasActiveSession, hasPrefilledContext, loadContext]),
  );

  useEffect(() => {
    if (!hasActiveSession || hasPrefilledContext) return;
    void listInstallations({ forceRefresh: true })
      .then((records) => setInstallations(records))
      .catch(() => undefined);
  }, [hasActiveSession, hasPrefilledContext]);

  useEffect(() => {
    if (!resolvedCaseId || !hasActiveSession) {
      setCaseIncidents([]);
      return;
    }
    void loadCaseIncidents(resolvedCaseId);
  }, [hasActiveSession, loadCaseIncidents, resolvedCaseId]);

  useEffect(() => {
    return () => {
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current);
      }
    };
  }, []);

  const openIncidentQuick = useCallback((installationId: number) => {
    router.push(`/incident/quick?installationId=${installationId}` as never);
  }, [router]);

  const openIncidentDetail = useCallback((incident: Incident) => {
    router.push(`/incident/detail?incidentId=${incident.id}&installationId=${incident.installation_id}` as never);
  }, [router]);

  const startCaseFromAsset = useCallback(async () => {
    if (!assetDetail?.asset?.id) {
      notify("warning", "No hay un equipo listo para iniciar el caso.");
      return;
    }

    try {
      setCreatingCase(true);
      const online = await canReachConfiguredApi();

      if (!online) {
        await enqueueCreateCase({
          clientName: assetDetail.asset.client_name?.trim() || "Sin cliente",
          notes: `Caso iniciado desde equipo ${assetDetail.asset.external_code}`,
          status: "manual",
          driverBrand: assetDetail.asset.brand?.trim() || "Equipo registrado",
          driverVersion: assetDetail.asset.model?.trim() || "Sin modelo",
          driverDescription: `Caso creado desde mobile para equipo ${assetDetail.asset.external_code}`,
          osInfo: "mobile",
          installationTimeSeconds: 0,
        });
        notify("info", "Caso guardado localmente. Se sincronizara cuando vuelva la conectividad.");
        router.replace("/(tabs)" as never);
        return;
      }

      const created = await createInstallationRecord({
        client_name: assetDetail.asset.client_name?.trim() || "Sin cliente",
        notes: `Caso iniciado desde equipo ${assetDetail.asset.external_code}`,
        status: "manual",
        driver_brand: assetDetail.asset.brand?.trim() || "Equipo registrado",
        driver_version: assetDetail.asset.model?.trim() || "Sin modelo",
        driver_description: `Caso creado desde mobile para equipo ${assetDetail.asset.external_code}`,
        os_info: "mobile",
        installation_time_seconds: 0,
      });

      await linkAssetToInstallation(
        assetDetail.asset.id,
        created.record.id,
        `Vinculado al iniciar caso desde mobile (${assetDetail.asset.external_code})`,
      );

      router.replace(`/incident/quick?installationId=${created.record.id}` as never);
    } catch (error) {
      notify("error", `No se pudo iniciar el caso: ${extractApiError(error)}`);
    } finally {
      setCreatingCase(false);
    }
  }, [assetDetail, notify, router]);

  if (checkingSession) {
    return (
      <ScreenScaffold scroll={false} centered contentContainerStyle={styles.centerContainer}>
        <ActivityIndicator size="large" color={palette.loadingSpinner} />
        <Text style={[styles.authHintText, { color: palette.textSecondary }]}>Preparando contexto...</Text>
      </ScreenScaffold>
    );
  }

  if (!hasActiveSession) {
    return (
      <ScreenScaffold scroll={false} centered contentContainerStyle={styles.centerContainer}>
        <WebInlineLoginCard
          hint="Inicia sesion web para abrir casos y cargar incidencias."
          onLoginSuccess={async () => {
            await loadContext();
          }}
          onOpenAdvanced={() => router.push("/modal?focus=login")}
        />
      </ScreenScaffold>
    );
  }

  return (
    <ScreenScaffold contentContainerStyle={styles.container}>
      <ScreenHero
        eyebrow="Contexto"
        title="Entrada inmediata"
        description="Cliente, incidencia activa y accion principal en una sola pantalla."
      />

      {feedbackMessage ? <InlineFeedback message={feedbackMessage.message} tone={feedbackMessage.tone} /> : null}

      {!hasPrefilledContext ? (
        <SectionCard title="Como iniciar" description="Escanea primero o abre caso manual.">
          <View style={styles.entryStack}>
            <ConsoleButton
              variant="primary"
              style={styles.scanEntryButton}
              onPress={() => router.push("/scan")}
            >
              <Text style={[styles.entryTitle, { color: palette.primaryButtonText }]}>Escanear equipo</Text>
              <Text style={[styles.entryBody, { color: palette.primaryButtonText }]}>Ruta principal para campo</Text>
            </ConsoleButton>
            <View style={styles.secondaryEntryRow}>
              <ConsoleButton
                variant="ghost"
                style={styles.entryButton}
                onPress={() => router.push("/case/manual" as never)}
                label="Caso manual"
                textStyle={styles.entryButtonText}
              />
              <ConsoleButton
                variant="ghost"
                style={styles.entryButton}
                onPress={() => router.push("/incident/quick" as never)}
                label="Incidencia rapida"
                textStyle={styles.entryButtonText}
              />
            </View>
          </View>
        </SectionCard>
      ) : (
        <SectionCard title="Contexto resuelto" description="Listo para actuar en menos de 30 segundos.">
          {loadingContext ? (
            <View style={styles.loadingBlock}>
              <ActivityIndicator size="small" color={palette.loadingSpinner} />
              <Text style={[styles.loadingText, { color: palette.textSecondary }]}>Resolviendo cliente y equipo...</Text>
            </View>
          ) : selectedCase ? (
            <View style={styles.contextStack}>
              <View style={[styles.contextCard, { backgroundColor: palette.heroBg, borderColor: palette.heroBorder }]}> 
                <View style={styles.caseHeader}>
                  <View style={styles.caseHeaderText}>
                    <Text style={[styles.caseTitle, { color: palette.textPrimary }]}>Caso #{selectedCase.id}</Text>
                    <Text style={[styles.supportText, { color: palette.textSecondary }]}> 
                      {selectedCase.client_name || assetDetail?.asset?.client_name || "Sin cliente"}
                    </Text>
                  </View>
                  <StatusChip kind="attention" value={selectedCase.attention_state} />
                </View>
                <Text style={[styles.supportMeta, { color: palette.textMuted }]}> 
                  {selectedSummary.active} activas - {selectedSummary.inProgress} en curso - {selectedSummary.paused} pausadas
                </Text>
              </View>

              {loadingIncidents ? (
                <Text style={[styles.supportText, { color: palette.textSecondary }]}>Cargando incidencia activa...</Text>
              ) : latestActiveIncident ? (
                <View style={[styles.contextCard, { backgroundColor: palette.surfaceAlt, borderColor: palette.border }]}> 
                  <View style={styles.caseHeader}>
                    <View style={styles.caseHeaderText}>
                      <Text style={[styles.caseTitle, { color: palette.textPrimary }]}>Incidencia activa #{latestActiveIncident.id}</Text>
                      <Text style={[styles.supportText, { color: palette.textSecondary }]} numberOfLines={2}> 
                        {latestActiveIncident.note || "Sin nota"}
                      </Text>
                    </View>
                    <StatusChip value={latestActiveIncident.incident_status} />
                  </View>
                </View>
              ) : (
                <View style={[styles.contextCard, { backgroundColor: palette.surfaceAlt, borderColor: palette.border }]}> 
                  <Text style={[styles.supportText, { color: palette.textSecondary }]}>No hay incidencias activas en este caso.</Text>
                </View>
              )}

              <View style={styles.actionColumn}>
                {latestActiveIncident ? (
                  <ConsoleButton
                    variant="primary"
                    style={styles.primaryButton}
                    onPress={() => openIncidentDetail(latestActiveIncident)}
                    label={`Continuar incidencia #${latestActiveIncident.id}`}
                    textStyle={styles.primaryButtonText}
                  />
                ) : (
                  <ConsoleButton
                    variant="primary"
                    style={styles.primaryButton}
                    onPress={() => openIncidentQuick(selectedCase.id)}
                    label="Crear incidencia"
                    textStyle={styles.primaryButtonText}
                  />
                )}

                <ConsoleButton
                  variant="subtle"
                  style={styles.secondaryButton}
                  onPress={() => openIncidentQuick(selectedCase.id)}
                  label="Nueva incidencia rapida"
                  textStyle={styles.secondaryButtonText}
                />

                <ConsoleButton
                  variant={canSendConformity ? "secondary" : "warning"}
                  style={styles.secondaryButton}
                  onPress={() =>
                    canSendConformity
                      ? router.push(`/case/conformity?installationId=${selectedCase.id}` as never)
                      : openIncidentQuick(selectedCase.id)
                  }
                  label={canSendConformity ? "Enviar conformidad final" : "Resolver activas antes de cerrar"}
                  textStyle={styles.secondaryButtonText}
                />
              </View>
            </View>
          ) : assetDetail?.asset ? (
            <View style={styles.contextStack}>
              <View style={[styles.contextCard, { backgroundColor: palette.heroBg, borderColor: palette.heroBorder }]}> 
                <Text style={[styles.caseTitle, { color: palette.textPrimary }]}>{assetDetail.asset.external_code}</Text>
                <Text style={[styles.supportText, { color: palette.textSecondary }]}> 
                  Equipo detectado sin caso abierto. Inicia uno y continua al formulario rapido.
                </Text>
              </View>
              <ConsoleButton
                variant="primary"
                style={styles.primaryButton}
                onPress={() => {
                  void startCaseFromAsset();
                }}
                loading={creatingCase}
                label="Iniciar caso con este equipo"
                textStyle={styles.primaryButtonText}
              />
            </View>
          ) : (
            <EmptyStateCard
              title="No se pudo resolver el contexto"
              body="Vuelve a escanear o inicia un caso manual para continuar."
            />
          )}
        </SectionCard>
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
    gap: spacing.s12,
  },
  authHintText: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fontFamilies.regular,
  },
  entryStack: {
    gap: spacing.s10,
  },
  scanEntryButton: {
    borderRadius: radii.r14,
    padding: spacing.s18,
    gap: spacing.s4,
    minHeight: 92,
    justifyContent: "center",
    alignItems: "flex-start",
  },
  secondaryEntryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.s10,
  },
  entryButton: {
    flex: 1,
    borderRadius: radii.r10,
    minHeight: 64,
    justifyContent: "center",
  },
  entryButtonText: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
  entryTitle: {
    fontFamily: fontFamilies.display,
    ...typeScale.actionDisplay,
    fontSize: 30,
    lineHeight: 28,
    letterSpacing: 0.75,
    textTransform: "uppercase",
  },
  entryBody: {
    fontFamily: fontFamilies.regular,
    ...typeScale.bodyCompact,
  },
  loadingBlock: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s8,
    minHeight: 96,
  },
  loadingText: {
    fontFamily: fontFamilies.regular,
    ...typeScale.bodyCompact,
  },
  contextStack: {
    gap: spacing.s12,
  },
  contextCard: {
    borderWidth: 1,
    borderRadius: radii.r14,
    padding: spacing.s14,
    gap: spacing.s8,
  },
  caseHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.s12,
  },
  caseHeaderText: {
    flex: 1,
    gap: spacing.s3,
  },
  caseTitle: {
    fontFamily: fontFamilies.semibold,
    ...typeScale.titleStrong,
    fontSize: 18,
    lineHeight: 22,
  },
  supportText: {
    fontFamily: fontFamilies.regular,
    ...typeScale.body,
  },
  supportMeta: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
  actionColumn: {
    gap: spacing.s10,
  },
  primaryButton: {
    minHeight: 64,
    borderRadius: radii.r12,
    justifyContent: "center",
  },
  primaryButtonText: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
  secondaryButton: {
    minHeight: 64,
    borderRadius: radii.r12,
    justifyContent: "center",
  },
  secondaryButtonText: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
});
