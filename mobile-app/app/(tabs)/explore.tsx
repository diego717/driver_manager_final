import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Alert, Animated, Easing, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";

import { getAssetIncidents, linkAssetToInstallation, listAssets, type AssetRecord } from "@/src/api/assets";
import { extractApiError } from "@/src/api/client";
import { readStoredWebSession } from "@/src/api/webAuth";
import { canAssignTechnicians, canViewAssetCatalog } from "@/src/auth/roles";
import ConsoleButton from "@/src/components/ConsoleButton";
import EmptyStateCard from "@/src/components/EmptyStateCard";
import ScreenHero from "@/src/components/ScreenHero";
import ScreenScaffold from "@/src/components/ScreenScaffold";
import SectionCard from "@/src/components/SectionCard";
import TechnicianAssignmentsPanel from "@/src/components/TechnicianAssignmentsPanel";
import WebInlineLoginCard from "@/src/components/WebInlineLoginCard";
import { useSharedWebSessionState } from "@/src/session/web-session-store";
import { triggerSelectionHaptic } from "@/src/services/haptics";
import { radii, sizing, spacing } from "@/src/theme/layout";
import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies, typeScale } from "@/src/theme/typography";

const MIN_TOUCH_TARGET_SIZE = sizing.touchTargetMin;
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
  const screenEnterAnim = useRef(new Animated.Value(0)).current;

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

  useFocusEffect(
    useCallback(() => {
      if (!hasActiveSession) {
        screenEnterAnim.setValue(1);
        return;
      }
      screenEnterAnim.setValue(0);
      const animation = Animated.timing(screenEnterAnim, {
        toValue: 1,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });
      animation.start();
      return () => {
        animation.stop();
      };
    }, [hasActiveSession, screenEnterAnim]),
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

  const screenEnterTranslate = screenEnterAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [12, 0],
  });

  return (
    <ScreenScaffold contentContainerStyle={styles.container} scrollViewProps={{ keyboardShouldPersistTaps: "handled" }}>
      <Animated.View
        style={[
          styles.screenEnterWrap,
          {
            opacity: screenEnterAnim,
            transform: [{ translateY: screenEnterTranslate }],
          },
        ]}
      >
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
        <ConsoleButton
          variant="primary"
          size="sm"
          style={styles.smallButton}
          onPress={() => {
            void triggerSelectionHaptic();
            void loadAssets();
          }}
          loading={loadingAssets}
          label="Buscar"
          textStyle={styles.smallButtonText}
        />
      </View>

      <View style={styles.topActionsRow}>
        <ConsoleButton
          variant="ghost"
          style={styles.ghostButton}
          onPress={() => {
            void triggerSelectionHaptic();
            void loadAssets();
          }}
          label="Actualizar lista"
          textStyle={styles.ghostButtonText}
        />
        <ConsoleButton
          variant="ghost"
          style={styles.ghostButton}
          onPress={() => {
            void triggerSelectionHaptic();
            router.push("/qr?mode=scan");
          }}
          label="Escanear"
          textStyle={styles.ghostButtonText}
        />
        {resolveIntent ? (
          <ConsoleButton
            variant="subtle"
            style={styles.ghostButton}
            onPress={() => {
              void triggerSelectionHaptic();
              router.push("/case/manual" as never);
            }}
            label="Caso manual"
            textStyle={styles.ghostButtonText}
          />
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
                  onPress={() => {
                    void triggerSelectionHaptic();
                    setSelectedAssetId(asset.id);
                  }}
                  accessibilityRole="button"
                >
                  <Text style={[styles.assetCode, { color: palette.textPrimary }]}>#{asset.id} {asset.external_code}</Text>
                  <Text style={[styles.assetMeta, { color: palette.textSecondary }]}>
                    {(asset.brand || "-") + " / " + (asset.model || "-")} - {asset.client_name || "Sin cliente"}
                  </Text>
                </TouchableOpacity>
                <ConsoleButton
                  variant={selected ? "primary" : "subtle"}
                  size="sm"
                  style={styles.inlineAction}
                  onPress={() => {
                    void triggerSelectionHaptic();
                    if (selected) {
                      openPrimaryAction(asset);
                      return;
                    }
                    setSelectedAssetId(asset.id);
                  }}
                  label={selected ? (resolveIntent ? "Abrir en casos" : "Incidencia") : "Ver"}
                  textStyle={styles.inlineActionText}
                />
              </View>
            );
          })}
        </View>
      )}

      {loadingDetail ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={palette.loadingSpinner} />
          <Text style={[styles.loadingText, { color: palette.textSecondary }]}>Cargando detalle del equipo...</Text>
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
            Cliente {selectedAsset.client_name || "-"} - estado {selectedAsset.status || "active"}
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
            <ConsoleButton
              variant="primary"
              style={styles.primaryButton}
              onPress={() => {
                void triggerSelectionHaptic();
                openPrimaryAction(selectedAsset);
              }}
              label={resolveIntent ? "Abrir en casos" : "Crear incidencia"}
              textStyle={styles.primaryButtonText}
            />
            {!resolveIntent ? (
              <ConsoleButton
                variant="ghost"
                style={styles.secondaryButton}
                onPress={() => {
                  void triggerSelectionHaptic();
                  setShowLinkForm((current) => !current);
                }}
                label="Vincular a caso"
                textStyle={styles.secondaryButtonText}
              />
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
              <ConsoleButton
                variant="primary"
                style={styles.primaryButton}
                onPress={() => {
                  void triggerSelectionHaptic();
                  void onLinkAsset();
                }}
                loading={linking}
                label="Vincular ahora"
                textStyle={styles.primaryButtonText}
              />
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
      </Animated.View>
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
  },
  screenEnterWrap: {
    gap: spacing.s12,
  },
  searchRow: {
    flexDirection: "row",
    gap: spacing.s8,
    alignItems: "center",
  },
  searchInput: {
    flex: 1,
  },
  input: {
    borderWidth: 1,
    borderRadius: radii.r12,
    paddingHorizontal: spacing.s12,
    paddingVertical: spacing.s10,
    minHeight: MIN_TOUCH_TARGET_SIZE,
  },
  smallButton: {
    minHeight: MIN_TOUCH_TARGET_SIZE,
    minWidth: 84,
    borderRadius: radii.r10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.s12,
  },
  smallButtonText: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
  topActionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.s8,
  },
  ghostButton: {
    minHeight: MIN_TOUCH_TARGET_SIZE,
    borderRadius: radii.r10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.s12,
    paddingVertical: spacing.s9,
  },
  ghostButtonText: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
  assetList: {
    gap: spacing.s8,
  },
  assetRow: {
    borderWidth: 1,
    borderRadius: radii.r12,
    padding: spacing.s12,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s10,
  },
  assetInfo: {
    flex: 1,
    gap: spacing.s2,
  },
  assetCode: {
    fontFamily: fontFamilies.bold,
    ...typeScale.body,
    letterSpacing: -0.1,
  },
  assetMeta: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
  inlineAction: {
    minHeight: MIN_TOUCH_TARGET_SIZE,
    borderRadius: radii.r10,
    paddingHorizontal: spacing.s12,
    alignItems: "center",
    justifyContent: "center",
  },
  inlineActionText: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s8,
  },
  loadingText: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
  detailCard: {
    borderWidth: 1,
    borderRadius: radii.r16,
    padding: spacing.s14,
    gap: spacing.s8,
  },
  detailTitle: {
    fontFamily: fontFamilies.bold,
    ...typeScale.titleStrong,
    letterSpacing: -0.2,
  },
  detailLine: {
    fontFamily: fontFamilies.regular,
    ...typeScale.bodyCompact,
  },
  detailActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.s8,
    marginTop: spacing.s2,
  },
  primaryButton: {
    minHeight: MIN_TOUCH_TARGET_SIZE,
    borderRadius: radii.r10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.s14,
    paddingVertical: spacing.s12,
  },
  primaryButtonText: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
  secondaryButton: {
    minHeight: MIN_TOUCH_TARGET_SIZE,
    borderRadius: radii.r10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.s14,
    paddingVertical: spacing.s12,
  },
  secondaryButtonText: {
    fontFamily: fontFamilies.mono,
    ...typeScale.buttonMono,
    textTransform: "uppercase",
  },
  linkForm: {
    gap: spacing.s8,
    marginTop: spacing.s4,
  },
});
