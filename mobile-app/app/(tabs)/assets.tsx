import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import {
  getAssetIncidents,
  linkAssetToInstallation,
  listAssets,
  type AssetRecord,
} from "@/src/api/assets";
import { extractApiError } from "@/src/api/client";
import { clearWebSession, readStoredWebSession } from "@/src/api/webAuth";
import { evaluateWebSession } from "@/src/api/webSession";
import { consumeForceLoginOnOpenFlag } from "@/src/security/startup-session-policy";
import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies } from "@/src/theme/typography";
import { buildQrPayload } from "@/src/utils/qr";

const MIN_TOUCH_TARGET_SIZE = 44;
const ASSET_LIST_LIMIT = 80;
const ASSET_INCIDENTS_LIMIT = 80;

function normalizeString(value: string | null | undefined): string {
  return String(value || "").trim();
}

function incidentStatusLabel(value: string | null | undefined): string {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === "resolved") return "Resuelta";
  if (normalized === "in_progress") return "En curso";
  return "Abierta";
}

export default function AssetsTabScreen() {
  const palette = useAppPalette();
  const router = useRouter();

  const [search, setSearch] = useState("");
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<number | null>(null);
  const [assetDetail, setAssetDetail] = useState<Awaited<ReturnType<typeof getAssetIncidents>> | null>(
    null,
  );

  const [linkInstallationId, setLinkInstallationId] = useState("");
  const [linkNotes, setLinkNotes] = useState("Asociado desde mobile.");
  const [showLinkForm, setShowLinkForm] = useState(false);

  const [loadingAssets, setLoadingAssets] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [linking, setLinking] = useState(false);
  const [checkingSession, setCheckingSession] = useState(false);
  const [hasActiveSession, setHasActiveSession] = useState(false);

  const selectedAsset = useMemo(
    () => assets.find((item) => item.id === selectedAssetId) || assetDetail?.asset || null,
    [assetDetail?.asset, assets, selectedAssetId],
  );

  const refreshSessionState = useCallback(async (options?: { showLoader?: boolean }) => {
    const showLoader = options?.showLoader === true;
    if (showLoader) setCheckingSession(true);

    try {
      if (consumeForceLoginOnOpenFlag()) {
        await clearWebSession();
      }
      const storedSession = await readStoredWebSession();
      const resolved = evaluateWebSession(storedSession.accessToken, storedSession.expiresAt);
      if (resolved.state === "expired") {
        await clearWebSession();
      }

      const isActive = resolved.state === "active";
      setHasActiveSession(isActive);
      if (!isActive) {
        setAssets([]);
        setSelectedAssetId(null);
        setAssetDetail(null);
      }
      return isActive;
    } finally {
      if (showLoader) setCheckingSession(false);
    }
  }, []);

  const loadAssets = useCallback(
    async (options?: { keepSelection?: boolean }) => {
      if (!(await refreshSessionState())) return;
      try {
        setLoadingAssets(true);
        const items = await listAssets({
          search: normalizeString(search) || undefined,
          limit: ASSET_LIST_LIMIT,
        });
        setAssets(items);

        if (!items.length) {
          setSelectedAssetId(null);
          setAssetDetail(null);
          return;
        }

        setSelectedAssetId((current) => {
          if (options?.keepSelection && current && items.some((asset) => asset.id === current)) {
            return current;
          }
          return items[0].id;
        });
      } catch (error) {
        Alert.alert("Error", extractApiError(error));
      } finally {
        setLoadingAssets(false);
      }
    },
    [refreshSessionState, search],
  );

  const loadAssetDetail = useCallback(
    async (assetId: number) => {
      if (!(await refreshSessionState())) return;
      try {
        setLoadingDetail(true);
        const detail = await getAssetIncidents(assetId, { limit: ASSET_INCIDENTS_LIMIT });
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
    },
    [refreshSessionState],
  );

  const openCreateIncident = useCallback(
    (asset: AssetRecord) => {
      const activeInstallationId = Number(assetDetail?.active_link?.installation_id);
      const installationParam =
        Number.isInteger(activeInstallationId) && activeInstallationId > 0
          ? `&installationId=${activeInstallationId}`
          : "";

      router.push(
        `/?assetExternalCode=${encodeURIComponent(asset.external_code)}&assetRecordId=${asset.id}${installationParam}` as never,
      );
    },
    [assetDetail?.active_link?.installation_id, router],
  );

  const openQrForAsset = useCallback(
    (asset: AssetRecord) => {
      const externalCode = normalizeString(asset.external_code);
      if (!externalCode) {
        Alert.alert("Dato invalido", "El equipo no tiene codigo externo para generar QR.");
        return;
      }

      try {
        // Validate payload format before navigation to ensure target screen can render preview.
        void buildQrPayload("asset", externalCode);
      } catch (error) {
        Alert.alert("QR invalido", extractApiError(error));
        return;
      }
      router.push(
        `/qr?qrType=asset&autoGenerate=1&externalCode=${encodeURIComponent(externalCode)}&brand=${encodeURIComponent(
          normalizeString(asset.brand),
        )}&model=${encodeURIComponent(normalizeString(asset.model))}&serialNumber=${encodeURIComponent(
          normalizeString(asset.serial_number),
        )}&clientName=${encodeURIComponent(normalizeString(asset.client_name))}&notes=${encodeURIComponent(
          normalizeString(asset.notes),
        )}` as never,
      );
    },
    [router],
  );

  const onLinkAsset = useCallback(async () => {
    if (!(await refreshSessionState())) {
      Alert.alert("Sesion requerida", "Inicia sesion web en Configuracion y acceso.");
      router.push("/modal");
      return;
    }

    if (!selectedAsset?.id) {
      Alert.alert("Dato invalido", "Selecciona un equipo primero.");
      return;
    }

    const parsedInstallationId = Number.parseInt(linkInstallationId, 10);
    if (!Number.isInteger(parsedInstallationId) || parsedInstallationId <= 0) {
      Alert.alert("Dato invalido", "installation_id debe ser un numero positivo.");
      return;
    }

    try {
      setLinking(true);
      await linkAssetToInstallation(selectedAsset.id, parsedInstallationId, normalizeString(linkNotes));
      Alert.alert(
        "Equipo asociado",
        `Equipo ${selectedAsset.external_code} asociado a instalacion #${parsedInstallationId}.`,
      );
      await loadAssetDetail(selectedAsset.id);
      setShowLinkForm(false);
    } catch (error) {
      Alert.alert("Error", extractApiError(error));
    } finally {
      setLinking(false);
    }
  }, [linkInstallationId, linkNotes, loadAssetDetail, refreshSessionState, router, selectedAsset]);

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      const active = await refreshSessionState({ showLoader: true });
      if (!active || cancelled) return;
      await loadAssets({ keepSelection: true });
    };
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [loadAssets, refreshSessionState]);

  useFocusEffect(
    useCallback(() => {
      void loadAssets({ keepSelection: true });
    }, [loadAssets]),
  );

  useEffect(() => {
    if (!selectedAssetId) return;
    void loadAssetDetail(selectedAssetId);
  }, [loadAssetDetail, selectedAssetId]);

  if (checkingSession) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: palette.screenBg }]}>
        <ActivityIndicator size="large" color={palette.loadingSpinner} />
        <Text style={[styles.hintText, { color: palette.textSecondary }]}>Verificando sesion...</Text>
      </View>
    );
  }

  if (!hasActiveSession) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: palette.screenBg }]}>
        <View
          style={[
            styles.authCard,
            { backgroundColor: palette.cardBg, borderColor: palette.cardBorder },
          ]}
        >
          <Text style={[styles.authTitle, { color: palette.textPrimary }]}>Sesion requerida</Text>
          <Text style={[styles.hintText, { color: palette.textSecondary }]}>
            Inicia sesion web para ver y asociar equipos.
          </Text>
          <TouchableOpacity
            style={[styles.button, { backgroundColor: palette.primaryButtonBg }]}
            onPress={() => router.push("/modal")}
            accessibilityRole="button"
          >
            <Text style={[styles.buttonText, { color: palette.primaryButtonText }]}>
              Ir a configuracion
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={[styles.container, { backgroundColor: palette.screenBg }]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.title, { color: palette.textPrimary }]}>Equipos</Text>
      <Text style={[styles.subtitle, { color: palette.textSecondary }]}>
        Busca, revisa detalle, crea incidencia, vincula instalacion y consulta QR.
      </Text>

      <View style={styles.searchRow}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          style={[
            styles.input,
            styles.searchInput,
            {
              backgroundColor: palette.inputBg,
              borderColor: palette.inputBorder,
              color: palette.textPrimary,
            },
          ]}
          placeholder="Buscar por codigo, marca, modelo, serie o cliente"
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
          {loadingAssets ? (
            <ActivityIndicator size="small" color={palette.primaryButtonText} />
          ) : (
            <Text style={[styles.smallButtonText, { color: palette.primaryButtonText }]}>Buscar</Text>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.topActionsRow}>
        <TouchableOpacity
          style={[styles.ghostButton, { backgroundColor: palette.refreshBg, borderColor: palette.inputBorder }]}
          onPress={() => {
            void loadAssets({ keepSelection: true });
          }}
          accessibilityRole="button"
        >
          <Text style={[styles.ghostButtonText, { color: palette.refreshText }]}>Actualizar</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.ghostButton, { backgroundColor: palette.refreshBg, borderColor: palette.inputBorder }]}
          onPress={() => router.push("/scan")}
          accessibilityRole="button"
        >
          <Text style={[styles.ghostButtonText, { color: palette.refreshText }]}>Escanear</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.ghostButton, { backgroundColor: palette.secondaryButtonBg }]}
          onPress={() => router.push("/qr")}
          accessibilityRole="button"
        >
          <Text style={[styles.ghostButtonText, { color: palette.secondaryButtonText }]}>
            Nuevo equipo + QR
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.ghostButton, { backgroundColor: palette.secondaryButtonBg }]}
          onPress={() => router.push("/drivers" as never)}
          accessibilityRole="button"
        >
          <Text style={[styles.ghostButtonText, { color: palette.secondaryButtonText }]}>
            Drivers R2
          </Text>
        </TouchableOpacity>
      </View>

      {assets.length === 0 ? (
        <Text style={[styles.hintText, { color: palette.textMuted }]}>No hay equipos para mostrar.</Text>
      ) : (
        <View style={styles.assetList}>
          {assets.map((asset) => {
            const selected = asset.id === selectedAssetId;
            return (
              <View
                key={asset.id}
                style={[
                  styles.assetRow,
                  { backgroundColor: palette.cardBg, borderColor: palette.cardBorder },
                ]}
              >
                <View style={styles.assetRowInfo}>
                  <Text style={[styles.assetCode, { color: palette.textPrimary }]}>#{asset.id} {asset.external_code}</Text>
                  <Text style={[styles.assetMeta, { color: palette.textSecondary }]}>
                    {(asset.brand || "-") + " / " + (asset.model || "-")} · serie {asset.serial_number || "-"}
                  </Text>
                  <Text style={[styles.assetMeta, { color: palette.textMuted }]}>
                    cliente {asset.client_name || "-"} · estado {asset.status || "active"}
                  </Text>
                </View>
                <View style={styles.assetRowActions}>
                  <TouchableOpacity
                    style={[
                      styles.inlineAction,
                      { backgroundColor: selected ? palette.chipSelectedBg : palette.refreshBg, borderColor: palette.inputBorder },
                    ]}
                    onPress={() => setSelectedAssetId(asset.id)}
                    accessibilityRole="button"
                  >
                    <Text
                      style={[
                        styles.inlineActionText,
                        { color: selected ? palette.chipSelectedText : palette.refreshText },
                      ]}
                    >
                      Detalle
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.inlineAction, { backgroundColor: palette.secondaryButtonBg }]}
                    onPress={() => openCreateIncident(asset)}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.inlineActionText, { color: palette.secondaryButtonText }]}>
                      Incidencia
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {loadingDetail ? (
        <View style={styles.loadingBlock}>
          <ActivityIndicator size="small" color={palette.loadingSpinner} />
          <Text style={[styles.hintText, { color: palette.textSecondary }]}>Cargando detalle...</Text>
        </View>
      ) : null}

      {selectedAsset ? (
        <View style={[styles.detailCard, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}>
          <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Detalle del equipo</Text>

          <View style={styles.detailActions}>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: palette.primaryButtonBg }]}
              onPress={() => openCreateIncident(selectedAsset)}
              accessibilityRole="button"
            >
              <Text style={[styles.actionBtnText, { color: palette.primaryButtonText }]}>
                Crear incidencia
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: palette.refreshBg, borderColor: palette.inputBorder }]}
              onPress={() => setShowLinkForm((current) => !current)}
              accessibilityRole="button"
            >
              <Text style={[styles.actionBtnText, { color: palette.refreshText }]}>Vincular instalacion</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: palette.refreshBg, borderColor: palette.inputBorder }]}
              onPress={() => openQrForAsset(selectedAsset)}
              accessibilityRole="button"
            >
              <Text style={[styles.actionBtnText, { color: palette.refreshText }]}>Ver QR</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.metaGrid}>
            <View style={[styles.metaItem, { borderColor: palette.inputBorder, backgroundColor: palette.itemBg }]}>
              <Text style={[styles.metaLabel, { color: palette.textMuted }]}>ID</Text>
              <Text style={[styles.metaValue, { color: palette.textPrimary }]}>#{selectedAsset.id}</Text>
            </View>
            <View style={[styles.metaItem, { borderColor: palette.inputBorder, backgroundColor: palette.itemBg }]}>
              <Text style={[styles.metaLabel, { color: palette.textMuted }]}>Codigo</Text>
              <Text style={[styles.metaValue, { color: palette.textPrimary }]}>{selectedAsset.external_code}</Text>
            </View>
            <View style={[styles.metaItem, { borderColor: palette.inputBorder, backgroundColor: palette.itemBg }]}>
              <Text style={[styles.metaLabel, { color: palette.textMuted }]}>Marca</Text>
              <Text style={[styles.metaValue, { color: palette.textPrimary }]}>{selectedAsset.brand || "-"}</Text>
            </View>
            <View style={[styles.metaItem, { borderColor: palette.inputBorder, backgroundColor: palette.itemBg }]}>
              <Text style={[styles.metaLabel, { color: palette.textMuted }]}>Modelo</Text>
              <Text style={[styles.metaValue, { color: palette.textPrimary }]}>{selectedAsset.model || "-"}</Text>
            </View>
            <View style={[styles.metaItem, { borderColor: palette.inputBorder, backgroundColor: palette.itemBg }]}>
              <Text style={[styles.metaLabel, { color: palette.textMuted }]}>Serie</Text>
              <Text style={[styles.metaValue, { color: palette.textPrimary }]}>{selectedAsset.serial_number || "-"}</Text>
            </View>
            <View style={[styles.metaItem, { borderColor: palette.inputBorder, backgroundColor: palette.itemBg }]}>
              <Text style={[styles.metaLabel, { color: palette.textMuted }]}>Cliente</Text>
              <Text style={[styles.metaValue, { color: palette.textPrimary }]}>{selectedAsset.client_name || "-"}</Text>
            </View>
          </View>

          {assetDetail?.active_link ? (
            <Text style={[styles.hintText, { color: palette.textSecondary }]}>
              Instalacion activa: #{assetDetail.active_link.installation_id}
            </Text>
          ) : (
            <Text style={[styles.hintText, { color: palette.textMuted }]}>
              Sin instalacion activa vinculada.
            </Text>
          )}

          {showLinkForm ? (
            <View style={styles.linkForm}>
              <TextInput
                value={linkInstallationId}
                onChangeText={setLinkInstallationId}
                keyboardType="numeric"
                style={[
                  styles.input,
                  {
                    backgroundColor: palette.inputBg,
                    borderColor: palette.inputBorder,
                    color: palette.textPrimary,
                  },
                ]}
                placeholder="Installation ID"
                placeholderTextColor={palette.placeholder}
              />
              <TextInput
                value={linkNotes}
                onChangeText={setLinkNotes}
                multiline
                style={[
                  styles.input,
                  styles.notesInput,
                  {
                    backgroundColor: palette.inputBg,
                    borderColor: palette.inputBorder,
                    color: palette.textPrimary,
                  },
                ]}
                placeholder="Nota de vinculacion"
                placeholderTextColor={palette.placeholder}
              />
              <TouchableOpacity
                style={[styles.button, { backgroundColor: palette.primaryButtonBg }, linking && styles.disabled]}
                onPress={() => {
                  void onLinkAsset();
                }}
                disabled={linking}
                accessibilityRole="button"
              >
                {linking ? (
                  <ActivityIndicator size="small" color={palette.primaryButtonText} />
                ) : (
                  <Text style={[styles.buttonText, { color: palette.primaryButtonText }]}>Vincular ahora</Text>
                )}
              </TouchableOpacity>
            </View>
          ) : null}

          <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Historial de asociaciones</Text>
          {!assetDetail?.links?.length ? (
            <Text style={[styles.hintText, { color: palette.textMuted }]}>
              Este equipo no tiene asociaciones registradas.
            </Text>
          ) : (
            <View style={styles.listWrap}>
              {assetDetail.links.slice(0, 20).map((link) => {
                const isActive = !link.unlinked_at;
                return (
                  <View
                    key={`${link.id || "l"}-${link.installation_id}-${link.linked_at || ""}`}
                    style={[styles.listItem, { borderColor: palette.inputBorder, backgroundColor: palette.itemBg }]}
                  >
                    <Text style={[styles.listItemTitle, { color: palette.textPrimary }]}>
                      Instalacion #{link.installation_id} {isActive ? "(activa)" : "(historial)"}
                    </Text>
                    <Text style={[styles.listItemMeta, { color: palette.textSecondary }]}>
                      {link.installation_client_name || "Sin cliente"} · vinculada {link.linked_at || "-"}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}

          <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>Incidencias del equipo</Text>
          {!assetDetail?.incidents?.length ? (
            <Text style={[styles.hintText, { color: palette.textMuted }]}>
              No hay incidencias registradas para este equipo.
            </Text>
          ) : (
            <View style={styles.listWrap}>
              {assetDetail.incidents.slice(0, 20).map((incident) => (
                <View
                  key={incident.id}
                  style={[styles.listItem, { borderColor: palette.inputBorder, backgroundColor: palette.itemBg }]}
                >
                  <Text style={[styles.listItemTitle, { color: palette.textPrimary }]}>
                    #{incident.id} · {incident.severity || "n/a"} · {incidentStatusLabel(incident.incident_status)} · inst #{incident.installation_id}
                  </Text>
                  <Text style={[styles.listItemMeta, { color: palette.textSecondary }]}>
                    {incident.note || "Sin nota"}
                  </Text>
                  <Text style={[styles.listItemMeta, { color: palette.textMuted }]}>
                    {incident.created_at || "-"} · fotos {incident.photos?.length ?? 0}
                  </Text>
                  <View style={styles.incidentActions}>
                    <TouchableOpacity
                      style={[styles.inlineAction, { backgroundColor: palette.refreshBg, borderColor: palette.inputBorder }]}
                      onPress={() =>
                        router.push(
                          `/incident/detail?incidentId=${incident.id}&installationId=${incident.installation_id}` as never,
                        )
                      }
                      accessibilityRole="button"
                    >
                      <Text style={[styles.inlineActionText, { color: palette.refreshText }]}>Detalle</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.inlineAction, { backgroundColor: palette.secondaryButtonBg }]}
                      onPress={() =>
                        router.push(
                          `/incident/upload?incidentId=${incident.id}&installationId=${incident.installation_id}` as never,
                        )
                      }
                      accessibilityRole="button"
                    >
                      <Text style={[styles.inlineActionText, { color: palette.secondaryButtonText }]}>
                        Subir foto
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      ) : null}
    </ScrollView>
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
    gap: 10,
  },
  authCard: {
    width: "100%",
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  authTitle: {
    fontSize: 18,
    fontFamily: fontFamilies.bold,
  },
  title: {
    fontSize: 24,
    fontFamily: fontFamilies.bold,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: fontFamilies.regular,
    marginBottom: 2,
  },
  searchRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  searchInput: {
    flex: 1,
  },
  topActionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 2,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  notesInput: {
    minHeight: 78,
    textAlignVertical: "top",
  },
  smallButton: {
    minHeight: MIN_TOUCH_TARGET_SIZE,
    minWidth: 84,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  smallButtonText: {
    fontFamily: fontFamilies.semibold,
    fontSize: 13,
  },
  ghostButton: {
    minHeight: MIN_TOUCH_TARGET_SIZE,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  ghostButtonText: {
    fontFamily: fontFamilies.semibold,
    fontSize: 13,
  },
  assetList: {
    gap: 8,
  },
  assetRow: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    gap: 8,
  },
  assetRowInfo: {
    gap: 2,
  },
  assetRowActions: {
    flexDirection: "row",
    gap: 8,
  },
  assetCode: {
    fontFamily: fontFamilies.bold,
    fontSize: 13,
  },
  assetMeta: {
    fontFamily: fontFamilies.regular,
    fontSize: 12,
  },
  inlineAction: {
    borderWidth: 1,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  inlineActionText: {
    fontFamily: fontFamilies.semibold,
    fontSize: 12,
  },
  loadingBlock: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  detailCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  sectionTitle: {
    marginTop: 4,
    fontFamily: fontFamilies.bold,
    fontSize: 18,
  },
  detailActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  actionBtn: {
    minHeight: MIN_TOUCH_TARGET_SIZE,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  actionBtnText: {
    fontFamily: fontFamilies.semibold,
    fontSize: 13,
  },
  metaGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 2,
  },
  metaItem: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minWidth: "46%",
    flexGrow: 1,
  },
  metaLabel: {
    fontFamily: fontFamilies.regular,
    fontSize: 11,
  },
  metaValue: {
    fontFamily: fontFamilies.semibold,
    fontSize: 13,
    marginTop: 2,
  },
  linkForm: {
    gap: 8,
    marginTop: 4,
  },
  qrCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    alignItems: "center",
    gap: 8,
  },
  qrPayload: {
    fontFamily: fontFamilies.regular,
    fontSize: 12,
    textAlign: "center",
  },
  button: {
    minHeight: MIN_TOUCH_TARGET_SIZE,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },
  buttonText: {
    fontFamily: fontFamilies.bold,
    fontSize: 14,
  },
  disabled: {
    opacity: 0.7,
  },
  listWrap: {
    gap: 8,
    marginTop: 2,
  },
  listItem: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    gap: 4,
  },
  listItemTitle: {
    fontFamily: fontFamilies.semibold,
    fontSize: 12,
  },
  listItemMeta: {
    fontFamily: fontFamilies.regular,
    fontSize: 12,
  },
  incidentActions: {
    marginTop: 4,
    flexDirection: "row",
    gap: 8,
  },
  hintText: {
    fontFamily: fontFamilies.regular,
    fontSize: 12,
  },
});
