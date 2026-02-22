import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

import {
  createIncident,
  createInstallationRecord,
  listInstallations,
} from "@/src/api/incidents";
import { extractApiError } from "@/src/api/client";
import { getStoredWebAccessUsername } from "@/src/storage/secure";
import { useThemePreference } from "@/src/theme/theme-preference";
import { type IncidentSeverity, type InstallationRecord } from "@/src/types/api";

const SEVERITY_OPTIONS: Array<{
  value: IncidentSeverity;
  label: string;
  criteria: string;
}> = [
  {
    value: "low",
    label: "Baja",
    criteria: "No bloquea operacion y hay workaround.",
  },
  {
    value: "medium",
    label: "Media",
    criteria: "Afecta operacion parcial, requiere atencion hoy.",
  },
  {
    value: "high",
    label: "Alta",
    criteria: "Bloquea proceso principal o multiples usuarios.",
  },
  {
    value: "critical",
    label: "Critica",
    criteria: "Caida total, riesgo de datos o cliente detenido.",
  },
];

export default function CreateIncidentScreen() {
  const { resolvedScheme } = useThemePreference();
  const isDark = resolvedScheme === "dark";
  const [installationId, setInstallationId] = useState("1");
  const [reporterUsername, setReporterUsername] = useState("admin");
  const [note, setNote] = useState("");
  const [timeAdjustment, setTimeAdjustment] = useState("0");
  const [severity, setSeverity] = useState<IncidentSeverity>("medium");
  const [manualClientName, setManualClientName] = useState("");
  const [manualNotes, setManualNotes] = useState("");
  const [installations, setInstallations] = useState<InstallationRecord[]>([]);
  const [loadingInstallations, setLoadingInstallations] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [creatingManualRecord, setCreatingManualRecord] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const palette = useMemo(
    () => ({
      screenBg: isDark ? "#020617" : "#f8fafc",
      textPrimary: isDark ? "#e2e8f0" : "#0f172a",
      textSecondary: isDark ? "#94a3b8" : "#475569",
      textMuted: isDark ? "#94a3b8" : "#64748b",
      label: isDark ? "#cbd5e1" : "#1e293b",
      inputBg: isDark ? "#111827" : "#ffffff",
      inputBorder: isDark ? "#334155" : "#cbd5e1",
      placeholder: isDark ? "#64748b" : "#808080",
      feedbackBg: isDark ? "#082f49" : "#f0f9ff",
      feedbackBorder: isDark ? "#0369a1" : "#bae6fd",
      feedbackText: isDark ? "#bae6fd" : "#0c4a6e",
      chipBg: isDark ? "#111827" : "#f8fafc",
      chipBorder: isDark ? "#334155" : "#cbd5e1",
      chipText: isDark ? "#cbd5e1" : "#334155",
      refreshBg: isDark ? "#0f172a" : "#ffffff",
      refreshText: isDark ? "#cbd5e1" : "#0f172a",
      severityBg: isDark ? "#0f172a" : "#ffffff",
      severityBorder: isDark ? "#334155" : "#cbd5e1",
      severityLabel: isDark ? "#e2e8f0" : "#0f172a",
      severityCriteria: isDark ? "#94a3b8" : "#475569",
    }),
    [isDark],
  );

  const notify = (title: string, message: string) => {
    setFeedbackMessage(`${title}: ${message}`);
    Alert.alert(title, message);
    if (feedbackTimeoutRef.current) {
      clearTimeout(feedbackTimeoutRef.current);
    }
    feedbackTimeoutRef.current = setTimeout(() => {
      setFeedbackMessage("");
      feedbackTimeoutRef.current = null;
    }, 5000);
  };

  const loadInstallations = useCallback(async (options?: { forceRefresh?: boolean }) => {
    try {
      setLoadingInstallations(true);
      const records = await listInstallations(options);
      setInstallations(records);
      setInstallationId((current) => {
        const currentId = Number.parseInt(current, 10);
        const exists = records.some((item) => Number(item.id) === currentId);
        if (!exists && records.length > 0) {
          return String(records[0].id);
        }
        return current;
      });
    } catch (error) {
      notify("Error", `No se pudo cargar instalaciones: ${extractApiError(error)}`);
    } finally {
      setLoadingInstallations(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadInstallations();
    }, [loadInstallations]),
  );

  useEffect(() => {
    return () => {
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    void getStoredWebAccessUsername().then((storedUsername) => {
      if (!mounted || !storedUsername) return;
      setReporterUsername((current) => {
        if (current.trim() && current.trim().toLowerCase() !== "admin") {
          return current;
        }
        return storedUsername;
      });
    });
    return () => {
      mounted = false;
    };
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
        driver_description: "Registro manual creado desde app movil",
        os_info: "mobile",
        installation_time_seconds: 0,
      });

      const createdId = response.record?.id;
      if (createdId) {
        setInstallationId(String(createdId));
      }
      notify(
        "Registro creado",
        `ID: ${createdId ?? "N/A"}\nAhora puedes adjuntar incidencia sin instalacion previa.`,
      );
      setManualClientName("");
      setManualNotes("");
      await loadInstallations({ forceRefresh: true });
    } catch (error) {
      notify("Error", extractApiError(error));
    } finally {
      setCreatingManualRecord(false);
    }
  };

  const onSubmit = async () => {
    const parsedInstallationId = Number.parseInt(installationId, 10);
    const parsedTimeAdjustment = Number.parseInt(timeAdjustment, 10);

    if (!Number.isInteger(parsedInstallationId) || parsedInstallationId <= 0) {
      notify("Dato invalido", "installation_id debe ser un numero positivo.");
      return;
    }
    if (
      installations.length > 0 &&
      !installations.some((item) => Number(item.id) === parsedInstallationId)
    ) {
      notify(
        "Instalacion no encontrada",
        "Ese installation_id no existe en la lista cargada. Refresca o crea un registro manual.",
      );
      return;
    }
    if (!note.trim()) {
      notify("Dato invalido", "La nota es obligatoria.");
      return;
    }
    if (!Number.isInteger(parsedTimeAdjustment)) {
      notify("Dato invalido", "time_adjustment_seconds debe ser entero.");
      return;
    }

    try {
      setSubmitting(true);
      const response = await createIncident(parsedInstallationId, {
        note: note.trim(),
        reporter_username: reporterUsername.trim() || "mobile_user",
        time_adjustment_seconds: parsedTimeAdjustment,
        severity,
        source: "mobile",
        apply_to_installation: false,
      });

      notify(
        "Incidencia creada",
        `ID: ${response.incident.id}\nInstalacion: ${response.incident.installation_id}`,
      );
      setNote("");
      setTimeAdjustment("0");
    } catch (error) {
      const message = extractApiError(error);
      if (message.toLowerCase().includes("no encontrada")) {
        await loadInstallations({ forceRefresh: true });
      }
      notify("Error", message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={[styles.container, { backgroundColor: palette.screenBg }]}>
      <Text style={[styles.title, { color: palette.textPrimary }]}>Crear incidencia</Text>
      <Text style={[styles.subtitle, { color: palette.textSecondary }]}>
        Usa esta pantalla para crear incidencias y validar el flujo contra el Worker.
      </Text>
      {feedbackMessage ? (
        <View
          style={[
            styles.feedbackBox,
            { backgroundColor: palette.feedbackBg, borderColor: palette.feedbackBorder },
          ]}
        >
          <Text style={[styles.feedbackText, { color: palette.feedbackText }]}>{feedbackMessage}</Text>
        </View>
      ) : null}

      <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>1) Crear registro manual base</Text>
      <Text style={[styles.hint, { color: palette.textMuted }]}>
        Esto crea un registro en historial sin depender de instalacion previa.
      </Text>

      <Text style={[styles.label, { color: palette.label }]}>Cliente (opcional)</Text>
      <TextInput
        value={manualClientName}
        onChangeText={setManualClientName}
        style={[styles.input, { backgroundColor: palette.inputBg, borderColor: palette.inputBorder, color: palette.textPrimary }]}
        placeholder="Cliente ACME"
        placeholderTextColor={palette.placeholder}
      />

      <Text style={[styles.label, { color: palette.label }]}>Notas del registro base (opcional)</Text>
      <TextInput
        value={manualNotes}
        onChangeText={setManualNotes}
        style={[
          styles.input,
          styles.manualNoteInput,
          { backgroundColor: palette.inputBg, borderColor: palette.inputBorder, color: palette.textPrimary },
        ]}
        multiline
        placeholder="Contexto inicial del caso"
        placeholderTextColor={palette.placeholder}
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

      <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>2) Crear incidencia sobre un registro</Text>

      <View style={styles.rowBetween}>
        <Text style={[styles.label, { color: palette.label }]}>Instalaciones disponibles</Text>
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
        <Text style={[styles.hint, { color: palette.textMuted }]}>No hay instalaciones para seleccionar.</Text>
      ) : (
        <>
          {installations.length > 30 ? (
            <Text style={[styles.hint, { color: palette.textMuted }]}>
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
                    selected && styles.chipSelected,
                  ]}
                  onPress={() => setInstallationId(String(item.id))}
                >
                  <Text
                    style={[
                      styles.chipText,
                      { color: palette.chipText },
                      selected && styles.chipTextSelected,
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

      <Text style={[styles.label, { color: palette.label }]}>Installation ID</Text>
      <TextInput
        value={installationId}
        onChangeText={setInstallationId}
        keyboardType="numeric"
        style={[styles.input, { backgroundColor: palette.inputBg, borderColor: palette.inputBorder, color: palette.textPrimary }]}
        placeholder="1"
        placeholderTextColor={palette.placeholder}
      />

      <Text style={[styles.label, { color: palette.label }]}>Usuario</Text>
      <TextInput
        value={reporterUsername}
        onChangeText={setReporterUsername}
        style={[styles.input, { backgroundColor: palette.inputBg, borderColor: palette.inputBorder, color: palette.textPrimary }]}
        placeholder="admin"
        placeholderTextColor={palette.placeholder}
      />

      <Text style={[styles.label, { color: palette.label }]}>Nota</Text>
      <TextInput
        value={note}
        onChangeText={setNote}
        style={[
          styles.input,
          styles.noteInput,
          { backgroundColor: palette.inputBg, borderColor: palette.inputBorder, color: palette.textPrimary },
        ]}
        multiline
        placeholder="Describe la incidencia"
        placeholderTextColor={palette.placeholder}
      />

      <Text style={[styles.label, { color: palette.label }]}>Urgencia (severidad)</Text>
      <View style={styles.severityWrap}>
        {SEVERITY_OPTIONS.map((option) => {
          const selected = severity === option.value;
          return (
            <TouchableOpacity
              key={option.value}
              style={[
                styles.severityChip,
                { backgroundColor: palette.severityBg, borderColor: palette.severityBorder },
                selected && styles.severityChipSelected,
              ]}
              onPress={() => setSeverity(option.value)}
            >
              <Text
                style={[
                  styles.severityChipLabel,
                  { color: palette.severityLabel },
                  selected && styles.severityChipLabelSelected,
                ]}
              >
                {option.label}
              </Text>
              <Text
                style={[
                  styles.severityChipCriteria,
                  { color: palette.severityCriteria },
                  selected && styles.severityChipCriteriaSelected,
                ]}
              >
                {option.criteria}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={[styles.label, { color: palette.label }]}>Ajuste de tiempo (segundos)</Text>
      <TextInput
        value={timeAdjustment}
        onChangeText={setTimeAdjustment}
        keyboardType="numeric"
        style={[styles.input, { backgroundColor: palette.inputBg, borderColor: palette.inputBorder, color: palette.textPrimary }]}
        placeholder="0"
        placeholderTextColor={palette.placeholder}
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
    backgroundColor: "#f8fafc",
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
  feedbackBox: {
    borderWidth: 1,
    borderColor: "#bae6fd",
    backgroundColor: "#f0f9ff",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 4,
  },
  feedbackText: {
    color: "#0c4a6e",
    fontSize: 12,
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
  severityWrap: {
    gap: 8,
  },
  severityChip: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 10,
    backgroundColor: "#ffffff",
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 2,
  },
  severityChipSelected: {
    borderColor: "#0b7a75",
    backgroundColor: "#ecfeff",
  },
  severityChipLabel: {
    color: "#0f172a",
    fontWeight: "700",
    fontSize: 12,
  },
  severityChipLabelSelected: {
    color: "#0f766e",
  },
  severityChipCriteria: {
    color: "#475569",
    fontSize: 12,
  },
  severityChipCriteriaSelected: {
    color: "#155e75",
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
