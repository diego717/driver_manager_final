import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";

import { getAssetIncidents, linkAssetToInstallation, listAssets, type AssetRecord } from "@/src/api/assets";
import { extractApiError } from "@/src/api/client";
import { readStoredWebSession } from "@/src/api/webAuth";
import { canAssignTechnicians, canViewAssetCatalog } from "@/src/auth/roles";
import EmptyStateCard from "@/src/components/EmptyStateCard";
import ScreenHero from "@/src/components/ScreenHero";
import ScreenScaffold from "@/src/components/ScreenScaffold";
import SectionCard from "@/src/components/SectionCard";
import TechnicianAssignmentsPanel from "@/src/components/TechnicianAssignmentsPanel";
import WebInlineLoginCard from "@/src/components/WebInlineLoginCard";
import { useSharedWebSessionState } from "@/src/session/web-session-store";
import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies } from "@/src/theme/typography";

const MIN_TOUCH_TARGET_SIZE = 44;
const ASSET_LIST_LIMIT = 80;

function normalizeString(value: string | null | undefined): string {
  return String(value || "").trim();
}

export default function ExploreTabScreen() {
  const palette = useAppPalette();
  const router = useRouter();
  const params = useLocalSearchParams<{ intent?: string | string[]; assetId?: string | string[] }>();
  const { checkingSession, hasActiveSession } = useSharedWebSessionState();

  const [search, setSearch] = useState("");
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<number | null>(null);
  const [assetDetail, setAssetDetail] = useState<Awaited<ReturnType<typeof getAssetIncidents>> | null>(null);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkInstallationId, setLinkInstallationId] = useState("");
  const [linking, setLinking] = useState(false);
  const [webSessionRole, setWebSessionRole] = useState<string | null>(null);

  const resolveIntent =
    normalizeString(Array.isArray(params.intent) ? params.intent[0] : params.intent).toLowerCase() === "resolve";
  const routeAssetId = useMemo(() => {
    const raw = Array.isArray(params.assetId) ? params.assetId[0] : params.assetId;
    const parsed = Number.parseInt(String(raw || "").trim(), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }, [params.assetId]);

  const selectedAsset = useMemo(
    () => assets.find((item) => item.id === selectedAssetId) || assetDetail?.asset || null,
    [assetDetail?.asset, assets, selectedAssetId],
  );
  const canManageTechnicianAssignments = canAssignTechnicians(webSessionRole);
  const canAccessAssetCatalog = canViewAssetCatalog(webSessionRole);

  const loadAssets = useCallback(async () => {
    if (!hasActiveSession) return;
    try {
      setLoadingAssets(true);
      const items = await listAssets({
        search: normalizeString(search) || undefined,
        limit: ASSET_LIST_LIMIT,
      });
      setAssets(items);
      setSelectedAssetId((current) => {
        if (current && items.some((asset) => asset.id === current)) return current;
        return items[0]?.id ?? null;
      });
    } catch (error) {
      Alert.alert("Error", extractApiError(error));
    } finally {
      setLoadingAssets(false);
    }
  }, [hasActiveSession, search]);

  const loadAssetDetail = useCallback(async (assetId: number) => {
    if (!hasActiveSession) return;
    try {
      setLoadingDetail(true);
      const detail = await getAssetIncidents(assetId, { limit: 20 });
      setAssetDetail(detail);
      setSelectedAssetId(assetId);
      const activeInstallationId = Number(detail?.active_link?.installation_id);
      if (Number.isInteger(activeInstallationId) && activeInstallationId > 0) {
        setLinkInstallationId(String(activeInstallationId));
      }
    } catch (error) {
      Alert.alert("Error", extractApiError(error));
    } finally {
      setLoadingDetail(false);
    }
  }, [hasActiveSession]);

  const openPrimaryAction = useCallback((asset: AssetRecord) => {
    const activeInstallationId =
      selectedAssetId === asset.id ? Number(assetDetail?.active_link?.installation_id) : NaN;
    const installationParam =
      Number.isInteger(activeInstallationId) && activeInstallationId > 0
        ? `&installationId=${activeInstallationId}`
        : "";

    if (resolveIntent) {
      router.push(
        `/case/context?assetExternalCode=${encodeURIComponent(asset.external_code)}&assetRecordId=${asset.id}${installationParam}` as never,
      );
      return;
    }

    router.push(
      `/incident/create?assetExternalCode=${encodeURIComponent(asset.external_code)}&assetRecordId=${asset.id}${installationParam}` as never,
    );
  }, [assetDetail?.active_link?.installation_id, resolveIntent, router, selectedAssetId]);

  const onLinkAsset = useCallback(async () => {
    if (!selectedAsset?.id) return;
    const parsedInstallationId = Number.parseInt(linkInstallationId, 10);
    if (!Number.isInteger(parsedInstallationId) || parsedInstallationId <= 0) {
      Alert.alert("Dato invalido", "installation_id debe ser un numero positivo.");
      return;
    }

    try {
      setLinking(true);
      await linkAssetToInstallation(selectedAsset.id, parsedInstallationId, "Asociado desde mobile.");
      await loadAssetDetail(selectedAsset.id);
      setShowLinkForm(false);
    } catch (error) {
      Alert.alert("Error", extractApiError(error));
    } finally {
      setLinking(false);
    }
  }, [linkInstallationId, loadAssetDetail, selectedAsset]);

  useEffect(() => {
    if (!hasActiveSession) {
      setAssets([]);
      setSelectedAssetId(null);
      setAssetDetail(null);
      return;
    }
    void loadAssets();
  }, [hasActiveSession, loadAssets]);

  useFocusEffect(
    useCallback(() => {
      if (!hasActiveSession) return;
      void loadAssets();
      void readStoredWebSession()
        .then((session) => setWebSessionRole(session.role))
        .catch(() => setWebSessionRole(null));
    }, [hasActiveSession, loadAssets]),
  );

  useEffect(() => {
    if (!hasActiveSession || !selectedAssetId) return;
    void loadAssetDetail(selectedAssetId);
  }, [hasActiveSession, loadAssetDetail, selectedAssetId]);

  useEffect(() => {
    if (!routeAssetId || !assets.some((asset) => asset.id === routeAssetId)) return;
    setSelectedAssetId(routeAssetId);
  }, [assets, routeAssetId]);

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
          hint={resolveIntent ? "Inicia sesion web para elegir un equipo." : "Inicia sesion web para ver inventario."}
          onLoginSuccess={async () => {
            await loadAssets();
          }}
          onOpenAdvanced={() => router.push("/modal?focus=login")}
        />
      </ScreenScaffold>
    );
  }

  if (!canAccessAssetCatalog) {
    return (
      <ScreenScaffold scroll={false} centered contentContainerStyle={styles.centerContainer}>
        <EmptyStateCard
          title="Inventario reservado"
          body={
            resolveIntent
              ? "Tu rol no puede abrir el catalogo global. Usa Mis casos o el contexto de una incidencia asignada."
              : "Tu rol no puede ver el catalogo global de equipos. Si necesitas contexto operativo, entra desde una incidencia o caso asignado."
          }
        />
      </ScreenScaffold>
    );
  }

  return (
    <ScreenScaffold contentContainerStyle={styles.container} scrollViewProps={{ keyboardShouldPersistTaps: "handled" }}>
      <ScreenHero
        eyebrow={resolveIntent ? "Resolver equipo" : "Inventario"}
        title={resolveIntent ? "Elegir equipo para iniciar trabajo" : "Inventario y equipos"}
        description={resolveIntent ? "Elige un activo y continua por el caso correcto." : "Busca un activo, revisa contexto y actua sin salir del flujo."}
      />

      <View style={styles.searchRow}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          style={[
            styles.input,
            styles.searchInput,
            { backgroundColor: palette.inputBg, borderColor: palette.inputBorder, color: palette.textPrimary },
          ]}
          placeholder="Buscar equipo o cliente"
          placeholderTextColor={palette.placeholder}
        />
        <TouchableOpacity
          style={[styles.smallButton, { backgroundColor: palette.primaryButtonBg }]}
          onPress={() => {
            void loadAssets();
          }}
          disabled={loadingAssets}
          accessibilityRole="button"
        >
          <Text style={[styles.smallButtonText, { color: palette.primaryButtonText }]}>Buscar</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.topActionsRow}>
        <TouchableOpacity
          style={[styles.ghostButton, { backgroundColor: palette.surface, borderColor: palette.inputBorder }]}
          onPress={() => {
            void loadAssets();
          }}
          accessibilityRole="button"
        >
          <Text style={[styles.ghostButtonText, { color: palette.refreshText }]}>Actualizar</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.ghostButton, { backgroundColor: palette.surface, borderColor: palette.inputBorder }]}
          onPress={() => router.push("/qr?mode=scan")}
          accessibilityRole="button"
        >
          <Text style={[styles.ghostButtonText, { color: palette.refreshText }]}>Escanear</Text>
        </TouchableOpacity>
        {resolveIntent ? (
          <TouchableOpacity
            style={[styles.ghostButton, { backgroundColor: palette.secondaryButtonBg }]}
            onPress={() => router.push("/case/manual" as never)}
            accessibilityRole="button"
          >
            <Text style={[styles.ghostButtonText, { color: palette.secondaryButtonText }]}>Caso manual</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {!assets.length ? (
        <EmptyStateCard
          title={resolveIntent ? "No hay equipos para resolver." : "No hay equipos para mostrar."}
          body={resolveIntent ? "Escanea un QR o inicia un caso manual." : "Prueba otra busqueda o refresca el inventario."}
        />
      ) : (
        <View style={styles.assetList}>
          {assets.map((asset) => {
            const selected = asset.id === selectedAssetId;
            return (
              <View key={asset.id} style={[styles.assetRow, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}>
                <TouchableOpacity
                  style={styles.assetInfo}
                  onPress={() => setSelectedAssetId(asset.id)}
                  accessibilityRole="button"
                >
                  <Text style={[styles.assetCode, { color: palette.textPrimary }]}>#{asset.id} {asset.external_code}</Text>
                  <Text style={[styles.assetMeta, { color: palette.textSecondary }]}>
                    {(asset.brand || "-") + " / " + (asset.model || "-")} - {asset.client_name || "Sin cliente"}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.inlineAction,
                    { backgroundColor: selected ? palette.chipSelectedBg : palette.secondaryButtonBg, borderColor: palette.inputBorder },
                  ]}
                  onPress={() => (selected ? openPrimaryAction(asset) : setSelectedAssetId(asset.id))}
                  accessibilityRole="button"
                >
                  <Text style={[styles.inlineActionText, { color: selected ? palette.chipSelectedText : palette.secondaryButtonText }]}>
                    {selected ? (resolveIntent ? "Abrir en casos" : "Incidencia") : "Ver"}
                  </Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
      )}

      {loadingDetail ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={palette.loadingSpinner} />
          <Text style={[styles.loadingText, { color: palette.textSecondary }]}>Cargando detalle...</Text>
        </View>
      ) : null}

      {selectedAsset ? (
        <View style={[styles.detailCard, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}>
          <Text style={[styles.detailTitle, { color: palette.textPrimary }]}>
            {resolveIntent ? "Equipo seleccionado" : "Equipo activo"}
          </Text>
          <Text style={[styles.detailLine, { color: palette.textPrimary }]}>#{selectedAsset.id} {selectedAsset.external_code}</Text>
          <Text style={[styles.detailLine, { color: palette.textSecondary }]}>
            {selectedAsset.brand || "-"} / {selectedAsset.model || "-"} / serie {selectedAsset.serial_number || "-"}
          </Text>
          <Text style={[styles.detailLine, { color: palette.textSecondary }]}>
            Cliente {selectedAsset.client_name || "-"} · estado {selectedAsset.status || "active"}
          </Text>
          <Text style={[styles.detailLine, { color: palette.textMuted }]}>
            {assetDetail?.active_link ? `Caso activo #${assetDetail.active_link.installation_id}` : "Sin caso activo vinculado"}
          </Text>
          {!resolveIntent ? (
            <Text style={[styles.detailLine, { color: palette.textMuted }]}>
              {assetDetail?.incidents?.length ?? 0} incidencias registradas
            </Text>
          ) : null}

          <View style={styles.detailActions}>
            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: palette.primaryButtonBg }]}
              onPress={() => openPrimaryAction(selectedAsset)}
              accessibilityRole="button"
            >
              <Text style={[styles.primaryButtonText, { color: palette.primaryButtonText }]}>
                {resolveIntent ? "Abrir en casos" : "Crear incidencia"}
              </Text>
            </TouchableOpacity>
            {!resolveIntent ? (
              <TouchableOpacity
                style={[styles.secondaryButton, { backgroundColor: palette.refreshBg, borderColor: palette.inputBorder }]}
                onPress={() => setShowLinkForm((current) => !current)}
                accessibilityRole="button"
              >
                <Text style={[styles.secondaryButtonText, { color: palette.refreshText }]}>Vincular caso</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {!resolveIntent && showLinkForm ? (
            <View style={styles.linkForm}>
              <TextInput
                value={linkInstallationId}
                onChangeText={setLinkInstallationId}
                keyboardType="numeric"
                style={[
                  styles.input,
                  { backgroundColor: palette.inputBg, borderColor: palette.inputBorder, color: palette.textPrimary },
                ]}
                placeholder="Installation ID"
                placeholderTextColor={palette.placeholder}
              />
              <TouchableOpacity
                style={[styles.primaryButton, { backgroundColor: palette.primaryButtonBg }]}
                onPress={() => {
                  void onLinkAsset();
                }}
                disabled={linking}
                accessibilityRole="button"
              >
                {linking ? (
                  <ActivityIndicator color={palette.primaryButtonText} />
                ) : (
                  <Text style={[styles.primaryButtonText, { color: palette.primaryButtonText }]}>Vincular ahora</Text>
                )}
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      ) : null}

      {selectedAsset ? (
        <SectionCard
          title="Tecnicos del equipo"
          description={
            canManageTechnicianAssignments
              ? "Administra responsables del activo desde mobile."
              : "Responsables asignados a este equipo."
          }
        >
          <TechnicianAssignmentsPanel
            entityType="asset"
            entityId={selectedAsset.id}
            entityLabel={selectedAsset.external_code || `Activo #${selectedAsset.id}`}
            canManage={canManageTechnicianAssignments}
            emptyText="Sin tecnicos asignados a este equipo."
          />
        </SectionCard>
      ) : null}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  centerContainer: {
    flex: 1,
    padding: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  container: {
    padding: 20,
    gap: 12,
  },
  searchRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  searchInput: {
    flex: 1,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: MIN_TOUCH_TARGET_SIZE,
  },
  smallButton: {
    minHeight: MIN_TOUCH_TARGET_SIZE,
    minWidth: 84,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  smallButtonText: {
    fontFamily: fontFamilies.mono,
    fontSize: 12,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  topActionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  ghostButton: {
    minHeight: MIN_TOUCH_TARGET_SIZE,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  ghostButtonText: {
    fontFamily: fontFamilies.mono,
    fontSize: 12,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  assetList: {
    gap: 8,
  },
  assetRow: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  assetInfo: {
    flex: 1,
    gap: 2,
  },
  assetCode: {
    fontFamily: fontFamilies.bold,
    fontSize: 13.5,
    letterSpacing: -0.1,
  },
  assetMeta: {
    fontFamily: fontFamilies.mono,
    fontSize: 12,
  },
  inlineAction: {
    borderWidth: 1,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    borderRadius: 12,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  inlineActionText: {
    fontFamily: fontFamilies.mono,
    fontSize: 12,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  loadingText: {
    fontFamily: fontFamilies.mono,
    fontSize: 12,
  },
  detailCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 8,
  },
  detailTitle: {
    fontFamily: fontFamilies.bold,
    fontSize: 18,
    letterSpacing: -0.2,
  },
  detailLine: {
    fontFamily: fontFamilies.regular,
    fontSize: 13,
    lineHeight: 18,
  },
  detailActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 2,
  },
  primaryButton: {
    minHeight: MIN_TOUCH_TARGET_SIZE,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  primaryButtonText: {
    fontFamily: fontFamilies.bold,
    fontSize: 14,
  },
  secondaryButton: {
    minHeight: MIN_TOUCH_TARGET_SIZE,
    borderWidth: 1,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  secondaryButtonText: {
    fontFamily: fontFamilies.mono,
    fontSize: 12,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  linkForm: {
    gap: 8,
    marginTop: 4,
  },
});
