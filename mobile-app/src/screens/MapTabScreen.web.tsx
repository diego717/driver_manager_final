import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { extractApiError } from "@/src/api/client";
import { listAssignedIncidentsMap } from "@/src/api/technicians";
import EmptyStateCard from "@/src/components/EmptyStateCard";
import ScreenHero from "@/src/components/ScreenHero";
import ScreenScaffold from "@/src/components/ScreenScaffold";
import SyncStatusBanner from "@/src/components/SyncStatusBanner";
import WebInlineLoginCard from "@/src/components/WebInlineLoginCard";
import { useSharedWebSessionState } from "@/src/session/web-session-store";
import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies } from "@/src/theme/typography";
import { type AssignedIncidentMapItem } from "@/src/types/api";
import {
  buildIncidentNavigationTargets,
  calculateDistanceMeters,
  formatDistanceMeters,
  getIncidentDestinationCoordinate,
  getIncidentDestinationLabel,
} from "@/src/utils/incident-dispatch";
import { getIncidentStatusLabel, getSeverityLabel, normalizeIncidentStatus } from "@/src/utils/incidents";

const MIN_TOUCH_TARGET_SIZE = 44;

type MapFilterKey = "all" | "open" | "in_progress" | "paused" | "critical";

export default function MapTabScreenWeb() {
  const palette = useAppPalette();
  const router = useRouter();
  const { checkingSession, hasActiveSession } = useSharedWebSessionState();
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<MapFilterKey>("all");
  const [incidents, setIncidents] = useState<AssignedIncidentMapItem[]>([]);
  const [selectedIncidentId, setSelectedIncidentId] = useState<number | null>(null);
  const [linkedTechnicianName, setLinkedTechnicianName] = useState("");

  const loadMapData = useCallback(async () => {
    if (!hasActiveSession) return;
    try {
      setLoading(true);
      const mapResponse = await listAssignedIncidentsMap();
      setIncidents(mapResponse.incidents);
      setLinkedTechnicianName(mapResponse.technician?.display_name || "");
    } catch (error) {
      Alert.alert("Mapa", extractApiError(error));
      setIncidents([]);
      setSelectedIncidentId(null);
      setLinkedTechnicianName("");
    } finally {
      setLoading(false);
    }
  }, [hasActiveSession]);

  useFocusEffect(
    useCallback(() => {
      if (!hasActiveSession) return;
      void loadMapData();
    }, [hasActiveSession, loadMapData]),
  );

  const filteredIncidents = useMemo(() => {
    return incidents.filter((incident) => {
      const status = normalizeIncidentStatus(incident.incident_status);
      if (filter === "critical") {
        return String(incident.severity || "").toLowerCase() === "critical";
      }
      if (filter === "all") return true;
      return status === filter;
    });
  }, [filter, incidents]);

  const incidentsWithCoordinates = useMemo(
    () => filteredIncidents.filter((incident) => getIncidentDestinationCoordinate(incident)),
    [filteredIncidents],
  );

  useEffect(() => {
    if (!filteredIncidents.length) {
      setSelectedIncidentId(null);
      return;
    }
    if (filteredIncidents.some((incident) => incident.id === selectedIncidentId)) {
      return;
    }
    setSelectedIncidentId((incidentsWithCoordinates[0] || filteredIncidents[0])?.id || null);
  }, [filteredIncidents, incidentsWithCoordinates, selectedIncidentId]);

  const selectedIncident = useMemo(
    () => filteredIncidents.find((incident) => incident.id === selectedIncidentId) || null,
    [filteredIncidents, selectedIncidentId],
  );

  const selectedNavigationTargets = useMemo(
    () => buildIncidentNavigationTargets(selectedIncident),
    [selectedIncident],
  );

  const selectedDistance = useMemo(
    () => calculateDistanceMeters(null, getIncidentDestinationCoordinate(selectedIncident)),
    [selectedIncident],
  );

  const openExternalUrl = useCallback(async (targetUrl: string | null, targetName: string) => {
    if (!targetUrl) {
      Alert.alert("Mapa", `No hay un destino operativo compatible con ${targetName}.`);
      return;
    }
    const supported = await Linking.canOpenURL(targetUrl);
    if (!supported) {
      Alert.alert("Mapa", `No se pudo abrir ${targetName} en este dispositivo.`);
      return;
    }
    await Linking.openURL(targetUrl);
  }, []);

  if (checkingSession) {
    return (
      <ScreenScaffold centered>
        <ActivityIndicator size="large" color={palette.loadingSpinner} />
      </ScreenScaffold>
    );
  }

  if (!hasActiveSession) {
    return (
      <ScreenScaffold>
        <WebInlineLoginCard
          hint="Inicia sesion web para ver tus incidencias asignadas en el mapa."
          onLoginSuccess={() => loadMapData()}
        />
      </ScreenScaffold>
    );
  }

  return (
    <ScreenScaffold scroll={false} contentContainerStyle={styles.screenContent}>
      <SyncStatusBanner />
      <ScreenHero
        eyebrow="Despacho"
        title="Mapa operativo"
        description={
          linkedTechnicianName
            ? `Vista web de incidencias asignadas a ${linkedTechnicianName}. La navegacion queda disponible y el mapa nativo sigue en iOS/Android.`
            : "Vista web de incidencias asignadas. La navegacion queda disponible y el mapa nativo sigue en iOS/Android."
        }
      >
        <View style={styles.heroMetaRow}>
          <View style={[styles.heroMetaChip, { borderColor: palette.heroBorder, backgroundColor: palette.heroBg }]}>
            <Text style={[styles.heroMetaText, { color: palette.textPrimary }]}>
              {filteredIncidents.length} visibles
            </Text>
          </View>
          <View style={[styles.heroMetaChip, { borderColor: palette.heroBorder, backgroundColor: palette.heroBg }]}>
            <Text style={[styles.heroMetaText, { color: palette.textPrimary }]}>
              {incidentsWithCoordinates.length} con destino
            </Text>
          </View>
        </View>
      </ScreenHero>

      <View style={styles.filtersRow}>
        {[
          ["all", "Todo"],
          ["open", "Abiertas"],
          ["in_progress", "En curso"],
          ["paused", "Pausadas"],
          ["critical", "Criticas"],
        ].map(([key, label]) => {
          const selected = filter === key;
          return (
            <Pressable
              key={key}
              onPress={() => setFilter(key as MapFilterKey)}
              style={[
                styles.filterChip,
                {
                  backgroundColor: selected ? palette.navActiveBg : palette.cardBg,
                  borderColor: selected ? palette.accent : palette.cardBorder,
                },
              ]}
            >
              <Text
                style={[
                  styles.filterChipText,
                  { color: selected ? palette.navActiveText : palette.textSecondary },
                ]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          onPress={() => {
            void loadMapData();
          }}
          style={[
            styles.refreshChip,
            { backgroundColor: palette.refreshBg, borderColor: palette.inputBorder },
          ]}
        >
          {loading ? (
            <ActivityIndicator size="small" color={palette.refreshText} />
          ) : (
            <Text style={[styles.filterChipText, { color: palette.refreshText }]}>Actualizar</Text>
          )}
        </Pressable>
      </View>

      <View style={[styles.mapCard, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}>
        <EmptyStateCard
          title="Mapa nativo solamente"
          body="La vista web no carga react-native-maps. Usa el listado inferior para abrir incidencias o lanzar navegacion externa, y en el celular seguiras viendo el mapa completo."
        />
      </View>

      <View style={styles.bottomPanel}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.bottomPanelContent}
          showsVerticalScrollIndicator={false}
        >
          {selectedIncident ? (
            <View style={[styles.focusCard, { backgroundColor: palette.heroBg, borderColor: palette.heroBorder }]}>
              <View style={styles.focusHeader}>
                <View style={styles.focusHeaderText}>
                  <Text style={[styles.focusEyebrow, { color: palette.textMuted }]}>
                    Incidencia #{selectedIncident.id}
                  </Text>
                  <Text style={[styles.focusTitle, { color: palette.textPrimary }]}>
                    {getIncidentDestinationLabel(selectedIncident)}
                  </Text>
                </View>
                <View style={styles.focusBadges}>
                  <View style={[styles.statusBadge, { backgroundColor: palette.navActiveBg, borderColor: palette.heroBorder }]}>
                    <Text style={[styles.statusBadgeText, { color: palette.navActiveText }]}>
                      {getIncidentStatusLabel(selectedIncident.incident_status)}
                    </Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: palette.warningBg, borderColor: palette.warningText }]}>
                    <Text style={[styles.statusBadgeText, { color: palette.warningText }]}>
                      {getSeverityLabel(selectedIncident.severity)}
                    </Text>
                  </View>
                </View>
              </View>

              <Text style={[styles.supportingText, { color: palette.textSecondary }]}>
                {selectedIncident.dispatch_address || "Sin direccion legible"}
              </Text>

              <View style={styles.metaGrid}>
                <View style={[styles.metaCard, { backgroundColor: palette.surfaceAlt, borderColor: palette.cardBorder }]}>
                  <Text style={[styles.metaValue, { color: palette.textPrimary }]}>
                    {formatDistanceMeters(selectedDistance)}
                  </Text>
                  <Text style={[styles.metaLabel, { color: palette.textMuted }]}>Distancia</Text>
                </View>
                <View style={[styles.metaCard, { backgroundColor: palette.surfaceAlt, borderColor: palette.cardBorder }]}>
                  <Text style={[styles.metaValue, { color: palette.textPrimary }]}>
                    {selectedIncident.assignment_role || "owner"}
                  </Text>
                  <Text style={[styles.metaLabel, { color: palette.textMuted }]}>Rol</Text>
                </View>
              </View>

              <View style={styles.actionRow}>
                <Pressable
                  style={[styles.primaryAction, { backgroundColor: palette.primaryButtonBg }]}
                  onPress={() =>
                    router.push(
                      `/incident/detail?incidentId=${selectedIncident.id}&installationId=${selectedIncident.installation_id}` as never,
                    )
                  }
                >
                  <Text style={[styles.primaryActionText, { color: palette.primaryButtonText }]}>
                    Ver incidencia
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.secondaryAction, { backgroundColor: palette.secondaryButtonBg, borderColor: palette.inputBorder }]}
                  onPress={() => {
                    void openExternalUrl(
                      selectedNavigationTargets.google || selectedNavigationTargets.waze,
                      "navegacion",
                    );
                  }}
                >
                  <Text style={[styles.secondaryActionText, { color: palette.secondaryButtonText }]}>
                    Ir
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <EmptyStateCard
              title="Sin incidencia seleccionada"
              body="Elegi un registro del listado para ver su tarjeta de despacho."
            />
          )}

          <View style={[styles.listCard, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}>
            <Text style={[styles.listTitle, { color: palette.textPrimary }]}>
              Incidencias filtradas ({filteredIncidents.length})
            </Text>
            {filteredIncidents.length === 0 ? (
              <EmptyStateCard
                title="Sin incidencias"
                body="No hay incidencias para el filtro actual."
              />
            ) : (
              filteredIncidents.map((incident) => (
                <Pressable
                  key={incident.id}
                  onPress={() => setSelectedIncidentId(incident.id)}
                  style={[styles.listItem, { borderColor: palette.inputBorder }]}
                >
                  <View style={styles.listItemText}>
                    <Text style={[styles.listItemTitle, { color: palette.textPrimary }]}>
                      {getIncidentDestinationLabel(incident)}
                    </Text>
                    <Text style={[styles.listItemBody, { color: palette.textSecondary }]}>
                      {incident.dispatch_address || incident.note || "Sin direccion operativa"}
                    </Text>
                  </View>
                  <Text style={[styles.listItemMeta, { color: palette.textMuted }]}>#{incident.id}</Text>
                </Pressable>
              ))
            )}
          </View>
        </ScrollView>
      </View>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  screenContent: {
    flex: 1,
    gap: 12,
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
    paddingVertical: 6,
  },
  heroMetaText: {
    fontFamily: fontFamilies.mono,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  filtersRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  filterChip: {
    minHeight: MIN_TOUCH_TARGET_SIZE,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    justifyContent: "center",
  },
  refreshChip: {
    minHeight: MIN_TOUCH_TARGET_SIZE,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  filterChipText: {
    fontFamily: fontFamilies.mono,
    fontSize: 11.5,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  mapCard: {
    minHeight: 180,
    borderWidth: 1,
    borderRadius: 22,
    overflow: "hidden",
    padding: 12,
  },
  bottomPanel: {
    flex: 1,
  },
  bottomPanelContent: {
    gap: 12,
    paddingBottom: 8,
  },
  focusCard: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    gap: 12,
  },
  focusHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 10,
  },
  focusHeaderText: {
    flex: 1,
    gap: 4,
  },
  focusEyebrow: {
    fontFamily: fontFamilies.mono,
    fontSize: 11,
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  focusTitle: {
    fontFamily: fontFamilies.bold,
    fontSize: 20,
    lineHeight: 25,
  },
  focusBadges: {
    gap: 8,
    alignItems: "flex-end",
  },
  statusBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusBadgeText: {
    fontFamily: fontFamilies.mono,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  supportingText: {
    fontFamily: fontFamilies.regular,
    fontSize: 13,
    lineHeight: 18,
  },
  metaGrid: {
    flexDirection: "row",
    gap: 10,
  },
  metaCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 4,
  },
  metaValue: {
    fontFamily: fontFamilies.bold,
    fontSize: 18,
  },
  metaLabel: {
    fontFamily: fontFamilies.mono,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
  },
  primaryAction: {
    flex: 1.35,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  primaryActionText: {
    fontFamily: fontFamilies.bold,
    fontSize: 14,
  },
  secondaryAction: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET_SIZE,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  secondaryActionText: {
    fontFamily: fontFamilies.bold,
    fontSize: 13.5,
  },
  listCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    gap: 10,
  },
  listTitle: {
    fontFamily: fontFamilies.bold,
    fontSize: 16,
  },
  listItem: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  listItemText: {
    flex: 1,
    gap: 4,
  },
  listItemTitle: {
    fontFamily: fontFamilies.semibold,
    fontSize: 13.5,
  },
  listItemBody: {
    fontFamily: fontFamilies.regular,
    fontSize: 12.5,
    lineHeight: 17,
  },
  listItemMeta: {
    fontFamily: fontFamilies.mono,
    fontSize: 11.5,
  },
});
