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
  getAssetIncidents,
  linkAssetToInstallation,
  resolveAssetByExternalCode,
  type AssetIncidentsResponse,
} from "@/src/api/assets";
import { extractApiError } from "@/src/api/client";
import {
  createInstallationRecord,
  listInstallations,
} from "@/src/api/incidents";
import { readStoredWebSession } from "@/src/api/webAuth";
import { canAssignTechnicians } from "@/src/auth/roles";
import EmptyStateCard from "@/src/components/EmptyStateCard";
import InlineFeedback, { type InlineFeedbackTone } from "@/src/components/InlineFeedback";
import ScreenHero from "@/src/components/ScreenHero";
import ScreenScaffold from "@/src/components/ScreenScaffold";
import SectionCard from "@/src/components/SectionCard";
import StatusChip from "@/src/components/StatusChip";
import TechnicianAssignmentsPanel from "@/src/components/TechnicianAssignmentsPanel";
import WebInlineLoginCard from "@/src/components/WebInlineLoginCard";
import { canReachConfiguredApi } from "@/src/services/network/api-connectivity";
import { enqueueCreateCase } from "@/src/services/sync/case-outbox-service";
import { useSharedWebSessionState } from "@/src/session/web-session-store";
import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies, inputFontFamily, textInputAccentColor } from "@/src/theme/typography";
import { type InstallationRecord } from "@/src/types/api";
import { deriveRecordIncidentSummary } from "@/src/utils/incidents";

const MIN_TOUCH_TARGET_SIZE = 44;

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
  const [resolvedAssetId, setResolvedAssetId] = useState<number | null>(
    parsePositiveInt(queryParams.assetRecordId),
  );
  const [loadingContext, setLoadingContext] = useState(false);
  const [creatingCase, setCreatingCase] = useState(false);
  const [webSessionRole, setWebSessionRole] = useState<string | null>(null);
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
  const hasPrefilledContext = Boolean(
    routeInstallationId || routeAssetExternalCode || resolvedAssetId,
  );

  const resolvedCaseId = useMemo(() => {
    if (routeInstallationId) return routeInstallationId;
    const linkedInstallationId = Number(assetDetail?.active_link?.installation_id);
    return Number.isInteger(linkedInstallationId) && linkedInstallationId > 0
      ? linkedInstallationId
      : null;
  }, [assetDetail?.active_link?.installation_id, routeInstallationId]);

  const selectedCase = useMemo(() => {
    if (!resolvedCaseId) return null;
    return (
      installations.find((item) => item.id === resolvedCaseId) || {
        id: resolvedCaseId,
        client_name: "Caso cargado por contexto",
      }
    );
  }, [installations, resolvedCaseId]);
  const selectedSummary = useMemo(
    () => deriveRecordIncidentSummary(selectedCase),
    [selectedCase],
  );
  const canSendConformity = Boolean(selectedCase) && selectedSummary.active === 0;
  const canManageTechnicianAssignments = canAssignTechnicians(webSessionRole);

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

  const buildIncidentRoute = useCallback(
    (installationId: number) => {
      const params = new URLSearchParams({ installationId: String(installationId) });
      const assetCode = routeAssetExternalCode || assetDetail?.asset?.external_code || "";
      const assetId = resolvedAssetId || Number(assetDetail?.asset?.id) || null;
      if (assetCode.trim()) params.set("assetExternalCode", assetCode.trim());
      if (assetId && assetId > 0) params.set("assetRecordId", String(assetId));
      return `/incident/create?${params.toString()}` as never;
    },
    [assetDetail?.asset?.external_code, assetDetail?.asset?.id, resolvedAssetId, routeAssetExternalCode],
  );

  const buildConformityRoute = useCallback(
    (installationId: number) => {
      const params = new URLSearchParams({ installationId: String(installationId) });
      const assetId = resolvedAssetId || Number(assetDetail?.asset?.id) || null;
      if (assetId && assetId > 0) {
        params.set("assetRecordId", String(assetId));
      }
      return `/case/conformity?${params.toString()}` as never;
    },
    [assetDetail?.asset?.id, resolvedAssetId],
  );

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
  }, [
    hasActiveSession,
    hasPrefilledContext,
    notify,
    resolvedAssetId,
    routeInstallationId,
    routeAssetExternalCode,
  ]);

  useFocusEffect(
    useCallback(() => {
      if (!hasActiveSession || !hasPrefilledContext) return;
      void loadContext();
      void readStoredWebSession()
        .then((session) => setWebSessionRole(session.role))
        .catch(() => setWebSessionRole(null));
    }, [hasActiveSession, hasPrefilledContext, loadContext]),
  );

  useEffect(() => {
    if (!hasActiveSession || hasPrefilledContext) return;
    void listInstallations({ forceRefresh: true })
      .then((records) => setInstallations(records))
      .catch(() => undefined);
  }, [hasActiveSession, hasPrefilledContext]);

  useEffect(() => {
    return () => {
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current);
      }
    };
  }, []);

  const openWorkCase = useCallback(
    (installationId: number) => {
      router.push(`/work?installationId=${installationId}` as never);
    },
    [router],
  );

  const openInventoryAsset = useCallback(() => {
    const assetId = resolvedAssetId || Number(assetDetail?.asset?.id) || null;
    const query = assetId ? `?assetId=${assetId}` : "";
    router.push(`/explore${query}` as never);
  }, [assetDetail?.asset?.id, resolvedAssetId, router]);

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
          notes: `Caso iniciado desde equipo ${assetDetail.asset.external_code}${assetDetail.asset.notes ? `\n${assetDetail.asset.notes}` : ""}`,
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
        notes: `Caso iniciado desde equipo ${assetDetail.asset.external_code}${assetDetail.asset.notes ? `\n${assetDetail.asset.notes}` : ""}`,
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

      router.replace(buildIncidentRoute(created.record.id));
    } catch (error) {
      notify("error", `No se pudo iniciar el caso: ${extractApiError(error)}`);
    } finally {
      setCreatingCase(false);
    }
  }, [assetDetail, buildIncidentRoute, notify, router]);

  if (checkingSession) {
    return (
      <ScreenScaffold scroll={false} centered contentContainerStyle={styles.centerContainer}>
        <ActivityIndicator size="large" color={palette.loadingSpinner} />
        <Text style={[styles.authHintText, { color: palette.textSecondary }]}>
          Preparando contexto...
        </Text>
      </ScreenScaffold>
    );
  }

  if (!hasActiveSession) {
    return (
      <ScreenScaffold scroll={false} centered contentContainerStyle={styles.centerContainer}>
        <WebInlineLoginCard
          hint="Inicia sesion web para abrir casos, resolver equipos y cargar incidencias."
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
        eyebrow="Resolver contexto"
        title="Iniciar trabajo"
        description="Escanea primero. Si no aplica, usa inventario o caso manual."
        aside={
          hasPrefilledContext ? (
            <View
              style={[
                styles.heroBadge,
                { backgroundColor: palette.heroEyebrowBg, borderColor: palette.heroBorder },
              ]}
            >
              <Text style={[styles.heroBadgeText, { color: palette.heroEyebrowText }]}>
                {assetDetail?.asset?.external_code
                  ? assetDetail.asset.external_code
                  : resolvedCaseId
                    ? `caso #${resolvedCaseId}`
                    : "contexto"}
              </Text>
            </View>
          ) : undefined
        }
      />

      {feedbackMessage ? (
        <InlineFeedback message={feedbackMessage.message} tone={feedbackMessage.tone} />
      ) : null}

      {!hasPrefilledContext ? (
        <>
          <SectionCard
            title="Entrada principal"
            description="El QR es la ruta base del trabajo en campo."
          >
            <View style={styles.entryStack}>
              <TouchableOpacity
                style={[styles.scanEntryButton, { backgroundColor: palette.primaryButtonBg }]}
                onPress={() => router.push("/scan")}
                accessibilityRole="button"
                accessibilityLabel="Escanear equipo para iniciar trabajo"
              >
                <Text style={[styles.entryTitle, { color: palette.primaryButtonText }]}>
                  Escanear equipo
                </Text>
                <Text style={[styles.entryBody, { color: palette.primaryButtonText }]}>
                  Apunta, resuelve el contexto y sigue.
                </Text>
              </TouchableOpacity>
              <View style={styles.secondaryEntryRow}>
                <TouchableOpacity
                  style={[
                    styles.entryButton,
                    { backgroundColor: palette.refreshBg, borderColor: palette.inputBorder },
                  ]}
                  onPress={() => router.push("/case/manual" as never)}
                  accessibilityRole="button"
                  accessibilityLabel="Abrir caso manual"
                >
                  <Text style={[styles.entryTitle, { color: palette.refreshText }]}>
                    Caso manual
                  </Text>
                  <Text style={[styles.entryBody, { color: palette.textSecondary }]}>
                    Fallback sin equipo.
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.entryButton,
                    { backgroundColor: palette.refreshBg, borderColor: palette.inputBorder },
                  ]}
                  onPress={() => router.push("/explore?intent=resolve" as never)}
                  accessibilityRole="button"
                  accessibilityLabel="Buscar equipo en inventario para iniciar trabajo"
                >
                  <Text style={[styles.entryTitle, { color: palette.refreshText }]}>
                    Inventario
                  </Text>
                  <Text style={[styles.entryBody, { color: palette.textSecondary }]}>
                    Buscar antes de abrir.
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </SectionCard>

          {installations.length ? (
            <SectionCard
              title="Retomar"
              description="Casos recientes para no empezar de cero."
            >
              <View style={styles.caseList}>
                {installations.slice(0, 2).map((item) => (
                  <TouchableOpacity
                    key={item.id}
                    style={[
                      styles.caseRow,
                      { backgroundColor: palette.cardBg, borderColor: palette.cardBorder },
                    ]}
                    onPress={() => router.push(`/case/context?installationId=${item.id}` as never)}
                    accessibilityRole="button"
                    accessibilityLabel={`Resolver contexto para el caso ${item.id}`}
                  >
                    <View style={styles.caseHeaderText}>
                      <Text style={[styles.caseTitle, { color: palette.textPrimary }]}>
                        Caso #{item.id}
                      </Text>
                      <Text style={[styles.supportText, { color: palette.textSecondary }]}>
                        {item.client_name || "Sin cliente"}
                      </Text>
                    </View>
                    <StatusChip kind="attention" value={item.attention_state} />
                  </TouchableOpacity>
                ))}
              </View>
            </SectionCard>
          ) : null}
        </>
      ) : (
        <>
          <SectionCard
            title="Caso listo"
            description="Desde aqui sigues sin volver a decidir contexto."
          >
          {loadingContext ? (
            <View style={styles.loadingBlock}>
              <ActivityIndicator size="small" color={palette.loadingSpinner} />
              <Text style={[styles.loadingText, { color: palette.textSecondary }]}>
                Resolviendo caso y equipo...
              </Text>
            </View>
          ) : selectedCase ? (
            <View style={styles.contextStack}>
              <View
                style={[
                  styles.contextCard,
                  { backgroundColor: palette.heroBg, borderColor: palette.heroBorder },
                ]}
              >
                <View style={styles.caseHeader}>
                  <View style={styles.caseHeaderText}>
                    <Text style={[styles.caseTitle, { color: palette.textPrimary }]}>
                      #{selectedCase.id} {selectedCase.client_name ? `- ${selectedCase.client_name}` : ""}
                    </Text>
                  </View>
                  <StatusChip kind="attention" value={selectedCase.attention_state} />
                </View>
                <Text style={[styles.supportText, { color: palette.textSecondary }]}>
                  {assetDetail?.asset?.external_code
                    ? `Equipo ${assetDetail.asset.external_code} vinculado a este caso.`
                    : "Caso manual o seleccionado sin equipo confirmado."}
                </Text>
                <Text style={[styles.supportMeta, { color: palette.textMuted }]}>
                  {selectedSummary.active} activas · {selectedSummary.inProgress} en curso · {selectedSummary.paused} pausadas
                </Text>
              </View>

              <Text
                style={[
                  styles.supportText,
                  { color: canSendConformity ? palette.successText : palette.warningText },
                ]}
              >
                {canSendConformity
                  ? "Caso listo para cerrar y enviar la conformidad."
                  : "Primero resuelve las incidencias activas y luego emite la conformidad."}
              </Text>

              <View style={styles.actionColumn}>
                <TouchableOpacity
                  style={[styles.primaryButton, { backgroundColor: palette.primaryButtonBg }]}
                  onPress={() => openWorkCase(selectedCase.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Continuar el caso ${selectedCase.id}`}
                >
                  <Text style={[styles.primaryButtonText, { color: palette.primaryButtonText }]}>
                    Abrir backlog del caso
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.secondaryButton,
                    { backgroundColor: palette.secondaryButtonBg, borderColor: palette.inputBorder },
                  ]}
                  onPress={() => router.push(buildIncidentRoute(selectedCase.id))}
                  accessibilityRole="button"
                  accessibilityLabel={`Crear incidencia dentro del caso ${selectedCase.id}`}
                >
                  <Text style={[styles.secondaryButtonText, { color: palette.secondaryButtonText }]}>
                    Nueva incidencia
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.secondaryButton,
                    {
                      backgroundColor: canSendConformity ? palette.secondaryButtonBg : palette.warningBg,
                      borderColor: canSendConformity ? palette.inputBorder : palette.warningText,
                    },
                  ]}
                  onPress={() =>
                    canSendConformity
                      ? router.push(buildConformityRoute(selectedCase.id))
                      : openWorkCase(selectedCase.id)
                  }
                  accessibilityRole="button"
                  accessibilityLabel={
                    canSendConformity
                      ? `Generar conformidad para el caso ${selectedCase.id}`
                      : `Revisar incidencias antes de generar la conformidad para el caso ${selectedCase.id}`
                  }
                >
                  <Text
                    style={[
                      styles.secondaryButtonText,
                      { color: canSendConformity ? palette.secondaryButtonText : palette.warningText },
                    ]}
                  >
                    {canSendConformity
                      ? "Enviar conformidad final"
                      : "Revisar incidencias antes de cerrar"}
                  </Text>
                </TouchableOpacity>
                {assetDetail?.asset ? (
                  <TouchableOpacity
                    style={[
                      styles.ghostButton,
                      { backgroundColor: palette.refreshBg, borderColor: palette.inputBorder },
                    ]}
                    onPress={openInventoryAsset}
                    accessibilityRole="button"
                    accessibilityLabel="Abrir el inventario del equipo resuelto"
                  >
                    <Text style={[styles.ghostButtonText, { color: palette.refreshText }]}>
                      Abrir inventario
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          ) : assetDetail?.asset ? (
            <View style={styles.contextStack}>
              <View
                style={[
                  styles.contextCard,
                  { backgroundColor: palette.heroBg, borderColor: palette.heroBorder },
                ]}
              >
                <Text style={[styles.caseTitle, { color: palette.textPrimary }]}>
                  {assetDetail.asset.external_code}
                </Text>
                <Text style={[styles.supportText, { color: palette.textSecondary }]}>
                  Este equipo no tiene un caso abierto. Puedes iniciarlo ahora y entrar directo a la nueva incidencia.
                </Text>
              </View>
              <View style={styles.actionColumn}>
                <TouchableOpacity
                  style={[styles.primaryButton, { backgroundColor: palette.primaryButtonBg }]}
                  onPress={() => {
                    void startCaseFromAsset();
                  }}
                  disabled={creatingCase}
                  accessibilityRole="button"
                  accessibilityLabel="Iniciar caso con este equipo"
                  accessibilityState={{ disabled: creatingCase, busy: creatingCase }}
                >
                  {creatingCase ? (
                    <ActivityIndicator color={palette.primaryButtonText} />
                  ) : (
                    <Text style={[styles.primaryButtonText, { color: palette.primaryButtonText }]}>
                      Iniciar caso con este equipo
                    </Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.ghostButton,
                    { backgroundColor: palette.refreshBg, borderColor: palette.inputBorder },
                  ]}
                  onPress={openInventoryAsset}
                  accessibilityRole="button"
                  accessibilityLabel="Abrir inventario para revisar el equipo"
                >
                  <Text style={[styles.ghostButtonText, { color: palette.refreshText }]}>
                    Revisar inventario
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <EmptyStateCard
              title="No se pudo resolver el contexto."
              body="Vuelve a escanear, abre inventario o inicia un caso manual para continuar."
            />
          )}
          </SectionCard>

          {selectedCase ? (
            <SectionCard
              title="Tecnicos del caso"
              description={
                canManageTechnicianAssignments
                  ? "Administra responsables del caso directamente desde mobile."
                  : "Responsables asignados a este caso."
              }
            >
              <TechnicianAssignmentsPanel
                entityType="installation"
                entityId={selectedCase.id}
                entityLabel={`Caso #${selectedCase.id}`}
                canManage={canManageTechnicianAssignments}
                emptyText="Sin tecnicos asignados a este caso."
              />
            </SectionCard>
          ) : null}

          {assetDetail?.asset?.id ? (
            <SectionCard
              title="Tecnicos del equipo"
              description={
                canManageTechnicianAssignments
                  ? "Administra responsables del equipo vinculado."
                  : "Responsables asignados a este equipo."
              }
            >
              <TechnicianAssignmentsPanel
                entityType="asset"
                entityId={assetDetail.asset.id}
                entityLabel={assetDetail.asset.external_code || `Activo #${assetDetail.asset.id}`}
                canManage={canManageTechnicianAssignments}
                emptyText="Sin tecnicos asignados a este equipo."
              />
            </SectionCard>
          ) : null}
        </>
      )}
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
  heroBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  heroBadgeText: {
    fontFamily: fontFamilies.bold,
    fontSize: 11.5,
    letterSpacing: 0.3,
  },
  entryStack: {
    gap: 10,
  },
  scanEntryButton: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 18,
    gap: 4,
    minHeight: 88,
    justifyContent: "center",
  },
  secondaryEntryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  entryButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    gap: 4,
    minHeight: MIN_TOUCH_TARGET_SIZE,
  },
  entryTitle: {
    fontFamily: fontFamilies.bold,
    fontSize: 15,
  },
  entryBody: {
    fontFamily: fontFamilies.regular,
    fontSize: 13,
    lineHeight: 18,
  },
  caseList: {
    gap: 10,
  },
  caseRow: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  caseHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  caseHeaderText: {
    flex: 1,
    gap: 3,
  },
  caseTitle: {
    fontFamily: fontFamilies.bold,
    fontSize: 17,
    lineHeight: 22,
  },
  loadingBlock: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 96,
  },
  loadingText: {
    fontFamily: fontFamilies.regular,
    fontSize: 13,
  },
  contextStack: {
    gap: 12,
  },
  contextCard: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    gap: 10,
  },
  supportText: {
    fontFamily: fontFamilies.regular,
    fontSize: 13,
    lineHeight: 19,
  },
  supportMeta: {
    fontFamily: fontFamilies.regular,
    fontSize: 12.5,
    lineHeight: 18,
  },
  fieldLabel: {
    fontFamily: fontFamilies.semibold,
    fontSize: 13.5,
  },
  input: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontFamily: inputFontFamily,
    fontSize: 14,
    lineHeight: 19,
    minHeight: MIN_TOUCH_TARGET_SIZE,
  },
  actionColumn: {
    gap: 10,
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
    fontSize: 14,
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
  secondaryButtonText: {
    fontFamily: fontFamilies.bold,
    fontSize: 14,
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
  ghostButtonText: {
    fontFamily: fontFamilies.semibold,
    fontSize: 13.5,
  },
  buttonDisabled: {
    opacity: 0.72,
  },
});
