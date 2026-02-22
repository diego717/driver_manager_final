import { useCallback, useEffect, useMemo, useState } from "react";
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
import { useThemePreference } from "@/src/theme/theme-preference";
import { type Incident, type InstallationRecord } from "@/src/types/api";

export default function IncidentListScreen() {
  const { resolvedScheme } = useThemePreference();
  const isDark = resolvedScheme === "dark";
  const router = useRouter();
  const [installationId, setInstallationId] = useState("1");
  const [loading, setLoading] = useState(false);
  const [loadingInstallations, setLoadingInstallations] = useState(false);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [installations, setInstallations] = useState<InstallationRecord[]>([]);
  const palette = useMemo(
    () => ({
      screenBg: isDark ? "#020617" : "#f8fafc",
      textPrimary: isDark ? "#e2e8f0" : "#0f172a",
      textSecondary: isDark ? "#cbd5e1" : "#1e293b",
      textMuted: isDark ? "#94a3b8" : "#64748b",
      inputBg: isDark ? "#111827" : "#ffffff",
      inputBorder: isDark ? "#334155" : "#cbd5e1",
      placeholder: isDark ? "#64748b" : "#808080",
      chipBg: isDark ? "#111827" : "#f8fafc",
      chipBorder: isDark ? "#334155" : "#cbd5e1",
      chipText: isDark ? "#cbd5e1" : "#334155",
      refreshBg: isDark ? "#0f172a" : "#ffffff",
      refreshText: isDark ? "#cbd5e1" : "#0f172a",
      cardBg: isDark ? "#0f172a" : "#ffffff",
      cardBorder: isDark ? "#334155" : "#cbd5e1",
      primaryButtonBg: isDark ? "#2563eb" : "#1d4ed8",
      primaryButtonText: "#ffffff",
      chipSelectedBg: isDark ? "#2563eb" : "#1d4ed8",
      chipSelectedBorder: isDark ? "#2563eb" : "#1d4ed8",
      chipSelectedText: "#ffffff",
      uploadButtonBg: isDark ? "#0f766e" : "#0b7a75",
      uploadButtonText: "#ffffff",
    }),
    [isDark],
  );

  const loadIncidents = useCallback(
    async (targetInstallationId: number) => {
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
    [],
  );

  const loadInstallations = useCallback(async (options?: { forceRefresh?: boolean }) => {
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
  }, []);

  const onLoad = async () => {
    const parsedInstallationId = Number.parseInt(installationId, 10);
    await loadIncidents(parsedInstallationId);
  };

  const onSelectInstallation = async (id: number) => {
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
                  onPress={() => onSelectInstallation(item.id)}
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
        style={[styles.input, { backgroundColor: palette.inputBg, borderColor: palette.inputBorder, color: palette.textPrimary }]}
        placeholder="1"
        placeholderTextColor={palette.placeholder}
      />

      <TouchableOpacity
        style={[
          styles.button,
          { backgroundColor: palette.primaryButtonBg },
          loading && styles.buttonDisabled,
        ]}
        onPress={onLoad}
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
  container: {
    padding: 20,
    gap: 10,
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
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
    fontWeight: "600",
  },
  refreshButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  refreshButtonText: {
    fontWeight: "600",
    fontSize: 12,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    fontWeight: "700",
    fontSize: 15,
  },
  section: {
    marginTop: 10,
    gap: 10,
  },
  emptyText: {
  },
  card: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 6,
  },
  cardTitle: {
    fontWeight: "700",
  },
  cardText: {},
  cardMeta: {
    fontSize: 12,
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
    fontWeight: "700",
    fontSize: 12,
  },
  uploadButton: {
    alignSelf: "flex-start",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  uploadButtonText: {
    fontWeight: "700",
    fontSize: 12,
  },
});
