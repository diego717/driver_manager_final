import { useCallback, useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
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

import { extractApiError } from "@/src/api/client";
import { listIncidentsByInstallation, listInstallations } from "@/src/api/incidents";
import { clearWebSession, readStoredWebSession } from "@/src/api/webAuth";
import { evaluateWebSession } from "@/src/api/webSession";
import { consumeForceLoginOnOpenFlag } from "@/src/security/startup-session-policy";
import { useAppPalette } from "@/src/theme/palette";
import { fontFamilies } from "@/src/theme/typography";
import { type Incident, type InstallationRecord } from "@/src/types/api";

export default function IncidentListScreen() {
  const palette = useAppPalette();
  const router = useRouter();
  const [installationId, setInstallationId] = useState("1");
  const [loading, setLoading] = useState(false);
  const [loadingInstallations, setLoadingInstallations] = useState(false);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [installations, setInstallations] = useState<InstallationRecord[]>([]);
  const [checkingSession, setCheckingSession] = useState(true);
  const [hasActiveSession, setHasActiveSession] = useState(false);

  const refreshSessionState = useCallback(async () => {
    setCheckingSession(true);
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
        setIncidents([]);
        setInstallations([]);
      }
      return isActive;
    } finally {
      setCheckingSession(false);
    }
  }, []);

  const loadIncidents = useCallback(
    async (targetInstallationId: number) => {
      const activeSession = await refreshSessionState();
      if (!activeSession) {
        return;
      }
      if (!Number.isInteger(targetInstallationId) || targetInstallationId <= 0) {
        Alert.alert("Dato invalido", "installation_id debe ser un numero positivo.");
        return;
      }

      try {
        setLoading(true);
        const response = await listIncidentsByInstallation(targetInstallationId);
        setIncidents(response.incidents);
      } catch (error) {
        Alert.alert("Error", extractApiError(error));
      } finally {
        setLoading(false);
      }
    },
    [refreshSessionState],
  );

  const loadInstallations = useCallback(
    async (options?: { forceRefresh?: boolean }) => {
      const activeSession = await refreshSessionState();
      if (!activeSession) {
        return;
      }

      try {
        setLoadingInstallations(true);
        const records = await listInstallations(options);
        setInstallations(records);
        setInstallationId((current) => {
          const currentId = Number.parseInt(current, 10);
          const exists = records.some((item) => item.id === currentId);
          if (!exists && records.length > 0) {
            return String(records[0].id);
          }
          return current;
        });
      } catch (error) {
        Alert.alert("Error", `No se pudo cargar instalaciones: ${extractApiError(error)}`);
      } finally {
        setLoadingInstallations(false);
      }
    },
    [refreshSessionState],
  );

  const onLoad = async () => {
    if (!(await refreshSessionState())) {
      Alert.alert("Sesion requerida", "Inicia sesion web en Configuracion y acceso.");
      router.push("/modal");
      return;
    }
    const parsedInstallationId = Number.parseInt(installationId, 10);
    await loadIncidents(parsedInstallationId);
  };

  const onSelectInstallation = async (id: number) => {
    if (!(await refreshSessionState())) {
      Alert.alert("Sesion requerida", "Inicia sesion web en Configuracion y acceso.");
      router.push("/modal");
      return;
    }
    const next = String(id);
    setInstallationId(next);
    await loadIncidents(id);
  };

  useEffect(() => {
    void loadInstallations();
  }, [loadInstallations]);

  useFocusEffect(
    useCallback(() => {
      const parsedInstallationId = Number.parseInt(installationId, 10);
      if (!Number.isInteger(parsedInstallationId) || parsedInstallationId <= 0) {
        return;
      }
      void loadIncidents(parsedInstallationId);
    }, [installationId, loadIncidents]),
  );

  if (checkingSession) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: palette.screenBg }]}>
        <ActivityIndicator size="large" color={palette.loadingSpinner} />
        <Text style={[styles.authHintText, { color: palette.textSecondary }]}>
          Verificando sesion web...
        </Text>
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
          <Text style={[styles.authTitle, { color: palette.textPrimary }]}>
            Sesion requerida
          </Text>
          <Text style={[styles.authHintText, { color: palette.textSecondary }]}>
            Inicia sesion web para ver registros e incidencias.
          </Text>
          <TouchableOpacity
            style={[styles.button, { backgroundColor: palette.primaryButtonBg }]}
            onPress={() => router.push("/modal")}
            accessibilityRole="button"
            accessibilityLabel="Ir a Configuracion y acceso"
          >
            <Text style={[styles.buttonText, { color: palette.primaryButtonText }]}>
              Ir a Configuracion y acceso
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={[styles.container, { backgroundColor: palette.screenBg }]}>
      <Text style={[styles.title, { color: palette.textPrimary }]}>Incidencias</Text>

      <View style={styles.rowBetween}>
        <Text style={[styles.label, { color: palette.textSecondary }]}>Instalaciones disponibles</Text>
        <TouchableOpacity
          style={[
            styles.refreshButton,
            { backgroundColor: palette.refreshBg, borderColor: palette.inputBorder },
          ]}
          onPress={() => {
            void loadInstallations({ forceRefresh: true });
          }}
          disabled={loadingInstallations}
        >
          {loadingInstallations ? (
            <ActivityIndicator size="small" color={palette.refreshText} />
          ) : (
            <Text style={[styles.refreshButtonText, { color: palette.refreshText }]}>Refrescar</Text>
          )}
        </TouchableOpacity>
      </View>
      {installations.length === 0 ? (
        <Text style={[styles.emptyText, { color: palette.textMuted }]}>No hay instalaciones para seleccionar.</Text>
      ) : (
        <>
          {installations.length > 30 ? (
            <Text style={[styles.emptyText, { color: palette.textMuted }]}>
              Mostrando 30 de {installations.length}. Usa Installation ID para buscar otras.
            </Text>
          ) : null}
          <View style={styles.chipsWrap}>
            {installations.slice(0, 30).map((item) => {
              const selected = String(item.id) === installationId;
              return (
                <TouchableOpacity
                  key={item.id}
                  style={[
                    styles.chip,
                    { backgroundColor: palette.chipBg, borderColor: palette.chipBorder },
                    selected && {
                      backgroundColor: palette.chipSelectedBg,
                      borderColor: palette.chipSelectedBorder,
                    },
                  ]}
                  onPress={() => {
                    void onSelectInstallation(item.id);
                  }}
                  disabled={loading}
                >
                  <Text
                    style={[
                      styles.chipText,
                      { color: palette.chipText },
                      selected && { color: palette.chipSelectedText },
                    ]}
                  >
                    #{item.id} {item.client_name ? `- ${item.client_name}` : ""}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      )}

      <Text style={[styles.label, { color: palette.textSecondary }]}>Installation ID</Text>
      <TextInput
        value={installationId}
        onChangeText={setInstallationId}
        keyboardType="numeric"
        style={[
          styles.input,
          {
            backgroundColor: palette.inputBg,
            borderColor: palette.inputBorder,
            color: palette.textPrimary,
          },
        ]}
        placeholder="1"
        placeholderTextColor={palette.placeholder}
      />

      <TouchableOpacity
        style={[
          styles.button,
          { backgroundColor: palette.primaryButtonBg },
          loading && styles.buttonDisabled,
        ]}
        onPress={() => {
          void onLoad();
        }}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color={palette.primaryButtonText} />
        ) : (
          <Text style={[styles.buttonText, { color: palette.primaryButtonText }]}>Cargar</Text>
        )}
      </TouchableOpacity>

      <View style={styles.section}>
        {incidents.length === 0 ? (
          <Text style={[styles.emptyText, { color: palette.textMuted }]}>Sin datos cargados.</Text>
        ) : (
          incidents.map((incident) => (
            <View
              key={incident.id}
              style={[styles.card, { backgroundColor: palette.cardBg, borderColor: palette.cardBorder }]}
            >
              <Text style={[styles.cardTitle, { color: palette.textPrimary }]}>#{incident.id} - {incident.severity}</Text>
              <Text style={[styles.cardText, { color: palette.textSecondary }]}>{incident.note}</Text>
              <Text style={[styles.cardMeta, { color: palette.textMuted }]}>
                Usuario: {incident.reporter_username} | Fotos: {incident.photos?.length ?? 0}
              </Text>
              <Text style={[styles.cardMeta, { color: palette.textMuted }]}>{incident.created_at}</Text>
              <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={[
                    styles.detailButton,
                    { backgroundColor: palette.refreshBg, borderColor: palette.inputBorder },
                  ]}
                  onPress={() =>
                    router.push(
                      `/incident/detail?incidentId=${incident.id}&installationId=${incident.installation_id}` as never,
                    )
                  }
                >
                  <Text style={[styles.detailButtonText, { color: palette.refreshText }]}>Ver detalle</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.uploadButton, { backgroundColor: palette.uploadButtonBg }]}
                  onPress={() =>
                    router.push(
                      `/incident/upload?incidentId=${incident.id}&installationId=${incident.installation_id}` as never,
                    )
                  }
                >
                  <Text style={[styles.uploadButtonText, { color: palette.uploadButtonText }]}>
                    Adjuntar foto
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </View>
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
  authHintText: {
    fontSize: 13,
    fontFamily: fontFamilies.regular,
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
  },
  title: {
    fontSize: 24,
    fontFamily: fontFamilies.bold,
  },
  label: {
    fontSize: 13,
    fontFamily: fontFamilies.semibold,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  button: {
    marginTop: 6,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
  },
  chipsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 4,
  },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipText: {
    fontSize: 12,
    fontFamily: fontFamilies.semibold,
  },
  refreshButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  refreshButtonText: {
    fontFamily: fontFamilies.semibold,
    fontSize: 12,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    fontFamily: fontFamilies.bold,
    fontSize: 15,
  },
  section: {
    marginTop: 10,
    gap: 10,
  },
  emptyText: {},
  card: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 6,
  },
  cardTitle: {
    fontFamily: fontFamilies.bold,
  },
  cardText: {},
  cardMeta: {
    fontSize: 12,
    fontFamily: fontFamilies.regular,
  },
  actionsRow: {
    marginTop: 4,
    flexDirection: "row",
    gap: 8,
  },
  detailButton: {
    alignSelf: "flex-start",
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  detailButtonText: {
    fontFamily: fontFamilies.bold,
    fontSize: 12,
  },
  uploadButton: {
    alignSelf: "flex-start",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  uploadButtonText: {
    fontFamily: fontFamilies.bold,
    fontSize: 12,
  },
});
