import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { AppleMaps, GoogleMaps } from "expo-maps";

import { extractApiError } from "@/src/api/client";
import { listAssignedIncidentsMap } from "@/src/api/technicians";
import EmptyStateCard from "@/src/components/EmptyStateCard";
import ScreenHero from "@/src/components/ScreenHero";
import ScreenScaffold from "@/src/components/ScreenScaffold";
import SyncStatusBanner from "@/src/components/SyncStatusBanner";
import WebInlineLoginCard from "@/src/components/WebInlineLoginCard";
import { assignedIncidentsMapRepository } from "@/src/db/repositories/assigned-incidents-map-repository";
import { useSharedWebSessionState } from "@/src/session/web-session-store";
import { captureCurrentGpsSnapshot } from "@/src/services/location";
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
const DEFAULT_CENTER = { latitude: -34.9011, longitude: -56.1645 };

type MapFilterKey = "all" | "open" | "in_progress" | "paused" | "critical";

function buildMapCenter(
  incidents: AssignedIncidentMapItem[],
  currentLocation: { latitude: number; longitude: number } | null,
  selectedIncidentId: number | null,
) {
  const coordinates = incidents
    .map((incident) => getIncidentDestinationCoordinate(incident))
    .filter((value): value is { latitude: number; longitude: number } => Boolean(value));

  if (currentLocation) {
    coordinates.push(currentLocation);
  }

  const selected = incidents.find((incident) => incident.id === selectedIncidentId);
  const selectedCoordinate = getIncidentDestinationCoordinate(selected || null);
  if (selectedCoordinate) {
    return selectedCoordinate;
  }

  if (!coordinates.length) {
    return DEFAULT_CENTER;
  }

  const latitudes = coordinates.map((coordinate) => coordinate.latitude);
  const longitudes = coordinates.map((coordinate) => coordinate.longitude);

  return {
    latitude: (Math.min(...latitudes) + Math.max(...latitudes)) / 2,
    longitude: (Math.min(...longitudes) + Math.max(...longitudes)) / 2,
  };
}

function buildMapZoom(
  incidents: AssignedIncidentMapItem[],
  currentLocation: { latitude: number; longitude: number } | null,
) {
  const coordinates = incidents
    .map((incident) => getIncidentDestinationCoordinate(incident))
    .filter((value): value is { latitude: number; longitude: number } => Boolean(value));

  if (currentLocation) {
    coordinates.push(currentLocation);
  }

  if (coordinates.length <= 1) return 15;

  const latitudes = coordinates.map((coordinate) => coordinate.latitude);
  const longitudes = coordinates.map((coordinate) => coordinate.longitude);
  const latSpan = Math.max(...latitudes) - Math.min(...latitudes);
  const lngSpan = Math.max(...longitudes) - Math.min(...longitudes);
  const span = Math.max(latSpan, lngSpan);

  if (span < 0.01) return 15;
  if (span < 0.03) return 14;
  if (span < 0.08) return 13;
  if (span < 0.2) return 12;
  return 11;
}

function getIncidentAccentColor(incident: AssignedIncidentMapItem, selectedIncidentId: number | null) {
  if (incident.id === selectedIncidentId) return "#0b7a75";
  if (incident.severity === "critical") return "#c64b39";
  return "#44758b";
}

function buildAndroidMarkers(
  incidents: AssignedIncidentMapItem[],
  currentLocation: { latitude: number; longitude: number } | null,
  selectedIncidentId: number | null,
) {
  const markers: GoogleMaps.Marker[] = incidents
    .map((incident) => {
      const coordinate = getIncidentDestinationCoordinate(incident);
      if (!coordinate) return null;
      return {
        id: String(incident.id),
        coordinates: coordinate,
        title: getIncidentDestinationLabel(incident),
        snippet: incident.dispatch_address || incident.note || `Incidencia #${incident.id}`,
        showCallout: incident.id === selectedIncidentId,
        zIndex: incident.id === selectedIncidentId ? 4 : incident.severity === "critical" ? 2 : 1,
      } satisfies GoogleMaps.Marker;
    })
    .filter(Boolean) as GoogleMaps.Marker[];

  if (currentLocation) {
    markers.push({
      id: "current-location",
      coordinates: currentLocation,
      title: "Tu ubicacion",
      snippet: "Referencia actual del tecnico",
      showCallout: false,
      zIndex: 3,
    });
  }

  return markers;
}

function buildAppleMarkers(
  incidents: AssignedIncidentMapItem[],
  currentLocation: { latitude: number; longitude: number } | null,
  selectedIncidentId: number | null,
) {
  const markers: AppleMaps.Marker[] = incidents
    .map((incident) => {
      const coordinate = getIncidentDestinationCoordinate(incident);
      if (!coordinate) return null;
      return {
        id: String(incident.id),
        coordinates: coordinate,
        title: getIncidentDestinationLabel(incident),
        tintColor: getIncidentAccentColor(incident, selectedIncidentId),
      } satisfies AppleMaps.Marker;
    })
    .filter(Boolean) as AppleMaps.Marker[];

  if (currentLocation) {
    markers.push({
      id: "current-location",
      coordinates: currentLocation,
      title: "Tu ubicacion",
      systemImage: "location.fill",
      tintColor: "#1677ff",
    });
  }

  return markers;
}

export default function MapTabScreen() {
  const palette = useAppPalette();
  const router = useRouter();
  const { checkingSession, hasActiveSession } = useSharedWebSessionState();
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<MapFilterKey>("all");
  const [incidents, setIncidents] = useState<AssignedIncidentMapItem[]>([]);
  const [selectedIncidentId, setSelectedIncidentId] = useState<number | null>(null);
  const [linkedTechnicianName, setLinkedTechnicianName] = useState("");
  const [locationLabel, setLocationLabel] = useState("Ubicacion pendiente");
  const [currentLocation, setCurrentLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [usingOfflineCache, setUsingOfflineCache] = useState(false);

  const loadMapData = useCallback(async () => {
    if (!hasActiveSession) return;
    try {
      setLoading(true);
      const cachedIncidents = await assignedIncidentsMapRepository.listAll();
      if (cachedIncidents.length > 0) {
        setIncidents(cachedIncidents);
        setUsingOfflineCache(true);
      }

      const [mapResponse, gpsSnapshot] = await Promise.all([
        listAssignedIncidentsMap(),
        captureCurrentGpsSnapshot(),
      ]);

      await assignedIncidentsMapRepository.replaceAll(mapResponse.incidents);
      setIncidents(mapResponse.incidents);
      setUsingOfflineCache(false);
      setLinkedTechnicianName(mapResponse.technician?.display_name || "");

      const gpsLatitude = Number(gpsSnapshot.lat);
      const gpsLongitude = Number(gpsSnapshot.lng);
      if (
        gpsSnapshot.status === "captured" &&
        Number.isFinite(gpsLatitude) &&
        Number.isFinite(gpsLongitude)
      ) {
        setCurrentLocation({ latitude: gpsLatitude, longitude: gpsLongitude });
        setLocationLabel("Posicion actual lista");
      } else {
        setCurrentLocation(null);
        setLocationLabel(
          gpsSnapshot.note?.trim() || "No se pudo obtener la ubicacion actual en esta lectura.",
        );
      }
    } catch (error) {
      const cachedIncidents = await assignedIncidentsMapRepository.listAll();
      if (cachedIncidents.length > 0) {
        setIncidents(cachedIncidents);
        setUsingOfflineCache(true);
        Alert.alert(
          "Mapa",
          "Sin conexion actual. Mostrando la ultima cola sincronizada; el mapa base requiere conectividad.",
        );
      } else {
        Alert.alert("Mapa", extractApiError(error));
        setIncidents([]);
        setSelectedIncidentId(null);
        setLinkedTechnicianName("");
      }
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
  const incidentsWithoutCoordinates = useMemo(
    () => filteredIncidents.filter((incident) => !getIncidentDestinationCoordinate(incident)),
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
    const preferredIncident = incidentsWithCoordinates[0] || filteredIncidents[0];
    setSelectedIncidentId(preferredIncident?.id || null);
  }, [filteredIncidents, incidentsWithCoordinates, selectedIncidentId]);

  const selectedIncident = useMemo(
    () => filteredIncidents.find((incident) => incident.id === selectedIncidentId) || null,
    [filteredIncidents, selectedIncidentId],
  );
  const selectedDistance = useMemo(
    () => calculateDistanceMeters(currentLocation, getIncidentDestinationCoordinate(selectedIncident)),
    [currentLocation, selectedIncident],
  );
  const selectedNavigationTargets = useMemo(
    () => buildIncidentNavigationTargets(selectedIncident),
    [selectedIncident],
  );

  const mapCenter = useMemo(
    () => buildMapCenter(incidentsWithCoordinates, currentLocation, selectedIncidentId),
    [currentLocation, incidentsWithCoordinates, selectedIncidentId],
  );
  const mapZoom = useMemo(
    () => buildMapZoom(incidentsWithCoordinates, currentLocation),
    [currentLocation, incidentsWithCoordinates],
  );
  const cameraPosition = useMemo(
    () => ({
      coordinates: mapCenter,
      zoom: mapZoom,
    }),
    [mapCenter, mapZoom],
  );

  const androidMarkers = useMemo(
    () => buildAndroidMarkers(incidentsWithCoordinates, currentLocation, selectedIncidentId),
    [currentLocation, incidentsWithCoordinates, selectedIncidentId],
  );
  const appleMarkers = useMemo(
    () => buildAppleMarkers(incidentsWithCoordinates, currentLocation, selectedIncidentId),
    [currentLocation, incidentsWithCoordinates, selectedIncidentId],
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

  const handleMarkerSelection = useCallback((markerId: string | undefined) => {
    if (!markerId || markerId === "current-location") return;
    const incidentId = Number(markerId);
    if (!Number.isInteger(incidentId) || incidentId <= 0) return;
    setSelectedIncidentId(incidentId);
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
            ? `Vista de incidencias asignadas a ${linkedTechnicianName}. Priorizamos destino, direccion y accion rapida.`
            : "Vista de incidencias asignadas y destino operativo para salir a calle."
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
              {incidentsWithCoordinates.length} con pin
            </Text>
          </View>
          <View style={[styles.heroMetaChip, { borderColor: palette.heroBorder, backgroundColor: palette.heroBg }]}>
            <Text style={[styles.heroMetaText, { color: palette.textPrimary }]}>
              {usingOfflineCache ? "Cache offline (lista)" : locationLabel}
            </Text>
          </View>
        </View>
      </ScreenHero>

      {usingOfflineCache ? (
        <View
          style={[
            styles.offlineNotice,
            { backgroundColor: palette.warningBg, borderColor: palette.warningText },
          ]}
        >
          <Text style={[styles.offlineNoticeText, { color: palette.warningText }]}>
            Estas viendo la cola local guardada. Sin red, el mapa base puede tardar o no cargar completo.
          </Text>
        </View>
      ) : null}

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
        {incidentsWithCoordinates.length === 0 ? (
          <EmptyStateCard
            title="Sin pines disponibles"
            body="Las incidencias filtradas no tienen coordenadas de destino ni una captura GPS valida. Igual podes abrir el detalle o navegar por direccion."
          />
        ) : Platform.OS === "android" ? (
          <GoogleMaps.View
            style={styles.map}
            cameraPosition={cameraPosition}
            markers={androidMarkers}
            properties={{
              mapType: GoogleMaps.MapType.NORMAL,
              isTrafficEnabled: false,
              isMyLocationEnabled: false,
              maxZoomPreference: 19,
              minZoomPreference: 5,
            }}
            uiSettings={{
              compassEnabled: false,
              mapToolbarEnabled: false,
              myLocationButtonEnabled: false,
              rotationGesturesEnabled: false,
              tiltGesturesEnabled: false,
              scaleBarEnabled: false,
              zoomControlsEnabled: false,
              zoomGesturesEnabled: true,
              scrollGesturesEnabled: true,
            }}
            colorScheme={GoogleMaps.MapColorScheme.FOLLOW_SYSTEM}
            onMarkerClick={(event) => handleMarkerSelection(event.id)}
          />
        ) : (
          <AppleMaps.View
            style={styles.map}
            cameraPosition={cameraPosition}
            markers={appleMarkers}
            properties={{
              mapType: AppleMaps.MapType.STANDARD,
              isTrafficEnabled: false,
              isMyLocationEnabled: false,
            }}
            uiSettings={{
              compassEnabled: false,
              myLocationButtonEnabled: false,
              scaleBarEnabled: false,
              togglePitchEnabled: false,
            }}
            onMarkerClick={(event) => handleMarkerSelection(event.id)}
          />
        )}
      </View>

      {incidentsWithCoordinates.length > 0 ? (
        <View style={[styles.pinRailCard, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}>
          <View style={styles.pinRailHeader}>
            <Text style={[styles.pinRailTitle, { color: palette.textPrimary }]}>Pines operativos</Text>
            <Text style={[styles.pinRailHint, { color: palette.textMuted }]}>
              Toca un pin o una tarjeta para enfocar la incidencia.
            </Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.pinRailContent}
          >
            {incidentsWithCoordinates.map((incident) => {
              const isSelected = selectedIncidentId === incident.id;
              return (
                <Pressable
                  key={incident.id}
                  onPress={() => setSelectedIncidentId(incident.id)}
                  style={[
                    styles.pinRailItem,
                    {
                      backgroundColor: isSelected ? palette.navActiveBg : palette.surfaceAlt,
                      borderColor: isSelected ? palette.accent : palette.cardBorder,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.pinRailEyebrow,
                      { color: isSelected ? palette.navActiveText : palette.textMuted },
                    ]}
                  >
                    #{incident.id} · {getIncidentStatusLabel(incident.incident_status)}
                  </Text>
                  <Text
                    numberOfLines={2}
                    style={[
                      styles.pinRailItemTitle,
                      { color: isSelected ? palette.navActiveText : palette.textPrimary },
                    ]}
                  >
                    {getIncidentDestinationLabel(incident)}
                  </Text>
                  <Text
                    numberOfLines={2}
                    style={[
                      styles.pinRailItemBody,
                      { color: isSelected ? palette.navActiveText : palette.textSecondary },
                    ]}
                  >
                    {incident.dispatch_address || incident.note || "Sin referencia operativa"}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

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
                    Incidencia #{selectedIncident.id} · {selectedIncident.assignment_source || "incident"}
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
              {selectedIncident.dispatch_reference ? (
                <Text style={[styles.supportingText, { color: palette.textSecondary }]}>
                  Referencia: {selectedIncident.dispatch_reference}
                </Text>
              ) : null}
              {selectedIncident.installation_label ? (
                <Text style={[styles.supportingText, { color: palette.textSecondary }]}>
                  Caso: {selectedIncident.installation_label}
                </Text>
              ) : null}
              {selectedIncident.asset_code ? (
                <Text style={[styles.supportingText, { color: palette.textSecondary }]}>
                  Equipo: {selectedIncident.asset_code}
                </Text>
              ) : null}

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
              body="Toca un pin del mapa o cambia el filtro para ver una tarjeta de despacho."
            />
          )}

          {incidentsWithoutCoordinates.length > 0 ? (
            <View style={[styles.listCard, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}>
              <Text style={[styles.listTitle, { color: palette.textPrimary }]}>
                Sin coordenadas ({incidentsWithoutCoordinates.length})
              </Text>
              {incidentsWithoutCoordinates.slice(0, 4).map((incident) => (
                <Pressable
                  key={incident.id}
                  onPress={() =>
                    router.push(
                      `/incident/detail?incidentId=${incident.id}&installationId=${incident.installation_id}` as never,
                    )
                  }
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
              ))}
            </View>
          ) : null}
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
  offlineNotice: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  offlineNoticeText: {
    fontFamily: fontFamilies.regular,
    fontSize: 12.5,
    lineHeight: 18,
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
    flex: 0.98,
    minHeight: 250,
    borderWidth: 1,
    borderRadius: 22,
    overflow: "hidden",
  },
  map: {
    flex: 1,
    minHeight: 250,
  },
  pinRailCard: {
    borderWidth: 1,
    borderRadius: 18,
    paddingVertical: 14,
    gap: 10,
  },
  pinRailHeader: {
    paddingHorizontal: 14,
    gap: 4,
  },
  pinRailTitle: {
    fontFamily: fontFamilies.bold,
    fontSize: 15,
  },
  pinRailHint: {
    fontFamily: fontFamilies.regular,
    fontSize: 12.5,
    lineHeight: 17,
  },
  pinRailContent: {
    paddingHorizontal: 14,
    gap: 10,
  },
  pinRailItem: {
    width: 214,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 6,
  },
  pinRailEyebrow: {
    fontFamily: fontFamilies.mono,
    fontSize: 10.5,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  pinRailItemTitle: {
    fontFamily: fontFamilies.semibold,
    fontSize: 13.5,
    lineHeight: 18,
  },
  pinRailItemBody: {
    fontFamily: fontFamilies.regular,
    fontSize: 12,
    lineHeight: 16,
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
