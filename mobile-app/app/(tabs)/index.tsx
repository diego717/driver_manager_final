import { useEffect, useState } from "react";
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
  createIncident,
  createInstallationRecord,
  listInstallations,
} from "@/src/api/incidents";
import { extractApiError } from "@/src/api/client";
import { type InstallationRecord } from "@/src/types/api";

export default function CreateIncidentScreen() {
  const [installationId, setInstallationId] = useState("1");
  const [reporterUsername, setReporterUsername] = useState("admin");
  const [note, setNote] = useState("");
  const [timeAdjustment, setTimeAdjustment] = useState("0");
  const [manualClientName, setManualClientName] = useState("");
  const [manualNotes, setManualNotes] = useState("");
  const [installations, setInstallations] = useState<InstallationRecord[]>([]);
  const [loadingInstallations, setLoadingInstallations] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [creatingManualRecord, setCreatingManualRecord] = useState(false);

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

  useEffect(() => {
    void loadInstallations();
  }, []);

  const onCreateManualRecord = async () => {
    try {
      setCreatingManualRecord(true);
      const response = await createInstallationRecord({
        client_name: manualClientName.trim() || "Sin cliente",
        notes: manualNotes.trim(),
        status: "manual",
        driver_brand: "N/A",
        driver_version: "N/A",
        driver_description: "Registro manual creado desde app móvil",
        os_info: "mobile",
        installation_time_seconds: 0,
      });

      const createdId = response.record?.id;
      if (createdId) {
        setInstallationId(String(createdId));
      }
      Alert.alert(
        "Registro creado",
        `ID: ${createdId ?? "N/A"}\nAhora puedes adjuntar incidencia sin instalación previa.`,
      );
      setManualClientName("");
      setManualNotes("");
      await loadInstallations();
    } catch (error) {
      Alert.alert("Error", extractApiError(error));
    } finally {
      setCreatingManualRecord(false);
    }
  };

  const onSubmit = async () => {
    const parsedInstallationId = Number.parseInt(installationId, 10);
    const parsedTimeAdjustment = Number.parseInt(timeAdjustment, 10);

    if (!Number.isInteger(parsedInstallationId) || parsedInstallationId <= 0) {
      Alert.alert("Dato invalido", "installation_id debe ser un numero positivo.");
      return;
    }
    if (!note.trim()) {
      Alert.alert("Dato invalido", "La nota es obligatoria.");
      return;
    }
    if (!Number.isInteger(parsedTimeAdjustment)) {
      Alert.alert("Dato invalido", "time_adjustment_seconds debe ser entero.");
      return;
    }

    try {
      setSubmitting(true);
      const response = await createIncident(parsedInstallationId, {
        note: note.trim(),
        reporter_username: reporterUsername.trim() || "mobile_user",
        time_adjustment_seconds: parsedTimeAdjustment,
        severity: "medium",
        source: "mobile",
        apply_to_installation: false,
      });

      Alert.alert(
        "Incidencia creada",
        `ID: ${response.incident.id}\nInstalacion: ${response.incident.installation_id}`,
      );
      setNote("");
      setTimeAdjustment("0");
    } catch (error) {
      Alert.alert("Error", extractApiError(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Crear incidencia</Text>
      <Text style={styles.subtitle}>
        Usa esta pantalla para validar el flujo desde Android hacia tu Worker.
      </Text>

      <Text style={styles.sectionTitle}>1) Crear registro manual base</Text>
      <Text style={styles.hint}>
        Esto crea un registro en historial sin depender de instalación previa.
      </Text>

      <Text style={styles.label}>Cliente (opcional)</Text>
      <TextInput
        value={manualClientName}
        onChangeText={setManualClientName}
        style={styles.input}
        placeholder="Cliente ACME"
        placeholderTextColor="#808080"
      />

      <Text style={styles.label}>Notas del registro base (opcional)</Text>
      <TextInput
        value={manualNotes}
        onChangeText={setManualNotes}
        style={[styles.input, styles.manualNoteInput]}
        multiline
        placeholder="Contexto inicial del caso"
        placeholderTextColor="#808080"
      />

      <TouchableOpacity
        style={[styles.secondaryButton, creatingManualRecord && styles.buttonDisabled]}
        onPress={onCreateManualRecord}
        disabled={creatingManualRecord}
      >
        {creatingManualRecord ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Crear registro manual</Text>
        )}
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>2) Crear incidencia sobre un registro</Text>

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
        <Text style={styles.hint}>No hay instalaciones para seleccionar.</Text>
      ) : (
        <View style={styles.chipsWrap}>
          {installations.slice(0, 30).map((item) => {
            const selected = String(item.id) === installationId;
            return (
              <TouchableOpacity
                key={item.id}
                style={[styles.chip, selected && styles.chipSelected]}
                onPress={() => setInstallationId(String(item.id))}
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

      <Text style={styles.label}>Usuario</Text>
      <TextInput
        value={reporterUsername}
        onChangeText={setReporterUsername}
        style={styles.input}
        placeholder="admin"
        placeholderTextColor="#808080"
      />

      <Text style={styles.label}>Nota</Text>
      <TextInput
        value={note}
        onChangeText={setNote}
        style={[styles.input, styles.noteInput]}
        multiline
        placeholder="Describe la incidencia"
        placeholderTextColor="#808080"
      />

      <Text style={styles.label}>Ajuste de tiempo (segundos)</Text>
      <TextInput
        value={timeAdjustment}
        onChangeText={setTimeAdjustment}
        keyboardType="numeric"
        style={styles.input}
        placeholder="0"
        placeholderTextColor="#808080"
      />

      <TouchableOpacity
        style={[styles.button, submitting && styles.buttonDisabled]}
        onPress={onSubmit}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Crear incidencia</Text>
        )}
      </TouchableOpacity>
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
  subtitle: {
    fontSize: 14,
    color: "#475569",
    marginBottom: 8,
  },
  sectionTitle: {
    marginTop: 10,
    fontSize: 14,
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
  hint: {
    color: "#64748b",
    fontSize: 12,
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
    backgroundColor: "#0b7a75",
    borderColor: "#0b7a75",
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
  noteInput: {
    minHeight: 110,
    textAlignVertical: "top",
  },
  manualNoteInput: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  secondaryButton: {
    marginTop: 6,
    backgroundColor: "#2563eb",
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
  },
  button: {
    marginTop: 10,
    backgroundColor: "#0b7a75",
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 15,
  },
});
