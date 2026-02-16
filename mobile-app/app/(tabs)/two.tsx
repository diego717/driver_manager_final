import { useEffect, useState } from "react";
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

import { extractApiError } from "@/src/api/client";
import { listIncidentsByInstallation, listInstallations } from "@/src/api/incidents";
import { type Incident, type InstallationRecord } from "@/src/types/api";

export default function IncidentListScreen() {
  const router = useRouter();
  const [installationId, setInstallationId] = useState("1");
  const [loading, setLoading] = useState(false);
  const [loadingInstallations, setLoadingInstallations] = useState(false);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [installations, setInstallations] = useState<InstallationRecord[]>([]);

  const loadInstallations = async () => {
    try {
      setLoadingInstallations(true);
      const records = await listInstallations();
      setInstallations(records);

      const currentId = Number.parseInt(installationId, 10);
      const exists = records.some((item) => Number(item.id) === currentId);
      if (!exists && records.length > 0) {
        setInstallationId(String(records[0].id));
      }
    } catch (error) {
      Alert.alert("Error", `No se pudo cargar instalaciones: ${extractApiError(error)}`);
    } finally {
      setLoadingInstallations(false);
    }
  };

  const onLoad = async () => {
    const parsedInstallationId = Number.parseInt(installationId, 10);
    if (!Number.isInteger(parsedInstallationId) || parsedInstallationId <= 0) {
      Alert.alert("Dato invalido", "installation_id debe ser un numero positivo.");
      return;
    }

    try {
      setLoading(true);
      const response = await listIncidentsByInstallation(parsedInstallationId);
      setIncidents(response.incidents);
    } catch (error) {
      Alert.alert("Error", extractApiError(error));
    } finally {
      setLoading(false);
    }
  };

  const onSelectInstallation = async (id: number) => {
    const next = String(id);
    setInstallationId(next);

    try {
      setLoading(true);
      const response = await listIncidentsByInstallation(id);
      setIncidents(response.incidents);
    } catch (error) {
      Alert.alert("Error", extractApiError(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadInstallations();
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Incidencias</Text>

      <View style={styles.rowBetween}>
        <Text style={styles.label}>Instalaciones disponibles</Text>
        <TouchableOpacity
          style={styles.refreshButton}
          onPress={loadInstallations}
          disabled={loadingInstallations}
        >
          {loadingInstallations ? (
            <ActivityIndicator size="small" color="#0f172a" />
          ) : (
            <Text style={styles.refreshButtonText}>Refrescar</Text>
          )}
        </TouchableOpacity>
      </View>
      {installations.length === 0 ? (
        <Text style={styles.emptyText}>No hay instalaciones para seleccionar.</Text>
      ) : (
        <View style={styles.chipsWrap}>
          {installations.slice(0, 30).map((item) => {
            const selected = String(item.id) === installationId;
            return (
              <TouchableOpacity
                key={item.id}
                style={[styles.chip, selected && styles.chipSelected]}
                onPress={() => onSelectInstallation(item.id)}
                disabled={loading}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                  #{item.id} {item.client_name ? `- ${item.client_name}` : ""}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      <Text style={styles.label}>Installation ID</Text>
      <TextInput
        value={installationId}
        onChangeText={setInstallationId}
        keyboardType="numeric"
        style={styles.input}
        placeholder="1"
        placeholderTextColor="#808080"
      />

      <TouchableOpacity
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={onLoad}
        disabled={loading}
      >
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Cargar</Text>}
      </TouchableOpacity>

      <View style={styles.section}>
        {incidents.length === 0 ? (
          <Text style={styles.emptyText}>Sin datos cargados.</Text>
        ) : (
          incidents.map((incident) => (
            <View key={incident.id} style={styles.card}>
              <Text style={styles.cardTitle}>#{incident.id} - {incident.severity}</Text>
              <Text style={styles.cardText}>{incident.note}</Text>
              <Text style={styles.cardMeta}>
                Usuario: {incident.reporter_username} | Fotos: {incident.photos?.length ?? 0}
              </Text>
              <Text style={styles.cardMeta}>{incident.created_at}</Text>
              <TouchableOpacity
                style={styles.uploadButton}
                onPress={() =>
                  router.push(
                    `/incident/upload?incidentId=${incident.id}&installationId=${incident.installation_id}` as never,
                  )
                }
              >
                <Text style={styles.uploadButtonText}>Adjuntar foto</Text>
              </TouchableOpacity>
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
    color: "#0f172a",
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: "#1e293b",
  },
  input: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#fff",
  },
  button: {
    marginTop: 6,
    backgroundColor: "#1d4ed8",
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
    borderColor: "#cbd5e1",
    backgroundColor: "#f8fafc",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipSelected: {
    backgroundColor: "#1d4ed8",
    borderColor: "#1d4ed8",
  },
  chipText: {
    fontSize: 12,
    color: "#334155",
    fontWeight: "600",
  },
  chipTextSelected: {
    color: "#ffffff",
  },
  refreshButton: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#ffffff",
  },
  refreshButtonText: {
    color: "#0f172a",
    fontWeight: "600",
    fontSize: 12,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 15,
  },
  section: {
    marginTop: 10,
    gap: 10,
  },
  emptyText: {
    color: "#64748b",
  },
  card: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 10,
    backgroundColor: "#fff",
    padding: 12,
    gap: 6,
  },
  cardTitle: {
    fontWeight: "700",
    color: "#0f172a",
  },
  cardText: {
    color: "#1e293b",
  },
  cardMeta: {
    color: "#64748b",
    fontSize: 12,
  },
  uploadButton: {
    marginTop: 4,
    alignSelf: "flex-start",
    borderRadius: 8,
    backgroundColor: "#0b7a75",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  uploadButtonText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 12,
  },
});
